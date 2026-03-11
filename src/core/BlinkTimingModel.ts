/**
 * Blink Timing Model for Coherent Ground Image Formation
 *
 * ═══════════════════════════════════════════════════════════════════
 * PROBLEM STATEMENT
 * ═══════════════════════════════════════════════════════════════════
 *
 * 1,048,576 satellites must form a coherent 1024×1024 pixel image
 * on Earth's surface. Each satellite is one "pixel" that modulates
 * its brightness/color. A ground observer looking up sees the
 * composite image.
 *
 * ═══════════════════════════════════════════════════════════════════
 * ORBITAL MOTION & PIXEL DRIFT
 * ═══════════════════════════════════════════════════════════════════
 *
 * At 550 km altitude (a = 6921 km):
 *   Orbital velocity: v = √(μ/a) = √(398600.44/6921) = 7.59 km/s
 *   Orbital period:   T = 2π√(a³/μ) = 5755 s ≈ 95.9 min
 *
 * For a ground observer with 5° FOV:
 *   At 550 km altitude, the ground footprint radius is:
 *     r_foot = 550 × tan(2.5°) = 550 × 0.04366 = 24.01 km
 *   Full FOV diameter: 48.02 km
 *
 *   For a 1024×1024 image projected into this footprint:
 *     Pixel pitch on ground: 48.02 / 1024 = 0.0469 km = 46.9 m
 *
 *   Satellite ground-track velocity:
 *     v_ground = v_orbital × (R_earth / (R_earth + h))
 *              = 7.59 × (6371/6921) = 6.98 km/s
 *
 *   Pixel drift rate:
 *     drift = v_ground / pixel_pitch = 6980 / 46.9 = 148.8 pixels/second
 *
 *   Time to drift 1 pixel:
 *     t_pixel = pixel_pitch / v_ground = 46.9 / 6980 = 6.72 ms
 *
 *   Time to drift 0.5 pixel (Nyquist limit for sharp image):
 *     t_half = 3.36 ms
 *
 * ═══════════════════════════════════════════════════════════════════
 * FRAME BUDGET & REFRESH RATE
 * ═══════════════════════════════════════════════════════════════════
 *
 * Constraint: each satellite must blink ON for ≤ 3.36 ms to avoid
 * motion blur exceeding 0.5 pixel.
 *
 * For a coherent image:
 *   - All 1M satellites blink simultaneously (same ON window)
 *   - OR: time-division multiplexing with overlap compensation
 *
 * Option A: Simultaneous flash
 *   Flash duration: ≤ 3.36 ms
 *   Frame rate: limited by satellite comm latency + flash duration
 *   At 30 fps: 33.3 ms per frame, flash for 3.36 ms = 10.1% duty cycle
 *   At 60 fps: 16.7 ms per frame, flash for 3.36 ms = 20.1% duty cycle
 *   At 148 fps: 6.72 ms per frame, flash for 3.36 ms = 50% duty cycle (max)
 *
 * Option B: Rolling shutter (compensated)
 *   Flash in strips, offset by orbital motion
 *   Effective frame rate can be higher but requires precise timing
 *
 * RECOMMENDED: 30 fps with 3 ms flash window
 *   - 10% duty cycle → manageable power budget
 *   - 30 fps sufficient for static/slow images
 *   - 3 ms < 3.36 ms Nyquist limit → < 0.5 pixel blur
 *
 * ═══════════════════════════════════════════════════════════════════
 * MOTION COMPENSATION
 * ═══════════════════════════════════════════════════════════════════
 *
 * Between frames (at 30 fps, Δt = 33.3 ms):
 *   Pixel drift per frame: 148.8 × 0.0333 = 4.96 pixels
 *
 * The CPU must reassign satellite→pixel mapping every frame to
 * compensate for orbital motion. The gnomonic projection is
 * re-evaluated each frame, and each satellite's "owned pixel"
 * shifts by ~5 pixels per frame.
 *
 * For smooth animation, interpolate between frames:
 *   pixel_idx(t) = pixel_idx(t0) + drift_rate × (t - t0)
 *
 * ═══════════════════════════════════════════════════════════════════
 * MULTI-SHELL TIMING DIFFERENCES
 * ═══════════════════════════════════════════════════════════════════
 *
 * Shell 0 (340 km, v = 7.70 km/s):
 *   Ground-track: 7.09 km/s
 *   Pixel pitch (5° FOV): 340×tan(2.5°) × 2 / 1024 = 0.0290 km = 29.0 m
 *   Drift: 7090/29.0 = 244.5 px/s → t_half = 2.05 ms
 *
 * Shell 1 (550 km, v = 7.59 km/s):
 *   As computed above: 148.8 px/s → t_half = 3.36 ms
 *
 * Shell 2 (1150 km, v = 7.28 km/s):
 *   Ground-track: 6.16 km/s
 *   Pixel pitch: 1150×tan(2.5°) × 2 / 1024 = 0.0980 km = 98.0 m
 *   Drift: 6160/98.0 = 62.9 px/s → t_half = 7.95 ms
 *
 * LIMITING SHELL: 340 km with t_half = 2.05 ms
 * Use 2 ms flash window for all shells (conservative).
 *
 * ═══════════════════════════════════════════════════════════════════
 * SUMMARY
 * ═══════════════════════════════════════════════════════════════════
 *
 * Frame rate:          30 fps (33.3 ms per frame)
 * Flash duration:      2 ms (conservative, < 2.05 ms Nyquist for 340km shell)
 * Duty cycle:          6%
 * Pixel drift/frame:   ~5 pixels (compensated by re-projection)
 * Pixel drift/second:  148.8 px/s (550km), 244.5 px/s (340km), 62.9 px/s (1150km)
 * Image resolution:    1024 × 1024 = 1,048,576 pixels (= satellite count)
 * Ground footprint:    ~48 km diameter (5° FOV at 550 km)
 * Ground pixel pitch:  ~47 m (550km shell)
 *
 * ═══════════════════════════════════════════════════════════════════
 */

