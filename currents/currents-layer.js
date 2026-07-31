import L from 'leaflet'

/**
 * Animated ocean-current layer for a SWOT L3 swath, on its native grid.
 *
 * Adapted from a Windy-style wind layer. Two passes, for the same reason:
 *   1. a smooth interpolated speed raster, redrawn only when the view changes
 *   2. pale animated particles on top, carrying direction and texture
 *
 * Splitting the two is what makes it readable — speed lives in the colour
 * field, so the particles can be one quiet colour that never fights the
 * basemap, and the raster gives them contrast over dark ocean and bright land.
 *
 * How the motion works
 * --------------------
 * Sampling and reprojecting every particle every frame is far too slow.
 * Instead, whenever the view changes we bake a coarse *screen-space* velocity
 * field once (three projections per grid node), then the animation loop only
 * does bilinear lookups and adds — pure arithmetic.
 *
 * Particle direction is geographically exact (the local east/north basis comes
 * straight from the projection). Apparent speed is stylised to stay legible at
 * every zoom; true current speed is the raster colour, the legend, and the
 * cursor readout.
 *
 * What differs from the wind original
 * -----------------------------------
 * Wind fields arrive as a regular global lattice, so a lookup is index
 * arithmetic. A SWOT swath is curvilinear — latitude and longitude are 2-D
 * fields over (line, pixel) — so `SwathField` does a real nearest-sample
 * search instead (see its own note). Everything downstream of `_buildField`
 * is unchanged in spirit: once the screen field is baked, the layer no longer
 * knows or cares that the source was a swath.
 *
 * The other difference is coverage. A wind grid covers the whole world; one
 * SWOT pass is a 136 km ribbon, so particles seeded uniformly across the
 * screen would almost all land on empty water and die on their first step.
 * Respawning inside the ribbon (`_liveCells`) is what keeps it populated.
 */

/**
 * Current speed (m/s) -> colour. Same hue progression as the Windy wind ramp —
 * deep indigo through blue, teal and green to yellow, orange, red and violet —
 * rescaled to ocean geostrophic speeds, which top out near 2 m/s rather than
 * 33. Median speed on a SWOT pass sits around 0.17 m/s, so most of the ocean
 * reads blue and the western boundary currents carry the warm end.
 *
 * Speed is carried by the raster, not the particles — that separation is what
 * makes the look readable, and it frees the particles to be a single pale
 * colour that never fights the basemap.
 */
const RAMP = [
  [0.00, [40, 48, 120]],
  [0.10, [52, 76, 160]],
  [0.20, [60, 120, 190]],
  [0.35, [70, 168, 190]],
  [0.50, [88, 190, 150]],
  [0.70, [130, 205, 95]],
  [0.90, [205, 215, 80]],
  [1.10, [230, 165, 70]],
  [1.40, [222, 95, 70]],
  [1.70, [190, 70, 150]],
  [2.00, [235, 220, 240]],
]

const RAMP_MAX = RAMP[RAMP.length - 1][0]

/** Interpolate the ramp. @returns {[r,g,b]} */
function rampRgb(s) {
  if (!(s >= 0)) return [255, 255, 255]
  let i = 0
  while (i < RAMP.length - 2 && s > RAMP[i + 1][0]) i++
  const [s0, c0] = RAMP[i]
  const [s1, c1] = RAMP[i + 1]
  const t = Math.min(1, Math.max(0, (s - s0) / (s1 - s0)))
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * t),
    Math.round(c0[1] + (c1[1] - c0[1]) * t),
    Math.round(c0[2] + (c1[2] - c0[2]) * t),
  ]
}

