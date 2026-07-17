import * as zarr from 'zarrita';

declare const Accent: (x: number) => number[];
declare const AccentR: (x: number) => number[];
declare const Blues: (x: number) => number[];
declare const BluesR: (x: number) => number[];
declare const BrBG: (x: number) => number[];
declare const BrBGR: (x: number) => number[];
declare const BuGn: (x: number) => number[];
declare const BuGnR: (x: number) => number[];
declare const BuPu: (x: number) => number[];
declare const BuPuR: (x: number) => number[];
declare const CMRmap: (x: number) => number[];
declare const CMRmapR: (x: number) => number[];
declare const Dark2: (x: number) => number[];
declare const Dark2R: (x: number) => number[];
declare const GnBu: (x: number) => number[];
declare const GnBuR: (x: number) => number[];
declare const Greens: (x: number) => number[];
declare const GreensR: (x: number) => number[];
declare const Greys: (x: number) => number[];
declare const GreysR: (x: number) => number[];
declare const OrRd: (x: number) => number[];
declare const OrRdR: (x: number) => number[];
declare const Oranges: (x: number) => number[];
declare const OrangesR: (x: number) => number[];
declare const PRGn: (x: number) => number[];
declare const PRGnR: (x: number) => number[];
declare const Paired: (x: number) => number[];
declare const PairedR: (x: number) => number[];
declare const Pastel1: (x: number) => number[];
declare const Pastel1R: (x: number) => number[];
declare const Pastel2: (x: number) => number[];
declare const Pastel2R: (x: number) => number[];
declare const PiYG: (x: number) => number[];
declare const PiYGR: (x: number) => number[];
declare const PuBu: (x: number) => number[];
declare const PuBuR: (x: number) => number[];
declare const PuBuGn: (x: number) => number[];
declare const PuBuGnR: (x: number) => number[];
declare const PuOr: (x: number) => number[];
declare const PuOrR: (x: number) => number[];
declare const PuRd: (x: number) => number[];
declare const PuRdR: (x: number) => number[];
declare const Purples: (x: number) => number[];
declare const PurplesR: (x: number) => number[];
declare const RdBu: (x: number) => number[];
declare const RdBuR: (x: number) => number[];
declare const RdGy: (x: number) => number[];
declare const RdGyR: (x: number) => number[];
declare const RdPu: (x: number) => number[];
declare const RdPuR: (x: number) => number[];
declare const RdYlBu: (x: number) => number[];
declare const RdYlBuR: (x: number) => number[];
declare const RdYlGn: (x: number) => number[];
declare const RdYlGnR: (x: number) => number[];
declare const Reds: (x: number) => number[];
declare const RedsR: (x: number) => number[];
declare const Set1: (x: number) => number[];
declare const Set1R: (x: number) => number[];
declare const Set2: (x: number) => number[];
declare const Set2R: (x: number) => number[];
declare const Set3: (x: number) => number[];
declare const Set3R: (x: number) => number[];
declare const Spectral: (x: number) => number[];
declare const SpectralR: (x: number) => number[];
declare const Wistia: (x: number) => number[];
declare const WistiaR: (x: number) => number[];
declare const YlGn: (x: number) => number[];
declare const YlGnR: (x: number) => number[];
declare const YlGnBu: (x: number) => number[];
declare const YlGnBuR: (x: number) => number[];
declare const YlOrBr: (x: number) => number[];
declare const YlOrBrR: (x: number) => number[];
declare const YlOrRd: (x: number) => number[];
declare const YlOrRdR: (x: number) => number[];
declare const afmhot: (x: number) => number[];
declare const afmhotR: (x: number) => number[];
declare const autumn: (x: number) => number[];
declare const autumnR: (x: number) => number[];
declare const binary: (x: number) => number[];
declare const binaryR: (x: number) => number[];
declare const bone: (x: number) => number[];
declare const boneR: (x: number) => number[];
declare const brg: (x: number) => number[];
declare const brgR: (x: number) => number[];
declare const bwr: (x: number) => number[];
declare const bwrR: (x: number) => number[];
declare const cividis: (x: number) => number[];
declare const cividisR: (x: number) => number[];
declare const cool: (x: number) => number[];
declare const coolR: (x: number) => number[];
declare const coolwarm: (x: number) => number[];
declare const coolwarmR: (x: number) => number[];
declare const copper: (x: number) => number[];
declare const copperR: (x: number) => number[];
declare const cubehelix: (x: number) => number[];
declare const cubehelixR: (x: number) => number[];
declare const flag: (x: number) => number[];
declare const flagR: (x: number) => number[];
declare const gistEarth: (x: number) => number[];
declare const gistEarthR: (x: number) => number[];
declare const gistGray: (x: number) => number[];
declare const gistGrayR: (x: number) => number[];
declare const gistHeat: (x: number) => number[];
declare const gistHeatR: (x: number) => number[];
declare const gistNcar: (x: number) => number[];
declare const gistNcarR: (x: number) => number[];
declare const gistRainbow: (x: number) => number[];
declare const gistRainbowR: (x: number) => number[];
declare const gistStern: (x: number) => number[];
declare const gistSternR: (x: number) => number[];
declare const gistYarg: (x: number) => number[];
declare const gistYargR: (x: number) => number[];
declare const gnuplot: (x: number) => number[];
declare const gnuplotR: (x: number) => number[];
declare const gnuplot2: (x: number) => number[];
declare const gnuplot2R: (x: number) => number[];
declare const gray: (x: number) => number[];
declare const grayR: (x: number) => number[];
declare const hot: (x: number) => number[];
declare const hotR: (x: number) => number[];
declare const hsv: (x: number) => number[];
declare const hsvR: (x: number) => number[];
declare const inferno: (x: number) => number[];
declare const infernoR: (x: number) => number[];
declare const jet: (x: number) => number[];
declare const jetR: (x: number) => number[];
declare const magma: (x: number) => number[];
declare const magmaR: (x: number) => number[];
declare const nipySpectral: (x: number) => number[];
declare const nipySpectralR: (x: number) => number[];
declare const ocean: (x: number) => number[];
declare const oceanR: (x: number) => number[];
declare const pink: (x: number) => number[];
declare const pinkR: (x: number) => number[];
declare const plasma: (x: number) => number[];
declare const plasmaR: (x: number) => number[];
declare const prism: (x: number) => number[];
declare const prismR: (x: number) => number[];
declare const rainbow: (x: number) => number[];
declare const rainbowR: (x: number) => number[];
declare const seismic: (x: number) => number[];
declare const seismicR: (x: number) => number[];
declare const spring: (x: number) => number[];
declare const springR: (x: number) => number[];
declare const summer: (x: number) => number[];
declare const summerR: (x: number) => number[];
declare const tab10: (x: number) => number[];
declare const tab10R: (x: number) => number[];
declare const tab20: (x: number) => number[];
declare const tab20R: (x: number) => number[];
declare const tab20b: (x: number) => number[];
declare const tab20bR: (x: number) => number[];
declare const tab20c: (x: number) => number[];
declare const tab20cR: (x: number) => number[];
declare const terrain: (x: number) => number[];
declare const terrainR: (x: number) => number[];
declare const turbo: (x: number) => number[];
declare const turboR: (x: number) => number[];
declare const twilight: (x: number) => number[];
declare const twilightR: (x: number) => number[];
declare const twilightShifted: (x: number) => number[];
declare const twilightShiftedR: (x: number) => number[];
declare const viridis: (x: number) => number[];
declare const viridisR: (x: number) => number[];
declare const winter: (x: number) => number[];
declare const winterR: (x: number) => number[];
/**
 * Returns a color scale function for a given colormap name.
 *
 * @remarks
 * This function is automatically generated for every color map and its reversed counterpart.
 * For instance, both `viridis` and `viridis_r` can be used to generate forward or reversed
 * colormap interpolators.
 *
 * @param color - Name of the color scale (e.g., `'viridis'`, `'coolwarm_r'`).
 * @returns A callable function that accepts a normalized value `x ∈ [0, 1]` and returns an RGB array.
 *
 * @example
 * ```ts
 * const viridis = colorScaleByName('viridis');
 * const rgb = viridis(0.5); // [r, g, b]
 * ```
 */
