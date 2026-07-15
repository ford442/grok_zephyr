import type { AppRuntime } from '@/app/AppRuntime.js';
import type { SkylineDisplayMode } from '@/render/SkylineCity.js';

const DISPLAY_LABELS = ['AUTO', 'LED', 'LASER', 'SPOTS', 'NEON', 'ALL'] as const;

export function setupSkylineDisplayButtons(rt: AppRuntime): void {
  const buttons = document.querySelectorAll('.skyline-display-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const mode = parseInt(target.dataset.display || '0', 10) as SkylineDisplayMode;
      setSkylineDisplayMode(rt, mode);
      buttons.forEach((b) => b.classList.remove('active'));
      target.classList.add('active');
    });
  });
}

export function setSkylineDisplayMode(rt: AppRuntime, mode: SkylineDisplayMode): void {
  if (mode < 0 || mode > 5) return;
  rt.simulation.skylineDisplayMode = mode;
  updateSkylineDisplayTitle(rt);
  console.log(`🏙️ Skyline displays: ${DISPLAY_LABELS[mode]}`);
}

export function updateSkylineDisplayTitle(rt: AppRuntime): void {
  const title = document.getElementById('skylineDisplayName');
  if (title) {
    title.textContent = `CITY DISPLAYS • ${DISPLAY_LABELS[rt.simulation.skylineDisplayMode]}`;
  }
}

export function updateSkylineDisplayControlsVisibility(rt: AppRuntime): void {
  const section = document.getElementById('skyline-display-controls');
  if (!section) return;
  section.style.display = rt.camera.getViewMode() === 'skyline' ? 'block' : 'none';
}
