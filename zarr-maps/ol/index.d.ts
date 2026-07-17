import { c4 as ZarrLayerProvider, c5 as OLLayerOptions, h as ColorMapName, Z as ZarrSelectors } from '../zarr-layer-provider-CoXq4UFO.js';
export { c6 as ZarrImageElement } from '../zarr-layer-provider-CoXq4UFO.js';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import 'zarrita';

/**
 * OpenLayers Zarr tile layer using the shared ZarrLayerProvider.
 *
 * @remarks
 * This class extends `TileLayer<XYZ>` to create a custom tile layer that fetches
 * and renders tiles from a Zarr data source using the `ZarrLayerProvider`.
 *
 * @param options - Configuration options for the Zarr layer. Instance of {@link OLLayerOptions}.
 */
declare class ZarrLayer extends TileLayer<XYZ> {
    provider: ZarrLayerProvider;
    private mapProjection;
    constructor(options: OLLayerOptions);
    /**
     * Loads the Zarr layer and returns a promise that resolves when the layer is ready.
     *
     * @returns A promise that resolves to `true` when the layer is ready.
     */
    load(): Promise<boolean>;
    private static createSource;
    disposeInternal(): void;
    /**
     * Update the visual style of the layer.
     * @param opts - Style options to update.
     * @param opts.opacity - Layer opacity.
     * @param opts.scale - [min, max] range for data scaling.
     * @param opts.colormap - Colormap name.
     */
    updateStyle(opts: {
        opacity?: number;
        scale?: [number, number];
        colormap?: ColorMapName;
    }): void;
    /**
     * Update the selectors used for slicing the Zarr dataset.
     * @param selectors - New selectors to apply.
     */
    updateSelectors(selectors: ZarrSelectors): void;
    private renderOlTile;
}

export { OLLayerOptions, ZarrLayer };
