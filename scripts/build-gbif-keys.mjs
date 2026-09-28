#!/usr/bin/env node
// Resolve every species that can pass a range filter to a GBIF backbone
// taxon key, so exports carry a resolvable taxon identifier (FHIR component
// coding, Darwin Core taxonID) instead of a bare name. Output is committed:
// data/species/gbif.json. Re-run when range lists change.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const labels = JSON.parse(await readFile(path.join(root, "public/models/labels.v3.json"), "utf8"));
const rangeDir = path.join(root, "data/range");
const wanted = new Set();
for (const f of await readdir(rangeDir)) {
  if (!/^[A-Z]{2}\.json$/.test(f)) continue;
  for (const idx of JSON.parse(await readFile(path.join(rangeDir, f), "utf8")).yearRound) wanted.add(idx);
}

const out = {};
let done = 0;
for (const idx of [...wanted].sort((a, b) => a - b)) {
  const [sci] = labels.items[idx];
  const url = `https://api.gbif.org/v1/species/match?strict=true&name=${encodeURIComponent(sci)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "MurmurHackathon/0.1 (research)" } });
      const m = await res.json();
      if (m.usageKey && m.matchType !== "NONE") {
        out[idx] = { key: m.acceptedUsageKey ?? m.usageKey, rank: m.rank, kingdom: m.kingdom, class: m.class, matchType: m.matchType };
      }
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  if (++done % 100 === 0) console.log(`[gbif] ${done}/${wanted.size}`);
  await new Promise((r) => setTimeout(r, 120));
}

await writeFile(
  path.join(root, "data/species/gbif.json"),
  JSON.stringify({ source: "GBIF Backbone Taxonomy, https://api.gbif.org/v1/species/match (strict)", createdAt: new Date().toISOString(), byLabelIdx: out }),
);
console.log(`[gbif] matched ${Object.keys(out).length} of ${wanted.size}`);
