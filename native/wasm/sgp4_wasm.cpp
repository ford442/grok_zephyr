/**
 * Emscripten bridge for batch Vallado SGP4 propagation.
 *
 * TLE catalog layout (per satellite, 260 bytes):
 *   [0..129]   line 1 (NUL-padded)
 *   [130..259] line 2 (NUL-padded)
 *
 * Vallado sgp4unit.cpp is not modified. One catalog per module instance.
 * Near-earth fields are copied into SoA after twoline2rv; sgp4() still runs
 * scalar on elsetrec. WASM SIMD is used for tsince, AoS pack, TEME, and
 * Keplerian hypot lanes.
 */

#include <cmath>
#include <cstring>
#include <vector>

#include "../vallado/sgp4io.h"
#include "../vallado/sgp4unit.h"
#include "keplerian.hpp"
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

void propagateSlice(int start_index, int limit, double jd) {
  ensureStateSoa(limit);
  sgp4wasm::fillTsinceMinutes(jd, g_near.epoch_jd.data() + start_index, g_tsince.data(), limit);

  for (int i = 0; i < limit; i++) {
    elsetrec& satrec = g_catalog[static_cast<size_t>(start_index + i)];
    double r[3] = {0.0, 0.0, 0.0};
    double v[3] = {0.0, 0.0, 0.0};
    int err = 0;
    if (sgp4(g_grav, satrec, g_tsince[static_cast<size_t>(i)], r, v)) {
      err = 0;
    } else {
      r[0] = r[1] = r[2] = 0.0;
      v[0] = v[1] = v[2] = 0.0;
      err = satrec.error != 0 ? satrec.error : -1;
    }
    g_rx[static_cast<size_t>(i)] = static_cast<float>(r[0]);
    g_ry[static_cast<size_t>(i)] = static_cast<float>(r[1]);
    g_rz[static_cast<size_t>(i)] = static_cast<float>(r[2]);
    g_vx[static_cast<size_t>(i)] = static_cast<float>(v[0]);
    g_vy[static_cast<size_t>(i)] = static_cast<float>(v[1]);
    g_vz[static_cast<size_t>(i)] = static_cast<float>(v[2]);
    g_err_scratch[static_cast<size_t>(i)] = err;
  }
}

}  // namespace

extern "C" {

int sgp4_catalog_count() { return static_cast<int>(g_catalog.size()); }

void sgp4_clear_catalog() {
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

  int written = 0;
  for (int s = 0; s < limit; s++) {
    for (int e = 0; e < epoch_count; e++) {
      const double jd = unixMsToJd(unix_ms[e]);
      double tsince = 0.0;
      sgp4wasm::fillTsinceMinutes(jd, g_near.epoch_jd.data() + start_index + s, &tsince, 1);
      elsetrec& satrec = g_catalog[static_cast<size_t>(start_index + s)];
      double r[3] = {0.0, 0.0, 0.0};
      double v[3] = {0.0, 0.0, 0.0};
      int err = 0;
      if (!sgp4(g_grav, satrec, tsince, r, v)) {
        r[0] = r[1] = r[2] = 0.0;
        v[0] = v[1] = v[2] = 0.0;
        err = satrec.error != 0 ? satrec.error : -1;
      }
      const int base = (s * epoch_count + e) * kStateFloats;
      if (err != 0) {
        out[base + 0] = out[base + 1] = out[base + 2] = 0.0f;
        out[base + 3] = out[base + 4] = out[base + 5] = 0.0f;
      } else {
        out[base + 0] = static_cast<float>(r[0]);
        out[base + 1] = static_cast<float>(r[1]);
        out[base + 2] = static_cast<float>(r[2]);
        out[base + 3] = static_cast<float>(v[0]);
        out[base + 4] = static_cast<float>(v[1]);
        out[base + 5] = static_cast<float>(v[2]);
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
