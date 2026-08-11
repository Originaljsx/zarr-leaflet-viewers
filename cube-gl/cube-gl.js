/**
 * A hyperspectral image cube in the browser: WebGL2 volume rendering of an
 * (band, y, x) block of reflectance, with the same three views HyperCoast's
 * `image_cube` offers through PyVista -- maximum intensity, alpha compositing
 * with a threshold, and orthogonal slicing -- but fed by zarr chunks instead of
 * a local HDF5 read, and with no Python in the loop.
 *
 * The volume goes to the GPU once as an R32F 3D texture and every control after
 * that (rotation, threshold, slice positions, colour limits, palette) is a
 * uniform change, so interaction never touches the network.
 *
 * Axes: x = longitude, y = latitude (row 0 is the *northern* edge, so the
 * sampler flips it), z = wavelength, with the band axis given a fixed visual
 * height rather than its true count so a 285-band cube of a 96 x 96 box does
 * not render as a skyscraper.
 */

const VERT = `#version 300 es
precision highp float;
in vec3 a_pos;                 // model space, cube corners at +/- u_half
uniform mat4 u_mvp;
out vec3 v_pos;
void main() {
  v_pos = a_pos;
  gl_Position = u_mvp * vec4(a_pos, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec3 v_pos;
out vec4 fragColor;

uniform sampler3D u_volume;
uniform sampler2D u_ramp;
uniform vec3 u_half;           // half-extents of the cube in model space
uniform vec3 u_eye;            // camera position, model space
uniform vec2 u_clim;
uniform float u_threshold;     // samples below this are ignored
uniform float u_density;       // alpha per unit path length, composite mode
uniform int u_mode;            // 0 = max intensity, 1 = composite
uniform int u_steps;
uniform float u_opacity;
uniform vec3 u_slabMin;        // sub-box actually drawn, in texture coords
uniform vec3 u_slabMax;

vec3 toTexture(vec3 p) {
  vec3 t = (p + u_half) / (2.0 * u_half);
  return vec3(t.x, 1.0 - t.y, t.z);   // row 0 is the northern edge
}

vec4 shade(float value) {
  float t = clamp((value - u_clim.x) / max(1e-9, u_clim.y - u_clim.x), 0.0, 1.0);
  return vec4(texture(u_ramp, vec2(t, 0.5)).rgb, t);
}

void main() {
  vec3 dir = normalize(v_pos - u_eye);
  // Slab intersection against the (possibly cropped) box, in model space.
  vec3 boxMin = mix(-u_half, u_half, vec3(u_slabMin.x, 1.0 - u_slabMax.y, u_slabMin.z));
  vec3 boxMax = mix(-u_half, u_half, vec3(u_slabMax.x, 1.0 - u_slabMin.y, u_slabMax.z));
  vec3 inv = 1.0 / dir;
  vec3 t0 = (boxMin - u_eye) * inv;
  vec3 t1 = (boxMax - u_eye) * inv;
  vec3 tNear = min(t0, t1), tFar = max(t0, t1);
  float tEnter = max(max(tNear.x, tNear.y), tNear.z);
  float tExit = min(min(tFar.x, tFar.y), tFar.z);
  tEnter = max(tEnter, 0.0);
  if (tExit <= tEnter) discard;

  float span = tExit - tEnter;
  float stepLen = span / float(u_steps);
  vec4 acc = vec4(0.0);
  float best = -1e30;

  for (int i = 0; i < 512; i++) {
    if (i >= u_steps) break;
    vec3 p = u_eye + dir * (tEnter + (float(i) + 0.5) * stepLen);
    float value = texture(u_volume, toTexture(p)).r;
    if (value != value) continue;              // NaN: outside the swath
    if (value < u_threshold) continue;
    if (u_mode == 0) {
      best = max(best, value);
    } else {
      vec4 s = shade(value);
      float alpha = clamp(s.a * u_density * stepLen * 40.0, 0.0, 1.0);
      acc.rgb += (1.0 - acc.a) * s.rgb * alpha;
      acc.a += (1.0 - acc.a) * alpha;
      if (acc.a > 0.995) break;
    }
  }

  if (u_mode == 0) {
    if (best < -1e29) discard;
    fragColor = vec4(shade(best).rgb, u_opacity);
  } else {
    if (acc.a <= 0.002) discard;
    fragColor = vec4(acc.rgb / max(acc.a, 1e-4), acc.a * u_opacity);
  }
}`

