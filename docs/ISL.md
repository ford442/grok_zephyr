# Inter-satellite optical mesh (ISL)

Thin cyan/white **fiber** links along the orbital shell. Separate from ground-projection beams (CHAOS / GROK / 𝕏) and from conjunction connectors.

## Budget

| Item | Size |
| --- | --- |
| Max links | **131,072** (128k) |
| Buffer | 128k × 32 B = **4 MiB** |
| Emitters | ≤ 65,536 sats × 2 directed edges |
| Dispatch | 1,024 workgroups × 64 threads |

Quality **high** default density 0.35 → about **~45k** surviving hash-kept links. The GPU still reserves the full 4 MiB.

Low quality and most mobile presets **auto-disable** the mesh (`applyIslForQuality`).

## Topology

- **Walker / procedural:** same-plane `slot+1` and next-plane same slot (no O(n²) search).
- **TLE realism:** ring among the first `tleRealCount` sats (`i+1` and `i+N/32`).

Range cull at 5,500 km. Focused sat (`focus_index`) boosts its links and runs a packet pulse.

## Toggle

UI **ISL MESH** + density slider. Does not write into the 64k pattern-beam buffer.
