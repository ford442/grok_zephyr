/**
 * Osculating Keplerian conversion matching src/physics/keplerianFromState.ts
 * (same μ, same branch cuts). Used to pack GPU extended elements in C++.
 */
#pragma once

#include <cmath>

namespace sgp4wasm {

constexpr double kEarthMuKm3S2 = 398600.4418;
constexpr int kKepFloats = 8;

inline double clampd(double value, double lo, double hi) {
  return value < lo ? lo : (value > hi ? hi : value);
}

inline double hypot3(double x, double y, double z) { return std::sqrt(x * x + y * y + z * z); }

/** Mean anomaly from eccentric anomaly. */
inline double meanAnomalyFromEccentric(double E, double e) { return E - e * std::sin(E); }

/** Eccentric anomaly from true anomaly (matches JS eccentricFromTrueAnomaly). */
inline double eccentricFromTrueAnomaly(double nu, double e) {
  const double tanHalf = std::tan(nu * 0.5);
  const double root = e < 1e-8 ? 1.0 : std::sqrt((1.0 - e) / (1.0 + e));
  return 2.0 * std::atan(tanHalf / root);
}

/**
 * Write 8 floats: a, e, inc, Ω, ω, M0, n (rad/s), flag.
 * flag = 1 on success. Caller sets a negative Vallado error flag on failure.
 */
inline void eciStateToKeplerian(
    double rx,
    double ry,
    double rz,
    double vx,
    double vy,
    double vz,
    float* out8,
    double mu = kEarthMuKm3S2) {
  constexpr double kPi2 = 6.28318530717958647692;
  const double rMag = hypot3(rx, ry, rz);
  const double vMag = hypot3(vx, vy, vz);
  const double rDotV = rx * vx + ry * vy + rz * vz;

  const double hx = ry * vz - rz * vy;
  const double hy = rz * vx - rx * vz;
  const double hz = rx * vy - ry * vx;
  const double hMag = hypot3(hx, hy, hz);

  const double inc = hMag > 1e-9 ? std::acos(clampd(hz / hMag, -1.0, 1.0)) : 0.0;

  const double nx = -hy;
  const double ny = hx;
  const double nMag = std::hypot(nx, ny);

  double raan = 0.0;
  if (nMag > 1e-9) {
    raan = std::acos(clampd(nx / nMag, -1.0, 1.0));
    if (ny < 0.0) raan = kPi2 - raan;
  }

  const double a = 1.0 / (2.0 / rMag - (vMag * vMag) / mu);
  const double n = std::sqrt(mu / (a * a * a));

  const double eCoeff = (vMag * vMag - mu / rMag) / mu;
  const double eVecX = eCoeff * rx - (rDotV / mu) * vx;
  const double eVecY = eCoeff * ry - (rDotV / mu) * vy;
  const double eVecZ = eCoeff * rz - (rDotV / mu) * vz;
  const double e = hypot3(eVecX, eVecY, eVecZ);

  double argp = 0.0;
  double nu = 0.0;
  if (e > 1e-8 && nMag > 1e-9) {
    argp = std::acos(clampd((eVecX * nx + eVecY * ny) / (e * nMag), -1.0, 1.0));
    if (eVecZ < 0.0) argp = kPi2 - argp;
  }

  if (e > 1e-8) {
    nu = std::acos(clampd((eVecX * rx + eVecY * ry + eVecZ * rz) / (e * rMag), -1.0, 1.0));
    if (rDotV < 0.0) nu = kPi2 - nu;
  } else if (nMag > 1e-9) {
    nu = std::acos(clampd((nx * rx + ny * ry) / (nMag * rMag), -1.0, 1.0));
    if (rz < 0.0) nu = kPi2 - nu;
    argp = 0.0;
  }

  const double E = eccentricFromTrueAnomaly(nu, e);
  const double M0 = meanAnomalyFromEccentric(E, e);

  out8[0] = static_cast<float>(a);
  out8[1] = static_cast<float>(e);
  out8[2] = static_cast<float>(inc);
  out8[3] = static_cast<float>(raan);
  out8[4] = static_cast<float>(argp);
  out8[5] = static_cast<float>(M0);
  out8[6] = static_cast<float>(n);
  out8[7] = 1.0f;
}

}  // namespace sgp4wasm
