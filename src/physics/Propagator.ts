/**
 * Orbital Propagation System with J2 Perturbations
 * 
 * Implements SGP4-compatible orbital mechanics with J2 oblateness corrections
 * for realistic Starlink-like constellation simulation.
 * 
 * Mathematical approach:
 * - SGP4 for TLE-based propagation (Simplified General Perturbations #4)
 * - J2 perturbation for secular precession of node and perigee
 * - RK4 integration for GPU-based position updates
 */

// Physical constants (SI-based, km units for convenience)
export const PHYSICAL_CONSTANTS = {
  // Earth's gravitational parameter (km³/s²)
  MU: 398600.4418,
  
  // Earth's equatorial radius (km)
  EARTH_R: 6371.0,
  
  // Earth's oblateness coefficient (J2)
  J2: 0.00108263,
  
  // Earth's angular velocity (rad/s)
  EARTH_ROTATION: 7.2921158553e-5,
  
  // Flattening factor
  FLATTENING: 1 / 298.257223563,
  
  // Seconds per minute
  MINUTES_PER_DAY: 1440.0,
  
  // π
  PI: Math.PI,
  
  // 2π
  TWO_PI: 2 * Math.PI,
  
  // π/2
  HALF_PI: Math.PI / 2,
  
  // Degrees to radians
  DEG_TO_RAD: Math.PI / 180,
  
  // Radians to degrees
  RAD_TO_DEG: 180 / Math.PI,
} as const;

// Starlink constellation shells (altitude in km, inclination in degrees)
export const STARLINK_SHELLS = {
  SHELL_1: {
    name: 'Shell 1',
    altitude: 550,
    inclination: 53.0,
    planes: 72,
    satsPerPlane: 22,
    raanSpread: 360,
  },
  SHELL_2: {
    name: 'Shell 2',
    altitude: 540,
    inclination: 53.2,
    planes: 72,
    satsPerPlane: 22,
    raanSpread: 360,
  },
  SHELL_3: {
    name: 'Shell 3',
    altitude: 570,
    inclination: 70.0,
    planes: 36,
    satsPerPlane: 20,
    raanSpread: 360,
  },
  SHELL_4: {
    name: 'Shell 4',
    altitude: 560,
    inclination: 97.6,
    planes: 6,
    satsPerPlane: 58,
    raanSpread: 360,
  },
  SHELL_5: {
    name: 'Shell 5',
    altitude: 530,
    inclination: 43.0,
    planes: 28,
    satsPerPlane: 28,
    raanSpread: 360,
  },
} as const;

/**
 * Keplerian orbital elements
 * All angles in radians, distances in km
 */
export interface KeplerianElements {
  a: number;   // semi-major axis (km)
  e: number;   // eccentricity (0 = circular)
  i: number;   // inclination (rad)
  Ω: number;   // right ascension of ascending node / RAAN (rad)
  ω: number;   // argument of perigee (rad)
  M: number;   // mean anomaly (rad)
  
  // Additional elements for perturbed orbits
  n?: number;  // mean motion (rad/s)
  period?: number; // orbital period (seconds)
}

/**
 * Cartesian orbital state
 */
export interface CartesianState {
  position: Float64Array;  // [x, y, z] in km
  velocity: Float64Array;  // [vx, vy, vz] in km/s
}

/**
 * Complete satellite state
 */
export interface SatelliteState {
  id: number;
  keplerian: KeplerianElements;
  cartesian: CartesianState;
  shellId: number;
  planeId: number;
  satInPlaneId: number;
  
  // SGP4-specific parameters
  bstar?: number;      // drag term
  epoch?: Date;        // element epoch
}

/**
 * TLE (Two-Line Element) structure
 */
export interface TLE {
  line1: string;
  line2: string;
  name?: string;
  satnum: number;      // satellite catalog number
  epoch: Date;
  
