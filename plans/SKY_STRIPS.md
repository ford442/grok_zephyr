# Sky Strips v2 (shipped)

> v1 (PULSE / CHASE / WAVE / BEAT_SYNC / MORSE / SPARKLE with a 16 B/sat
> pattern buffer, a `skyStripUniforms` buffer and a `PatternSequencer`) never
> shipped and was deleted on purpose. v2 replaces it and allocates **no
> per-satellite buffer**.

A light show on the fleet, driven by time, audio and orbit index. It is not
communications: nothing is encoded, transmitted or addressed to the ground,
and the HUD copy says so (a test asserts it).

## How it runs

- **Storage.** The low 16 bits of the packed animation scratch `animScratch`
  (a8 + RGB332). The Light Brush owns the high 16 bits, so both show at once.
  The bit table is in [`docs/BRUSH.md`](../docs/BRUSH.md#storage); the layout
  is `src/shaders/compute/animScratchPack.wgsl`.
- **Compute.** `src/shaders/compute/skyStrips.wgsl`, one dispatch over the fleet
  per frame while strips are on, `@workgroup_size(256)`,
  `override num_satellites` via `fleetPipelineConstants()`. It reads positions
  and orbital elements and writes only its own half.
- **CPU reference.** `src/physics/skyStrips.ts` is the authority the WGSL mirrors.
  `skyStrips.test.ts` pins the constants, the uniform layout and the "no
  ledger entry" rule.
- **Uniform.** A 64-byte `StripsParams` holding mode, seed, two colours, and the
  pre-reduced phases (wave phase, chase offset, sparkle bucket and fraction),
  bass and presence. Phases are reduced in float64 on the CPU, so the shader
  never multiplies a large f32 time. The ledger counts this block under
  `uniforms`.
- **Clock.** A show clock in real seconds, independent of the sim time scale.

## Patterns

| Mode | Drives | What lights |
|---|---|---|
| `wave` | argument of latitude (along-track phase) | 4 crests per orbit, one passes each satellite per bar (4 beats) |
| `chase` | RAAN (plane index) | 6 bands sweeping round the planes, a bright head with a fading tail |
| `beat` | `AudioEngine` bass band × wave shape; presence picks the colour | dark while audio is muted, locked or suspended |
| `sparkle` | lowbias32 hash of (index, seed, bucket) | about 3% of satellites per 1/8 s, flashing and fading |

The argument of latitude comes from the live position and the plane's RAAN and
inclination, so WAVE follows the satellites in every physics mode.

## Audio

`AudioEngine` taps an `AnalyserNode` (fftSize 1024) after the master gain.
`getBands()` returns the mean of the 20–150 Hz bins (bass) and the 2–5 kHz bins
(presence) as 0..1. It returns `null` while muted or suspended, and BEAT then
draws nothing. There is no beat-detection library; plain FFT bins are enough.

## Controls and policy

- **URL.** `?strips=1&stripsMode=wave|chase|beat|sparkle&stripsBpm=40–240`.
- **HUD.** STRIPS toggle plus a mode select under CONSTELLATION PATTERNS
  (`#strips-controls`). It is independent of SMILE / MATRIX / HEARTBEAT, which
  are vertex-shader patterns and compose underneath.
- **Off by default.** Low quality and mobile force it off, as for ISL and the
  brush. The WebGL2 fallback disables the control (no GLSL port).
- **Reduced motion.** WAVE and CHASE hold still; BEAT and SPARKLE switch off.
- **Turning off.** One CLEAR dispatch zeroes the strips half; after that the
  pass is not encoded.
- **XR.** The pass is not dispatched in XR, so the last strips frame holds.
- **Smile V2.** Writes whole words, so it is not dispatched while strips or the
  brush are using the scratch.

## Verification

- **Unit.** `skyStrips.test.ts`, `animScratchPacking.test.ts`,
  `StripsController.test.ts` and `brushFalloff.test.ts`, which checks that the
  brush preserves the strips half and still decays to 0 with strips off.
- **Visual.** `tests/visual/webgpu-offscreen.spec.ts` › Sky Strips:
  `webgpu-god-strips-wave` at `sats=16384&strips=1&stripsMode=wave` with the
  show clock pinned via `zephyrStrips.setTime(2)`, plus a "stays off on low"
  check.

## Non-goals

- No `PatternSequencer` JSON timelines.
- No 16 MB `patterns` buffer.
- No Morse or text.
- No three.js or audio-reactive libraries.