declare const colorScaleByName: (color: string) => (x: number) => number[];
/**
 * List of all available colormap names (including reversed versions).
 */
declare const allColorScales: string[];
/**
 * Builds a color ramp (discrete or continuous) from a specified colormap.
 *
 * @param color - Name of the colormap to use (e.g. `'viridis'`, `'RdBu_r'`).
 * @param convertTo - Optional output format (`'hex'` or `'css'`). Default is raw RGB arrays.
 * @param n - Number of color steps to generate (default: 255).
 * @param opacity - Opacity factor from 0 to 1 (default: 1).
 * @returns Array of colors in the selected format.
 *
 * @example
 * ```ts
 * // Generate a viridis ramp as CSS rgba() strings
 * const colors = colormapBuilder('viridis', 'css', 10, 0.8);
 * console.log(colors[0]); // "rgba(68,1,84,0.8)"
 * ```
 */
declare function colormapBuilder(color: string, convertTo?: string, n?: number, opacity?: number): string[] | number[][];

/**
 * @module types
 *
 * Type and interface definitions for Zarr-based Leaflet visualization components.
 *
 * @remarks
 * This module defines the core data structures used throughout the package,
 * including dataset selectors, cube and layer configuration options,
 * CRS types, and color scale specifications.
 *
 * These types are shared between:
 * - WebGL colormap utilities
 * - Leaflet integration layers
 */

