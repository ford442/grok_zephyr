import type { GroundObserverPreset } from '@/camera/GroundObserverCamera.js';
import type { AppRuntime } from '@/app/AppRuntime.js';

export function setupGroundPresetButtons(rt: AppRuntime): void {
  const presetButtons = document.querySelectorAll('.preset-btn');
  presetButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const preset = target.dataset.preset as GroundObserverPreset;
      if (!preset) return;

      rt.groundObserver.setPreset(preset);
      rt.applyGroundOverlayClass(rt.groundObserver.getOverlayClass());
      rt.applyGroundPresetEffects(0);

      presetButtons.forEach((b) => b.classList.remove('active'));
      target.classList.add('active');
    });
  });
}

export function setupTAAToggle(rt: AppRuntime): void {
  const btn = document.getElementById('taaToggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    rt.taaEnabled = !rt.taaEnabled;
    rt.postProcessStack?.enableTAA(rt.taaEnabled);
    btn.textContent = rt.taaEnabled ? 'TAA ON' : 'TAA OFF';
    btn.classList.toggle('active', rt.taaEnabled);
    console.log(`🔲 TAA: ${rt.taaEnabled ? 'enabled' : 'disabled'}`);
  });
  btn.textContent = rt.taaEnabled ? 'TAA ON' : 'TAA OFF';
  btn.classList.toggle('active', rt.taaEnabled);
}

export function updateGroundObserverOverlay(rt: AppRuntime): void {
  const overlay = document.getElementById('ground-observer-overlay');
  const presetSelector = document.getElementById('ground-preset-selector');
  const viewMode = rt.camera.getViewMode();
  const isGround = viewMode === 'ground';
  const isSkyline = viewMode === 'skyline';

  if (overlay) overlay.style.display = (isGround || isSkyline) ? 'block' : 'none';
  if (presetSelector) presetSelector.style.display = isGround ? 'flex' : 'none';

  if (isGround) {
    rt.applyGroundOverlayClass(rt.groundObserver.getOverlayClass());
  } else if (isSkyline) {
    rt.applyGroundOverlayClass('frame-skyline');
  }
}

export function applyGroundOverlayClass(_rt: AppRuntime, overlayClass: string): void {
  const overlay = document.getElementById('ground-observer-overlay');
  if (!overlay) return;
  for (const cls of Array.from(overlay.classList)) {
    if (cls.startsWith('frame-')) overlay.classList.remove(cls);
  }
  overlay.classList.add(overlayClass);
}

export function syncTaaToggleUi(rt: AppRuntime): void {
  const btn = document.getElementById('taaToggle');
  if (!btn) return;
  btn.textContent = rt.taaEnabled ? 'TAA ON' : 'TAA OFF';
  btn.classList.toggle('active', rt.taaEnabled);
}
