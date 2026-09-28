// How a suggested call becomes trusted. The recordist's own "yes" counts as
// one vote, as an observer's identification does on iNaturalist. A call is
// agreed or rejected by at least three votes and a two-thirds majority;
// persistent disagreement or doubt sends it to an expert, whose decision is
// final. Every state is a label people can read.

export type DetectionStatus =
  | "ai-suggested"
  | "confirmed-by-recordist"
  | "uncertain-by-recordist"
  | "community-agreed"
  | "community-rejected"
  | "needs-expert"
  | "expert-verified"
  | "expert-rejected";

export type CommunityVote = "yes" | "no" | "unsure";

export interface Tally {
  recordistVote: "yes" | "unsure" | null;
  yes: number;
  no: number;
  unsure: number;
  expertVote: "yes" | "no" | null;
  /** Once a call is waiting for an expert, only the expert can move it. */
  previous?: DetectionStatus;
}

export const MIN_VOTES = 3;
export const MAJORITY = 2 / 3;
export const EXPERT_AFTER = 6;

export function decideStatus(t: Tally): DetectionStatus {
  if (t.expertVote === "yes") return "expert-verified";
  if (t.expertVote === "no") return "expert-rejected";
  if (t.previous === "needs-expert") return "needs-expert";

  const yes = t.yes + (t.recordistVote === "yes" ? 1 : 0);
  const decided = yes + t.no;
  if (yes >= MIN_VOTES && yes / decided >= MAJORITY) return "community-agreed";
  if (t.no >= MIN_VOTES && t.no / decided >= MAJORITY) return "community-rejected";
  if (t.yes + t.no + t.unsure >= EXPERT_AFTER || t.unsure >= MIN_VOTES) return "needs-expert";

  if (t.recordistVote === "yes") return "confirmed-by-recordist";
  if (t.recordistVote === "unsure") return "uncertain-by-recordist";
  return "ai-suggested";
}

export const STATUS_LABEL: Record<DetectionStatus, { label: string; tone: "good" | "neutral" | "caution" | "bad" }> = {
  "ai-suggested": { label: "AI suggestion", tone: "neutral" },
  "confirmed-by-recordist": { label: "Confirmed by the recordist", tone: "good" },
  "uncertain-by-recordist": { label: "Recordist unsure", tone: "caution" },
  "community-agreed": { label: "Community agreed", tone: "good" },
  "community-rejected": { label: "Community rejected", tone: "bad" },
  "needs-expert": { label: "Waiting for an expert", tone: "caution" },
  "expert-verified": { label: "Expert verified", tone: "good" },
  "expert-rejected": { label: "Expert rejected", tone: "bad" },
};

/** Statuses that still want votes from the community queue. */
export const OPEN_FOR_COMMUNITY: DetectionStatus[] = ["ai-suggested", "confirmed-by-recordist", "uncertain-by-recordist"];

/**
 * The same rules as decideStatus, as one SQL expression over a detections
 * row, so the status is recomputed inside the transaction that records the
 * vote. lib/commons/repo.test.ts checks the two agree.
 */
export const STATUS_SQL = `case
  when expert_vote = 'yes' then 'expert-verified'
  when expert_vote = 'no' then 'expert-rejected'
  when status = 'needs-expert' then 'needs-expert'
  when votes_yes + (case when recordist_vote = 'yes' then 1 else 0 end) >= ${MIN_VOTES}
   and 3 * (votes_yes + (case when recordist_vote = 'yes' then 1 else 0 end))
       >= 2 * (votes_yes + (case when recordist_vote = 'yes' then 1 else 0 end) + votes_no) then 'community-agreed'
  when votes_no >= ${MIN_VOTES}
   and 3 * votes_no >= 2 * (votes_yes + (case when recordist_vote = 'yes' then 1 else 0 end) + votes_no) then 'community-rejected'
  when votes_yes + votes_no + votes_unsure >= ${EXPERT_AFTER} or votes_unsure >= ${MIN_VOTES} then 'needs-expert'
  when recordist_vote = 'yes' then 'confirmed-by-recordist'
  when recordist_vote = 'unsure' then 'uncertain-by-recordist'
  else 'ai-suggested'
end`;
