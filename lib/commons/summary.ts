import type { DetectionStatus } from "./consensus";

// Roll shared sessions up per research site for the map and site pages.
// Rejected calls never count; agreed or expert-verified ones are "trusted".

export interface SessionLike {
  siteCode: string | null;
  recordedOn: string;
  detections: Array<{ labelIdx: number; sci: string; en: string; className: string; maxP: number; status: DetectionStatus }>;
}

export interface SpeciesAtSite {
  labelIdx: number;
  sci: string;
  en: string;
  className: string;
  maxP: number;
  best: DetectionStatus;
  sessions: number;
}

export interface SiteRollup {
  siteCode: string;
  sessions: number;
  lastRecordedOn: string;
  species: SpeciesAtSite[];
  trusted: number;
}

const REJECTED: DetectionStatus[] = ["community-rejected", "expert-rejected"];
const TRUSTED: DetectionStatus[] = ["community-agreed", "expert-verified"];
const RANK: DetectionStatus[] = [
  "expert-verified",
  "community-agreed",
  "confirmed-by-recordist",
  "needs-expert",
  "uncertain-by-recordist",
  "ai-suggested",
  "community-rejected",
  "expert-rejected",
];

export function isTrusted(status: DetectionStatus) {
  return TRUSTED.includes(status);
}

export function rollupBySite(sessions: SessionLike[]): Map<string, SiteRollup> {
  const out = new Map<string, SiteRollup>();
  for (const s of sessions) {
    if (!s.siteCode) continue;
    const site = out.get(s.siteCode) ?? { siteCode: s.siteCode, sessions: 0, lastRecordedOn: s.recordedOn, species: [], trusted: 0 };
    site.sessions++;
    if (s.recordedOn > site.lastRecordedOn) site.lastRecordedOn = s.recordedOn;
    for (const d of s.detections) {
      if (REJECTED.includes(d.status)) continue;
      const existing = site.species.find((x) => x.labelIdx === d.labelIdx);
      if (existing) {
        existing.sessions++;
        existing.maxP = Math.max(existing.maxP, d.maxP);
        if (RANK.indexOf(d.status) < RANK.indexOf(existing.best)) existing.best = d.status;
      } else {
        site.species.push({ labelIdx: d.labelIdx, sci: d.sci, en: d.en, className: d.className, maxP: d.maxP, best: d.status, sessions: 1 });
      }
    }
    site.species.sort((a, b) => RANK.indexOf(a.best) - RANK.indexOf(b.best) || b.maxP - a.maxP);
    site.trusted = site.species.filter((x) => isTrusted(x.best)).length;
    out.set(s.siteCode, site);
  }
  return out;
}
