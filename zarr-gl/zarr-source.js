/**
 * Zarr access for the WebGL layer: pyramid levels, georeferencing and window
 * reads.
 *
 * The important difference from zarr-maps' `ZarrLayerProvider` is
 * georeferencing. Each pyramid level gets its *own* extent, derived from the
 * cell size so that the extent describes cell *edges*:
 *
 *   west = firstLonCentre - cellWidth / 2
 *   east = lastLonCentre  + cellWidth / 2
 *
 * Deriving a single extent from the coarsest level's coordinate *centres* (and
 * reusing it for every level) leaves the data short of the antimeridian by half
 * a coarse cell on each side -- 1.6 degrees of never-drawn world for the MUR
 * 1 km pyramid, whose coarsest level is 1.28 degrees per cell.
 */

import * as zarr from 'zarrita'

import { CachingStore } from './caching-store.js'

const LON_NAMES = ['lon', 'longitude', 'x', 'Longitude', 'X', 'lng']
const LAT_NAMES = ['lat', 'latitude', 'y', 'Latitude', 'Y']

/** Largest texture the layer will upload for one window, per axis. */
export const MAX_TEXELS = 4096

/**
 * How each dtype travels to the GPU. Integer data keeps its stored width, which
 * halves both the upload and the texture for the common packed-int16 case and
 * skips a full CPU copy into `Float32Array`; the shader decodes with
 * `scale_factor`/`add_offset` regardless.
 */
const TEXTURE_SPECS = {
  int8: { internalFormat: 'R8I', format: 'RED_INTEGER', type: 'BYTE', sampler: 'int', ArrayType: Int8Array },
  int16: { internalFormat: 'R16I', format: 'RED_INTEGER', type: 'SHORT', sampler: 'int', ArrayType: Int16Array },
  int32: { internalFormat: 'R32I', format: 'RED_INTEGER', type: 'INT', sampler: 'int', ArrayType: Int32Array },
  uint8: { internalFormat: 'R8UI', format: 'RED_INTEGER', type: 'UNSIGNED_BYTE', sampler: 'uint', ArrayType: Uint8Array },
  uint16: { internalFormat: 'R16UI', format: 'RED_INTEGER', type: 'UNSIGNED_SHORT', sampler: 'uint', ArrayType: Uint16Array },
  uint32: { internalFormat: 'R32UI', format: 'RED_INTEGER', type: 'UNSIGNED_INT', sampler: 'uint', ArrayType: Uint32Array },
}

const FLOAT_SPEC = {
  internalFormat: 'R32F',
  format: 'RED',
  type: 'FLOAT',
  sampler: 'float',
  ArrayType: Float32Array,
}

/** Anything not listed -- float32, float64, int64 -- is widened to `R32F`. */
function textureSpec(dtype) {
  return TEXTURE_SPECS[dtype] ?? FLOAT_SPEC
}

function pickName(names, candidates) {
  for (const candidate of candidates) {
    const hit = names.find((n) => n === candidate)
    if (hit) return hit
  }
  return names.find((n) => candidates.includes(n.toLowerCase()))
}

/** Level descriptors for both `multiscales` conventions this needs to read. */
function multiscaleLevels(attrs) {
  const ms = attrs?.multiscales
  if (!ms) return null
  // zarr-conventions/multiscales v1: { layout: [{ asset, spatial:transform, spatial:shape }] }
  if (Array.isArray(ms.layout)) {
    return ms.layout.map((entry) => ({
      path: String(entry.asset),
      transform: entry['spatial:transform'],
      shape: entry['spatial:shape'],
    }))
  }
  // OME-NGFF style: [{ datasets: [{ path }] }]
  if (Array.isArray(ms) && ms[0]?.datasets?.length) {
    return ms[0].datasets.map((d) => ({ path: d.path }))
  }
  return null
}

function dimensionNames(array) {
  // v3 `dimension_names`, falling back to the v2 xarray convention.
  return array.dimensionNames?.filter(Boolean)?.length
    ? array.dimensionNames
    : (array.attrs?._ARRAY_DIMENSIONS ?? [])
}

async function readCoordinate(location, name) {
  const array = await zarr.open(await location.resolve(name), { kind: 'array' })
  const chunk = await zarr.get(array)
  return Array.from(chunk.data, Number)
}

/**
 * Cell-edge extent plus cell size for one axis of a level, from that level's
 * own coordinate values (which are cell centres).
 */
