"""Shared paths, polite cached HTTP, and small helpers used by every step."""

from __future__ import annotations

import hashlib
import json
import math
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlsplit

import requests

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
CACHE_DIR = PIPELINE_DIR / ".cache"
DATA_DIR = REPO_ROOT / "data"
SAMPLES_DIR = REPO_ROOT / "public" / "samples"
DOCS_DIR = REPO_ROOT / "docs"

USER_AGENT = "MurmurHackathon/0.1 (research; contact via GitHub)"
MIN_INTERVAL_S = 1.0  # between two requests to the same host (brief asks >= 0.5 s)

_session = requests.Session()
_session.headers["User-Agent"] = USER_AGENT
_last_request: dict[str, float] = {}


def _wait_for_host(url: str) -> None:
    host = urlsplit(url).netloc
    elapsed = time.monotonic() - _last_request.get(host, 0.0)
    if elapsed < MIN_INTERVAL_S:
        time.sleep(MIN_INTERVAL_S - elapsed)
    _last_request[host] = time.monotonic()


def full_url(url: str, params: dict[str, Any] | None = None) -> str:
    if not params:
        return url
    return f"{url}{'&' if '?' in url else '?'}{urlencode(params, doseq=True)}"


def _cache_path(url: str, suffix: str) -> Path:
    host = urlsplit(url).netloc or "local"
    digest = hashlib.sha1(url.encode()).hexdigest()[:20]
    return CACHE_DIR / "http" / host / f"{digest}{suffix}"


def http_get(url: str, *, timeout: float = 60.0, retries: int = 4) -> requests.Response:
    """GET with per-host rate limiting and exponential back-off on 429/5xx."""
    delay = 5.0
    for attempt in range(retries + 1):
        _wait_for_host(url)
        try:
            resp = _session.get(url, timeout=timeout)
        except requests.RequestException:
            if attempt == retries:
                raise
            time.sleep(delay)
            delay *= 2
            continue
        if resp.status_code in (429, 500, 502, 503, 504, 520, 521, 522, 523, 524) and attempt < retries:
            time.sleep(delay)
            delay *= 2
            continue
        resp.raise_for_status()
        return resp
    raise RuntimeError(f"unreachable: {url}")


def cached_at(url: str, params: dict[str, Any] | None = None) -> str | None:
    """UTC ISO time at which a cached JSON response was fetched, if cached."""
    path = _cache_path(full_url(url, params), ".json")
    if not path.exists():
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(path.stat().st_mtime))


def get_json(url: str, params: dict[str, Any] | None = None, *, refresh: bool = False) -> Any:
    """Fetch JSON once and serve it from pipeline/.cache/http afterwards."""
    target = full_url(url, params)
    path = _cache_path(target, ".json")
    if path.exists() and not refresh:
        return json.loads(path.read_text(encoding="utf-8"))
    data = http_get(target).json()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def get_file(url: str, dest: Path | None = None, *, sha256: str | None = None) -> Path:
    """Download a binary file once (cached); optionally verify its SHA-256."""
    path = dest or _cache_path(url, Path(urlsplit(url).path).suffix or ".bin")
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        resp = http_get(url, timeout=600.0)
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_bytes(resp.content)
        tmp.rename(path)
    if sha256 is not None:
        actual = file_sha256(path)
        if actual != sha256:
            raise ValueError(f"SHA-256 mismatch for {path.name}: {actual} != {sha256}")
    return path


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path: Path, data: Any, *, indent: int | None = 1, rows: bool = False) -> None:
    """Write UTF-8 JSON. rows=True writes a list as one compact record per line."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if rows and isinstance(data, list):
        body = ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in data)
        text = f"[\n{body}\n]" if data else "[]"
    elif indent is None:
        text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(data, ensure_ascii=False, indent=indent)
    path.write_text(text + "\n", encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def utc_now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
