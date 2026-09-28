#!/usr/bin/env node
// Does the model running in the browser hear what the reference run heard?
// Drives the real /analyze page in headless Chrome, as a user would, over
// every public demo recording, and compares the species it reports (same
// range filter, same 0.25 threshold) with the offline Python/onnxruntime
// run stored in data/demo/recordings.json. Writes data/benchmark/parity.json.
//
// Usage: node scripts/parity-check.mjs [baseUrl]   (the app must be running)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const root = process.cwd();
const recordings = JSON.parse(await readFile(path.join(root, "data/demo/recordings.json"), "utf8"));

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });

const results = [];
for (const r of recordings) {
  const offline = new Map();
  for (const d of r.detections ?? []) offline.set(d.labelIdx, Math.max(offline.get(d.labelIdx) ?? 0, d.maxP));

  await page.goto(`${base}/analyze`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: new RegExp(r.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  await page.getByText("Ready to listen").waitFor({ timeout: 60_000 });
  await page.getByTestId("listen").click();
  await page.locator("[data-testid=species], [data-testid=no-species]").first().waitFor({ timeout: 180_000 });

  const heard = await page.$$eval("[data-label-idx]", (els) => els.map((el) => [Number(el.getAttribute("data-label-idx")), Number(el.getAttribute("data-max-p"))]));
  const browserSet = new Map(heard);
  const both = [...browserSet.keys()].filter((k) => offline.has(k));
  const union = new Set([...browserSet.keys(), ...offline.keys()]);
  const deltas = both.map((k) => Math.abs(browserSet.get(k) - offline.get(k)));
  results.push({
    id: r.id,
    browser: browserSet.size,
    offline: offline.size,
    shared: both.length,
    jaccard: union.size ? both.length / union.size : 1,
    meanAbsScoreDiff: deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null,
    onlyBrowser: [...browserSet.keys()].filter((k) => !offline.has(k)),
    onlyOffline: [...offline.keys()].filter((k) => !browserSet.has(k)),
  });
  console.log(`[parity] ${r.id}: browser ${browserSet.size}, offline ${offline.size}, shared ${both.length}`);
}
await browser.close();

const totals = results.reduce((t, x) => ({ shared: t.shared + x.shared, union: t.union + x.browser + x.offline - x.shared }), { shared: 0, union: 0 });
const summary = {
  createdAt: new Date().toISOString(),
  method: "Browser: decodeAudioData + OfflineAudioContext resampling to 32 kHz, onnxruntime-web WASM. Reference: ffmpeg resampling, onnxruntime CPU. Same model file, range filter and 0.25 threshold.",
  recordings: results.length,
  pooledJaccard: totals.union ? totals.shared / totals.union : 1,
  results,
};
await mkdir(path.join(root, "data/benchmark"), { recursive: true });
await writeFile(path.join(root, "data/benchmark/parity.json"), JSON.stringify(summary, null, 1));
console.log(`[parity] pooled species agreement (Jaccard) ${summary.pooledJaccard.toFixed(3)}`);
