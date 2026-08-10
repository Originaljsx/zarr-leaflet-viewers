/**
 * A regular lat/lon lattice of (u, v), for L4 gridded products like
 * MIOST/DUACS. Same `sample()` contract as `SwathField`, so `CurrentLayer`
 * works with either — but where the swath needs a real nearest-sample search,
 * a lattice lookup is index arithmetic and a bilinear blend.
 *
 * The payload ships no coordinate arrays at all: the manifest's grid block
 * (origin + spacing + shape) *is* the coordinate system. Components are int16
 * counts of `scale` m/s with a sentinel for land/ice; they are decoded to
 * float lazily per lookup rather than inflated to two float arrays up front.
 *
 * The blend re-normalises over whichever of the 4 corners are valid — the same
 * rule the layer's own screen-space lookup uses, and for the same reason: an
 * all-corners requirement would erode a cell-wide ring around every coastline.
 */
export class GridField {
  /**
   * @param {object} meta   manifest written by tools/miost_l4_currents.py
   * @param {ArrayBuffer} buf  the .bin payload it points at
   */
  constructor(meta, buf) {
    this.meta = meta
    const g = meta.grid
    this.lat0 = g.lat0
    this.dlat = g.dlat
    this.nlat = g.nlat
    this.lon0 = g.lon0
    this.dlon = g.dlon
    this.nlon = g.nlon
    this.scale = meta.scale
    this.sentinel = meta.sentinel
    const n = this.nlat * this.nlon
    this.u = new Int16Array(buf, meta.arrays.u.offset, n)
    this.v = new Int16Array(buf, meta.arrays.v.offset, n)
    // What the layer derives its search cutoff from; here it is simply the
    // grid spacing.
    this.spacingDeg = Math.abs(this.dlat)
  }

  /**
   * Bilinear (u, v) at (lat, lon). The cutoff argument exists to match
   * SwathField's signature; a global lattice always has the 4 bracketing
   * nodes, so validity — not distance — is what decides.
   * @returns {[number, number] | null} [u, v] in m/s, or null over land/ice.
   */
  sample(lat, lon, _cutoffDeg) {
    const fy = (lat - this.lat0) / this.dlat
    if (fy < 0 || fy > this.nlat - 1) return null
    // Wrap into [0, nlon): the lattice is periodic in longitude, so the
    // column east of the last one is column 0 again.
    let fx = (lon - this.lon0) / this.dlon
    fx -= Math.floor(fx / this.nlon) * this.nlon

    const r = Math.min(fy | 0, this.nlat - 2)
    const c = fx | 0
    const ty = fy - r
    const tx = fx - c
    const c1 = (c + 1) % this.nlon
    const k00 = r * this.nlon + c
    const k10 = r * this.nlon + c1
    const k01 = k00 + this.nlon
    const k11 = k10 + this.nlon

    const su = this.u
    const sv = this.v
    const sen = this.sentinel
    let w = 0
    let au = 0
    let av = 0
    const acc = (k, wk) => {
      if (su[k] === sen || sv[k] === sen) return
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

/** Fetch a manifest + its binary and build the field. */
export async function loadGridField(manifestUrl) {
  const meta = await (await fetch(manifestUrl)).json()
  const binUrl = new URL(meta.bin, new URL(manifestUrl, location.href)).href
  const buf = await (await fetch(binUrl)).arrayBuffer()
  return new GridField(meta, buf)
}
