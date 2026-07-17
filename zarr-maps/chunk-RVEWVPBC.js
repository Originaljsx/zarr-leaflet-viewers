import {
  ZarrLayerProvider
} from "./chunk-RPMQDR3F.js";
import {
  __publicField
} from "./chunk-RGIOIEUU.js";

// src/leaflet/zarr-layer.ts
import L from "leaflet";
var ZarrLayer = class extends L.GridLayer {
  constructor(options) {
    super(options);
    __publicField(this, "provider");
    const sizePoint = L.point(options.tileSize ?? 256);
    const { tileSize, ...providerOpts } = options;
    this.provider = new ZarrLayerProvider({
      ...providerOpts,
      tileSize: sizePoint.x
    });
  }
  onAdd(map) {
    super.onAdd(map);
    return this;
  }
  /**
   * Loads the Zarr layer and returns a promise that resolves when the layer is ready.
   *
   * @returns A promise that resolves to `true` when the layer is ready.
   */
  async load() {
    return await this.provider.readyPromise;
  }
  onRemove(map) {
    this.provider.destroy();
    super.onRemove(map);
    return this;
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
    if (changed) this.redraw();
  }
  /**
   * Update the selectors used for slicing the Zarr dataset.
   * @param selectors - New selectors to apply.
   */
  updateSelectors(selectors) {
    const changed = this.provider.updateSelectors(selectors);
    if (changed) this.redraw();
  }
  createTile(coords, done) {
    const tile = document.createElement("canvas");
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;
    const key = `${coords.z}/${coords.x}/${coords.y}`;
    tile._zarrKey = key;
    const map = this._map;
    const nwPoint = coords.scaleBy(size);
    const sePoint = nwPoint.add(size);
    const nw = map.unproject(nwPoint, coords.z);
    const se = map.unproject(sePoint, coords.z);
    const boundsDeg = { west: nw.lng, south: se.lat, east: se.lng, north: nw.lat };
    (async () => {
      const ok = await this.provider.readyPromise;
      if (!ok) return done(void 0, tile);
      const nativeZ = Math.min(coords.z, this.options.maxZoom ?? coords.z);
      const rendered = await this.provider.renderTile(boundsDeg, nativeZ, key);
      const ctx = tile.getContext("2d");
      ctx.clearRect(0, 0, tile.width, tile.height);
      ctx.drawImage(rendered, 0, 0);
      done(void 0, tile);
    })().catch(() => done(void 0, tile));
    return tile;
  }
  _removeTile(key) {
    const tile = this._tiles?.[key]?.el;
    if (tile?._zarrKey) this.provider.abortTile(tile._zarrKey);
    return L.GridLayer.prototype._removeTile.call(this, key);
  }
};

export {
  ZarrLayer
};
//# sourceMappingURL=chunk-RVEWVPBC.js.map