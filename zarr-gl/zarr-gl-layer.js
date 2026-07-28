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
    /**
     * Tile size in pixels. Larger than a raster tile server's 256 on purpose:
     * chunk size is fixed by the store (450x450 inner chunks for the MUR
     * pyramid) while this is ours to choose, and a 256 px tile at z9 covers
     * only ~37 cells, so it discards most of every chunk it decodes. 512
     * quarters the number of reads covering a viewport.
     */
    tileSize: 512,
    maxZoom: 12,
    /** Extra viewport fraction to keep rendered, as in `L.Renderer`. */
    padding: 0.1,
    /** Concurrent tile reads. Stores are served over HTTP/2 in practice. */
    concurrency: 16,
    /** Byte budget for the store's byte-range cache. */
    cacheBytes: 256 * 1024 * 1024,
    /** Textures kept for parent-tile fallback before the oldest are dropped. */
    tileCacheSize: 256,
    /** Milliseconds a newly loaded tile takes to fade in; 0 disables. */
    fadeDuration: 200,
    /**
     * Hold the coarser tile a fading tile replaces at full opacity underneath
     * it. Nothing dips towards the basemap, but since the two differ only in
     * resolution the transition is close to invisible; off, a tile visibly
     * fades in and the area it covers is briefly translucent.
     */
    crossfade: false,
    /** Load the parent zoom's tiles too, so zooming out has data to show. */
    prefetchParents: true,
    /** Only reconcile tiles once the map stops moving, as `L.GridLayer` can. */
    updateWhenIdle: false,
    /** Minimum gap between reconciliations while the map is moving. */
    updateInterval: 200,
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
    this._onMove = L.Util.throttle(this._update, this.options.updateInterval, this)
    this.source = new ZarrSource({
      url: this.options.url,
      variable: this.options.variable,
      selectors: this.options.selectors,
      cacheBytes: this.options.cacheBytes,
    })
    this.readyPromise = this.source.readyPromise.then(
      () => {
        this._ready = true
        if (this._map) {
          this._initProgram()
          this._update()
        }
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
    if (this._ready) this._initProgram()
    this.getPane().appendChild(this._canvas)
    this._reset()
    return this
  },

  /**
   * The program, built once metadata has arrived: its sampler type has to match
   * the dtype the store hands back, which is unknown when the canvas is created.
   */
  _initProgram() {
    if (this._program || !this._gl) return
    const gl = this._gl
    const sampler = this.source.texture?.sampler ?? 'float'
    this._program = createProgram(gl, vertexShaderSource, fragmentShaderSource({ sampler }))
    this._uniforms = {}
    for (const name of UNIFORM_NAMES) {
      this._uniforms[name] = gl.getUniformLocation(this._program, name)
    }
    this._attrib = gl.getAttribLocation(this._program, 'a_norm')
    gl.bindVertexArray(this._vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer)
    gl.enableVertexAttribArray(this._attrib)
    gl.vertexAttribPointer(this._attrib, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
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
    // Without this the canvas merely translates with the pane during a drag and
    // the newly exposed edge stays empty until the drag ends.
    if (!this.options.updateWhenIdle) events.move = this._onMove
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
    this._vao = gl.createVertexArray()
    this._buffer = gl.createBuffer()
    gl.bindVertexArray(this._vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer)
    gl.bufferData(gl.ARRAY_BUFFER, 8 * 4, gl.DYNAMIC_DRAW)
    gl.bindVertexArray(null)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    // Rows are tightly packed. The default alignment of 4 would have the driver
    // expect padding after each row, so a 2-byte-per-texel window of odd width
    // looks too small to upload and the texture is left incomplete.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    if (this.options.colors) this._rampTexture = createRampTexture(gl, this.options.colors)
  },

  _destroyGL() {
    const gl = this._gl
    if (!gl) return
    this._clearTiles()
    if (this._rampTexture) gl.deleteTexture(this._rampTexture)
    gl.deleteBuffer(this._buffer)
    gl.deleteVertexArray(this._vao)
    if (this._program) gl.deleteProgram(this._program)
    this._program = null
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
    // Assigning width/height blanks the drawing buffer, so only do it when the
    // size really changed; a pan reaches here on every throttled `move` and
    // clearing there is what made the layer flash black.
    const width = canvasSize.x * dpr
    const height = canvasSize.y * dpr
    if (this._canvas.width !== width || this._canvas.height !== height) {
      this._canvas.width = width
      this._canvas.height = height
      this._canvas.style.width = `${canvasSize.x}px`
      this._canvas.style.height = `${canvasSize.y}px`
    }

    if (!this._ready) return
    this._reconcileTiles()
    // Synchronously, so a resize never leaves a blank frame on screen.
    this._draw()
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

  /** Distinct parents of `tiles`, one zoom coarser. */
  _parentTiles(tiles) {
    const parents = new Map()
    for (const { z, x, y } of tiles) {
      if (z === 0) continue
      const parent = { z: z - 1, x: Math.floor(x / 2), y: Math.floor(y / 2) }
      parents.set(this._tileKey(parent), parent)
    }
    return [...parents.values()]
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
    // Parents are what stands in for a tile that has not arrived, so fetching
    // them makes zooming out instant and gives the fade something to sit on.
    if (this.options.prefetchParents) {
      for (const tile of this._parentTiles(wanted)) {
        const key = this._tileKey(tile)
        keep.add(key)
        if (!this._tiles.has(key) && !this._pending.has(key)) this._enqueue(tile, 1)
      }
    }
    // Tiles that left the view before their turn came are no longer worth
    // reading; their bytes stay in the store cache if they were in flight.
    for (const job of this._queue) {
      if (!keep.has(job.key)) this._pending.delete(job.key)
    }
    this._queue = this._queue.filter((job) => keep.has(job.key))
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

  _enqueue(tile, priority = 0) {
    const key = this._tileKey(tile)
    this._pending.add(key)
    this._queue.push({ tile, key, priority, version: this._version })
    this._pump()
  },

  /** Visible tiles before prefetched parents, and centre outwards within each. */
  _nextJob() {
    const centre = this._map.project(this._map.getCenter(), this._getTileZoom())
    const size = this.options.tileSize
    const cost = ({ tile, priority }) => {
      const scale = 2 ** (this._getTileZoom() - tile.z)
      const dx = (tile.x + 0.5) * size * scale - centre.x
      const dy = (tile.y + 0.5) * size * scale - centre.y
      return priority * 1e9 + Math.hypot(dx, dy)
    }
    let best = 0
    for (let i = 1; i < this._queue.length; i++) {
      if (cost(this._queue[i]) < cost(this._queue[best])) best = i
    }
    return this._queue.splice(best, 1)[0]
  },

  _pump() {
    while (this._active < this.options.concurrency && this._queue.length) {
      const job = this._nextJob()
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
    const spec = this.source.texture
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl[spec.internalFormat],
      window.width,
      window.height,
      0,
      gl[spec.format],
      gl[spec.type],
      window.data
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return {
      texture,
      createdAt: performance.now(),
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
    if (!gl || !this._program || !this._bounds || !this._ready || !this._rampTexture) return
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

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this._rampTexture)
    gl.uniform1i(uniforms.u_ramp, 1)
    gl.uniform1i(uniforms.u_data, 0)

    const now = performance.now()
    const fade = this.options.fadeDuration
    let fading = false

    for (const tile of this._visible ?? []) {
      const own = this._tiles.get(this._tileKey(tile))
      const cached = own ?? this._findAncestor(tile)
      if (!cached) continue
      const alpha = own && fade > 0 ? Math.min(1, (now - own.createdAt) / fade) : 1
      if (alpha < 1) {
        fading = true
        if (this.options.crossfade) {
          const under = this._findAncestor(tile)
          if (under) this._drawTile(tile, under, 1)
        }
      }
      this._drawTile(tile, cached, alpha)
    }
    gl.bindVertexArray(null)
    if (fading) this._requestDraw()
  },

  /** One tile quad, sampling `cached`'s window, in normalized CRS units. */
  _drawTile(tile, cached, alpha) {
    const gl = this._gl
    const uniforms = this._uniforms
    const { nx0, nx1, ny0, ny1 } = this._tileGeometry(tile)

    gl.uniform2f(uniforms.u_lonBounds, cached.lonWest, cached.lonEast)
    gl.uniform2f(uniforms.u_latBounds, cached.latSouth, cached.latNorth)
    gl.uniform1i(uniforms.u_latAscending, cached.latAscending ? 1 : 0)
    gl.uniform1f(uniforms.u_opacity, this.options.opacity * alpha)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, cached.texture)

    // Two triangles over the tile.
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([nx0, ny1, nx1, ny1, nx0, ny0, nx1, ny0]))
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
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