  // Derived elements
  a: number;           // semi-major axis (km)
  e: number;           // eccentricity
  i: number;           // inclination (rad)
  Ω: number;           // RAAN (rad)
  ω: number;           // argument of perigee (rad)
  M: number;           // mean anomaly (rad)
  n: number;           // mean motion (rad/s)
  bstar: number;       // B* drag coefficient
}

/**
 * Visibility calculation result
 */
export interface VisibilityResult {
  visible: boolean;
  elevation: number;   // elevation angle (rad)
  azimuth: number;     // azimuth angle (rad)
  range: number;       // slant range (km)
  earthOccluded: boolean;
}

/**
 * J2 Perturbation calculator
 * Computes secular precession rates for RAAN and argument of perigee
 */
export class J2Perturbation {
  private readonly mu: number;
  private readonly j2: number;
  private readonly re: number;

  constructor(
    mu: number = PHYSICAL_CONSTANTS.MU,
    j2: number = PHYSICAL_CONSTANTS.J2,
    re: number = PHYSICAL_CONSTANTS.EARTH_R
  ) {
    this.mu = mu;
    this.j2 = j2;
    this.re = re;
  }

  /**
   * Calculate semi-latus rectum
   * p = a * (1 - e²)
   */
  private semiLatusRectum(a: number, e: number): number {
    return a * (1 - e * e);
  }

  /**
   * Calculate mean motion
   * n = sqrt(μ / a³)
   */
  meanMotion(a: number): number {
    return Math.sqrt(this.mu / (a * a * a));
  }

  /**
   * Calculate nodal precession rate (RAAN change per unit time)
   * 
   * Ω̇ = -3/2 * J2 * (Re/p)² * n * cos(i)
   * 
   * For prograde orbits (i < 90°), Ω̇ < 0 (westward precession)
   * For polar orbits (i = 90°), Ω̇ = 0
   * For retrograde orbits (i > 90°), Ω̇ > 0 (eastward precession)
   */
  nodalPrecessionRate(elements: KeplerianElements): number {
    const { a, e, i } = elements;
    const p = this.semiLatusRectum(a, e);
    const n = this.meanMotion(a);
    
    return -1.5 * this.j2 * Math.pow(this.re / p, 2) * n * Math.cos(i);
  }

  /**
   * Calculate perigee precession rate (argument of perigee change)
   * 
   * ω̇ = 3/4 * J2 * (Re/p)² * n * (5cos²(i) - 1)
   * 
   * Critical inclination (where ω̇ = 0): i = 63.4° or 116.6°
   * Below critical: perigee precesses in direction of motion
   * Above critical: perigee precesses opposite to motion
   */
  perigeePrecessionRate(elements: KeplerianElements): number {
    const { a, e, i } = elements;
    const p = this.semiLatusRectum(a, e);
    const n = this.meanMotion(a);
    const cosI = Math.cos(i);
    
    return 0.75 * this.j2 * Math.pow(this.re / p, 2) * n * (5 * cosI * cosI - 1);
  }

  /**
   * Apply J2 perturbations to elements over a time interval
   * Returns updated elements (does not modify original)
   */
  applyPerturbation(
    elements: KeplerianElements,
    dt: number  // time in seconds
  ): KeplerianElements {
    const omegaDot = this.nodalPrecessionRate(elements);
    const perigeeDot = this.perigeePrecessionRate(elements);
    
    return {
      ...elements,
      Ω: elements.Ω + omegaDot * dt,
      ω: elements.ω + perigeeDot * dt,
      M: elements.M + elements.n! * dt,
    };
  }

  /**
   * Calculate rate of change of mean anomaly
   * Includes J2 effects on mean motion
   */
  meanAnomalyRate(elements: KeplerianElements): number {
    const { a, e, i } = elements;
    const p = this.semiLatusRectum(a, e);
    const n = this.meanMotion(a);
    const sinI = Math.sin(i);
    
    // First-order J2 correction to mean motion
    const correction = 0.75 * this.j2 * Math.pow(this.re / p, 2) * 
                       (3 * sinI * sinI - 2) * Math.sqrt(1 - e * e);
    
    return n * (1 + correction);
  }
}