export function speedColor(s) {
  const c = rampRgb(s)
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export const CURRENT_LEGEND = {
  title: 'Geostrophic current speed',
  css: `linear-gradient(90deg, ${RAMP.map(
    (r) => `${speedColor(r[0])} ${(r[0] / RAMP_MAX) * 100}%`
  ).join(', ')})`,
  ticks: ['0', '0.7', '1.4', '2+ m/s'],
}

const DEG_KM = 111.32 // km per degree of latitude
const D2R = Math.PI / 180

/** Signed shortest longitude difference, in degrees. */
function dlon(a, b) {
  let d = a - b
  if (d > 180) d -= 360
  else if (d < -180) d += 360
  return d
}

/**
 * The SWOT swath on its native curvilinear grid, with a nearest-sample lookup.
 *
 * There is no index formula here — `latitude[line][pixel]` is data, not a
 * coordinate axis — so answering "what is (u, v) at this lat/lon" needs a
 * search. Two properties of a single half-orbit make that search cheap enough
 * to skip a spatial index entirely:
 *
 *   - Latitude is monotone along-track. Both the per-line minimum and maximum
 *     latitude therefore rise monotonically too, so two binary searches bound
 *     the lines that could possibly hold a sample within the cutoff.
 *   - A line is only 69 samples wide, so once the line range is known the rest
 *     is a short linear scan.
 *
 * A typical fine-zoom query touches ~15 lines, about a thousand distance
 * evaluations, and the whole screen field is rebuilt only on `moveend`.
 *
 * `cutoffDeg` is what makes this work across zooms. Zoomed in it is tight, so
 * the field follows the swath edge honestly; zoomed out it grows to the size
 * of a screen cell, so a ribbon far thinner than one cell is still found. The
 * matching `step` decimates the scan in step with the cutoff, which keeps the
 * candidate count roughly constant no matter how far out you are.
 */
export class SwathField {
  /**
   * @param {object} meta   manifest written by tools/swot_l3_currents.py
   * @param {ArrayBuffer} buf  the .bin payload it points at
   */
  constructor(meta, buf) {
    this.meta = meta
    const [nl, npx] = meta.shape
    this.nl = nl
    this.npx = npx
    const n = nl * npx
    const a = meta.arrays
    this.lat = new Float32Array(buf, a.lat.offset, n)
    this.lon = new Float32Array(buf, a.lon.offset, n)
    this.u = new Float32Array(buf, a.u.offset, n)
    this.v = new Float32Array(buf, a.v.offset, n)

    // Per-line latitude bounds — the search keys. Monotone because latitude is
    // monotone along-track, which is what lets the binary searches below be
    // exact rather than approximate.
    this.latLo = new Float32Array(nl)
    this.latHi = new Float32Array(nl)
    for (let i = 0; i < nl; i++) {
      let lo = Infinity
      let hi = -Infinity
      const r = i * npx
      for (let j = 0; j < npx; j++) {
        const y = this.lat[r + j]
        if (y < lo) lo = y
        if (y > hi) hi = y
      }
      this.latLo[i] = lo
      this.latHi[i] = hi
    }

    // Median along-track latitude step ~ the sample spacing in degrees. The
    // decimation stride is derived from it, so the scan thins out at exactly
    // the rate the cutoff grows.
    const mid = (npx >> 1)
    const steps = []
    for (let i = 1; i < nl; i++) {
      const d = Math.abs(this.lat[i * npx + mid] - this.lat[(i - 1) * npx + mid])
      if (d > 0) steps.push(d)
    }
    steps.sort((p, q) => p - q)
    this.spacingDeg = steps.length ? steps[steps.length >> 1] : 0.018
  }

  /** First line index whose latHi >= y (binary search on a monotone array). */
  _lowerHi(y) {
    let lo = 0
    let hi = this.nl
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (this.latHi[m] < y) lo = m + 1
      else hi = m
    }
    return lo
  }

  /** First line index whose latLo > y. */
  _upperLo(y) {
    let lo = 0
    let hi = this.nl
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (this.latLo[m] <= y) lo = m + 1
      else hi = m
    }
    return lo
  }

  /**
   * Nearest valid sample to (lat, lon) within `cutoffDeg`.
   * @returns {[number, number] | null} [u, v] in m/s, or null if nothing is near.
   */
  sample(lat, lon, cutoffDeg = 0.03) {
    const i0 = this._lowerHi(lat - cutoffDeg)
    const i1 = this._upperLo(lat + cutoffDeg)
    if (i1 <= i0) return null

    // Thin the along-track scan in step with the cutoff: a screen cell that
    // big cannot show more than a couple of samples anyway. Because the line
    // range grows at the same rate, this holds the scan near-constant — a few
    // lines wide at every zoom.
    //
    // Only along-track. The cross-track direction is 69 samples total, so
    // striding it saves nothing and, once the stride passes 69, collapses the
    // whole swath onto its left edge — which is mostly land-masked, so the
    // ribbon silently disappears when you zoom out.
    const step = Math.max(1, Math.floor(cutoffDeg / this.spacingDeg / 2))
    const cosLat = Math.max(0.02, Math.cos(lat * D2R))
    const cut2 = cutoffDeg * cutoffDeg
    const npx = this.npx

    let best = -1
    let bestD2 = cut2
    for (let i = i0; i < i1; i += step) {
      const r = i * npx
      for (let j = 0; j < npx; j++) {
        const k = r + j
        const uu = this.u[k]
        if (!(uu === uu)) continue // NaN: edited out upstream
        const dy = this.lat[k] - lat
        const dx = dlon(this.lon[k], lon) * cosLat
        const d2 = dx * dx + dy * dy
        if (d2 < bestD2) {
          bestD2 = d2
          best = k
        }
      }
    }
    return best < 0 ? null : [this.u[best], this.v[best]]
  }
}

