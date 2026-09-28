"""Find xeno-canto sound recordings through the GBIF occurrence API (no key needed).

GBIF republishes xeno-canto (datasets "Xeno-canto - Bird sounds / Anura sounds /
Soundscapes ... from around the world") with direct MP3 URLs on xeno-canto.org.
The licence that applies to a recording is the one on its Sound media item, which
can be stricter than the dataset-level licence shown on the occurrence.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from .common import get_json

GBIF_SEARCH = "https://api.gbif.org/v1/occurrence/search"
PAGE = 300

# Creative Commons licence codes that allow the app to cut 3 s snippets (no ND).
ALLOWED_CC = {"zero", "by", "by-sa", "by-nc", "by-nc-sa"}


@dataclass(frozen=True)
class Licence:
    code: str  # "zero", "by", "by-nc-sa", ...
    version: str
    url: str

    @property
    def label(self) -> str:
        if self.code == "zero":
            return f"CC0 {self.version}"
        return f"CC {self.code.upper()} {self.version}"

    @property
    def allowed(self) -> bool:
        return self.code in ALLOWED_CC


def parse_licence(url: str | None) -> Licence | None:
    """Parse a creativecommons.org licence URL (http or https, with or without /legalcode)."""
    if not url:
        return None
    m = re.search(r"creativecommons\.org/(?:licenses/([a-z-]+)|publicdomain/(zero))/(\d\.\d)", url)
    if not m:
        return None
    code = m.group(1) or m.group(2)
    version = m.group(3)
    base = "publicdomain" if code == "zero" else "licenses"
    return Licence(code, version, f"https://creativecommons.org/{base}/{code}/{version}/")


@dataclass
class SoundRecord:
    gbif_key: int
    xc_id: int
    dataset: str
    sci: str
    en: str
    recordist: str
    licence: Licence
    audio_url: str
    lat: float
    lon: float
    date: str | None
    locality: str
    notes: str
    behavior: str
    background: list[str] = field(default_factory=list)
    duration_s: float | None = None

    @property
    def xc_url(self) -> str:
        return f"https://xeno-canto.org/{self.xc_id}"

    @property
    def gbif_url(self) -> str:
        return f"https://www.gbif.org/occurrence/{self.gbif_key}"


def _duration(desc: str | None) -> float | None:
    """xeno-canto media descriptions look like '25 s' or '1 m 05 s'."""
    if not desc:
        return None
    m = re.fullmatch(r"\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?\s*", desc)
    if not m or not any(m.groups()):
        return None
    return int(m.group(1) or 0) * 60 + int(m.group(2) or 0)


def to_record(occ: dict[str, Any]) -> SoundRecord | None:
    """Keep only xeno-canto sound media with coordinates and a parseable licence."""
    sound = next((m for m in occ.get("media", []) if m.get("type") == "Sound"
                  and "xeno-canto.org" in urlsplit(m.get("identifier", "")).netloc), None)
    cat = str(occ.get("catalogNumber") or "")
    if sound is None or not cat.startswith("XC") or occ.get("decimalLatitude") is None:
        return None
    licence = parse_licence(sound.get("license"))
    if licence is None:
        return None
    assoc = occ.get("associatedTaxa") or ""
    background = [s.strip() for s in assoc.split(":", 1)[-1].split("|") if s.strip()] if assoc else []
    date = occ.get("eventDate")
    return SoundRecord(
        gbif_key=int(occ["key"]),
        xc_id=int(cat[2:]),
        dataset=occ.get("datasetKey", ""),
        sci=occ.get("species") or occ.get("scientificName") or "",
        en=occ.get("vernacularName") or "",
        recordist=sound.get("creator") or occ.get("recordedBy") or "",
        licence=licence,
        audio_url=sound["identifier"],
        lat=float(occ["decimalLatitude"]),
        lon=float(occ["decimalLongitude"]),
        date=date[:10] if date else None,
        locality=occ.get("locality") or "",
        notes=" ".join(x for x in (occ.get("occurrenceRemarks"), occ.get("fieldNotes")) if x),
        behavior=occ.get("behavior") or "",
        background=background,
        duration_s=_duration(sound.get("description")),
    )


def bbox(lat: float, lon: float, radius_km: float) -> dict[str, str]:
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * math.cos(math.radians(lat)))
    return {"decimalLatitude": f"{lat - dlat:.4f},{lat + dlat:.4f}",
            "decimalLongitude": f"{lon - dlon:.4f},{lon + dlon:.4f}"}


def search_sounds(params: dict[str, Any], max_records: int = 1500) -> list[SoundRecord]:
    """Page through GBIF occurrence search (mediaType=Sound) and keep xeno-canto records."""
    out: list[SoundRecord] = []
    offset = 0
    while offset < max_records:
        page = get_json(GBIF_SEARCH, {**params, "mediaType": "Sound", "limit": PAGE, "offset": offset})
        out += [r for r in map(to_record, page.get("results", [])) if r is not None]
        offset += PAGE
        if page.get("endOfRecords", True):
            break
    return out
