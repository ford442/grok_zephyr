import { TLELoader } from '@/data/TLELoader.js';
import { getTLESource } from '@/data/tleSource.js';
import { CONSTANTS } from '@/types/constants.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

/** Load procedural or TLE orbital elements into the active satellite buffer. */
export async function loadSatelliteOrbitalData(rt: AppRuntime): Promise<string> {
  if (!rt.buffers) {
    throw new Error('SatelliteGPUBuffer must be initialized before loading orbital data');
  }

  const tleSource = getTLESource();
  let dataSourceLabel = 'Procedural Walker';

  if (tleSource) {
    try {
      console.log(`[GrokZephyr] Loading TLE data from: ${tleSource}`);
      const tles = await TLELoader.fromFile(tleSource);
      if (tles.length > 0) {
        const realTLECount = rt.buffers.loadFromTLEData(tles);
        dataSourceLabel = `TLE (${realTLECount.toLocaleString()} real)`;
        console.log(
          `[GrokZephyr] Loaded ${realTLECount} TLE satellites, padded to ${CONSTANTS.NUM_SATELLITES.toLocaleString()}`,
        );
      } else {
        console.warn('[GrokZephyr] TLE source returned 0 records, falling back to procedural');
        rt.buffers.generateOrbitalElements();
      }
    } catch (err) {
      console.warn(
        '[GrokZephyr] TLE fetch/parse failed, falling back to procedural generation:',
        err,
      );
      rt.buffers.generateOrbitalElements();
    }
  } else {
    rt.buffers.generateOrbitalElements();
  }

  rt.buffers.uploadOrbitalElements();
  rt.ui.setDataSource(dataSourceLabel);
  rt.dataSourceLabel = dataSourceLabel;
  return dataSourceLabel;
}
