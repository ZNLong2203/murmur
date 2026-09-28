"""Step 4: pick public demo recordings near the five OAH cities -> public/samples/, data/demo/.

Usage: uv run python -m murmur_pipeline.demo_recordings

Source: xeno-canto recordings found through the GBIF occurrence API
(mediaType=Sound), audio downloaded from xeno-canto.org/sounds/uploaded/...
Only CC0 / BY / BY-SA / BY-NC / BY-NC-SA recordings are used (no ND: the app
cuts 3 s snippets). Selection per city is deterministic:

1. candidates within 15 km of the city centre (widened to 30 km, then 50 km,
   when fewer than 6 are available), 8-600 s long, not nocturnal-migration clips;
2. a first score favours recordings near an OAH research site, soundscapes,
   several background species, water-associated species, amphibians and
   water-related words in the locality/remarks;
3. the best 6 are downloaded and run through the acoustic model with the
   city's weekly range filter; the score adds the number of species detected
   (p >= 0.25) and a bonus for water-associated species;
4. the best 2 with different foreground species are kept. Recordings longer
   than 90 s are cut to the 90 s stretch with the most detections.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .common import (CACHE_DIR, DATA_DIR, SAMPLES_DIR, get_file, haversine_km, read_json,
                     write_json)
from .detect import detections, range_indices
from .gbif import SoundRecord, bbox, search_sounds
from .models import FFMPEG, SAMPLE_RATE, WINDOW_S, AcousticModel, decode_audio, to_windows

THRESHOLD = 0.25
PER_CITY = 2
SHORTLIST = 6
MAX_OUT_S = 90.0
MAX_SOURCE_S = 600.0
RADII_KM = (15.0, 30.0, 50.0)
MIN_CANDIDATES = 6
BITRATE = "64k"
OUT_JSON = DATA_DIR / "demo" / "recordings.json"

XC_SOUNDSCAPES = "ff571aeb-46bf-45c4-ad2c-af4d68315765"
XC_ANURA = "bcf8d1fc-6bf0-4f57-9076-7d9ae2828ec2"

# Species whose presence makes a recording a better "urban stream" demo.
WATER_SPECIES = {
    "Cinclus cinclus", "Motacilla cinerea", "Alcedo atthis", "Cettia cetti",
    "Actitis hypoleucos", "Gallinula chloropus", "Anas platyrhynchos", "Ardea cinerea",
    "Egretta garzetta", "Acrocephalus scirpaceus", "Acrocephalus arundinaceus",
    "Rallus aquaticus", "Fulica atra", "Tachybaptus ruficollis", "Motacilla alba",
    "Luscinia megarhynchos", "Cygnus olor", "Alopochen aegyptiaca", "Emberiza schoeniclus",
}
WATER_WORDS = re.compile(
    r"\b(river|rivi[eè]re|r[ií]o|ribeira|fiume|torrente|stream|brook|creek|beek|bach|ruisseau|"
    r"canal|kanaal|mondego|leie|schelde|escaut|calore|sabato|akerselva|alna|lysakerelva|elva?|"
    r"bekk(en)?|lake|lac|lago|meer|vijver|pond|[ée]tang|wetland|marsh|marais|reed|park|parc|"
    r"parque|parco|jardin|garden|water(?!\s*rail)|eau|[aá]gua|acqua|vann|bank|berge|ripisylve|"
    r"riparian|weir|waterfall|cascade|soundscape|dawn chorus)\b", re.I)


@dataclass
class Candidate:
    rec: SoundRecord
    city_id: str
    city_km: float
    site_code: str
    site_km: float
    score: float = 0.0
    notes: list[str] = field(default_factory=list)
    # filled after the model run
    start_s: float = 0.0
    dets: list[dict] = field(default_factory=list)

    @property
    def is_soundscape(self) -> bool:
        return self.rec.dataset == XC_SOUNDSCAPES

    @property
    def is_amphibian(self) -> bool:
        return self.rec.dataset == XC_ANURA


def prelim_score(c: Candidate) -> float:
    r = c.rec
    s = 3.0 if c.site_km <= 3 else 1.5 if c.site_km <= 6 else 0.0
    s += 2.0 if c.is_soundscape else 0.0
    s += 0.4 * min(len(r.background), 8)
    s += 2.0 if ({r.sci, *r.background} & WATER_SPECIES) or c.is_amphibian else 0.0
    s += 1.5 if c.is_amphibian else 0.0
    s += 1.0 if WATER_WORDS.search(f"{r.locality} {r.notes}") else 0.0
    s -= 1.0 if (r.duration_s or 0) < 20 else 0.0
    s -= 1.5 if c.city_km > 15 else 0.0
    return s


def usable(r: SoundRecord) -> bool:
    if not r.licence.allowed or r.duration_s is None:
        return False
    if not 8 <= r.duration_s <= MAX_SOURCE_S or "nocturnal" in r.behavior.lower():
        return False
    # "Animalia" = unidentified, except in the soundscape dataset
    return r.sci != "Animalia" or r.dataset == XC_SOUNDSCAPES


def candidates_for(city: dict, sites: list[dict]) -> tuple[list[Candidate], float]:
    lat, lon = float(city["latitude"]), float(city["longitude"])
    city_sites = [s for s in sites if s["cityId"] == city["id"]]
    for radius in RADII_KM:
        cands = []
        for r in search_sounds(bbox(lat, lon, radius)):
            dist = haversine_km(lat, lon, r.lat, r.lon)
            if dist > radius or not usable(r):
                continue
            site = min(city_sites, key=lambda s: haversine_km(s["lat"], s["lon"], r.lat, r.lon))
            cands.append(Candidate(r, city["id"], dist, site["code"],
                                   haversine_km(site["lat"], site["lon"], r.lat, r.lon)))
        if len(cands) >= MIN_CANDIDATES or radius == RADII_KM[-1]:
            for c in cands:
                c.score = prelim_score(c)
            return sorted(cands, key=lambda c: (-c.score, c.rec.xc_id)), radius
    raise AssertionError


def source_audio(r: SoundRecord) -> Path:
    return get_file(r.audio_url, CACHE_DIR / "xc" / f"XC{r.xc_id}.mp3")


def best_segment(per_window_species: np.ndarray, n_out: int) -> int:
    """Start window of the n_out-window stretch with the most (window, species) detections."""
    if len(per_window_species) <= n_out:
        return 0
    sums = np.convolve(per_window_species, np.ones(n_out, dtype=int), mode="valid")
    return int(np.argmax(sums))


def evaluate(c: Candidate, model: AcousticModel) -> None:
    """Run the model on the source, choose the 90 s segment, score by detections."""
    audio = decode_audio(source_audio(c.rec), max_seconds=MAX_SOURCE_S)
    allowed = range_indices(c.city_id, c.rec.date)
    probs = model.predict(to_windows(audio))
    per_window = (probs[:, allowed] >= THRESHOLD).sum(axis=1)
    start_w = best_segment(per_window, int(MAX_OUT_S / WINDOW_S))
    c.start_s = start_w * WINDOW_S
    seg = probs[start_w:start_w + int(MAX_OUT_S / WINDOW_S)]
    dets = detections(seg, allowed, THRESHOLD)
    species = {d["sci"] for d in dets}
    c.score += 1.0 * len(species) + (2.0 if species & WATER_SPECIES else 0.0)
    c.dets = dets


def pick(cands: list[Candidate]) -> list[Candidate]:
    """Best PER_CITY by score; first pass also avoids the same recordist at the same place."""
    ranked = sorted(cands, key=lambda c: (-c.score, c.rec.xc_id))
    chosen: list[Candidate] = []
    for strict in (True, False):
        for c in ranked:
            if len(chosen) == PER_CITY:
                return chosen
            if c in chosen or any(c.rec.sci == o.rec.sci and not c.is_soundscape for o in chosen):
                continue
            if strict and any(c.rec.recordist == o.rec.recordist and c.rec.locality == o.rec.locality
                              for o in chosen):
                continue
            chosen.append(c)
    return chosen


def encode(c: Candidate, out: Path) -> tuple[float, bool]:
    """Cut to <= 90 s from start_s, re-encode mono MP3 (32 kHz, 64 kbps). Returns (duration, trimmed)."""
    src_len = c.rec.duration_s or 0
    trimmed = c.start_s > 0 or src_len > MAX_OUT_S
    cmd = [FFMPEG, "-nostdin", "-v", "error", "-y"]
    if c.start_s > 0:
        cmd += ["-ss", f"{c.start_s:.3f}"]
    cmd += ["-i", str(source_audio(c.rec)), "-t", f"{MAX_OUT_S:.3f}", "-map_metadata", "-1",
            "-ac", "1", "-ar", str(SAMPLE_RATE), "-codec:a", "libmp3lame", "-b:a", BITRATE, str(out)]
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(cmd, check=True)
    return len(decode_audio(out)) / SAMPLE_RATE, trimmed


def entry(c: Candidate, city_name: str, radius: float, model: AcousticModel) -> dict:
    r = c.rec
    rec_id = f"{c.city_id.lower()}-xc{r.xc_id}"
    out = SAMPLES_DIR / f"{rec_id}.mp3"
    duration, trimmed = encode(c, out)
    # Detections are recomputed on the file the app will actually play.
    audio = decode_audio(out)
    probs = model.predict(to_windows(audio))
    dets = detections(probs, range_indices(c.city_id, r.date), THRESHOLD, duration_s=duration)

    what = "Soundscape" if c.is_soundscape else f"{r.en or r.sci}{f' ({r.behavior})' if r.behavior else ''}"
    notes = [f"Recordist's label: {'soundscape' if c.is_soundscape else f'{r.en} ({r.sci})'}."]
    if r.background:
        notes.append(f"Background species listed by the recordist: {', '.join(r.background)}.")
    if trimmed:
        notes.append(f"Trimmed from {r.duration_s:.0f} s to {duration:.0f} s starting at "
                     f"{c.start_s:.0f} s (the stretch with the most model detections).")
    if c.city_km > 15:
        notes.append(f"No suitable xeno-canto recording within 15 km of {city_name}; "
                     f"this one is {c.city_km:.0f} km from the city centre.")
    if r.locality:
        notes.append(f"Locality: {r.locality}.")
    if r.notes:
        notes.append(f"Recordist remarks: {r.notes.strip()}")
    return {
        "id": rec_id,
        "file": f"/samples/{rec_id}.mp3",
        "title": f"{what}, near {city_name} (XC{r.xc_id})",
        "recordist": r.recordist,
        "license": r.licence.label,
        "licenseUrl": r.licence.url,
        "sourceUrl": r.xc_url,
        "gbifOccurrenceUrl": r.gbif_url,
        "lat": r.lat,
        "lon": r.lon,
        "recordedAt": r.date,
        "cityId": c.city_id,
        "nearestSiteCode": c.site_code,
        "nearestSiteDistanceKm": round(c.site_km, 2),
        "durationS": round(duration, 1),
        "trimmed": trimmed,
        "notes": " ".join(notes),
        "detections": dets,
    }


def write_credits(entries: list[dict]) -> None:
    """public/samples/CREDITS.md: attribution and licence of every demo MP3."""
    lines = ["# Demo recordings: credits and licences", "",
             "Trimmed and re-encoded (mono MP3, 32 kHz, 64 kbps) from xeno-canto recordings found through "
             "GBIF. Each file keeps the licence of its source recording; the repository's MIT licence does "
             "not apply to these files.", ""]
    for e in entries:
        change = "trimmed and re-encoded" if e["trimmed"] else "re-encoded"
        lines.append(f"- `{Path(e['file']).name}`: {e['title']}. Recordist: {e['recordist']}. "
                     f"Licence: [{e['license']}]({e['licenseUrl']}). Source: {e['sourceUrl']}. "
                     f"Changes: {change}.")
    (SAMPLES_DIR / "CREDITS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main(argv: list[str]) -> None:
    if "--credits-only" in argv:
        write_credits(read_json(OUT_JSON))
        return
    cities = read_json(DATA_DIR / "oah" / "cities.json")
    sites = read_json(DATA_DIR / "oah" / "sites.json")
    model = AcousticModel()
    entries = []
    for city in cities:
        cands, radius = candidates_for(city, sites)
        shortlist = cands[:SHORTLIST]
        for c in shortlist:
            evaluate(c, model)
        chosen = pick(shortlist)
        for c in chosen:
            e = entry(c, city["name"], radius, model)
            entries.append(e)
            print(f"{city['id']} r={radius:.0f}km XC{c.rec.xc_id} score={c.score:.1f} "
                  f"site={c.site_code}@{c.site_km:.1f}km dur={e['durationS']}s "
                  f"trim={e['trimmed']} dets={len(e['detections'])} {c.rec.sci}")
    write_json(OUT_JSON, entries)
    write_credits(entries)
    keep = {Path(e["file"]).name for e in entries}
    for stale in SAMPLES_DIR.glob("*.mp3"):
        if stale.name not in keep:
            stale.unlink()
    total = sum(p.stat().st_size for p in SAMPLES_DIR.glob("*.mp3"))
    print(f"{len(entries)} recordings, public/samples total {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main(sys.argv[1:])