function axisExtent(centres) {
  const n = centres.length
  const first = centres[0]
  const last = centres[n - 1]
  const step = n > 1 ? (last - first) / (n - 1) : 0
  const ascending = step >= 0
  const half = step / 2
  return {
    min: Math.min(first - half, last + half),
    max: Math.max(first - half, last + half),
    step: Math.abs(step),
    ascending,
    size: n,
  }
}

/**
 * Extent from a level's `spatial:transform`.
 *
 * `spatial:registration` says whether the origin is a cell corner (`pixel`,
 * the default) or a cell centre (`point`); either way the extent this returns
 * describes cell *edges*.
 */
function extentFromTransform(transform, shape, registration) {
  if (!transform || !shape) return null
  const [xStep, , xOrigin, , yStep, yOrigin] = transform
  const [height, width] = shape
  const centreRegistered = registration === 'point' || registration === 'centre'
  const axis = (origin, step, size) => {
    const edge = centreRegistered ? origin - step / 2 : origin
    const far = edge + step * size
    return {
      min: Math.min(edge, far),
      max: Math.max(edge, far),
      step: Math.abs(step),
      ascending: step >= 0,
      size,
    }
  }
  return { lon: axis(xOrigin, xStep, width), lat: axis(yOrigin, yStep, height) }
}

export class ZarrSource {
  constructor({ url, variable, selectors = {}, cacheBytes }) {
    this.url = url
    this.variable = variable
    this.selectors = { ...selectors }
    this.cacheBytes = cacheBytes
    this.levels = []
    this.dimensionValues = {}
    this.readyPromise = this._open()
  }

  async _open() {
    // Cached and deduplicated: tiles are far smaller than chunks, so a single
    // viewport resolves many tiles to the same byte ranges.
    this.store = new CachingStore(
      new zarr.FetchStore(this.url, { overrides: { cache: 'no-store' } }),
      { maxBytes: this.cacheBytes })
    this.root = zarr.root(this.store)
    const group = await zarr.open(this.root, { kind: 'group' })
    const attrs = group.attrs ?? {}
    this.attrs = attrs
    const registration = attrs['spatial:registration']

    const levelDescriptors = multiscaleLevels(attrs) ?? [{ path: null }]

    for (const descriptor of levelDescriptors) {
      const location = descriptor.path ? await this.root.resolve(descriptor.path) : this.root
      const array = await zarr.open(await location.resolve(this.variable), { kind: 'array' })
      const dims = dimensionNames(array)
      const lonName = pickName(dims, LON_NAMES)
      const latName = pickName(dims, LAT_NAMES)
      if (!lonName || !latName) {
        throw new Error(`Could not identify lon/lat dimensions in [${dims.join(', ')}]`)
      }
      const lonIndex = dims.indexOf(lonName)
      const latIndex = dims.indexOf(latName)

      let extent = extentFromTransform(descriptor.transform, descriptor.shape, registration)
      if (!extent) {
        const [lonCentres, latCentres] = await Promise.all([
          readCoordinate(location, lonName),
          readCoordinate(location, latName),
        ])
        extent = { lon: axisExtent(lonCentres), lat: axisExtent(latCentres) }
      }

      this.levels.push({
        path: descriptor.path,
        location,
        array,
        dims,
        lonName,
        latName,
        lonIndex,
        latIndex,
        lon: extent.lon,
        lat: extent.lat,
      })
    }

    // Finest level first.
    this.levels.sort((a, b) => b.lon.size - a.lon.size)
    this.finest = this.levels[0]
    this.texture = textureSpec(this.finest.array.dtype)
    this._readPacking(this.finest.array, attrs)
    await this._loadExtraDimensions()
    return this
  }

  _readPacking(array, groupAttrs) {
    const attrs = array.attrs ?? {}
    this.scaleFactor = attrs.scale_factor ?? groupAttrs.scale_factor ?? 1
    this.addOffset = attrs.add_offset ?? groupAttrs.add_offset ?? 0
    const fill = attrs._FillValue ?? array.fillValue
    this.fillValue = typeof fill === 'number' && Number.isFinite(fill) ? fill : null
    const validMin = attrs.valid_min ?? attrs.actual_range?.[0]
    const validMax = attrs.valid_max ?? attrs.actual_range?.[1]
    this.noDataMin = typeof validMin === 'number' ? validMin : -Infinity
    this.noDataMax = typeof validMax === 'number' ? validMax : Infinity
  }

