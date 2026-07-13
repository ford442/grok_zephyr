# Native SGP4 (Vallado) → WebAssembly

Batch SGP4 propagation using David Vallado's reference C++ implementation, compiled with Emscripten for use in the browser.

## Build

Requires [Emscripten](https://emscripten.org/) (`emsdk`):

```bash
source /path/to/emsdk/emsdk_env.sh
npm run build:wasm
```

Outputs:

- `public/sgp4.wasm`
- `public/sgp4.js` (ES module factory)

Prebuilt artifacts are committed so contributors without Emscripten can run the app; CI rebuilds them on changes under `native/`.

## API (C)

| Symbol | Description |
|--------|-------------|
| `sgp4_load_catalog(data, byte_length)` | Load packed TLE records (260 bytes each) |
| `sgp4_propagate_batch(unix_ms, out, start_index, count)` | Write `count × 6` floats (pos+vel km, km/s) |
| `sgp4_catalog_count()` | Loaded satellite count |
| `sgp4_clear_catalog()` | Free catalog |

## License

Vallado SGP4 sources are distributed under the [AFSPC Open Source Agreement](https://celestrak.com/software/vallado-sw.php). See `LICENSE-AFSPC.txt`.
