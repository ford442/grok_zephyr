#!/usr/bin/env bash
# Build Vallado SGP4 WASM module.
#   native/build.sh          # release → public/sgp4.{js,wasm}
#   native/build.sh release
#   native/build.sh debug    # assertions + DWARF → native/out/debug/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE="$ROOT/native"
PROFILE="${1:-release}"

EXPORTS='["_sgp4_load_catalog","_sgp4_propagate_batch","_sgp4_propagate_batch_ex","_sgp4_catalog_epoch_jd","_sgp4_catalog_count","_sgp4_clear_catalog","_malloc","_free"]'
RUNTIME='["ccall","cwrap","HEAPF32","HEAPU8","HEAP32"]'
COMMON=(
  "$NATIVE/vallado/sgp4unit.cpp"
  "$NATIVE/vallado/sgp4io.cpp"
  "$NATIVE/vallado/sgp4ext.cpp"
  "$NATIVE/wasm/sgp4_wasm.cpp"
  -I "$NATIVE/vallado"
  -s WASM=1
  -s MODULARIZE=1
  -s EXPORT_ES6=1
  -s ENVIRONMENT=web,worker
  -s EXPORTED_FUNCTIONS="$EXPORTS"
  -s EXPORTED_RUNTIME_METHODS="$RUNTIME"
  -s FILESYSTEM=0
)

if ! command -v em++ >/dev/null 2>&1; then
  echo "error: em++ not found. Install Emscripten (emsdk) and run: source emsdk_env.sh" >&2
  exit 1
fi

echo "em++ $(em++ --version | head -n1)"

if [[ "$PROFILE" == "debug" ]]; then
  OUT_DIR="$NATIVE/out/debug"
  mkdir -p "$OUT_DIR"
  em++ -O0 -g \
    "${COMMON[@]}" \
    -o "$OUT_DIR/sgp4.js" \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=33554432 \
    -s MAXIMUM_MEMORY=134217728 \
    -s ASSERTIONS=1 \
    -s SAFE_HEAP=1
  echo "Built debug $OUT_DIR/sgp4.js and $OUT_DIR/sgp4.wasm"
  exit 0
fi

if [[ "$PROFILE" != "release" ]]; then
  echo "usage: $0 [release|debug]" >&2
  exit 1
fi

OUT="$ROOT/public"
mkdir -p "$OUT"

em++ -O3 -flto -msimd128 \
  "${COMMON[@]}" \
  -o "$OUT/sgp4.js" \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=33554432 \
  -s MAXIMUM_MEMORY=134217728 \
  -s ASSERTIONS=0

echo "Built release $OUT/sgp4.js and $OUT/sgp4.wasm"
wc -c "$OUT/sgp4.wasm" "$OUT/sgp4.js"
