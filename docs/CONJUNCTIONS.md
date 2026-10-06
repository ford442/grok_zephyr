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
same cell or one of the 26 neighbours. The table is a **counting sort**, so no
bucket has a capacity: every active satellite in the fleet is hashed, and none
is dropped.

1. `clear_bins` — zero the bucket counts and the frame counters.
2. `count_sats` — hash each satellite's cell into a bucket, `atomicAdd` its count.
3. `scan_blocks` / `scan_block_sums` / `add_block_offsets` — exclusive prefix
   sum of the counts → each bucket's offset into one dense `sorted[N]` array
   (1024 buckets per workgroup, then one workgroup over the ≤ 512 block sums).
4. `scatter_sats` — `atomicAdd` a cursor in the offsets and write the satellite
   index into `sorted`. Afterwards each offset is its bucket's **end**.
5. `find_pairs` — walk the 27-cell neighbourhood over
   `sorted[end − count, end)`, distance test, append pairs.

Skips unlaunched satellites (exactly-zero position, growth era) and decayed ones
(negative `w` flag).

`src/physics/conjunctionHash.ts` is the CPU reference and the authority for the
hash; the WGSL mirrors it and the unit tests pin them together, including
negative cell coordinates and u32 wrap-around. `exclusiveScanBlocked` mirrors
the three scan dispatches and is checked against a sequential scan up to 2^19
buckets. The reference is cross-checked against brute-force O(n²) on a
randomised cloud, on a 64-bucket table that forces heavy hash collisions, and on
a 64-satellite single-cell cluster (all 2,016 pairs), so the neighbour walk is
known to find what an exhaustive search finds. A test also plants a pair past
index 131,072, where the old prefix scan stopped.

Two details that are easy to get wrong and are tested:

- **Each pair once.** Emitted only when `i < j`.
- **Hash collisions do not double-count.** Two different neighbour cells can
  land in one bucket, so a candidate is confirmed to actually live in the cell
  being visited before the distance test. Without that check a collision emits
  the same pair twice.

### `subgroups`

The prefix sum has two interchangeable modules:

- `conjunctionScan.wgsl` — Hillis-Steele in workgroup memory. Runs everywhere.
- `conjunctionScanSubgroups.wgsl` — `enable subgroups;`, `subgroupExclusiveAdd`
  per subgroup, then subgroup totals chained in workgroup memory. WGSL does not
  promise subgroups are contiguous runs of `local_invocation_index`, so each
  workgroup checks, and falls back to Hillis-Steele if they are not.

Both give identical offsets, so the pair set does not depend on the feature —
only the scan's speed does. Device features are frozen at `requestDevice` (the
same rule as the Earth-map `texture-compression-*` set), so `bootWebGPU` asks
for `subgroups` **only** when `?ca=1` is in the URL and quality does not force
the overlay off (`conjunctionOptionalFeatures`). `?ca=0`, no `?ca`, `low`
quality and mobile below `cinematic` never request it. Turning the pass on later
from the panel, or an adapter without the feature, uses the workgroup scan. The
pipeline module is chosen by `device.features.has('subgroups')`, so the
`enable` directive is never compiled on a device without it.

## Buffer budget

`calculateSatelliteBufferBudget` is the single ledger (uniforms included) used by
allocation, `assertBufferBudget`, `getMemoryUsage` and this pass.

The table is `B = nextPow2(N)` buckets, clamped to 2^12–2^19:

| Buffer | Size at 1M |
| --- | --- |
| `binCounts` (B × 4) | 2 MB |
| `binOffsets` (B × 4) | 2 MB |
| `sorted` (N × 4) | 4 MB |
| `blockSums` (B / 1024 × 4) | 2 KB |
| pairs (4096 × 32) | 128 KB |
| **Total** | **8.13 MB** |

| Fleet | Satellite buffers | Free | Conjunction pass |
| --- | --- | --- | --- |
| 262,144 | ~26 MB | ~102 MB | 3.1 MB |
| 1,048,576 (high) | ~84 MB | ~44 MB | 8.1 MB — fits |
| 1,048,576 (cinematic) | ~116 MB | ~12 MB | 8.1 MB — fits |

The buffers are still allocated **on first enable, never at boot**, measured
against the buffers actually allocated. If they do not fit (for example
`doubleBuffer` ping-pong plus cinematic trails at 1M, which already exceeds the
cap), the feature declines and the HUD reports the real free bytes; a test pins
that decline.

At 1M the table holds ~2 satellites per bucket on average. A fuller table only
lengthens the neighbour walk — it cannot drop anyone.

## Reading the HUD

`Close pairs: ≥4,096 · scanned 1,048,576/1,048,576 · Approximate`

- `≥` prefix — the 4,096-pair buffer filled, so the count is a floor. At 1M
  with a 5 km threshold the procedural shells usually fill it.
- `scanned N/N` — always shown, so the count never appears without its
  denominator. The scan covers the whole fleet.
- `Approximate` — always present. See the frames caveat above.

## Cost

`?debug` plus `timestamp-query` reports the pass as `conjunction` in the
detailed timings, and it reads zero on any frame the feature is off — "off costs
nothing" is measurable, not asserted. When disabled, `FrameLoop` encodes no
dispatches, binds no resources and queues no readback.

The performance dashboard shows a **Close pairs** row while the pass runs:
`hashed <binned>/<fleet> · <ms>`. `binned` is the active satellites the GPU
actually counted (read back with the pair count), so unlaunched and decayed
slots make it read below the fleet size; it is the coverage measured on the
GPU, set against the pass's GPU time.

The dominant cost is the neighbour walk: 27 bucket loads per satellite plus the
positions of the candidates they hold. The scan and scatter are linear. The
target is under 2 ms at desktop scale; 1M is now measurable.

## Density overlay

One instance per bucket, positioned at a representative satellite from that
bucket (`sorted[end − count]`) and coloured by occupancy on a **viridis** ramp,
saturating at 8 satellites per bucket. Viridis rather than a
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
| `src/shaders/compute/conjunction.wgsl` | `clear_bins` / `count_sats` / `scatter_sats` / `find_pairs` |
| `src/shaders/compute/conjunctionScan*.wgsl` | Bucket prefix sum — workgroup and `subgroups` variants |
| `src/shaders/render/conjunction.wgsl` | Amber→red pair markers, pulsed |
| `src/shaders/render/conjunctionDensity.ts` | Viridis occupancy overlay |
| `src/render/ConjunctionBuffers.ts` | Lazy allocation + budget guard + readback |
| `src/render/passes/ConjunctionPass.ts` | Pass encoders |
| `src/app/ConjunctionController.ts` | Toggle, threshold, quality policy, HUD copy, `subgroups` request |
| `src/types/conjunction.ts` | Caps and budget arithmetic |
