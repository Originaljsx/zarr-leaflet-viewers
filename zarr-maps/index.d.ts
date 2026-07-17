import { c as DimensionNamesProps, d as DimIndicesProps, f as DataSliceProps, Z as ZarrSelectors, S as SliceArgs, D as DimensionValues, b as ZarrLevelMetadata, e as XYLimitsProps, C as CRS, k as CFCalendar } from './zarr-layer-provider-CoXq4UFO.js';
export { A as Accent, l as AccentR, m as Blues, n as BluesR, B as BoundsProps, o as BrBG, p as BrBGR, q as BuGn, r as BuGnR, s as BuPu, t as BuPuR, u as CMRmap, v as CMRmapR, j as CalendarDate, i as ColorMapInfo, h as ColorMapName, g as ColorScaleProps, w as Dark2, x as Dark2R, G as GnBu, y as GnBuR, z as Greens, E as GreensR, F as Greys, H as GreysR, O as OrRd, I as OrRdR, J as Oranges, K as OrangesR, P as PRGn, L as PRGnR, M as Paired, N as PairedR, Q as Pastel1, R as Pastel1R, T as Pastel2, U as Pastel2R, V as PiYG, W as PiYGR, Y as PuBu, $ as PuBuGn, a0 as PuBuGnR, _ as PuBuR, a1 as PuOr, a2 as PuOrR, a3 as PuRd, a4 as PuRdR, a5 as Purples, a6 as PurplesR, a7 as RdBu, a8 as RdBuR, a9 as RdGy, aa as RdGyR, ab as RdPu, ac as RdPuR, ad as RdYlBu, ae as RdYlBuR, af as RdYlGn, ag as RdYlGnR, ah as Reds, ai as RedsR, aj as Set1, ak as Set1R, al as Set2, am as Set2R, an as Set3, ao as Set3R, ap as Spectral, aq as SpectralR, ar as Wistia, as as WistiaR, X as XYLimits, at as YlGn, av as YlGnBu, aw as YlGnBuR, au as YlGnR, ax as YlOrBr, ay as YlOrBrR, az as YlOrRd, aA as YlOrRdR, c4 as ZarrLayerProvider, a as ZarrSelectorsProps, aB as afmhot, aC as afmhotR, c2 as allColorScales, aD as autumn, aE as autumnR, aF as binary, aG as binaryR, aH as bone, aI as boneR, aJ as brg, aK as brgR, aL as bwr, aM as bwrR, aN as cividis, aO as cividisR, c1 as colorScaleByName, c3 as colormapBuilder, aP as cool, aQ as coolR, aR as coolwarm, aS as coolwarmR, aT as copper, aU as copperR, aV as cubehelix, aW as cubehelixR, aX as flag, aY as flagR, aZ as gistEarth, a_ as gistEarthR, a$ as gistGray, b0 as gistGrayR, b1 as gistHeat, b2 as gistHeatR, b3 as gistNcar, b4 as gistNcarR, b5 as gistRainbow, b6 as gistRainbowR, b7 as gistStern, b8 as gistSternR, b9 as gistYarg, ba as gistYargR, bb as gnuplot, bd as gnuplot2, be as gnuplot2R, bc as gnuplotR, bf as gray, bg as grayR, bh as hot, bi as hotR, bj as hsv, bk as hsvR, bl as inferno, bm as infernoR, bn as jet, bo as jetR, bp as magma, bq as magmaR, br as nipySpectral, bs as nipySpectralR, bt as ocean, bu as oceanR, bv as pink, bw as pinkR, bx as plasma, by as plasmaR, bz as prism, bA as prismR, bB as rainbow, bC as rainbowR, bD as seismic, bE as seismicR, bF as spring, bG as springR, bH as summer, bI as summerR, bJ as tab10, bK as tab10R, bL as tab20, bM as tab20R, bN as tab20b, bO as tab20bR, bP as tab20c, bQ as tab20cR, bR as terrain, bS as terrainR, bT as turbo, bU as turboR, bV as twilight, bW as twilightR, bX as twilightShifted, bY as twilightShiftedR, bZ as viridis, b_ as viridisR, b$ as winter, c0 as winterR } from './zarr-layer-provider-CoXq4UFO.js';
import * as zarr from 'zarrita';

/**
 * Default colormap for data visualization.
 */
declare const DEFAULT_COLORMAP = "viridis";
/**
 * Earth's radius in meters for Web Mercator projection.
 */