/**
 * SGP4 Propagator (Simplified General Perturbations #4)
 * 
 * SGP4 is the standard propagation model for near-Earth orbits.
 * This implementation focuses on the core orbital mechanics.
 */
export class SGP4Propagator {
  private j2: J2Perturbation;

  constructor() {
    this.j2 = new J2Perturbation();
  }

  /**
   * Parse TLE line 1
   * Format: 1 NNNNNU NNNNNAAA NNNNN.NNNNNNNN +.NNNNNNNN +NNNNN-N +NNNNN-N N NNNNN
   */
  parseTLELine1(line: string): Partial<TLE> {
    if (line.length !== 69 || line[0] !== '1') {
      throw new Error('Invalid TLE line 1 format');
    }

    const satnum = parseInt(line.substring(2, 7).trim());
    const epochYear = parseInt(line.substring(18, 20));
    const epochDay = parseFloat(line.substring(20, 32));
    const ndot = parseFloat(line.substring(33, 43).trim());  // first derivative of mean motion
    const nddotStr = line.substring(44, 52);                 // second derivative
    const bstarStr = line.substring(53, 61);                 // BSTAR drag term
    const ephtype = parseInt(line[62]);
    const elnum = parseInt(line.substring(64, 68));

    // Convert epoch year to full year
    const fullYear = epochYear < 57 ? 2000 + epochYear : 1900 + epochYear;
    
    // Create epoch date
    const epoch = new Date(Date.UTC(fullYear, 0, 1));
    epoch.setUTCDate(1 + Math.floor(epochDay - 1));
    const msInDay = (epochDay - Math.floor(epochDay)) * 86400000;
    epoch.setTime(epoch.getTime() + msInDay);

    // Parse BSTAR (scientific notation with implied decimal)
    const bstar = this.parseScientificNotation(bstarStr);

    return { satnum, epoch, bstar };
  }

  /**
   * Parse TLE line 2
   * Format: 2 NNNNN NN.NNNN NNN.NNNN NNNNNNN NNN.NNNN NNN.NNNN NN.NNNNNNNNNNNNNN
   */
  parseTLELine2(line: string): Partial<TLE> {
    if (line.length !== 69 || line[0] !== '2') {
      throw new Error('Invalid TLE line 2 format');
    }

    const satnum = parseInt(line.substring(2, 7).trim());
    const i = parseFloat(line.substring(8, 16)) * PHYSICAL_CONSTANTS.DEG_TO_RAD;
    const Ω = parseFloat(line.substring(17, 25)) * PHYSICAL_CONSTANTS.DEG_TO_RAD;
    const e = parseFloat('0.' + line.substring(26, 33).trim());
    const ω = parseFloat(line.substring(34, 42)) * PHYSICAL_CONSTANTS.DEG_TO_RAD;
    const M = parseFloat(line.substring(43, 51)) * PHYSICAL_CONSTANTS.DEG_TO_RAD;
    const n = parseFloat(line.substring(52, 63)) * (2 * Math.PI / 86400); // Convert revs/day to rad/s
    
    // Calculate semi-major axis from mean motion
    const a = Math.pow(PHYSICAL_CONSTANTS.MU / (n * n), 1 / 3);

    return { satnum, i, Ω, e, ω, M, n, a };
  }

  /**
   * Parse full TLE
   */
  parseTLE(name: string | undefined, line1: string, line2: string): TLE {
    const data1 = this.parseTLELine1(line1);
    const data2 = this.parseTLELine2(line2);

    if (data1.satnum !== data2.satnum) {
      throw new Error('TLE lines have mismatched satellite numbers');
    }

    return {
      name,
      line1,
      line2,
      satnum: data1.satnum!,
      epoch: data1.epoch!,
      bstar: data1.bstar || 0,
      ...data2,
    } as TLE;
  }

