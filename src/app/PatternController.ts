import { getBeamPatternTitle } from '@/patterns.js';
import type { FocusSelection } from '@/focus.js';
import type { AppRuntime } from '@/app/AppRuntime.js';
import { syncVolumetricBeamConfig } from '@/app/QualityController.js';

export function setupPatternButtons(rt: AppRuntime): void {
  const patternButtons = document.querySelectorAll('.pbtn');
  patternButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const mode = parseInt(target.dataset.pattern || '1');
      rt.setPatternMode(mode);
      patternButtons.forEach((b) => b.classList.remove('active'));
      target.classList.add('active');
    });
  });
}

export function setupAnimationPatternButtons(rt: AppRuntime): void {
  const animButtons = document.querySelectorAll('.anim-btn');
  animButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const mode = parseInt(target.dataset.pattern || '3');
      rt.setAnimationPattern(mode);
      animButtons.forEach((b) => b.classList.remove('active'));
      if (rt.currentAnimationPattern !== 0) {
        target.classList.add('active');
      }
    });
  });
}

export function setupPhysicsButtons(rt: AppRuntime): void {
  const physicsButtons = document.querySelectorAll('.physics-btn:not(.disabled)');
  physicsButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const mode = parseInt(target.dataset.physics || '0');
      rt.setPhysicsMode(mode);
      physicsButtons.forEach((b) => b.classList.remove('active'));
      target.classList.add('active');
    });
  });
}

export function setPatternMode(rt: AppRuntime, mode: number): void {
  rt.currentPatternMode = mode;
  rt.patternAnimationStart = performance.now() / 1000;

  if (!rt.context || !rt.buffers) {
    updatePatternTitle(rt);
    return;
  }

  const beamParamsData = new ArrayBuffer(16);
  const f32 = new Float32Array(beamParamsData);
  const u32 = new Uint32Array(beamParamsData);

  f32[0] = rt.patternAnimationStart;
  u32[1] = mode;
  u32[2] = 65536;
  u32[3] = 0;

  rt.context.writeBuffer(rt.buffers.getBuffers().beamParams, beamParamsData);
  writePatternParamsBuffer(rt);
  updatePatternTitle(rt);
  rt.audio.playPatternChange(mode);
  syncVolumetricBeamConfig(rt);

  const modeNames = ['CHAOS', 'GROK', '𝕏 LOGO'];
  console.log(`🔄 Beam pattern switched to: ${modeNames[mode]}`);
}

export function setAnimationPattern(rt: AppRuntime, mode: number): void {
  if (rt.currentAnimationPattern === mode) {
    mode = 0;
  }

  rt.currentAnimationPattern = mode;
  rt.patternAnimationStart = performance.now() / 1000;

  const modeNames = ['OFF', '', '', '😊 SMILE', '💧 DIGITAL RAIN', '💓 HEARTBEAT'];
  console.log(`🎭 Animation pattern: ${modeNames[mode]}`);

  if (!rt.context || !rt.buffers) return;
  writePatternParamsBuffer(rt);
}

export function setPhysicsMode(rt: AppRuntime, mode: number): void {
  if (mode < 0 || mode > 2) {
    console.warn(`Invalid physics mode: ${mode}`);
    return;
  }

  rt.currentPhysicsMode = mode;

  const modeNames = ['Simple (Circular)', 'Keplerian', 'J2 Perturbed'];
  const implemented = [true, true, false];

  console.log(`⚛️ Physics mode switched to: ${modeNames[mode]} ${implemented[mode] ? '' : '(placeholder)'}`);
}

export function writePatternParamsBuffer(rt: AppRuntime): void {
  if (!rt.context || !rt.buffers) return;

  const patternParamsData = new ArrayBuffer(16);
  const f32 = new Float32Array(patternParamsData);
  const u32 = new Uint32Array(patternParamsData);

  u32[0] = rt.currentAnimationPattern;
  f32[1] = rt.patternAnimationStart || performance.now() / 1000;
  f32[2] = rt.patternSeed;
  u32[3] = rt.selectedSatelliteIndex >= 0 ? rt.selectedSatelliteIndex : 0xFFFFFFFF;

  rt.context.writeBuffer(rt.buffers.getBuffers().patternParams, patternParamsData);
}

export function updatePatternTitle(rt: AppRuntime): void {
  if (rt.patternNameDisplay) {
    rt.patternNameDisplay.textContent = getBeamPatternTitle(rt.currentPatternMode);
  }
}

export function updateSelectedSatelliteIndex(rt: AppRuntime, index: number): void {
  rt.selectedSatelliteIndex = index;
  writePatternParamsBuffer(rt);
}

export function handleFocusSelectionChange(rt: AppRuntime, selection: FocusSelection | null): void {
  updateSelectedSatelliteIndex(rt, selection?.index ?? -1);
  if (selection) {
    rt.audio.playFocusChime(selection.altitude);
  }
}

export function setGroundViewEnabled(rt: AppRuntime, enabled: boolean): void {
  rt.earthAtmosphereRenderer?.setEnabled(enabled);
  rt.pipeline?.setGroundTerrainEnabled(enabled);
}
