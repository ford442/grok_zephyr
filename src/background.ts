/**
 * Background mode controller for the starfield + atmosphere system.
 */
import type { ViewMode } from '@/types/index.js';

export type BackgroundMode = 'space' | 'horizon' | 'ground';

let currentBackgroundMode: BackgroundMode = 'space';

export function setBackgroundMode(mode: BackgroundMode): void {
  currentBackgroundMode = mode;
}

export function getBackgroundModeIndex(): number {
  switch (currentBackgroundMode) {
    case 'horizon':
      return 1;
    case 'ground':
      return 2;
    default:
      return 0;
  }
}

export function resolveBackgroundMode(viewMode: ViewMode): BackgroundMode {
  switch (viewMode) {
    case 'ground':
      return 'ground';
    case 'horizon-720':
      return 'horizon';
    default:
      return 'space';
  }
}