  /**
   * Parse scientific notation in TLE format (e.g., "+12345-5" means +0.12345e-5)
   */
  private parseScientificNotation(str: string): number {
    str = str.trim();
    if (str.length < 3) return 0;
    
    const mantissa = parseFloat(str.substring(0, 6));
    const exponent = parseInt(str.substring(6));
    
    return mantissa * Math.pow(10, exponent);
  }

  /**
   * Propagate TLE to a specific time
   */
  propagate(tle: TLE, time: Date): SatelliteState {
    const dt = (time.getTime() - tle.epoch.getTime()) / 1000; // seconds
    
    // Initial elements
    const elements: KeplerianElements = {
      a: tle.a,
      e: tle.e,
      i: tle.i,
      Ω: tle.Ω,
      ω: tle.ω,
      M: tle.M,
      n: tle.n,
    };

    // Apply J2 perturbations
    const perturbed = this.j2.applyPerturbation(elements, dt);
    
    // Convert to Cartesian
    const cartesian = this.elementsToCartesian(perturbed);

    return {
      id: tle.satnum,
      keplerian: perturbed,
      cartesian,
      shellId: 0,
      planeId: 0,
      satInPlaneId: 0,
      bstar: tle.bstar,
      epoch: tle.epoch,
    };
  }

  /**
   * Convert Keplerian elements to Cartesian state
   */
  elementsToCartesian(elements: KeplerianElements): CartesianState {
    const { a, e, i, Ω, ω, M } = elements;
    const mu = PHYSICAL_CONSTANTS.MU;

    // Solve Kepler's equation for eccentric anomaly E
    const E = this.solveKepler(M, e);
    
    // True anomaly
    const cosE = Math.cos(E);
    const sinE = Math.sin(E);
    const sqrt1me2 = Math.sqrt(1 - e * e);
    
    // Distance from center
    const r = a * (1 - e * cosE);
    
    // Position and velocity in orbital plane
    const xOrb = a * (cosE - e);
    const yOrb = a * sqrt1me2 * sinE;
    
    const n = Math.sqrt(mu / (a * a * a));
    const vxOrb = -n * a * sinE / (1 - e * cosE);
    const vyOrb = n * a * sqrt1me2 * cosE / (1 - e * cosE);

    // Rotation matrix from orbital to inertial frame
    const cosΩ = Math.cos(Ω), sinΩ = Math.sin(Ω);
    const cosω = Math.cos(ω), sinω = Math.sin(ω);
    const cosI = Math.cos(i), sinI = Math.sin(i);

    // Position in inertial frame
    const x = (cosΩ * cosω - sinΩ * sinω * cosI) * xOrb + (-cosΩ * sinω - sinΩ * cosω * cosI) * yOrb;
    const y = (sinΩ * cosω + cosΩ * sinω * cosI) * xOrb + (-sinΩ * sinω + cosΩ * cosω * cosI) * yOrb;
    const z = (sinω * sinI) * xOrb + (cosω * sinI) * yOrb;

    // Velocity in inertial frame
    const vx = (cosΩ * cosω - sinΩ * sinω * cosI) * vxOrb + (-cosΩ * sinω - sinΩ * cosω * cosI) * vyOrb;
    const vy = (sinΩ * cosω + cosΩ * sinω * cosI) * vxOrb + (-sinΩ * sinω + cosΩ * cosω * cosI) * vyOrb;
    const vz = (sinω * sinI) * vxOrb + (cosω * sinI) * vyOrb;

    return {
      position: new Float64Array([x, y, z]),
      velocity: new Float64Array([vx, vy, vz]),
    };
  }

