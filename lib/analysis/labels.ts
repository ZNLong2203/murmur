"use client";

import type { Label } from "./types";

interface LabelsFile {
  version: string;
  count: number;
  classes: string[];
  items: Array<[sci: string, en: string, classIdx: number, order: string, names: Label["names"]]>;
}

let cache: Promise<Label[]> | null = null;

/** Load the 11,560 model labels (with local-language names) once per page. */
export function loadLabels(url = "/models/labels.v3.json"): Promise<Label[]> {
  cache ??= fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`Labels missing (${res.status})`);
      return res.json() as Promise<LabelsFile>;
    })
    .then((file) =>
      file.items.map(([sci, en, classIdx, order, names], idx) => ({ idx, sci, en, className: file.classes[classIdx], order, names })),
    )
    .catch((err) => {
      cache = null;
      throw err;
    });
  return cache;
}
