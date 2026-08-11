#!/usr/bin/env python3
"""One MIOST/DUACS L4 daily grid -> a multiscale GeoZarr pyramid.

The flat-.bin path (tools/miost_l4_currents.py) ships the whole grid in one
fetch. This is the Zarr answer to the same data: level 0 is the native
0.125-degree lattice, each level above it a 2x mean-of-valid coarsening, all
zarr v3 with an OME-NGFF `multiscales` block — the layout `zarr-gl`'s
ZarrSource already reads. The viewer then fetches only the chunks its viewport
needs at the level its zoom resolves, which is the point of the experiment.

Variables: `ugos`/`vgos` (absolute geostrophic velocity, for the particles)
plus a derived `speed` (for the WebGL colour raster — the shader samples one
variable, so hypot is precomputed). All int16 at 1 mm/s with
scale_factor/_FillValue attrs; ZarrSource uploads int16 textures natively and
decodes in the shader.

  python tools/miost_l4_pyramid.py GRANULE.nc -o data/miost_currents_pyramid.zarr
"""
import argparse
import json
import os
import shutil

import numpy as np
import xarray as xr
import zarr

SCALE = 0.001  # m/s per count
FILL = -32768
CHUNK = 512
MIN_SIZE = 128  # stop coarsening once the short axis drops below this


def coarsen2(a):
    """2x block mean over valid samples; blocks with no valid sample -> NaN."""
    ny, nx = a.shape
    a = a[: ny - (ny % 2), : nx - (nx % 2)]
    b = a.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2)
    s = np.nansum(b, axis=(1, 3))
    n = np.isfinite(b).sum(axis=(1, 3))
    with np.errstate(invalid="ignore"):
        out = s / n
    out[n == 0] = np.nan
    return out


def pair_mean(c):
    """Coordinate centres of the 2x-coarsened axis (mean of each pair)."""
    return c[: c.size - (c.size % 2)].reshape(-1, 2).mean(axis=1)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("granule", help="dt_global_allsat_phy_l4_*.nc")
    ap.add_argument("-o", "--out", default="data/miost_currents_pyramid.zarr")
    args = ap.parse_args()

    ds = xr.open_dataset(args.granule, engine="h5netcdf")
    lat = ds.latitude.values.astype("float64")
    lon = ds.longitude.values.astype("float64")
    u = ds.ugos.values[0].astype("float64")
    v = ds.vgos.values[0].astype("float64")
    date = str(ds.time.values[0])[:10]
    granule = os.path.basename(args.granule)
    ds.close()

    # Build the float pyramid first: level 0 native, then 2x coarsenings.
    levels = [{"lat": lat, "lon": lon, "u": u, "v": v}]
    while min(levels[-1]["u"].shape) // 2 >= MIN_SIZE:
        p = levels[-1]
        levels.append({
            "lat": pair_mean(p["lat"]),
            "lon": pair_mean(p["lon"]),
            "u": coarsen2(p["u"]),
            "v": coarsen2(p["v"]),
        })

    if os.path.exists(args.out):
        shutil.rmtree(args.out)
    root = zarr.open_group(args.out, mode="w", zarr_format=3)

    def quant(a):
        q = np.round(a / SCALE)
        q[~np.isfinite(a)] = FILL
        return q.astype("<i2")

    datasets = []
    for i, lv in enumerate(levels):
        g = root.create_group(str(i))
        ny, nx = lv["u"].shape
        cy, cx = min(CHUNK, ny), min(CHUNK, nx)
        for name, coord in (("latitude", lv["lat"]), ("longitude", lv["lon"])):
            arr = g.create_array(name, shape=coord.shape, dtype="float64",
                                 chunks=coord.shape, dimension_names=[name])
            arr[:] = coord
            arr.attrs["units"] = ("degrees_north" if name == "latitude"
                                  else "degrees_east")
        for name, a in (("ugos", lv["u"]), ("vgos", lv["v"]),
                        ("speed", np.hypot(lv["u"], lv["v"]))):
            arr = g.create_array(name, shape=(ny, nx), dtype="int16",
                                 chunks=(cy, cx), fill_value=FILL,
                                 dimension_names=["latitude", "longitude"])
            arr[:] = quant(a)
            arr.attrs.update({"scale_factor": SCALE, "_FillValue": FILL,
                              "units": "m/s"})
        datasets.append({"path": str(i),
                         "scale": [float(np.diff(lv["lat"]).mean()),
                                   float(np.diff(lv["lon"]).mean())]})
        print(f"level {i}: {ny} x {nx}, chunks {cy} x {cx}")

    root.attrs["multiscales"] = [{
        "name": "geostrophic_currents", "type": "mean",
        "axes": [{"name": "latitude"}, {"name": "longitude"}],
        "datasets": datasets,
    }]
    root.attrs["granule"] = granule
    root.attrs["date"] = date
    root.attrs["variables"] = {"u": "ugos", "v": "vgos", "speed": "speed",
                               "units": "m/s"}

    zarr.consolidate_metadata(root.store)

    total = sum(os.path.getsize(os.path.join(dp, f))
                for dp, _, fs in os.walk(args.out) for f in fs)
    print(f"{args.out}  {total / 1e6:.1f} MB on disk  "
          f"{len(levels)} levels  {date}")


if __name__ == "__main__":
    main()
