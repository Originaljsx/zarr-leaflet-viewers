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
- **`tanager-leaflet-gl.html`** — Planet Tanager-1 hyperspectral surface
  reflectance, 426 bands from 376 to 2499 nm, on EPSG:3413 with the same CRS and
  GIBS basemaps as the arctic viewer (two extra zooms, since the data is 30 m).
  The band slider is a `wavelength` selector, so switching bands refetches only
  that band's chunks; clicking the scene plots the pixel's whole spectrum, read
  from a spectral-major copy of the cube on its native UTM grid — one chunk per
  spectrum, unresampled. Store built by `tanager_ic.export_gl` (the
  `hyperspectral` project) from an Icechunk spec-v2 repository; see "Tanager
  store layout" below.

- **`swot-currents-leaflet.html`** — SWOT L3 geostrophic currents as an animated
  particle field, Windy-style: a colour raster carries true speed and pale
  streaks carry direction. The odd one out here — it reads no Zarr at all and
  renders the swath on its **native curvilinear grid**; see "Currents on the
  native swath" below.

## Currents on the native swath

Every other page streams a regridded multiscale pyramid. This one does not, and
the reason is worth stating: a single SWOT L3 granule is ~6.9 MB as raw
`float32` (4.2 MB gzipped), small enough to ship whole, so resampling it onto a
regular grid would add error and buy nothing. The trade does not generalise —
a whole cycle would be gigabytes — which is exactly why the Zarr pipeline
exists for anything larger.

| file | role |
|---|---|
| `tools/swot_l3_currents.py` | one L3 granule → `.bin` + `.json` manifest |
| `currents/currents-layer.js` | `SwathField` lookup + the animated `L.Layer` |
| `data/swot_currents_*.{bin,json}` | the payload, committed so Pages can serve it |

```bash
python tools/swot_l3_currents.py SWOT_L3_LR_SSH_Expert_023_091_*.nc \
    -o data/swot_currents_c023_p091
```

The manifest gives each array's byte offset into a single `.bin`, so the page
does one fetch and takes typed-array views over the result. `?data=<url>` points
the page at a different granule.

The interesting part is the lookup. `latitude` and `longitude` are 2-D fields
over `(line, pixel)`, so there is no index formula and no bilinear shortcut —
"what is (u, v) here" needs a search. Two properties of a single half-orbit make
that cheap enough to skip a spatial index: latitude is monotone along-track (so
the per-line latitude bounds are monotone too, and two binary searches bound the
candidate lines exactly), and a line is only 69 samples wide. A typical query
touches ~15 lines, and the whole screen field is rebuilt only on `moveend`.

Three things that a global-field layer gets for free and a 136 km ribbon does
not, all of which show up as a blank or blotchy screen if missed:

- The search radius has to grow with the screen cell size, or a swath thinner
  than one cell falls through the gaps when you zoom out.
- Only the along-track direction may be decimated. Striding the 69-sample
  cross-track axis by the same factor collapses the swath onto its left edge as
  soon as the stride passes 69.
- Particles have to be counted and respawned from the field cells that hold
  data. Seeding uniformly across the viewport drops almost all of them on empty
  water, where they die on their first step.

Speeds are absolute geostrophic velocity (`ugos_filtered`, `vgos_filtered` —
anomaly plus MDT, so the mean flow is included). Near the equator the Coriolis
parameter goes to zero and the geostrophic derivation inflates; the page says so
next to the map rather than quietly clipping it.

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

## Tanager store layout

The store is 1.19 GB (9363 chunk files), so unlike the pages above it is **not**
in this repo. `tanager-leaflet-gl.html` tries a copy sitting next to itself first
and falls back to CloudFront, so the same page works locally and on Pages:

| order | URL |
| --- | --- |
| 1 | `./tanager3413_32m.zarr` — a local copy or symlink, when serving the repo |
| 2 | `https://d1ef9node0gwi2.cloudfront.net/tanager/tanager3413_32m.zarr` |
| — | `?store=<url>` overrides both (an `.icechunk` URL is used as-is) |

Until that CloudFront path is populated, the published page reports which URLs
it tried. The store is written by `tanager_ic.export_gl` and is shaped for
`zarr-gl` exactly as it reads:

```
tanager3413_32m.zarr/
  zarr.json                    multiscales -> "0","1","2"; variable, proj4, epsg,
                               wavelengths_nm, good_wavelengths, clim_hint, spectra_group
  0/surface_reflectance        (wavelength, y, x) float32, chunks (1, 256, 256), 32 m EPSG:3413
  0/{x,y,wavelength,good_wavelengths}
  1/… 2/…                      2x / 4x decimated (NaN-aware mean), 64 m and 128 m
  spectra/surface_reflectance  (wavelength, y, x), chunks (426, 16, 16), native 30 m UTM 28N
  spectra/{x,y,wavelength,good_wavelengths}
```

Both grids are float32 with `NaN` as the Zarr `fill_value`, which the fragment
shader's `raw != raw` test discards, so no `_FillValue` handling is needed. The
levels' cell-edge extents come out of their own coordinate arrays, so
`axisExtent()` gets them right without a `spatial:transform`.

The store carries two chunk layouts because the two questions want opposite
things: rendering a band wants one band per chunk (`(1, 256, 256)`, ~190 KB over
the wire per tile), while a pixel spectrum wants every band in one chunk
(`(426, 16, 16)`, ~280 KB for all 426 values). The `spectra` group stays on the
native UTM grid and is never resampled, so the plotted numbers are the values
Planet delivered; the viewer's click handler projects lon/lat with the `proj4`
string in that group's attributes.

Serving locally — symlink the store in rather than copying 1.2 GB, and it takes
priority over CloudFront:

```bash
ln -s /path/to/hyperspectral/web/tanager3413_32m.zarr tanager3413_32m.zarr
python -m http.server 8000        # then open http://localhost:8000/tanager-leaflet-gl.html
```

`.gitignore` keeps that symlink out of commits — a symlink pointing outside the
repo would break the Pages build.

Two caveats on `python -m http.server`: it is single-threaded, so the layer's 16
concurrent chunk fetches serialise, and it ignores `Range` (answering `200`, not
`206`). Whole-chunk plain-Zarr reads survive both, but an `.icechunk` URL goes
through `icechunk-js`, which wants ranges. `hyperspectral/scripts/serve.py` is a
threaded, range-capable, CORS-enabled drop-in if either bites.

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
hand. If you need a zarr-maps change, make it in the standalone
[zarr-maps](https://github.com/Originaljsx/zarr-maps) fork, run `npm run build`
there, and copy the new `dist/` contents over this directory — don't patch the
minified chunks in place.

## License

Apache 2.0 — see [LICENSE](LICENSE).