/**
 * Describes a selector for a Zarr dataset dimension.
 *
 * @example
 * ```ts
 * { selected: 0, type: 'index' }
 * { selected: 1000, type: 'value' }
 * { selected: [0, 10], type: 'index' }
 * ```
 */
interface ZarrSelectors {
    [key: string]: ZarrSelectorsProps;
}
interface ZarrSelectorsProps {
    /** Selected index, value, or range. */
    selected: number | string | [number, number];
    /** Selection mode: by index or by physical value. */
    type?: 'index' | 'value';
}
/**
 * Describes the XY coordinate boundaries of a dataset.
 */
interface XYLimits {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    /**
     * Whether the source latitude coordinate array is stored south-to-north
     * (ascending, row 0 = yMin). When false, row 0 = yMax (north-first), the
     * common raster-image convention. Needed because `minMax()` only keeps
     * the numeric bounds and discards which physical row they came from --
     * without this, row/pixel-offset math must guess the direction, and
     * guessing wrong silently samples the wrong hemisphere.
     */
    yAscending: boolean;
}
/**
 * Metadata for a single multiscale level in a Zarr dataset.
 */
interface ZarrLevelMetadata {
    width: number;
    height: number;
}
/**
 * Mapping of dimension names to their corresponding coordinate arrays.
 */
interface DimensionValues {
    [key: string]: Float64Array | number[] | string[];
}
/**
 * Describes the mapping between dataset dimensions and their standardized names.
 */
interface DimensionNamesProps {
    time?: string;
    elevation?: string;
    lat?: string;
    lon?: string;
    others?: string[];
}
/**
 * Maps dimension keys to their indices and associated coordinate arrays.
 */
interface DimIndicesProps {
    [key: string]: {
        name: string;
        index: number;
        array: zarr.Array<any> | null;
    };
}
/**
 * Geographic bounding box definition (degrees).
 */
interface BoundsProps {
    west: number;
    south: number;
    east: number;
    north: number;
}
/**
 * Alias of {@link XYLimits} with explicit type name for Zarr coordinate bounds.
 */
