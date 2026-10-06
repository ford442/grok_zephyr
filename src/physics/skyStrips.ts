/**
 * Sky Strips — CPU reference for the light-show compute pass.
 *
 * This is the authority for the pattern math: `src/shaders/compute/skyStrips.wgsl`
 * reimplements `stripsSample` in WGSL and `skyStrips.test.ts` pins the shared
 * constants. Strips write the low 16 bits of the packed animation scratch
 * (a8 + RGB332, see animScratchPacking.ts); the brush's high half is preserved.
 *
 * Strips are stateless: every frame recomputes every satellite from the show
 * clock, its orbit (argument of latitude, RAAN) and, for BEAT, two audio band
 * levels. Nothing is stored per satellite beyond the 16 bits drawn this frame.
 * It is a light show — nothing here moves a satellite or carries a message.
 *
 * Time-dependent phases are reduced on the CPU in float64 (`stripsFrameFromClock`)
 * so the shader never multiplies a large f32 time.
 */

import { hashU32, stampLevel, type Vec3Tuple } from './brushFalloff.js';
import {
  ANIM_SCRATCH_STRIPS_SHIFT,
  animHalfPack,
  animWithHalf,
  rgb332FromRgb24,
} from './animScratchPacking.js';

export const StripsMode = {
  /** Internal: zero the strips half once when the pattern stops. */
  CLEAR: 0,
  WAVE: 1,
  CHASE: 2,
  BEAT: 3,
  SPARKLE: 4,
} as const;
export type StripsModeValue = (typeof StripsMode)[keyof typeof StripsMode];
export type StripsModeName = 'wave' | 'chase' | 'beat' | 'sparkle';

export const STRIPS_MODE_NAMES: Record<Exclude<StripsModeValue, 0>, StripsModeName> = {
  [StripsMode.WAVE]: 'wave',
  [StripsMode.CHASE]: 'chase',
  [StripsMode.BEAT]: 'beat',
  [StripsMode.SPARKLE]: 'sparkle',
};

export const STRIPS_MIN_BPM = 40;
export const STRIPS_MAX_BPM = 240;
export const STRIPS_DEFAULT_BPM = 120;

/** Wave crests around one orbit. */
export const STRIPS_WAVE_LOBES = 4;
/** Beats per wave cycle: one crest passes a satellite every bar. */
export const STRIPS_BEATS_PER_WAVE = 4;
/** Lit bands around the RAAN circle for CHASE. */
export const STRIPS_CHASE_BANDS = 6;
/** Fraction of each chase band that is lit (head + fading tail). */
export const STRIPS_CHASE_WIDTH = 0.18;
/** Chase bands advanced per beat. */
export const STRIPS_CHASE_BANDS_PER_BEAT = 0.125;
/** Sparkle re-rolls per second and the fraction lit per roll. */
export const STRIPS_SPARKLE_RATE_HZ = 8;
export const STRIPS_SPARKLE_DENSITY = 0.03;
/** BEAT keeps this much of the wave shape at zero presence of the envelope. */
export const STRIPS_BEAT_WAVE_FLOOR = 0.35;
/** Peak intensity, so a full strip does not wash out the brush on top. */
export const STRIPS_PEAK = 0.85;

export const STRIPS_DEFAULT_COLOR_A = 0x7a5cff;
export const STRIPS_DEFAULT_COLOR_B = 0xffd23f;

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return STRIPS_DEFAULT_BPM;
  return Math.min(STRIPS_MAX_BPM, Math.max(STRIPS_MIN_BPM, bpm));
}

/** CSS-free rgb24 from `0xRRGGBB` → scratch order (red in the low byte). */
export function rgbFromHex(hex: number): number {
  const r = (hex >>> 16) & 0xff;
  const g = (hex >>> 8) & 0xff;
  const b = hex & 0xff;
  return (r | (g << 8) | (b << 16)) >>> 0;
}

/** Everything one dispatch needs, already reduced to small numbers. */
export interface StripsFrame {
  mode: StripsModeValue;
  seed: number;
  /** rgb24, red in the low byte. */
  colorA: number;
  colorB: number;
  /** Radians in [0, 2π). */
  wavePhase: number;
  /** Bands in [0, 1). */
  chaseOffset: number;
  sparkleBucket: number;
  /** Position inside the current sparkle bucket, [0, 1). */
  sparkleFrac: number;
  bass: number;
  presence: number;
}

/** Show clock + tempo → the phases the shader uses, in float64. */
export function stripsFrameFromClock(
  mode: StripsModeValue,
  tSeconds: number,
  bpm: number,
  bands: { bass: number; presence: number } | null,
  seed = 0,
  colorA = rgbFromHex(STRIPS_DEFAULT_COLOR_A),
  colorB = rgbFromHex(STRIPS_DEFAULT_COLOR_B),
): StripsFrame {
  const t = Number.isFinite(tSeconds) ? Math.max(0, tSeconds) : 0;
  const beats = (t * clampBpm(bpm)) / 60;
  const waveCycles = beats / STRIPS_BEATS_PER_WAVE;
  const sparkle = t * STRIPS_SPARKLE_RATE_HZ;
  return {
    mode,
    seed: seed >>> 0,
    colorA,
    colorB,
    wavePhase: (waveCycles - Math.floor(waveCycles)) * 2 * Math.PI,
    chaseOffset: fract(beats * STRIPS_CHASE_BANDS_PER_BEAT),
    sparkleBucket: Math.floor(sparkle) >>> 0,
    sparkleFrac: fract(sparkle),
    bass: clamp01(bands?.bass ?? 0),
    presence: clamp01(bands?.presence ?? 0),
  };
}

