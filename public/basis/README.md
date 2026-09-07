# Basis Universal transcoder

`basis_transcoder.js` (UMD wrapper) and `basis_transcoder.wasm`, from
[Binomial LLC's basis_universal](https://github.com/BinomialLLC/basis_universal),
Apache-2.0. Copied verbatim from the `three@0.185.1` npm package
(`examples/jsm/libs/basis/`) — three.js itself is **not** a dependency.

Used by `src/render/EarthTextures.ts` to parse and transcode the KTX2 plates in
`public/earth/` into BC7 / ASTC / ETC2 / rgba8 at load. It handles the KTX2
container as well as the Basis payload, so there is no separate KTX2 parser.

Loaded through a script tag rather than an import: it is a UMD emscripten bundle
that defines `window.BASIS`, not an ES module.

Update by re-copying both files from a newer basis_universal or three release —
they are a matched pair and must be replaced together.
