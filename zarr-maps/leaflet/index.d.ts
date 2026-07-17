import { c4 as ZarrLayerProvider, c7 as LeafletLayerOptions, h as ColorMapName, Z as ZarrSelectors } from '../zarr-layer-provider-CoXq4UFO.js';
import L from 'leaflet';
import 'zarrita';

/**
 * Leaflet Zarr tile layer using the shared ZarrLayerProvider.
 *
 * @remarks
 * This class extends `L.GridLayer` to create a custom tile layer that fetches
 * and renders tiles from a Zarr data source using the `ZarrLayerProvider`.
 *
 * @param options - Configuration options for the Zarr layer. Instance of {@link LeafletLayerOptions}.
 */
declare class ZarrLayer extends L.GridLayer {
    provider: ZarrLayerProvider;
    constructor(options: LeafletLayerOptions & L.GridLayerOptions);
    onAdd(map: L.Map): this;
    /**
     * Loads the Zarr layer and returns a promise that resolves when the layer is ready.
     *
     * @returns A promise that resolves to `true` when the layer is ready.
     */
    load(): Promise<boolean>;
    onRemove(map: L.Map): this;
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
    createTile(coords: L.Coords, done: L.DoneCallback): HTMLCanvasElement;
    _removeTile(key: string): any;
}

export { LeafletLayerOptions, ZarrLayer };
