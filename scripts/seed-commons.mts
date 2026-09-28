// Seed the commons with the public demo recordings (data/demo/recordings.json)
// through the real API, so the listening queue has calls from all five
// OneAquaHealth cities. Soundscape numbers are computed with the app's own
// feature code on ffmpeg-decoded audio. No votes are invented.
//
// Usage: npx tsx scripts/seed-commons.mts [baseUrl]   (default http://localhost:3000)

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { windowFeatures } from "../lib/audio/features";
import { birdnetWeek } from "../lib/geo";

const base = process.argv[2] ?? "http://localhost:3000";
const root = process.cwd();
const recordings = JSON.parse(readFileSync(path.join(root, "data/demo/recordings.json"), "utf8"));
const sites = JSON.parse(readFileSync(path.join(root, "data/oah/sites.json"), "utf8"));
const labels = JSON.parse(readFileSync(path.join(root, "public/models/labels.v3.json"), "utf8"));
const SR = 32_000;

function uuidFrom(text: string): string {
  const h = createHash("sha1").update(`murmur-seed:${text}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function decode(file: string): Float32Array {
  const buf = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

for (const r of recordings) {
  const samples = decode(path.join(root, "public", r.file));
  const feats = [];
  for (let start = 0; start + SR * 1.5 <= samples.length; start += SR * 3) {
    feats.push({ f: windowFeatures(samples.subarray(start, Math.min(samples.length, start + SR * 3)), SR), start: start / SR });
  }
  const bySpecies = new Map<number, { maxP: number; startS: number; endS: number; clipStartS: number }>();
  for (const d of r.detections ?? []) {
    const cur = bySpecies.get(d.labelIdx);
    const clipStartS = Math.floor(d.startS / 3) * 3;
    if (!cur) bySpecies.set(d.labelIdx, { maxP: d.maxP, startS: d.startS, endS: d.endS, clipStartS });
    else {
      cur.startS = Math.min(cur.startS, d.startS);
      cur.endS = Math.max(cur.endS, d.endS);
      if (d.maxP > cur.maxP) Object.assign(cur, { maxP: d.maxP, clipStartS });
    }
  }
  const lifeWindows = new Set<number>();
  for (const d of r.detections ?? []) for (let t = Math.floor(d.startS / 3) * 3; t < d.endS; t += 3) lifeWindows.add(t);
  const site = sites.find((s: { code: string }) => s.code === r.nearestSiteCode);
  const nearSite = site && r.nearestSiteDistanceKm <= 3;
  const date = (r.recordedAt ?? "2026-05-01").slice(0, 10);

  const body = {
    id: uuidFrom(r.id),
    contributor: "anon-xeno-canto",
    place: nearSite
      ? { kind: "site", siteCode: site.code, cityId: site.cityId, lat: site.lat, lon: site.lon, label: `${site.code} · ${site.name}, ${site.cityName}` }
      : { kind: "point", lat: Math.round(r.lat * 1000) / 1000, lon: Math.round(r.lon * 1000) / 1000, label: r.title },
    recordedOn: date,
    week: birdnetWeek(new Date(`${date}T12:00:00Z`)),
    durationS: r.durationS,
    model: "BirdNET+ V3.0 developer preview 3.1",
    threshold: 0.25,
    soundscape: {
      ndsi: feats.reduce((s, w) => s + w.f.ndsi, 0) / Math.max(1, feats.length),
      audibleShare: feats.filter((w) => w.f.audibilityDb >= 6).length / Math.max(1, feats.length),
      lifeShare: lifeWindows.size / Math.max(1, feats.length),
      windows: feats.length,
    },
    source: "public-sample",
    attribution: { recordist: r.recordist, license: r.license, url: r.sourceUrl },
    audioSha256: createHash("sha256").update(readFileSync(path.join(root, "public", r.file))).digest("hex"),
    feelings: null,
    detections: [...bySpecies].map(([labelIdx, d]) => ({
      labelIdx,
      sci: labels.items[labelIdx][0],
      en: labels.items[labelIdx][1],
      className: labels.classes[labels.items[labelIdx][2]],
      maxP: Math.round(d.maxP * 1000) / 1000,
      startS: d.startS,
      endS: d.endS,
      clipStartS: d.clipStartS,
      clipUrl: r.file,
      recordistVote: null,
      clip: null,
    })),
  };
  const res = await fetch(`${base}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  console.log(`${r.id}: ${res.status} ${(await res.text()).slice(0, 120)}`);
}
