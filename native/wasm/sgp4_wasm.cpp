/**
 * Emscripten bridge for batch Vallado SGP4 propagation.
 *
 * TLE catalog layout (per satellite, 260 bytes):
 *   [0..129]   line 1 (NUL-padded)
 *   [130..259] line 2 (NUL-padded)
 *
 * Vallado sgp4unit.cpp is not modified. One catalog per module instance.
 * This is the single TLE parser for the app: `twoline2rv` here owns the
 * catalog, and the GPU mean elements are packed from it too
 * (`sgp4_pack_gpu_elements`), so the JS side never needs a second parse.
 *
 * Near-earth fields are copied into SoA after twoline2rv. Records with
 * method == 'n' propagate through the SIMD SoA kernel (near_earth_kernel.hpp);
 * method == 'd' (SDP4) still runs scalar Vallado sgp4() on elsetrec. WASM SIMD
 * is also used for tsince, AoS pack, TEME, and Keplerian hypot lanes.
 */

#include <cmath>
#include <cstring>
#include <vector>

#include "../vallado/sgp4io.h"
#include "../vallado/sgp4unit.h"
#include "keplerian.hpp"
#include "near_earth_kernel.hpp"
#include "near_earth_soa.hpp"
#include "simd_pack.hpp"
#include "teme_gcrf.hpp"

#ifndef SGP4_ENABLE_TEME_GCRF
#define SGP4_ENABLE_TEME_GCRF 1
#endif

