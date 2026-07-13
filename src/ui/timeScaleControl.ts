import type { UIElements } from '@/ui/uiTypes.js';
import type { SimClock } from '@/app/SimClock.js';
import {
  formatSimRate,
  formatSimUtc,
  SIM_RATE_PRESETS,
  SIM_STEP_SEC,
  TIMELINE_HALF_RANGE_MS,
} from '@/app/SimClock.js';

export interface SimTransportState {
  elements: UIElements;
  getClock(): SimClock;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function timelineUtcFromValue(value: number, wallNowMs: number): number {
  return wallNowMs - TIMELINE_HALF_RANGE_MS + value * TIMELINE_HALF_RANGE_MS * 2;
}

function timelineValueFromUtc(simUtcMs: number, wallNowMs: number): number {
  const min = wallNowMs - TIMELINE_HALF_RANGE_MS;
  const max = wallNowMs + TIMELINE_HALF_RANGE_MS;
  const clamped = Math.max(min, Math.min(max, simUtcMs));
  return (clamped - min) / (max - min);
}

export function createSimTransportControl(state: SimTransportState): void {
  const container = document.createElement('div');
  container.id = 'time-controls';
  container.className = 'time-controls';

  container.innerHTML = `
      <div class="time-label">⏱ SIM TIME</div>
      <div class="time-display" id="sim-time-display">Sim UTC: —</div>
      <div class="sim-transport-row">
        <button class="time-preset-btn sim-transport-btn" id="simPlayPause" type="button" aria-label="Play or pause simulation" title="Space">▶</button>
        <button class="time-preset-btn sim-transport-btn" id="simNowBtn" type="button" title="Jump to current UTC">NOW</button>
      </div>
      <div class="time-presets sim-rate-presets">
        ${SIM_RATE_PRESETS.map(
          (rate) =>
            `<button class="time-preset-btn sim-rate-btn" data-rate="${rate}" type="button">${formatSimRate(rate)}</button>`,
        ).join('')}
      </div>
      <div class="sim-timeline-row">
        <span class="sim-timeline-label">−12h</span>
        <input type="range" id="simTimeline" min="0" max="1" step="0.0001" value="0.5" aria-label="Scrub simulation time ±12 hours around now">
        <span class="sim-timeline-label">+12h</span>
      </div>
      <div class="sim-timeline-now-marker" aria-hidden="true">now</div>
    `;

  const animationControls = document.getElementById('animation-controls');
  if (animationControls?.parentElement) {
    animationControls.parentElement.insertBefore(container, animationControls.nextSibling);
  } else {
    document.body.appendChild(container);
  }

  state.elements.timeControls = container;
  state.elements.simTimeDisplay = document.getElementById('sim-time-display')!;
  state.elements.simPlayPauseButton = document.getElementById('simPlayPause') as HTMLButtonElement;
  state.elements.simNowButton = document.getElementById('simNowBtn') as HTMLButtonElement;
  state.elements.simTimelineSlider = document.getElementById('simTimeline') as HTMLInputElement;

  const playPauseBtn = state.elements.simPlayPauseButton;
  const nowBtn = state.elements.simNowButton;
  const timeline = state.elements.simTimelineSlider;
  const rateButtons = container.querySelectorAll<HTMLButtonElement>('.sim-rate-btn');

  playPauseBtn?.addEventListener('click', () => {
    state.getClock().togglePause();
    syncTransportUi(state);
  });

  nowBtn?.addEventListener('click', () => {
    state.getClock().jumpToNow();
    syncTransportUi(state);
  });

  rateButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const rate = Number(btn.dataset.rate ?? '1');
      state.getClock().setRate(rate);
      syncTransportUi(state);
    });
  });

  let scrubbing = false;
  timeline?.addEventListener('pointerdown', () => {
    scrubbing = true;
    state.onScrubStart?.();
  });
  timeline?.addEventListener('pointerup', () => {
    scrubbing = false;
    state.onScrubEnd?.();
  });
  timeline?.addEventListener('input', () => {
    if (!timeline) return;
    const wallNowMs = Date.now();
    const utcMs = timelineUtcFromValue(Number(timeline.value), wallNowMs);
    state.getClock().setSimUtc(utcMs, 'scrub');
    syncTransportUi(state, { skipTimeline: true });
  });

  document.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    const clock = state.getClock();

    if (e.code === 'Space') {
      e.preventDefault();
      clock.togglePause();
      syncTransportUi(state);
    } else if (e.key === ',') {
      e.preventDefault();
      clock.stepSimTime(-SIM_STEP_SEC);
      syncTransportUi(state);
    } else if (e.key === '.') {
      e.preventDefault();
      clock.stepSimTime(SIM_STEP_SEC);
      syncTransportUi(state);
    }
  });

  syncTransportUi(state);

  // Keep timeline centered on wall-clock "now" while playing unless the user is scrubbing.
  window.setInterval(() => {
    if (scrubbing) return;
    syncTransportUi(state, { refreshTimelineAnchor: true });
  }, 1000);
}

export function syncTransportUi(
  state: SimTransportState,
  options: { skipTimeline?: boolean; refreshTimelineAnchor?: boolean } = {},
): void {
  const clock = state.getClock();
  const wallNowMs = Date.now();

  if (state.elements.simTimeDisplay) {
    state.elements.simTimeDisplay.textContent = `Sim UTC: ${formatSimUtc(clock.simUtc)} · ${formatSimRate(clock.rate)}`;
  }

  if (state.elements.simPlayPauseButton) {
    state.elements.simPlayPauseButton.textContent = clock.isPaused() ? '▶' : '⏸';
    state.elements.simPlayPauseButton.classList.toggle('active', !clock.isPaused());
  }

  const rateButtons = state.elements.timeControls?.querySelectorAll<HTMLButtonElement>('.sim-rate-btn');
  rateButtons?.forEach((btn) => {
    const rate = Number(btn.dataset.rate ?? '0');
    btn.classList.toggle('active', clock.rate === rate);
  });

  if (!options.skipTimeline && state.elements.simTimelineSlider) {
    state.elements.simTimelineSlider.value = timelineValueFromUtc(
      clock.simUtcMs,
      options.refreshTimelineAnchor ? wallNowMs : wallNowMs,
    ).toString();
  }
}

export function updateSimClockHud(elements: UIElements, clock: SimClock): void {
  if (elements.simUtc) {
    elements.simUtc.textContent = `Sim UTC : ${formatSimUtc(clock.simUtc)}`;
  }
  if (elements.simRate) {
    elements.simRate.textContent = `Sim Rate : ${formatSimRate(clock.rate)}`;
  }
  if (elements.simTimeDisplay) {
    elements.simTimeDisplay.textContent = `Sim UTC: ${formatSimUtc(clock.simUtc)} · ${formatSimRate(clock.rate)}`;
  }
}
