import { describe, expect, it } from "vitest";
import { decideStatus, type Tally } from "./consensus";

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
