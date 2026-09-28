"use client";

import { useState } from "react";
import { Button, Card, CardTitle } from "@/components/ui/primitives";
import type { Place } from "@/lib/analysis/session";
import type { SoundscapeSummary } from "@/lib/analysis/soundscape";
import type { Label, SpeciesSummary } from "@/lib/analysis/types";
import { buildDwcCsv } from "@/lib/interop/dwc";
import { buildFhirBundle, type Verification } from "@/lib/interop/fhir";
import type { Vote } from "./ResultsView";

export interface ExportInput {
  sessionId: string;
  name: string;
  place: Place | null;
  date: string;
  species: SpeciesSummary[];
  votes: Record<number, Vote>;
  labels: Label[];
  soundscape: SoundscapeSummary;
  audioSha256: string | null;
  threshold: number;
  rangeNote: string;
}

const MODEL = { id: "birdnet-v3.0-p3.1-fp16-pruned", name: "BirdNET+ V3.0 developer preview 3.1", version: "3.0-preview3.1", license: "CC BY-SA 4.0" };

/** A stable pseudonym per browser, so a contributor's records can be grouped without an account. */
export function contributorId(): string {
  const key = "murmur-contributor";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = `anon-${crypto.randomUUID().slice(0, 8)}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return "anon-session";
  }
}

export function verificationFromVotes(votes: Record<number, Vote>): Record<number, Verification> {
  const out: Record<number, Verification> = {};
  for (const [idx, v] of Object.entries(votes)) {
    if (v === "yes") out[Number(idx)] = "confirmed-by-recordist";
    else if (v === "unsure") out[Number(idx)] = "uncertain-by-recordist";
  }
  return out;
}

let gbifCache: Promise<Record<number, { key: number; kingdom?: string; class?: string }>> | null = null;
function loadGbif() {
  gbifCache ??= fetch("/api/species/gbif")
    .then((r) => (r.ok ? r.json() : { byLabelIdx: {} }))
    .then((j) => j.byLabelIdx ?? {})
    .catch(() => ({}));
  return gbifCache;
}

function download(filename: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportCard(input: ExportInput) {
  const [busy, setBusy] = useState<"fhir" | "dwc" | null>(null);
  // Suggestions the recordist rejected never leave the page.
  const kept = input.species.filter((s) => input.votes[s.labelIdx] !== "no");
  const rejected = input.species.length - kept.length;
  const unchecked = kept.filter((s) => !input.votes[s.labelIdx]).length;
  const stem = `murmur-${input.place?.kind === "site" ? input.place.site.code : "recording"}-${input.date}`;
  const method = `Passive acoustic recording analysed in the browser with ${MODEL.name}: 3 s windows, score threshold ${input.threshold}, ${input.rangeNote}. Each suggestion was offered to the recordist with its 3 s clip for confirmation by ear.`;

  async function exportFhir() {
    setBusy("fhir");
    const bundle = buildFhirBundle({
      sessionId: input.sessionId,
      place: input.place,
      recordedAt: input.date,
      contributor: contributorId(),
      species: kept,
      verification: verificationFromVotes(input.votes),
      labels: input.labels,
      gbif: await loadGbif(),
      soundscape: input.soundscape,
      model: MODEL,
      method,
      audioSha256: input.audioSha256,
    });
    download(`${stem}.fhir.json`, "application/fhir+json", JSON.stringify(bundle, null, 2));
    setBusy(null);
  }

  async function exportDwc() {
    setBusy("dwc");
    const csv = buildDwcCsv({
      sessionId: input.sessionId,
      place: input.place,
      recordedAt: input.date,
      contributor: contributorId(),
      species: kept,
      verification: verificationFromVotes(input.votes),
      labels: input.labels,
      gbif: await loadGbif(),
      modelName: MODEL.name,
      samplingProtocol: method,
    });
    download(`${stem}.dwc.csv`, "text/csv", csv);
    setBusy(null);
  }

  return (
    <Card>
      <CardTitle hint="Standard formats other systems can read. Nothing leaves this page unless you download it.">Take it further</CardTitle>
      <p className="text-sm text-ink-2">
        {kept.length} species will be included
        {rejected > 0 && `, ${rejected} you rejected will not`}
        {unchecked > 0 && `. ${unchecked} not yet checked by ear are marked as AI suggestions`}.
      </p>
      <div className="mt-3 grid gap-2">
        <Button variant="secondary" onClick={exportFhir} disabled={busy !== null} data-testid="export-fhir">
          {busy === "fhir" ? "Preparing…" : "FHIR R4 bundle · OneAquaHealth IG"}
        </Button>
        <Button variant="secondary" onClick={exportDwc} disabled={busy !== null} data-testid="export-dwc">
          {busy === "dwc" ? "Preparing…" : "Darwin Core CSV · GBIF-ready"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">
        The FHIR bundle codes birds and amphibians with the OneAquaHealth IG concepts, links each species to GBIF, and records in a Provenance who suggested it (the model) and who confirmed it (you). The recording is identified only by its SHA-256 fingerprint.
      </p>
    </Card>
  );
}
