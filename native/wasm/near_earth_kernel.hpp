/**
 * Deep-space-free `sgp4()` equivalent over `NearEarthSoa`, two satellites per
 * pass on WASM SIMD `f64x2` lanes.
 *
 * Scope: Vallado's `method == 'n'` branch only — secular gravity + drag
 * (including the non-simple d2–d4 / t3–t5 terms), J3 long-period and J2
 * short-period periodics. Records with `method == 'd'` are not handled here;
 * `sgp4_wasm.cpp` routes those to scalar Vallado `sgp4()` (SDP4), which also
 * stays the accuracy oracle in tests.
 *
 * `vallado/sgp4unit.cpp` is untouched. This is a transcription of its
 * near-earth path with the operation order preserved lane-for-lane, so a lane
 * reproduces scalar `sgp4()` bit for bit: `f64x2` add/mul/div/sqrt are
 * IEEE-exact per lane, and `sin`/`cos`/`atan2`/`pow`/`fmod` are extracted and
 * called scalar (WASM SIMD has no vector transcendentals). The win is the
 * halved loop trip count over the pure algebra, one `getgravconst()` per batch
 * instead of per satellite, and touching ~30 SoA doubles per satellite instead
 * of striding a ~1 KB `elsetrec`.
 */
#pragma once

#include <cmath>
#include <cstddef>

#include "near_earth_soa.hpp"

#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif

