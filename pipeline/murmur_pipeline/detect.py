"""Range filtering and detection merging, mirroring what the browser app does."""

from __future__ import annotations

from datetime import date

import numpy as np

from .common import DATA_DIR, read_json
from .models import WINDOW_S, acoustic_labels, week_of_year


def range_indices(location_id: str, iso_date: str | None) -> np.ndarray:
    """Acoustic label indices in range at a location for the recording's week (year-round if no date)."""
    rng = read_json(DATA_DIR / "range" / f"{location_id}.json")
    if iso_date:
        d = date.fromisoformat(iso_date[:10])
        return np.array(rng["weeks"][str(week_of_year(d.month, d.day))], dtype=np.int64)
    return np.array(rng["yearRound"], dtype=np.int64)


def detections(probs: np.ndarray, allowed: np.ndarray, threshold: float,
               duration_s: float | None = None) -> list[dict]:
    """Per-species runs of consecutive windows with p >= threshold, merged; sorted by start time.

    endS is clipped to duration_s (the last window is zero-padded)."""
    labels = acoustic_labels()
    out = []
    sub = probs[:, allowed] >= threshold
    for col in np.flatnonzero(sub.any(axis=0)):
        idx = int(allowed[col])
        hits = sub[:, col]
        w = 0
        while w < len(hits):
            if not hits[w]:
                w += 1
                continue
            start = w
            while w < len(hits) and hits[w]:
                w += 1
            lb = labels[idx]
            out.append({
                "labelIdx": idx, "sci": lb.sci, "en": lb.en,
                "startS": round(start * WINDOW_S, 1),
                "endS": round(min(w * WINDOW_S, duration_s or np.inf), 1),
                "maxP": round(float(probs[start:w, idx].max()), 3),
            })
    return sorted(out, key=lambda d: (d["startS"], -d["maxP"]))
