# Native SGP4 (Vallado) → WebAssembly

Batch SGP4 propagation using David Vallado's reference C++ implementation, compiled with Emscripten for use in the browser.

## Emscripten pin

CI and local release builds use **emsdk 6.0.6** (`em++`). Install:

```bash
./emsdk install 6.0.6
./emsdk activate 6.0.6
source ./emsdk_env.sh
```

## Build

```bash
npm run build:wasm          # release (default) → public/sgp4.{js,wasm}
npm run build:wasm:debug    # -O0 -g ASSERTIONS=1 → native/out/debug/
```

Release flags (see `native/build.sh`):

```
em++ -std=c++17 -O3 -flto -msimd128 -fno-exceptions -fno-rtti -DNDEBUG
  -s WASM=1 -s MODULARIZE=1 -s EXPORT_ES6=1
  -s ENVIRONMENT=web,worker -s STRICT=1
  -s INCOMING_MODULE_JS_API=['wasmBinary','locateFile','instantiateWasm']
  -s MALLOC=emmalloc
  -s FILESYSTEM=0 -s ASSERTIONS=0
  -s STACK_SIZE=64kb -s ALLOW_MEMORY_GROWTH=1
  -s INITIAL_MEMORY=16MiB -s MAXIMUM_MEMORY=128MiB
  --closure 1
```

`vallado/sgp4unit.cpp` is not rewritten (AFSPC reference). The wrapper is C++17. After `twoline2rv`, the fields `sgp4()` reads are **copied** into aligned SoA (`native/wasm/near_earth_soa.hpp`) plus epoch JD and the epoch mean elements; `elsetrec` is not mutated in-place for packing.

### Single catalog authority

`twoline2rv` here is the app's **only** TLE parser. `sgp4_pack_gpu_elements` packs the physics mode-3 GPU records from the same catalog, so `TlePropagator` never needs a `satellite.js` satrec on the success path — it keeps only the two lines and parses lazily if (and only if) neither WASM nor the Worker comes up. `satellite.js` stays a load-failure fallback and the accuracy oracle in tests.

### Near-earth SIMD kernel

Records with `method == 'n'` propagate through `native/wasm/near_earth_kernel.hpp`, a deep-space-free transcription of Vallado's near-earth branch over the SoA, two satellites at a time on `f64x2` lanes. `method == 'd'` (SDP4) still calls scalar Vallado `sgp4()` on `elsetrec`, which also remains the oracle.

The transcription keeps Vallado's operation order lane-for-lane, so **each lane reproduces scalar `sgp4()` bit for bit**: `f64x2` add/mul/div/sqrt are IEEE-exact per lane, and `sin`/`cos`/`atan2`/`pow`/`fmod` are extracted and called scalar (WASM SIMD has no vector transcendentals). Same-angle `sin`+`cos` pairs go through musl `sincos`, which shares the reduction and polynomials and so is exact against the separate calls. Verified over 30 000 (satellite, epoch) samples spanning 24 h against the previous WASM build: **zero** bit differences in position, velocity, and error code.

Two structural costs had to be paid back before the lanes were worth anything: a paired Kepler iteration must not recompute a converged lane's `sin`/`cos` (otherwise the pair costs `2 x max(iterations)` transcendentals instead of `iter1 + iter2`), and `getgravconst()` is hoisted out of the per-satellite loop rather than re-run per call as Vallado does.

WASM SIMD (`-msimd128`, `native/wasm/simd_pack.hpp`) is also used for batch `tsince`, r/v AoS interleave, TEME→GCRF 3×3 on 4-wide lanes, and Keplerian `hypot3` pairs (`f64x2`). `atan2` / `acos` stay scalar. There is no splat stub.

Debug flags: `-O0 -g`, `ASSERTIONS=1`, `SAFE_HEAP=1` → `native/out/debug/` only (does not overwrite `public/`).

Every build also writes `native/compile_commands.json` (gitignored — absolute paths) so clangd resolves the wrapper headers. There is still no CMake; `native/build.sh` remains the single compile command.

Build fails if `public/sgp4.wasm` exceeds **80 KiB**.

### Release size (emsdk 6.x)

