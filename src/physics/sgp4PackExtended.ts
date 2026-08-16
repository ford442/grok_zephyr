/**
 * Pack SGP4 ECI batch + Vallado error codes into the 8-float extended-element layout.
 */

import { eciStateToKeplerian } from './keplerianFromState.js';
import {
  EXTENDED_FLOATS_PER_SATELLITE,
  REALISM_FLAG_SGP4,
  writeKeplerianExtended,
} from './extendedElements.js';

export function packExtendedFromEciBatch(
  eci: Float32Array,
  errors: Int32Array,
  dest: Float32Array,
  destStartSat = 0,
): number {
  const limit = Math.min(errors.length, Math.floor(eci.length / 6));
  for (let i = 0; i < limit; i++) {
    const err = errors[i] ?? 0;
    const destIndex = destStartSat + i;
    if (err !== 0) {
      const base = destIndex * EXTENDED_FLOATS_PER_SATELLITE;
      dest.fill(0, base, base + 7);
      dest[base + 7] = -Math.abs(err);
      continue;
    }
    const b = i * 6;
    const state = eciStateToKeplerian(
      { x: eci[b], y: eci[b + 1], z: eci[b + 2] },
      { x: eci[b + 3], y: eci[b + 4], z: eci[b + 5] },
    );
    writeKeplerianExtended(dest, destIndex, state, REALISM_FLAG_SGP4);
  }
  return limit;
}
