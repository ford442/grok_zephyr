# Baseline frames for WebGL2 visual regression tests

Regenerate after intentional rendering changes:

```bash
npx playwright install chromium --with-deps   # once
npm run test:visual:update
```

Commit both `*.png` golden frames and `*.json` metric sidecars.

## View / preset cases (`webgl-views.spec.ts`)

| Baseline | Query | Rebaseline when |
|----------|-------|-----------------|
| `god-view` | `mode=1` | God cinematography, shell LOD, zoom bloom |
| `fleet-pov` | `mode=2` | Fleet POV clarity, motion stretch, cockpit HUD |
| `horizon-720km` | `mode=0` | Horizon limb framing, warm grade, anamorphic bloom |
| `ground-house` | `mode=3&ground=houseWindow` | Ground observer overlay / preset effects |
| `ground-beach` | `mode=3&ground=beachNight` | Beach night preset, scatter, bloom |
| `ground-car` | `mode=3&ground=carWindshield` | Car windshield preset |
| `ground-rooftop` | `mode=3&ground=rooftop` | Rooftop urban glow, window emissives |
| `ground-airplane` | `mode=3&ground=airplaneWindow` | Airplane window preset |
| `moon-view` | `mode=4` | Moon ring scale, earthshine, regolith foreground |
| `skyline` | `mode=5` | Night-city skyline, HDR window cores |

## Pattern harness cases (`webgl-patterns.spec.ts`, tag `@pattern`)

| Baseline | Query | Notes |
|----------|-------|-------|
| `god-chaos-beams` | `mode=1&pattern=0` | CHAOS beam pattern URL wiring |
| `god-grok-beams` | `mode=1&pattern=1` | GROK beam pattern URL wiring |
| `god-x-beams` | `mode=1&pattern=2` | 𝕏 LOGO beam pattern URL wiring |
| `ground-grok-beams` | `mode=3&ground=houseWindow&pattern=1` | Ground View + GROK pattern |
| `horizon-smile` | `mode=0&animation=3` | SMILE animation URL wiring |

### Side-by-side beam pattern capture (WebGPU)

Open these URLs in Cinematic quality for a 3-second A/B comparison:

```
?preset=cinematic&mode=1&pattern=0   # CHAOS — flickering cyan lightning
?preset=cinematic&mode=1&pattern=1   # GROK — green radial sweep + god-rays
?preset=cinematic&mode=1&pattern=2   # 𝕏 LOGO — magenta segmented strokes
```

Ground projection tint: `?preset=cinematic&mode=3&ground=houseWindow&pattern=1`

WebGL2 does not yet render beam volumes or constellation animations; pattern
baselines guard harness stability and luminance structure. Rebaseline when WebGL
pattern parity lands or WebGPU readback tests are added.

## Metric sidecars (`*.json`)

Each JSON file stores tolerance bands:

- `meanLuminance` — scene-wide average (catches bloom floor / washout)
- `brightRatio` — fraction of pixels above 0.85 luminance
- `maxDiffRatio` — max allowed pixel diff vs golden PNG (default 10%)
- `description` — optional human note (pattern cases)

Bands are derived at capture time (±30% luminance, ±40% bright ratio) unless
hand-tuned after review.

## Debugging failures

Failed comparisons write a red-highlight diff to `tests/visual/diffs/<case>-diff.png`
(gitignored). CI uploads these as artifacts when the visual job fails.

## Animation luminance targets (WebGPU)

Documented in `src/core/AnimationTuning.ts` → `ANIMATION_LUMINANCE_TARGETS`.
Per-view `animationIntensity` / `animationContrast` profiles blend during mode
transitions (`src/core/ViewTuningProfile.ts`).
