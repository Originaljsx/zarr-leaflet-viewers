#!/usr/bin/env python3
"""One SWOT L3 granule -> the flat binary the currents viewer reads.

The viewer advects particles through the geostrophic velocity field, which
means it needs to answer "what is (u, v) at this lat/lon" thousands of times
per view change. SWOT's native grid is curvilinear -- latitude and longitude
are 2-D fields over (num_lines, num_pixels), so there is no index formula and
no bilinear shortcut. Rather than resample onto a regular grid and inherit its
error, this ships the swath exactly as measured and lets the browser build a
bucket index over it.

That trade only works because one granule is small: ~9860 x 69 samples, four
float32 arrays, ~11 MB raw and well under half that gzipped (the coordinates
vary smoothly and the invalid half of the swath is a repeating NaN pattern).
It does not generalise -- a whole cycle would be gigabytes -- which is exactly
why the multiscale Zarr pipeline exists for anything bigger than a demo.

Output is one .bin (arrays back to back, little-endian) plus a .json manifest
giving each array's byte offset, so the viewer does a single fetch.

  python tools/swot_l3_currents.py GRANULE.nc -o data/swot_currents

Writes data/swot_currents.bin and data/swot_currents.json.
"""
import argparse
import json
import os
import re

import numpy as np
import xarray as xr

# Our name -> the L3 file's name. Velocities are the filtered *absolute*
# components (anomaly + MDT), so the mean flow is included and western
# boundary currents actually look like currents.
SRC = {"u": "ugos_filtered", "v": "vgos_filtered"}

GRANULE_RE = re.compile(r"_(\d{3})_(\d{3})_(\d{8}T\d{6})")


def granule_meta(path):
    """(cycle, pass, ISO start time) parsed from the granule filename."""
    m = GRANULE_RE.search(os.path.basename(path))
    if not m:
        raise ValueError(f"cannot parse cycle/pass from {os.path.basename(path)!r}")
    c, p, s = int(m.group(1)), int(m.group(2)), m.group(3)
    return c, p, f"{s[:4]}-{s[4:6]}-{s[6:8]}T{s[9:11]}:{s[11:13]}:{s[13:15]}"


def load(path):
    """L3 swath -> (lat, lon, u, v) as float32, invalid samples NaN.

    DUACS has already calibrated, edited and filtered this product, so there
    is no recipe to reapply here. quality_flag == 0 is the documented "good"
    class and the velocities are already NaN outside it; masking on it again
    is belt and braces, and costs nothing.
    """
    ds = xr.open_dataset(path, engine="h5netcdf")
    good = ds.quality_flag.values == 0
    lat = ds.latitude.values.astype("float32")
    # L3 stores longitude in 0..360; the viewer works in -180..180.
    lon = (((ds.longitude.values + 180.0) % 360.0) - 180.0).astype("float32")
    placeable = np.isfinite(lat) & np.isfinite(lon)
    keep = good & placeable
    out = [np.where(keep, ds[v].values, np.nan).astype("float32") for v in SRC.values()]
    ds.close()
    return lat, lon, out[0], out[1]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("granule", help="SWOT_L3_LR_SSH_Expert_*.nc")
    ap.add_argument("-o", "--out", default="data/swot_currents",
                    help="output path prefix (default: data/swot_currents)")
    args = ap.parse_args()

    lat, lon, u, v = load(args.granule)

    # Drop along-track lines with no usable velocity at all. On a pole-to-pole
    # pass that is mostly the land and sea-ice stretches; every kept line still
    # carries its full 69-sample cross-track profile, so the array stays
    # rectangular and the viewer needs no per-line bookkeeping.
    alive = np.isfinite(u).any(axis=1) & np.isfinite(v).any(axis=1)
    nl_full = lat.shape[0]
    lat, lon, u, v = lat[alive], lon[alive], u[alive], v[alive]
    nl, npx = lat.shape

    cycle, pss, t0 = granule_meta(args.granule)
    finite = np.isfinite(u) & np.isfinite(v)
    speed = np.hypot(u[finite], v[finite])

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    arrays, offset, blobs = {}, 0, []
    for name, a in (("lat", lat), ("lon", lon), ("u", u), ("v", v)):
        b = np.ascontiguousarray(a, dtype="<f4").tobytes()
        arrays[name] = {"offset": offset, "bytes": len(b), "dtype": "float32"}
        blobs.append(b)
        offset += len(b)
    with open(args.out + ".bin", "wb") as f:
        for b in blobs:
            f.write(b)

    manifest = {
        "granule": os.path.basename(args.granule),
        "cycle": cycle, "pass": pss, "time": t0,
        "shape": [nl, npx],
        "lines_dropped": int(nl_full - nl),
        "bin": os.path.basename(args.out) + ".bin",
        "arrays": arrays,
        "variables": {"u": SRC["u"], "v": SRC["v"], "units": "m/s"},
        "bbox": [float(np.nanmin(lon)), float(np.nanmin(lat)),
                 float(np.nanmax(lon)), float(np.nanmax(lat))],
        # The viewer sizes its colour ramp and its "is this sample close
        # enough" cutoff from these, so they travel with the data.
        "valid_fraction": float(finite.mean()),
        "speed": {"median": float(np.median(speed)),
                  "p99": float(np.percentile(speed, 99)),
                  "max": float(speed.max())},
    }
    with open(args.out + ".json", "w") as f:
        json.dump(manifest, f, indent=2)

    mb = offset / 1e6
    print(f"{args.out}.bin  {mb:.1f} MB  ({nl} x {npx}, dropped {nl_full - nl} empty lines)")
    print(f"{args.out}.json  cycle {cycle} pass {pss} {t0}  "
          f"valid {finite.mean():.1%}  speed med {np.median(speed):.2f} "
          f"p99 {np.percentile(speed, 99):.2f} max {speed.max():.2f} m/s")


if __name__ == "__main__":
    main()
