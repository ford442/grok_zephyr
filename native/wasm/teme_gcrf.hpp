/**
 * Low-order TEME → GCRF (≈ J2000) using IAU-76 precession, a truncated
 * IAU-1980 nutation, and the equation of the equinoxes.
 *
 * Not IERS-grade (no polar motion, no frame bias, few nutation terms).
 * Default render frame remains TEME-as-ECI; this is opt-in from JS.
 */
#pragma once

#include <cmath>

namespace sgp4wasm {

constexpr double kPi = 3.14159265358979323846;
constexpr double kArcsecToRad = kPi / (180.0 * 3600.0);
constexpr double kDegToRad = kPi / 180.0;
constexpr double kJdJ2000 = 2451545.0;

inline void mulMat3Vec(const double m[9], const double v[3], double out[3]) {
  out[0] = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
  out[1] = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
  out[2] = m[6] * v[0] + m[7] * v[1] + m[8] * v[2];
}

/** Rz(angle) in row-major 3×3. */
inline void rotZ(double angle, double m[9]) {
  const double c = std::cos(angle);
  const double s = std::sin(angle);
  m[0] = c;
  m[1] = s;
  m[2] = 0;
  m[3] = -s;
  m[4] = c;
  m[5] = 0;
  m[6] = 0;
  m[7] = 0;
  m[8] = 1;
}

inline void rotY(double angle, double m[9]) {
  const double c = std::cos(angle);
  const double s = std::sin(angle);
  m[0] = c;
  m[1] = 0;
  m[2] = -s;
  m[3] = 0;
  m[4] = 1;
  m[5] = 0;
  m[6] = s;
  m[7] = 0;
  m[8] = c;
}

inline void rotX(double angle, double m[9]) {
  const double c = std::cos(angle);
  const double s = std::sin(angle);
  m[0] = 1;
  m[1] = 0;
  m[2] = 0;
  m[3] = 0;
  m[4] = c;
  m[5] = s;
  m[6] = 0;
  m[7] = -s;
  m[8] = c;
}

inline void mulMat3(const double a[9], const double b[9], double out[9]) {
  for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 3; j++) {
      out[i * 3 + j] = a[i * 3 + 0] * b[0 * 3 + j] + a[i * 3 + 1] * b[1 * 3 + j] +
                       a[i * 3 + 2] * b[2 * 3 + j];
    }
  }
}

/** Build TEME→GCRF matrix at Julian date. */
inline void temeToGcrfMatrix(double jd, double m[9]) {
  const double t = (jd - kJdJ2000) / 36525.0;
  const double t2 = t * t;
  const double t3 = t2 * t;

  // IAU 1976 precession, arcsec → rad (MOD ← J2000 = Rz(-z) Ry(θ) Rz(-ζ)).
  const double zeta = (2306.2181 * t + 0.30188 * t2 + 0.017998 * t3) * kArcsecToRad;
  const double z = (2306.2181 * t + 1.09468 * t2 + 0.018203 * t3) * kArcsecToRad;
  const double theta = (2004.3109 * t - 0.42665 * t2 - 0.041833 * t3) * kArcsecToRad;

  double rzZeta[9], ryTheta[9], rzZ[9], tmp[9], precession[9];
  rotZ(-zeta, rzZeta);
  rotY(theta, ryTheta);
  rotZ(-z, rzZ);
  mulMat3(ryTheta, rzZeta, tmp);
  mulMat3(rzZ, tmp, precession);

  // Truncated IAU 1980 nutation (Ω and 2L terms).
  const double omega = (125.04452 - 1934.136261 * t) * kDegToRad;
  const double lSun = (280.4665 + 36000.7698 * t) * kDegToRad;
  const double dpsi =
      (-17.1996 * std::sin(omega) - 1.3187 * std::sin(2.0 * lSun)) * kArcsecToRad;
  const double deps =
      (9.2025 * std::cos(omega) + 0.5736 * std::cos(2.0 * lSun)) * kArcsecToRad;
  const double eps0 = (23.439291 - 0.0130042 * t) * kDegToRad;
  const double eps = eps0 + deps;

  // TOD ← MOD = Rx(-ε) Rz(-Δψ) Rx(ε0)
  double rxEps0[9], rzDpsi[9], rxEps[9], nutation[9];
  rotX(eps0, rxEps0);
  rotZ(-dpsi, rzDpsi);
  rotX(-eps, rxEps);
  mulMat3(rzDpsi, rxEps0, tmp);
  mulMat3(rxEps, tmp, nutation);

  // Equation of the equinoxes: TEME → TOD is Rz(Δψ cos ε).
  const double eqeq = dpsi * std::cos(eps);
  double eqRot[9];
  rotZ(eqeq, eqRot);

  // GCRF ← TEME = P^T N^T Rz(eqeq)  (P takes J2000 → MOD).
  // Invert P and N by transposing (rotation matrices).
  double pT[9], nT[9], pnT[9];
  for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 3; j++) {
      pT[i * 3 + j] = precession[j * 3 + i];
      nT[i * 3 + j] = nutation[j * 3 + i];
    }
  }
  mulMat3(pT, nT, pnT);
  mulMat3(pnT, eqRot, m);
}

inline void temeToGcrfVec(const double teme[3], double jd, double gcrf[3]) {
  double m[9];
  temeToGcrfMatrix(jd, m);
  mulMat3Vec(m, teme, gcrf);
}

}  // namespace sgp4wasm
