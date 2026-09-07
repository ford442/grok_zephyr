# WebGPU capability profile

Boot probes the adapter (and a `low-power` fallback) in `src/core/GpuCapabilities.ts`, then `WebGPUContext` requests **only features a runtime system binds**. Required features default to none; a missing required feature **fails boot** (it is not dropped).

`navigator.gpu.requestAdapter` always passes `featureLevel: 'core'` so a compatibility-mode adapter cannot look like a successful boot and then fail on storage/compute. Device label is `grok-zephyr`; the default queue is `grok-zephyr-queue`.

Shader modules are cached per WGSL source. `getCompilationInfo()` is awaited during `createGpuResources` **before** `startRenderLoop`, so a broken shader fails initialization with a structured `kind: 'shader'` report instead of a lost device on frame 0.

## Feature → effect → fallback (requested)

| Feature | Effect when present | Fallback |
| --- | --- | --- |
| `timestamp-query` | Per-pass GPU timestamps in the performance dashboard | CPU / rAF frame timing |
| `shader-f16` | Half-precision Kawase bloom downsample (`enable f16`) | f32 bloom downsample |
| `texture-compression-bc` / `astc` / `etc2` | BC7 / ASTC 4x4 / ETC2 Earth plates. **Requested only when `?earthmap=` selects a tier** — see below | Uncompressed `rgba8unorm-srgb`, clamped to the 1K plates |
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
| `subgroups` | Spatial-hash compute |
| `timestamp-query-inside-passes` | Nested GPU timing |

## Texture memory

Render targets and the atmosphere LUT scale with resolution and are unchanged. The photometric Earth plates (`?earthmap=`, [EARTH_MAPS.md](EARTH_MAPS.md)) are the only large sampled textures, and they are **off by default**:

| Tier | Plates | Compressed | Uncompressed fallback |
| --- | --- | --- | --- |
| *(default)* | 1x1 placeholders | ~0 | ~0 |
| `low` | 1K albedo | 0.67 MB | 2.7 MB |
| `balanced` | 2K albedo + 1K lights | 3.3 MB | 5.3 MB |
| `high` | 4K albedo + 2K lights + 2K clouds | 16.0 MB | 5.3 MB |

Totals include mip chains, which stop at 4x4 (a 2:1 equirect reaches height 2 before width 4, and no block format can hold that). On an adapter with no block format the tier is clamped to the 1K plates and the cloud sheet is dropped, so an uncompressed 4K plate — ~65 MB — never happens.

This is **separate from the satellite storage-buffer budget**: the plates are sampled textures and take nothing from `maxStorageBufferBindingSize`. `[EarthTextures]` logs the tier, chosen format and measured total at boot.

Because device features are frozen at `requestDevice`, the compression features cannot be added when the first `.ktx2` arrives. `bootWebGPU` resolves the tier from the URL **before** creating the device and appends the three names to the requested optional set only when a tier is selected.

## Adapter + fleet

1. Request `high-performance` with `featureLevel: 'core'`, then `low-power` if needed (or the reverse if `powerPreference` is `low-power`).
2. For each adapter, resolve fleet size (`?sats=` / quality / storage limits). Snapshot includes `maxTextureDimension2D`, `maxComputeInvocationsPerWorkgroup`, and `minStorageBufferOffsetAlignment` (depth-format probe uses the 2D max).
3. Pick the candidate with a usable fleet (prefer larger sat count, then more optional features, then high-performance).

The performance dashboard shows `GPU: vendor / ts+f16 / 262,144* sats` (`*` = auto-reduced). Only requested-and-enabled features appear on that line.
