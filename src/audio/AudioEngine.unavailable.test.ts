import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_NO_DEVICE_REASON, AUDIO_NO_SUPPORT_REASON, AudioEngine } from '@/audio/AudioEngine.js';

function stubStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
}

/** A context that never reaches `running`, like one with no output device. */
function stubSuspendedContext(resume: () => Promise<void>): void {
  const node = () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    gain: { value: 0 },
    frequency: { value: 0 },
    Q: { value: 0 },
    getChannelData: () => new Float32Array(4),
    frequencyBinCount: 8,
  });
  class FakeCtx {
    state = 'suspended';
    sampleRate = 48000;
    destination = {};
    createGain = node;
    createOscillator = node;
    createBiquadFilter = node;
    createAnalyser = node;
    createBufferSource = node;
    createBuffer = () => ({ getChannelData: () => new Float32Array(4) });
    resume = resume;
    close = () => Promise.resolve();
  }
  vi.stubGlobal('AudioContext', FakeCtx);
}

describe('AudioEngine unavailable reporting', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports when Web Audio does not exist and falls back to muted', async () => {
    stubStorage();
    vi.stubGlobal('AudioContext', undefined);
    const audio = new AudioEngine();
    const reasons: string[] = [];
    audio.onUnavailable((r) => reasons.push(r));
    await audio.setMuted(false);
    expect(reasons).toEqual([AUDIO_NO_SUPPORT_REASON]);
    expect(audio.isMuted()).toBe(true);
  });

  it('reports when the AudioContext constructor throws', async () => {
    stubStorage();
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new DOMException('no device', 'NotSupportedError');
        }
      },
    );
    const audio = new AudioEngine();
    const reasons: string[] = [];
    audio.onUnavailable((r) => reasons.push(r));
    await audio.setMuted(false);
    expect(reasons).toEqual([AUDIO_NO_DEVICE_REASON]);
    expect(audio.isMuted()).toBe(true);
  });

  it('reports an explicit enable that never reaches running (resume hangs)', async () => {
    vi.useFakeTimers();
    stubStorage();
    stubSuspendedContext(() => new Promise<void>(() => undefined));
    const audio = new AudioEngine();
    const reasons: string[] = [];
    audio.onUnavailable((r) => reasons.push(r));
    const pending = audio.setMuted(false);
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(reasons).toEqual([AUDIO_NO_DEVICE_REASON]);
    expect(audio.isMuted()).toBe(true);
  });

  it('stays silent for passive unlock attempts that are only autoplay-blocked', async () => {
    vi.useFakeTimers();
    stubStorage();
    localStorage.setItem('gz.audio.muted', 'false');
    stubSuspendedContext(() => new Promise<void>(() => undefined));
    const audio = new AudioEngine();
    const reasons: string[] = [];
    audio.onUnavailable((r) => reasons.push(r));
    const pending = audio.unlock();
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(reasons).toEqual([]);
    expect(audio.isMuted()).toBe(false);
  });

  it('does not overwrite the saved preference on failure', async () => {
    stubStorage();
    vi.stubGlobal('AudioContext', undefined);
    const audio = new AudioEngine();
    await audio.setMuted(false);
    expect(localStorage.getItem('gz.audio.muted')).toBe('false');
  });
});
