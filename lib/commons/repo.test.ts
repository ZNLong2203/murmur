import { beforeAll, describe, expect, it } from "vitest";
import { getDb, type Db } from "@/lib/db/client";
import { castVote, commonsStats, getClip, nextForVoter, saveSession, sessionsAt, SessionInput } from "./repo";

const session = SessionInput.parse({
  id: "0b5d4e8a-6c1f-4a2b-9d3e-7f6a5b4c3d2e",
  contributor: "anon-alice01",
  place: { kind: "site", siteCode: "C10", cityId: "CO", lat: 40.19776, lon: -8.41773, label: "C10 · Arregaça, Coimbra" },
  recordedOn: "2026-04-06",
  week: 13,
  durationS: 30,
  model: "BirdNET+ V3.0 preview 3.1",
  threshold: 0.25,
  soundscape: { ndsi: 0.4, audibleShare: 0.8, lifeShare: 0.5, windows: 10 },
  source: "upload",
  attribution: null,
  audioSha256: null,
  feelings: { joy: 4, serenity: 5 },
  detections: [
    { labelIdx: 2465, sci: "Cinclus cinclus", en: "White-throated Dipper", className: "Aves", maxP: 0.63, startS: 0, endS: 3, clipStartS: 0, clipUrl: null, recordistVote: "yes", clip: { mime: "audio/wav", dataB64: Buffer.from("RIFF-test").toString("base64") } },
    { labelIdx: 10, sci: "Hyla molleri", en: "Iberian Tree Frog", className: "Amphibia", maxP: 0.3, startS: 3, endS: 6, clipStartS: 3, clipUrl: "/samples/x.mp3", recordistVote: null, clip: null },
  ],
});

describe("commons repository (PGlite)", () => {
  let db: Db;
  beforeAll(async () => {
    db = await getDb({ memory: true });
    await saveSession(db, session);
  }, 30_000);

  it("stores a session once", async () => {
    expect((await saveSession(db, session)).duplicate).toBe(true);
    expect(await commonsStats(db)).toMatchObject({ sessions: 1, detections: 2 });
  });

  it("never asks the recordist to verify their own calls", async () => {
    expect(await nextForVoter(db, "anon-alice01", false)).toBeNull();
  });

  it("serves other listeners a clip, stored or offset into a public sample", async () => {
    const item = await nextForVoter(db, "anon-bob0001", false);
    expect(item).not.toBeNull();
    expect(item!.clip.url === "/samples/x.mp3" ? item!.clip.startS : 0).toBe(item!.clip.url === "/samples/x.mp3" ? 3 : 0);
  });

  it("agrees a call once the recordist and two listeners say yes", async () => {
    const [dipper] = await db.query<{ id: string }>(`select id from detections where label_idx = 2465`);
    expect(await castVote(db, dipper.id, "anon-bob0001", "yes", false)).toBe("confirmed-by-recordist");
    expect(await castVote(db, dipper.id, "anon-carol001", "yes", false)).toBe("community-agreed");
    // Changing one's mind replaces the vote rather than adding one.
    expect(await castVote(db, dipper.id, "anon-carol001", "no", false)).toBe("confirmed-by-recordist");
  });

  it("returns stored clip bytes", async () => {
    const [dipper] = await db.query<{ id: string }>(`select id from detections where label_idx = 2465`);
    const clip = await getClip(db, dipper.id);
    expect(Buffer.from(clip!.bytes).toString()).toBe("RIFF-test");
  });

  it("summarises sessions at a site", async () => {
    const list = await sessionsAt(db, "C10");
    expect(list).toHaveLength(1);
    expect(list[0].detections.map((d) => d.sci)).toEqual(["Cinclus cinclus", "Hyla molleri"]);
    expect(await sessionsAt(db, "O1")).toEqual([]);
  });
});
