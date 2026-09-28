"""BirdNET+ V3.0 acoustic model and geo (range) model, run with onnxruntime on CPU.

The acoustic model is the exact file the browser loads (FP16 pruned ONNX,
developer preview 3.1). The geo model is BirdNET+ Geomodel V3.0.4, the same file
and labels that `birdnet==1.1.1` pins for `birdnet.load("geo", "3.0", "onnx")`
(default precision fp32); its input is [latitude, longitude, week] as float32.

Both models: CC BY-SA 4.0, "Powered by BirdNET" (Kahl et al. 2021).
"""

from __future__ import annotations

import csv
import shutil
import subprocess
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import numpy as np
import onnxruntime as ort

from .common import CACHE_DIR, get_file

MODELS_DIR = CACHE_DIR / "models"
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"

SAMPLE_RATE = 32_000
WINDOW_S = 3.0
WINDOW_SAMPLES = 96_000

_ZENODO = "https://zenodo.org/records/20703646/files/"
ACOUSTIC_MODEL_NAME = "BirdNET+ V3.0 developer preview 3.1 (Global 11K, FP16 pruned ONNX)"
ACOUSTIC_MODEL_FILE = "BirdNET+_V3.0-preview3.1_Global_11K_FP16_pruned.onnx"
ACOUSTIC_MODEL_SHA256 = "69cfc8db3ebec163feb6329e546eb56e1aadac2a309f1ee99aecfabd1aa9bd24"
ACOUSTIC_LABELS_FILE = "BirdNET+_V3.0-preview3.1_Global_11K_Labels.csv"
ACOUSTIC_LABELS_SHA256 = "8124b0ea2d187104c5e2cd95a0f937165647e20349c8fd34d4d5ef991821f8f0"
LABELS_VERSION = "BirdNET+_V3.0-preview3.1_Global_11K"

_GEO = "https://github.com/birdnet-team/geomodel/releases/download/v3.0.4/"
GEO_MODEL_NAME = "BirdNET+ Geomodel V3.0.4"
GEO_MODEL_FILE = "BirdNET+_Geomodel_V3.0.4_Global_14K_FP32.onnx"
GEO_MODEL_SHA256 = "0de81d222c23dcb6fa428e958b4dac978783191357e01b7268a103fc6f08e61a"
GEO_LABELS_FILE = "BirdNET+_Geomodel_V3.0.4_Global_14K_Labels.txt"
GEO_LABELS_SHA256 = "8250b457e45d43fc3e77b5cbd06a1d311baf585ab9c51ed8d42e011d98534835"


@dataclass(frozen=True)
class Label:
    idx: int
    id: str
    sci: str
    en: str
    cls: str
    order: str


@cache
def acoustic_labels() -> list[Label]:
    path = get_file(_ZENODO + ACOUSTIC_LABELS_FILE, MODELS_DIR / ACOUSTIC_LABELS_FILE,
                    sha256=ACOUSTIC_LABELS_SHA256)
    with path.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f, delimiter=";"))
    labels = [Label(int(r["idx"]), r["id"], r["sci_name"], r["com_name"], r["class"], r["order"])
              for r in rows]
    assert [lb.idx for lb in labels] == list(range(len(labels))), "idx column must be 0..n-1"
    return labels


@cache
def acoustic_index_by_sci() -> dict[str, int]:
    return {lb.sci: lb.idx for lb in acoustic_labels()}


@dataclass(frozen=True)
class GeoLabel:
    code: str
    sci: str
    en: str


@cache
def geo_labels() -> list[GeoLabel]:
    path = get_file(_GEO + GEO_LABELS_FILE, MODELS_DIR / GEO_LABELS_FILE, sha256=GEO_LABELS_SHA256)
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        code, sci, en = line.split("\t")[:3]
        out.append(GeoLabel(code, sci, en))
    return out


def _session(path: Path) -> ort.InferenceSession:
    opts = ort.SessionOptions()
    opts.log_severity_level = 3
    return ort.InferenceSession(str(path), sess_options=opts, providers=["CPUExecutionProvider"])


class AcousticModel:
    """Input float32 [batch, 96000] (3 s, 32 kHz, [-1, 1]); output probabilities [batch, 11560]."""

    def __init__(self) -> None:
        path = get_file(_ZENODO + ACOUSTIC_MODEL_FILE, MODELS_DIR / ACOUSTIC_MODEL_FILE,
                        sha256=ACOUSTIC_MODEL_SHA256)
        self.session = _session(path)
        self.labels = acoustic_labels()

    def predict(self, windows: np.ndarray, batch_size: int = 16) -> np.ndarray:
        windows = np.asarray(windows, dtype=np.float32).reshape(-1, WINDOW_SAMPLES)
        out = [self.session.run(["predictions"], {"input": windows[i:i + batch_size]})[0]
               for i in range(0, len(windows), batch_size)]
        if not out:
            return np.zeros((0, len(self.labels)), dtype=np.float32)
        return np.concatenate(out, axis=0)


class GeoModel:
    """Species occurrence probability for (lat, lon, week 1-48), 14K geo labels."""

    def __init__(self) -> None:
        path = get_file(_GEO + GEO_MODEL_FILE, MODELS_DIR / GEO_MODEL_FILE, sha256=GEO_MODEL_SHA256)
        self.session = _session(path)
        self.labels = geo_labels()
        self._input = self.session.get_inputs()[0].name

    def predict_weeks(self, lat: float, lon: float) -> np.ndarray:
        """Probabilities [48, n_species] for weeks 1..48."""
        x = np.array([[lat, lon, float(w)] for w in range(1, 49)], dtype=np.float32)
        probs = self.session.run(None, {self._input: x})[0]
        assert probs.shape == (48, len(self.labels)), probs.shape
        return probs


def decode_audio(path: Path, max_seconds: float | None = None) -> np.ndarray:
    """Decode any audio file to mono float32 at 32 kHz with ffmpeg."""
    cmd = [FFMPEG, "-nostdin", "-v", "error", "-i", str(path)]
    if max_seconds is not None:
        cmd += ["-t", f"{max_seconds:.3f}"]
    cmd += ["-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def to_windows(audio: np.ndarray) -> np.ndarray:
    """Consecutive, non-overlapping 3 s windows; the last one zero-padded."""
    n = max(1, int(np.ceil(len(audio) / WINDOW_SAMPLES)))
    padded = np.zeros(n * WINDOW_SAMPLES, dtype=np.float32)
    padded[: len(audio)] = audio
    return padded.reshape(n, WINDOW_SAMPLES)


def week_of_year(month: int, day: int) -> int:
    """BirdNET week (1-48): four weeks per month, as in BirdNET-Analyzer."""
    return (month - 1) * 4 + min(4, (day - 1) // 7 + 1)
