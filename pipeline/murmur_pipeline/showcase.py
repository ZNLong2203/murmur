"""Add hand-picked showcase recordings to the demo list.

Usage: uv run python -m murmur_pipeline.showcase <folder with shortlist.json>

Each pick is copied into public/samples/, analysed exactly like the other
demo recordings (same model, the nearest range list for its week, threshold
0.25) and appended to data/demo/recordings.json with its credits. The picks
and why they are here are listed in SHOWCASE below.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import numpy as np

from .common import DATA_DIR, SAMPLES_DIR, haversine_km, read_json, write_json
from .detect import detections, range_indices
from .models import AcousticModel, decode_audio, to_windows

THRESHOLD = 0.25
RANGE_KM = 300

# file in the shortlist -> (id, title shown in the app, why it is a showcase)
SHOWCASE = {
    "frog-pelophylax-perezi-coimbra-inat85824396.mp3": (
        "co-frog-perezi",
        "Iberian green frog by a stream, Vale das Flores, Coimbra (near C3)",
        "An amphibian, one of OneAquaHealth's indicators, recorded 0.4 km from site C3; stream noise then masks most of the clip.",
    ),
    "frog-hyla-meridionalis-toulouse-xc1087864.mp3": (
        "to-frog-hyla",
        "Mediterranean tree frogs at night, near Toulouse (T25)",
        "A frog chorus 1.8 km from site T25; the call is heard in almost every window.",
    ),
    "soundscape-toulouse-arize-river-xc659972.mp3": (
        "to-arize-dawn",
        "Dawn chorus over the Arize river, south of Toulouse",
        "Seven species singing over audible river noise: a realistic stream soundscape.",
    ),
    "video-czech-zvanovicky-brook-birdsong.mp4": (
        "cz-brook-video",
        "Short video of a brook with birdsong (Czech Republic)",
        "A 20-second video like the one the OneAquaHealth app asks for: Murmur reads its sound.",
    ),
}


def nearest_range(lat: float | None, lon: float | None) -> str | None:
    if lat is None or lon is None:
        return None
    best = None
    for f in (DATA_DIR / "range").glob("*.json"):
        if len(f.stem) != 2:
            continue
        r = read_json(f)
        km = haversine_km(lat, lon, r["lat"], r["lon"])
        if km <= RANGE_KM and (best is None or km < best[1]):
            best = (r["id"], km)
    return best[0] if best else None


def main(folder: Path) -> None:
    shortlist = {e["file"]: e for e in read_json(folder / "shortlist.json")}
    sites = read_json(DATA_DIR / "oah" / "sites.json")
    demo_path = DATA_DIR / "demo" / "recordings.json"
    demo = [d for d in read_json(demo_path) if d["id"] not in {v[0] for v in SHOWCASE.values()}]
    model = AcousticModel()

    for file, (rid, title, why) in SHOWCASE.items():
        e = shortlist[file]
        src = folder / file
        dest = SAMPLES_DIR / f"{rid}{src.suffix}"
        shutil.copyfile(src, dest)

        audio = decode_audio(src)
        probs = model.predict(to_windows(audio))
        duration = len(audio) / 32_000
        location = nearest_range(e.get("lat"), e.get("lon"))
        allowed = range_indices(location, e.get("recordedAt")) if location else np.arange(probs.shape[1])
        nearest = None
        if e.get("lat") is not None:
            nearest = min(sites, key=lambda s: haversine_km(e["lat"], e["lon"], s["lat"], s["lon"]))

        demo.append({
            "id": rid,
            "file": f"/samples/{dest.name}",
            "kind": e["kind"],
            "title": title,
            "recordist": e["recordist"],
            "license": e["license"],
            "licenseUrl": e["licenseUrl"],
            "sourceUrl": e["sourceUrl"],
            "lat": e.get("lat"),
            "lon": e.get("lon"),
            "recordedAt": (e.get("recordedAt") or "")[:10] or None,
            "cityId": nearest["cityId"] if nearest else None,
            "nearestSiteCode": nearest["code"] if nearest else None,
            "nearestSiteDistanceKm": round(haversine_km(e["lat"], e["lon"], nearest["lat"], nearest["lon"]), 2) if nearest else None,
            "durationS": round(duration, 1),
            "trimmed": bool(e.get("trimmed")),
            "notes": why,
            "detections": detections(probs, allowed, THRESHOLD, duration_s=duration),
        })
        print(f"{rid}: {len(demo[-1]['detections'])} detections, range {location or 'none'}")

    write_json(demo_path, demo)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
