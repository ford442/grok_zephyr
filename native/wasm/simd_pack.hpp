/**
 * WASM SIMD helpers for catalog post-process (tsince, AoS pack, TEME).
 * Scalar fallback when compiled without -msimd128.
 */
#pragma once

#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

namespace sgp4wasm {

constexpr double kMinutesPerDay = 1440.0;

/** tsince[i] = (jd - epoch_jd[i]) * 1440, i in [0, count). */
inline void fillTsinceMinutes(double jd, const double* epoch_jd, double* tsince, int count) {
  int i = 0;
#ifdef __wasm_simd128__
  const v128_t jd_v = wasm_f64x2_splat(jd);
  const v128_t scale = wasm_f64x2_splat(kMinutesPerDay);
  for (; i + 2 <= count; i += 2) {
    const v128_t ep = wasm_v128_load(epoch_jd + i);
    const v128_t ts = wasm_f64x2_mul(wasm_f64x2_sub(jd_v, ep), scale);
    wasm_v128_store(tsince + i, ts);
  }
#endif
  for (; i < count; i++) {
    tsince[i] = (jd - epoch_jd[i]) * kMinutesPerDay;
  }
}

/** Interleave 4 SoA r/v lanes into 4×6 AoS floats (x,y,z,vx,vy,vz). */
inline void packStateAos4(
    const float* rx,
    const float* ry,
    const float* rz,
    const float* vx,
    const float* vy,
    const float* vz,
    float* out24) {
#ifdef __wasm_simd128__
  const v128_t X = wasm_v128_load(rx);
  const v128_t Y = wasm_v128_load(ry);
  const v128_t Z = wasm_v128_load(rz);
  const v128_t VX = wasm_v128_load(vx);
  const v128_t VY = wasm_v128_load(vy);
  const v128_t VZ = wasm_v128_load(vz);

  const v128_t xy0 = wasm_i32x4_shuffle(X, Y, 0, 4, 0, 4);
  const v128_t zvx0 = wasm_i32x4_shuffle(Z, VX, 0, 4, 0, 4);
  wasm_v128_store(out24 + 0, wasm_i32x4_shuffle(xy0, zvx0, 0, 1, 4, 5));

  const v128_t vyvz0 = wasm_i32x4_shuffle(VY, VZ, 0, 4, 0, 4);
  const v128_t xy1 = wasm_i32x4_shuffle(X, Y, 1, 5, 1, 5);
  wasm_v128_store(out24 + 4, wasm_i32x4_shuffle(vyvz0, xy1, 0, 1, 4, 5));

  const v128_t zvx1 = wasm_i32x4_shuffle(Z, VX, 1, 5, 1, 5);
  const v128_t vyvz1 = wasm_i32x4_shuffle(VY, VZ, 1, 5, 1, 5);
  wasm_v128_store(out24 + 8, wasm_i32x4_shuffle(zvx1, vyvz1, 0, 1, 4, 5));

  const v128_t xy2 = wasm_i32x4_shuffle(X, Y, 2, 6, 2, 6);
  const v128_t zvx2 = wasm_i32x4_shuffle(Z, VX, 2, 6, 2, 6);
  wasm_v128_store(out24 + 12, wasm_i32x4_shuffle(xy2, zvx2, 0, 1, 4, 5));

  const v128_t vyvz2 = wasm_i32x4_shuffle(VY, VZ, 2, 6, 2, 6);
  const v128_t xy3 = wasm_i32x4_shuffle(X, Y, 3, 7, 3, 7);
  wasm_v128_store(out24 + 16, wasm_i32x4_shuffle(vyvz2, xy3, 0, 1, 4, 5));

  const v128_t zvx3 = wasm_i32x4_shuffle(Z, VX, 3, 7, 3, 7);
  const v128_t vyvz3 = wasm_i32x4_shuffle(VY, VZ, 3, 7, 3, 7);
  wasm_v128_store(out24 + 20, wasm_i32x4_shuffle(zvx3, vyvz3, 0, 1, 4, 5));
#else
  for (int k = 0; k < 4; k++) {
    out24[k * 6 + 0] = rx[k];
    out24[k * 6 + 1] = ry[k];
    out24[k * 6 + 2] = rz[k];
    out24[k * 6 + 3] = vx[k];
    out24[k * 6 + 4] = vy[k];
    out24[k * 6 + 5] = vz[k];
  }
#endif
}

inline void packStateAos(
    const float* rx,
    const float* ry,
    const float* rz,
    const float* vx,
    const float* vy,
    const float* vz,
    float* out,
    int count) {
  int i = 0;
  for (; i + 4 <= count; i += 4) {
    packStateAos4(rx + i, ry + i, rz + i, vx + i, vy + i, vz + i, out + i * 6);
  }
  for (; i < count; i++) {
    out[i * 6 + 0] = rx[i];
    out[i * 6 + 1] = ry[i];
    out[i * 6 + 2] = rz[i];
    out[i * 6 + 3] = vx[i];
    out[i * 6 + 4] = vy[i];
    out[i * 6 + 5] = vz[i];
  }
}

/** Apply row-major 3×3 (float) to 4 SoA vectors. */
inline void applyMat3f32x4(
    const float m[9],
    const float* x,
    const float* y,
    const float* z,
    float* ox,
    float* oy,
    float* oz) {
#ifdef __wasm_simd128__
  const v128_t X = wasm_v128_load(x);
  const v128_t Y = wasm_v128_load(y);
  const v128_t Z = wasm_v128_load(z);
  v128_t oxv = wasm_f32x4_mul(wasm_f32x4_splat(m[0]), X);
  oxv = wasm_f32x4_add(oxv, wasm_f32x4_mul(wasm_f32x4_splat(m[1]), Y));
  oxv = wasm_f32x4_add(oxv, wasm_f32x4_mul(wasm_f32x4_splat(m[2]), Z));
  v128_t oyv = wasm_f32x4_mul(wasm_f32x4_splat(m[3]), X);
  oyv = wasm_f32x4_add(oyv, wasm_f32x4_mul(wasm_f32x4_splat(m[4]), Y));
  oyv = wasm_f32x4_add(oyv, wasm_f32x4_mul(wasm_f32x4_splat(m[5]), Z));
  v128_t ozv = wasm_f32x4_mul(wasm_f32x4_splat(m[6]), X);
  ozv = wasm_f32x4_add(ozv, wasm_f32x4_mul(wasm_f32x4_splat(m[7]), Y));
  ozv = wasm_f32x4_add(ozv, wasm_f32x4_mul(wasm_f32x4_splat(m[8]), Z));
  wasm_v128_store(ox, oxv);
  wasm_v128_store(oy, oyv);
  wasm_v128_store(oz, ozv);
#else
  for (int k = 0; k < 4; k++) {
    const float xi = x[k];
    const float yi = y[k];
    const float zi = z[k];
    ox[k] = m[0] * xi + m[1] * yi + m[2] * zi;
    oy[k] = m[3] * xi + m[4] * yi + m[5] * zi;
    oz[k] = m[6] * xi + m[7] * yi + m[8] * zi;
  }
#endif
}

/** Rotate count TEME AoS states (6 floats: r then v) by row-major 3×3 double matrix. */
inline void applyTemeToGcrfAos(const double m[9], const float* in, float* out, int count) {
  const float mf[9] = {
      static_cast<float>(m[0]),
      static_cast<float>(m[1]),
      static_cast<float>(m[2]),
      static_cast<float>(m[3]),
      static_cast<float>(m[4]),
      static_cast<float>(m[5]),
      static_cast<float>(m[6]),
      static_cast<float>(m[7]),
      static_cast<float>(m[8]),
  };

  int i = 0;
  for (; i + 4 <= count; i += 4) {
    float rx[4], ry[4], rz[4], vx[4], vy[4], vz[4];
    for (int k = 0; k < 4; k++) {
      const int base = (i + k) * 6;
      rx[k] = in[base + 0];
      ry[k] = in[base + 1];
      rz[k] = in[base + 2];
      vx[k] = in[base + 3];
      vy[k] = in[base + 4];
      vz[k] = in[base + 5];
    }
    float orx[4], ory[4], orz[4], ovx[4], ovy[4], ovz[4];
    applyMat3f32x4(mf, rx, ry, rz, orx, ory, orz);
    applyMat3f32x4(mf, vx, vy, vz, ovx, ovy, ovz);
    packStateAos4(orx, ory, orz, ovx, ovy, ovz, out + i * 6);
  }
  for (; i < count; i++) {
    const int base = i * 6;
    const double r[3] = {in[base + 0], in[base + 1], in[base + 2]};
    const double v[3] = {in[base + 3], in[base + 4], in[base + 5]};
    double rg[3];
    double vg[3];
    rg[0] = m[0] * r[0] + m[1] * r[1] + m[2] * r[2];
    rg[1] = m[3] * r[0] + m[4] * r[1] + m[5] * r[2];
    rg[2] = m[6] * r[0] + m[7] * r[1] + m[8] * r[2];
    vg[0] = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
    vg[1] = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
    vg[2] = m[6] * v[0] + m[7] * v[1] + m[8] * v[2];
    out[base + 0] = static_cast<float>(rg[0]);
    out[base + 1] = static_cast<float>(rg[1]);
    out[base + 2] = static_cast<float>(rg[2]);
    out[base + 3] = static_cast<float>(vg[0]);
    out[base + 4] = static_cast<float>(vg[1]);
    out[base + 5] = static_cast<float>(vg[2]);
  }
}

#ifdef __wasm_simd128__
/** Two-lane f64 hypot3 (norms). atan2/acos stay scalar in Keplerian conversion. */
inline void hypot3_f64x2(
    double x0,
    double y0,
    double z0,
    double x1,
    double y1,
    double z1,
    double* mag0,
    double* mag1) {
  const v128_t x = wasm_f64x2_make(x0, x1);
  const v128_t y = wasm_f64x2_make(y0, y1);
  const v128_t z = wasm_f64x2_make(z0, z1);
  v128_t s = wasm_f64x2_mul(x, x);
  s = wasm_f64x2_add(s, wasm_f64x2_mul(y, y));
  s = wasm_f64x2_add(s, wasm_f64x2_mul(z, z));
  const v128_t mag = wasm_f64x2_sqrt(s);
  *mag0 = wasm_f64x2_extract_lane(mag, 0);
  *mag1 = wasm_f64x2_extract_lane(mag, 1);
}

#endif

}  // namespace sgp4wasm
