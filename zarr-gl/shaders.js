/**
 * Shaders for the WebGL Zarr layer.
 *
 * Geometry is an axis-aligned quad in normalized CRS units; the fragment shader
 * turns each fragment's normalized position back into lon/lat and samples the
 * EPSG:4326 data there. Doing the inversion per fragment (rather than
 * stretching a lat-linear texture across a Mercator-linear quad) is what keeps
 * the data registered at every zoom instead of sliding north-south.
 */

export const vertexShaderSource = `#version 300 es
in vec2 a_norm;

// Normalized CRS units -> canvas pixels -> clip space.
uniform float u_worldSize;
uniform vec2 u_offset;
uniform vec2 u_canvasSize;

out vec2 v_norm;

void main() {
  vec2 canvasPx = a_norm * u_worldSize - u_offset;
  vec2 clip = canvasPx / u_canvasSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_norm = a_norm;
}
`

const SAMPLERS = { float: 'sampler2D', int: 'highp isampler2D', uint: 'highp usampler2D' }

/**
 * `sampler` follows the store's dtype, so integer data can be uploaded as
 * `R16I`/`R16UI` and friends instead of being widened to `R32F` on the CPU.
 * Integer textures cannot be filtered, which costs nothing here: sampling is
 * `NEAREST` either way, since interpolating packed values across a no-data
 * boundary would invent data.
 */
export const fragmentShaderSource = ({ sampler = 'float' } = {}) => `#version 300 es
precision highp float;

in vec2 v_norm;

uniform ${SAMPLERS[sampler]} u_data;
uniform sampler2D u_ramp;

// Projection: lon is affine in normalized x; lat is either affine in
// normalized y (plate carree) or the inverse Gudermannian of it (Mercator).
uniform int u_projection;      // 0 = Web Mercator, 1 = linear lon/lat
uniform vec2 u_lonCoeff;       // lon = u_lonCoeff.x * nx + u_lonCoeff.y
uniform vec2 u_latCoeff;       // lat = u_latCoeff.x * ny + u_latCoeff.y
uniform vec2 u_mercCoeff;      // mercY = u_mercCoeff.x * ny + u_mercCoeff.y

// Loaded window, in cell-edge degrees.
uniform vec2 u_lonBounds;      // west, east
uniform vec2 u_latBounds;      // south, north
uniform int u_latAscending;    // 1 when row 0 is the southern edge

uniform int u_geographic;      // 1 = lon/lat degrees (fold on 360); 0 = projected units
uniform int u_logScale;        // 1 = map clim in log10 space (positive data only)
uniform vec2 u_clim;
// Fill and valid range are in the stored (packed) domain, as CF defines them.
uniform vec2 u_validRange;
uniform int u_useFill;
uniform float u_fill;
uniform float u_scaleFactor;
uniform float u_addOffset;
uniform float u_opacity;

out vec4 fragColor;

const float PI = 3.141592653589793;

void main() {
  float lon = u_lonCoeff.x * v_norm.x + u_lonCoeff.y;
  float lat;
  if (u_projection == 0) {
    float mercY = u_mercCoeff.x * v_norm.y + u_mercCoeff.y;
    lat = degrees(atan(sinh(mercY)));
  } else {
    lat = u_latCoeff.x * v_norm.y + u_latCoeff.y;
  }

  // Fold longitude into the window's own 360-degree band so world copies and
  // windows that straddle the antimeridian both sample the same data. Only for
  // geographic grids: on a projected (metre) grid there is no wrap and a
  // 360-degree fold would shred the coordinate, so sample the value directly.
  float lonSpan = u_lonBounds.y - u_lonBounds.x;
  float lonFolded = u_geographic == 1
    ? u_lonBounds.x + mod(lon - u_lonBounds.x, 360.0)
    : lon;

  float latSpan = u_latBounds.y - u_latBounds.x;
  float u = (lonFolded - u_lonBounds.x) / lonSpan;
  float v = u_latAscending == 1
    ? (lat - u_latBounds.x) / latSpan
    : (u_latBounds.y - lat) / latSpan;
  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) discard;

  float raw = float(texture(u_data, vec2(u, v)).r);
  bool isNaN = raw != raw;
  bool outOfRange = raw < u_validRange.x || raw > u_validRange.y;
  bool isFill = u_useFill == 1 && abs(raw - u_fill) < 0.5;
  if (isNaN || outOfRange || isFill) discard;

  float value = raw * u_scaleFactor + u_addOffset;

  // Linear clim, or log10 clim for wide-dynamic-range fields (e.g. radar sigma0).
  // Log needs strictly positive inputs, so the value and both limits are floored
  // to a small epsilon rather than producing NaN.
  float normalized;
  if (u_logScale == 1) {
    const float EPS = 1e-6;
    float lo = log(max(u_clim.x, EPS));
    float hi = log(max(u_clim.y, EPS));
    normalized = clamp((log(max(value, EPS)) - lo) / (hi - lo), 0.0, 1.0);
  } else {
    normalized = clamp((value - u_clim.x) / (u_clim.y - u_clim.x), 0.0, 1.0);
  }
  vec4 color = texture(u_ramp, vec2(normalized, 0.5));
  fragColor = vec4(color.rgb, color.a * u_opacity);
}
`

export function createShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compilation failed: ${log}`)
  }
  return shader
}

export function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram()
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`Program link failed: ${log}`)
  }
  return program
}

/** 1D RGBA texture holding a colormap, sampled by normalized data value. */
export function createRampTexture(gl, colors) {
  const width = colors.length
  const pixels = new Uint8Array(width * 4)
  colors.forEach((color, i) => {
    const [r, g, b] = color
    const scale = r <= 1 && g <= 1 && b <= 1 ? 255 : 1
    pixels[i * 4] = Math.round(r * scale)
    pixels[i * 4 + 1] = Math.round(g * scale)
    pixels[i * 4 + 2] = Math.round(b * scale)
    pixels[i * 4 + 3] = 255
  })
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}