const SLICE_VERT = `#version 300 es
precision highp float;
in vec3 a_pos;
uniform mat4 u_mvp;
uniform vec3 u_half;
out vec3 v_tex;
void main() {
  vec3 t = (a_pos + u_half) / (2.0 * u_half);
  v_tex = vec3(t.x, 1.0 - t.y, t.z);
  gl_Position = u_mvp * vec4(a_pos, 1.0);
}`

const SLICE_FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec3 v_tex;
out vec4 fragColor;
uniform sampler3D u_volume;
uniform sampler2D u_ramp;
uniform vec2 u_clim;
uniform float u_threshold;
uniform float u_opacity;
void main() {
  float value = texture(u_volume, v_tex).r;
  if (value != value || value < u_threshold) discard;
  float t = clamp((value - u_clim.x) / max(1e-9, u_clim.y - u_clim.x), 0.0, 1.0);
  fragColor = vec4(texture(u_ramp, vec2(t, 0.5)).rgb, u_opacity);
}`

/* The cap is the image laid over the top of the cube, HyperCoast's
 * `rgb_wavelengths` overlay: either a three-band composite uploaded as an RGB
 * texture, or whichever single band the clip plane currently sits on, sampled
 * straight out of the volume. */
const CAP_FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec3 v_tex;
out vec4 fragColor;
uniform sampler3D u_volume;
uniform sampler2D u_ramp;
uniform sampler2D u_rgb;
uniform vec2 u_clim;
uniform float u_opacity;
uniform float u_capZ;          // texture-space band the cap shows
uniform int u_rgbMode;         // 1 = composite texture, 0 = single band + ramp
void main() {
  if (u_rgbMode == 1) {
    vec4 rgb = texture(u_rgb, v_tex.xy);
    if (rgb.a < 0.5) discard;
    fragColor = vec4(rgb.rgb, u_opacity);
    return;
  }
  float value = texture(u_volume, vec3(v_tex.xy, u_capZ)).r;
  if (value != value) discard;
  float t = clamp((value - u_clim.x) / max(1e-9, u_clim.y - u_clim.x), 0.0, 1.0);
  fragColor = vec4(texture(u_ramp, vec2(t, 0.5)).rgb, u_opacity);
}`

const LINE_VERT = `#version 300 es
precision highp float;
in vec3 a_pos;
uniform mat4 u_mvp;
void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); }`