/** Fetch a manifest + its binary and build the field. */
export async function loadSwathField(manifestUrl) {
  const meta = await (await fetch(manifestUrl)).json()
  const binUrl = new URL(meta.bin, new URL(manifestUrl, location.href)).href
  const buf = await (await fetch(binUrl)).arrayBuffer()
  return new SwathField(meta, buf)
}

const CELL = 16 // screen-field resolution, px
const EPS = 0.05 // degrees used to derive the local east/north basis
// px per second per (m/s). Far higher than the wind original's 3.0: geostrophic
// currents run two orders of magnitude slower than wind, so the same gain would
// leave the field looking frozen.
const GAIN = 40.0
const CALM = 0.02 // m/s below which we draw nothing (a still dot reads as noise)
const MAX_AGE = 140 // frames before a particle respawns
const TRAIL = 0.965 // per-frame trail persistence (0 = none, 1 = forever)
// Particles are a single pale colour, as on Windy — the speed raster beneath
// gives them contrast everywhere, so no per-particle halo is needed.
const PARTICLE = 'rgba(255,255,255,0.75)'
const PARTICLE_WIDTH = 1.1

export const CurrentLayer = L.Layer.extend({
  options: { pane: 'overlayPane' },

  initialize(options) {
    L.setOptions(this, options)
    this._field = null
    this._swath = null
    this._particles = []
    this._liveCells = null
    this._raf = null
    this._paused = false
    this._rasterOpacity = options?.rasterOpacity ?? 0.75
  },

  onAdd(map) {
    this._map = map

    const mk = (cls) => {
      const c = L.DomUtil.create('canvas', cls)
      c.style.position = 'absolute'
      c.style.pointerEvents = 'none'
      this.getPane().appendChild(c)
      return c
    }

    // Two layers: a smooth speed raster that only changes when the view does,
    // and the animated particles above it.
    this._raster = mk('current-raster')
    this._raster.style.opacity = String(this._rasterOpacity)
    this._rctx = this._raster.getContext('2d')

    this._canvas = mk('current-canvas')
    this._canvas.style.willChange = 'transform'
    this._ctx = this._canvas.getContext('2d', { alpha: true, desynchronized: true })

    // Small offscreen buffer holding one pixel per field cell; scaling it up
    // with image smoothing is what produces the soft interpolated look.
    this._buf = document.createElement('canvas')
    this._bctx = this._buf.getContext('2d')

    map.on('moveend zoomend resize', this._reset, this)
    map.on('movestart zoomstart', this._hide, this)
    this._reset()
    this._start()
    return this
  },

  onRemove(map) {
    this._stop()
    map.off('moveend zoomend resize', this._reset, this)
    map.off('movestart zoomstart', this._hide, this)
    this._canvas.remove()
    this._raster.remove()
    return this
  },

  /** Opacity of the speed raster (the particles stay fully opaque). */
  setRasterOpacity(v) {
    this._rasterOpacity = v
    if (this._raster) this._raster.style.opacity = String(v)
    return this
  },

  /** Swap in a new swath without restarting the animation. */
  setData(swath) {
    this._swath = swath || null
    if (this._map) this._reset()
    return this
  },

  hasData() {
    return !!this._swath
  },

  /**
   * The search radius the current view is using, in degrees of latitude.
   * Readouts want the same one the raster was built with, so that clicking a
   * coloured pixel always reports a value.
   */
  cutoff() {
    return this._field?.cutoffDeg ?? 0.03
  },

  /** Current at a geographic point, for readouts. @returns {{u,v,speed,dir}|null} */
  at(lat, lon, cutoffDeg = 0.03) {
    const s = this._swath?.sample(lat, lon, cutoffDeg)
    if (!s) return null
    const [u, v] = s
    return {
      u,
      v,
      speed: Math.hypot(u, v),
      // Oceanographic convention: the direction the water flows *towards*
      // (the opposite of the meteorological convention used for wind).
      dir: (90 - (Math.atan2(v, u) * 180) / Math.PI + 360) % 360,
    }
  },

  setPaused(p) {
    this._paused = p
    if (!p && !this._raf && this._map) this._start()
  },

  // ── internals ─────────────────────────────────────────────

  _hide() {
    // Leaflet moves panes during drag; blank rather than smear.
    if (this._ctx) this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height)
  },

  _reset() {
    const map = this._map
    if (!map || !this._canvas) return

    const size = map.getSize()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this._w = size.x
    this._h = size.y
    this._dpr = dpr

    for (const c of [this._canvas, this._raster]) {
      c.width = Math.round(size.x * dpr)
      c.height = Math.round(size.y * dpr)
      c.style.width = size.x + 'px'
      c.style.height = size.y + 'px'
      // Pin to the map origin so both track pane transforms together.
      L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]))
    }

    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this._ctx.clearRect(0, 0, size.x, size.y)
    this._rctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this._rctx.clearRect(0, 0, size.x, size.y)

    this._buildField()
    this._drawRaster()
    this._seed()
  },

  /**
   * Paint the speed field as a smooth colour raster.
   *
   * The field grid is written one pixel per cell into a tiny offscreen canvas,
   * then scaled up with image smoothing — the browser's bilinear filter does
   * the interpolation for free, which is both faster and smoother than
   * shading each screen pixel by hand.
   */
  _drawRaster() {
    const f = this._field
    const rctx = this._rctx
    if (!rctx) return
    rctx.clearRect(0, 0, this._w, this._h)
    if (!f) return

    const { cols, rows, sp } = f
    this._buf.width = cols
    this._buf.height = rows
    const img = this._bctx.createImageData(cols, rows)
    const d = img.data

    for (let i = 0; i < sp.length; i++) {
      const o = i * 4
      const s = sp[i]
      if (Number.isNaN(s)) {
        d[o + 3] = 0 // off-swath — let the basemap through
        continue
      }
      const c = rampRgb(s)
      d[o] = c[0]
      d[o + 1] = c[1]
      d[o + 2] = c[2]
      d[o + 3] = 255
    }
    this._bctx.putImageData(img, 0, 0)

    rctx.imageSmoothingEnabled = true
    rctx.imageSmoothingQuality = 'high'
    // The grid is anchored at cell centres, so offset by half a cell.
    rctx.drawImage(this._buf, -CELL / 2, -CELL / 2, cols * CELL, rows * CELL)
  },

  /**
   * Bake the screen-space velocity field. One pass, ~3 projections per node
   * that actually hits the swath, so a 1920x1080 viewport costs ~8k nodes
   * once per view change instead of ~6k lookups per *frame*.
   */
  _buildField() {
    const map = this._map
    const swath = this._swath
    if (!map || !swath) {
      this._field = null
      this._liveCells = null
      return
    }

    const cols = Math.ceil(this._w / CELL) + 1
    const rows = Math.ceil(this._h / CELL) + 1
    const vx = new Float32Array(cols * rows)
    const vy = new Float32Array(cols * rows)
    const sp = new Float32Array(cols * rows)

    // How much latitude one field cell spans on screen. This is the cutoff the
    // swath search gets: zoomed in it is tight and the ribbon edge stays
    // honest; zoomed out it grows so a swath thinner than a cell is still
    // found instead of falling through the gaps.
    const b = map.getBounds()
    const degPerCell = Math.abs(b.getNorth() - b.getSouth()) / Math.max(1, rows - 1)
    const cutoffDeg = Math.max(swath.spacingDeg * 1.5, degPerCell * 0.75)

    const live = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c
        const px = c * CELL
        const py = r * CELL

        let ll
        try {
          ll = map.containerPointToLatLng([px, py])
        } catch {
          sp[k] = NaN
          continue
        }
        // The pole is a coordinate singularity for "east"; nudge off it.
        const lat = Math.max(-89.9, Math.min(89.9, ll.lat))
        const cur = swath.sample(lat, ll.lng, cutoffDeg)
        if (!cur) {
          sp[k] = NaN
          continue
        }

        const pC = map.latLngToContainerPoint([lat, ll.lng])
        const pN = map.latLngToContainerPoint([lat + EPS, ll.lng])
        const pE = map.latLngToContainerPoint([lat, ll.lng + EPS])

        // Unit screen vectors pointing local north and east.
        let nxv = pN.x - pC.x
        let nyv = pN.y - pC.y
        let exv = pE.x - pC.x
        let eyv = pE.y - pC.y
        const nl = Math.hypot(nxv, nyv) || 1
        const el = Math.hypot(exv, eyv) || 1
        nxv /= nl
        nyv /= nl
        exv /= el
        eyv /= el

        const [u, v] = cur
        vx[k] = (u * exv + v * nxv) * GAIN
        vy[k] = (u * eyv + v * nyv) * GAIN
        sp[k] = Math.hypot(u, v)
        live.push(k)
      }
    }

    this._field = { cols, rows, vx, vy, sp, cutoffDeg }
    this._liveCells = live
  },

  /**
   * Bilinear lookup into the screen field, over whichever corners have data.
   *
   * The wind original required all four corners and bailed otherwise, which is
   * right for a field that covers the world. Here the data is a ribbon a few
   * cells wide, so demanding four corners would empty out exactly the edge
   * cells that make up most of it. Re-normalising over the finite corners
   * degrades to nearest-neighbour at the swath edge instead of to nothing.
   */
  _lookup(x, y, out) {
    const f = this._field
    if (!f) return false
    const fx = x / CELL
    const fy = y / CELL
    const c = fx | 0
    const r = fy | 0
    if (c < 0 || r < 0 || c >= f.cols - 1 || r >= f.rows - 1) return false

    const tx = fx - c
    const ty = fy - r
    const k00 = r * f.cols + c
    const k10 = k00 + 1
    const k01 = k00 + f.cols
    const k11 = k01 + 1

    const sp = f.sp
    let wsum = 0
    let ax = 0
    let ay = 0
    let as = 0
    const acc = (k, w) => {
      if (Number.isNaN(sp[k])) return
      wsum += w
      ax += f.vx[k] * w
      ay += f.vy[k] * w
      as += sp[k] * w
    }
    acc(k00, (1 - tx) * (1 - ty))
    acc(k10, tx * (1 - ty))
    acc(k01, (1 - tx) * ty)
    acc(k11, tx * ty)
    if (wsum <= 0) return false

    out.vx = ax / wsum
    out.vy = ay / wsum
    out.sp = as / wsum
    return true
  },

  _seed() {
    // The Windy look comes from a lot of short streaks rather than a few long
    // ones, so aim for a fixed density *within the data* — a few per field
    // cell that has velocity. Sizing off the viewport instead (as a global
    // field can) would pack the whole screen's worth of particles into the
    // sliver of it the swath covers, and the ribbon would read as a solid
    // white smear at low zoom.
    const live = this._liveCells?.length ?? 0
    const cap = Math.round((this._w * this._h) / 620)
    const n = Math.max(200, Math.min(Math.min(7000, cap), live * 4))
    const parts = (this._particles = new Array(n))
    for (let i = 0; i < n; i++) {
      parts[i] = { x: 0, y: 0, age: (Math.random() * MAX_AGE) | 0, sp: 0 }
      this._respawn(parts[i])
    }
  },

  /**
   * Put a particle back somewhere it can actually move.
   *
   * A uniform respawn across the screen is fine for a global wind field, but
   * one SWOT pass covers a sliver of the view — almost every particle would
   * land on empty water and die again on its first step, leaving the ribbon
   * bare. Seeding from the field cells that hold data keeps the population
   * where the data is; the jitter spreads them within the cell so the streaks
   * don't line up on the 16 px lattice.
   */
  _respawn(p) {
    const live = this._liveCells
    const f = this._field
    if (live && live.length && f) {
      const k = live[(Math.random() * live.length) | 0]
      const c = k % f.cols
      const r = (k / f.cols) | 0
      p.x = (c + Math.random() - 0.5) * CELL
      p.y = (r + Math.random() - 0.5) * CELL
    } else {
      p.x = Math.random() * this._w
      p.y = Math.random() * this._h
    }
    p.age = (Math.random() * MAX_AGE) | 0
  },

  _start() {
    if (this._raf) return
    let last = performance.now()
    const probe = { vx: 0, vy: 0, sp: 0 }

    const tick = (now) => {
      this._raf = requestAnimationFrame(tick)
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      if (this._paused || !this._field || !this._particles.length) return

      const ctx = this._ctx
      const w = this._w
      const h = this._h

      // Fade the previous frame toward transparent, leaving comet trails.
      ctx.globalCompositeOperation = 'destination-in'
      ctx.fillStyle = `rgba(0,0,0,${TRAIL})`
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'

      ctx.lineCap = 'round'
      ctx.strokeStyle = PARTICLE
      ctx.lineWidth = PARTICLE_WIDTH

      // Every particle is the same colour, so the whole frame is one path and
      // one stroke — no per-bucket state changes at all.
      ctx.beginPath()

      for (let i = 0; i < this._particles.length; i++) {
        const p = this._particles[i]
        if (++p.age > MAX_AGE || !this._lookup(p.x, p.y, probe)) {
          this._respawn(p)
          continue
        }
        const nx = p.x + probe.vx * dt
        const ny = p.y + probe.vy * dt
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          this._respawn(p)
          continue
        }

        // In near-still water a particle barely moves; repeatedly stamping it
        // in place just accumulates a bright dot. Advance it, but draw nothing.
        if (probe.sp < CALM) {
          p.x = nx
          p.y = ny
          continue
        }

        ctx.moveTo(p.x, p.y)
        ctx.lineTo(nx, ny)

        p.x = nx
        p.y = ny
        p.sp = probe.sp
      }
      ctx.stroke()
    }
    this._raf = requestAnimationFrame(tick)
  },

  _stop() {
    if (this._raf) cancelAnimationFrame(this._raf)
    this._raf = null
  },
})

export const currentLayer = (opts) => new CurrentLayer(opts)