interface XYLimitsProps {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    yAscending: boolean;
}
/**
 * Supported Coordinate Reference Systems.
 */
type CRS = 'EPSG:4326' | 'EPSG:3857';
/**
 * Describes a slice of a multidimensional array.
 */
interface DataSliceProps {
    startX: number;
    endX: number;
    startY: number;
    endY: number;
    startElevation?: number;
    endElevation?: number;
}
/**
 * Represents a multidimensional slice argument for Zarr array indexing.
 */
type SliceArgs = (number | zarr.Slice)[];
/**
 * Describes a numerical-to-color mapping for visualizing scalar fields.
 */
interface ColorScaleProps {
    min: number;
    max: number;
    colors: number[][] | string[];
}
/**
 * Type representing valid color map names. The values are derived from the
 * `allColorScales` array imported from the `jsColormaps` module and are based on matplotlib colormap (https://matplotlib.org/stable/users/explain/colors/colormaps.html).
 *
 * The jsColormaps module was adapted from the jsColormaps project (https://github.com/timothygebhard/js-colormaps) which provides JavaScript implementations of various colormaps.
 *
 * This is the list of supported colormaps for visualizations: 'Accent','Accent_r',
 * 'Blues','Blues_r','BrBG','BrBG_r','BuGn','BuGn_r','BuPu','BuPu_r','CMRmap',
 * 'CMRmap_r','Dark2','Dark2_r','GnBu','GnBu_r','Greens','Greens_r','Greys',
 * 'Greys_r','OrRd','OrRd_r','Oranges','Oranges_r','PRGn','PRGn_r','Paired',
 * 'Paired_r','Pastel1','Pastel1_r','Pastel2','Pastel2_r','PiYG','PiYG_r','PuBu',
 * 'PuBuGn','PuBuGn_r','PuBu_r','PuOr','PuOr_r','PuRd','PuRd_r','Purples','Purples_r',
 * 'RdBu','RdBu_r','RdGy','RdGy_r','RdPu','RdPu_r','RdYlBu','RdYlBu_r','RdYlGn',
 * 'RdYlGn_r','Reds','Reds_r','Set1','Set1_r','Set2','Set2_r','Set3','Set3_r',
 * 'Spectral','Spectral_r','Wistia','Wistia_r','YlGn','YlGnBu','YlGnBu_r','YlGn_r',
 * 'YlOrBr','YlOrBr_r','YlOrRd','YlOrRd_r','afmhot','afmhot_r','autumn','autumn_r',
 * 'binary','binary_r','bone','bone_r','brg','brg_r','bwr','bwr_r','cividis','cividis_r',
 * 'cool','cool_r','coolwarm','coolwarm_r','copper','copper_r','cubehelix','cubehelix_r',
 * 'flag','flag_r','gist_earth','gist_earth_r','gist_gray','gist_gray_r','gist_heat',
 * 'gist_heat_r','gist_ncar','gist_ncar_r','gist_rainbow','gist_rainbow_r','gist_stern',
 * 'gist_stern_r','gist_yarg','gist_yarg_r','gnuplot','gnuplot2','gnuplot2_r','gnuplot_r',
 * 'gray','gray_r','hot','hot_r','hsv','hsv_r','inferno','inferno_r','jet','jet_r','magma',
 * 'magma_r','nipy_spectral','nipy_spectral_r','ocean','ocean_r','pink','pink_r','plasma',
 * 'plasma_r','prism','prism_r','rainbow','rainbow_r','seismic','seismic_r','spring',
 * 'spring_r','summer','summer_r','tab10','tab10_r','tab20','tab20_r','tab20b','tab20b_r',
 * 'tab20c','tab20c_r','terrain','terrain_r','twilight','twilight_r','viridis','viridis_r',
 * 'winter','winter_r'
 */
type ColorMapName = (typeof allColorScales)[number];
/**
 * Structure of the global color map registry.
 */
