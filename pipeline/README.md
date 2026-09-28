# Murmur offline data pipeline

Python scripts that prepare the static data the Murmur web app reads: a snapshot of the public
OneAquaHealth (OAH) API, weekly species range lists from the BirdNET+ geo model, public demo
recordings with pre-computed detections, curated ecology notes per species, and a noise-robustness
benchmark of the acoustic model. Nothing here runs in the browser; the outputs are committed JSON and
MP3 files.

## Setup

Requirements: [uv](https://docs.astral.sh/uv/), Python ≥ 3.12 (tested with 3.13) and `ffmpeg` on the
`PATH` (Homebrew: `/opt/homebrew/bin/ffmpeg`).

```bash
cd pipeline
UV_HTTP_TIMEOUT=300 uv sync          # creates pipeline/.venv (numpy, onnxruntime, requests)
```

Every download (models, API responses, audio, cited web pages) is cached in `pipeline/.cache/`
(git-ignored), so re-running a step does not hit the servers again. Requests are rate-limited to one
per second per host and send the User-Agent `MurmurHackathon/0.1 (research; contact via GitHub)`.

## Steps

Run from `pipeline/`, in this order (each step reads the outputs of the previous ones):

| # | Command | Produces |
|---|---|---|
| 1 | `uv run python -m murmur_pipeline.oah_snapshot` | `data/oah/*.json` |
| 2 | `uv run python -m murmur_pipeline.ranges` | `data/range/<id>.json`, `data/range/unmapped.json` |
| 3 | `uv run python -m murmur_pipeline.demo_recordings` | `public/samples/*.mp3`, `public/samples/CREDITS.md`, `data/demo/recordings.json` |
| 4 | `uv run python -m murmur_pipeline.ecology` | `data/species/ecology.json`, `data/species/ecology-evidence.json` |
| 5 | `uv run python -m murmur_pipeline.benchmark` | `data/benchmark/snr.json`, `docs/evidence-benchmark.md` |
| – | `uv run python -m murmur_pipeline.check_outputs` | checks every file above against its contract |

Approximate run times with a warm cache: seconds for 1, 2 and 4; about a minute for 3; a few minutes
for 5. A cold cache adds the downloads (acoustic model 72 MB, geo model 16 MB, about 100 audio files).

### 1. OAH API snapshot (`oah_snapshot.py`)

Fetches six public, unauthenticated endpoints of `https://api.enora-oah.eu` (built by ENORA
Innovation for OneAquaHealth): cities, the 106 research sites, citizen-created sites, city-dashboard
ecology records, health-risk scores and urban parameters. Responses are stored verbatim (all fields
kept), one record per line. Two exceptions: `sites.json` is flattened to
`{code, name, cityId, cityName, lat, lon, altitude}` and the sites' GeoJSON outlines (present for 33
Oslo and Toulouse sites) are moved to `site-polygons.json`, keyed by site code. `meta.json` records
the fetch time and endpoints. `--cached` reuses the last responses instead of fetching again.

### 2. Species range lists (`ranges.py`)

Runs the **BirdNET+ Geomodel V3.0.4** (the FP32 ONNX file and label list that `birdnet==1.1.1`
downloads for `birdnet.load("geo", "3.0", "onnx")`, verified by SHA-256; outputs were checked to be
identical to the `birdnet` package) for the five OAH cities (coordinates from `/api/cities/all`) and
two team field-test locations (HN Hanoi, SG Ho Chi Minh City). A species is listed for a week when the
geo model's occurrence probability is ≥ 0.03, BirdNET's default location-filter threshold.
`yearRound` is the union over the 48 weeks.

- **Weeks** follow BirdNET's 48-week year (four per month). This pipeline maps a date to a week with
  `week = (month − 1) · 4 + min(4, ⌊(day − 1) / 7⌋ + 1)` (days 1–7 → 1st week of the month, 8–14 → 2nd,
  15–21 → 3rd, 22–31 → 4th); the app must use the same mapping (`models.week_of_year`).