declare const EARTH_RADIUS = 6378137;
/**
 * Maximum latitude in degrees for Web Mercator projection.
 */
declare const MAX_LAT = 85.05112878;
/**
 * Default data scale range for visualization.
 */
declare const DEFAULT_SCALE: [number, number];
/**
 * Default opacity for layer visualization.
 */
declare const DEFAULT_OPACITY = 1;
declare const DIMENSION_ALIASES_DEFAULT: {
    [key in keyof DimensionNamesProps]: string[];
};
declare const CF_MAPPINGS: {
    [key in keyof DimensionNamesProps]: string[];
};

/**
 * @module gl-utils
 *
 * Low-level WebGL2 utility functions for shader creation, program linking,
 * and generation of color ramp textures used in Leaflet and Zarr visualization.
 *
 * These helpers are used internally by rendering providers (e.g., {@link ZarrCubeProvider})
 * to generate color-mapped textures and dynamic shader programs.
 */
/**
 * Creates and compiles a WebGL shader from source code.
 *
 * @param gl - The WebGL2 rendering context.
 * @param type - Shader type (`gl.VERTEX_SHADER` or `gl.FRAGMENT_SHADER`).
 * @param source - GLSL source code for the shader.
 * @returns The compiled {@link WebGLShader} instance, or `null` if compilation failed.
 *
 * @example
 * ```ts
 * const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
 * const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
 * ```
 */
declare function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null;
/**
 * Creates and links a WebGL program using the specified vertex and fragment shaders.
 *
 * @param gl - The WebGL2 rendering context.
 * @param vertexShader - Compiled vertex shader.
 * @param fragmentShader - Compiled fragment shader.
 * @returns The linked {@link WebGLProgram}, or `null` if linking failed.
 *
 * @example
 * ```ts
 * const program = createProgram(gl, vertexShader, fragmentShader);
 * gl.useProgram(program);
 * ```
 */