namespace {

constexpr int kTleLineBytes = 130;
constexpr int kTleRecordBytes = kTleLineBytes * 2;
constexpr double kUnixEpochJd = 2440587.5;
constexpr int kStateFloats = 6;

std::vector<elsetrec> g_catalog;
sgp4wasm::NearEarthSoa g_near;
gravconsttype g_grav = wgs72;
/** Records the last sgp4_load_catalog skipped (twoline2rv / sgp4init error). */
int g_rejected = 0;

std::vector<float> g_rx, g_ry, g_rz, g_vx, g_vy, g_vz;
std::vector<int> g_err_scratch;
std::vector<double> g_tsince;

double unixMsToJd(double unix_ms) { return unix_ms / 86400000.0 + kUnixEpochJd; }

void syncCatalogSoa() {
  const size_t n = g_catalog.size();
  g_near.resize(n);
  for (size_t i = 0; i < n; i++) {
    g_near.copyFrom(i, g_catalog[i]);
  }
}

void ensureStateSoa(int count) {
  const size_t n = static_cast<size_t>(count);
  g_rx.resize(n);
  g_ry.resize(n);
  g_rz.resize(n);
  g_vx.resize(n);
  g_vy.resize(n);
  g_vz.resize(n);
  g_err_scratch.resize(n);
  g_tsince.resize(n);
}

bool loadSatrecFromLines(const char* line1, const char* line2, elsetrec& satrec) {
  char l1[kTleLineBytes];
  char l2[kTleLineBytes];
  std::memcpy(l1, line1, kTleLineBytes);
  std::memcpy(l2, line2, kTleLineBytes);
  l1[kTleLineBytes - 1] = '\0';
  l2[kTleLineBytes - 1] = '\0';

  double startmfe = 0.0;
  double stopmfe = 0.0;
  double deltamin = 0.0;
  twoline2rv(l1, l2, 'c', 'e', 'i', g_grav, startmfe, stopmfe, deltamin, satrec);
  return satrec.error == 0;
}

int clampBatch(int start_index, int count) {
  const int catalog = static_cast<int>(g_catalog.size());
  if (count <= 0 || start_index < 0 || start_index >= catalog) {
    return 0;
  }
  const int remaining = catalog - start_index;
  return count < remaining ? count : remaining;
}

/** Write one propagated state (or zeros on error) into the output SoA. */
void storeState(int slot, double rx, double ry, double rz, double vx, double vy, double vz, int err) {
  const size_t k = static_cast<size_t>(slot);
  const bool ok = err == 0;
  g_rx[k] = ok ? static_cast<float>(rx) : 0.0f;
  g_ry[k] = ok ? static_cast<float>(ry) : 0.0f;
  g_rz[k] = ok ? static_cast<float>(rz) : 0.0f;
  g_vx[k] = ok ? static_cast<float>(vx) : 0.0f;
  g_vy[k] = ok ? static_cast<float>(vy) : 0.0f;
  g_vz[k] = ok ? static_cast<float>(vz) : 0.0f;
  g_err_scratch[k] = err;
}

/** Deep-space (SDP4) record: scalar Vallado sgp4() on elsetrec. */
void propagateDeepSpace(int catalog_index, int slot, double tsince) {
  elsetrec& satrec = g_catalog[static_cast<size_t>(catalog_index)];
  double r[3] = {0.0, 0.0, 0.0};
  double v[3] = {0.0, 0.0, 0.0};
  int err = 0;
  if (!sgp4(g_grav, satrec, tsince, r, v)) {
    err = satrec.error != 0 ? satrec.error : -1;
  }
  storeState(slot, r[0], r[1], r[2], v[0], v[1], v[2], err);
}

/** One SoA lane of the near-earth kernel (lane 1 is a discarded duplicate). */
void propagateNearEarthOne(int catalog_index, int slot, double tsince, const sgp4wasm::GravCache& gc) {
  const size_t a = static_cast<size_t>(catalog_index);
  sgp4wasm::NearEarthPairOut o;
  sgp4wasm::sgp4NearEarthPair(g_near, a, a, tsince, tsince, gc, o);
  storeState(slot, o.rx[0], o.ry[0], o.rz[0], o.vx[0], o.vy[0], o.vz[0], o.err[0]);
}

void propagateOne(int catalog_index, int slot, double tsince, const sgp4wasm::GravCache& gc) {
  if (g_near.method[static_cast<size_t>(catalog_index)] == 'd') {
    propagateDeepSpace(catalog_index, slot, tsince);
  } else {
    propagateNearEarthOne(catalog_index, slot, tsince, gc);
  }
}

/** Lane `k` of a kernel result into the epochs output (zeros on error). */
void writeEpochState(float* out, int base, const sgp4wasm::NearEarthPairOut& o, int k) {
  const bool ok = o.err[k] == 0;
  out[base + 0] = ok ? static_cast<float>(o.rx[k]) : 0.0f;
  out[base + 1] = ok ? static_cast<float>(o.ry[k]) : 0.0f;
  out[base + 2] = ok ? static_cast<float>(o.rz[k]) : 0.0f;
  out[base + 3] = ok ? static_cast<float>(o.vx[k]) : 0.0f;
  out[base + 4] = ok ? static_cast<float>(o.vy[k]) : 0.0f;
  out[base + 5] = ok ? static_cast<float>(o.vz[k]) : 0.0f;
}

void propagateSlice(int start_index, int limit, double jd) {
  ensureStateSoa(limit);
  sgp4wasm::fillTsinceMinutes(jd, g_near.epoch_jd.data() + start_index, g_tsince.data(), limit);
  const sgp4wasm::GravCache gc = sgp4wasm::makeGravCache(g_grav);

  int i = 0;
  for (; i + 2 <= limit; i += 2) {
    const size_t a = static_cast<size_t>(start_index + i);
    if (g_near.method[a] == 'n' && g_near.method[a + 1] == 'n') {
      sgp4wasm::NearEarthPairOut o;
      sgp4wasm::sgp4NearEarthPair(
          g_near,
          a,
          a + 1,
          g_tsince[static_cast<size_t>(i)],
          g_tsince[static_cast<size_t>(i + 1)],
          gc,
          o);
      storeState(i, o.rx[0], o.ry[0], o.rz[0], o.vx[0], o.vy[0], o.vz[0], o.err[0]);
      storeState(i + 1, o.rx[1], o.ry[1], o.rz[1], o.vx[1], o.vy[1], o.vz[1], o.err[1]);
    } else {
      propagateOne(start_index + i, i, g_tsince[static_cast<size_t>(i)], gc);
      propagateOne(start_index + i + 1, i + 1, g_tsince[static_cast<size_t>(i + 1)], gc);
    }
  }
  for (; i < limit; i++) {
    propagateOne(start_index + i, i, g_tsince[static_cast<size_t>(i)], gc);
  }
}

}  // namespace

