# Murmur · a stethoscope for urban streams

[![CI](https://github.com/ZNLong2203/murmur/actions/workflows/ci.yml/badge.svg)](https://github.com/ZNLong2203/murmur/actions/workflows/ci.yml)

Murmur listens to a recording made at an urban stream. BirdNET runs **in your browser** and names the birds and frogs it hears; standard acoustic indices measure how much of the sound is water and traffic; **you confirm every call by ear**; and at a OneAquaHealth research site Murmur sets what you heard beside what the lab found in the water. Results export as **FHIR shaped by the OneAquaHealth IG** and as **Darwin Core** for GBIF.

Built for the **IEEE OneAquaHealth Global Hackathon 2026**, Track 3 (AI-supported assessment), with Tracks 1 and 4 alongside.

**Live app: [murmur-streams.vercel.app](https://murmur-streams.vercel.app)** · Try it in a minute: open *Listen*, pick a public recording from Coimbra, press *Listen*, then play a clip and answer *Did you hear it?* · Methods and limits: [/evidence](https://murmur-streams.vercel.app/evidence)

## Why sound

- **Birds and amphibians are two of OneAquaHealth's eleven ecosystem-health indicators**, and the project's policy brief describes birds, amphibians and fish as natural controls of disease-carrying insects.
- **The OneAquaHealth citizen app already asks** people to describe a stream and say how it made them feel. It has no biological indicator yet, and the project's own research (D4.2) found that people keep contributing when they can see what their observations mean.
- **A recording is a voucher.** Anyone can listen again to check an identification, which makes citizen data verifiable in a way a checkbox is not.
- **One recording speaks to all three kinds of health:** animals (which species call), environment (how much water and traffic noise), people (hearing birds is linked to lasting gains in wellbeing; [Hammoud et al. 2022](https://doi.org/10.1038/s41598-022-20207-6)).

## What it does

| | |
|---|---|
| **Listen** (`/analyze`) | Drop a phone voice memo, a field-recorder file or the 5–10 s video the OneAquaHealth app collects; pick the site and date. Murmur draws the spectrogram, names what it hears in the city's language (Portuguese in Coimbra, Dutch in Ghent, Norwegian in Oslo, French in Toulouse), flags the minutes too noisy to hear small birds, and lets you play the exact 3 s behind each suggestion. |
| **Compare** | At a research site, "What the ear can't tell you" shows the OneAquaHealth lab's pathogen, faecal-bacteria and antibiotic-resistance-gene risk and ecological quality classes for the same place. A lively soundscape does not mean the water is safe to touch. |
| **Share** | Opt in to share the calls you kept. Clips are screened on your device for human speech (Silero VAD), which is muted; the full recording never leaves. |
| **Verify** (`/verify`) | Listeners at home hear 3 s clips they did not record and vote. Three votes and a two-thirds majority agree or reject a call; disputes go to an expert whose verdict is final. |
| **Explore** (`/map`, `/sites/:code`) | The 106 OneAquaHealth sites with two layers, what the lab found and what people heard, and a page per site with species, recordings and the pressures around it. |
| **Export** | FHIR R4 transaction bundle (OAH `location-oah`, `observation-indicators-oah` with the IG's `birds` and `amphibians` codes, GBIF taxa, a Provenance separating the model's suggestion from the person's confirmation) and Darwin Core CSV. |

## How it works

See [docs/architecture.md](docs/architecture.md) for the diagram and [docs/fhir-mapping.md](docs/fhir-mapping.md) for the FHIR design.

- **Model:** BirdNET+ V3.0 developer preview 3.1 (11,560 classes including 647 amphibians), FP16 ONNX, run on onnxruntime-web in a Web Worker. About 230 ms per 3 s window on one thread.
- **Range filter:** the BirdNET+ geomodel, precomputed for each city and week, keeps species plausible there and then; anything else is listed apart, never silently dropped.
- **Acoustic indices:** an audibility index (P95 − P20 of 2–8 kHz band energy) and the NDSI, computed with an in-house FFT.
- **Stack:** Next.js 16, React 19, TypeScript, Tailwind 4, MapLibre + OpenFreeMap, Postgres (Neon in production, PGlite in development and tests), zod, Vitest, Playwright, and a Python pipeline (uv) for data preparation.

## Privacy and trust

- Analysis runs on the device; nothing is uploaded unless you share.
- Shared clips are 3 s long and speech-screened; typed coordinates are rounded to about 100 m; contributors are random pseudonyms.
- The recording is identified in exports only by its SHA-256 fingerprint (RFC 6920).
- Statuses are recomputed on the server from vote tallies; the API validates every request and rate-limits by network.

## Run it

```bash
npm install
npm run dev          # fetches the model, labels and WASM once (~90 MB), then starts on :3000
npm test             # unit and repository tests (PGlite)
npx tsx scripts/seed-commons.mts            # optional: fill the listening queue with the public demo recordings
npx tsx scripts/validate-fhir.mts           # validate a sample bundle on the public HAPI FHIR server
```

Without `DATABASE_URL` the app keeps its data in an in-process PGlite database under `.data/`. Set `DATABASE_URL` (a Postgres URL, e.g. Neon) for a shared deployment and `MURMUR_EXPERT_CODE` to enable expert votes. See `.env.example`.

## Evidence and limits

[/evidence](https://murmur-streams.vercel.app/evidence) in the app and [docs/evidence-benchmark.md](docs/evidence-benchmark.md) describe how we checked Murmur and what it cannot do. In short: Murmur tells you **who is calling**, not what is in the water; BirdNET makes mistakes, which is why every suggestion is checked by ears; silence under loud water does not mean absence; and the range lists are regional, not site-specific.

## Data, models and credits

- Sound identification powered by **BirdNET** (Kahl et al. 2021): BirdNET+ V3.0 developer preview, CC BY-SA 4.0, downloaded from [Zenodo](https://zenodo.org/records/20703646) at install time. Not for poaching or military use.
- **Silero VAD** v5.1.2 (MIT) for speech screening.
- **OneAquaHealth** research sites, ecology, health-risk and urban data from the project's public API ([oneaquahealth.eu](https://www.oneaquahealth.eu/)), snapshot in `data/oah/`.
- Demo recordings from **xeno-canto** via GBIF, each credited in `data/demo/recordings.json` (CC BY-NC-SA 4.0).
- Taxa from the **GBIF Backbone Taxonomy**; base map by **OpenFreeMap** / OpenMapTiles / © OpenStreetMap contributors.

Code is MIT licensed. Model and recording licences travel with those files.
