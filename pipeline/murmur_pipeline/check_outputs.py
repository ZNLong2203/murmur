"""Check that every pipeline output exists, parses and matches the file contracts the app reads.

Usage: uv run python -m murmur_pipeline.check_outputs   (exit code 1 on any failure)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from .common import DATA_DIR, DOCS_DIR, SAMPLES_DIR
from .models import acoustic_labels

ALLOWED_TAGS = {"clean-water", "flowing-water", "riparian-woodland", "reedbed-wetland", "open-water",
                "insect-eater", "amphibian", "urban-tolerant", "non-native"}
RANGE_IDS = ("CO", "TO", "GH", "BE", "OS", "HN", "SG")
OAH = ("CO", "TO", "GH", "BE", "OS")

errors: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        errors.append(msg)


def load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        errors.append(f"{path}: {e}")
        return None


def has_keys(obj: dict, keys: set[str], where: str) -> None:
    missing = keys - set(obj)
    check(not missing, f"{where}: missing {sorted(missing)}")


def check_oah() -> None:
    d = DATA_DIR / "oah"
    cities = load(d / "cities.json") or []
    check(len(cities) == 5, "cities.json: expected 5 cities")
    sites = load(d / "sites.json") or []
    check(len(sites) >= 100, f"sites.json: only {len(sites)} sites")
    for s in sites:
        has_keys(s, {"code", "name", "cityId", "cityName", "lat", "lon", "altitude"}, f"site {s.get('code')}")
    for name in ("user-sites.json", "city-dashboards.json", "health-risks.json", "urban-parameters.json",
                 "site-polygons.json"):
        check(bool(load(d / name)), f"oah/{name}: empty or missing")
    meta = load(d / "meta.json") or {}
    has_keys(meta, {"fetchedAt", "baseUrl", "endpoints", "note"}, "oah/meta.json")


def check_ranges(n_labels: int) -> dict[str, set[int]]:
    year_round = {}
    for rid in RANGE_IDS:
        r = load(DATA_DIR / "range" / f"{rid}.json") or {}
        has_keys(r, {"id", "name", "lat", "lon", "model", "threshold", "labelsVersion", "weeks", "yearRound"},
                 f"range/{rid}")
        weeks = r.get("weeks", {})
        check(sorted(weeks, key=int) == [str(w) for w in range(1, 49)], f"range/{rid}: weeks must be 1..48")
        union: set[int] = set()
        for w, lst in weeks.items():
            check(lst == sorted(set(lst)), f"range/{rid} week {w}: not sorted/unique")
            check(all(0 <= i < n_labels for i in lst), f"range/{rid} week {w}: index out of range")
            union |= set(lst)
        check(sorted(union) == r.get("yearRound"), f"range/{rid}: yearRound != union of weeks")
        year_round[rid] = set(r.get("yearRound", []))
    check(bool(load(DATA_DIR / "range" / "unmapped.json")), "range/unmapped.json missing")
    return year_round


def check_species(labels: list, year_round: dict[str, set[int]]) -> None:
    eco = load(DATA_DIR / "species" / "ecology.json") or []
    check(60 <= len(eco) <= 90, f"ecology.json: {len(eco)} species (want 60-90)")
    for e in eco:
        where = f"ecology {e.get('sci')}"
        has_keys(e, {"sci", "labelIdx", "en", "tags", "meaning", "sources", "needsReview"}, where)
        idx = e.get("labelIdx", -1)
        check(0 <= idx < len(labels) and labels[idx].sci == e.get("sci"), f"{where}: labelIdx/sci mismatch")
        check(set(e.get("tags", [])) <= ALLOWED_TAGS, f"{where}: unknown tag")
        check(len(e.get("meaning", "").split()) <= 30, f"{where}: meaning too long")
        check(bool(e.get("sources")) or e.get("needsReview"), f"{where}: no source and not needsReview")
        check(any(idx in year_round[c] for c in OAH), f"{where}: not in any OAH city range list")


def check_demo(labels: list) -> None:
    recs = load(DATA_DIR / "demo" / "recordings.json") or []
    check(10 <= len(recs) <= 12, f"recordings.json: {len(recs)} recordings")
    keys = {"id", "file", "title", "recordist", "license", "licenseUrl", "sourceUrl", "gbifOccurrenceUrl", "lat",
            "lon", "recordedAt", "cityId", "nearestSiteCode", "nearestSiteDistanceKm", "durationS", "trimmed",
            "notes", "detections"}
    for r in recs:
        has_keys(r, keys, f"recording {r.get('id')}")
        check("-ND" not in r.get("license", "").upper(), f"{r.get('id')}: ND licence")
        check(r.get("durationS", 999) <= 90.5, f"{r.get('id')}: longer than 90 s")
        check((SAMPLES_DIR / Path(r.get("file", "x")).name).exists(), f"{r.get('id')}: mp3 missing")
        for d in r.get("detections", []):
            has_keys(d, {"labelIdx", "sci", "en", "startS", "endS", "maxP"}, f"{r.get('id')} detection")
            check(labels[d["labelIdx"]].sci == d["sci"], f"{r.get('id')}: detection label mismatch")
    total = sum(p.stat().st_size for p in SAMPLES_DIR.glob("*.mp3"))
    check(total <= 10_000_000, f"public/samples: {total / 1e6:.1f} MB > 10 MB")


def check_benchmark() -> None:
    b = load(DATA_DIR / "benchmark" / "snr.json") or {}
    has_keys(b, {"model", "createdAt", "species", "nPositives", "noiseRecordings", "bySnr", "bySpecies",
                 "byAudibility", "falsePositiveRate03", "suggestedAudibilityThresholdDb", "credits"}, "snr.json")
    for row in b.get("bySnr", []):
        has_keys(row, {"snrDb", "n", "recall03", "recall05", "meanP"}, "snr.json bySnr")
    check(isinstance(b.get("suggestedAudibilityThresholdDb"), (int, float)),
          "snr.json: suggestedAudibilityThresholdDb must be a number")
    check((DOCS_DIR / "evidence-benchmark.md").exists(), "docs/evidence-benchmark.md missing")


def main() -> None:
    labels = acoustic_labels()
    check_oah()
    year_round = check_ranges(len(labels))
    check_species(labels, year_round)
    check_demo(labels)
    check_benchmark()
    if errors:
        print(f"{len(errors)} problem(s):")
        for e in errors[:40]:
            print(" -", e)
        sys.exit(1)
    print("all outputs OK")


if __name__ == "__main__":
    main()