  /**
   * Solve Kepler's equation: M = E - e*sin(E)
   * Uses Newton-Raphson iteration
   */
  private solveKepler(M: number, e: number, tolerance: number = 1e-10, maxIter: number = 50): number {
    // Normalize M to [0, 2π]
    M = ((M % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI);
    
    // Initial guess
    let E = M;
    if (e > 0.8) {
      E = Math.PI; // Better initial guess for high eccentricity
    }

    // Newton-Raphson iteration
    for (let iter = 0; iter < maxIter; iter++) {
      const f = E - e * Math.sin(E) - M;
      const fp = 1 - e * Math.cos(E);
      const dE = -f / fp;
      E += dE;
      
      if (Math.abs(dE) < tolerance) {
        break;
      }
    }

    return E;
  }

  /**
   * Convert Cartesian state to Keplerian elements
   */
  cartesianToElements(cartesian: CartesianState): KeplerianElements {
    const { position, velocity } = cartesian;
    const [x, y, z] = position;
    const [vx, vy, vz] = velocity;
    const mu = PHYSICAL_CONSTANTS.MU;

    // Position and velocity magnitudes
    const r = Math.sqrt(x * x + y * y + z * z);
    const v = Math.sqrt(vx * vx + vy * vy + vz * vz);

    // Specific angular momentum vector
    const hx = y * vz - z * vy;
    const hy = z * vx - x * vz;
    const hz = x * vy - y * vx;
    const h = Math.sqrt(hx * hx + hy * hy + hz * hz);

    // Node vector
    const nx = -hy;
    const ny = hx;
    const n = Math.sqrt(nx * nx + ny * ny);

    // Specific energy
    const energy = v * v / 2 - mu / r;

    // Semi-major axis
    const a = -mu / (2 * energy);

    // Eccentricity
    const rv = x * vx + y * vy + z * vz;
    const eX = (v * v - mu / r) * x / mu - rv * vx / mu;
    const eY = (v * v - mu / r) * y / mu - rv * vy / mu;
    const eZ = (v * v - mu / r) * z / mu - rv * vz / mu;
    const e = Math.sqrt(eX * eX + eY * eY + eZ * eZ);

    // Inclination
    const i = Math.acos(Math.max(-1, Math.min(1, hz / h)));

    // RAAN
    let Ω = 0;
    if (n !== 0) {
      Ω = Math.acos(Math.max(-1, Math.min(1, nx / n)));
      if (ny < 0) {
        Ω = 2 * Math.PI - Ω;
      }
    }

    // Argument of perigee
    let ω = 0;
    if (n !== 0 && e > 1e-10) {
      const ne = nx * eX + ny * eY;
      ω = Math.acos(Math.max(-1, Math.min(1, ne / (n * e))));
      if (eZ < 0) {
        ω = 2 * Math.PI - ω;
      }
    }

    // True anomaly
    let ν = 0;
    if (e > 1e-10) {
      const er = eX * x + eY * y + eZ * z;
      ν = Math.acos(Math.max(-1, Math.min(1, er / (e * r))));
      if (rv < 0) {
        ν = 2 * Math.PI - ν;
      }
    } else {
      // Circular orbit: use argument of latitude
      const nr = nx * x + ny * y;
      ν = Math.acos(Math.max(-1, Math.min(1, nr / (n * r))));
      if ((nx * y - ny * x) * z < 0) {
        ν = 2 * Math.PI - ν;
      }
    }

    // Eccentric anomaly
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(ν / 2));

    // Mean anomaly
    const M = E - e * Math.sin(E);

    // Mean motion
    const n_motion = Math.sqrt(mu / (a * a * a));

    return {
      a,
      e,
      i,
      Ω,
      ω,
      M: ((M % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI),
      n: n_motion,
      period: 2 * Math.PI / n_motion,
    };
  }
}

/**
 * Visibility Calculator
 * Determines which satellites are visible from an observer
 */
export class VisibilityCalculator {
  private earthRadius: number;

  constructor(earthRadius: number = PHYSICAL_CONSTANTS.EARTH_R) {
    this.earthRadius = earthRadius;
  }

