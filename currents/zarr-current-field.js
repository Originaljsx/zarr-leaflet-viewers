/**
 * Multiscale-Zarr backing for the animated currents layer.
 *
 * The .bin pages ship the whole field up front; this one fetches, on every
 * view change, just the chunks of just the pyramid level the current zoom
 * resolves — u and v windows over the padded viewport — and hands the layer a
 * `WindowField` with the same synchronous `sample()` contract as
 * `GridField`/`SwathField`. All the multiscale machinery (level choice,
 * chunk-window reads, the antimeridian stitch, int16 decode) is `ZarrSource`,
 * shared with the WebGL raster, so raster and particles are guaranteed to be
 * looking at the same bytes.
 */
import { ZarrSource } from '../zarr-gl/zarr-source.js'

/**
 * One fetched (u, v) window on a regular lattice, with bilinear `sample()`.
 * Rows/cols address cell centres; the window's lon range may sit anywhere on
 * the wrapped axis (a stitched antimeridian window runs past ±180), so the
 * probe longitude is folded into it before indexing.
 */
export class WindowField {
  constructor(uWin, vWin, { scale, fill }) {
    this.u = uWin.data
    this.v = vWin.data
    this.w = uWin.width
    this.h = uWin.height
    this.scale = scale
    this.fill = fill
    this.lonWest = uWin.lonWest
    this.latSouth = uWin.latSouth
    this.dlon = (uWin.lonEast - uWin.lonWest) / uWin.width
    this.dlat = (uWin.latNorth - uWin.latSouth) / uWin.height
    this.ascending = uWin.latAscending
    this.spacingDeg = Math.abs(this.dlat)
  }

  /** @returns {[u, v] in m/s | null} — same contract as GridField.sample. */
  sample(lat, lon, _cutoffDeg) {
    // Row 0 of the window is the first array row read: south edge when the
    // latitude axis ascends, north edge when it descends.
    const fromSouth = (lat - this.latSouth) / this.dlat - 0.5
    const fy = this.ascending ? fromSouth : this.h - 1 - fromSouth
    if (fy < -0.5 || fy > this.h - 0.5) return null

    let fx = (lon - this.lonWest) / this.dlon - 0.5
    const period = 360 / this.dlon
    if (fx < -0.5) fx += Math.ceil((-0.5 - fx) / period) * period
    else if (fx > this.w - 0.5) fx -= Math.ceil((fx - (this.w - 0.5)) / period) * period
    if (fx < -0.5 || fx > this.w - 0.5) return null

    const r = Math.max(0, Math.min(this.h - 2, fy | 0))
    const c = Math.max(0, Math.min(this.w - 2, fx | 0))
    const ty = Math.max(0, Math.min(1, fy - r))
    const tx = Math.max(0, Math.min(1, fx - c))

    const k00 = r * this.w + c
    const k10 = k00 + 1
    const k01 = k00 + this.w
    const k11 = k01 + 1
    const su = this.u
    const sv = this.v
    const fill = this.fill
    let w = 0
    let au = 0
    let av = 0
    const acc = (k, wk) => {
      if (su[k] === fill || sv[k] === fill) return
      w += wk
      au += su[k] * wk
      av += sv[k] * wk
    }
    acc(k00, (1 - tx) * (1 - ty))
    acc(k10, tx * (1 - ty))
    acc(k01, (1 - tx) * ty)
    acc(k11, tx * ty)
    if (w <= 0) return null
    return [(au / w) * this.scale, (av / w) * this.scale]
  }
}

/**
 * Owns two `ZarrSource`s (u and v) over the same pyramid and produces a
 * `WindowField` for a viewport. Reads are abortable so a pan mid-fetch drops
 * the stale window instead of racing the fresh one.
 */
export class ZarrCurrentField {
  constructor(url, { uVar = 'ugos', vVar = 'vgos' } = {}) {
    this.uSrc = new ZarrSource({ url, variable: uVar })
    this.vSrc = new ZarrSource({ url, variable: vVar })
    this.ready = Promise.all([this.uSrc.readyPromise, this.vSrc.readyPromise])
    this._abort = null
  }

  /**
   * Fetch the window for `bounds` (Leaflet LatLngBounds) at the level that
   * resolves `degPerPixel`, padded so a small pan animates from cache.
   * @returns {Promise<WindowField|null>} null if aborted or empty.
   */
  async fetch(bounds, degPerPixel, pad = 0.25) {
    await this.ready
    this._abort?.abort()
    const abort = (this._abort = new AbortController())

    const level = this.uSrc.chooseLevel(degPerPixel)
    const vLevel = this.vSrc.levels[this.uSrc.levels.indexOf(level)]
    const dLon = (bounds.getEast() - bounds.getWest()) * pad
    const dLat = (bounds.getNorth() - bounds.getSouth()) * pad
    const win = {
      lonWest: bounds.getWest() - dLon,
      lonEast: bounds.getEast() + dLon,
      latSouth: Math.max(-90, bounds.getSouth() - dLat),
      latNorth: Math.min(90, bounds.getNorth() + dLat),
      signal: abort.signal,
    }
    let uWin, vWin
    try {
      ;[uWin, vWin] = await Promise.all([
        this.uSrc.readWindow({ level, ...win }),
        this.vSrc.readWindow({ level: vLevel, ...win }),
      ])
    } catch (e) {
      if (abort.signal.aborted) return null
      throw e
    }
    if (abort.signal.aborted || !uWin || !vWin) return null
    return new WindowField(uWin, vWin, {
      scale: this.uSrc.scaleFactor,
      fill: this.uSrc.fillValue,
    })
  }
}