| Artifact | Prior LTO-only | SoA + SIMD pack | Near-earth kernel + GPU packing (current) |
| --- | ---: | ---: | ---: |
| `public/sgp4.wasm` | 63,374 B | 65,427 B | **72,548 B** (70.8 KiB, cap 81,920 B) |
| `public/sgp4.js` | 12,471 B | 4,464 B | **4,531 B** (`--closure 1`) |

The kernel plus `sgp4_pack_gpu_elements` / `sgp4_catalog_method` cost **7,121 B**, leaving 9,372 B under the 80 KiB cap — so the cap is unchanged.

### Speed

Batch prop of 6,000 synthetic TLEs, node 22 / V8, best of 5 x 40 reps, versus the previous scalar-Vallado build:

| Catalog | Previous | Near-earth kernel | Same kernel, scalar lanes |
| --- | ---: | ---: | ---: |
| All near-earth | 3.83 ms | **3.18 ms** (1.20x) | 3.34 ms |
| 12% deep space | 3.94 ms | **3.92 ms** (1.01x) | 3.94 ms |

The honest reading: near-earth SGP4 is transcendental-bound (~15 libm calls per satellite), so 2-wide `f64` lanes cannot do much — about two thirds of the 1.20x is the SoA / `sincos` / hoisted-constants rewrite and roughly 5 points of it is SIMD. Deep-space records get nothing, because they still take the scalar SDP4 path, which is why a mixed catalog barely moves.

The dashboard WASM-vs-JS benchmark target (≥5x vs `satellite.js`) is unchanged. Re-anchor of 512 sats stays **off the main thread** when the SGP4 worker is active: worker calls `sgp4_propagate_batch_keplerian`, main thread copies `HEAPF32` / `queue.writeBuffer` only.

## API (C)

| Symbol | Description |
|--------|-------------|
| `sgp4_load_catalog(data, byte_length)` | Load packed TLE records (260 bytes each) |
| `sgp4_propagate_batch(unix_ms, out, start_index, count)` | Write `count × 6` floats (pos+vel km, km/s TEME). Errors still zero the state. |
| `sgp4_propagate_batch_ex(..., int* errors, ...)` | Same plus Vallado `satrec.error` per sat (0 = ok, 6 = decayed) |
| `sgp4_propagate_batch_keplerian(unix_ms, out, start, count)` | Packed GPU extended elements `count × 8`: `a,e,inc,Ω,ω,M0,n,flag` |
| `sgp4_pack_gpu_elements(base_unix_ms, out, start, count)` | Physics mode-3 GPU records `count × 12` (see `src/physics/sgp4NearEarth.ts`); deep-space and errored slots are zeroed. Returns usable near-earth slots. |
| `sgp4_propagate_epochs(unix_ms[], n, out, start, sat_count)` | Many epochs × a small sat slice (sat-major, then epoch, then 6 floats) |
| `sgp4_teme_to_gcrf(in, out, unix_ms, count)` | Opt-in low-order IAU-76 TEME→GCRF (default render frame stays TEME) |
| `sgp4_catalog_epoch_jd(index)` | TLE epoch Julian date |
| `sgp4_catalog_method(index)` | Vallado branch: `'n'` near-earth SGP4 (gets a GPU slot), `'d'` SDP4 (CPU only), `0` out of range |
| `sgp4_catalog_count()` | Loaded satellite count |
| `sgp4_clear_catalog()` | Free catalog |

Each WASM module instance has its own `g_catalog`. Concurrent catalogs use **separate Worker instances**, not a second C catalog handle.

JS wraps this in `Sgp4WasmEngine` / `Sgp4Worker`. Failed props are flagged in extended-element `flag = −error` (inspector shows “decayed”, GPU falls back to the shell orbit instead of a silent origin).

Deep-space (`'d'`) records never reach the GPU SGP4 kernel — their slot is zeroed and the shader coasts on the Keplerian anchor, which the CPU re-anchor refreshes from Vallado SDP4. The HUD and inspector say which of **GPU SGP4 (LEO)**, **CPU SDP4 (deep space)** and **J2 fallback** a satellite is on; none of it is operational SSA (see `docs/FRAMES.md`).

Prebuilt artifacts are committed; CI rebuilds on `native/**` changes.

## License

Vallado SGP4 sources are distributed under the [AFSPC Open Source Agreement](https://celestrak.com/software/vallado-sw.php). See `LICENSE-AFSPC.txt`.
