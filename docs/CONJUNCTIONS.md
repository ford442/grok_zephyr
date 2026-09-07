# Close approaches

A GPU spatial-hash pass that highlights satellite pairs closer than a threshold,
plus a heat overlay of how crowded each cell is.

**This is a congestion visualization, not space situational awareness.** It has
no covariance, no CDMs, no screening volumes, and no maneuver logic. The UI says
so in every state; `ConjunctionController.test.ts` asserts the copy never claims
operational collision avoidance.

| Mode | What a pair count means |
| --- | --- |
| Procedural Walker shells (default) | A property of the art-directed shell spacing. Illustrative only. |
| `?tle=…` + realism | SGP4-anchored real orbits — still not conjunction-grade. TEME is treated as GCRF, which [FRAMES.md](FRAMES.md) puts at tens of arcseconds, occasionally ~1 arcminute. |

## URL

| Param | Meaning |
| --- | --- |
| `?ca=0\|1` | Enable the pass. Default off. |
| `?caKm=<n>` | Threshold in km, clamped to 0.5–100. |
| `?caDensity=0\|1` | Shell-density heat overlay. Default off. |

Off by default, forced off on `low` quality and on mobile below `cinematic`
(same rule as ISL), and unavailable in the WebGL2 fallback — there is no GLSL
port, and the control is disabled rather than left inert.

## Algorithm

Cell size **is** the threshold, so a pair within the threshold is always in the
same cell or one of the 26 neighbours.

1. `clear_bins` — zero the bucket counts and the frame counters.
2. `bin_sats` — hash each satellite's cell into a bucket, `atomicAdd` a slot.
3. `find_pairs` — walk the 27-cell neighbourhood, distance test, append pairs.

Skips unlaunched satellites (exactly-zero position, growth era) and decayed ones
(negative `w` flag).

`src/physics/conjunctionHash.ts` is the CPU reference and the authority for the
hash; the WGSL mirrors it and the unit tests pin them together, including
negative cell coordinates and u32 wrap-around. The reference is cross-checked
against brute-force O(n²) on a randomised cloud, so the neighbour walk is known
to find what an exhaustive search finds.

Two details that are easy to get wrong and are tested:

- **Each pair once.** Emitted only when `i < j`.
- **Hash collisions do not double-count.** Two different neighbour cells can
  land in one bucket, so a candidate is confirmed to actually live in the cell
  being visited before the distance test. Without that check a collision emits
  the same pair twice.

No `subgroups`. Plain `atomicAdd` is enough, and requesting an optional device
feature no system binds would violate the used-only policy in
[GPU_CAPABILITIES.md](GPU_CAPABILITIES.md).

## Buffer budget — the binding constraint

`calculateSatelliteBufferBudget` at a 1M fleet already reaches **128.00 MB**,
which is the Pascal safe cap exactly. (`BufferAllocator.ts` still describes this
as "~118 MB"; that comment is stale.)

| Fleet | Satellite buffers | Free | Conjunction pass |
| --- | --- | --- | --- |
| 16,384 | 7.9 MB | 120.1 MB | 1.2 MB |
| 262,144 | 36.5 MB | 91.5 MB | 9.1 MB |
| 524,288 | 67.0 MB | 61.0 MB | 9.1 MB |
| 1,048,576 | 128.0 MB | **0.0 MB** | **refused** |

So the buffers are allocated **on first enable, never at boot**, and the feature
declines with a reason in the HUD when they do not fit rather than tripping
`assertBufferBudget`. At a 1M fleet the honest answer is "use a smaller
`?sats=`", and that is what the status line says.

Above 131,072 satellites the hash table saturates, so the scan covers a prefix
of the fleet and the HUD reports `scanned 131,072/1,048,576`. A strided sample
would be worse — it can split a close pair across the sample boundary and report
zero.

## Reading the HUD

`Close pairs: 42 · scanned 131,072/1,048,576 · 900 dropped (dense cells) · Approximate`

- `≥` prefix — the 4,096-pair buffer filled, so the count is a floor.
- `dropped (dense cells)` — buckets overflowed their 8 slots. Overflow is
  reported rather than swallowed, because the satellites it drops are exactly
  the crowded ones a congestion view is about; a thin result would otherwise
  look like a quiet sky.
- `Approximate` — always present. See the frames caveat above.

## Cost

`?debug` plus `timestamp-query` reports the pass as `conjunction` in the
detailed timings, and it reads zero on any frame the feature is off — "off costs
nothing" is measurable, not asserted. When disabled, `FrameLoop` encodes no
dispatches, binds no resources and queues no readback.

The dominant cost is the neighbour walk: 27 bucket loads per satellite plus the
positions of the candidates they hold. The target is under 2 ms at desktop
scale, but see the budget table — at 1M the feature does not run at all, so the
largest configuration it can be measured at is 524,288.

## Density overlay

One instance per bucket, positioned at a representative satellite from that
bucket and coloured by occupancy on a **viridis** ramp. Viridis rather than a
red/green heat ramp because it is monotonic in lightness (0.09 → 0.87 relative
luminance across the ramp), so the ordering survives greyscale and every common
form of colour blindness — the cue is not hue alone.

Cells are threshold-sized, so it reads as local crowding rather than whole-shell
density. That is the honest thing for it to show, since it is built from the
same cells the pair test uses.

## Files

| File | Role |
| --- | --- |
| `src/physics/conjunctionHash.ts` | CPU reference — hash authority, brute-force-checked |
| `src/shaders/compute/conjunction.ts` | `clear_bins` / `bin_sats` / `find_pairs` |
| `src/shaders/render/conjunction.ts` | Amber→red pair markers, pulsed |
| `src/shaders/render/conjunctionDensity.ts` | Viridis occupancy overlay |
| `src/render/ConjunctionBuffers.ts` | Lazy allocation + budget guard + readback |
| `src/render/passes/ConjunctionPass.ts` | Pass encoders |
| `src/app/ConjunctionController.ts` | Toggle, threshold, quality policy, HUD copy |
| `src/types/conjunction.ts` | Caps and budget arithmetic |