- **Label mapping.** The geo model has 14,082 labels, the acoustic model 11,560. Lists contain
  acoustic `idx` values. Labels are matched by scientific name (10,653 species); if the name is
  missing from the geo labels, by an identical English name that is unique among geo labels
  (82 species, mostly genus changes such as *Charadrius dubius* → *Thinornis dubius*). 17 of these
  are acoustic labels that duplicate another acoustic label under the new name (same English name);
  both labels share the range. 825 acoustic labels (394 birds, 250 insects, 150 amphibians, 83 mammals, …)
  have no geo counterpart and **can never pass the range filter**; they are listed in
  `data/range/unmapped.json` with the 3,364 geo species that have no acoustic label.

Species per location (year-round / smallest–largest week): CO Coimbra 365 (274–313), TO Toulouse
382 (250–285), GH Ghent 513 (367–470), BE Benevento 468 (290–412), OS Oslo 391 (233–362),
HN Hanoi 535 (333–490), SG Ho Chi Minh City 434 (310–415).

### 3. Demo recordings (`demo_recordings.py`)

Searches GBIF (`/v1/occurrence/search?mediaType=Sound`, no key) for xeno-canto recordings near each
OAH city and downloads the MP3 from `xeno-canto.org/sounds/uploaded/…`. The licence used is the one on
the recording's Sound media item (stricter than GBIF's dataset-level licence); only CC0, BY, BY-SA,
BY-NC and BY-NC-SA are accepted (no ND: the app cuts 3 s snippets). Selection is deterministic
(see the module docstring): radius 15 km, widened to 30 km for Coimbra and Benevento where fewer than
six usable recordings exist; a score favouring OAH-site proximity, soundscapes, several background
species, water-associated species and amphibians; then the acoustic model's detections. Two
recordings per city, each re-encoded to mono MP3 (32 kHz, 64 kbps) and cut to the 90 s stretch with
the most detections when longer (`trimmed: true`, noted in `notes`). Detections are computed on the
final MP3 with the city's range list for the recording week, threshold 0.25, consecutive windows of a
species merged. `--credits-only` rewrites `public/samples/CREDITS.md` from `recordings.json`.

### 4. Species ecology (`ecology.py`)

A hand-curated list of 83 birds and amphibians (15 amphibians) plausibly heard at urban streams in
the five OAH cities, each with tags from a fixed vocabulary, one plain-language sentence (≤ 25 words)
and sources. Every species is on at least one OAH city range list. The script fetches every source
(BTO BirdFacts pages; English Wikipedia through the MediaWiki API; Amphibian and Reptile Conservation
Trust pages; the Spanish *Enciclopedia Virtual de los Vertebrados Españoles* of the MNCN-CSIC for four
Iberian amphibians; the Crossref record, with abstract, of Silva, Reino & Borralho 2002 for the Common
Waxbill in Portugal), then checks each tag, each specific claim of the sentence and, for amphibians,
the English name against the fetched text with keyword patterns (English, plus Spanish for the
Spanish encyclopedia). Page menus are removed first, and a keyword that is part of a species name
("Reed Warbler", "Night Heron") does not count. Up to two matching passages per check are written to
`data/species/ecology-evidence.json`. An entry with an unconfirmed tag or claim, no usable source, or
no presence in any OAH city range list gets `needsReview: true`; in the current output none does,
because unconfirmed tags and claims were removed or reworded. The passages were read by a person, but
keyword matches are a screening aid, not proof. Amphibian English names come from the sources, since
the acoustic label file repeats the scientific name for most non-bird species.

Tag meanings: `clean-water` sensitive to polluted or acid water · `flowing-water` streams and rivers ·
`riparian-woodland` trees, scrub and thickets such as those lining streams · `reedbed-wetland` reeds,
marshes, wet meadows · `open-water` ponds, lakes, slow water · `insect-eater` insects are a main food ·
`amphibian` · `urban-tolerant` lives in towns, parks or gardens · `non-native` introduced to Europe
(or, for Common Waxbill, to Portugal). The sentences avoid claiming that any single species controls
mosquitoes or other disease vectors.

