# zarr-gl — a custom WebGL Zarr layer for Leaflet

A standalone Leaflet layer that renders multiscale Zarr v3 pyramids with WebGL2.
Plain ESM, no build step; Leaflet and [zarrita](https://github.com/manzt/zarrita.js)
are the only dependencies.

```js
import L from 'leaflet'
import { ZarrGLLayer } from './zarr-gl/zarr-gl-layer.js'

const layer = new ZarrGLLayer({
  url: 'https://example.com/mur1km_pyramid.zarr',
  variable: 'analysed_sst',
  clim: [271.15, 305.15],
  colors,                      // array of [r, g, b] triples
  selectors: { time: 0 },      // index per non-spatial dimension
  opacity: 1,
  maxZoom: 12,
  tileSize: 512,               // see "Tile size vs chunk size"
  concurrency: 16,
  cacheBytes: 256 * 1024 * 1024,
  fadeDuration: 500,           // 0 to have tiles appear at once
  prefetchParents: true,
  updateWhenIdle: false,       // true to only load once the map stops
}).addTo(map)

await layer.readyPromise
layer.updateStyle({ clim: [273, 303], colors: otherColors, opacity: 0.7 })
layer.updateSelectors({ time: 12 })
```

## Why not `L.GridLayer`

`L.GridLayer` gives every tile its own `<canvas>`, so each tile has to resample
the data independently and any error in that resampling shows up as a seam. This
layer instead owns a single canvas and GL context — the arrangement MapLibre
gives [`@carbonplan/zarr-layer`](https://github.com/carbonplan/zarr-layer)
through `CustomLayerInterface`, and the one MMGIS uses for its own GL layers.
Tiles remain the unit of *fetching* and *texturing*; they are just no longer the
unit of compositing.

The canvas is managed the way `L.Renderer` manages its own: sized to a padded
viewport, positioned in layer coordinates so panning moves it with the map pane,
CSS-transformed during zoom animation, and redrawn as the map moves.

## How the projection works

Geometry is submitted in *normalized CRS units* — what `map.options.crs`
produces before the zoom scale is applied. The fragment shader inverts those
units back to lon/lat per fragment and samples the EPSG:4326 data there:

```glsl
float mercY = u_mercCoeff.x * v_norm.y + u_mercCoeff.y;   // = PI * (1 - 2 * ny)
lat = degrees(atan(sinh(mercY)));
```

Doing the inversion per fragment (rather than stretching a latitude-linear
texture across a Mercator-linear quad) is what keeps features geographically
registered at every zoom instead of sliding north-south. The coefficients come
from the map's CRS, so a Mercator map takes the inversion path while a plate
carrée or `L.Proj.CRS` planetary map takes an affine path — no Earth-specific
constants in the layer. A non-affine `L.Proj.CRS` (polar stereographic, say)
would need a proj4 inverse in the shader; `projectionInfo` is where that hooks
in.

## How extents work

Every pyramid level carries its *own* cell-edge extent, taken from that level's
`spatial:transform` + `spatial:shape` (honouring `spatial:registration`), or from
its coordinate arrays when no transform is published. Cell *centres* are half a
cell inside the data, so treating the coarsest level's centre range as the
dataset extent — and reusing it for every level — leaves the layer short of the
antimeridian by half a coarse cell on each side, which is where the seam in the
`L.GridLayer` implementation came from.

## Tile size vs chunk size

Chunk shape is fixed when the store is written; tile size is the layer's to
choose, and the two want to be close. The MUR pyramid shards 1800x1800 chunks
into 450x450 inner chunks, while a 256 px tile at z9 spans only ~37 cells — so
such a tile decodes a chunk to use ~0.7% of it, and its neighbours re-decode the
same chunk. Hence `tileSize` defaults to 512, and `CachingStore` caches decoded
byte ranges so overlapping tiles share one fetch:

| same z9 viewport | before | after |
| --- | --- | --- |
| tile reads | 48 | 15 |
| network requests | 58 (only **2** distinct ranges) | 6 (all distinct) |
| bytes transferred | 10.4 MB | 5.1 MB |

Profiling the same view put drawing at 0.1 ms per frame with no long tasks and no
dropped frames, and decode plus stitch at 6.8 ms per tile — so the cost of this
layer is essentially the cost of getting bytes, and these two knobs are what move
it. Neither the GL path nor the decode path is worth optimising until they are.

Data reaches the GPU in its stored dtype: `int16` is uploaded as `R16I` and read
through an `isampler2D`, halving both the upload and the texture against a
CPU-side widening to `R32F`. Note that this needs `UNPACK_ALIGNMENT` of 1 — with
the default of 4 the driver expects padding after each row, and a 2-byte-per-texel
window of odd width appears too small to upload, leaving the texture incomplete.

## What happens while the map moves

Tiles load during a pan rather than only at `moveend` (`updateWhenIdle: false`,
throttled by `updateInterval`), the parent zoom is fetched alongside the visible
tiles so zooming out has data to show immediately, and the queue is served
visible-tiles-first, centre outwards, dropping tiles that leave the view before
their turn.

Whatever texture stands in a tile's place ramps up over `fadeDuration` if it just
arrived — the tile itself, or a coarser stand-in appearing at a frontier — with the
texture it replaces held underneath at full opacity. A texture with nothing beneath
it is drawn opaque immediately rather than ramping up over the basemap, so no area
ever dips: fading *from* transparent flashes the whole layer, since with a pyramid
there is nearly always something being re-covered.

A tile that has not arrived falls back to a cached ancestor *and* to cached tiles
from a finer zoom covering the same ground, each drawn on its own quad. Coarser
fallback alone is not enough: zooming out abandons the tiles just displayed, so
without the finer pass the view drops to a blurry ancestor — or, when eviction had
taken the ancestors too, to nothing at all, which is the layer appearing to flash
out and back in on a fast pan-zoom. Relatedly, eviction never drops an ancestor of
a wanted tile, and only drops anything once the cache is over `tileCacheSize`.

A zoom renders for the zoom being animated *to*, as `L.GridLayer` does, with the
canvas placed where that content belongs in the view being left so Leaflet's own
zoom transition grows it into place beside the basemap. CSS-scaling a canvas drawn
for the outgoing zoom — what `L.Renderer` does — instead leaves it covering
`1/scale` of the screen mid-animation, and skipping the redraw while
`_animatingZoom` is set means a chained wheel-zoom never lets the layer catch up
at all: measured three zoom levels behind, i.e. a canvas covering an eighth of the
width. Both show up as the layer flashing off.

The canvas is only re-sized when its dimensions actually change,
since assigning `width`/`height` blanks the drawing buffer — doing that on every
pan is what made the layer flash black.

## Files

| file | role |
| --- | --- |
| `zarr-gl-layer.js` | the `L.Layer`: canvas, GL state, tile cache, draw loop |
| `zarr-source.js` | store metadata, per-level extents, windowed reads |
| `shaders.js` | vertex/fragment shaders, program and colormap helpers |
| `projection.js` | `map.options.crs` → shader projection coefficients |
| `caching-store.js` | byte-range cache and request dedupe in front of `FetchStore` |

## Notes and limits

- WebGL2 only (`R32F` textures, `#version 300 es`).
- Data is assumed to be on a regular lon/lat grid.
- Values are decoded in-shader (`scale_factor`, `add_offset`); `fill_value` and
  `valid_min`/`valid_max` are compared in the stored domain, as CF defines them.
- Tiles fall back to their nearest cached ancestor while loading, so zooming
  sharpens rather than blanks.
