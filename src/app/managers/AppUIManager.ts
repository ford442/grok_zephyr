
import { GrokZephyrApp } from '@/app/GrokZephyrApp.js';
import { getBeamPatternTitle } from '@/patterns.js';
import { type QualityLevel } from '@/core/QualityPresets.js';
import { type TonemapMode } from '@/render/RenderPipeline.js';
import { clamp } from '@/app/constants.js';

export class AppUIManager {
  constructor(private app: GrokZephyrApp) {}

  public setupTAAToggle(): void {
    this.app.ui.onTAAToggle((enabled) => {
      this.app.setTAAEnabled(enabled);
      this.app.applyQualityPreset(this.app.currentQualityLevel);
    });
  }

  public setupGroundPresetButtons(): void {
    const buttons = document.querySelectorAll('.ground-preset-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        const presetName = target.dataset.preset;
        if (!presetName) return;

        buttons.forEach((b) => b.classList.remove('active'));
        target.classList.add('active');

        this.app.audio.playClick();
        this.app.groundObserver.setPreset(presetName as any);
        this.updateGroundObserverOverlay();
      });
    });
  }

  public setupPatternButtons(): void {
    const buttons = document.querySelectorAll('.pattern-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        const mode = parseInt(target.dataset.mode || '0', 10);

        if (this.shouldPlayButtonTick(target)) {
          this.app.audio.playTick();
        } else {
          this.app.audio.playClick();
        }

        buttons.forEach((b) => b.classList.remove('active'));
        target.classList.add('active');

        this.app.patternMode = mode;
        this.app.patternSeed = Math.random();
        this.app.patternAnimationStart = performance.now() * 0.001;

        if (mode > 0 && this.app.camera.getViewModeName() === 'fleet') {
          this.app.camera.setViewMode(1);
          this.app.ui.setViewMode('god', 25000);
          this.app.ui.setActiveButton(1);
          this.app.audio.setViewMode('god');
        }

        this.updatePatternTitle();
        this.app.writePatternParamsBuffer();
      });
    });
  }

  public setupAnimationPatternButtons(): void {
    const buttons = document.querySelectorAll('.animation-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        const mode = parseInt(target.dataset.mode || '0', 10);

        if (this.shouldPlayButtonTick(target)) {
          this.app.audio.playTick();
        } else {
          this.app.audio.playClick();
        }

        buttons.forEach((b) => b.classList.remove('active'));
        target.classList.add('active');

        this.app.animationMode = mode;
        this.app.animationSeed = Math.random();
        this.app.animationStart = performance.now() * 0.001;

        if (mode === 3 && this.app.camera.getViewModeName() === 'fleet') {
          this.app.camera.setViewMode(1);
          this.app.ui.setViewMode('god', 25000);
          this.app.ui.setActiveButton(1);
          this.app.audio.setViewMode('god');
        }

        this.app.writePatternParamsBuffer();
      });
    });
  }

  public setupPhysicsButtons(): void {
    const buttons = document.querySelectorAll('.physics-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLButtonElement;
        const mode = parseInt(target.dataset.mode || '0', 10);

        if (this.shouldPlayButtonTick(target)) {
          this.app.audio.playTick();
        } else {
          this.app.audio.playClick();
        }

        buttons.forEach((b) => b.classList.remove('active'));
        target.classList.add('active');

        this.app.physicsMode = mode;

        if (mode === 1) {
          const wasCinematic = this.app.camera.isCinematicActive();
          this.app.camera.setViewMode(1);
          this.app.ui.setViewMode('god', 25000);
          this.app.ui.setActiveButton(1);
          this.app.audio.setViewMode('god');

          if (wasCinematic) {
            this.app.camera.startCinematic(performance.now() * 0.001);
          }
        }
      });
    });
  }

  public shouldPlayButtonTick(button: HTMLButtonElement): boolean {
    const isPhysics = button.classList.contains('physics-btn');
    const isQuality = button.classList.contains('quality-btn');
    if (isPhysics || isQuality) return true;
    return false;
  }

  public updateGroundObserverOverlay(): void {
    const overlay = document.getElementById('ground-observer-overlay');
    if (!overlay) return;

    if (this.app.camera.getViewModeName() === 'horizon') {
      overlay.classList.add('visible');
      const preset = this.app.groundObserver.getPreset();
      for (const cls of Array.from(overlay.classList)) {
        if (cls.startsWith('frame-')) overlay.classList.remove(cls);
      }
      overlay.classList.add(`frame-${preset.frameClass}`);
    } else {
      overlay.classList.remove('visible');
    }
  }

  public updatePatternTitle(): void {
    if (!this.app.patternNameDisplay) return;
    this.app.patternNameDisplay.textContent = this.app.patternMode > 0 ? getBeamPatternTitle(this.app.patternMode) : '';
    this.app.patternNameDisplay.style.opacity = this.app.patternMode > 0 ? '1' : '0';
  }
}
