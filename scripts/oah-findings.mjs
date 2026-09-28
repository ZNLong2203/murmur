#!/usr/bin/env node
// Two things we noticed in OneAquaHealth's own public data, reproducibly:
// 1. Weather before sampling: for each of the 96 health-risk lab samples,
//    rain in the 3 days before (ERA5 reanalysis via the Open-Meteo archive).
// 2. Which urban pressures travel with microbial risk (Spearman rank rho).
// Writes data/benchmark/oah-findings.json. Open-Meteo responses are cached.
//
// Usage: node scripts/oah-findings.mjs

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = async (p) => JSON.parse(await readFile(path.join(root, p), "utf8"));
const risks = await read("data/oah/health-risks.json");
const urban = await read("data/oah/urban-parameters.json");
const sites = await read("data/oah/sites.json");
const cacheDir = path.join(root, "node_modules", ".cache", "murmur-openmeteo");
await mkdir(cacheDir, { recursive: true });

async function weather(site, date) {
  const end = new Date(`${date}T00:00:00Z`);
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const file = path.join(cacheDir, `${site.code}_${date}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${site.lat}&longitude=${site.lon}&start_date=${iso(start)}&end_date=${iso(end)}&daily=precipitation_sum,temperature_2m_max&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status} for ${site.code} ${date}`);
  const json = await res.json();
  await writeFile(file, JSON.stringify(json));
  await new Promise((r) => setTimeout(r, 150));
  return json;
}

/** Ranks with ties averaged, then Pearson on the ranks. */
function spearman(a, b) {
  const pairs = a.map((v, i) => [v, b[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const rank = (vals) => {
    const order = vals.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(vals.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(pairs.map((p) => p[0]));
  const ry = rank(pairs.map((p) => p[1]));
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return { rho: num / Math.sqrt(dx * dy), n: rx.length };
}

const rows = [];
for (const r of risks) {
  const site = sites.find((s) => s.code === r.researchSiteCode);
  if (!site) continue;
  const date = r.samplingDate.slice(0, 10);
  const w = await weather(site, date);
  const rain = w.daily.precipitation_sum.map((v) => v ?? 0);
  const u = urban.find((x) => x.researchSiteCode === site.code) ?? {};
  rows.push({
    site: site.code,
    city: site.cityId,
    date,
    rain3: rain.slice(-4, -1).reduce((s, v) => s + v, 0),
    tmax: w.daily.temperature_2m_max.at(-1),
    pathogen: r.scaledPathogenRisk,
    fecal: r.scaledFecalRisk,
    arg: r.scaledArgRisk,
    distSewage: u.distanceToSewageStations ?? NaN,
  });
}

const dry = rows.filter((r) => r.rain3 < 5).length;
const round = (x) => Math.round(x * 100) / 100;
const findings = {
  createdAt: new Date().toISOString(),
  source: "OneAquaHealth public API snapshot (data/oah) + ERA5 reanalysis via the Open-Meteo archive API",
  samples: rows.length,
  sampledAfterThreeDryDays: dry,
  dryDefinition: "less than 5 mm of rain in the 3 days before the sampling day",
  correlations: [
    { what: "Pathogen risk vs distance to the nearest sewage works", ...spearman(rows.map((r) => r.pathogen), rows.map((r) => r.distSewage)) },
    { what: "Pathogen risk vs maximum temperature on the sampling day", ...spearman(rows.map((r) => r.pathogen), rows.map((r) => r.tmax)) },
    { what: "Faecal risk vs rain in the 3 days before sampling", ...spearman(rows.map((r) => r.fecal), rows.map((r) => r.rain3)) },
  ].map((c) => ({ ...c, rho: round(c.rho) })),
  note: "Single samples per site, pooled across five cities: associations, not causes. City differences (climate, sewer systems) are confounders.",
};
await mkdir(path.join(root, "data/benchmark"), { recursive: true });
await writeFile(path.join(root, "data/benchmark/oah-findings.json"), JSON.stringify(findings, null, 1));
console.log(`[oah] ${dry}/${rows.length} samples after three dry days; rho:`, findings.correlations.map((c) => c.rho).join(", "));