extern "C" {

int sgp4_catalog_count() { return static_cast<int>(g_catalog.size()); }

/** TLE records rejected by the last sgp4_load_catalog (they are compacted out). */
int sgp4_catalog_rejected_count() { return g_rejected; }

void sgp4_clear_catalog() {
  g_rejected = 0;
  g_catalog.clear();
  g_near.clear();
  g_rx.clear();
  g_ry.clear();
  g_rz.clear();
  g_vx.clear();
  g_vy.clear();
  g_vz.clear();
  g_err_scratch.clear();
  g_tsince.clear();
}

/** Load TLE catalog from packed bytes (see header). Returns satellites loaded. */
int sgp4_load_catalog(const char* data, int byte_length) {
  g_catalog.clear();
  g_near.clear();
  g_rejected = 0;
  if (!data || byte_length < kTleRecordBytes) {
    return 0;
  }

  const int max_records = byte_length / kTleRecordBytes;
  g_catalog.reserve(static_cast<size_t>(max_records));

  for (int i = 0; i < max_records; i++) {
    const char* record = data + i * kTleRecordBytes;
    elsetrec satrec{};
    if (loadSatrecFromLines(record, record + kTleLineBytes, satrec)) {
      g_catalog.push_back(satrec);
    } else {
      g_rejected++;
    }
  }

  syncCatalogSoa();
  return static_cast<int>(g_catalog.size());
}

/**
 * Propagate `count` satellites starting at `start_index` to unix_ms.
 * Writes count * 6 floats into out: x,y,z (km), vx,vy,vz (km/s) in TEME/ECI.
 * When `errors` is non-null, writes Vallado satrec.error per satellite (0 = ok).
 */
int sgp4_propagate_batch_ex(double unix_ms, float* out, int* errors, int start_index, int count) {
  if (!out) {
    return -1;
  }
  const int limit = clampBatch(start_index, count);
  if (limit <= 0) {
    return -1;
  }

  propagateSlice(start_index, limit, unixMsToJd(unix_ms));
  sgp4wasm::packStateAos(
      g_rx.data(), g_ry.data(), g_rz.data(), g_vx.data(), g_vy.data(), g_vz.data(), out, limit);
  if (errors) {
    for (int i = 0; i < limit; i++) {
      errors[i] = g_err_scratch[static_cast<size_t>(i)];
    }
  }
  return limit;
}

int sgp4_propagate_batch(double unix_ms, float* out, int start_index, int count) {
  return sgp4_propagate_batch_ex(unix_ms, out, nullptr, start_index, count);
}

/**
 * Packed GPU extended elements: count × 8 floats
 *   a, e, inc, Ω, ω, M0, n (rad/s), flag (1 = ok, −Vallado error).
 */
int sgp4_propagate_batch_keplerian(double unix_ms, float* out, int start_index, int count) {
  if (!out) {
    return -1;
  }
  const int limit = clampBatch(start_index, count);
  if (limit <= 0) {
    return -1;
  }

  propagateSlice(start_index, limit, unixMsToJd(unix_ms));

  for (int i = 0; i < limit; i++) {
    float* dst = out + i * sgp4wasm::kKepFloats;
    const int err = g_err_scratch[static_cast<size_t>(i)];
    if (err != 0) {
      dst[0] = dst[1] = dst[2] = dst[3] = dst[4] = dst[5] = dst[6] = 0.0f;
      dst[7] = -static_cast<float>(err < 0 ? -err : err);
      continue;
    }
    sgp4wasm::eciStateToKeplerian(
        static_cast<double>(g_rx[static_cast<size_t>(i)]),
        static_cast<double>(g_ry[static_cast<size_t>(i)]),
        static_cast<double>(g_rz[static_cast<size_t>(i)]),
        static_cast<double>(g_vx[static_cast<size_t>(i)]),
        static_cast<double>(g_vy[static_cast<size_t>(i)]),
        static_cast<double>(g_vz[static_cast<size_t>(i)]),
        dst);
  }

  return limit;
}

/**
 * Pack the physics mode-3 GPU records for [start_index, start_index + count).
 *
 * Writes count × 12 floats (see src/physics/sgp4NearEarth.ts for the layout the
 * WGSL kernel reads). Deep-space and errored records get a zeroed slot, which
 * the shader reads as "no SGP4 record" and falls back to the Keplerian anchor.
 * The secular phases are advanced to `base_unix_ms` here in double precision;
 * the GPU only ever multiplies rates by a small delta.
 *
 * Returns the number of slots that carry a usable near-earth record.
 */
int sgp4_pack_gpu_elements(double base_unix_ms, float* out, int start_index, int count) {
  if (!out) {
    return -1;
  }
  const int limit = clampBatch(start_index, count);
  if (limit <= 0) {
    return -1;
  }

  const double base_jd = unixMsToJd(base_unix_ms);
  int valid = 0;
  for (int i = 0; i < limit; i++) {
    const size_t a = static_cast<size_t>(start_index + i);
    float* dst = out + i * sgp4wasm::kGpuSlotFloats;
    if (g_near.method[a] == 'd' || !(g_near.no[a] > 0.0)) {
      for (int k = 0; k < sgp4wasm::kGpuSlotFloats; k++) {
        dst[k] = 0.0f;
      }
      continue;
    }

    const double t0 = (base_jd - g_near.epoch_jd[a]) * sgp4wasm::kMinutesPerDay;
    dst[0] = static_cast<float>(g_near.no[a]);
    dst[1] = static_cast<float>(g_near.ecco[a]);
    dst[2] = static_cast<float>(g_near.inclo[a]);
    dst[3] = static_cast<float>(g_near.bstar[a]);
    dst[4] = static_cast<float>(
        sgp4wasm::wrapTwoPi(g_near.nodeo[a] + g_near.nodedot[a] * t0 + g_near.nodecf[a] * t0 * t0));
    dst[5] = static_cast<float>(sgp4wasm::wrapTwoPi(g_near.argpo[a] + g_near.argpdot[a] * t0));
    dst[6] = static_cast<float>(sgp4wasm::wrapTwoPi(g_near.mo[a] + g_near.mdot[a] * t0));
    dst[7] = static_cast<float>(t0);
    dst[8] = static_cast<float>(g_near.argpo[a]);
    dst[9] = static_cast<float>(g_near.mo[a]);
    dst[10] = 0.0f;
    dst[11] = 0.0f;
    valid++;
  }
  return valid;
}

/** Vallado method for catalog index: 'n' (near-earth SGP4), 'd' (SDP4), 0 out of range. */
int sgp4_catalog_method(int index) {
  if (index < 0 || index >= static_cast<int>(g_near.method.size())) {
    return 0;
  }
  return g_near.method[static_cast<size_t>(index)];
}

/**
 * Many epochs × a small satellite slice.
 * unix_ms[epoch_count]; out is sat-major then epoch then 6 state floats:
 *   out[((sat * epoch_count) + epoch) * 6 + k]
 */
int sgp4_propagate_epochs(
    const double* unix_ms,
    int epoch_count,
    float* out,
    int start_index,
    int sat_count) {
  if (!unix_ms || !out || epoch_count <= 0) {
    return -1;
  }
  const int limit = clampBatch(start_index, sat_count);
  if (limit <= 0) {
    return -1;
  }

  const sgp4wasm::GravCache gc = sgp4wasm::makeGravCache(g_grav);
  int written = 0;
  for (int s = 0; s < limit; s++) {
    const int index = start_index + s;
    const size_t a = static_cast<size_t>(index);
    const double epoch = g_near.epoch_jd[a];
    const bool near_earth = g_near.method[a] != 'd';
    int e = 0;
    // Near-earth pairs two epochs of the same satellite onto the two lanes.
    for (; near_earth && e + 2 <= epoch_count; e += 2) {
      sgp4wasm::NearEarthPairOut o;
      sgp4wasm::sgp4NearEarthPair(
          g_near,
          a,
          a,
          (unixMsToJd(unix_ms[e]) - epoch) * sgp4wasm::kMinutesPerDay,
          (unixMsToJd(unix_ms[e + 1]) - epoch) * sgp4wasm::kMinutesPerDay,
          gc,
          o);
      for (int k = 0; k < 2; k++) {
        writeEpochState(out, (s * epoch_count + e + k) * kStateFloats, o, k);
      }
      written += 2;
    }
    for (; e < epoch_count; e++) {
      const double tsince = (unixMsToJd(unix_ms[e]) - epoch) * sgp4wasm::kMinutesPerDay;
      const int base = (s * epoch_count + e) * kStateFloats;
      if (near_earth) {
        sgp4wasm::NearEarthPairOut o;
        sgp4wasm::sgp4NearEarthPair(g_near, a, a, tsince, tsince, gc, o);
        writeEpochState(out, base, o, 0);
      } else {
        elsetrec& satrec = g_catalog[a];
        double r[3] = {0.0, 0.0, 0.0};
        double v[3] = {0.0, 0.0, 0.0};
        const bool ok = sgp4(g_grav, satrec, tsince, r, v);
        out[base + 0] = ok ? static_cast<float>(r[0]) : 0.0f;
        out[base + 1] = ok ? static_cast<float>(r[1]) : 0.0f;
        out[base + 2] = ok ? static_cast<float>(r[2]) : 0.0f;
        out[base + 3] = ok ? static_cast<float>(v[0]) : 0.0f;
        out[base + 4] = ok ? static_cast<float>(v[1]) : 0.0f;
        out[base + 5] = ok ? static_cast<float>(v[2]) : 0.0f;
      }
      written++;
    }
  }
  return written;
}

#if SGP4_ENABLE_TEME_GCRF
/**
 * Rotate count TEME state vectors (6 floats each: r then v) into GCRF at unix_ms.
 * in and out may alias. Returns count, or -1 on bad args.
 */
int sgp4_teme_to_gcrf(const float* in, float* out, double unix_ms, int count) {
  if (!in || !out || count <= 0) {
    return -1;
  }
  const double jd = unixMsToJd(unix_ms);
  double m[9];
  sgp4wasm::temeToGcrfMatrix(jd, m);
  sgp4wasm::applyTemeToGcrfAos(m, in, out, count);
  return count;
}
#endif

/** Julian date of the TLE epoch for catalog index, or 0 if out of range. */
double sgp4_catalog_epoch_jd(int index) {
  if (index < 0 || index >= static_cast<int>(g_near.epoch_jd.size())) {
    return 0.0;
  }
  return g_near.epoch_jd[static_cast<size_t>(index)];
}

}  // extern "C"
