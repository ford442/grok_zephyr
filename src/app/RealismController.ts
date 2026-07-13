import type { AppRuntime } from '@/app/AppRuntime.js';

/** Enable or disable SGP4-anchored Keplerian realism (requires loaded TLE catalog). */
export function setRealismMode(rt: AppRuntime, enabled: boolean): void {
  if (enabled && !rt.simulation.hasTleCatalog) {
    console.warn('[GrokZephyr] Orbit realism requires a loaded TLE catalog (?tle=...)');
    rt.ui.setRealismControls(false, false);
    return;
  }

  rt.simulation.realismMode = enabled;
  rt.buffers?.setRealismEnabled(enabled, rt.simulation.simTime);

  if (rt.simulation.hasTleCatalog) {
    if (enabled) {
      rt.dataSourceLabel = rt.dataSourceLabel.replace(/^TLE\b/, 'TLE SGP4');
      if (!rt.dataSourceLabel.includes('SGP4')) {
        rt.dataSourceLabel = rt.dataSourceLabel.replace('TLE (', 'TLE SGP4 (');
      }
    } else {
      rt.dataSourceLabel = rt.dataSourceLabel.replace('TLE SGP4', 'TLE');
    }
    rt.ui.setDataSource(rt.dataSourceLabel);
  }

  rt.ui.setRealismControls(enabled, rt.simulation.hasTleCatalog);
  console.log(`🛰️ Orbit realism: ${enabled ? 'SGP4 catalog' : 'art-directed shells'}`);
}