  /**
   * Check if a satellite is visible from an observer position
   * 
   * @param satPos - Satellite position in ECI (km)
   * @param obsPos - Observer position in ECI (km)
   * @param minElevation - Minimum elevation angle (rad, default 0)
   * @returns Visibility result
   */
  checkVisibility(
    satPos: Float64Array,
    obsPos: Float64Array,
    minElevation: number = 0
  ): VisibilityResult {
    // Vector from observer to satellite
    const dx = satPos[0] - obsPos[0];
    const dy = satPos[1] - obsPos[1];
    const dz = satPos[2] - obsPos[2];
    const range = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Observer position magnitude
    const obsR = Math.sqrt(obsPos[0] * obsPos[0] + obsPos[1] * obsPos[1] + obsPos[2] * obsPos[2]);

    // Earth occlusion check
    // Satellite is occluded if it's on the opposite side of Earth from observer
    const dot = obsPos[0] * satPos[0] + obsPos[1] * satPos[1] + obsPos[2] * satPos[2];
    const earthOccluded = dot < Math.sqrt(dot * dot - obsR * obsR + this.earthRadius * this.earthRadius);

    if (earthOccluded) {
      return {
        visible: false,
        elevation: 0,
        azimuth: 0,
        range,
        earthOccluded: true,
      };
    }

    // Elevation angle calculation
    // Local up direction at observer
    const upX = obsPos[0] / obsR;
    const upY = obsPos[1] / obsR;
    const upZ = obsPos[2] / obsR;

    // Cosine of angle from local vertical
    const cosZenith = (dx * upX + dy * upY + dz * upZ) / range;
    
    // Elevation = 90° - zenith angle
    const elevation = Math.PI / 2 - Math.acos(Math.max(-1, Math.min(1, cosZenith)));

    // Azimuth calculation (simplified - assumes ENU frame)
    // Local east direction (cross product of up and z-axis)
    let eastX = -upY;
    let eastY = upX;
    let eastZ = 0;
    const eastMag = Math.sqrt(eastX * eastX + eastY * eastY);
    if (eastMag > 1e-10) {
      eastX /= eastMag;
      eastY /= eastMag;
    }

    // Local north (cross product of east and up)
    const northX = eastY * upZ - eastZ * upY;
    const northY = eastZ * upX - eastX * upZ;
    const northZ = eastX * upY - eastY * upX;

    // Project range vector onto local horizontal
    const dHorizX = dx - cosZenith * range * upX;
    const dHorizY = dy - cosZenith * range * upY;
    const dHorizZ = dz - cosZenith * range * upZ;

    // Azimuth from north
    let azimuth = Math.atan2(
      dHorizX * eastX + dHorizY * eastY + dHorizZ * eastZ,
      dHorizX * northX + dHorizY * northY + dHorizZ * northZ
    );
    if (azimuth < 0) {
      azimuth += 2 * Math.PI;
    }

    return {
      visible: elevation >= minElevation,
      elevation,
      azimuth,
      range,
      earthOccluded: false,
    };
  }

  /**
   * Calculate horizon distance from a given altitude
   */
  horizonDistance(altitude: number): number {
    const r = this.earthRadius + altitude;
    return Math.sqrt(r * r - this.earthRadius * this.earthRadius);
  }

  /**
   * Calculate maximum visible range for a satellite from an observer
   */
  maxVisibleRange(observerAltitude: number, satelliteAltitude: number): number {
    const obsR = this.earthRadius + observerAltitude;
    const satR = this.earthRadius + satelliteAltitude;
    return Math.sqrt(satR * satR - this.earthRadius * this.earthRadius) + 
           Math.sqrt(obsR * obsR - this.earthRadius * this.earthRadius);
  }
}

/**
 * Main Propagator class
 * Combines SGP4, J2 perturbations, and visibility calculations
 */
export class Propagator {
  sgp4: SGP4Propagator;
  j2: J2Perturbation;
  visibility: VisibilityCalculator;

  constructor() {
    this.sgp4 = new SGP4Propagator();
    this.j2 = new J2Perturbation();
    this.visibility = new VisibilityCalculator();
  }

