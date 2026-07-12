import type { UIElements } from '@/ui/uiTypes.js';

export function formatTimeScale(scale: number): string {
  if (scale >= 604800) {
    return `${(scale / 604800).toFixed(1)}w/s`;
  } else if (scale >= 86400) {
    return `${(scale / 86400).toFixed(1)}d/s`;
  } else if (scale >= 3600) {
    return `${(scale / 3600).toFixed(1)}h/s`;
  } else if (scale >= 60) {
    return `${(scale / 60).toFixed(1)}m/s`;
  } else {
    return `${Math.round(scale)}x`;
  }
}

export function formatSimTime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 365) {
    const years = (days / 365.25).toFixed(1);
    return `Year ${years}`;
  } else if (days > 30) {
    const months = Math.floor(days / 30);
    const remDays = days % 30;
    return `${months}mo ${remDays}d`;
  } else if (days > 0) {
    return `Day ${days} ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${Math.floor(seconds / 60)}m`;
  }
}

export interface TimeScaleControlState {
  elements: UIElements;
  currentTimeScale: number;
  onTimeScaleChange: ((scale: number) => void) | null;
}

export function createTimeScaleControl(state: TimeScaleControlState): void {
  const container = document.createElement('div');
  container.id = 'time-controls';
  container.className = 'time-controls';

  container.innerHTML = `
      <div class="time-label">⏱ TIME SCALE</div>
      <div class="time-display" id="sim-time-display">Sim Time: 0h</div>
      <div class="time-slider-row">
        <input type="range" id="timeScaleSlider" min="0" max="4" step="0.1" value="0">
        <span id="timeScaleValue">1x</span>
      </div>
      <div class="time-presets">
        <button class="time-preset-btn active" data-scale="1">1x</button>
        <button class="time-preset-btn" data-scale="3600">1h/s</button>
        <button class="time-preset-btn" data-scale="86400">1d/s</button>
        <button class="time-preset-btn" data-scale="604800">1w/s</button>
      </div>
    `;

  const animationControls = document.getElementById('animation-controls');
  if (animationControls && animationControls.parentElement) {
    animationControls.parentElement.insertBefore(container, animationControls.nextSibling);
  } else {
    document.body.appendChild(container);
  }

  state.elements.timeControls = container;
  state.elements.simTimeDisplay = document.getElementById('sim-time-display')!;
  state.elements.timeScaleSlider = document.getElementById('timeScaleSlider') as HTMLInputElement;
  state.elements.timeScaleValue = document.getElementById('timeScaleValue')!;

  state.elements.timeScaleSlider.addEventListener('input', (e) => {
    const sliderValue = parseFloat((e.target as HTMLInputElement).value);
    const scale = Math.pow(10, sliderValue);
    applyTimeScale(state, scale);
  });

  const presetButtons = container.querySelectorAll('.time-preset-btn');
  presetButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      const scale = parseInt(target.dataset.scale || '1');
      applyTimeScale(state, scale);

      presetButtons.forEach(b => b.classList.remove('active'));
      target.classList.add('active');
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      adjustTimeScale(state, 1.5);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      adjustTimeScale(state, 0.67);
    } else if (e.key === '0') {
      e.preventDefault();
      applyTimeScale(state, 1);
    }
  });
}

export function applyTimeScale(state: TimeScaleControlState, scale: number): void {
  state.currentTimeScale = Math.max(1, Math.min(10000, Math.round(scale)));

  if (state.elements.timeScaleSlider) {
    const sliderValue = Math.log10(state.currentTimeScale);
    state.elements.timeScaleSlider.value = Math.max(0, Math.min(4, sliderValue)).toString();
  }

  if (state.elements.timeScaleValue) {
    state.elements.timeScaleValue.textContent = formatTimeScale(state.currentTimeScale);
  }

  const presetButtons = document.querySelectorAll('.time-preset-btn');
  presetButtons.forEach((btn) => {
    const btnScale = parseInt((btn as HTMLButtonElement).dataset.scale || '0');
    btn.classList.toggle('active', btnScale === state.currentTimeScale);
  });

  if (state.onTimeScaleChange) {
    state.onTimeScaleChange(state.currentTimeScale);
  }
}

export function adjustTimeScale(state: TimeScaleControlState, multiplier: number): void {
  applyTimeScale(state, state.currentTimeScale * multiplier);
}

export function updateSimTimeDisplay(elements: UIElements, simTime: number): void {
  if (elements.simTimeDisplay) {
    elements.simTimeDisplay.textContent = `Sim Time: ${formatSimTime(simTime)}`;
  }
}
