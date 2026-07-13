#!/usr/bin/env bash
# Build Vallado SGP4 WASM module into public/sgp4.wasm + public/sgp4.js
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE="$ROOT/native"
OUT="$ROOT/public"

if ! command -v emcc >/dev/null 2>&1; then
  echo "error: emcc not found. Install Emscripten (emsdk) and run: source emsdk_env.sh" >&2
  exit 1
fi

mkdir -p "$OUT"

emcc -O3 -msimd128 \
  "$NATIVE/vallado/sgp4unit.cpp" \
  "$NATIVE/vallado/sgp4io.cpp" \
  "$NATIVE/vallado/sgp4ext.cpp" \
  "$NATIVE/wasm/sgp4_wasm.cpp" \
  -I "$NATIVE/vallado" \
  -o "$OUT/sgp4.js" \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_sgp4_load_catalog","_sgp4_propagate_batch","_sgp4_catalog_count","_sgp4_clear_catalog","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","HEAPF32","HEAPU8"]' \
  -s FILESYSTEM=0 \
  -s ASSERTIONS=0

echo "Built $OUT/sgp4.js and $OUT/sgp4.wasm"
