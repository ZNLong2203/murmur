#!/usr/bin/env node
// Fetch the BirdNET model and labels into public/models/ and copy the
// onnxruntime-web WASM binary into public/ort/, so the browser can analyse
// recordings locally. Runs before `next dev` and `next build`.
//
// Downloads are cached in node_modules/.cache/murmur-models and checked
// against pinned SHA-256 hashes. Nothing here is committed: the model is
// CC BY-SA 4.0 (BirdNET+ V3.0 developer preview) and is fetched from Zenodo.

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(root, "node_modules", ".cache", "murmur-models");
const modelsDir = path.join(root, "public", "models");
const ortDir = path.join(root, "public", "ort");

const ZENODO = "https://zenodo.org/records/20703646/files";

export const SOURCES = {
  model: {
    name: "BirdNET+_V3.0-preview3.1_Global_11K_FP16_pruned.onnx",
    url: `${ZENODO}/BirdNET+_V3.0-preview3.1_Global_11K_FP16_pruned.onnx`,
    bytes: 71_528_628,
    sha256: "69cfc8db3ebec163feb6329e546eb56e1aadac2a309f1ee99aecfabd1aa9bd24",
  },
  labels: {
    name: "BirdNET+_V3.0-preview3.1_Global_11K_Labels.csv",
    url: `${ZENODO}/BirdNET+_V3.0-preview3.1_Global_11K_Labels.csv`,
    bytes: 809_172,
    sha256: "8124b0ea2d187104c5e2cd95a0f937165647e20349c8fd34d4d5ef991821f8f0",
  },
  vad: {
    name: "silero_vad-v5.1.2.onnx",
    url: "https://github.com/snakers4/silero-vad/raw/v5.1.2/src/silero_vad/data/silero_vad.onnx",
    bytes: 2_327_524,
    sha256: "2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f",
  },
  taxonomy: {
    name: "taxonomy_v0.2-Jun2026.csv",
    url: "https://github.com/birdnet-team/geomodel/raw/refs/tags/v3.0.4/taxonomy_v0.2-Jun2026.csv",
    bytes: 11_078_402,
    sha256: "98b27fc4a77c5e321c7bbf96f924fc4b58170de9688e79ebf3ea8263d522580a",
  },
};

const MODEL_FILE = "birdnet-v3.0-p3.1-fp16-pruned.onnx";
// Silero VAD (MIT) screens shared clips for human speech before upload.
const VAD_FILE = "silero-vad-v5.1.2.onnx";
const LABELS_FILE = "labels.v3.json";
// Local-language names shown for each OneAquaHealth city. The BirdNET
// taxonomy has no Italian column, so Benevento falls back to English.
const LOCALES = { pt: "common_name_pt_PT", fr: "common_name_fr", nl: "common_name_nl", no: "common_name_no" };

async function sha256(file) {
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

async function isValid(file, source) {
  if (!existsSync(file)) return false;
  if ((await stat(file)).size !== source.bytes) return false;
  return (await sha256(file)) === source.sha256;
}

async function download(source) {
  const target = path.join(cacheDir, source.name);
  if (await isValid(target, source)) return target;

  console.log(`[models] downloading ${source.name} (${(source.bytes / 1e6).toFixed(1)} MB)`);
  const res = await fetch(source.url, { redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${source.url} failed: ${res.status}`);
  const tmp = `${target}.part`;
  await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  await rename(tmp, target);
  if (!(await isValid(target, source))) {
    throw new Error(`${source.name}: size or SHA-256 does not match the pinned value`);
  }
  return target;
}

// Minimal CSV parsing that handles quoted fields (taxonomy names contain commas).
function parseCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1);
}

function toObjects(rows) {
  const [header, ...body] = rows;
  const keys = header.map((h) => h.replace(/^﻿/, "").trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

async function buildLabels(labelsCsv, taxonomyCsv) {
  const labels = toObjects(parseCsv(await readFile(labelsCsv, "utf8"), ";"));
  const taxonomy = toObjects(parseCsv(await readFile(taxonomyCsv, "utf8"), ","));
  const bySci = new Map(taxonomy.map((t) => [t.sci_name, t]));

  const classes = [...new Set(labels.map((l) => l.class))];
  const items = labels.map((l, i) => {
    if (Number(l.idx) !== i) throw new Error(`labels out of order at row ${i}`);
    const t = bySci.get(l.sci_name);
    const names = {};
    for (const [locale, column] of Object.entries(LOCALES)) {
      const name = t?.[column]?.trim();
      if (name && name !== l.com_name) names[locale] = name;
    }
    return [l.sci_name, l.com_name, classes.indexOf(l.class), l.order, names];
  });
  return { version: "BirdNET+_V3.0-preview3.1_Global_11K", count: items.length, classes, items };
}

async function main() {
  await mkdir(cacheDir, { recursive: true });
  await mkdir(modelsDir, { recursive: true });
  await mkdir(ortDir, { recursive: true });

  // Optional local mirror (e.g. a slow network): files named as upstream.
  const mirror = process.env.MURMUR_MODEL_SRC_DIR;
  if (mirror) {
    for (const source of Object.values(SOURCES)) {
      const from = path.join(mirror, source.name);
      const to = path.join(cacheDir, source.name);
      if (existsSync(from) && !(await isValid(to, source))) await copyFile(from, to);
    }
  }

  const [modelPath, labelsCsv, taxonomyCsv, vadPath] = await Promise.all([
    download(SOURCES.model),
    download(SOURCES.labels),
    download(SOURCES.taxonomy),
    download(SOURCES.vad),
  ]);

  const modelOut = path.join(modelsDir, MODEL_FILE);
  if (!(await isValid(modelOut, SOURCES.model))) await copyFile(modelPath, modelOut);
  const vadOut = path.join(modelsDir, VAD_FILE);
  if (!(await isValid(vadOut, SOURCES.vad))) await copyFile(vadPath, vadOut);

  const labels = await buildLabels(labelsCsv, taxonomyCsv);
  await writeFile(path.join(modelsDir, LABELS_FILE), JSON.stringify(labels));

  const ortPkg = JSON.parse(await readFile(path.join(root, "node_modules", "onnxruntime-web", "package.json"), "utf8"));
  const ortDist = path.join(root, "node_modules", "onnxruntime-web", "dist");
  for (const file of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) {
    await copyFile(path.join(ortDist, file), path.join(ortDir, file));
  }

  const manifest = {
    model: {
      url: `/models/${MODEL_FILE}`,
      bytes: SOURCES.model.bytes,
      sha256: SOURCES.model.sha256,
      name: "BirdNET+ V3.0 developer preview 3.1 (Global 11K, FP16 pruned)",
      sampleRate: 32_000,
      windowSamples: 96_000,
      license: "CC BY-SA 4.0",
      source: SOURCES.model.url,
    },
    labels: { url: `/models/${LABELS_FILE}`, count: labels.count, locales: Object.keys(LOCALES) },
    vad: { url: `/models/${VAD_FILE}`, bytes: SOURCES.vad.bytes, name: "Silero VAD v5.1.2", license: "MIT", source: SOURCES.vad.url },
    ort: { version: ortPkg.version, wasmPaths: "/ort/" },
  };
  await writeFile(path.join(modelsDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[models] ready: ${labels.count} labels, onnxruntime-web ${ortPkg.version}`);
}

main().catch((err) => {
  console.error(`[models] ${err.message}`);
  process.exit(1);
});
