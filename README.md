# Zarr Leaflet Viewers

[![AI-assisted: written by a human with help from AI tools](https://img.shields.io/static/v1?label=&message=AI-assisted&color=gold)](https://nasa-ammos.github.io/slim/?search=Badges)
[![Best Practices from SLIM: this project follows SLIM best practices](https://img.shields.io/badge/Best%20Practices%20from-SLIM-blue)](https://nasa-ammos.github.io/slim/)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

Browser-only viewers for Zarr v3 multiscale pyramids. Each page is a single
HTML file with no backend: it fetches Zarr chunks directly over HTTP byte
ranges from CloudFront and renders them in Leaflet, either through the
[zarr-maps](https://github.com/Originaljsx/zarr-maps) `L.GridLayer` integration
or through `zarr-gl/`, a custom WebGL layer written for this repo. There is no
server, no tile cache, and no build step — open a file, or serve the directory
statically.

## Pages

- **`index.html`** — landing page linking the viewers below.
- **`swot-leaflet.html`** — SWOT sea-surface height anomaly (`ssha`), absolute
  dynamic topography (`adt`), and normalized backscatter (`sig0`), at either
  the Expert 2 km or Unsmoothed 250 m resolution. A slider steps through
  passes with cycle/date/pass labels read from the store; clicking the map
  reports a value. Uses `zarr-maps/leaflet`.
- **`mur-leaflet.html`** — MUR SST 1 km, sea-surface temperature and anomaly,
  with a day slider. Also `zarr-maps/leaflet`; first load is slow (~30 s)
  because `L.GridLayer` gives every tile its own canvas and each tile
  resamples the data independently.
- **`mur-leaflet-gl.html`** — the same MUR data through `zarr-gl` instead:
  one shared canvas and GL context, per-tile textures, Mercator reprojection
  done per-fragment in the shader. No antimeridian gap and no north-south
  drift on zoom, which the `L.GridLayer` version has.
- **`arctic-leaflet-gl.html`** — SWOT data reprojected to EPSG:3413 (polar
  stereographic), also on `zarr-gl`, with pass/day/cycle mode switching and a
  bottom timeline control.

## zarr-gl/

A from-scratch WebGL2 Leaflet layer, built because `L.GridLayer`'s per-tile
canvases can't share a resampling pass and show seams at tile edges. Plain
ESM, Leaflet and [zarrita](https://github.com/manzt/zarrita.js) are the only
dependencies.

| file | role |
|---|---|
| `zarr-gl-layer.js` | the `L.Layer`: canvas, GL state, tile cache, draw loop |
| `zarr-source.js` | store metadata, per-level extents, windowed reads |
| `shaders.js` | vertex/fragment shaders, program and colormap helpers |
| `projection.js` | `map.options.crs` → shader projection coefficients |
| `caching-store.js` | byte-range cache and request dedupe in front of `FetchStore` |

See `zarr-gl/README.md` for the design notes — why per-fragment projection
instead of a stretched texture, how tile size interacts with chunk size, and
the fallback/fade behavior while tiles are loading.

## zarr-maps/

`zarr-maps/` is a **vendored build output**, not source to edit here. It is
the `dist/` of [Originaljsx/zarr-maps](https://github.com/Originaljsx/zarr-maps)
(a fork of [NOC-OI/zarr-maps](https://github.com/NOC-OI/zarr-maps) with fixes
for Zarr v3 and the `zarr-conventions` multiscales layout), copied in wholesale
minus source maps. As of this writing the two are byte-identical — confirmed
by hashing every non-map file in `zarr-maps/{core,leaflet,ol}` against the
fork's `dist/` — so nothing here is currently out of sync or ahead of the fork.

There's no script that performs that copy automatically, though, so it will
drift the next time the fork gets a fix and this directory isn't refreshed by
hand. If you need a zarr-maps change, make it in the standalone fork
(`/mnt/c/Users/jspier/zarr/zarr-maps` locally), run `npm run build` there, and
copy the new `dist/` contents over this directory — don't patch the minified
chunks in place.

## License

None yet — to be added.