interface ColorMapInfo {
    [key: string]: {
        interpolate: boolean;
        colors: number[][];
    };
}
/**
 * Represents a date in a calendar system.
 */
type CalendarDate = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    microsecond: number;
};
/**
 * Supported CF calendar types.
 */
type CFCalendar = 'standard' | 'gregorian' | 'proleptic_gregorian' | 'julian' | 'noleap' | '365_day' | 'all_leap' | '366_day' | '360_day';

/**
 * Configuration for a 2D raster (image) layer visualization in Leaflet.
 */
interface LeafletLayerOptions {
    id: string;
    url: string;
    variable: string;
    crs?: CRS | null;
    tileSize?: number;
    maxZoom?: number;
    scale?: [number, number];
    opacity?: number;
    colormap?: ColorMapName;
    selectors?: ZarrSelectors;
    zarrVersion?: 2 | 3;
    dimensionNames?: DimensionNamesProps;
    noDataMin?: number;
    noDataMax?: number;
}

/**
 * Configuration for a 2D raster (image) layer visualization in OpenLayers.
 */
interface OLLayerOptions {
    id: string;
    url: string;
    variable: string;
    crs?: CRS | null;
    tileSize?: number;
    maxZoom?: number;
    scale?: [number, number];
    opacity?: number;
    colormap?: ColorMapName;
    selectors?: ZarrSelectors;
    zarrVersion?: 2 | 3;
    dimensionNames?: DimensionNamesProps;
    noDataMin?: number;
    noDataMax?: number;
}
interface ZarrImageElement extends HTMLImageElement {
    _zarrKey?: string;
    _zarrObjectUrl?: string;
}

/**
 * Provides Zarr dataset access and rendering capabilities for map layers.
 */
declare class ZarrLayerProvider {
    dimensionValues: DimensionValues;
    selectors: ZarrSelectors;
    crs: CRS | null;
    private url;
    private variable;
    private zarrVersion;
    private noDataMin;
    private noDataMax;
    private fillValue;
    private useFillValue;
    private scaleFactor;
    private offset;
    private tileSize;
    private maxZoom;
    coverageBoundsMerc: {
        xMin: number;
        yMin: number;
        xMax: number;
        yMax: number;
    } | null;
    private colorScale;
    private colormap;
    private store;
    private root;
    private zarrArray;
    private dimIndices;
    private levelInfos;
    private levelCache;
    private levelMetadata;
    private xyLimits;
    coverageBoundsDeg: {
        west: number;
        south: number;
        east: number;
        north: number;
    } | null;
    private gl;
    private program;
    private colorTexture;
    private uniforms;
    private attribs;
    private selectorHash;
    private vao;
    private quadVbo;
    private dataTexture;
    private _ready;
    private _readyPromise;
    private abortControllers;
    private destroyed;
    private static readonly concurrencyLimit;
    private static activeRequests;
    private static readonly queue;
    constructor(options: LeafletLayerOptions | OLLayerOptions);
    destroy(): void;
    updateStyle(opts: {
        scale?: [number, number];
        colormap?: ColorMapName;
    }): boolean;
    updateSelectors(selectors: ZarrSelectors): boolean;
    get cacheKey(): string;
    get ready(): boolean;
    get readyPromise(): Promise<boolean>;
    private initialize;
    private computeSelectorHash;
    private loadInitialDimensionValues;
    private initWebGL;
    private updateColormapTexture;
    private static throttle;
    private choosePyramidLevel;
    private prepareAbortController;
    abortTile(key: string): void;
    private getArrayForZoom;
    renderTile(boundsDeg: BoundsProps, z: number, key: string): Promise<HTMLCanvasElement | ImageBitmap>;
    private _emptyCanvas;
    private emptyCanvas;
    private renderWithWebGL;
}

