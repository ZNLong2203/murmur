import { beforeAll, describe, expect, it } from "vitest";
import { getDb, type Db } from "@/lib/db/client";
import { handleFor } from "@/lib/server/identity";
import { encodeWav, toBase64 } from "@/lib/audio/wav";
import { castVote, commonsStats, getClip, nextForVoter, prepareSession, saveSession, sessionsAt, SessionInput } from "./repo";

const ALICE = "alice-token-0123456789abcdefghij";
const BOB = "bob-token-0123456789abcdefghijkl";
const CAROL = "carol-token-0123456789abcdefghij";
const wavB64 = toBase64(encodeWav(new Float32Array(32_000), 32_000));

const session = SessionInput.parse({
  id: "0b5d4e8a-6c1f-4a2b-9d3e-7f6a5b4c3d2e",
  token: ALICE,
  place: { kind: "site", siteCode: "C10" },
  recordedOn: "2026-04-06",
  week: 13,
  durationS: 30,
  model: "BirdNET+ V3.0 preview 3.1",
  threshold: 0.25,
  soundscape: { ndsi: 0.4, audibleShare: 0.8, lifeShare: 0.5, windows: 10 },
  source: "upload",
  audioSha256: null,
  feelings: { joy: 4, serenity: 5 },
  detections: [
    { labelIdx: 2465, maxP: 0.63, startS: 0, endS: 3, clipStartS: 0, clipUrl: null, recordistVote: "yes", clip: { mime: "audio/wav", dataB64: wavB64 } },
    { labelIdx: 5169, maxP: 0.3, startS: 3, endS: 6, clipStartS: 3, clipUrl: null, recordistVote: null, clip: { mime: "audio/wav", dataB64: wavB64 } },
  ],
});

describe("commons repository (PGlite)", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getDb({ memory: true });
    await saveSession(db, prepareSession(session));
  }, 30_000);

  it("stores a session once", async () => {
    expect((await saveSession(db, prepareSession(session))).duplicate).toBe(true);
    expect(await commonsStats(db)).toMatchObject({ sessions: 1, detections: 2 });
  });

  it("derives names, place and contributor on the server", async () => {
    const [row] = await db.query<{ contributor: string; city_id: string; place_label: string }>(`select contributor, city_id, place_label from sessions`);
    expect(row.contributor).toBe(handleFor(ALICE));
    expect(row.city_id).toBe("CO");
    expect(row.place_label).toContain("Arregaça");
    const [dipper] = await db.query<{ sci: string }>(`select sci from detections where label_idx = 2465`);
    expect(dipper.sci).toBe("Cinclus cinclus");
  });

  it("refuses unknown sites, species and malformed clips", () => {
    expect(() => prepareSession({ ...session, place: { kind: "site", siteCode: "ZZ9" } })).toThrow(/Unknown OneAquaHealth site/);
    expect(() => prepareSession({ ...session, detections: [{ ...session.detections[0], labelIdx: 99_999 }] })).toThrow(/Unknown species/);
    expect(() => prepareSession({ ...session, detections: [{ ...session.detections[0], clip: { mime: "audio/wav", dataB64: "UklGRg==" } }] })).toThrow(/Clips/);
  });

  it("never asks the recordist to verify their own calls", async () => {
    expect(await nextForVoter(db, handleFor(ALICE), false)).toBeNull();
    const [dipper] = await db.query<{ id: string }>(`select id from detections where label_idx = 2465`);
    expect(await castVote(db, dipper.id, handleFor(ALICE), "yes", false)).toEqual({ ok: false, reason: "own-call" });
  });

  it("serves other listeners a clip and honours skips", async () => {
    const first = await nextForVoter(db, handleFor(BOB), false);
    expect(first?.clip.url).toMatch(/^\/api\/clips\//);
    const second = await nextForVoter(db, handleFor(BOB), false, [first!.id]);
    expect(second?.id).not.toBe(first!.id);
  });

  it("agrees a call once the recordist and two listeners say yes", async () => {
    const [dipper] = await db.query<{ id: string }>(`select id from detections where label_idx = 2465`);
    expect(await castVote(db, dipper.id, handleFor(BOB), "yes", false)).toEqual({ ok: true, status: "confirmed-by-recordist" });
    expect(await castVote(db, dipper.id, handleFor(CAROL), "yes", false)).toEqual({ ok: true, status: "community-agreed" });
    // Changing one's mind replaces the vote rather than adding one.
    expect(await castVote(db, dipper.id, handleFor(CAROL), "no", false)).toEqual({ ok: true, status: "confirmed-by-recordist" });
  });

  it("keeps a disputed call for the expert, whose verdict is final", async () => {
    const [frog] = await db.query<{ id: string }>(`select id from detections where label_idx = 5169`);
    for (const [i, v] of (["unsure", "unsure", "unsure"] as const).entries()) await castVote(db, frog.id, `anon-listener${i}`, v, false);
    expect((await db.query<{ status: string }>(`select status from detections where id = $1`, [frog.id]))[0].status).toBe("needs-expert");
    expect(await castVote(db, frog.id, "anon-listener9", "yes", false)).toEqual({ ok: false, reason: "closed" });
    expect(await castVote(db, frog.id, "anon-expert01", "yes", true)).toEqual({ ok: true, status: "expert-verified" });
  });

  it("returns stored clip bytes", async () => {
    const [dipper] = await db.query<{ id: string }>(`select id from detections where label_idx = 2465`);
    const clip = await getClip(db, dipper.id);
    expect(Buffer.from(clip!.bytes).toString("ascii", 0, 4)).toBe("RIFF");
  });

  it("summarises sessions at a site", async () => {
    const list = await sessionsAt(db, "C10");
    expect(list).toHaveLength(1);
    expect(list[0].recordedOn).toBe("2026-04-06");
    expect(list[0].detections.map((d) => d.sci)).toEqual(["Cinclus cinclus", "Hyla molleri"]);
    expect(await sessionsAt(db, "O1")).toEqual([]);
  });
});