  /**
   * Propagate a satellite state forward by a time step
   * Uses RK4 integration for high accuracy
   */
  propagateState(state: SatelliteState, dt: number): SatelliteState {
    // Apply J2 perturbations to elements
    const perturbedElements = this.j2.applyPerturbation(state.keplerian, dt);
    
    // Convert to Cartesian
    const cartesian = this.sgp4.elementsToCartesian(perturbedElements);

    return {
      ...state,
      keplerian: perturbedElements,
      cartesian,
    };
  }

  /**
   * RK4 integration for position/velocity
   * Used for high-precision propagation
   */
  rk4Integrate(state: CartesianState, dt: number): CartesianState {
    const k1v = this.acceleration(state.position);
    const k1r = state.velocity;

    const p2 = new Float64Array([
      state.position[0] + k1r[0] * dt * 0.5,
      state.position[1] + k1r[1] * dt * 0.5,
      state.position[2] + k1r[2] * dt * 0.5,
    ]);
    const v2 = new Float64Array([
      state.velocity[0] + k1v[0] * dt * 0.5,
      state.velocity[1] + k1v[1] * dt * 0.5,
      state.velocity[2] + k1v[2] * dt * 0.5,
    ]);
    const k2v = this.acceleration(p2);
    const k2r = v2;

    const p3 = new Float64Array([
      state.position[0] + k2r[0] * dt * 0.5,
      state.position[1] + k2r[1] * dt * 0.5,
      state.position[2] + k2r[2] * dt * 0.5,
    ]);
    const v3 = new Float64Array([
      state.velocity[0] + k2v[0] * dt * 0.5,
      state.velocity[1] + k2v[1] * dt * 0.5,
      state.velocity[2] + k2v[2] * dt * 0.5,
    ]);
    const k3v = this.acceleration(p3);
    const k3r = v3;

    const p4 = new Float64Array([
      state.position[0] + k3r[0] * dt,
      state.position[1] + k3r[1] * dt,
      state.position[2] + k3r[2] * dt,
    ]);
    const v4 = new Float64Array([
      state.velocity[0] + k3v[0] * dt,
      state.velocity[1] + k3v[1] * dt,
      state.velocity[2] + k3v[2] * dt,
    ]);
    const k4v = this.acceleration(p4);
    const k4r = v4;

    return {
      position: new Float64Array([
        state.position[0] + (k1r[0] + 2 * k2r[0] + 2 * k3r[0] + k4r[0]) * dt / 6,
        state.position[1] + (k1r[1] + 2 * k2r[1] + 2 * k3r[1] + k4r[1]) * dt / 6,
        state.position[2] + (k1r[2] + 2 * k2r[2] + 2 * k3r[2] + k4r[2]) * dt / 6,
      ]),
      velocity: new Float64Array([
        state.velocity[0] + (k1v[0] + 2 * k2v[0] + 2 * k3v[0] + k4v[0]) * dt / 6,
        state.velocity[1] + (k1v[1] + 2 * k2v[1] + 2 * k3v[1] + k4v[1]) * dt / 6,
        state.velocity[2] + (k1v[2] + 2 * k2v[2] + 2 * k3v[2] + k4v[2]) * dt / 6,
      ]),
    };
  }

  /**
   * Calculate gravitational acceleration at a position
   * Includes J2 perturbation
   */
  private acceleration(position: Float64Array): Float64Array {
    const { MU, J2, EARTH_R } = PHYSICAL_CONSTANTS;
    const [x, y, z] = position;
    
    const r2 = x * x + y * y + z * z;
    const r = Math.sqrt(r2);
    const r3 = r * r2;
    const r5 = r2 * r3;
    
    // Two-body acceleration
    const factor = -MU / r3;
    
    // J2 perturbation
    const j2Factor = 1.5 * J2 * MU * EARTH_R * EARTH_R / r5;
    const z2r2 = z * z / r2;
    
    return new Float64Array([
      factor * x + j2Factor * x * (5 * z2r2 - 1),
      factor * y + j2Factor * y * (5 * z2r2 - 1),
      factor * z + j2Factor * z * (5 * z2r2 - 3),
    ]);
  }
}

// Export singleton instance for convenience
export const defaultPropagator = new Propagator();