export { PuBuGn as $, Accent as A, type BoundsProps as B, type CRS as C, type DimensionValues as D, GreensR as E, Greys as F, GnBu as G, GreysR as H, OrRdR as I, Oranges as J, OrangesR as K, PRGnR as L, Paired as M, PairedR as N, OrRd as O, PRGn as P, Pastel1 as Q, Pastel1R as R, type SliceArgs as S, Pastel2 as T, Pastel2R as U, PiYG as V, PiYGR as W, type XYLimits as X, PuBu as Y, type ZarrSelectors as Z, PuBuR as _, type ZarrSelectorsProps as a, gistGray as a$, PuBuGnR as a0, PuOr as a1, PuOrR as a2, PuRd as a3, PuRdR as a4, Purples as a5, PurplesR as a6, RdBu as a7, RdBuR as a8, RdGy as a9, YlOrRdR as aA, afmhot as aB, afmhotR as aC, autumn as aD, autumnR as aE, binary as aF, binaryR as aG, bone as aH, boneR as aI, brg as aJ, brgR as aK, bwr as aL, bwrR as aM, cividis as aN, cividisR as aO, cool as aP, coolR as aQ, coolwarm as aR, coolwarmR as aS, copper as aT, copperR as aU, cubehelix as aV, cubehelixR as aW, flag as aX, flagR as aY, gistEarth as aZ, gistEarthR as a_, RdGyR as aa, RdPu as ab, RdPuR as ac, RdYlBu as ad, RdYlBuR as ae, RdYlGn as af, RdYlGnR as ag, Reds as ah, RedsR as ai, Set1 as aj, Set1R as ak, Set2 as al, Set2R as am, Set3 as an, Set3R as ao, Spectral as ap, SpectralR as aq, Wistia as ar, WistiaR as as, YlGn as at, YlGnR as au, YlGnBu as av, YlGnBuR as aw, YlOrBr as ax, YlOrBrR as ay, YlOrRd as az, type ZarrLevelMetadata as b, winter as b$, gistGrayR as b0, gistHeat as b1, gistHeatR as b2, gistNcar as b3, gistNcarR as b4, gistRainbow as b5, gistRainbowR as b6, gistStern as b7, gistSternR as b8, gistYarg as b9, prismR as bA, rainbow as bB, rainbowR as bC, seismic as bD, seismicR as bE, spring as bF, springR as bG, summer as bH, summerR as bI, tab10 as bJ, tab10R as bK, tab20 as bL, tab20R as bM, tab20b as bN, tab20bR as bO, tab20c as bP, tab20cR as bQ, terrain as bR, terrainR as bS, turbo as bT, turboR as bU, twilight as bV, twilightR as bW, twilightShifted as bX, twilightShiftedR as bY, viridis as bZ, viridisR as b_, gistYargR as ba, gnuplot as bb, gnuplotR as bc, gnuplot2 as bd, gnuplot2R as be, gray as bf, grayR as bg, hot as bh, hotR as bi, hsv as bj, hsvR as bk, inferno as bl, infernoR as bm, jet as bn, jetR as bo, magma as bp, magmaR as bq, nipySpectral as br, nipySpectralR as bs, ocean as bt, oceanR as bu, pink as bv, pinkR as bw, plasma as bx, plasmaR as by, prism as bz, type DimensionNamesProps as c, winterR as c0, colorScaleByName as c1, allColorScales as c2, colormapBuilder as c3, ZarrLayerProvider as c4, type OLLayerOptions as c5, type ZarrImageElement as c6, type LeafletLayerOptions as c7, type DimIndicesProps as d, type XYLimitsProps as e, type DataSliceProps as f, type ColorScaleProps as g, type ColorMapName as h, type ColorMapInfo as i, type CalendarDate as j, type CFCalendar as k, AccentR as l, Blues as m, BluesR as n, BrBG as o, BrBGR as p, BuGn as q, BuGnR as r, BuPu as s, BuPuR as t, CMRmap as u, CMRmapR as v, Dark2 as w, Dark2R as x, GnBuR as y, Greens as z };
