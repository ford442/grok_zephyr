import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  STRIPS_DISCLAIMER,
  StripsController,
  applyStripsForQuality,
  formatStripsStatus,
  parseStripsParams,
  setStripsEnabled,
  setStripsUnavailable,
} from './StripsController.js';
import type { AppRuntime } from './AppRuntime.js';
import { StripsMode } from '@/physics/skyStrips.js';
import { bandLevels } from '@/audio/AudioEngine.js';

const QUIET = { bands: null, reducedMotion: false } as const;
const LOUD = { bands: { bass: 0.8, presence: 0.3 }, reducedMotion: false } as const;

function modeOf(ab: ArrayBuffer | null): number | null {
  return ab ? new Uint32Array(ab)[0] : null;
}

function enabled(mode: StripsController['mode'] = StripsMode.WAVE): StripsController {
  const c = new StripsController();
  c.userOverride = true;
  c.setMode(mode);
  c.resolveEnabled();
  return c;
}

/** Just enough AppRuntime for the wiring helpers. */
function fakeRuntime(): { rt: AppRuntime; ui: Record<string, unknown[]> } {
  const ui: Record<string, unknown[]> = {};
  const record = (name: string) => (v: unknown) => {
    (ui[name] ??= []).push(v);
  };
  const rt = {
    strips: new StripsController(),
    audio: { getBands: () => null },
    a11y: null,
    ui: {
      setStripsEnabled: record('enabled'),
      setStripsStatus: record('status'),
      setStripsAvailable: record('available'),
      setStripsMode: record('mode'),
    },
  } as unknown as AppRuntime;
  return { rt, ui };
}

describe('parseStripsParams', () => {
  it('reads the toggle, mode and tempo', () => {
    expect(parseStripsParams('?strips=1&stripsMode=chase&stripsBpm=90')).toEqual({
      enabled: true,
      mode: StripsMode.CHASE,
      bpm: 90,
    });
    expect(parseStripsParams('?strips=off').enabled).toBe(false);
    expect(parseStripsParams('').enabled).toBeNull();
  });

  it('rejects unknown modes and clamps tempo', () => {
    expect(parseStripsParams('?stripsMode=morse').mode).toBeNull();
    expect(parseStripsParams('?stripsMode=SPARKLE').mode).toBe(StripsMode.SPARKLE);
    expect(parseStripsParams('?stripsBpm=5').bpm).toBe(40);
    expect(parseStripsParams('?stripsBpm=abc').bpm).toBeNull();
  });
});

describe('StripsController', () => {
  it('is off by default and dispatches nothing', () => {
    const c = new StripsController();
    c.resolveEnabled();
    expect(c.enabled).toBe(false);
    expect(c.usesScratch()).toBe(false);
    expect(c.tick(1 / 60, QUIET)).toBeNull();
  });

  it('draws while on, then clears its half exactly once when switched off', () => {
    const c = enabled();
    expect(modeOf(c.tick(1 / 60, QUIET))).toBe(StripsMode.WAVE);
    c.userOverride = false;
    c.resolveEnabled();
    expect(c.usesScratch()).toBe(true);
    expect(modeOf(c.tick(1 / 60, QUIET))).toBe(StripsMode.CLEAR);
    expect(c.usesScratch()).toBe(false);
    expect(c.tick(1 / 60, QUIET)).toBeNull();
  });

  it('BEAT no-ops while audio is muted', () => {
    const c = enabled(StripsMode.BEAT);
    expect(c.tick(1 / 60, QUIET)).toBeNull();
    expect(modeOf(c.tick(1 / 60, LOUD))).toBe(StripsMode.BEAT);
    // Muted again: one clear, then nothing.
    expect(modeOf(c.tick(1 / 60, QUIET))).toBe(StripsMode.CLEAR);
    expect(c.tick(1 / 60, QUIET)).toBeNull();
  });

  it('holds WAVE still and drops SPARKLE under reduced motion', () => {
    const wave = enabled(StripsMode.WAVE);
    wave.setTime(3);
    const a = new Float32Array(wave.tick(0.5, { bands: null, reducedMotion: true })!);
    const b = new Float32Array(wave.tick(0.5, { bands: null, reducedMotion: true })!);
    expect(wave.getTime()).toBe(3);
    expect(Array.from(a)).toEqual(Array.from(b));

    const sparkle = enabled(StripsMode.SPARKLE);
    expect(modeOf(sparkle.tick(1 / 60, QUIET))).toBe(StripsMode.SPARKLE);
    expect(modeOf(sparkle.tick(1 / 60, { bands: null, reducedMotion: true }))).toBe(StripsMode.CLEAR);
    expect(sparkle.tick(1 / 60, { bands: null, reducedMotion: true })).toBeNull();
  });

  it('advances its own clock, independent of sim time scale', () => {
    const c = enabled();
    c.tick(0.25, QUIET);
    c.tick(0.25, QUIET);
    expect(c.getTime()).toBeCloseTo(0.5, 12);
    c.setTime(2, true);
    c.tick(0.25, QUIET);
    expect(c.getTime()).toBe(2);
  });
});

