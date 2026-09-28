import type { Metadata } from "next";
import { AnalyzeWorkbench } from "@/components/analyze/AnalyzeWorkbench";
import { loadDemoRecordings, loadEcology, AUDIBILITY_THRESHOLD_DB } from "@/lib/content";
import { getLabSummary, getSite, sites } from "@/lib/oah/data";
import type { LabSummary } from "@/lib/oah/types";

export const metadata: Metadata = {
  title: "Listen to a stream",
  description: "Name the birds and frogs in a stream recording, measure water and traffic noise, and confirm each call by ear. Runs in your browser.",
};

export default async function AnalyzePage({ searchParams }: PageProps<"/analyze">) {
  const { site } = await searchParams;
  const initialSite = typeof site === "string" ? (getSite(site) ?? null) : null;
  const labs: Record<string, LabSummary> = {};
  for (const site of sites) {
    const lab = getLabSummary(site.code);
    if (lab) labs[site.code] = lab;
  }
  return (
    <AnalyzeWorkbench
      sites={sites}
      samples={loadDemoRecordings()}
      labs={labs}
      ecology={loadEcology()}
      audibilityThresholdDb={AUDIBILITY_THRESHOLD_DB}
      initialSite={initialSite}
    />
  );
}