import { CONSTANTS } from '@/types/constants.js';
import type { SatelliteColorBuffer } from './SatelliteColorBuffer.js';

/** Physical constants */
const MU = 398600.4418;  // km³/s² (Earth gravitational parameter)
const R_EARTH = 6371.0;  // km

/** Shell configuration */
interface ShellTimingConfig {
  altitude_km: number;
  radius_km: number;
  orbital_velocity_kms: number;
  ground_track_velocity_kms: number;
  /** Ground pixel pitch for 5° FOV, 1024px image */
  pixel_pitch_km: number;
  /** Pixels of drift per second */
  drift_px_per_sec: number;
  /** Max flash duration for 0.5 pixel blur (ms) */
  max_flash_ms: number;
}

/** Blink timing parameters */
export interface BlinkTimingParams {
  /** Target frame rate (Hz) */
  frameRate: number;
  /** Flash duration (ms) */
  flashDuration_ms: number;
  /** Duty cycle (0-1) */
  dutyCycle: number;
  /** FOV of ground observer (degrees) */
  groundFOV_deg: number;
  /** Image dimensions (pixels) */
  imageSize: number;
  /** Per-shell timing data */
  shells: ShellTimingConfig[];
}

/**
 * Computes timing parameters for a given shell altitude.
 */
function computeShellTiming(altitude_km: number, fov_deg: number, image_size: number): ShellTimingConfig {
  const radius_km = R_EARTH + altitude_km;
  const v_orbital = Math.sqrt(MU / radius_km);  // km/s
  const v_ground = v_orbital * (R_EARTH / radius_km);  // km/s

  const fov_half_rad = (fov_deg / 2) * (Math.PI / 180);
  const footprint_radius = altitude_km * Math.tan(fov_half_rad);
  const footprint_diameter = footprint_radius * 2;
  const pixel_pitch = footprint_diameter / image_size;  // km

  const drift_px_per_sec = v_ground / pixel_pitch;
  const max_flash_ms = (pixel_pitch / v_ground) * 1000 * 0.5;  // 0.5 pixel Nyquist

  return {
    altitude_km,
    radius_km,
    orbital_velocity_kms: v_orbital,
    ground_track_velocity_kms: v_ground,
    pixel_pitch_km: pixel_pitch,
    drift_px_per_sec,
    max_flash_ms,
  };
}

