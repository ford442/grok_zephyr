/**
 * Physics Module - Orbital Mechanics for Colossus Fleet
 * 
 * Main exports for the orbital propagation system.
 */

// Core propagator exports
export {
  Propagator,
  SGP4Propagator,
  J2Perturbation,
  VisibilityCalculator,
  PHYSICAL_CONSTANTS,
  STARLINK_SHELLS,
  defaultPropagator,
} from './Propagator';

export type {
  KeplerianElements,
  CartesianState,
  SatelliteState,
  TLE,
  VisibilityResult,
} from './Propagator';

// Constellation loader exports
export {
  ConstellationLoader,
  TLELoader,
  WalkerConstellationGenerator,
  CONSTELLATIONS,
  defaultLoader,
  createGPUBuffer,
  updateGPUBuffer,
} from '../data/ConstellationLoader';

export type {
  OrbitalShell,
  ConstellationConfig,
  GPUSatelliteData,
  ExtendedSatelliteData,
} from '../data/ConstellationLoader';

// Constants matching original simulation
export const SIMULATION_CONSTANTS = {
  NUM_SAT: 1048576,
  NUM_PLANES: 1024,
  SAT_PER_PLANE: 1024,
  EARTH_R: 6371.0,
  ORBIT_R: 6921.0,  // 550km altitude
  CAM_R: 7091.0,    // 720km camera altitude
  DEG_TO_RAD: Math.PI / 180,
  RAD_TO_DEG: 180 / Math.PI,
} as const;

/**
 * CPU-side satellite position calculation
 * Used for camera tracking and UI when GPU buffer isn't accessible
 * 
 * This implements the J2-perturbed orbital position calculation
 * matching the GPU shader implementation.
 */
export function calculateSatellitePosition(
  elements: KeplerianElements,
  time: number
): { position: Float64Array; velocity: Float64Array } {
  const { a, e, i, Ω, ω, M: M0, n } = elements;
  const mu = PHYSICAL_CONSTANTS.MU;
  const j2 = PHYSICAL_CONSTANTS.J2;
  const re = PHYSICAL_CONSTANTS.EARTH_R;

  // Apply J2 perturbations
  const p = a * (1 - e * e);
  const cosI = Math.cos(i);
  
  // Nodal precession rate: Ω̇ = -3/2 * J2 * (Re/p)² * n * cos(i)
  const omegaDot = -1.5 * j2 * Math.pow(re / p, 2) * n! * cosI;
  
  // Perigee precession rate: ω̇ = 3/4 * J2 * (Re/p)² * n * (5cos²(i) - 1)
  const perigeeDot = 0.75 * j2 * Math.pow(re / p, 2) * n! * (5 * cosI * cosI - 1);
  
  // Update elements
  const Ω_current = Ω + omegaDot * time;
  const ω_current = ω + perigeeDot * time;
  const M_current = M0 + n! * time;
  
  // Solve Kepler's equation
  let E = M_current;
  if (e > 0.8) E = Math.PI;
  
  for (let iter = 0; iter < 10; iter++) {
    const sinE = Math.sin(E);
    const cosE = Math.cos(E);
    const f = E - e * sinE - M_current;
    const fp = 1 - e * cosE;
    const dE = -f / fp;
    E += dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  
  // Position in orbital plane
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const sqrt1me2 = Math.sqrt(1 - e * e);
  const r = a * (1 - e * cosE);
  
  const xOrb = a * (cosE - e);
  const yOrb = a * sqrt1me2 * sinE;
  
  // Velocity in orbital plane
  const factor = Math.sqrt(mu * a) / r;
  const vxOrb = -factor * sinE;
  const vyOrb = factor * sqrt1me2 * cosE;
  
  // Rotation to inertial frame
  const cosΩ = Math.cos(Ω_current);
  const sinΩ = Math.sin(Ω_current);
  const cosω = Math.cos(ω_current);
  const sinω = Math.sin(ω_current);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);
  
  // Position
  const x = (cosΩ * cosω - sinΩ * sinω * cosI) * xOrb + (-cosΩ * sinω - sinΩ * cosω * cosI) * yOrb;
  const y = (sinΩ * cosω + cosΩ * sinω * cosI) * xOrb + (-sinΩ * sinω + cosΩ * cosω * cosI) * yOrb;
  const z = (sinω * sinI) * xOrb + (cosω * sinI) * yOrb;
  
  // Velocity
  const vx = (cosΩ * cosω - sinΩ * sinω * cosI) * vxOrb + (-cosΩ * sinω - sinΩ * cosω * cosI) * vyOrb;
  const vy = (sinΩ * cosω + cosΩ * sinω * cosI) * vxOrb + (-sinΩ * sinω + cosΩ * cosω * cosI) * vyOrb;
  const vz = (sinω * sinI) * vxOrb + (cosω * sinI) * vyOrb;
  
  return {
    position: new Float64Array([x, y, z]),
    velocity: new Float64Array([vx, vy, vz]),
  };
}