### 5. Noise-robustness benchmark (`benchmark.py`)

Mixes 3 s windows of stream-associated species (European xeno-canto recordings via GBIF, windows the
model detects at p ≥ 0.5 on clean audio) with real flowing-water recordings from Wikimedia Commons at
+10 … −15 dB SNR and measures how often the model still detects the target (p ≥ 0.3 / 0.5). It also
computes the **estimated-audibility index** that the browser shows next to results:

```
x      = 3 s window, 32 kHz mono (96,000 samples)
frames = x[k·512 : k·512 + 1024], k = 0 … 185   (full frames only, no padding or centring)
w[n]   = 0.5 − 0.5·cos(2πn / 1024)               (periodic Hann)
X      = rfft(frame · w)                           (unnormalised)
E      = Σ |X[b]|²  over bins b with 2000 ≤ b·32000/1024 < 8000   (b = 64 … 255)
E_db   = 10·log10(E + 1e−12)
audibilityDb = P95(E_db) − P20(E_db)              (percentiles with linear interpolation, as numpy)
```

`snr.json` → `audibilityTestVectors` gives four deterministic signals (steady and pulsed sines, a fade-in)
with the expected `audibilityDb`, so the browser implementation can be unit-tested against this one.

`suggestedAudibilityThresholdDb` in `snr.json` is the upper edge of the highest audibility bin whose
recall (p ≥ 0.3) is below 50%; when no bin falls below 50% (the case in the current run), it is the
audibility at which a logistic fit of detection against audibilityDb crosses 50%
(`suggestedAudibilityThresholdMethod` says which rule applied). Positives come only from the GBIF
xeno-canto datasets (bird and anuran sounds) and never from the demo recordings. Method, results and
limitations: `docs/evidence-benchmark.md` (`--report-only` rebuilds it from `snr.json`).

## Licences and attribution of external data

- **Pipeline code:** MIT, like the rest of the repository.
- **BirdNET+ models** (acoustic V3.0 developer preview 3.1, Zenodo 10.5281/zenodo.20703646; geo model
  V3.0.4, github.com/birdnet-team/geomodel): CC BY-SA 4.0. Attribution: "Powered by BirdNET"
  (Kahl et al. 2021, *Ecological Informatics* 61: 101236). The terms of use prohibit use for poaching
  or illegal wildlife exploitation and for any military purpose, and describe the preview as provided
  for research and evaluation. The range lists and detections are model outputs; if they count as
  derivatives they fall under CC BY-SA 4.0 as well.
- **OneAquaHealth data** (`data/oah/`): snapshot of the public API of the OneAquaHealth project
  (ENORA Innovation). "Research data © OneAquaHealth consortium." No open licence was found for these
  data; they are used for the IEEE OneAquaHealth Global Hackathon.
- **xeno-canto recordings** (`public/samples/`, benchmark positives): each recording keeps its own
  Creative Commons licence and recordist credit, listed in `data/demo/recordings.json`,
  `public/samples/CREDITS.md` and `docs/evidence-benchmark.md`. All demo recordings are CC BY-NC-SA:
  non-commercial use only, and the trimmed/re-encoded MP3s must stay under the same licence (the
  repository's MIT licence does not cover them). Found through GBIF.org (datasets "Xeno-canto – Bird
  sounds / Anura sounds / Soundscapes from around the world", published by Stichting Xeno-canto voor
  Natuurgeluiden).
- **Wikimedia Commons water recordings** (benchmark noise, not redistributed): licences and authors
  per file in `data/benchmark/snr.json` and `docs/evidence-benchmark.md`.
- **Ecology sources:** cited by URL in `ecology.json`. `ecology-evidence.json` contains short
  quotations (about 200 characters) for verification: Wikipedia text is CC BY-SA 4.0; BTO BirdFacts
  text is © British Trust for Ornithology; ARC and MNCN-CSIC texts are © their publishers.
