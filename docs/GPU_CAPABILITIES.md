# WebGPU capability profile

Boot probes the adapter (and a `low-power` fallback) in `src/core/GpuCapabilities.ts`, then `WebGPUContext` requests **only supported** features. Required features default to none.

## Feature → effect → fallback

| Feature | Effect when present | Fallback |
| --- | --- | --- |
| `timestamp-query` | Per-pass GPU timestamps in the performance dashboard | CPU / rAF frame timing |
| `shader-f16` | Half-precision Kawase bloom downsample (`enable f16`) | f32 bloom downsample |
| `float32-filterable` | Linear filter on `rgba32float` (reserved for HDR internals) | Stay on `rgba16float` HDR/bloom targets |
| `bgra8unorm-storage` | Storage writes to BGRA8 textures | No storage on `bgra8unorm` |
| Depth `depth32float` | Higher-precision scene depth | `depth24plus` when the adapter is a fallback, quality is `low`, or `maxTextureDimension2D < 8192` |
| HDR canvas `rgba16float` | Extended-range presentation (`?hdr=1`, high/cinematic + HDR display) | SDR preferred canvas format |
| Canvas `usage` | `RENDER_ATTACHMENT \| COPY_DST \| COPY_SRC` for 4K capture | — |
| `?alpha=premultiplied` | Premultiplied swapchain alpha | `opaque` |

## Adapter + fleet

1. Request `high-performance`, then `low-power` if needed (or the reverse if `powerPreference` is `low-power`).
2. For each adapter, resolve fleet size (`?sats=` / quality / storage limits).
3. Pick the candidate with a usable fleet (prefer larger sat count, then more optional features, then high-performance).

The performance dashboard shows `GPU: vendor / ts+f16 / 262,144* sats` (`*` = auto-reduced).
