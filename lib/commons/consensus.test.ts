import { describe, expect, it } from "vitest";
import { afterVote, decideStatus, type Tally } from "./consensus";

const t = (over: Partial<Tally>): Tally => ({ recordistVote: null, yes: 0, no: 0, unsure: 0, expertVote: null, ...over });

describe("decideStatus", () => {
  it("starts from the recordist's own check", () => {
    expect(decideStatus(t({}))).toBe("ai-suggested");
    expect(decideStatus(t({ recordistVote: "yes" }))).toBe("confirmed-by-recordist");
    expect(decideStatus(t({ recordistVote: "unsure" }))).toBe("uncertain-by-recordist");
  });

  it("agrees with the recordist plus two listeners", () => {
    expect(decideStatus(t({ recordistVote: "yes", yes: 2 }))).toBe("community-agreed");
    expect(decideStatus(t({ yes: 2 }))).toBe("ai-suggested");
    expect(decideStatus(t({ yes: 3 }))).toBe("community-agreed");
  });

  it("needs a two-thirds majority", () => {
    expect(decideStatus(t({ recordistVote: "yes", yes: 2, no: 2 }))).not.toBe("community-agreed");
    expect(decideStatus(t({ yes: 1, no: 3 }))).toBe("community-rejected");
  });

  it("sends lasting disagreement or doubt to an expert", () => {
    expect(decideStatus(t({ yes: 3, no: 3 }))).toBe("needs-expert");
    expect(decideStatus(t({ unsure: 3 }))).toBe("needs-expert");
  });

  it("lets the expert decide", () => {
    expect(decideStatus(t({ yes: 5, expertVote: "no" }))).toBe("expert-rejected");
    expect(decideStatus(t({ no: 5, expertVote: "yes" }))).toBe("expert-verified");
  });
});

describe("afterVote", () => {
  it("says a vote is counted while the call is still open", () => {
    expect(afterVote("Eurasian Wren", "ai-suggested")).toBe("Thanks. Your vote on the Eurasian Wren is counted; a few more listeners will settle it.");
  });
  it("names the outcome once listeners agree, with the right article", () => {
    expect(afterVote("Eurasian Wren", "community-agreed")).toBe("Thanks. With your vote, listeners agree this is a Eurasian Wren.");
    expect(afterVote("Iberian Tree Frog", "community-rejected")).toBe("Thanks. With your vote, listeners agree this is not an Iberian Tree Frog.");
  });
  it("says when an expert will decide", () => {
    expect(afterVote("Great Tit", "needs-expert")).toContain("an expert will decide");
  });
});

