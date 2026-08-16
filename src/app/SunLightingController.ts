import type { AppRuntime } from '@/app/AppRuntime.js';
import { persistSunMode, type SunLightingMode } from '@/physics/sun.js';

export function setSunLightingMode(rt: AppRuntime, mode: SunLightingMode): void {
  rt.simulation.sunMode = mode;
  persistSunMode(mode);
  rt.ui.setActiveSunButton(mode);
  console.log(`☀️ Sun lighting: ${mode === 'astro' ? 'Astro (UTC geometric)' : 'Art (cinematic XY)'}`);
}