/**
 * Simplified position for circular orbits
 * Matches the original simulation's behavior
 */
export function calculateCircularOrbitPosition(
  radius: number,
  raan: number,
  inclination: number,
  meanAnomaly: number,
  time: number,
  meanMotion: number
): Float64Array {
  const M = meanAnomaly + meanMotion * time;
  const cM = Math.cos(M);
  const sM = Math.sin(M);
  const cR = Math.cos(raan);
  const sR = Math.sin(raan);
  const cI = Math.cos(inclination);
  const sI = Math.sin(inclination);
  
  return new Float64Array([
    radius * (cR * cM - sR * sM * cI),
    radius * (sR * cM + cR * sM * cI),
    radius * sM * sI,
  ]);
}

/**
 * Generate orbital elements for Walker constellation
 * With J2-perturbed precession
 */
export function generateWalkerConstellation(
  numPlanes: number,
  satsPerPlane: number,
  altitude: number,
  inclination: number,
  phasing: number = 1
): KeplerianElements[] {
  const a = PHYSICAL_CONSTANTS.EARTH_R + altitude;
  const i = inclination * SIMULATION_CONSTANTS.DEG_TO_RAD;
  const e = 0.0001;
  const n = Math.sqrt(PHYSICAL_CONSTANTS.MU / (a * a * a));
  const totalSats = numPlanes * satsPerPlane;
  
  const elements: KeplerianElements[] = [];
  
  for (let plane = 0; plane < numPlanes; plane++) {
    const Ω = (plane / numPlanes) * 2 * Math.PI;
    
    for (let sat = 0; sat < satsPerPlane; sat++) {
      const M = ((sat / satsPerPlane) + (phasing / totalSats) * plane) * 2 * Math.PI;
      
      elements.push({
        a,
        e,
        i,
        Ω,
        ω: 0,
        M: ((M % (2 * Math.PI)) + (2 * Math.PI)) % (2 * Math.PI),
        n,
        period: 2 * Math.PI / n,
      });
    }
  }
  
  return elements;
}

/**
 * Check if satellite is visible from camera position
 */
export function isSatelliteVisible(
  satPos: Float64Array,
  camPos: Float64Array,
  earthRadius: number = PHYSICAL_CONSTANTS.EARTH_R
): boolean {
  const dx = satPos[0] - camPos[0];
  const dy = satPos[1] - camPos[1];
  const dz = satPos[2] - camPos[2];
  
  // Distance check
  const distSq = dx * dx + dy * dy + dz * dz;
  if (distSq > 15000 * 15000) return false;
  
  // Earth occlusion check
  const camR = Math.sqrt(camPos[0] * camPos[0] + camPos[1] * camPos[1] + camPos[2] * camPos[2]);
  const dot = camPos[0] * satPos[0] + camPos[1] * satPos[1] + camPos[2] * satPos[2];
  
  // Check if behind Earth
  const horizonDist = Math.sqrt(camR * camR - earthRadius * earthRadius);
  const satDist = Math.sqrt(distSq);
  
  return dot > -horizonDist * satDist;
}

/**
 * Format satellite count for display
 */
export function formatSatelliteCount(count: number): string {
  if (count >= 1000000) {
    return (count / 1000000).toFixed(2) + 'M';
  } else if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return count.toString();
}

/**
 * Calculate horizon distance from altitude
 */
export function calculateHorizonDistance(altitude: number): number {
  const r = PHYSICAL_CONSTANTS.EARTH_R + altitude;
  return Math.sqrt(r * r - PHYSICAL_CONSTANTS.EARTH_R * PHYSICAL_CONSTANTS.EARTH_R);
}

/**
 * Physics mode enumeration matching GPU shader
 */
export enum PhysicsMode {
  SIMPLE = 0,      // Basic circular orbit
  J2_PERTURBED = 1, // J2 precession only
  RK4_INTEGRATED = 2, // Full RK4 integration
}

/**
 * Visibility level enumeration matching GPU shader
 */
export enum VisibilityLevel {
  OCCLUDED = 0,
  LOW_DETAIL = 1,
  FULL_DETAIL = 2,
}
