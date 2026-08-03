/**
 * Motion preference: OS `prefers-reduced-motion` plus an in-app override.
 *
 * The CSS media query already calms UI transitions, but the scene itself --
 * idle camera drift, cinematic auto-motion, pattern pulsing -- is driven from
 * JS and has to consult this. Kept free of direct DOM/global access so it can
 * be exercised without a browser, matching GroundStationController's shape.
 */

export type MotionSetting = 'system' | 'reduce' | 'full';

export const MOTION_STORAGE_KEY = 'grok-zephyr.motion.v1';

export type MotionListener = (reduced: boolean) => void;

/** Minimal slice of MediaQueryList this controller needs. */
export interface MotionMediaQuery {
  matches: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
  /** Legacy Safari fallback. */
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

export interface MotionPreferenceOptions {
  media?: MotionMediaQuery | null;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

function defaultMedia(): MotionMediaQuery | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-reduced-motion: reduce)');
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function isMotionSetting(value: unknown): value is MotionSetting {
  return value === 'system' || value === 'reduce' || value === 'full';
}

export class MotionPreferenceController {
  private setting: MotionSetting = 'system';
  private readonly media: MotionMediaQuery | null;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  private readonly listeners = new Set<MotionListener>();
  private lastNotified: boolean;
  private readonly onMediaChange = (): void => {
    this.notify();
  };

  constructor(options: MotionPreferenceOptions = {}) {
    this.media = options.media === undefined ? defaultMedia() : options.media;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.restore();
    this.lastNotified = this.prefersReducedMotion;

    if (this.media?.addEventListener) {
      this.media.addEventListener('change', this.onMediaChange);
    } else if (this.media?.addListener) {
      this.media.addListener(this.onMediaChange);
    }
  }

  /** What the OS reports, ignoring any in-app override. */
  get systemPrefersReducedMotion(): boolean {
    return this.media?.matches ?? false;
  }

  /** The user's explicit choice, or 'system' to follow the OS. */
  get value(): MotionSetting {
    return this.setting;
  }

  /** The effective answer callers should branch on. */
  get prefersReducedMotion(): boolean {
    if (this.setting === 'reduce') return true;
    if (this.setting === 'full') return false;
    return this.systemPrefersReducedMotion;
  }

  set(setting: MotionSetting): void {
    if (!isMotionSetting(setting)) {
      throw new RangeError(`Unknown motion setting: ${String(setting)}`);
    }
    this.setting = setting;
    this.persist();
    this.notify();
  }

  subscribe(listener: MotionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (this.media?.removeEventListener) {
      this.media.removeEventListener('change', this.onMediaChange);
    } else if (this.media?.removeListener) {
      this.media.removeListener(this.onMediaChange);
    }
    this.listeners.clear();
  }

  /** Emits only when the effective value actually flips. */
  private notify(): void {
    const reduced = this.prefersReducedMotion;
    if (reduced === this.lastNotified) return;
    this.lastNotified = reduced;
    for (const listener of this.listeners) listener(reduced);
  }

  private persist(): void {
    try {
      this.storage?.setItem(MOTION_STORAGE_KEY, this.setting);
    } catch {
      // Storage can throw in private mode; the preference just won't persist.
    }
  }

  private restore(): void {
    try {
      const raw = this.storage?.getItem(MOTION_STORAGE_KEY);
      if (isMotionSetting(raw)) this.setting = raw;
    } catch {
      this.setting = 'system';
    }
  }
}
