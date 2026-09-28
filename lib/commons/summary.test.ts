import { describe, expect, it } from "vitest";
import { rollupBySite, type SessionLike } from "./summary";

const det = (labelIdx: number, status: SessionLike["detections"][number]["status"], maxP = 0.5) => ({
  labelIdx,
  sci: `S${labelIdx}`,
  en: `E${labelIdx}`,
  className: "Aves",
  maxP,
  status,
});

describe("rollupBySite", () => {
  const sessions: SessionLike[] = [
    { siteCode: "C10", recordedOn: "2026-04-01", detections: [det(1, "ai-suggested", 0.4), det(2, "community-rejected")] },
    { siteCode: "C10", recordedOn: "2026-05-01", detections: [det(1, "community-agreed", 0.7), det(3, "confirmed-by-recordist")] },
    { siteCode: null, recordedOn: "2026-05-02", detections: [det(9, "ai-suggested")] },
  ];
  const c10 = rollupBySite(sessions).get("C10")!;

  it("counts sessions and the latest date per site, skipping sessions without a site", () => {
    expect(c10.sessions).toBe(2);
    expect(c10.lastRecordedOn).toBe("2026-05-01");
    expect(rollupBySite(sessions).size).toBe(1);
  });

  it("never counts rejected calls and keeps each species' best status", () => {
    expect(c10.species.map((s) => s.labelIdx)).toEqual([1, 3]);
    expect(c10.species[0]).toMatchObject({ best: "community-agreed", maxP: 0.7, sessions: 2 });
    expect(c10.trusted).toBe(1);
  });
});
