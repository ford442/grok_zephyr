/**
 * CPU position/velocity matching compute/orbital.ts (simple / Keplerian / J2).
 */

import {
  PHYSICS_MODE,
  propagateKeplerian,
  propagateKeplerianJ2,
  readKeplerianExtended,
} from '@/physics/index.js';
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
  },
): [number, number, number] {
  if (options.inactive) {
    return [1e8, 1e8, 1e8];
  }
  const ext = readKeplerianExtended(options.extendedElementData, index);
  const useSgp4 = options.realismEnabled && ext.realismFlag > 0.5;
  const useKepler = options.physicsMode >= PHYSICS_MODE.KEPLERIAN || useSgp4;
  if (useKepler) {
    if (options.physicsMode === PHYSICS_MODE.J2) {
      return propagateKeplerianJ2(ext, time);
    }
    return propagateKeplerian(ext, time);
  }
  return options.orbital.calculatePosition(index, time);
}
