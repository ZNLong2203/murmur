"""Step 2: weekly species range lists from the BirdNET+ geo model -> data/range/<id>.json.

Usage: uv run python -m murmur_pipeline.ranges

For each location the geo model gives an occurrence probability per species and
week (1-48, four "weeks" per month). A species is listed for a week when that
probability is >= 0.03 (BirdNET's default location-filter threshold). Geo
species are mapped to ACOUSTIC label indices (the `idx` column of the acoustic
label file) by scientific name; when the scientific name is absent from the geo
labels, an identical English name that is unique in the geo labels is used as a
fallback (genus changes such as Charadrius dubius -> Thinornis dubius; see
build_mapping). Every fallback and every species left unmapped is written to
data/range/unmapped.json.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np

from .common import DATA_DIR, read_json, write_json
from .models import GEO_MODEL_NAME, LABELS_VERSION, GeoModel, acoustic_labels, geo_labels

THRESHOLD = 0.03
OUT_DIR = DATA_DIR / "range"

# Team field-test sites (not OAH cities).
EXTRA_LOCATIONS = [
    ("HN", "Hanoi", 21.0285, 105.8542),
    ("SG", "Ho Chi Minh City", 10.7769, 106.7009),
]


@dataclass
class Mapping:
    acoustic_to_geo: np.ndarray  # acoustic idx -> geo index, -1 if none
    by_common_name: list[dict]
    acoustic_unmapped: list[list]
    geo_unmapped: list[list]


def build_mapping() -> Mapping:
    """Map every acoustic label to a geo label: scientific name first, English name as fallback.

    The fallback (identical English name, unique among geo labels) covers genus changes
    (Charadrius dubius -> Thinornis dubius). If the geo species is itself an acoustic label
    (the acoustic set sometimes has the same species under an old and a new name), the
    fallback is only taken when both acoustic labels share the English name; lumps such as
    Anas carolinensis ("Green-winged Teal") vs A. crecca ("Eurasian Teal") stay unmapped.
    """
    acoustic, geo = acoustic_labels(), geo_labels()
    geo_idx_by_sci = {g.sci: i for i, g in enumerate(geo)}
    geo_idx_by_en: dict[str, list[int]] = {}
    for i, g in enumerate(geo):
        geo_idx_by_en.setdefault(g.en.casefold(), []).append(i)
    acoustic_by_sci = {lb.sci: lb for lb in acoustic}

    acoustic_to_geo = np.full(len(acoustic), -1, dtype=np.int64)
    by_common_name, acoustic_unmapped = [], []
    for lb in acoustic:
        gi = geo_idx_by_sci.get(lb.sci)
        if gi is None and lb.en != lb.sci:
            candidates = geo_idx_by_en.get(lb.en.casefold(), [])
            twin = acoustic_by_sci.get(geo[candidates[0]].sci) if len(candidates) == 1 else None
            if len(candidates) == 1 and (twin is None or twin.en.casefold() == lb.en.casefold()):
                gi = candidates[0]
                by_common_name.append({"labelIdx": lb.idx, "acousticSci": lb.sci,
                                       "geoSci": geo[gi].sci, "en": lb.en, "class": lb.cls,
                                       "sameSpeciesAlsoAcousticLabel": twin.idx if twin else None})
        if gi is None:
            acoustic_unmapped.append([lb.idx, lb.sci, lb.en, lb.cls])
            continue
        acoustic_to_geo[lb.idx] = gi
    used = set(acoustic_to_geo[acoustic_to_geo >= 0].tolist())
    geo_unmapped = [[g.code, g.sci, g.en] for i, g in enumerate(geo) if i not in used]
    return Mapping(acoustic_to_geo, by_common_name, acoustic_unmapped, geo_unmapped)


def locations() -> list[tuple[str, str, float, float]]:
    cities = read_json(DATA_DIR / "oah" / "cities.json")
    oah = [(c["id"], c["name"], float(c["latitude"]), float(c["longitude"])) for c in cities]
    return oah + EXTRA_LOCATIONS


def weekly_lists(probs: np.ndarray, acoustic_to_geo: np.ndarray) -> dict[str, list[int]]:
    """Acoustic indices (ascending) whose geo species has p >= THRESHOLD, per week 1..48."""
    mapped = acoustic_to_geo >= 0
    weeks = {}
    for w in range(48):
        in_range = mapped & (probs[w][np.where(mapped, acoustic_to_geo, 0)] >= THRESHOLD)
        weeks[str(w + 1)] = [int(i) for i in np.flatnonzero(in_range)]
    return weeks


def render_range_json(record: dict) -> str:
    """Pretty top level, one compact line per index list (keeps files small)."""
    compact = lambda v: json.dumps(v, separators=(",", ":"))  # noqa: E731
    head = ",\n".join(f' "{k}": {json.dumps(record[k], ensure_ascii=False)}'
                      for k in ("id", "name", "lat", "lon", "model", "threshold", "labelsVersion"))
    weeks = ",\n".join(f'  "{w}": {compact(v)}' for w, v in record["weeks"].items())
    return f'{{\n{head},\n "weeks": {{\n{weeks}\n }},\n "yearRound": {compact(record["yearRound"])}\n}}\n'


def main() -> None:
    mapping = build_mapping()
    model = GeoModel()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for loc_id, name, lat, lon in locations():
        weeks = weekly_lists(model.predict_weeks(lat, lon), mapping.acoustic_to_geo)
        year_round = sorted(set().union(*map(set, weeks.values())))
        record = {"id": loc_id, "name": name, "lat": lat, "lon": lon, "model": GEO_MODEL_NAME,
                  "threshold": THRESHOLD, "labelsVersion": LABELS_VERSION,
                  "weeks": weeks, "yearRound": year_round}
        (OUT_DIR / f"{loc_id}.json").write_text(render_range_json(record), encoding="utf-8")
        sizes = [len(v) for v in weeks.values()]
        print(f"{loc_id} {name:18s} yearRound={len(year_round):4d}  per week min={min(sizes)} max={max(sizes)}")

    n_geo, n_ac = len(geo_labels()), len(acoustic_labels())
    unmapped = {
        "note": ("Acoustic labels are matched to geo-model labels by scientific name; if absent, by an "
                 "identical English name unique among geo labels (listed in mappedByCommonName). "
                 "Acoustic species in acousticWithoutGeo can never pass the range filter."),
        "geoModel": GEO_MODEL_NAME,
        "labelsVersion": LABELS_VERSION,
        "counts": {
            "geoLabels": n_geo,
            "acousticLabels": n_ac,
            "mappedBySciName": n_ac - len(mapping.acoustic_unmapped) - len(mapping.by_common_name),
            "mappedByCommonName": len(mapping.by_common_name),
            "acousticWithoutGeo": len(mapping.acoustic_unmapped),
            "geoWithoutAcoustic": len(mapping.geo_unmapped),
        },
        "mappedByCommonName": mapping.by_common_name,
        "acousticWithoutGeo": mapping.acoustic_unmapped,
        "geoWithoutAcoustic": mapping.geo_unmapped,
    }
    write_json(OUT_DIR / "unmapped.json", unmapped, indent=None)
    print(json.dumps(unmapped["counts"]))


if __name__ == "__main__":
    main()
