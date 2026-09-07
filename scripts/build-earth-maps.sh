#!/usr/bin/env bash
#
# Build the KTX2 Earth map set in public/earth/ from NASA source imagery.
#
# Build-time only. The runtime ships the resulting .ktx2 files plus the Basis
# transcoder wasm (public/basis/) — no encoder, no image decode at load.
#
# Requirements:
#   ktx      KTX-Software >= 4.4 CLI  (https://github.com/KhronosGroup/KTX-Software/releases)
#            Override the binary with KTX_BIN=/path/to/ktx
#   convert  ImageMagick (resampling the source JPEGs to power-of-two equirect)
#
# Encoding: ETC1S (basis-lz supercompression). The runtime transcodes to BC7 /
# ETC2 / ASTC per adapter, falling back to rgba8unorm. ETC1S was chosen over
# UASTC on size: 2K albedo is 359 KB vs 2.2 MB for UASTC at 32.8 dB PSNR, which
# holds up at every altitude the camera reaches. See docs/EARTH_MAPS.md.

set -euo pipefail

KTX="${KTX_BIN:-ktx}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/public/earth"
SRC="${EARTH_MAP_SRC:-$(mktemp -d)}"

command -v "$KTX" >/dev/null || { echo "error: 'ktx' not found; set KTX_BIN=/path/to/ktx" >&2; exit 1; }
command -v convert >/dev/null || { echo "error: ImageMagick 'convert' not found" >&2; exit 1; }

mkdir -p "$OUT" "$SRC"

# --- sources ---------------------------------------------------------------
# Blue Marble Next Generation, topography + bathymetry, December 2004.
ALBEDO_URL="https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x5400x2700.jpg"
# Earth at Night 2012 (VIIRS DNB), land/ocean/ice composite.
NIGHT_URL="https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.3600x1800.jpg"
# MODIS cloud fraction composite.
CLOUD_URL="https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg"

fetch() {
  local url="$1" dest="$SRC/$(basename "$1")"
  if [ ! -s "$dest" ]; then
    echo "fetch $(basename "$url")"
    curl -sS -L -o "$dest" "$url"
  fi
  echo "$dest"
}

# encode <source-image> <width> <height> <output-name>
#
# --assign-tf srgb: 8-bit PNG carries no transfer function and ktx would only
# warn and guess. Say it explicitly so the KTX2 DFD matches the *-srgb GPU
# formats the runtime transcodes into.
encode() {
  local src="$1" w="$2" h="$3" name="$4"
  local tmp="$SRC/${name}.png"
  convert "$src" -resize "${w}x${h}!" -strip "png24:$tmp"
  "$KTX" create \
    --format R8G8B8_SRGB \
    --assign-tf srgb \
    --encode basis-lz --clevel 4 --qlevel 200 \
    --generate-mipmap \
    "$tmp" "$OUT/${name}.ktx2"
  printf '  %-16s %sx%-5s %6s KB\n' "${name}.ktx2" "$w" "$h" \
    "$(( ( $(stat -c %s "$OUT/${name}.ktx2") + 1023 ) / 1024 ))"
}

albedo="$(fetch "$ALBEDO_URL")"
night="$(fetch "$NIGHT_URL")"
cloud="$(fetch "$CLOUD_URL")"

echo "encoding to $OUT"
encode "$albedo" 1024 512  albedo_1k
encode "$albedo" 2048 1024 albedo_2k
encode "$albedo" 4096 2048 albedo_4k
encode "$night"  1024 512  night_1k
encode "$night"  2048 1024 night_2k
encode "$cloud"  2048 1024 clouds_2k

echo "total: $(du -sh "$OUT" | cut -f1)"
