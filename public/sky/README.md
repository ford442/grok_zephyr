# Sky catalog

Star catalog built by `scripts/build-sky-catalog.mjs`. Loaded only when
`?sky=hip` (or `?sky=auto` on high/cinematic) selects it. See
[docs/SKY.md](../../docs/SKY.md).

| File | Source | Credit |
| --- | --- | --- |
| `hip_v65.bin` | [The Hipparcos Main Catalogue, CDS I/239](https://cdsarc.cds.unistra.fr/viz-bin/cat/I/239) (`hip_main.dat`): all 8,874 entries with V ≤ 6.5 | ESA 1997, *The Hipparcos and Tycho Catalogues*, ESA SP-1200 |

Positions are ICRS. They are moved from the catalogue epoch J1991.25 to J2000
using the Hipparcos proper motions. Each record keeps only the unit direction,
V magnitude and B−V colour index (16 bytes). Records are sorted brightest
first. Where B−V is unmeasured it is set to 0.6.

The Hipparcos catalogue is freely available from the CDS. This project uses it
under the CDS terms, which require acknowledgement: "This research has made use
of the VizieR catalogue access tool, CDS, Strasbourg, France". The source file
is downloaded at build time and is not committed; only the derived `.bin` is.
