# Light Brush

Drag across the fleet and the satellites under the pointer light up in the brush
colour, then fade back over 2–5 s. This is Feature 1 of
[`plans/grok_zephyr_interactive_features.md`](../plans/grok_zephyr_interactive_features.md)
(Light Brush / Orbital Paint).

**It changes how satellites are drawn and nothing else.** No satellite moves, and
there is no gravity, n-body or perturbation model, and no tracking or collision
meaning. `BrushController.test.ts` asserts the HUD copy stays that way.

## URL

| Param | Meaning |
| --- | --- |
| `?brush=0\|1` | Enable the brush. Default off. |
| `?brushMode=point\|spray\|ring` | Brush mode (`plane-ring` is accepted for `ring`). |
| `?brushKm=<n>` | Radius in km, clamped to 50–2000. Default 400. |
| `?brushFade=<s>` | Fade after release, clamped to 2–5 s. Default 3. |
| `?brushColor=rrggbb` | Paint colour. Default `39c8ff`. |

Off by default, forced off on `low` quality and on mobile below `cinematic`
(same rule as ISL and close approaches, and the user's choice survives the
quality change), and unavailable in the WebGL2 fallback — there is no compute pass.

## Input

- **Mouse / pen:** left-drag paints. Shift- or Alt-drag passes through to the
  camera; right-drag pans and the wheel zooms as usual. The click that ends a
  stroke is swallowed, so painting does not select a satellite or reset the view.
- **XR / scripted:** `BrushController.beginRayStroke(origin, dir)`,
  `updateRay`, `endStroke` take a world-space ray in km (for the XR controller
  ray, #158). `window.zephyrBrush.stampNdc(x, y)` / `release()` drive a stroke
  from Playwright.

The pointer ray meets a sphere at the middle procedural shell
(`BRUSH_SHELL_RADIUS_KM` = 6921 km), near side from outside, far side from inside
(Fleet POV, ground). If it misses, for example grazing the limb, the brush falls
back to the screen-space GPU picker (`SatellitePicker`) and paints around the
nearest satellite. The ray is built from the view and projection matrices
separately. With a 10 km near plane and a 500,000 km far plane, the Float32
view × projection product is numerically singular, so it cannot be inverted
reliably.

## Modes

| Mode | Weight per satellite |
| --- | --- |
| Point | `(1 − (d/r)²)²` for distance `d` to the stamp centre, 0 beyond `r`. |
| Spray | Point, but only where a per-frame hash of the satellite index is below 0.2, so holding the brush accumulates sparkle. |
| Ring | The same kernel on the distance to a plane through the hit point, half-width `max(20 km, 0.2 r)`. The plane contains the picked satellite's velocity, so it follows that satellite's orbital plane around the Earth; before the pick resolves it uses the camera up vector instead. |

A fast drag is split into up to 8 stamps per frame, spaced about half a radius apart.

## Storage

Paint lives in the **packed animation scratch** (`animScratch`, 4 bytes per
satellite, the slot Smile V2's `sat_output` uses): rgb = colour (red in the low
byte, `pack4x8unorm` order), a = intensity. The only new GPU allocation is a
288-byte params uniform, created the first time the brush dispatches. No
satellite storage buffer is added and the buffer budget ledger is unchanged.

While the brush holds the scratch, `RenderPipeline` does not dispatch Smile V2.
When the brush is disabled mid-fade, one full-decay dispatch zeroes the scratch
before it is released. The satellite vertex shader reads the scratch at
`@binding(8)` and mixes the paint in. An all-zero scratch is a no-op.

## Decay

Linear, in whole 1/255 steps, with the fractional remainder carried between
frames (`PaintDecayClock`), so a full stroke fades to black in `fadeSeconds` at
any frame rate. Per-frame exponential decay cannot work on 8 bits: once
`a·(1−k)` rounds to zero it never reaches black, and at 144 Hz that happens
well before the end of the fade. The vertex shader applies a smoothstep to the
intensity, so the linear ramp still gets a soft tail on screen.

With no stroke and nothing left fading, the pass is not encoded at all.

## Spatial query

The brush does not use the close-approach spatial hash. It is one GPU gather:
each satellite tests itself against at most 8 stamps, with no CPU loop over
satellites. The conjunction table is allocated lazily and does not fit next to a
1M fleet, and binning a million satellites into it would cost more than the
eight distance tests it saves.

## CPU reference

`src/physics/brushFalloff.ts` is the authority: falloff, spray hash (lowbias32),
8-bit rounding, max-compose, the decay clock, ray/shell intersection, and
`paintFrame`, a whole-dispatch reference. `src/shaders/compute/brush.wgsl`
mirrors it, and `brushFalloff.test.ts` pins the shared constants and uniform
layout. Change both together.

## Visual golden

`tests/visual/webgpu-offscreen.spec.ts` › *Light Brush* captures God View at
`sats=16384` with a stroke held at screen centre, and checks that `?brush=1`
stays off on the `low` preset. Like the other WebGPU offscreen cases, the capture
is black under headless SwiftShader, so the image comparison only means
something on a machine with a real GPU.
