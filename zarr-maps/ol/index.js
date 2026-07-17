import {
  ZarrLayerProvider
} from "../chunk-33PWJXCJ.js";
import {
  __publicField
} from "../chunk-RGIOIEUU.js";

// src/ol/zarr-layer.ts
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import { get as getProjection, transformExtent } from "ol/proj";
var ZarrLayer = class _ZarrLayer extends TileLayer {
  constructor(options) {
    const tileSize = options.tileSize ?? 256;
    const provider = new ZarrLayerProvider({
      ...options,
      tileSize
    });
    const source = _ZarrLayer.createSource(
      tileSize,
      options,
      (tile) => void this.renderOlTile(tile, tileSize, options)
    );
    super({
      ...options,
      source
    });
    __publicField(this, "provider");
    __publicField(this, "mapProjection");
    this.provider = provider;
    this.mapProjection = options.crs ?? "EPSG:3857";
  }
  /**
   * Loads the Zarr layer and returns a promise that resolves when the layer is ready.
   *
   * @returns A promise that resolves to `true` when the layer is ready.
   */
  async load() {
    return await this.provider.readyPromise;
  }
  static createSource(tileSize, options, loadFn) {
    return new XYZ({
      tileSize,
      maxZoom: options.maxZoom ?? 22,
      tileUrlFunction: (tileCoord) => {
        if (!tileCoord) return "";
        const [z, x, y] = tileCoord;
        const yXYZ = -y - 1;
        return `zarr://${z}/${x}/${yXYZ}`;
      },
      tileLoadFunction: (tile, _src) => {
        loadFn(tile);
      }
    });
  }
  disposeInternal() {
    this.provider.destroy();
    super.disposeInternal();
  }
  /**
   * Update the visual style of the layer.
   * @param opts - Style options to update.
   * @param opts.opacity - Layer opacity.
   * @param opts.scale - [min, max] range for data scaling.
   * @param opts.colormap - Colormap name.
   */
  updateStyle(opts) {
    const changed = this.provider.updateStyle({ scale: opts.scale, colormap: opts.colormap });
    if (opts.opacity !== void 0) this.setOpacity(opts.opacity);
    if (changed) this.getSource()?.refresh();
  }
  /**
   * Update the selectors used for slicing the Zarr dataset.
   * @param selectors - New selectors to apply.
   */
  updateSelectors(selectors) {
    const changed = this.provider.updateSelectors(selectors);
    if (changed) {
      const src = this.getSource();
      if (src?.setKey) src.setKey(this.provider.cacheKey);
      src?.refresh?.();
    }
  }
  async renderOlTile(tile, tileSize, options) {
    const img = tile.getImage();
    const tileCoord = tile.getTileCoord();
    if (!tileCoord) return;
    const [z, x, y] = tileCoord;
    const yXYZ = -y - 1;
    const key = `${z}/${x}/${yXYZ}`;
    img._zarrKey = key;
    const prevUrl = img._zarrObjectUrl;
    if (prevUrl) {
      URL.revokeObjectURL(prevUrl);
      img._zarrObjectUrl = void 0;
    }
    const source = this.getSource();
    const grid = source?.getTileGrid();
    if (!source || !grid) return;
    const extent = grid.getTileCoordExtent(tileCoord);
    const proj = getProjection(this.mapProjection) ?? getProjection("EPSG:3857");
    const extent4326 = transformExtent(extent, proj, "EPSG:4326");
    const boundsDeg = {
      west: extent4326[0],
      south: extent4326[1],
      east: extent4326[2],
      north: extent4326[3]
    };
    try {
      const ok = await this.provider.readyPromise;
      if (!ok) return;
      const nativeZ = Math.min(z, options.maxZoom ?? z);
      const rendered = await this.provider.renderTile(boundsDeg, nativeZ, key);
      const canvas = rendered;
      const blob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b ?? new Blob()), "image/png");
      });
      const url = URL.createObjectURL(blob);
      img._zarrObjectUrl = url;
      if (img._zarrKey !== key) {
        URL.revokeObjectURL(url);
        return;
      }
      img.src = url;
    } catch {
    }
  }
};
export {
  ZarrLayer
};
//# sourceMappingURL=index.js.map