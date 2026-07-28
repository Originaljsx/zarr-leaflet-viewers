/**
 * A Leaflet layer that renders Zarr data with WebGL.
 *
 * Structure follows @carbonplan/zarr-layer (the MapLibre custom layer the MUR
 * demo uses): one GL context and one canvas for the whole layer, one texture
 * per XYZ tile, parent textures standing in until children arrive, and the
 * EPSG:4326 -> map-projection resampling done per fragment.
 *
 * Leaflet has no custom-layer hook, so the canvas is managed here the way
 * `L.Renderer` manages its own: sized to a padded viewport, positioned in layer
 * coordinates so panning moves it with the pane, and CSS-transformed during
 * zoom animation before being redrawn at `zoomend`.
 */

import L from 'leaflet'

import { LINEAR, MERCATOR, latToNorm, normToLat, projectionInfo } from './projection.js'
import { MAX_TEXELS, ZarrSource } from './zarr-source.js'
import {
  createProgram,
  createRampTexture,
  fragmentShaderSource,
  vertexShaderSource,
} from './shaders.js'

const UNIFORM_NAMES = [
  'u_worldSize',
  'u_offset',
  'u_canvasSize',
  'u_data',
  'u_ramp',
  'u_projection',
  'u_lonCoeff',
  'u_latCoeff',
  'u_mercCoeff',
  'u_lonBounds',
  'u_latBounds',
  'u_latAscending',
  'u_clim',
  'u_validRange',
  'u_useFill',
  'u_fill',
  'u_scaleFactor',
  'u_addOffset',
  'u_opacity',
]

