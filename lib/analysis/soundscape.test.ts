import { describe, expect, it } from "vitest";
import type { EcologyEntry } from "./ecology";
import { ndsiWords, summarizeSoundscape } from "./soundscape";
import { withArticle } from "./taxa";
import type { Label, SpeciesSummary, WindowScores } from "./types";

const label = (idx: number, className: string): Label => ({ idx, sci: `S${idx}`, en: `E${idx}`, className, order: "", names: {} });
const labels = [label(0, "Aves"), label(1, "Amphibia"), label(2, "Insecta")];

const w = (index: number, audibilityDb: number, ndsi: number, realS = 3): WindowScores => ({
  index,
  startS: index * 3,
  endS: index * 3 + 3,
  realS,
  scores: [],
  features: { levelDbfs: -30, audibilityDb, ndsi },
});

const species: SpeciesSummary[] = [
  { labelIdx: 0, maxP: 0.9, windows: 2, detections: [{ labelIdx: 0, startS: 0, endS: 6, maxP: 0.9, bestWindow: 0 }] },
  { labelIdx: 2, maxP: 0.4, windows: 1, detections: [{ labelIdx: 2, startS: 9, endS: 12, maxP: 0.4, bestWindow: 3 }] },
];

const ecology = new Map<number, EcologyEntry>([
  [0, { sci: "S0", labelIdx: 0, en: "E0", tags: ["clean-water", "insect-eater"], meaning: "", sources: [], needsReview: false }],
]);

describe("summarizeSoundscape", () => {
  const s = summarizeSoundscape([w(0, 12, 0.6), w(1, 2, -0.2), w(2, 8, 0.1), w(3, 1, -0.9)], species, labels, ecology, 6);

  it("counts audible windows against the threshold", () => {
    expect(s.audibleShare).toBe(0.5);
  });

  it("weights NDSI by real audio length and words it", () => {
    expect(s.ndsi).toBeCloseTo((0.6 - 0.2 + 0.1 - 0.9) / 4, 6);
    expect(s.ndsiWords).toBe("Mixed, human noise ahead");
  });

  it("counts life only for birds and amphibians", () => {
    expect(s.lifeShare).toBe(0.5); // windows 0 and 1, not the insect's window 3
    expect(s.byGroup).toMatchObject({ bird: 1, insect: 1, amphibian: 0 });
  });

  it("surfaces habitat indicators and insect eaters from the ecology table", () => {
    expect(s.indicators).toEqual([{ labelIdx: 0, tags: ["clean-water"] }]);
    expect(s.insectEaters).toBe(1);
    expect(s.nonNative).toBe(0);
  });
});

describe("ndsiWords", () => {
  it("covers the scale", () => {
    expect(ndsiWords(0.8)).toBe("Mostly nature");
    expect(ndsiWords(-0.8)).toBe("Mostly human noise");
  });
});


describe("withArticle", () => {
  it("chooses a or an by sound", () => {
    expect(withArticle("Eurasian Wren")).toBe("a Eurasian Wren");
    expect(withArticle("Iberian Tree Frog")).toBe("an Iberian Tree Frog");
    expect(withArticle("European Robin")).toBe("a European Robin");
    expect(withArticle("Icterine Warbler")).toBe("an Icterine Warbler");
    expect(withArticle("Common Moorhen")).toBe("a Common Moorhen");
    expect(withArticle("Egyptian Goose")).toBe("an Egyptian Goose");
  });
});
