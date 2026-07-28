/**
 * Projection helpers for the WebGL Zarr layer.
 *
 * The layer works in "normalized CRS units": the coordinates Leaflet's CRS
 * produces before the zoom scale is applied, i.e.
 *
 *   normalized = map.project(latlng, zoom) / crs.scale(zoom)
 *
 * For EPSG:3857 that is Web Mercator normalized [0,1]x[0,1]; for EPSG:4326 it
 * is plate carree [0,2]x[0,1]. Rendering happens in those units so the shader
 * can invert them back to lon/lat per fragment, which is what keeps
 * EPSG:4326 data correctly registered under a Mercator map at every zoom.
 */

export const MERCATOR = 0
export const LINEAR = 1

const EPSG3857_CODES = ['EPSG:3857', 'EPSG:900913']

/**
 * Describe how normalized CRS units map to lon/lat for a Leaflet map.
 *
 * Returns the coefficients the shaders need:
 *   lon  = lonA * nx + lonB
 *   lat  = degrees(atan(sinh(mercA * ny + mercB)))   // mode === MERCATOR
 *   lat  = latA * ny + latB                          // mode === LINEAR
 */
export function projectionInfo(crs) {
  const code = crs?.code
  if (!code || EPSG3857_CODES.includes(code)) {
    return { mode: MERCATOR, lonA: 360, lonB: -180, mercA: -2 * Math.PI, mercB: Math.PI }
  }
  if (code === 'EPSG:4326') {
    return { mode: LINEAR, lonA: 180, lonB: -180, latA: -180, latB: 90 }
  }
  // Derive coefficients from the CRS transformation for other linear CRSs
  // (MMGIS planetary maps use custom EPSG:4326-like CRSs).
  const t = crs.transformation
  if (!t) throw new Error(`Unsupported CRS for the Zarr GL layer: ${code}`)
  return {
    mode: LINEAR,
    lonA: 1 / t._a,
    lonB: -t._b / t._a,
    latA: 1 / t._c,
    latB: -t._d / t._c,
  }
}

/** Normalized-CRS x for a longitude, using the coefficients above. */
export function lonToNorm(info, lon) {
  return (lon - info.lonB) / info.lonA
}

/** Normalized-CRS y for a latitude. */
export function latToNorm(info, lat) {
  if (info.mode === LINEAR) return (lat - info.latB) / info.latA
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat))
  const merc = Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))
  return (merc - info.mercB) / info.mercA
}

/** Latitude for a normalized-CRS y (inverse of {@link latToNorm}). */
export function normToLat(info, ny) {
  if (info.mode === LINEAR) return info.latA * ny + info.latB
  const merc = info.mercA * ny + info.mercB
  return (Math.atan(Math.sinh(merc)) * 180) / Math.PI
}

/** Longitude for a normalized-CRS x. */
export function normToLon(info, nx) {
  return info.lonA * nx + info.lonB
}
