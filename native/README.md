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

Release flags: `-O3 -flto -msimd128`, `INITIAL_MEMORY=32MiB`, `MAXIMUM_MEMORY=128MiB`, `ALLOW_MEMORY_GROWTH=1`, `ENVIRONMENT=web,worker`.

Debug flags: `-O0 -g`, `ASSERTIONS=1`, `SAFE_HEAP=1` (does not overwrite `public/`).

### Release size (emsdk 6.0.6)

| Artifact | Before LTO (`-O3 -msimd128`) | After LTO (`-O3 -flto -msimd128`) |
| --- | ---: | ---: |
| `public/sgp4.wasm` | 65,404 B | **63,374 B** (−3.1%) |
| `public/sgp4.js` | 11,751 B | 12,471 B (glue + extra exports) |

Speed: LTO is closed-world; batch prop of ~6k TLEs stays in the existing WASM-vs-JS dashboard benchmark (target ≥5× vs `satellite.js`). Re-anchor of 512 sats is intended to stay **≤2 ms on the main thread** when the SGP4 worker is active (copy + GPU upload only).

## API (C)

| Symbol | Description |
|--------|-------------|
| `sgp4_load_catalog(data, byte_length)` | Load packed TLE records (260 bytes each) |
| `sgp4_propagate_batch(unix_ms, out, start_index, count)` | Write `count × 6` floats (pos+vel km, km/s). Errors still zero the state. |
| `sgp4_propagate_batch_ex(..., int* errors, ...)` | Same plus Vallado `satrec.error` per sat (0 = ok, 6 = decayed) |
| `sgp4_catalog_epoch_jd(index)` | TLE epoch Julian date |
| `sgp4_catalog_count()` | Loaded satellite count |
| `sgp4_clear_catalog()` | Free catalog |

Each WASM module instance has its own `g_catalog`. Concurrent catalogs use **separate Worker instances**, not a second C catalog handle.

JS wraps this in `Sgp4WasmEngine` / `Sgp4Worker`. Failed props are flagged in extended-element `flag = −error` (inspector shows “decayed”, GPU falls back to the shell orbit instead of a silent origin).

Prebuilt artifacts are committed; CI rebuilds on `native/**` changes.

## License

Vallado SGP4 sources are distributed under the [AFSPC Open Source Agreement](https://celestrak.com/software/vallado-sw.php). See `LICENSE-AFSPC.txt`.
