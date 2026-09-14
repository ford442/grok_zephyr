/**
 * CPU position/velocity matching compute/orbital.ts (simple / Keplerian / J2).
 */

import {
  PHYSICS_MODE,
  propagateKeplerian,
  propagateKeplerianJ2,
  readKeplerianExtended,
} from '@/physics/index.js';
import { propagateSgp4GpuSlot } from '@/physics/sgp4NearEarth.js';
import type { OrbitalElements } from '@/core/OrbitalElements.js';

export function calculateCpuSatellitePosition(
  index: number,
  time: number,
  options: {
    inactive: boolean;
    extendedElementData: Float32Array;
    realismEnabled: boolean;
    physicsMode: number;
    orbital: OrbitalElements;
    /** Physics mode 3 GPU records (sgp4NearEarth layout); mirrors the WGSL kernel. */
    gpuSgp4Data?: Float32Array;
  },
): [number, number, number] {
  if (options.inactive) {
    return [1e8, 1e8, 1e8];
  }
  if (
    options.physicsMode === PHYSICS_MODE.SGP4 &&
    options.realismEnabled &&
    options.gpuSgp4Data
  ) {
    const p = propagateSgp4GpuSlot(options.gpuSgp4Data, index, time);
    if (p) return p;
  }
  const ext = readKeplerianExtended(options.extendedElementData, index);
  const useSgp4 = options.realismEnabled && ext.realismFlag > 0.5;
  const useKepler = options.physicsMode >= PHYSICS_MODE.KEPLERIAN || useSgp4;
  if (useKepler) {
    if (options.physicsMode >= PHYSICS_MODE.J2) {
      return propagateKeplerianJ2(ext, time);
    }
    return propagateKeplerian(ext, time);
  }
  return options.orbital.calculatePosition(index, time);
}