export const ZarrGLLayer = L.Layer.extend({
  options: {
    /** Zarr store URL. */
    url: null,
    /** Variable (array) name within the store. */
    variable: null,
    /** Index selectors for non-spatial dimensions, e.g. `{ time: 3 }`. */
    selectors: {},
    /** Colormap as an array of RGB triples (0-1 or 0-255). */
    colors: null,
    /** [min, max] data values mapped across the colormap. */
    clim: [0, 1],
    opacity: 1,
    tileSize: 256,
    maxZoom: 12,
    /** Extra viewport fraction to keep rendered, as in `L.Renderer`. */
    padding: 0.1,
    /** Concurrent tile reads. */
    concurrency: 6,
    /** Textures kept for parent-tile fallback before the oldest are dropped. */
    tileCacheSize: 256,
    pane: 'overlayPane',
  },

  initialize(options) {
    L.setOptions(this, options)
    this._tiles = new Map()
    this._pending = new Set()
    this._controllers = new Map()
    this._queue = []
    this._active = 0
    this._version = 0
    this.source = new ZarrSource({
      url: this.options.url,
      variable: this.options.variable,
      selectors: this.options.selectors,
    })
    this.readyPromise = this.source.readyPromise.then(
      () => {
        this._ready = true
        if (this._map) this._update()
        return this.source
      },
      (error) => {
        console.error('[zarr-gl] failed to open store', error)
        throw error
      }
    )
  },

  onAdd() {
    this._initCanvas()
    this.getPane().appendChild(this._canvas)
    this._reset()
    return this
  },

  onRemove() {
    this._abortAll()
    this._destroyGL()
    L.DomUtil.remove(this._canvas)
    return this
  },

  getEvents() {
    const events = {
      viewreset: this._reset,
      resize: this._resize,
      moveend: this._update,
      zoomend: this._update,
      zoom: this._onZoom,
    }
    if (this._zoomAnimated) events.zoomanim = this._onAnimZoom
    return events
  },

  /* ------------------------------- public API ------------------------------ */

  /** Update colormap, colour limits and/or opacity. */
  updateStyle({ colors, clim, opacity } = {}) {
    if (colors) {
      this.options.colors = colors
      if (this._gl) {
        if (this._rampTexture) this._gl.deleteTexture(this._rampTexture)
        this._rampTexture = createRampTexture(this._gl, colors)
      }
    }
    if (clim) this.options.clim = clim
    if (opacity !== undefined) this.options.opacity = opacity
    this._requestDraw()
  },

  /** Select different indices along non-spatial dimensions (time, depth, ...). */
  updateSelectors(selectors) {
    let changed = false
    for (const [name, value] of Object.entries(selectors ?? {})) {
      if (this.source.selectors[name] !== value) {
        this.source.selectors[name] = value
        changed = true
      }
    }
    if (!changed) return
    // Every texture holds data for the previous selection.
    this._version += 1
    this._abortAll()
    this._clearTiles()
    this._update()
  },

  setOpacity(opacity) {
    this.updateStyle({ opacity })
  },

  /* ------------------------------ canvas / GL ------------------------------ */

  _initCanvas() {
    const canvas = L.DomUtil.create('canvas', 'leaflet-zarr-gl-layer leaflet-layer')
    canvas.style.position = 'absolute'
    this._canvas = canvas
    this._zoomAnimated = this._map.options.zoomAnimation && L.Browser.any3d
    if (this._zoomAnimated) L.DomUtil.addClass(canvas, 'leaflet-zoom-animated')

    const gl = canvas.getContext('webgl2', {
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    })
    if (!gl) throw new Error('WebGL2 is required by the Zarr GL layer')
    this._gl = gl
    this._program = createProgram(gl, vertexShaderSource, fragmentShaderSource)
    this._uniforms = {}
    for (const name of UNIFORM_NAMES) {
      this._uniforms[name] = gl.getUniformLocation(this._program, name)
    }
    this._attrib = gl.getAttribLocation(this._program, 'a_norm')
    this._vao = gl.createVertexArray()
    this._buffer = gl.createBuffer()
    gl.bindVertexArray(this._vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer)
    gl.bufferData(gl.ARRAY_BUFFER, 8 * 4, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(this._attrib)
    gl.vertexAttribPointer(this._attrib, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    if (this.options.colors) this._rampTexture = createRampTexture(gl, this.options.colors)
  },

  _destroyGL() {
    const gl = this._gl
    if (!gl) return
    this._clearTiles()
    if (this._rampTexture) gl.deleteTexture(this._rampTexture)
    gl.deleteBuffer(this._buffer)
    gl.deleteVertexArray(this._vao)
    gl.deleteProgram(this._program)
    this._gl = null
  },

  _clearTiles() {
    for (const tile of this._tiles.values()) {
      if (tile.texture && this._gl) this._gl.deleteTexture(tile.texture)
    }
    this._tiles.clear()
  },

  /* --------------------------- viewport bookkeeping ------------------------ */

  _resize(event) {
    this._update(event)
  },

  _reset() {
    this._update()
    this._updateTransform(this._map.getCenter(), this._map.getZoom())
  },

  _onZoom() {
    this._updateTransform(this._map.getCenter(), this._map.getZoom())
  },

  _onAnimZoom(event) {
    this._updateTransform(event.center, event.zoom)
  },

  /** Keep the already-drawn canvas aligned while Leaflet animates a zoom. */
  _updateTransform(center, zoom) {
    if (this._zoom === undefined) return
    const map = this._map
    const scale = map.getZoomScale(zoom, this._zoom)
    const position = L.DomUtil.getPosition(this._canvas)
    const viewHalf = map.getSize().multiplyBy(0.5 + this.options.padding)
    const currentCenterPoint = map.project(this._center, zoom)
    const topLeftOffset = viewHalf
      .multiplyBy(-scale)
      .add(currentCenterPoint)
      .subtract(map._getNewPixelOrigin(center, zoom))
    if (L.Browser.any3d) {
      L.DomUtil.setTransform(this._canvas, topLeftOffset, scale)
    } else {
      L.DomUtil.setPosition(this._canvas, topLeftOffset.add(position).subtract(position))
    }
  },

  /** Recompute the padded canvas bounds, then reconcile tiles and redraw. */
  _update() {
    if (this._map._animatingZoom && this._bounds) return
    const map = this._map
    const padding = this.options.padding
    const size = map.getSize()
    const min = map.containerPointToLayerPoint(size.multiplyBy(-padding)).round()
    this._bounds = new L.Bounds(min, min.add(size.multiplyBy(1 + padding * 2)).round())
    this._center = map.getCenter()
    this._zoom = map.getZoom()

    const canvasSize = this._bounds.getSize()
    const dpr = L.Browser.retina ? 2 : 1
    L.DomUtil.setPosition(this._canvas, this._bounds.min)
    this._canvas.width = canvasSize.x * dpr
    this._canvas.height = canvasSize.y * dpr
    this._canvas.style.width = `${canvasSize.x}px`
    this._canvas.style.height = `${canvasSize.y}px`

    if (!this._ready) return
    this._reconcileTiles()
    this._requestDraw()
  },

  /* --------------------------------- tiles -------------------------------- */

  _getTileZoom() {
    return Math.max(0, Math.min(this.options.maxZoom, Math.round(this._zoom)))
  },

  /** Tiles covering the padded canvas at the current tile zoom. */
  _visibleTiles() {
    const map = this._map
    const tileZoom = this._getTileZoom()
    const tileSize = this.options.tileSize
    // Canvas bounds are layer points at this._zoom; convert to tile zoom pixels.
    const scale = map.getZoomScale(tileZoom, this._zoom)
    const origin = map.getPixelOrigin()
    const min = this._bounds.min.add(origin).multiplyBy(scale)
    const max = this._bounds.max.add(origin).multiplyBy(scale)
    const worldSize = map.options.crs.scale(tileZoom)
    const rows = Math.round(worldSize / tileSize)

    const tiles = []
    const xStart = Math.floor(min.x / tileSize)
    const xEnd = Math.ceil(max.x / tileSize)
    const yStart = Math.max(0, Math.floor(min.y / tileSize))
    const yEnd = Math.min(rows, Math.ceil(max.y / tileSize))
    for (let x = xStart; x < xEnd; x++) {
      for (let y = yStart; y < yEnd; y++) {
        tiles.push({ z: tileZoom, x, y })
      }
    }
    return tiles
  },

  /** Geographic and normalized-CRS bounds of a tile, world copies included. */
  _tileGeometry(tile) {
    const worldSize = this._map.options.crs.scale(tile.z)
    const tileSize = this.options.tileSize
    const info = this._getProjection()
    const nx0 = (tile.x * tileSize) / worldSize
    const nx1 = ((tile.x + 1) * tileSize) / worldSize
    const ny0 = (tile.y * tileSize) / worldSize
    const ny1 = ((tile.y + 1) * tileSize) / worldSize
    return {
      nx0,
      nx1,
      ny0,
      ny1,
      lonWest: info.lonA * nx0 + info.lonB,
      lonEast: info.lonA * nx1 + info.lonB,
      latNorth: normToLat(info, ny0),
      latSouth: normToLat(info, ny1),
    }
  },

  _tileKey(tile) {
    return `${tile.z}/${tile.x}/${tile.y}`
  },

  _reconcileTiles() {
    const wanted = this._visibleTiles()
    const tileZoom = this._getTileZoom()
    const keep = new Set()
    for (const tile of wanted) {
      const key = this._tileKey(tile)
      keep.add(key)
      if (!this._tiles.has(key) && !this._pending.has(key)) this._enqueue(tile)
    }
    // Ancestors are kept so they can stand in for tiles that are still loading;
    // anything else off screen goes, oldest first once over the cache size.
    for (const key of [...this._tiles.keys()]) {
      if (keep.has(key)) continue
      const [z] = key.split('/').map(Number)
      const overCapacity = this._tiles.size > this.options.tileCacheSize
      if (z < tileZoom && !overCapacity) continue
      this._dropTile(key)
    }
    this._visible = wanted
  },

  _dropTile(key) {
    const tile = this._tiles.get(key)
    if (tile?.texture && this._gl) this._gl.deleteTexture(tile.texture)
    this._tiles.delete(key)
  },

  _enqueue(tile) {
    const key = this._tileKey(tile)
    this._pending.add(key)
    this._queue.push({ tile, key, version: this._version })
    this._pump()
  },

  _pump() {
    while (this._active < this.options.concurrency && this._queue.length) {
      const job = this._queue.shift()
      this._active += 1
      this._loadTile(job).finally(() => {
        this._active -= 1
        this._pump()
      })
    }
  },

  async _loadTile({ tile, key, version }) {
    const controller = new AbortController()
    this._controllers.set(key, controller)
    try {
      const geometry = this._tileGeometry(tile)
      const degPerPixel = Math.abs(geometry.lonEast - geometry.lonWest) / this.options.tileSize
      let level = this.source.chooseLevel(degPerPixel)
      // Step coarser rather than upload an oversized texture.
      for (;;) {
        const { cols, rows } = this.source.windowTexels(level, geometry)
        if (cols <= MAX_TEXELS && rows <= MAX_TEXELS) break
        const coarser = this.source.coarser(level)
        if (!coarser) break
        level = coarser
      }
      const window = await this.source.readWindow({
        level,
        lonWest: geometry.lonWest,
        lonEast: geometry.lonEast,
        latSouth: geometry.latSouth,
        latNorth: geometry.latNorth,
        signal: controller.signal,
      })
      if (version !== this._version || !this._gl) return
      if (window) this._tiles.set(key, this._createTexture(window))
      this._requestDraw()
    } catch (error) {
      if (error?.name !== 'AbortError') console.error('[zarr-gl] tile read failed', key, error)
    } finally {
      this._pending.delete(key)
      this._controllers.delete(key)
    }
  },

  _createTexture(window) {
    const gl = this._gl
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R32F,
      window.width,
      window.height,
      0,
      gl.RED,
      gl.FLOAT,
      window.data
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return {
      texture,
      lonWest: window.lonWest,
      lonEast: window.lonEast,
      latSouth: window.latSouth,
      latNorth: window.latNorth,
      latAscending: window.latAscending,
    }
  },

  /** Nearest cached ancestor of a tile, used while the tile itself loads. */
  _findAncestor(tile) {
    let { z, x, y } = tile
    while (z > 0) {
      z -= 1
      x = Math.floor(x / 2)
      y = Math.floor(y / 2)
      const found = this._tiles.get(`${z}/${x}/${y}`)
      if (found) return found
    }
    return null
  },

  _abortAll() {
    for (const controller of this._controllers.values()) controller.abort()
    this._controllers.clear()
    this._queue.length = 0
    this._pending.clear()
  },

  /* -------------------------------- drawing ------------------------------- */

  _requestDraw() {
    if (this._frame || !this._map) return
    this._frame = L.Util.requestAnimFrame(() => {
      this._frame = null
      this._draw()
    }, this)
  },

  _draw() {
    const gl = this._gl
    if (!gl || !this._bounds || !this._ready || !this._rampTexture) return
    const map = this._map
    const info = this._getProjection()
    const uniforms = this._uniforms
    const source = this.source

    gl.viewport(0, 0, this._canvas.width, this._canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this._program)
    gl.bindVertexArray(this._vao)

    const worldSize = map.options.crs.scale(this._zoom)
    const origin = map.getPixelOrigin().add(this._bounds.min)
    gl.uniform1f(uniforms.u_worldSize, worldSize)
    gl.uniform2f(uniforms.u_offset, origin.x, origin.y)
    gl.uniform2f(uniforms.u_canvasSize, this._canvas.width, this._canvas.height)
    gl.uniform1i(uniforms.u_projection, info.mode)
    gl.uniform2f(uniforms.u_lonCoeff, info.lonA, info.lonB)
    gl.uniform2f(uniforms.u_latCoeff, info.latA ?? 0, info.latB ?? 0)
    gl.uniform2f(uniforms.u_mercCoeff, info.mercA ?? 0, info.mercB ?? 0)
    gl.uniform2f(uniforms.u_clim, this.options.clim[0], this.options.clim[1])
    gl.uniform2f(uniforms.u_validRange, finite(source.noDataMin), finite(source.noDataMax))
    gl.uniform1i(uniforms.u_useFill, source.fillValue === null ? 0 : 1)
    gl.uniform1f(uniforms.u_fill, source.fillValue ?? 0)
    gl.uniform1f(uniforms.u_scaleFactor, source.scaleFactor)
    gl.uniform1f(uniforms.u_addOffset, source.addOffset)
    gl.uniform1f(uniforms.u_opacity, this.options.opacity)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this._rampTexture)
    gl.uniform1i(uniforms.u_ramp, 1)
    gl.uniform1i(uniforms.u_data, 0)

    for (const tile of this._visible ?? []) {
      const cached = this._tiles.get(this._tileKey(tile)) ?? this._findAncestor(tile)
      if (!cached) continue
      const { nx0, nx1, ny0, ny1 } = this._tileGeometry(tile)

      gl.uniform2f(uniforms.u_lonBounds, cached.lonWest, cached.lonEast)
      gl.uniform2f(uniforms.u_latBounds, cached.latSouth, cached.latNorth)
      gl.uniform1i(uniforms.u_latAscending, cached.latAscending ? 1 : 0)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, cached.texture)

      // Two triangles over the tile, in normalized CRS units.
      gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer)
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        new Float32Array([nx0, ny1, nx1, ny1, nx0, ny0, nx1, ny0])
      )
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    gl.bindVertexArray(null)
  },

  _getProjection() {
    this._projectionInfo ??= projectionInfo(this._map.options.crs)
    return this._projectionInfo
  },
})

/** GLSL floats have no infinity; clamp to the representable extreme. */
function finite(value) {
  if (value === Infinity) return 3.4e38
  if (value === -Infinity) return -3.4e38
  return value
}

export function zarrGLLayer(options) {
  return new ZarrGLLayer(options)
}

export { LINEAR, MERCATOR, latToNorm }