/**
 * Compute the complete blink timing model.
 */
export function computeBlinkTiming(
  groundFOV_deg: number = 5.0,
  imageSize: number = 1024,
  targetFrameRate: number = 30,
): BlinkTimingParams {
  const shells = [
    computeShellTiming(340, groundFOV_deg, imageSize),
    computeShellTiming(550, groundFOV_deg, imageSize),
    computeShellTiming(1150, groundFOV_deg, imageSize),
  ];

  // Limiting flash duration is the minimum across all shells
  const minFlash = Math.min(...shells.map(s => s.max_flash_ms));
  // Use conservative 2 ms (< 2.05 ms for 340 km shell)
  const flashDuration = Math.min(minFlash, 2.0);

  const framePeriod = 1000 / targetFrameRate;  // ms
  const dutyCycle = flashDuration / framePeriod;

  return {
    frameRate: targetFrameRate,
    flashDuration_ms: flashDuration,
    dutyCycle,
    groundFOV_deg,
    imageSize,
    shells,
  };
}

/**
 * Pixel drift per frame for a given shell.
 */
export function pixelDriftPerFrame(shell: ShellTimingConfig, frameRate: number): number {
  return shell.drift_px_per_sec / frameRate;
}

/**
 * Apply blink pattern to the color buffer.
 *
 * Sets alpha=255 for satellites in the "on" window, alpha=0 for "off".
 * The blink window is synchronized to the frame time.
 *
 * @param colorBuffer The satellite color buffer to modify
 * @param time Current simulation time (seconds)
 * @param params Blink timing parameters
 */
export function applyBlinkPattern(
  colorBuffer: SatelliteColorBuffer,
  time: number,
  params: BlinkTimingParams,
): void {
  const data = colorBuffer.getData();
  const framePeriod_s = 1.0 / params.frameRate;
  const flashDuration_s = params.flashDuration_ms / 1000;

  // Phase within current frame (0 to framePeriod)
  const phase = time % framePeriod_s;
  const isFlashOn = phase < flashDuration_s;

  if (!isFlashOn) {
    // All satellites dark during off-phase
    // Set alpha to 0 while preserving RGB
    for (let i = 0; i < CONSTANTS.NUM_SATELLITES; i++) {
      data[i] = data[i] & 0x00FFFFFF;  // Zero out alpha byte
    }
  } else {
    // Restore alpha to 255 during flash
    for (let i = 0; i < CONSTANTS.NUM_SATELLITES; i++) {
      data[i] = data[i] | 0xFF000000;  // Set alpha to max
    }
  }
}

/**
 * Log timing model summary to console.
 */
export function logTimingModel(params: BlinkTimingParams): void {
  console.log('═══════════════════════════════════════════════════════');
  console.log('BLINK TIMING MODEL');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Frame rate:       ${params.frameRate} fps`);
  console.log(`Flash duration:   ${params.flashDuration_ms.toFixed(2)} ms`);
  console.log(`Duty cycle:       ${(params.dutyCycle * 100).toFixed(1)}%`);
  console.log(`Ground FOV:       ${params.groundFOV_deg}°`);
  console.log(`Image size:       ${params.imageSize}×${params.imageSize}`);
  console.log('');

  for (const shell of params.shells) {
    console.log(`Shell ${shell.altitude_km} km:`);
    console.log(`  Orbital velocity:    ${shell.orbital_velocity_kms.toFixed(2)} km/s`);
    console.log(`  Ground-track:        ${shell.ground_track_velocity_kms.toFixed(2)} km/s`);
    console.log(`  Pixel pitch:         ${(shell.pixel_pitch_km * 1000).toFixed(1)} m`);
    console.log(`  Drift:               ${shell.drift_px_per_sec.toFixed(1)} px/s`);
    console.log(`  Drift/frame:         ${pixelDriftPerFrame(shell, params.frameRate).toFixed(2)} px`);
    console.log(`  Max flash (0.5px):   ${shell.max_flash_ms.toFixed(2)} ms`);
  }

  console.log('═══════════════════════════════════════════════════════');
}

export default {
  computeBlinkTiming,
  computeShellTiming,
  pixelDriftPerFrame,
  applyBlinkPattern,
  logTimingModel,
};