  /** Non-spatial dimensions (time, depth, ...) default to index 0. */
  async _loadExtraDimensions() {
    const level = this.finest
    for (const name of level.dims) {
      if (name === level.lonName || name === level.latName) continue
      try {
        this.dimensionValues[name] = await readCoordinate(level.location, name)
      } catch {
        this.dimensionValues[name] = null
      }
      if (this.selectors[name] == null) this.selectors[name] = 0
    }
  }

  /**
   * Coarsest level whose cell size still resolves `degPerPixel`, so we never
   * fetch appreciably more detail than the screen can show.
   */
  chooseLevel(degPerPixel) {
    let chosen = this.finest
    for (const level of this.levels) {
      if (level.lon.step <= degPerPixel) chosen = level
    }
    return chosen
  }

  /** The next coarser level, or `null` at the coarsest. */
  coarser(level) {
    const index = this.levels.indexOf(level)
    return index >= 0 && index < this.levels.length - 1 ? this.levels[index + 1] : null
  }

  /** Texels a window would need at `level`, used to cap texture size. */
  windowTexels(level, { lonWest, lonEast, latSouth, latNorth }) {
    const cols = Math.min(level.lon.size, Math.ceil((lonEast - lonWest) / level.lon.step))
    const rows = Math.min(level.lat.size, Math.ceil((latNorth - latSouth) / level.lat.step))
    return { cols, rows }
  }

  /**
   * Read one lon/lat window of a level.
   *
   * `lonWest`/`lonEast` may run past +/-180: a window crossing the
   * antimeridian is read as two column ranges and stitched, so the seam is
   * covered by data instead of falling in a gap.
   */
  async readWindow({ level, lonWest, lonEast, latSouth, latNorth, signal }) {
    const { lon, lat } = level
    const fullWidth = lonEast - lonWest >= 360 - lon.step

    const colOf = (value) => (value - lon.min) / lon.step
    const rowOf = (value) =>
      lat.ascending ? (value - lat.min) / lat.step : (lat.max - value) / lat.step

    const startCol = fullWidth ? 0 : Math.floor(colOf(lonWest))
    const endCol = fullWidth ? lon.size : Math.ceil(colOf(lonEast))
    const latLow = lat.ascending ? latSouth : latNorth
    const latHigh = lat.ascending ? latNorth : latSouth
    const startRow = Math.max(0, Math.floor(rowOf(latLow)))
    const endRow = Math.min(lat.size, Math.ceil(rowOf(latHigh)))
    if (endRow <= startRow || endCol <= startCol) return null

    // Column ranges, wrapping across the antimeridian when needed.
    const ranges = []
    if (fullWidth) {
      ranges.push([0, lon.size])
    } else {
      const wrap = (c) => ((c % lon.size) + lon.size) % lon.size
      const width = endCol - startCol
      const first = wrap(startCol)
      if (first + width <= lon.size) {
        ranges.push([first, first + width])
      } else {
        ranges.push([first, lon.size], [0, first + width - lon.size])
      }
    }

    const height = endRow - startRow
    const width = ranges.reduce((sum, [a, b]) => sum + (b - a), 0)
    const data = new this.texture.ArrayType(width * height)
    const lonFirst = level.lonIndex < level.latIndex

    let xOffset = 0
    for (const [colStart, colEnd] of ranges) {
      const args = new Array(level.dims.length).fill(0)
      for (let i = 0; i < level.dims.length; i++) {
        const name = level.dims[i]
        if (i === level.lonIndex) args[i] = zarr.slice(colStart, colEnd)
        else if (i === level.latIndex) args[i] = zarr.slice(startRow, endRow)
        else args[i] = this.selectors[name] ?? 0
      }
      const chunk = await zarr.get(level.array, args, { opts: { signal } })
      const source = chunk.data
      const cols = colEnd - colStart
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < cols; col++) {
          // `chunk` is lat-major unless the array stores lon first.
          const from = lonFirst ? col * height + row : row * cols + col
          data[row * width + xOffset + col] = Number(source[from])
        }
      }
      xOffset += cols
    }

    const stepLon = lon.step
    const stepLat = lat.step
    const windowWest = fullWidth ? lon.min : lon.min + startCol * lon.step
    const rowTop = lat.ascending ? lat.min + startRow * lat.step : lat.max - startRow * lat.step

    return {
      data,
      width,
      height,
      level,
      lonWest: windowWest,
      lonEast: windowWest + width * stepLon,
      latSouth: lat.ascending ? rowTop : rowTop - height * stepLat,
      latNorth: lat.ascending ? rowTop + height * stepLat : rowTop,
      latAscending: lat.ascending,
    }
  }
}
