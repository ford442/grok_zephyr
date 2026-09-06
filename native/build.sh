#!/usr/bin/env bash
# Build Vallado SGP4 WASM module (catalog propagator only — no GPU/DOM).
#   native/build.sh          # release → public/sgp4.{js,wasm}
#   native/build.sh release
#   native/build.sh debug    # assertions + DWARF → native/out/debug/ (does not touch public/)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE="$ROOT/native"
PROFILE="${1:-release}"
WASM_MAX_BYTES="${WASM_MAX_BYTES:-81920}"

EXPORTS='["_sgp4_load_catalog","_sgp4_propagate_batch","_sgp4_propagate_batch_ex","_sgp4_propagate_batch_keplerian","_sgp4_propagate_epochs","_sgp4_teme_to_gcrf","_sgp4_catalog_epoch_jd","_sgp4_catalog_count","_sgp4_clear_catalog","_malloc","_free"]'
RUNTIME='["ccall","cwrap","HEAPF32","HEAPF64","HEAPU8","HEAP32"]'
COMMON=(
  -std=c++17
  -fno-exceptions
  -fno-rtti
  "$NATIVE/vallado/sgp4unit.cpp"
  "$NATIVE/vallado/sgp4io.cpp"
  "$NATIVE/vallado/sgp4ext.cpp"
  "$NATIVE/wasm/sgp4_wasm.cpp"
  -I "$NATIVE/vallado"
  -I "$NATIVE/wasm"
  -DSGP4_ENABLE_TEME_GCRF=1
  -s WASM=1
  -s MODULARIZE=1
  -s EXPORT_ES6=1
  -s ENVIRONMENT=web,worker
  -s EXPORTED_FUNCTIONS="$EXPORTS"
  -s EXPORTED_RUNTIME_METHODS="$RUNTIME"
  -s FILESYSTEM=0
  -s STRICT=1
  -s INCOMING_MODULE_JS_API=['wasmBinary','locateFile','instantiateWasm']
  -s MALLOC=emmalloc
  -s STACK_SIZE=65536
  -s ALLOW_MEMORY_GROWTH=1
  -s MAXIMUM_MEMORY=134217728
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
    -s INITIAL_MEMORY=33554432 \
    -s ASSERTIONS=1 \
    -s SAFE_HEAP=1
  echo "Built debug $OUT_DIR/sgp4.js and $OUT_DIR/sgp4.wasm (public/ unchanged)"
  wc -c "$OUT_DIR/sgp4.wasm" "$OUT_DIR/sgp4.js"
  exit 0
fi

if [[ "$PROFILE" != "release" ]]; then
  echo "usage: $0 [release|debug]" >&2
  exit 1
fi

OUT="$ROOT/public"
mkdir -p "$OUT"

# Release: LTO + WASM SIMD ISA, no assertions, small arena, shrink JS glue.
# --closure 1 is attempted; if Emscripten rejects it with EXPORT_ES6, we retry without.
RELEASE_EXTRA=(
  -O3
  -flto
  -msimd128
  -DNDEBUG
  -s INITIAL_MEMORY=16777216
  -s ASSERTIONS=0
)

set +e
em++ "${RELEASE_EXTRA[@]}" \
  "${COMMON[@]}" \
  --closure 1 \
  -o "$OUT/sgp4.js"
CLOSURE_STATUS=$?
set -e

if [[ "$CLOSURE_STATUS" -ne 0 ]]; then
  echo "warning: --closure 1 failed; rebuilding without Closure" >&2
  em++ "${RELEASE_EXTRA[@]}" \
    "${COMMON[@]}" \
    -o "$OUT/sgp4.js"
fi

echo "Built release $OUT/sgp4.js and $OUT/sgp4.wasm"
wc -c "$OUT/sgp4.wasm" "$OUT/sgp4.js"

WASM_BYTES="$(wc -c < "$OUT/sgp4.wasm" | tr -d ' ')"
if [[ "$WASM_BYTES" -gt "$WASM_MAX_BYTES" ]]; then
  echo "error: public/sgp4.wasm is ${WASM_BYTES} bytes (limit ${WASM_MAX_BYTES}). Trim exports or flags." >&2
  exit 1
fi
