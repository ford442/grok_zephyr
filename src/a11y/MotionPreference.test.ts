import { describe, expect, it, vi } from 'vitest';
import {
  MOTION_STORAGE_KEY,
  MotionPreferenceController,
  type MotionMediaQuery,
} from './MotionPreference.js';

class FakeMedia implements MotionMediaQuery {
  matches: boolean;
  private listeners = new Set<() => void>();
  constructor(matches = false) {
    this.matches = matches;
  }
  addEventListener(_type: 'change', listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'change', listener: () => void): void {
    this.listeners.delete(listener);
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
  emit(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) listener();
  }
}

class MemoryStorage {
  value: string | null = null;
  getItem(): string | null {
    return this.value;
  }
  setItem(_key: string, value: string): void {
    this.value = value;
  }
}

function make(matches = false, storage = new MemoryStorage()) {
  const media = new FakeMedia(matches);
  return { media, storage, controller: new MotionPreferenceController({ media, storage }) };
}

describe('MotionPreferenceController', () => {
  it('follows the OS setting by default', () => {
    expect(make(false).controller.prefersReducedMotion).toBe(false);
    expect(make(true).controller.prefersReducedMotion).toBe(true);
    expect(make(true).controller.value).toBe('system');
  });

  it('lets an in-app choice override the OS in both directions', () => {
    const { controller } = make(false);
    controller.set('reduce');
    expect(controller.prefersReducedMotion).toBe(true);

    const { controller: other } = make(true);
    other.set('full');
    // Overriding to full must win even though the OS asks for reduced motion.
    expect(other.prefersReducedMotion).toBe(false);
    expect(other.systemPrefersReducedMotion).toBe(true);
  });

  it('reacts when the OS setting changes mid-session', () => {
    const { media, controller } = make(false);
    const listener = vi.fn();
    controller.subscribe(listener);

    media.emit(true);
    expect(controller.prefersReducedMotion).toBe(true);
    expect(listener).toHaveBeenCalledWith(true);

    media.emit(false);
    expect(listener).toHaveBeenLastCalledWith(false);
  });

  it('ignores OS changes while an explicit override is in force', () => {
    const { media, controller } = make(false);
    controller.set('full');
    const listener = vi.fn();
    controller.subscribe(listener);

    media.emit(true);
    expect(controller.prefersReducedMotion).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('only notifies when the effective value actually flips', () => {
    const { media, controller } = make(false);
    const listener = vi.fn();
    controller.subscribe(listener);

    media.emit(false); // no change
    expect(listener).not.toHaveBeenCalled();
    media.emit(true);
    expect(listener).toHaveBeenCalledTimes(1);
    media.emit(true); // still reduced
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('persists the choice and restores it', () => {
    const storage = new MemoryStorage();
    const first = make(false, storage);
    first.controller.set('reduce');
    expect(storage.value).toBe('reduce');
    expect(MOTION_STORAGE_KEY).toContain('.v1');

    const restored = new MotionPreferenceController({ media: new FakeMedia(false), storage });
    expect(restored.value).toBe('reduce');
    expect(restored.prefersReducedMotion).toBe(true);
  });

  it('falls back to following the OS on unusable stored data', () => {
    const storage = new MemoryStorage();
    storage.value = 'not-a-setting';
    const controller = new MotionPreferenceController({ media: new FakeMedia(true), storage });
    expect(controller.value).toBe('system');
    expect(controller.prefersReducedMotion).toBe(true);
  });

  it('works with no matchMedia and no storage at all', () => {
    const controller = new MotionPreferenceController({ media: null, storage: null });
    expect(controller.prefersReducedMotion).toBe(false);
    controller.set('reduce');
    expect(controller.prefersReducedMotion).toBe(true);
  });

  it('rejects unknown settings and unsubscribes cleanly', () => {
    const { media, controller } = make(false);
    expect(() => controller.set('sideways' as 'system')).toThrow(/Unknown motion setting/);

    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    unsubscribe();
    media.emit(true);
    expect(listener).not.toHaveBeenCalled();

    controller.dispose();
    expect(media.listenerCount).toBe(0);
  });
});
