"""Step 1: snapshot the public OneAquaHealth API (ENORA Innovation) into data/oah/.

Usage: uv run python -m murmur_pipeline.oah_snapshot [--cached]

By default every endpoint is fetched again (six GETs, rate-limited). With
--cached the last responses stored in pipeline/.cache/http are reused.
"""

from __future__ import annotations

import sys
from typing import Any

from .common import DATA_DIR, cached_at, get_json, utc_now_iso, write_json

BASE_URL = "https://api.enora-oah.eu"
OUT_DIR = DATA_DIR / "oah"

# output file -> endpoint path
ENDPOINTS: dict[str, str] = {
    "cities.json": "/api/cities/all",
    "sites.json": "/api/sites/all",
    "user-sites.json": "/api/sites/user-generated",
    "city-dashboards.json": "/api/dashboards/city",
    "health-risks.json": "/api/resilience-map/health-risks",
    "urban-parameters.json": "/api/resilience-map/urban-parameters",
}

NOTE = (
    "Snapshot of the public OneAquaHealth API (ENORA Innovation). "
    "Research data © OneAquaHealth consortium."
)


def reshape_sites(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten research sites to {code, name, cityId, cityName, lat, lon, altitude}."""
    sites = []
    for s in raw:
        city = s.get("city") or {}
        sites.append({
            "code": s["code"],
            "name": s.get("name"),
            "cityId": city.get("id"),
            "cityName": city.get("name"),
            "lat": s.get("latitude"),
            "lon": s.get("longitude"),
            "altitude": s.get("altitude"),
        })
    return sorted(sites, key=lambda x: (x["cityId"] or "", _site_sort_key(x["code"])))


def site_polygons(raw: list[dict[str, Any]]) -> dict[str, Any]:
    """Site outlines (GeoJSON FeatureCollections, only some sites have one), by code."""
    return {s["code"]: s["polygon"] for s in raw if s.get("polygon") is not None}


def _site_sort_key(code: str) -> tuple[str, int, str]:
    prefix = code.rstrip("0123456789")
    digits = code[len(prefix):]
    return (prefix, int(digits) if digits else -1, code)


def main(argv: list[str]) -> None:
    refresh = "--cached" not in argv
    fetched_at = utc_now_iso()
    if not refresh:
        fetched_at = cached_at(BASE_URL + ENDPOINTS["cities.json"]) or fetched_at
    counts: dict[str, int] = {}
    for filename, path in ENDPOINTS.items():
        data = get_json(BASE_URL + path, refresh=refresh)
        if filename == "sites.json":
            polygons = site_polygons(data)
            write_json(OUT_DIR / "site-polygons.json", polygons, indent=None)
            counts["site-polygons.json"] = len(polygons)
            data = reshape_sites(data)
        write_json(OUT_DIR / filename, data, rows=True)
        counts[filename] = len(data)
        print(f"{filename:24s} {len(data):4d} records  <- {path}")
    meta = {
        "fetchedAt": fetched_at,
        "baseUrl": BASE_URL,
        "endpoints": {name: BASE_URL + path for name, path in ENDPOINTS.items()},
        "counts": counts,
        "files": {
            "sites.json": "Research sites flattened to {code, name, cityId, cityName, lat, lon, altitude}.",
            "site-polygons.json": "The API's `polygon` field of /api/sites/all (GeoJSON), by site code; "
            "only sites that have one.",
            "other files": "Verbatim API responses (all fields kept).",
        },
        "note": NOTE,
    }
    write_json(OUT_DIR / "meta.json", meta)


if __name__ == "__main__":
    main(sys.argv[1:])