const LINE_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec4 u_color;
void main() { fragColor = u_color; }`

/* ---------- small matrix helpers (column-major, as GL wants) ---------- */

function multiply(a, b) {
  const out = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
    }
  }
  return out
}

function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2)
  const out = new Float32Array(16)
  out[0] = f / aspect; out[5] = f
  out[10] = (far + near) / (near - far); out[11] = -1
  out[14] = (2 * far * near) / (near - far)
  return out
}

function lookAt(eye, center, up) {
  const z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]])
  const x = normalize(cross(up, z))
  const y = cross(z, x)
  const out = new Float32Array(16)
  out[0] = x[0]; out[4] = x[1]; out[8] = x[2]
  out[1] = y[0]; out[5] = y[1]; out[9] = y[2]
  out[2] = z[0]; out[6] = z[1]; out[10] = z[2]
  out[12] = -dot(x, eye); out[13] = -dot(y, eye); out[14] = -dot(z, eye)
  out[15] = 1
  return out
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / n, v[1] / n, v[2] / n]
}

/* ---------- geometry ---------- */

/** 12 triangles of a box, given half-extents. */
function boxTriangles(h) {
  const [x, y, z] = h
  const v = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
  ]
  // Wound counter-clockwise seen from outside, so GL's default front-face rule
  // holds and culling the front faces leaves exactly one fragment per pixel --
  // two would composite the volume twice.
  const faces = [
    [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4],
    [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5],
  ]
  const out = []
  for (const [a, b, c, d] of faces) {
    out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d])
  }
  return new Float32Array(out)
}

/** 12 edges of a box given opposite corners, as line segments. */
function boxEdges(lo, hi) {
  const [x0, y0, z0] = lo, [x1, y1, z1] = hi
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ]
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6],
    [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
  const out = []
  for (const [a, b] of pairs) out.push(...v[a], ...v[b])
  return new Float32Array(out)
}

/** A quad spanning the cropped x/y footprint at one band, for the cap. */
function capQuad(lo, hi, z) {
  const [x0, y0] = lo, [x1, y1] = hi
  return new Float32Array([
    x0, y0, z, x1, y0, z, x1, y1, z,
    x0, y0, z, x1, y1, z, x0, y1, z,
  ])
}

function compile(gl, vertSrc, fragSrc) {
  const program = gl.createProgram()
  for (const [type, src] of [[gl.VERTEX_SHADER, vertSrc], [gl.FRAGMENT_SHADER, fragSrc]]) {
    const shader = gl.createShader(type)
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`shader: ${gl.getShaderInfoLog(shader)}`)
    }
    gl.attachShader(program, shader)
    gl.deleteShader(shader)
  }
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`link: ${gl.getProgramInfoLog(program)}`)
  }
  return program
}

/** The tallest the band axis is allowed to look, relative to the x extent. */
const Z_ASPECT = 0.85

export class ImageCube {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false })
    if (!gl) throw new Error('WebGL2 is unavailable in this browser')
    this.canvas = canvas
    this.gl = gl
    // Float textures only filter linearly where the extension exists; without it
    // the sampler falls back to nearest, which shows as a blockier cube rather
    // than a failure.
    this.linear = !!gl.getExtension('OES_texture_float_linear')
    this.maxDim = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE)

    this.volumeProgram = compile(gl, VERT, FRAG)
    this.sliceProgram = compile(gl, SLICE_VERT, SLICE_FRAG)
    this.capProgram = compile(gl, SLICE_VERT, CAP_FRAG)
    this.lineProgram = compile(gl, LINE_VERT, LINE_FRAG)

    this.buffers = {
      box: gl.createBuffer(), edges: gl.createBuffer(),
      slices: gl.createBuffer(), cap: gl.createBuffer(),
    }
    this.volume = null
    this.ramp = null
    this.rgbCap = null
    this.shape = { nx: 1, ny: 1, nz: 1 }
    this.half = [1, 1, Z_ASPECT]

    this.style = {
      clim: [0, 1], threshold: -Infinity, density: 0.6, opacity: 1,
      mode: 'composite', slices: { x: 0.5, y: 0.5, z: 0.5 }, steps: 256,
      // Crop is in texture coordinates: x west-to-east, y north-to-south rows,
      // z band index. Cropping z is HyperCoast's `widget="plane"` -- the cube is
      // cut at a band and the cut face is what you see.
      crop: { min: [0, 0, 0], max: [1, 1, 1] },
      cap: 'none',          // 'none' | 'rgb' | 'band'
    }
    this.view = { yaw: -0.9, pitch: 0.5, dist: 4.2 }
    this._frame = null
    this._attachControls()
  }

  /* ----- data ----- */

  /**
   * @param {Float32Array} data z-major (band, row, col), x varying fastest --
   *   the memory order a zarr `(band, y, x)` selection already arrives in.
   */
  setVolume(data, { nx, ny, nz }) {
    const gl = this.gl
    if (Math.max(nx, ny, nz) > this.maxDim) {
      throw new Error(`volume ${nx}x${ny}x${nz} exceeds this GPU's 3D texture limit of ${this.maxDim}`)
    }
    if (data.length !== nx * ny * nz) {
      throw new Error(`volume data is ${data.length} values, expected ${nx * ny * nz}`)
    }
    if (this.volume) gl.deleteTexture(this.volume)
    this.volume = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_3D, this.volume)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R32F, nx, ny, nz, 0, gl.RED, gl.FLOAT, data)
    const filter = this.linear ? gl.LINEAR : gl.NEAREST
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filter)
    for (const axis of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
      gl.texParameteri(gl.TEXTURE_3D, axis, gl.CLAMP_TO_EDGE)
    }
    this.shape = { nx, ny, nz }
    // Ground extent keeps its true aspect; the band axis gets a fixed height.
    const ax = nx >= ny ? 1 : nx / ny
    const ay = ny >= nx ? 1 : ny / nx
    this.half = [ax, ay, Z_ASPECT]
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.box)
    gl.bufferData(gl.ARRAY_BUFFER, boxTriangles(this.half), gl.STATIC_DRAW)
    this.draw()
  }

  /**
   * The three-band composite laid over the top of the cube -- HyperCoast's
   * `rgb_wavelengths`. Alpha 0 marks cells with no data.
   * @param {Uint8Array} rgba nx * ny * 4, row 0 northernmost.
   */
  setCapImage(rgba, { nx, ny }) {
    const gl = this.gl
    if (this.rgbCap) gl.deleteTexture(this.rgbCap)
    this.rgbCap = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.rgbCap)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nx, ny, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.draw()
  }

  /** The cropped box in model space, as [lo, hi] corners. */
  cropBox() {
    const [hx, hy, hz] = this.half
    const { min, max } = this.style.crop
    const lerp = (h, t) => -h + 2 * h * t
    return [
      [lerp(hx, min[0]), lerp(hy, 1 - max[1]), lerp(hz, min[2])],
      [lerp(hx, max[0]), lerp(hy, 1 - min[1]), lerp(hz, max[2])],
    ]
  }

  /** @param {Array<[number,number,number]>} colors 0..1 or 0..255 triples. */
  setColormap(colors) {
    const gl = this.gl
    const n = colors.length
    const scale = colors.some((c) => c[0] > 1 || c[1] > 1 || c[2] > 1) ? 1 : 255
    const pixels = new Uint8Array(n * 4)
    colors.forEach((c, i) => {
      pixels[i * 4] = Math.round(c[0] * scale)
      pixels[i * 4 + 1] = Math.round(c[1] * scale)
      pixels[i * 4 + 2] = Math.round(c[2] * scale)
      pixels[i * 4 + 3] = 255
    })
    if (this.ramp) gl.deleteTexture(this.ramp)
    this.ramp = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.ramp)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.draw()
  }

  setStyle(patch) {
    // Merge nested objects *before* assigning: Object.assign first would replace
    // style.slices with a partial {x} and lose y/z (NaN planes -> only the last
    // touched slice visible).
    if (patch.slices) patch = { ...patch, slices: { ...this.style.slices, ...patch.slices } }
    if (patch.crop) patch = { ...patch, crop: { ...this.style.crop, ...patch.crop } }
    Object.assign(this.style, patch)
    this.draw()
  }

  setView(patch) {
    Object.assign(this.view, patch)
    this.draw()
  }

  /* ----- interaction ----- */

  _attachControls() {
    const canvas = this.canvas
    let dragging = false, lastX = 0, lastY = 0
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY
      canvas.setPointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return
      const yaw = this.view.yaw + (e.clientX - lastX) * 0.008
      const limit = Math.PI / 2 - 0.05
      const pitch = Math.max(-limit, Math.min(limit, this.view.pitch + (e.clientY - lastY) * 0.008))
      lastX = e.clientX; lastY = e.clientY
      this.setView({ yaw, pitch })
    })
    const stop = (e) => {
      dragging = false
      if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    }
    canvas.addEventListener('pointerup', stop)
    canvas.addEventListener('pointercancel', stop)
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      this.setView({ dist: Math.max(1.6, Math.min(12, this.view.dist * (1 + Math.sign(e.deltaY) * 0.1))) })
    }, { passive: false })
  }

  /* ----- rendering ----- */

  /** Camera position in model space. */
  eye() {
    const { yaw, pitch, dist } = this.view
    return [
      dist * Math.cos(pitch) * Math.sin(yaw),
      -dist * Math.cos(pitch) * Math.cos(yaw),
      dist * Math.sin(pitch),
    ]
  }

  draw() {
    if (this._frame) return
    this._frame = requestAnimationFrame(() => { this._frame = null; this._render() })
  }

  _render() {
    const gl = this.gl
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    if (!this.volume || !this.ramp) return

    const eye = this.eye()
    const mvp = multiply(
      perspective(Math.PI / 4, width / height, 0.05, 60),
      lookAt(eye, [0, 0, 0], [0, 0, 1]))

    const [lo, hi] = this.cropBox()
    const cropped = this.style.crop.min.some((v) => v > 0) || this.style.crop.max.some((v) => v < 1)
    // The full extent stays visible as a faint frame so a clipped cube still
    // shows how much of the spectrum has been cut away.
    if (cropped) this._drawEdges(mvp, [0.30, 0.34, 0.42, 0.5], boxEdges([-this.half[0], -this.half[1], -this.half[2]], this.half))
    this._drawEdges(mvp, [0.42, 0.47, 0.55, 0.85], boxEdges(lo, hi))

    // The cap is opaque, so it goes last when the camera is above it and first
    // when below -- a painter's rule, which is enough for one horizontal plane.
    // Slices mode shows its own three planes; the cap (and the clip crop it
    // sits on) belongs to the ray-marched views only.
    const showCap = this.style.cap !== 'none' && this.style.mode !== 'slices'
    const cameraAbove = eye[2] > hi[2]
    if (showCap && !cameraAbove) this._drawCap(mvp, lo, hi)
    if (this.style.mode === 'slices') this._drawSlices(mvp)
    else this._drawVolume(mvp, eye)
    if (showCap && cameraAbove) this._drawCap(mvp, lo, hi)
  }

  _bindAttrib(program, buffer) {
    const gl = this.gl
    const loc = gl.getAttribLocation(program, 'a_pos')
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0)
  }

  _drawEdges(mvp, color, vertices) {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.edges)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW)
    gl.useProgram(this.lineProgram)
    this._bindAttrib(this.lineProgram, this.buffers.edges)
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, 'u_mvp'), false, mvp)
    gl.uniform4fv(gl.getUniformLocation(this.lineProgram, 'u_color'), color)
    gl.drawArrays(gl.LINES, 0, 24)
  }

  /** The image laid over the top of the (cropped) cube. */
  _drawCap(mvp, lo, hi) {
    const gl = this.gl
    const rgbMode = this.style.cap === 'rgb' && this.rgbCap
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.cap)
    gl.bufferData(gl.ARRAY_BUFFER, capQuad(lo, hi, hi[2]), gl.DYNAMIC_DRAW)
    const p = this.capProgram
    gl.useProgram(p)
    this._bindAttrib(p, this.buffers.cap)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_3D, this.volume)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.ramp)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.rgbCap ?? this.ramp)
    const u = (name) => gl.getUniformLocation(p, name)
    gl.uniform1i(u('u_volume'), 0)
    gl.uniform1i(u('u_ramp'), 1)
    gl.uniform1i(u('u_rgb'), 2)
    gl.uniformMatrix4fv(u('u_mvp'), false, mvp)
    gl.uniform3fv(u('u_half'), this.half)
    gl.uniform2fv(u('u_clim'), this.style.clim)
    gl.uniform1f(u('u_opacity'), 1)
    // A cap in band mode shows the band the clip plane is standing on.
    gl.uniform1f(u('u_capZ'), this.style.crop.max[2])
    gl.uniform1i(u('u_rgbMode'), rgbMode ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  _drawVolume(mvp, eye) {
    const gl = this.gl
    const p = this.volumeProgram
    gl.useProgram(p)
    this._bindAttrib(p, this.buffers.box)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_3D, this.volume)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.ramp)
    const u = (name) => gl.getUniformLocation(p, name)
    gl.uniform1i(u('u_volume'), 0)
    gl.uniform1i(u('u_ramp'), 1)
    gl.uniformMatrix4fv(u('u_mvp'), false, mvp)
    gl.uniform3fv(u('u_half'), this.half)
    gl.uniform3fv(u('u_eye'), eye)
    gl.uniform2fv(u('u_clim'), this.style.clim)
    gl.uniform1f(u('u_threshold'), Number.isFinite(this.style.threshold) ? this.style.threshold : -3.4e38)
    gl.uniform1f(u('u_density'), this.style.density)
    gl.uniform1f(u('u_opacity'), this.style.opacity)
    gl.uniform1i(u('u_mode'), this.style.mode === 'composite' ? 1 : 0)
    gl.uniform1i(u('u_steps'), Math.min(512, this.style.steps))
    const crop = this.style.crop ?? { min: [0, 0, 0], max: [1, 1, 1] }
    gl.uniform3fv(u('u_slabMin'), crop.min)
    gl.uniform3fv(u('u_slabMax'), crop.max)
    // Front faces are culled so the ray always starts on the far side of the
    // box when the camera is outside it, and the near faces never occlude.
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.FRONT)
    gl.drawArrays(gl.TRIANGLES, 0, 36)
    gl.disable(gl.CULL_FACE)
  }

  /** Three orthogonal planes, HyperCoast's `widget="orthogonal"` in spirit. */
  _drawSlices(mvp) {
    const gl = this.gl
    const [hx, hy, hz] = this.half
    const { x, y, z } = this.style.slices
    const px = -hx + 2 * hx * x, py = -hy + 2 * hy * y, pz = -hz + 2 * hz * z
    const quads = [
      [px, -hy, -hz, px, hy, -hz, px, hy, hz, px, -hy, -hz, px, hy, hz, px, -hy, hz],
      [-hx, py, -hz, hx, py, -hz, hx, py, hz, -hx, py, -hz, hx, py, hz, -hx, py, hz],
      [-hx, -hy, pz, hx, -hy, pz, hx, hy, pz, -hx, -hy, pz, hx, hy, pz, -hx, hy, pz],
    ].flat()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.slices)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(quads), gl.DYNAMIC_DRAW)
    const p = this.sliceProgram
    gl.useProgram(p)
    this._bindAttrib(p, this.buffers.slices)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_3D, this.volume)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.ramp)
    const u = (name) => gl.getUniformLocation(p, name)
    gl.uniform1i(u('u_volume'), 0)
    gl.uniform1i(u('u_ramp'), 1)
    gl.uniformMatrix4fv(u('u_mvp'), false, mvp)
    gl.uniform3fv(u('u_half'), this.half)
    gl.uniform2fv(u('u_clim'), this.style.clim)
    gl.uniform1f(u('u_threshold'), Number.isFinite(this.style.threshold) ? this.style.threshold : -3.4e38)
    gl.uniform1f(u('u_opacity'), this.style.opacity)
    // The three planes cut through each other, so they need real depth sorting.
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)
    gl.drawArrays(gl.TRIANGLES, 0, 18)
    gl.disable(gl.DEPTH_TEST)
  }

  dispose() {
    const gl = this.gl
    if (this._frame) cancelAnimationFrame(this._frame)
    if (this.volume) gl.deleteTexture(this.volume)
    if (this.ramp) gl.deleteTexture(this.ramp)
    for (const b of Object.values(this.buffers)) gl.deleteBuffer(b)
    for (const p of [this.volumeProgram, this.sliceProgram, this.capProgram, this.lineProgram]) gl.deleteProgram(p)
  }
}