describe('gating', () => {
  it('low quality / mobile force it off but keep the user choice', () => {
    const { rt } = fakeRuntime();
    setStripsEnabled(rt, true);
    expect(rt.strips.enabled).toBe(true);
    applyStripsForQuality(rt, true);
    expect(rt.strips.enabled).toBe(false);
    expect(rt.strips.lastStatus).toBe('Strips: off on Low quality and mobile');
    applyStripsForQuality(rt, false);
    expect(rt.strips.enabled).toBe(true);
  });

  it('WebGL disables the control', () => {
    const { rt, ui } = fakeRuntime();
    setStripsUnavailable(rt, 'WebGPU only');
    setStripsEnabled(rt, true);
    expect(rt.strips.enabled).toBe(false);
    expect(ui.available).toEqual([false]);
    expect(rt.strips.lastStatus).toBe('Strips: unavailable — WebGPU only');
  });
});

describe('AudioEngine bands', () => {
  it('averages the bass and presence bins, normalised to 0..1', () => {
    const fftSize = 1024;
    const sampleRate = 48000; // 46.875 Hz per bin
    const bins = new Uint8Array(fftSize / 2);
    bins.fill(255, 1, 4); // ~47–141 Hz
    expect(bandLevels(bins, sampleRate, fftSize)).toEqual({ bass: 1, presence: 0 });
    expect(bandLevels(new Uint8Array(fftSize / 2), sampleRate, fftSize)).toEqual({ bass: 0, presence: 0 });
  });
});

describe('HUD copy', () => {
  const forbidden =
    /gravit|n-body|perturb|\bssa\b|situational awareness|collision|conjunction|avoid|track|morse|transmit|communicat|signal|message|beacon/i;

  it('describes a light show, not communications or space safety', () => {
    const modes = [StripsMode.WAVE, StripsMode.CHASE, StripsMode.BEAT, StripsMode.SPARKLE] as const;
    const strings = [
      STRIPS_DISCLAIMER,
      ...modes.flatMap((mode) =>
        [true, false].flatMap((on) =>
          [true, false].flatMap((audioLive) =>
            [true, false].map((reducedMotion) =>
              formatStripsStatus({
                enabled: on,
                wanted: true,
                unavailableReason: null,
                qualityForcesOff: false,
                mode,
                audioLive,
                reducedMotion,
              }),
            ),
          ),
        ),
      ),
      formatStripsStatus({
        enabled: false,
        wanted: true,
        unavailableReason: 'WebGPU only',
        qualityForcesOff: false,
        mode: StripsMode.WAVE,
        audioLive: false,
        reducedMotion: false,
      }),
    ];
    for (const s of strings) expect(s).not.toMatch(forbidden);

    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const block = /<div id="strips-controls"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(block).not.toBe('');
    expect(block).not.toMatch(forbidden);
    expect(block.replace(/\s+/g, ' ').replace('&mdash;', '—')).toContain(STRIPS_DISCLAIMER);
  });

  it('tells the user how to drive BEAT', () => {
    expect(
      formatStripsStatus({
        enabled: true,
        wanted: true,
        unavailableReason: null,
        qualityForcesOff: false,
        mode: StripsMode.BEAT,
        audioLive: false,
        reducedMotion: false,
      }),
    ).toMatch(/unmute/);
  });
});