declare function createProgram(gl: WebGL2RenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram | null;
/**
 * Creates a flexible 1D color-ramp texture supporting either normalized (0–1)
 * or integer (0–255) color definitions.
 *
 * @param gl - The WebGL2 rendering context.
 * @param colors - Array of RGB colors in normalized `[0–1]` or integer `[0–255]` format.
 * @param opacity - Opacity multiplier between 0 and 1.
 * @returns A {@link WebGLTexture} representing the color ramp, or `null` if creation failed.
 *
 * @example
 * ```ts
 * const texture = createColorRampTexture(gl, [[1, 0, 0], [0, 0, 1]], 0.8);
 * ```
 */
declare function createColorRampTexture(gl: WebGL2RenderingContext, colors: number[][], opacity: number): WebGLTexture | null;

/**
 * @module zarr-utils
 *
 * Utility functions for reading, interpreting, and slicing Zarr datasets
 * used by Leaflet visualization components (e.g., {@link ZarrLayerProvider}).
 *
 * Provides:
 * - Dimension detection and CF-compliant alias mapping
 * - Slice generation for multidimensional Zarr arrays
 * - Multiscale (pyramidal) dataset handling
 * - CRS detection and coordinate transformation utilities
= */

/**
 * Normalizes multiscale level descriptors across the two `multiscales`
 * metadata conventions this library needs to read:
 *  - OME-NGFF array form: `multiscales[0].datasets[].path` (any extra
 *    per-level fields, e.g. `crs`, live alongside `path`).
 *  - zarr-conventions object form: `multiscales.layout[].asset` (the level's
 *    group name, e.g. `"0"`, `"1"`, ...).
 *
 * @param attrs - Zarr group attributes.
 * @returns Level descriptors with a `path` field, or `undefined` if no
 *   usable multiscales info is present.
 */
declare function normalizeMultiscaleDatasets(attrs: Record<string, any> | undefined | null): Array<{
    path: string;
    [key: string]: any;
}> | undefined;
/**
 * Identify the indices of common dimensions (lat, lon, time, elevation)
 * in a Zarr array, optionally using CF-compliant standard names or custom dimension mappings.
 *
 * @param dimNames - Names of the array dimensions.
 * @param dimensionNames - Optional explicit mapping of dimension names (see {@link DimensionNamesProps}).
 * @param coordinates - Optional coordinate variable dictionary.
 * @returns A {@link DimIndicesProps} object describing each dimension’s index and name.
 */
declare function identifyDimensionIndices(dimNames: string[], dimensionNames?: DimensionNamesProps, coordinates?: Record<string, any>): DimIndicesProps;
/**
 * Constructs Zarr slice arguments for extracting a subregion of a multidimensional array.
 *
 * This function:
 * - Converts geographic / elevation slice ranges into Zarr slice objects.
 * - Converts value-based selectors (e.g. `{type: "value", selected: 2020}`) into nearest index selectors.
 * - Optionally loads dimension coordinate arrays for the selected slice.
 * - Produces a *new* selector map describing index-based selections.
 *
 * @param shape               Full array shape.
 * @param dataSlice           Pixel-space slice ranges `{ startX, endX, startY, endY, startElevation?, endElevation? }` (see {@link DataSliceProps}).
 * @param dimIndices          Mapping of dimension names → indices as returned by `identifyDimensionIndices` (see {@link DimIndicesProps}).
 * @param selectors           User-provided selection map (lat/lon/elevation/time/etc.). See {@link ZarrSelectors}.
 *
 * @returns An object containing:
 *   - `sliceArgs`: Array of slice objects/indexes matching the array's dimensions. See {@link SliceArgs}.
 *   - `dimensionValues`: Possibly updated coordinate arrays.
 *   - `selectors`: Updated index-based selectors. See {@link ZarrSelectors}.
 */
declare function calculateSliceArgs(shape: number[], dataSlice: DataSliceProps, dimIndices: DimIndicesProps, selectors: ZarrSelectors): SliceArgs;
/**
 * Finds the index of the value in `values` nearest to `target`.
 * @param values - Array of numeric values.
 * @param target - Target value to find.
 * @returns Index of the nearest value.
 */
declare function calculateNearestIndex(values: Float64Array | number[] | string[], target: number | string): number;
/**
 * Loads the coordinate values for a specific dimension.
 *
 * Behavior:
 * - Uses cached values if available (does not reload unless the caller resets the cache).
 * - Resolves the correct multiscale level if `levelInfo` is provided.
 * - Converts Zarr buffers into plain JavaScript number arrays.
 * - Converts bigint values to number.
 * - If a slice `[start, end]` is supplied, only a sub-range is returned.
 *
 * @param dimensionValues  Cache of already-loaded coordinate arrays.
 * @param levelInfo        Optional multiscale subpath.
 * @param dimIndices      Dimension index info. See {@link DimIndicesProps}.
 * @param root            Root Zarr group location.
 * @param zarrVersion     Zarr version (2 or 3).
 * @param slice           Optional index range `[start, end]` to slice the loaded values.
 *
 * @returns The loaded coordinate array for the dimension.
 */
declare function loadDimensionValues(dimensionValues: DimensionValues, levelInfo: string | null, dimIndices: DimIndicesProps[string], root: zarr.Location<zarr.FetchStore>, zarrVersion: 2 | 3 | null, slice?: [number, number]): Promise<Float64Array | number[] | string[]>;
/**
 * Opens a Zarr variable (single-scale or multiscale pyramid) and prepares its metadata.
 *
 * - Detects and loads multiscale dataset levels (if present).
 * - Computes per-level dimension sizes and stores them in `levelMetadata`.
 * - Scans coordinate variables from `_ARRAY_DIMENSIONS` or consolidated metadata.
 * - Detects CF/alias-based dimension names (lat/lon/time/elevation).
 *
 * @param store             Zarr store (e.g., `FetchStore`).
 * @param root              Root Zarr group location.
 * @param variable          Variable name within the Zarr group.
 * @param dimensions        Optional explicit dimension name mapping. See {@link DimensionNamesProps}.
 * @param levelMetadata     Map to populate with per-level metadata (width/height).
 * @param levelCache        Cache for opened multiscale level arrays.
 * @param zarrVersion      Zarr version (2 or 3).
 * @param multiscaleLevel   Optional initial multiscale level to open.
 *
 * @returns
 *   - `zarrArray` — the opened array for the selected multiscale level.
 *   - `levelInfos` — all multiscale level paths.
 *   - `dimIndices` — discovered dimension index mapping. See {@link DimIndicesProps}.
 *   - `attrs` — variable or group attributes.
 *   - `multiscaleLevel` — updated level if adjusted due to missing levels.
 */
declare function initZarrDataset(store: zarr.FetchStore, root: zarr.Location<zarr.FetchStore>, variable: string, dimensions: DimensionNamesProps, levelMetadata: Map<number, ZarrLevelMetadata>, levelCache: Map<number, any>, zarrVersion: 2 | 3 | null, multiscaleLevel?: number): Promise<{
    zarrArray: zarr.Array<any>;
    levelInfos: string[];
    dimIndices: DimIndicesProps;
    attrs: Record<string, any>;
    multiscaleLevel?: number;
}>;
/**
 * Retrieve the geographic coordinate limits (min/max latitude/longitude) for a Zarr array.
 *
 * @param root - Zarr group root.
 * @param dimIndices - Dimension mapping. See {@link DimIndicesProps}.
 * @param levelInfos - Multiscale level paths.
 * @param multiscale - Whether the dataset is multiscale.
 * @param zarrVersion - Zarr version (2 or 3).
 *
 * @returns A {@link XYLimitsProps} object describing the coordinate bounds.
 */
declare function getXYLimits(root: zarr.Location<zarr.FetchStore>, dimIndices: DimIndicesProps, levelInfos: string[], multiscale: boolean, zarrVersion: 2 | 3 | null): Promise<XYLimitsProps>;
/**
 * Opens and caches a specific multiscale level array.
 * Keeps a small LRU-style cache of up to three levels.
 *
 * @param root        Zarr group root.
 * @param levelPath   Path to the multiscale level.
 * @param variable    Variable name within the level (if any).
 * @param levelCache Cache of opened level arrays.
 * @param zarrVersion Zarr version (2 or 3).
 *
 * @returns The opened Zarr array for the specified level.
 */
declare function openLevelArray(root: zarr.Location<zarr.FetchStore>, levelPath: string, variable: string, levelCache: Map<number, any>, zarrVersion?: 2 | 3 | null): Promise<zarr.Array<any>>;
/**
 * Resolves the no-data value range for masking dataset values.
 *
 * Priority order:
 * 1. User-specified min/max
 * 2. Dataset metadata min/max
 * 3. Hardcoded fallback (-9999 to 9999)
 *
 * @param userMin - User-defined no-data minimum value.
 * @param userMax - User-defined no-data maximum value.
 * @param metadataMin - Metadata-defined valid minimum value.
 * @param metadataMax - Metadata-defined valid maximum value.
 *
 * @returns An object containing:
 *  - `noDataMin`: Resolved no-data minimum value.
 *  - `noDataMax`: Resolved no-data maximum value.
 */
declare function resolveNoDataRange(userMin: number | undefined, userMax: number | undefined, metadataMin: number | undefined, metadataMax: number | undefined): {
    noDataMin: number;
    noDataMax: number;
};
/**
 * Extracts no-data related metadata from a Zarr array's attributes.
 *
 * Looks for standard NetCDF attributes (`valid_min`, `valid_max`, `_FillValue`, `missing_value`).
 *
 * @param zarrArray - Zarr array to extract metadata from.
 *
 * @returns An object containing:
 *   - `metadataMin`: Valid minimum value (if any).
 *   - `metadataMax`: Valid maximum value (if any).
 *   - `fillValue`: Exact fill/missing value (if any).
 *   - `useFillValue`: Whether to apply exact masking based on fill value.
 */
declare function extractNoDataMetadata(zarrArray: zarr.Array<any>): {
    metadataMin: number | undefined;
    metadataMax: number | undefined;
    fillValue: number | undefined;
    useFillValue: boolean;
};
/**
 * Fetches the spec-level `fill_value` (zarr v3 `zarr.json` / v2 `.zarray`)
 * for an array directly, bypassing zarrita's public API.
 *
 * @remarks
 * `_FillValue`/`missing_value` (checked by {@link extractNoDataMetadata})
 * are CF-convention *attributes* some producers add on top of the zarr
 * spec. The zarr v3/v2 spec has its own dedicated `fill_value` array-
 * metadata field (used internally to backfill missing chunks), but
 * zarrita's `Array` class keeps it behind a private field with no public
 * getter -- there is no `zarrArray.fill_value` to read. Stores that rely
 * only on the spec field (e.g. MUR's packed int16 layers, where land is
 * `fill_value: -32768` and there is no `_FillValue`/`missing_value` attr)
 * would otherwise never get masked: `extractNoDataMetadata` reports
 * `useFillValue: false` and land renders as ordinary (if clamped) color
 * instead of being discarded.
 *
 * Fetches the array's own metadata document over HTTP; returns `undefined`
 * on any failure (missing/non-numeric field, network error, non-FetchStore
 * store) so callers can fall back to their existing no-fill-value behavior.
 */
declare function fetchSpecFillValue(store: zarr.FetchStore, zarrArray: zarr.Array<any>): Promise<number | undefined>;
/**
 * Detects the coordinate reference system (CRS) of a Zarr dataset based on metadata or coordinate range.
 * Defaults to EPSG:4326 (WGS84) if uncertain.
 *
 * @param attrs - Zarr array or group attributes.
 * @param arr - Zarr array (may be null).
 * @param xyLimits - Optional geographic coordinate limits. See {@link XYLimitsProps}.
 * @returns Detected  CRS as a string (e.g., 'EPSG:4326' or 'EPSG:3857'. See {@link CRS}).
 */
declare function detectCRS(attrs: Record<string, any>, arr: zarr.Array<any> | null, xyLimits?: XYLimitsProps): Promise<CRS>;

declare const vertexShaderSource = "#version 300 es\n  in vec2 a_position;\n  in vec2 a_texCoord;\n  out vec2 v_texCoord;\n\n  void main() {\n      gl_Position = vec4(a_position, 0.0, 1.0);\n      v_texCoord = a_texCoord;\n  }\n";
declare const fragmentShaderSource = "#version 300 es\n  precision highp float;\n\n  in vec2 v_texCoord;\n\n  uniform sampler2D u_dataTexture;\n  uniform sampler2D u_colorRamp;\n\n  uniform float u_min;\n  uniform float u_max;\n\n  uniform float u_noDataMin;\n  uniform float u_noDataMax;\n\n  uniform bool  u_useFillValue;\n  uniform float u_fillValue;\n\n  uniform float u_scaleFactor;\n  uniform float u_addOffset;\n\n  out vec4 fragColor;\n\n  void main() {\n      float raw = texture(u_dataTexture, vec2(v_texCoord.x, 1.0 - v_texCoord.y)).r;\n      // float raw = texture(u_dataTexture, v_texCoord).r;\n\n      float value = raw * u_scaleFactor + u_addOffset;\n\n      bool isNaN = (value != value);\n      bool isNoData = (value < u_noDataMin || value > u_noDataMax);\n      bool isFill = (u_useFillValue && abs(value - u_fillValue) < 1e-6);\n\n      if (isNaN || isNoData || isFill) {\n          discard;\n      }\n\n      float normalized = clamp((value - u_min) / (u_max - u_min), 0.0, 1.0);\n\n      fragColor = texture(u_colorRamp, vec2(normalized, 0.5));\n  }\n";

/**
 * Parses a CF-compliant units string into its components.
 *
 * @param units - The CF units string (e.g., "days since 2000-01-01").
 * @returns An object containing the time unit and reference date.
 *
 * @example
 * ```ts
 * const { unit, ref } = parseCFUnits('days since 2000-01-01');
 * // unit: 'days', ref: '2000-01-01'
 * ```
 */
declare function parseCFUnits(units: string): {
    unit: string;
    ref: string;
};
/**
 * Decodes CF-compliant time coordinate values into ISO date strings.
 *
 * @param values - Array of numeric time values to decode.
 * @param units - CF time units string (e.g., "days since 2000-01-01").
 * @param calendar - CF calendar type (default is "standard").
 * @returns Array of ISO date strings corresponding to the input time values.
 *
 * @example
 * ```ts
 * const times = decodeCFTime([0, 1, 2], 'days since 2000-01-01', 'standard');
 * // ['2000-01-01T00:00:00Z', '2000-01-02T00:00:00Z', '2000-01-03T00:00:00Z']
 * ```
 */
declare function decodeCFTime(values: number[], units: string, calendar?: CFCalendar): string[];

declare function lonDegToMercX(lonDeg: number): number;
declare function latDegToMercY(latDeg: number): number;

export { CFCalendar, CF_MAPPINGS, CRS, DEFAULT_COLORMAP, DEFAULT_OPACITY, DEFAULT_SCALE, DIMENSION_ALIASES_DEFAULT, DataSliceProps, DimIndicesProps, DimensionNamesProps, DimensionValues, EARTH_RADIUS, MAX_LAT, SliceArgs, XYLimitsProps, ZarrLevelMetadata, ZarrSelectors, calculateNearestIndex, calculateSliceArgs, createColorRampTexture, createProgram, createShader, decodeCFTime, detectCRS, extractNoDataMetadata, fetchSpecFillValue, fragmentShaderSource, getXYLimits, identifyDimensionIndices, initZarrDataset, latDegToMercY, loadDimensionValues, lonDegToMercX, normalizeMultiscaleDatasets, openLevelArray, parseCFUnits, resolveNoDataRange, vertexShaderSource };
