#!/usr/bin/env python3
"""One MIOST/DUACS L4 daily grid -> the flat binary the currents viewer reads.

Unlike the SWOT L3 swath (curvilinear, needs a search), the L4 product is a
regular 0.125-degree global lattice, so the viewer answers "what is (u, v) at
this lat/lon" with pure index arithmetic — no coordinate arrays need to ship.
The manifest carries the grid geometry (origin + spacing + shape) and the .bin
carries just the two velocity components.

Velocities are the *absolute* geostrophic components ugos/vgos (anomaly + MDT),
so the mean flow is included and western boundary currents look like currents.

Components are quantised to int16 at 1 mm/s — far below the product's own
error — which halves the payload vs float32 and gzips well because the land
mask is a repeating sentinel. Sentinel -32768 marks invalid samples.

  python tools/miost_l4_currents.py GRANULE.nc -o data/miost_currents

Writes data/miost_currents.bin and data/miost_currents.json.
"""
import argparse
import json
import os

import numpy as np
import xarray as xr

SRC = {"u": "ugos", "v": "vgos"}
SCALE = 0.001  # m/s per count
SENTINEL = -32768


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("granule", help="dt_global_allsat_phy_l4_*.nc")
    ap.add_argument("-o", "--out", default="data/miost_currents",
                    help="output path prefix (default: data/miost_currents)")
    args = ap.parse_args()

    ds = xr.open_dataset(args.granule, engine="h5netcdf")
    lat = ds.latitude.values.astype("float64")
    lon = ds.longitude.values.astype("float64")
    u = ds[SRC["u"]].values[0].astype("float64")
    v = ds[SRC["v"]].values[0].astype("float64")
    date = str(ds.time.values[0])[:10]
    ds.close()

    # The viewer assumes an evenly spaced, ascending lattice; make sure the
    # file actually is one before baking origin+spacing into the manifest.
    dlat = float(np.diff(lat).mean())
    dlon = float(np.diff(lon).mean())
    assert np.allclose(np.diff(lat), dlat, atol=1e-6), "latitude not uniform"
    assert np.allclose(np.diff(lon), dlon, atol=1e-6), "longitude not uniform"

    finite = np.isfinite(u) & np.isfinite(v)
    speed = np.hypot(u[finite], v[finite])
    qmax = np.abs(np.concatenate([u[finite], v[finite]])).max()
    assert qmax < SCALE * 32767, f"speed {qmax:.2f} m/s overflows int16 at {SCALE} m/s"

    def quant(a):
        q = np.round(a / SCALE)
        q[~np.isfinite(a)] = SENTINEL
        return np.ascontiguousarray(q, dtype="<i2")

    nlat, nlon = u.shape
    arrays, offset, blobs = {}, 0, []
    for name, a in (("u", quant(u)), ("v", quant(v))):
        b = a.tobytes()
        arrays[name] = {"offset": offset, "bytes": len(b), "dtype": "int16"}
        blobs.append(b)
        offset += len(b)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out + ".bin", "wb") as f:
        for b in blobs:
            f.write(b)

    manifest = {
        "granule": os.path.basename(args.granule),
        "date": date,
        "grid": {"lat0": float(lat[0]), "dlat": dlat, "nlat": int(nlat),
                 "lon0": float(lon[0]), "dlon": dlon, "nlon": int(nlon)},
        "bin": os.path.basename(args.out) + ".bin",
        "arrays": arrays,
        "scale": SCALE,
        "sentinel": SENTINEL,
        "variables": {"u": SRC["u"], "v": SRC["v"], "units": "m/s"},
        "valid_fraction": float(finite.mean()),
        "speed": {"median": float(np.median(speed)),
                  "p99": float(np.percentile(speed, 99)),
                  "max": float(speed.max())},
    }
    with open(args.out + ".json", "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"{args.out}.bin  {offset / 1e6:.1f} MB  ({nlat} x {nlon}, "
          f"{dlat:.4f} x {dlon:.4f} deg)")
    print(f"{args.out}.json  {date}  valid {finite.mean():.1%}  "
          f"speed med {np.median(speed):.2f} p99 {np.percentile(speed, 99):.2f} "
          f"max {speed.max():.2f} m/s")


if __name__ == "__main__":
    main()
