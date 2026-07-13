/**
 * Emscripten bridge for batch Vallado SGP4 propagation.
 *
 * TLE catalog layout (per satellite, 260 bytes):
 *   [0..129]   line 1 (NUL-padded)
 *   [130..259] line 2 (NUL-padded)
 */

#include <cmath>
#include <cstring>
#include <vector>

#include "../vallado/sgp4io.h"
#include "../vallado/sgp4unit.h"

namespace {

constexpr int kTleLineBytes = 130;
constexpr int kTleRecordBytes = kTleLineBytes * 2;
constexpr double kUnixEpochJd = 2440587.5;

std::vector<elsetrec> g_catalog;
gravconsttype g_grav = wgs72;

double unixMsToJd(double unix_ms) {
  return unix_ms / 86400000.0 + kUnixEpochJd;
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

}  // namespace

extern "C" {

int sgp4_catalog_count() {
  return static_cast<int>(g_catalog.size());
}

void sgp4_clear_catalog() {
  g_catalog.clear();
}

/** Load TLE catalog from packed bytes (see header). Returns satellites loaded. */
int sgp4_load_catalog(const char* data, int byte_length) {
  g_catalog.clear();
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

  return static_cast<int>(g_catalog.size());
}

/**
 * Propagate `count` satellites starting at `start_index` to unix_ms.
 * Writes count * 6 floats into out: x,y,z (km), vx,vy,vz (km/s) in TEME/ECI.
 */
int sgp4_propagate_batch(double unix_ms, float* out, int start_index, int count) {
  if (!out || count <= 0 || start_index < 0) {
    return -1;
  }

  const int catalog = static_cast<int>(g_catalog.size());
  if (start_index >= catalog) {
    return -1;
  }

  const int limit = count < catalog - start_index ? count : catalog - start_index;
  const double jd = unixMsToJd(unix_ms);

  for (int i = 0; i < limit; i++) {
    elsetrec& satrec = g_catalog[static_cast<size_t>(start_index + i)];
    const double tsince = (jd - satrec.jdsatepoch) * 1440.0;
    double r[3] = {0.0, 0.0, 0.0};
    double v[3] = {0.0, 0.0, 0.0};

    const int base = i * 6;
    // Vallado sgp4() returns true on success, false on decay/error.
    if (sgp4(g_grav, satrec, tsince, r, v)) {
      out[base + 0] = static_cast<float>(r[0]);
      out[base + 1] = static_cast<float>(r[1]);
      out[base + 2] = static_cast<float>(r[2]);
      out[base + 3] = static_cast<float>(v[0]);
      out[base + 4] = static_cast<float>(v[1]);
      out[base + 5] = static_cast<float>(v[2]);
    } else {
      out[base + 0] = out[base + 1] = out[base + 2] = 0.0f;
      out[base + 3] = out[base + 4] = out[base + 5] = 0.0f;
    }
  }

  return limit;
}

}  // extern "C"
