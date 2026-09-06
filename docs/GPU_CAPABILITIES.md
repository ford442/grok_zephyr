# WebGPU capability profile

Boot probes the adapter (and a `low-power` fallback) in `src/core/GpuCapabilities.ts`, then `WebGPUContext` requests **only features a runtime system binds**. Required features default to none; a missing required feature **fails boot** (it is not dropped).

`navigator.gpu.requestAdapter` always passes `featureLevel: 'core'` so a compatibility-mode adapter cannot look like a successful boot and then fail on storage/compute. Device label is `grok-zephyr`; the default queue is `grok-zephyr-queue`.

Shader modules are cached per WGSL source. `getCompilationInfo()` is awaited during `createGpuResources` **before** `startRenderLoop`, so a broken shader fails initialization with a structured `kind: 'shader'` report instead of a lost device on frame 0.

## Feature → effect → fallback (requested)

| Feature | Effect when present | Fallback |
| --- | --- | --- |
| `timestamp-query` | Per-pass GPU timestamps in the performance dashboard | CPU / rAF frame timing |
| `shader-f16` | Half-precision Kawase bloom downsample (`enable f16`) | f32 bloom downsample |
| Depth `depth32float` | Higher-precision scene depth | `depth24plus` when the adapter is a fallback, quality is `low`, or `maxTextureDimension2D < 8192` |
| HDR canvas `rgba16float` | Extended-range presentation (`?hdr=1`, high/cinematic + HDR display) | SDR preferred canvas format, `colorSpace: 'srgb'` |
| Canvas `usage` | `RENDER_ATTACHMENT` only (capture is 2D `drawImage` of the canvas, not a GPU copy into the swapchain) | — |
| Canvas `viewFormats` | sRGB view of `bgra8unorm` / `rgba8unorm` for later UI blending | none on `rgba16float` HDR |
| `?alpha=premultiplied` | Premultiplied swapchain alpha | `opaque` |

## Deferred (not requested)

These names are documented so later systems can add them **explicitly** to `REQUESTED_OPTIONAL_FEATURES`. Device features are frozen at `requestDevice`; enabling a new one requires `recoverContext()` (new adapter/device). Do not silently drop a required feature to make boot succeed.

| Feature | When it will be requested |
| --- | --- |
| `float32-filterable` | rgba32float internals (not used; HDR/bloom stay `rgba16float`) |
| `bgra8unorm-storage` | Storage writes to BGRA8 (not used; capture does not copy into the swapchain) |
| `texture-compression-bc` / `etc2` / `astc` | Photometric Earth maps |
| `subgroups` | Spatial-hash compute |
| `timestamp-query-inside-passes` | Nested GPU timing |

## Adapter + fleet

1. Request `high-performance` with `featureLevel: 'core'`, then `low-power` if needed (or the reverse if `powerPreference` is `low-power`).
2. For each adapter, resolve fleet size (`?sats=` / quality / storage limits). Snapshot includes `maxTextureDimension2D`, `maxComputeInvocationsPerWorkgroup`, and `minStorageBufferOffsetAlignment` (depth-format probe uses the 2D max).
3. Pick the candidate with a usable fleet (prefer larger sat count, then more optional features, then high-performance).

The performance dashboard shows `GPU: vendor / ts+f16 / 262,144* sats` (`*` = auto-reduced). Only requested-and-enabled features appear on that line.