/**
 * Angle of `pos` inside the orbital plane given by RAAN and inclination,
 * measured from the ascending node — the satellite's along-track phase. For a
 * circular simple-mode orbit this is exactly its mean anomaly; it works for
 * every physics mode because it reads the live position.
 */
export function argumentOfLatitude(pos: Vec3Tuple, raan: number, inc: number): number {
  const cR = Math.cos(raan);
  const sR = Math.sin(raan);
  const cI = Math.cos(inc);
  const sI = Math.sin(inc);
  const x = pos[0] * cR + pos[1] * sR;
  const y = -pos[0] * sR * cI + pos[1] * cR * cI + pos[2] * sI;
  return Math.atan2(y, x);
}

/** Per-satellite draw in [0, 1) for one sparkle bucket. 24 bits so f32 holds it. */
export function sparkleHash(satIndex: number, seed: number, bucket: number): number {
  const mixed = (satIndex ^ Math.imul(seed >>> 0, 0x9e3779b9) ^ Math.imul(bucket >>> 0, 0x85ebca6b)) >>> 0;
  return (hashU32(mixed) >>> 8) / 16777216;
}

export interface StripsSample {
  /** 0..1 before STRIPS_PEAK. */
  intensity: number;
  /** 0 = colour A, 1 = colour B. */
  mix: number;
}

function waveShape(u: number, phase: number): number {
  return 0.5 + 0.5 * Math.sin(STRIPS_WAVE_LOBES * u - phase);
}

/** One satellite, one frame. */
export function stripsSample(
  frame: StripsFrame,
  satIndex: number,
  pos: Vec3Tuple,
  raan: number,
  inc: number,
): StripsSample {
  switch (frame.mode) {
    case StripsMode.WAVE: {
      const w = waveShape(argumentOfLatitude(pos, raan, inc), frame.wavePhase);
      return { intensity: w, mix: w };
    }
    case StripsMode.CHASE: {
      const along = raan / (2 * Math.PI);
      const p = fract(along * STRIPS_CHASE_BANDS - frame.chaseOffset);
      const lit = p < STRIPS_CHASE_WIDTH ? 1 - p / STRIPS_CHASE_WIDTH : 0;
      return { intensity: lit, mix: fract(along) };
    }
    case StripsMode.BEAT: {
      const w = waveShape(argumentOfLatitude(pos, raan, inc), frame.wavePhase);
      const shape = STRIPS_BEAT_WAVE_FLOOR + (1 - STRIPS_BEAT_WAVE_FLOOR) * w;
      return { intensity: frame.bass * shape, mix: frame.presence };
    }
    case StripsMode.SPARKLE: {
      const r = sparkleHash(satIndex, frame.seed, frame.sparkleBucket);
      if (r >= STRIPS_SPARKLE_DENSITY) return { intensity: 0, mix: 0 };
      return { intensity: 1 - frame.sparkleFrac, mix: r / STRIPS_SPARKLE_DENSITY };
    }
    default:
      return { intensity: 0, mix: 0 };
  }
}

/** Colour A→B at `m`, per channel rounded like the shader, then RGB332. */
export function stripsColor332(colorA: number, colorB: number, m: number): number {
  const t = clamp01(m);
  let rgb = 0;
  for (let ch = 0; ch < 3; ch++) {
    const a = (colorA >>> (ch * 8)) & 0xff;
    const b = (colorB >>> (ch * 8)) & 0xff;
    rgb |= Math.floor(a + (b - a) * t + 0.5) << (ch * 8);
  }
  return rgb332FromRgb24(rgb >>> 0);
}

/** The 16-bit strips half for one sample. */
export function stripsHalf(frame: StripsFrame, sample: StripsSample): number {
  const level = stampLevel(sample.intensity * STRIPS_PEAK);
  return animHalfPack(level, stripsColor332(frame.colorA, frame.colorB, sample.mix));
}

/**
 * What one GPU dispatch does, over `positions` (packed vec4) and `elements`
 * (vec4 `[raan, inc, M, shell|color]`), writing the low half of `scratch` in
 * place. Inactive satellites get an empty half. Used by tests.
 */
export function stripsFrame(
  positions: Float32Array,
  elements: Float32Array,
  scratch: Uint32Array,
  count: number,
  frame: StripsFrame,
): void {
  for (let i = 0; i < count; i++) {
    const x = positions[i * 4];
    const y = positions[i * 4 + 1];
    const z = positions[i * 4 + 2];
    const w = positions[i * 4 + 3];
    const active = w >= 0 && (x !== 0 || y !== 0 || z !== 0);
    const half = active && frame.mode !== StripsMode.CLEAR
      ? stripsHalf(frame, stripsSample(frame, i, [x, y, z], elements[i * 4], elements[i * 4 + 1]))
      : 0;
    scratch[i] = animWithHalf(scratch[i], ANIM_SCRATCH_STRIPS_SHIFT, half);
  }
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}