namespace sgp4wasm {

/** Floats per physics mode-3 GPU slot (`SGP4_GPU_FLOATS_PER_SLOT` in TypeScript). */
constexpr int kGpuSlotFloats = 12;

/** Wrap an angle to [0, 2pi) for the float32 GPU slot. */
inline double wrapTwoPi(double x) {
  const double twopi = 2.0 * pi;
  const double r = std::fmod(x, twopi);
  return r < 0.0 ? r + twopi : r;
}

/** Two f64 lanes: one `v128_t` under `-msimd128`, a plain pair otherwise. */
struct V2 {
#ifdef __wasm_simd128__
  v128_t v;
  static inline V2 make(double a, double b) { return V2{wasm_f64x2_make(a, b)}; }
  static inline V2 splat(double a) { return V2{wasm_f64x2_splat(a)}; }
  inline double lane0() const { return wasm_f64x2_extract_lane(v, 0); }
  inline double lane1() const { return wasm_f64x2_extract_lane(v, 1); }
#else
  double a, b;
  static inline V2 make(double x, double y) { return V2{x, y}; }
  static inline V2 splat(double x) { return V2{x, x}; }
  inline double lane0() const { return a; }
  inline double lane1() const { return b; }
#endif
};

#ifdef __wasm_simd128__
inline V2 operator+(V2 x, V2 y) { return V2{wasm_f64x2_add(x.v, y.v)}; }
inline V2 operator-(V2 x, V2 y) { return V2{wasm_f64x2_sub(x.v, y.v)}; }
inline V2 operator*(V2 x, V2 y) { return V2{wasm_f64x2_mul(x.v, y.v)}; }
inline V2 operator/(V2 x, V2 y) { return V2{wasm_f64x2_div(x.v, y.v)}; }
inline V2 operator-(V2 x) { return V2{wasm_f64x2_neg(x.v)}; }
inline V2 vsqrt(V2 x) { return V2{wasm_f64x2_sqrt(x.v)}; }
/** Lane-wise `cond ? x : y`, `cond` built from lane booleans. */
inline V2 vselect(bool c0, bool c1, V2 x, V2 y) {
  const v128_t mask = wasm_i64x2_make(c0 ? -1 : 0, c1 ? -1 : 0);
  return V2{wasm_v128_bitselect(x.v, y.v, mask)};
}
/** Load lanes from two (generally non-adjacent) SoA slots. */
inline V2 vload2(const double* p, size_t a, size_t b) { return V2::make(p[a], p[b]); }
#else
inline V2 operator+(V2 x, V2 y) { return V2{x.a + y.a, x.b + y.b}; }
inline V2 operator-(V2 x, V2 y) { return V2{x.a - y.a, x.b - y.b}; }
inline V2 operator*(V2 x, V2 y) { return V2{x.a * y.a, x.b * y.b}; }
inline V2 operator/(V2 x, V2 y) { return V2{x.a / y.a, x.b / y.b}; }
inline V2 operator-(V2 x) { return V2{-x.a, -x.b}; }
inline V2 vsqrt(V2 x) { return V2{std::sqrt(x.a), std::sqrt(x.b)}; }
inline V2 vselect(bool c0, bool c1, V2 x, V2 y) {
  return V2{c0 ? x.a : y.a, c1 ? x.b : y.b};
}
inline V2 vload2(const double* p, size_t a, size_t b) { return V2::make(p[a], p[b]); }
#endif

// Scalar libm per lane: WASM SIMD has no vector transcendentals, and going
// through libm keeps each lane bit-identical to Vallado's scalar result.
inline V2 vsin(V2 x) { return V2::make(std::sin(x.lane0()), std::sin(x.lane1())); }
inline V2 vcos(V2 x) { return V2::make(std::cos(x.lane0()), std::cos(x.lane1())); }
/**
 * Same-angle sin+cos in one reduction per lane. musl's `sincos` shares `sin`
 * and `cos`'s argument reduction and polynomials, so each lane is still bit
 * identical to Vallado's separate calls (the WASM oracle test pins this).
 */
inline void vsincos(V2 x, V2& sn, V2& cs) {
  double s0, c0, s1, c1;
  sincos(x.lane0(), &s0, &c0);
  sincos(x.lane1(), &s1, &c1);
  sn = V2::make(s0, s1);
  cs = V2::make(c0, c1);
}
inline V2 vatan2(V2 y, V2 x) {
  return V2::make(std::atan2(y.lane0(), x.lane0()), std::atan2(y.lane1(), x.lane1()));
}
inline V2 vpow(V2 x, double e) {
  return V2::make(std::pow(x.lane0(), e), std::pow(x.lane1(), e));
}
inline V2 vfmod(V2 x, double m) {
  return V2::make(std::fmod(x.lane0(), m), std::fmod(x.lane1(), m));
}

/** `getgravconst` results, hoisted out of the per-satellite loop. */
struct GravCache {
  double xke, j2, radiusearthkm, vkmpersec, x2o3, twopi;
};

inline GravCache makeGravCache(gravconsttype whichconst) {
  double tumin, mu, radiusearthkm, xke, j2, j3, j4, j3oj2;
  getgravconst(whichconst, tumin, mu, radiusearthkm, xke, j2, j3, j4, j3oj2);
  GravCache gc;
  gc.xke = xke;
  gc.j2 = j2;
  gc.radiusearthkm = radiusearthkm;
  gc.vkmpersec = radiusearthkm * xke / 60.0;
  gc.x2o3 = 2.0 / 3.0;
  gc.twopi = 2.0 * pi;
  return gc;
}

/** Two lanes of TEME state (km, km/s) plus Vallado error codes (0 = ok). */
struct NearEarthPairOut {
  double rx[2], ry[2], rz[2], vx[2], vy[2], vz[2];
  int err[2];
};

/**
 * Propagate near-earth SoA records `a` and `b` to `ta` / `tb` minutes past
 * their own epochs. Pass `a == b` for an odd tail; lane 1 is then redundant.
 *
 * Both lanes run to completion — Vallado's early `return false` becomes an
 * error code resolved per lane at the end, in his order (2, 1, 4, 6). A lane
 * that errors has already produced NaN/garbage state, which the caller drops.
 */
inline void sgp4NearEarthPair(
    const NearEarthSoa& s,
    size_t a,
    size_t b,
    double ta,
    double tb,
    const GravCache& gc,
    NearEarthPairOut& out) {
  const V2 one = V2::splat(1.0);
  const V2 t = V2::make(ta, tb);

  /* ------- update for secular gravity and atmospheric drag ----- */
  const V2 xmdf = vload2(s.mo.data(), a, b) + vload2(s.mdot.data(), a, b) * t;
  const V2 argpdf = vload2(s.argpo.data(), a, b) + vload2(s.argpdot.data(), a, b) * t;
  const V2 nodedf = vload2(s.nodeo.data(), a, b) + vload2(s.nodedot.data(), a, b) * t;
  const V2 t2 = t * t;
  const V2 nodem = nodedf + vload2(s.nodecf.data(), a, b) * t2;
  const V2 bstar = vload2(s.bstar.data(), a, b);
  V2 argpm = argpdf;
  V2 mm = xmdf;
  V2 tempa = one - vload2(s.cc1.data(), a, b) * t;
  V2 tempe = bstar * vload2(s.cc4.data(), a, b) * t;
  V2 templ = vload2(s.t2cof.data(), a, b) * t2;

  const bool ns0 = s.isimp[a] != 1;
  const bool ns1 = s.isimp[b] != 1;
  if (ns0 || ns1) {
    const V2 delomg = vload2(s.omgcof.data(), a, b) * t;
    const V2 delm =
        vload2(s.xmcof.data(), a, b) *
        (vpow(one + vload2(s.eta.data(), a, b) * vcos(xmdf), 3.0) - vload2(s.delmo.data(), a, b));
    const V2 temp = delomg + delm;
    const V2 mm_ns = xmdf + temp;
    const V2 t3 = t2 * t;
    const V2 t4 = t3 * t;
    mm = vselect(ns0, ns1, mm_ns, mm);
    argpm = vselect(ns0, ns1, argpdf - temp, argpm);
    tempa = vselect(
        ns0,
        ns1,
        tempa - vload2(s.d2.data(), a, b) * t2 - vload2(s.d3.data(), a, b) * t3 -
            vload2(s.d4.data(), a, b) * t4,
        tempa);
    tempe = vselect(
        ns0,
        ns1,
        tempe + bstar * vload2(s.cc5.data(), a, b) * (vsin(mm_ns) - vload2(s.sinmao.data(), a, b)),
        tempe);
    templ = vselect(
        ns0,
        ns1,
        templ + vload2(s.t3cof.data(), a, b) * t3 +
            t4 * (vload2(s.t4cof.data(), a, b) + t * vload2(s.t5cof.data(), a, b)),
        templ);
  }

  // Near-earth: no dspace(), so nm stays satrec.no (> 0 after sgp4init).
  const V2 no = vload2(s.no.data(), a, b);
  const V2 inclm = vload2(s.inclo.data(), a, b);
  const V2 xke = V2::splat(gc.xke);
  const V2 am = vpow(xke / no, gc.x2o3) * tempa * tempa;
  const V2 nm = xke / vpow(am, 1.5);
  V2 em = vload2(s.ecco.data(), a, b) - tempe;

  const bool bad_e0 = em.lane0() >= 1.0 || em.lane0() < -0.001;
  const bool bad_e1 = em.lane1() >= 1.0 || em.lane1() < -0.001;
  // sgp4fix fix tolerance to avoid a divide by zero
  em = vselect(em.lane0() < 1.0e-6, em.lane1() < 1.0e-6, V2::splat(1.0e-6), em);

  mm = mm + no * templ;
  const V2 xlm = vfmod(mm + argpm + nodem, gc.twopi);
  const V2 nodep = vfmod(nodem, gc.twopi);
  const V2 argpp = vfmod(argpm, gc.twopi);
  const V2 mp = vfmod(xlm - argpp - nodep, gc.twopi);

  V2 sinip, cosip;
  vsincos(inclm, sinip, cosip);

  /* -------------------- long period periodics ------------------ */
  // No dpper(): ep/xincp/argpp/nodep/mp are the secular values unchanged.
  V2 sinargpp, cosargpp;
  vsincos(argpp, sinargpp, cosargpp);
  const V2 axnl = em * cosargpp;
  V2 temp = one / (am * (one - em * em));
  const V2 aynl = em * sinargpp + temp * vload2(s.aycof.data(), a, b);
  const V2 xl = mp + argpp + nodep + temp * vload2(s.xlcof.data(), a, b) * axnl;

  /* --------------------- solve kepler's equation --------------- */
  const V2 u = vfmod(xl - nodep, gc.twopi);
  V2 eo1 = u;
  V2 sineo1 = V2::splat(0.0);
  V2 coseo1 = V2::splat(0.0);
  bool live0 = true;
  bool live1 = true;
  for (int ktr = 1; ktr <= 10 && (live0 || live1); ktr++) {
    // Frozen lanes keep the sin/cos of the iteration that converged them —
    // where Vallado's scalar while-loop leaves sineo1/coseo1 — and are not
    // recomputed, so the pair costs the same transcendentals as two scalar
    // runs rather than 2 x max(iterations).
    double s0 = sineo1.lane0();
    double c0 = coseo1.lane0();
    double s1 = sineo1.lane1();
    double c1 = coseo1.lane1();
    if (live0) {
      sincos(eo1.lane0(), &s0, &c0);
    }
    if (live1) {
      sincos(eo1.lane1(), &s1, &c1);
    }
    // A frozen lane carries its previous sin/cos forward, so these are already
    // the values Vallado's loop would have left behind; no select needed.
    const V2 sn = V2::make(s0, s1);
    const V2 cs = V2::make(c0, c1);
    V2 tem5 = one - cs * axnl - sn * aynl;
    tem5 = (u - aynl * cs + axnl * sn - eo1) / tem5;
    // sgp4fix for kepler iteration: limit the correction
    const double d0 = tem5.lane0();
    const double d1 = tem5.lane1();
    tem5 = V2::make(
        std::fabs(d0) >= 0.95 ? (d0 > 0.0 ? 0.95 : -0.95) : d0,
        std::fabs(d1) >= 0.95 ? (d1 > 0.0 ? 0.95 : -0.95) : d1);
    sineo1 = sn;
    coseo1 = cs;
    eo1 = vselect(live0, live1, eo1 + tem5, eo1);
    live0 = live0 && std::fabs(tem5.lane0()) >= 1.0e-12;
    live1 = live1 && std::fabs(tem5.lane1()) >= 1.0e-12;
  }

  /* ------------- short period preliminary quantities ----------- */
  const V2 ecose = axnl * coseo1 + aynl * sineo1;
  const V2 esine = axnl * sineo1 - aynl * coseo1;
  const V2 el2 = axnl * axnl + aynl * aynl;
  const V2 pl = am * (one - el2);
  const bool bad_pl0 = pl.lane0() < 0.0;
  const bool bad_pl1 = pl.lane1() < 0.0;

  const V2 rl = am * (one - ecose);
  const V2 rdotl = vsqrt(am) * esine / rl;
  const V2 rvdotl = vsqrt(pl) / rl;
  const V2 betal = vsqrt(one - el2);
  temp = esine / (one + betal);
  const V2 arl = am / rl;
  const V2 sinu = arl * (sineo1 - aynl - axnl * temp);
  const V2 cosu = arl * (coseo1 - axnl + aynl * temp);
  V2 su = vatan2(sinu, cosu);
  const V2 sin2u = (cosu + cosu) * sinu;
  const V2 cos2u = one - V2::splat(2.0) * sinu * sinu;
  temp = one / pl;
  const V2 temp1 = V2::splat(0.5 * gc.j2) * temp;
  const V2 temp2 = temp1 * temp;

  const V2 con41 = vload2(s.con41.data(), a, b);
  const V2 x1mth2 = vload2(s.x1mth2.data(), a, b);
  const V2 mrt = rl * (one - V2::splat(1.5) * temp2 * betal * con41) +
                 V2::splat(0.5) * temp1 * x1mth2 * cos2u;
  su = su - V2::splat(0.25) * temp2 * vload2(s.x7thm1.data(), a, b) * sin2u;
  const V2 xnode = nodep + V2::splat(1.5) * temp2 * cosip * sin2u;
  const V2 xinc = inclm + V2::splat(1.5) * temp2 * cosip * sinip * cos2u;
  const V2 mvt = rdotl - nm * temp1 * x1mth2 * sin2u / xke;
  const V2 rvdot =
      rvdotl + nm * temp1 * (x1mth2 * cos2u + V2::splat(1.5) * con41) / xke;

  /* --------------------- orientation vectors ------------------- */
  V2 sinsu, cossu, snod, cnod, sini, cosi;
  vsincos(su, sinsu, cossu);
  vsincos(xnode, snod, cnod);
  vsincos(xinc, sini, cosi);
  const V2 xmx = -snod * cosi;
  const V2 xmy = cnod * cosi;
  const V2 ux = xmx * sinsu + cnod * cossu;
  const V2 uy = xmy * sinsu + snod * cossu;
  const V2 uz = sini * sinsu;
  const V2 vx = xmx * cossu - cnod * sinsu;
  const V2 vy = xmy * cossu - snod * sinsu;
  const V2 vz = sini * cossu;

  /* --------- position and velocity (in km and km/sec) ---------- */
  const V2 re = V2::splat(gc.radiusearthkm);
  const V2 vk = V2::splat(gc.vkmpersec);
  const V2 rx = mrt * ux * re;
  const V2 ry = mrt * uy * re;
  const V2 rz = mrt * uz * re;
  const V2 vxo = (mvt * ux + rvdot * vx) * vk;
  const V2 vyo = (mvt * uy + rvdot * vy) * vk;
  const V2 vzo = (mvt * uz + rvdot * vz) * vk;

  out.rx[0] = rx.lane0();
  out.rx[1] = rx.lane1();
  out.ry[0] = ry.lane0();
  out.ry[1] = ry.lane1();
  out.rz[0] = rz.lane0();
  out.rz[1] = rz.lane1();
  out.vx[0] = vxo.lane0();
  out.vx[1] = vxo.lane1();
  out.vy[0] = vyo.lane0();
  out.vy[1] = vyo.lane1();
  out.vz[0] = vzo.lane0();
  out.vz[1] = vzo.lane1();
  // Vallado's error order: eccentricity (1), semi-latus rectum (4), decay (6).
  out.err[0] = bad_e0 ? 1 : (bad_pl0 ? 4 : (mrt.lane0() < 1.0 ? 6 : 0));
  out.err[1] = bad_e1 ? 1 : (bad_pl1 ? 4 : (mrt.lane1() < 1.0 ? 6 : 0));
}

}  // namespace sgp4wasm
