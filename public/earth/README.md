# Earth maps

KTX2 / ETC1S plates built by `scripts/build-earth-maps.sh`. Loaded only when
`?earthmap=` selects a tier — see [docs/EARTH_MAPS.md](../../docs/EARTH_MAPS.md).

| File | Source | Credit |
| --- | --- | --- |
| `albedo_{1k,2k,4k}.ktx2` | [Blue Marble Next Generation, topography + bathymetry, Dec 2004](https://visibleearth.nasa.gov/images/73909/december-blue-marble-next-generation-w-topography-and-bathymetry) | NASA Earth Observatory (Reto Stöckli) |
| `night_{1k,2k}.ktx2` | [Earth at Night 2012, VIIRS DNB land/ocean/ice composite](https://visibleearth.nasa.gov/images/79765/night-lights-2012-map) | NASA Earth Observatory (Miguel Román / NOAA) |
| `clouds_2k.ktx2` | [MODIS cloud fraction composite](https://visibleearth.nasa.gov/images/57747/blue-marble-clouds) | NASA Earth Observatory |

NASA imagery is public domain; credit "NASA Earth Observatory". Sources are
fetched at build time and are not committed — only the encoded `.ktx2`.
