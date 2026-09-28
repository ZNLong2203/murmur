"""Step 5: how well does the model hear stream birds through stream noise?

Usage: uv run python -m murmur_pipeline.benchmark
Outputs: data/benchmark/snr.json and docs/evidence-benchmark.md

1. Positives: for each target species, European xeno-canto recordings (via GBIF,
   licences without ND). 3 s windows where the target has p >= 0.5 on the clean
   audio; at most 3 windows per recording, 5 recordings per species.
2. Noise: recordings of flowing water from Wikimedia Commons (CC0 / public domain /
   CC BY / CC BY-SA). Every 3 s window is run through the model; windows with any
   species >= 0.3 are discarded before mixing.
3. Each positive window is mixed with one random noise window at true SNRs of
   +10 ... -15 dB (RMS over the 3 s window) and run through the model again.
4. For every mixture the estimated-audibility index (the formula the browser uses,
   see audibility_db) is computed, and recall is reported per audibility bin.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .common import CACHE_DIR, DATA_DIR, DOCS_DIR, get_file, get_json, read_json, utc_now_iso, write_json
from .gbif import SoundRecord, search_sounds
from .models import (ACOUSTIC_MODEL_NAME, SAMPLE_RATE, WINDOW_SAMPLES, AcousticModel, acoustic_index_by_sci,
                     acoustic_labels, decode_audio)

SEED = 2026
SNRS_DB = (10, 5, 0, -5, -10, -15)
POSITIVE_P = 0.5
DETECT_P = (0.3, 0.5)
NOISE_MAX_P = 0.3
MAX_RECORDINGS = 5
MAX_TRIES = 8
MAX_WINDOWS_PER_REC = 3
MAX_SOURCE_S = 120.0
AUDIBILITY_BINS = ((None, 3), (3, 6), (6, 10), (10, 15), (15, None))
OUT_JSON = DATA_DIR / "benchmark" / "snr.json"
OUT_MD = DOCS_DIR / "evidence-benchmark.md"
OAH_CITIES = ("CO", "TO", "GH", "BE", "OS")

TARGETS = (
    "Cinclus cinclus", "Motacilla cinerea", "Alcedo atthis", "Cettia cetti",
    "Troglodytes troglodytes", "Luscinia megarhynchos", "Actitis hypoleucos", "Gallinula chloropus",
    "Phylloscopus collybita", "Sylvia atricapilla", "Turdus merula", "Erithacus rubecula",
    "Hyla arborea", "Epidalea calamita",
)

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
# Recordings of flowing water on Wikimedia Commons (checked by ear-free criteria:
# title/description say stream, river, brook or weir; licence CC0/PD/CC BY/CC BY-SA).
NOISE_FILES = (
    "File:Rivernoise.ogg",
    "File:Sound Effects - The sound of a small stream.ogg",
    "File:Shallow small river with stony riverbed.ogg",
    "File:Welling rivulet in the woods.ogg",
    "File:Freiburger Bächle.mp3",
    "File:Vojníkov, 3. jez, středa.ogg",
)
NOISE_LICENCES = re.compile(r"^(CC0|Public domain|CC BY(-SA)? \d\.\d)", re.I)


# ---------------------------------------------------------------------------------------
# Audibility index (the browser implements exactly this)
# ---------------------------------------------------------------------------------------
N_FFT, HOP = 1024, 512
BAND_HZ = (2000.0, 8000.0)
_HANN = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N_FFT) / N_FFT)  # periodic Hann
_FREQS = np.arange(N_FFT // 2 + 1) * SAMPLE_RATE / N_FFT
_BAND = (_FREQS >= BAND_HZ[0]) & (_FREQS < BAND_HZ[1])


def audibility_db(window: np.ndarray) -> float:
    """P95 - P20 of per-frame band energy (dB), 2-8 kHz, over a 3 s, 32 kHz window.

    Frames start at 0, 512, 1024, ...; only full 1024-sample frames (186 for 96,000
    samples), no centring or padding. X = unnormalised real FFT of frame * Hann.
    E = sum |X|^2 over bins with 2000 <= f < 8000 Hz (bins 64..255);
    E_db = 10 log10(E + 1e-12); percentiles with linear interpolation.
    """
    x = np.asarray(window, dtype=np.float64)
    n_frames = 1 + (len(x) - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(n_frames)[:, None]
    spec = np.fft.rfft(x[idx] * _HANN, axis=1)
    energy = np.sum(np.abs(spec[:, _BAND]) ** 2, axis=1)
    e_db = 10.0 * np.log10(energy + 1e-12)
    return float(np.percentile(e_db, 95) - np.percentile(e_db, 20))


def audibility_test_vectors() -> list[dict]:
    """Deterministic signals with their expected audibilityDb, to check the browser implementation."""
    n = np.arange(WINDOW_SAMPLES)
    sine4k = 0.5 * np.sin(2 * np.pi * 4000 * n / SAMPLE_RATE)
    sine1k = 0.5 * np.sin(2 * np.pi * 1000 * n / SAMPLE_RATE)
    pulsed = np.where(n % 16000 < 3200, sine4k, 0.0)
    ramp = sine4k * (n / WINDOW_SAMPLES)
    vectors = [
        ("sine4k", "x[n] = 0.5*sin(2*pi*4000*n/32000), n = 0..95999", sine4k),
        ("sine1k", "x[n] = 0.5*sin(2*pi*1000*n/32000) (outside the band)", sine1k),
        ("pulsed4k", "sine4k where (n mod 16000) < 3200, else 0 (silent frames hit the 1e-12 floor)", pulsed),
        ("ramp4k", "sine4k * n/96000 (linear fade-in)", ramp),
    ]
    return [{"name": name, "definition": d, "audibilityDb": round(audibility_db(x), 4)} for name, d, x in vectors]


# ---------------------------------------------------------------------------------------
# Positives
# ---------------------------------------------------------------------------------------
@dataclass
class Positive:
    sci: str
    label_idx: int
    rec: SoundRecord
    start_s: float
    p_clean: float
    audio: np.ndarray


def demo_xc_ids() -> set[int]:
    path = DATA_DIR / "demo" / "recordings.json"
    if not path.exists():
        return set()
    return {int(e["sourceUrl"].rsplit("/", 1)[-1]) for e in read_json(path)}


XC_DATASETS = ["b1047888-ae52-4179-9dd5-5448ea342a24",  # Xeno-canto - Bird sounds
               "bcf8d1fc-6bf0-4f57-9076-7d9ae2828ec2"]  # Xeno-canto - Anura sounds


def species_recordings(sci: str) -> list[SoundRecord]:
    # Restricting to the xeno-canto datasets matters: for some species (e.g. Common Nightingale)
    # the first result pages are all iNaturalist sounds.
    recs = search_sounds({"scientificName": sci, "continent": "EUROPE", "datasetKey": XC_DATASETS},
                         max_records=300)
    skip = demo_xc_ids()
    ok = [r for r in recs if r.licence.allowed and r.sci == sci and r.xc_id not in skip
          and r.duration_s is not None and 5 <= r.duration_s <= MAX_SOURCE_S]
    # Prefer short recordings (smaller downloads), then newest first; deterministic.
    return sorted(ok, key=lambda r: (r.duration_s > 60, -r.xc_id))


def positives_for(sci: str, model: AcousticModel) -> tuple[list[Positive], list[SoundRecord]]:
    idx = acoustic_index_by_sci()[sci]
    found: list[Positive] = []
    used: list[SoundRecord] = []
    for rec in species_recordings(sci)[:MAX_TRIES]:
        if len(used) == MAX_RECORDINGS:
            break
        path = get_file(rec.audio_url, CACHE_DIR / "xc" / f"XC{rec.xc_id}.mp3")
        audio = decode_audio(path, max_seconds=MAX_SOURCE_S)
        n_full = len(audio) // WINDOW_SAMPLES
        if n_full == 0:
            continue
        windows = audio[: n_full * WINDOW_SAMPLES].reshape(n_full, WINDOW_SAMPLES)
        p = model.predict(windows)[:, idx]
        best = [int(w) for w in np.argsort(-p) if p[w] >= POSITIVE_P][:MAX_WINDOWS_PER_REC]
        if not best:
            continue
        used.append(rec)
        found += [Positive(sci, idx, rec, w * 3.0, float(p[w]), windows[w].copy()) for w in sorted(best)]
    return found, used


# ---------------------------------------------------------------------------------------
# Noise
# ---------------------------------------------------------------------------------------
@dataclass
class NoiseFile:
    title: str
    url: str
    page: str
    recordist: str
    licence: str
    windows: np.ndarray
    kept: np.ndarray  # bool per window
    fp_in_range: np.ndarray  # bool per window


def commons_info(title: str) -> dict:
    q = get_json(COMMONS_API, {"action": "query", "prop": "imageinfo", "titles": title, "format": "json",
                               "iiprop": "url|extmetadata"})
    page = next(iter(q["query"]["pages"].values()))
    ii = page["imageinfo"][0]
    meta = ii.get("extmetadata", {})
    strip = lambda s: re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip()  # noqa: E731
    return {"url": ii["url"], "page": ii["descriptionurl"],
            "licence": strip(meta.get("LicenseShortName", {}).get("value", "")),
            "recordist": strip(meta.get("Artist", {}).get("value", "")) or "unknown"}


def english_names() -> dict[str, str]:
    """English names from the curated ecology list (the acoustic labels give none for amphibians)."""
    path = DATA_DIR / "species" / "ecology.json"
    return {e["sci"]: e["en"] for e in read_json(path)} if path.exists() else {}


def in_range_union() -> np.ndarray:
    idx: set[int] = set()
    for c in OAH_CITIES:
        idx |= set(read_json(DATA_DIR / "range" / f"{c}.json")["yearRound"])
    return np.array(sorted(idx), dtype=np.int64)


def load_noise(model: AcousticModel) -> list[NoiseFile]:
    allowed = in_range_union()
    out = []
    for title in NOISE_FILES:
        info = commons_info(title)
        if not NOISE_LICENCES.match(info["licence"]):
            print(f"skip noise {title}: licence {info['licence']!r}")
            continue
        suffix = Path(info["url"]).suffix
        path = get_file(info["url"], CACHE_DIR / "noise" / (re.sub(r"\W+", "_", title[5:]) + suffix))
        audio = decode_audio(path, max_seconds=MAX_SOURCE_S)
        n_full = len(audio) // WINDOW_SAMPLES
        windows = audio[: n_full * WINDOW_SAMPLES].reshape(n_full, WINDOW_SAMPLES)
        probs = model.predict(windows)
        kept = probs.max(axis=1) < NOISE_MAX_P
        fp = probs[:, allowed].max(axis=1) >= DETECT_P[0]
        out.append(NoiseFile(title[5:], info["url"], info["page"], info["recordist"], info["licence"],
                             windows, kept, fp))
        print(f"noise {title[5:40]:36s} windows={n_full:3d} kept={int(kept.sum()):3d} fp={int(fp.sum())}")
    return out


# ---------------------------------------------------------------------------------------
# Mixing and metrics
# ---------------------------------------------------------------------------------------
def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))


def mix(signal: np.ndarray, noise: np.ndarray, snr_db: float) -> np.ndarray:
    """signal + noise scaled so that 20 log10(rms(signal) / rms(noise)) = snr_db; peak kept <= 0.99."""
    gain = rms(signal) / (rms(noise) * 10 ** (snr_db / 20))
    y = signal.astype(np.float64) + gain * noise.astype(np.float64)
    peak = float(np.max(np.abs(y)))
    if peak > 0.99:
        y *= 0.99 / peak  # same factor for both parts, so the SNR is unchanged
    return y.astype(np.float32)


def summarise(p: np.ndarray) -> dict:
    return {"n": int(len(p)),
            "recall03": round(float(np.mean(p >= 0.3)), 3) if len(p) else None,
            "recall05": round(float(np.mean(p >= 0.5)), 3) if len(p) else None,
            "meanP": round(float(np.mean(p)), 3) if len(p) else None}


def bin_label(lo: float | None, hi: float | None) -> str:
    return f"<{hi}" if lo is None else f">={lo}" if hi is None else f"{lo}-{hi}"


def by_audibility(aud: np.ndarray, p: np.ndarray) -> list[dict]:
    rows = []
    for lo, hi in AUDIBILITY_BINS:
        m = np.ones(len(aud), bool)
        if lo is not None:
            m &= aud >= lo
        if hi is not None:
            m &= aud < hi
        rows.append({"bin": bin_label(lo, hi), "lo": lo, "hi": hi, "n": int(m.sum()),
                     "recall03": round(float(np.mean(p[m] >= 0.3)), 3) if m.any() else None})
    return rows


def binned_threshold(rows: list[dict]) -> float | None:
    """Upper edge of the highest audibility bin whose recall03 is below 0.5 (None if no bin is)."""
    below = [r["hi"] for r in rows if r["n"] and r["recall03"] is not None and r["recall03"] < 0.5]
    return max((h for h in below if h is not None), default=None) if below else None


def suggested_threshold(rows: list[dict], logistic50: float | None) -> tuple[float | None, str]:
    """Binned rule when a bin falls under 50% recall; otherwise the logistic 50% crossing."""
    binned = binned_threshold(rows)
    if binned is not None:
        return float(binned), "upper edge of the highest audibility bin with recall (p >= 0.3) below 50%"
    if logistic50 is not None:
        return round(logistic50, 1), ("no audibility bin fell below 50% recall, so the audibility at which a "
                                      "logistic fit of P(target p >= 0.3) crosses 50% is used")
    return None, "not determined"


def logistic_50(aud: np.ndarray, hit: np.ndarray) -> float | None:
    """Audibility at which a logistic fit of P(p >= 0.3) crosses 0.5 (Newton-Raphson)."""
    x = np.column_stack([np.ones_like(aud), aud])
    w = np.zeros(2)
    for _ in range(50):
        pr = 1 / (1 + np.exp(-x @ w))
        grad = x.T @ (hit - pr)
        hess = (x * (pr * (1 - pr))[:, None]).T @ x + 1e-9 * np.eye(2)
        step = np.linalg.solve(hess, grad)
        w += step
        if np.max(np.abs(step)) < 1e-8:
            break
    return round(float(-w[0] / w[1]), 2) if w[1] > 0 else None


# ---------------------------------------------------------------------------------------
def main() -> None:
    rng = np.random.default_rng(SEED)
    model = AcousticModel()
    labels = acoustic_labels()
    names = english_names()

    noise = load_noise(model)
    pool = [(i, w) for i, nf in enumerate(noise) for w in np.flatnonzero(nf.kept)]
    assert pool, "no usable noise windows"
    n_noise_windows = sum(len(nf.kept) for nf in noise)
    fp_rate = sum(int(nf.fp_in_range.sum()) for nf in noise) / n_noise_windows

    positives: list[Positive] = []
    species_rows, used_recs = [], []
    for sci in TARGETS:
        found, used = positives_for(sci, model)
        idx = acoustic_index_by_sci()[sci]
        positives += found
        used_recs += used
        species_rows.append({"sci": sci, "en": names.get(sci, labels[idx].en), "labelIdx": idx,
                             "nRecordings": len(used), "nPositives": len(found)})
        print(f"{sci:26s} recordings={len(used)} windows={len(found)}")

    rows = []  # (species, snr, p_target, audibility)
    for pos in positives:
        fi, wi = pool[int(rng.integers(len(pool)))]
        noise_win = noise[fi].windows[wi]
        mixes = np.stack([mix(pos.audio, noise_win, s) for s in SNRS_DB])
        p = model.predict(mixes)[:, pos.label_idx]
        for s, m, pt in zip(SNRS_DB, mixes, p):
            rows.append((pos.sci, s, float(pt), audibility_db(m)))
    sp_arr = np.array([r[0] for r in rows])
    snr_arr = np.array([r[1] for r in rows])
    p_arr = np.array([r[2] for r in rows])
    aud_arr = np.array([r[3] for r in rows])

    by_snr = [{"snrDb": s, **summarise(p_arr[snr_arr == s])} for s in SNRS_DB]
    by_species = [{"sci": r["sci"], "en": r["en"],
                   "bySnr": [{"snrDb": s, **summarise(p_arr[(sp_arr == r["sci"]) & (snr_arr == s)])}
                             for s in SNRS_DB]}
                  for r in species_rows if r["nPositives"]]
    aud_rows = by_audibility(aud_arr, p_arr)
    logistic50 = logistic_50(aud_arr, (p_arr >= 0.3).astype(float))
    threshold, threshold_method = suggested_threshold(aud_rows, logistic50)
    clean_aud = [audibility_db(p.audio) for p in positives]
    noise_aud = [audibility_db(nf.windows[w]) for nf in noise for w in np.flatnonzero(nf.kept)]

    credits = [{"file": f"XC{r.xc_id} ({r.sci})", "recordist": r.recordist, "license": r.licence.label,
                "url": r.xc_url} for r in used_recs]
    noise_credits = [{"file": nf.title, "recordist": nf.recordist, "license": nf.licence, "url": nf.page,
                      "nWindows": int(len(nf.kept)), "nWindowsKept": int(nf.kept.sum()),
                      "nWindowsFalsePositive03": int(nf.fp_in_range.sum())} for nf in noise]
    result = {
        "model": ACOUSTIC_MODEL_NAME,
        "createdAt": utc_now_iso(),
        "species": species_rows,
        "nPositives": len(positives),
        "nMixtures": len(rows),
        "snrDefinition": "20*log10(rms(clean 3 s window) / rms(scaled noise 3 s window)); mixture = sum, "
                         "rescaled to peak 0.99 only if it would clip",
        "noiseRecordings": noise_credits,
        "bySnr": by_snr,
        "bySpecies": by_species,
        "byAudibility": aud_rows,
        "audibilityMethod": "STFT n_fft=1024, hop=512, periodic Hann, frames at 0,512,... (full frames only, "
                            "no padding); E = sum |X|^2 for 2000 <= f < 8000 Hz; E_db = 10 log10(E + 1e-12); "
                            "audibilityDb = P95(E_db) - P20(E_db), numpy linear percentiles",
        "audibilityTestVectors": audibility_test_vectors(),
        "audibilityCleanMedianDb": round(float(np.median(clean_aud)), 2),
        "audibilityNoiseOnlyMedianDb": round(float(np.median(noise_aud)), 2),
        "logistic50Db": logistic50,
        "falsePositiveRate03": round(fp_rate, 4),
        "falsePositiveDefinition": "share of all noise-only 3 s windows in which any species on the union of "
                                   "the five OAH cities' year-round range lists has p >= 0.3",
        "nNoiseWindows": n_noise_windows,
        "suggestedAudibilityThresholdDb": threshold,
        "suggestedAudibilityThresholdMethod": threshold_method,
        "credits": credits + [{k: c[k] for k in ("file", "recordist", "license", "url")} for c in noise_credits],
    }
    write_json(OUT_JSON, result)
    write_markdown(result)
    print(f"positives={len(positives)} mixtures={len(rows)} fp={fp_rate:.3f} threshold={threshold} "
          f"logistic50={result['logistic50Db']}")


def low_bins_note(rows: list[dict]) -> str:
    low = [x["recall03"] for x in rows if x["hi"] is not None and x["hi"] <= 10 and x["n"]]
    if not low:
        return ""
    return (f"Below 10 dB it separates poorly: recall stays between {100 * min(low):.0f}% and "
            f"{100 * max(low):.0f}% in every bin, so treat the threshold as a rough guide.")


def fmt(v: float | None, pct: bool = True) -> str:
    if v is None:
        return "–"
    return f"{100 * v:.0f}%" if pct else f"{v:.2f}"


def write_markdown(r: dict) -> None:
    lines = [
        "# Evidence: how well Murmur hears stream birds through stream noise",
        "",
        f"Generated by `pipeline/murmur_pipeline/benchmark.py` on {r['createdAt'][:10]}. "
        f"Raw numbers: `data/benchmark/snr.json`.",
        "",
        "## Method",
        "",
        f"- **Model:** {r['model']}, run with onnxruntime on CPU, exactly as in the browser "
        "(3 s windows, 32 kHz mono).",
        f"- **Positives:** {r['nPositives']} three-second windows from "
        f"{sum(s['nRecordings'] for s in r['species'])} European xeno-canto recordings of "
        f"{sum(1 for s in r['species'] if s['nPositives'])} stream-associated species "
        "(found through GBIF). A window counts as a positive when the model gives the target species "
        "p ≥ 0.5 on the original recording; at most 3 windows per recording and 5 recordings per species.",
        f"- **Noise:** {len(r['noiseRecordings'])} recordings of flowing water from Wikimedia Commons. "
        "Noise windows in which the model finds any species at p ≥ 0.3 were discarded before mixing.",
        "- **Mixing:** each positive window was added to one randomly chosen noise window at true "
        "signal-to-noise ratios of +10, +5, 0, −5, −10 and −15 dB (RMS over the 3 s window).",
        "- **Metrics:** recall = share of mixtures in which the target species still reaches p ≥ 0.3 "
        "(and ≥ 0.5); mean target p. False-positive rate = share of all noise-only windows in which "
        "any species on the five OAH cities' range lists reaches p ≥ 0.3.",
        "- **Audibility index** (computed in the browser with the same formula): STFT (n_fft 1024, "
        "hop 512, periodic Hann) of the 3 s window; per-frame energy in 2–8 kHz in dB; "
        "audibilityDb = 95th − 20th percentile over frames.",
        "",
        "## Results",
        "",
        "| SNR (dB) | mixtures | recall p≥0.3 | recall p≥0.5 | mean p |",
        "|---:|---:|---:|---:|---:|",
    ]
    lines += [f"| {x['snrDb']:+d} | {x['n']} | {fmt(x['recall03'])} | {fmt(x['recall05'])} | "
              f"{fmt(x['meanP'], pct=False)} |" for x in r["bySnr"]]
    lines += ["", "Recall (p ≥ 0.3) per species:", "",
              "| species | " + " | ".join(f"{s:+d} dB" for s in SNRS_DB) + " |",
              "|---|" + "---:|" * len(SNRS_DB)]
    for s in r["bySpecies"]:
        n = s["bySnr"][0]["n"]
        lines.append(f"| {s['en']} (*{s['sci']}*, n={n}) | "
                     + " | ".join(fmt(x["recall03"]) for x in s["bySnr"]) + " |")
    lines += ["", "Recall (p ≥ 0.3) by estimated audibility (all SNRs pooled):", "",
              "| audibilityDb | mixtures | recall p≥0.3 |", "|---|---:|---:|"]
    lines += [f"| {x['bin']} | {x['n']} | {fmt(x['recall03'])} |" for x in r["byAudibility"]]
    lines += [
        "",
        f"- **Suggested audibility threshold: {r['suggestedAudibilityThresholdDb']} dB** "
        f"({r['suggestedAudibilityThresholdMethod']}). Below it, fewer than half of the calls that are "
        f"present are expected to be detected, so the app should say that a quiet or masked call may be "
        f"missed rather than that the species is absent.",
        f"- Median audibility of the clean positive windows: {r['audibilityCleanMedianDb']} dB; "
        f"of the noise-only windows: {r['audibilityNoiseOnlyMedianDb']} dB.",
        f"- **False-positive rate on water noise alone:** {100 * r['falsePositiveRate03']:.1f}% of "
        f"{r['nNoiseWindows']} noise windows had an in-range species at p ≥ 0.3.",
        "",
        "## Limitations",
        "",
        "- Small sample: a few recordings per species and few noise recordings; percentages for single "
        "species are rough.",
        "- Positives were chosen because the model already detects them on clean audio (p ≥ 0.5), so "
        "the numbers show how noise *reduces* detection, not the model's overall recall.",
        "- xeno-canto recordings are usually made close to the bird with good microphones and are "
        "often filtered; a phone at a stream bank will record fainter, more distant calls.",
        "- The \"clean\" windows may already contain some background sound, including water.",
        "- Artificial mixing ignores echoes, distance, wind and the phone microphone's response.",
        "- The false-positive check uses only flowing-water noise; traffic, voices and wind were not tested.",
        "- The audibility index only measures the 2–8 kHz band, so it says little about calls that lie "
        "mostly below 2 kHz. " + low_bins_note(r["byAudibility"]),
        "- Model: BirdNET+ V3.0 is a developer preview; results may change with later versions.",
        "",
        "## Credits and licences",
        "",
        "Model: BirdNET+ V3.0 developer preview 3.1 (Kahl et al.), CC BY-SA 4.0. Powered by BirdNET.",
        "",
        "Bird and frog recordings (xeno-canto, found through GBIF):",
        "",
    ]
    lines += [f"- {c['file']}, © {c['recordist']}, {c['license']}, {c['url']}"
              for c in r["credits"] if c["url"].startswith("https://xeno-canto.org/")]
    lines += ["", "Water-noise recordings (Wikimedia Commons):", ""]
    lines += [f"- {c['file']}, {c['recordist']}, {c['license']}, {c['url']}" for c in r["noiseRecordings"]]
    lines.append("")
    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    if "--report-only" in sys.argv[1:]:  # rebuild the Markdown from the existing snr.json
        write_markdown(read_json(OUT_JSON))
    else:
        main()
