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

`vallado/sgp4unit.cpp` is not rewritten (AFSPC reference). The wrapper is C++17. WASM SIMD (`-msimd128`) is enabled for the wrapper TU; Vallado `sgp4()` stays scalar on `elsetrec` so 1e-3 km vs `satellite.js` does not drift. After `twoline2rv`, epochs are packed into a JD SoA (`g_epoch_jd`) and each batch fills r/v SoA scratch for Keplerian packing.

Debug flags: `-O0 -g`, `ASSERTIONS=1`, `SAFE_HEAP=1` → `native/out/debug/` only (does not overwrite `public/`).

Build fails if `public/sgp4.wasm` exceeds **80 KiB**.

### Release size (emsdk 6.x)

| Artifact | Prior LTO-only | Production kernel (`-std=c++17` + emmalloc + Closure + 16 MiB) |
| --- | ---: | ---: |
| `public/sgp4.wasm` | 63,374 B | **~63.5 KiB** (new Keplerian / epochs / TEME→GCRF exports) |
| `public/sgp4.js` | 12,471 B | **~4.3 KiB** (`--closure 1`) |

Speed: batch prop of ~6k TLEs stays in the dashboard WASM-vs-JS benchmark (target ≥5× vs `satellite.js`). Re-anchor of 512 sats stays **off the main thread** when the SGP4 worker is active: worker calls `sgp4_propagate_batch_keplerian`, main thread copies `HEAPF32` / `queue.writeBuffer` only.

## API (C)

| Symbol | Description |
|--------|-------------|
| `sgp4_load_catalog(data, byte_length)` | Load packed TLE records (260 bytes each) |
| `sgp4_propagate_batch(unix_ms, out, start_index, count)` | Write `count × 6` floats (pos+vel km, km/s TEME). Errors still zero the state. |
| `sgp4_propagate_batch_ex(..., int* errors, ...)` | Same plus Vallado `satrec.error` per sat (0 = ok, 6 = decayed) |
| `sgp4_propagate_batch_keplerian(unix_ms, out, start, count)` | Packed GPU extended elements `count × 8`: `a,e,inc,Ω,ω,M0,n,flag` |
| `sgp4_propagate_epochs(unix_ms[], n, out, start, sat_count)` | Many epochs × a small sat slice (sat-major, then epoch, then 6 floats) |
| `sgp4_teme_to_gcrf(in, out, unix_ms, count)` | Opt-in low-order IAU-76 TEME→GCRF (default render frame stays TEME) |
| `sgp4_catalog_epoch_jd(index)` | TLE epoch Julian date |
| `sgp4_catalog_count()` | Loaded satellite count |
| `sgp4_clear_catalog()` | Free catalog |

Each WASM module instance has its own `g_catalog`. Concurrent catalogs use **separate Worker instances**, not a second C catalog handle.

JS wraps this in `Sgp4WasmEngine` / `Sgp4Worker`. Failed props are flagged in extended-element `flag = −error` (inspector shows “decayed”, GPU falls back to the shell orbit instead of a silent origin).

Prebuilt artifacts are committed; CI rebuilds on `native/**` changes.

## License

Vallado SGP4 sources are distributed under the [AFSPC Open Source Agreement](https://celestrak.com/software/vallado-sw.php). See `LICENSE-AFSPC.txt`.
