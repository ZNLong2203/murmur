"""Fetch cited web pages (cached) and turn them into plain text for evidence checks."""

from __future__ import annotations

import hashlib
import html
import json
import re
from urllib.parse import quote, unquote, urlsplit

import requests

from .common import CACHE_DIR, http_get

TEXT_DIR = CACHE_DIR / "sources"


def html_to_text(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", html.unescape(raw)).strip()


def wikipedia_api_url(page_url: str) -> str:
    """Plain-text extract of an English Wikipedia article through the MediaWiki API."""
    title = unquote(urlsplit(page_url).path.rsplit("/", 1)[-1])
    return ("https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1"
            f"&redirects=1&format=json&titles={quote(title)}")


def europepmc_api_url(page_url: str) -> str:
    """Abstract of a Europe PMC record (https://europepmc.org/article/MED/<pmid>)."""
    src, ext_id = urlsplit(page_url).path.strip("/").split("/")[-2:]
    return ("https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core"
            f"&query=EXT_ID:{ext_id}%20AND%20SRC:{src}")


def crossref_api_url(doi_url: str) -> str:
    doi = urlsplit(doi_url).path.lstrip("/")
    return f"https://api.crossref.org/works/{quote(doi)}"


def fetch_text(url: str) -> tuple[str | None, str]:
    """Return (text, status). Wikipedia, Europe PMC and DOIs are read through their public APIs."""
    TEXT_DIR.mkdir(parents=True, exist_ok=True)
    path = TEXT_DIR / (hashlib.sha1(url.encode()).hexdigest()[:20] + ".txt")
    if path.exists():
        return path.read_text(encoding="utf-8"), "cached"
    host = urlsplit(url).netloc
    try:
        if host.endswith("wikipedia.org"):
            pages = http_get(wikipedia_api_url(url)).json()["query"]["pages"]
            text = " ".join(p.get("extract", "") for p in pages.values())
        elif host == "europepmc.org":
            res = http_get(europepmc_api_url(url)).json()["resultList"]["result"][0]
            text = f"{res.get('title', '')} {res.get('abstractText', '')}"
            text = html_to_text(text)
        elif host == "doi.org":
            msg = http_get(crossref_api_url(url)).json()["message"]
            text = html_to_text(" ".join([*msg.get("title", []), msg.get("abstract", "")]))
        else:
            text = html_to_text(http_get(url, timeout=45.0).text)
    except (requests.RequestException, KeyError, IndexError, json.JSONDecodeError) as e:
        return None, f"error: {type(e).__name__}: {str(e)[:120]}"
    if not text.strip():
        return None, "error: empty text"
    path.write_text(text, encoding="utf-8")
    return text, "fetched"


def snippet(text: str, pattern: re.Pattern[str], width: int = 160) -> str | None:
    m = pattern.search(text)
    if not m:
        return None
    a, b = max(0, m.start() - width), min(len(text), m.end() + width)
    return ("…" if a else "") + text[a:b].strip() + ("…" if b < len(text) else "")
