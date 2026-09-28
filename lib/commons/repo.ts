import "server-only";
import { z } from "zod";
import { loadDemoRecordings } from "@/lib/content";
import type { Db } from "@/lib/db/client";
import { getSite } from "@/lib/oah/data";
import { handleFor, Token } from "@/lib/server/identity";
import { labelCount, serverLabel } from "@/lib/server/labels";
import { isValidClip } from "@/lib/server/wav";
import { decideStatus, OPEN_FOR_COMMUNITY, STATUS_SQL, type CommunityVote, type DetectionStatus } from "./consensus";

// Everything the commons stores goes through these functions. The browser
// sends as little as possible and the server derives the rest: species
// names from the label index, site details from the site code, credits
// from the demo list, the contributor handle from a secret token. Statuses
// are recomputed in SQL from the vote tallies, never taken from a client.

export const MAX_DETECTIONS = 40;
export const MAX_CLIPS = 12;
const MAX_CLIP_B64 = 300_000; // a 3 s mono PCM16 clip at 32 kHz is ~256 kB of base64

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

export const SessionInput = z.object({
  id: z.uuid(),
  token: Token,
  place: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("site"), siteCode: z.string().regex(/^[A-Z]{1,2}\d{1,3}$/) }),
      z.object({
        kind: z.literal("point"),
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        label: z.string().trim().min(1).max(120),
      }),
    ])
    .nullable(),
  recordedOn: z.iso.date().refine((d) => d >= "1990-01-01" && d <= tomorrow(), "recordedOn must be a real, past date"),
  week: z.number().int().min(1).max(48).nullable(),
  durationS: z.number().positive().max(3600),
  model: z.string().max(120),
  threshold: z.number().min(0).max(1),
  soundscape: z.object({
    ndsi: z.number().min(-1).max(1),
    audibleShare: z.number().min(0).max(1),
    lifeShare: z.number().min(0).max(1),
    windows: z.number().int().min(0).max(2_000),
  }),
  source: z.enum(["upload", "public-sample"]),
  audioSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  feelings: z.partialRecord(z.enum(["joy", "serenity", "anger", "fear"]), z.number().int().min(1).max(5)).nullable(),
  detections: z
    .array(
      z.object({
        labelIdx: z.number().int().min(0),
        maxP: z.number().min(0).max(1),
        startS: z.number().min(0).max(3600),
        endS: z.number().min(0).max(3600),
        clipStartS: z.number().min(0).max(3600),
        clipUrl: z.string().max(200).nullable(),
        recordistVote: z.enum(["yes", "unsure"]).nullable(),
        clip: z.object({ mime: z.literal("audio/wav"), dataB64: z.string().max(MAX_CLIP_B64) }).nullable(),
      }),
    )
    .max(MAX_DETECTIONS),
});
export type SessionInput = z.infer<typeof SessionInput>;

export class InvalidSession extends Error {}

interface PreparedSession {
  id: string;
  contributor: string;
  siteCode: string | null;
  cityId: string | null;
  lat: number | null;
  lon: number | null;
  placeLabel: string | null;
  input: SessionInput;
  attribution: { recordist: string; license: string; url: string } | null;
  detections: Array<SessionInput["detections"][number] & { sci: string; en: string; className: string }>;
}

/** Check a share against what the server knows, and derive everything it can. */
export function prepareSession(input: SessionInput): PreparedSession {
  let siteCode: string | null = null;
  let cityId: string | null = null;
  let lat: number | null = null;
  let lon: number | null = null;
  let placeLabel: string | null = null;
  if (input.place?.kind === "site") {
    const site = getSite(input.place.siteCode);
    if (!site) throw new InvalidSession(`Unknown OneAquaHealth site ${input.place.siteCode}`);
    ({ code: siteCode, cityId, lat, lon } = site);
    placeLabel = `${site.code} · ${site.name}, ${site.cityName}`;
  } else if (input.place) {
    lat = Math.round(input.place.lat * 1000) / 1000;
    lon = Math.round(input.place.lon * 1000) / 1000;
    placeLabel = input.place.label;
  }

  let attribution: PreparedSession["attribution"] = null;
  if (input.source === "public-sample") {
    const files = new Set(input.detections.map((d) => d.clipUrl));
    const sample = loadDemoRecordings().find((r) => files.size === 1 && files.has(r.file));
    if (!sample) throw new InvalidSession("A public-sample session must point to one of Murmur's public recordings");
    attribution = { recordist: sample.recordist, license: sample.license, url: sample.sourceUrl };
    if (input.detections.some((d) => d.clip)) throw new InvalidSession("Public recordings are played from their file, not uploaded");
  } else if (input.detections.some((d) => d.clipUrl)) {
    throw new InvalidSession("Uploaded sessions carry their own clips");
  }

  if (input.detections.filter((d) => d.clip).length > MAX_CLIPS) throw new InvalidSession(`At most ${MAX_CLIPS} clips per session`);
  const count = labelCount();
  const detections = input.detections.map((d) => {
    const label = d.labelIdx < count ? serverLabel(d.labelIdx) : null;
    if (!label) throw new InvalidSession(`Unknown species index ${d.labelIdx}`);
    if (d.clip && !isValidClip(d.clip.dataB64)) throw new InvalidSession("Clips must be the 3-second mono WAV Murmur produces");
    if (d.endS < d.startS) throw new InvalidSession("A detection ends before it starts");
    return { ...d, ...label };
  });

  return { id: input.id, contributor: handleFor(input.token), siteCode, cityId, lat, lon, placeLabel, input, attribution, detections };
}

export async function saveSession(db: Db, s: PreparedSession): Promise<{ detections: number; duplicate: boolean }> {
  const [existing] = await db.query(`select 1 from sessions where id = $1`, [s.id]);
  if (existing) return { detections: 0, duplicate: true };
  const i = s.input;
  const queries = [
    {
      text: `insert into sessions (id, contributor, site_code, city_id, lat, lon, place_label, recorded_on, week, duration_s, model, threshold, soundscape, source, attribution, audio_sha256, feelings)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      params: [
        s.id,
        s.contributor,
        s.siteCode,
        s.cityId,
        s.lat,
        s.lon,
        s.placeLabel,
        i.recordedOn,
        i.week,
        i.durationS,
        i.model,
        i.threshold,
        JSON.stringify(i.soundscape),
        i.source,
        s.attribution ? JSON.stringify(s.attribution) : null,
        i.audioSha256,
        i.feelings ? JSON.stringify(i.feelings) : null,
      ] as unknown[],
    },
  ];
  for (const d of s.detections) {
    const id = crypto.randomUUID();
    const status = decideStatus({ recordistVote: d.recordistVote, yes: 0, no: 0, unsure: 0, expertVote: null });
    queries.push({
      text: `insert into detections (id, session_id, label_idx, sci, en, class_name, max_p, start_s, end_s, clip_start_s, clip_url, recordist_vote, status)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      params: [id, s.id, d.labelIdx, d.sci, d.en, d.className, d.maxP, d.startS, d.endS, d.clipStartS, d.clipUrl, d.recordistVote, status],
    });
    if (d.clip) queries.push({ text: `insert into clips (detection_id, mime, data_b64) values ($1,$2,$3)`, params: [id, d.clip.mime, d.clip.dataB64] });
  }
  await db.batch(queries);
  return { detections: s.detections.length, duplicate: false };
}

export interface QueueItem {
  id: string;
  labelIdx: number;
  sci: string;
  en: string;
  className: string;
  maxP: number;
  status: DetectionStatus;
  clip: { url: string; startS: number; durationS: number };
  place: string | null;
  siteCode: string | null;
  recordedOn: string;
  votes: { yes: number; no: number; unsure: number };
}

interface DetectionRow {
  id: string;
  label_idx: number;
  sci: string;
  en: string;
  class_name: string;
  max_p: number;
  status: DetectionStatus;
  clip_start_s: number;
  clip_url: string | null;
  has_clip: boolean;
  place_label: string | null;
  site_code: string | null;
  recorded_on: string;
  votes_yes: number;
  votes_no: number;
  votes_unsure: number;
}

function toItem(r: DetectionRow): QueueItem {
  return {
    id: r.id,
    labelIdx: r.label_idx,
    sci: r.sci,
    en: r.en,
    className: r.class_name,
    maxP: Number(r.max_p),
    status: r.status,
    // A stored clip starts at 0; a public sample is played from its offset.
    clip: r.has_clip ? { url: `/api/clips/${r.id}`, startS: 0, durationS: 3 } : { url: r.clip_url ?? "", startS: Number(r.clip_start_s), durationS: 3 },
    place: r.place_label,
    siteCode: r.site_code,
    recordedOn: r.recorded_on,
    votes: { yes: Number(r.votes_yes), no: Number(r.votes_no), unsure: Number(r.votes_unsure) },
  };
}

const ITEM_SELECT = `select d.id, d.label_idx, d.sci, d.en, d.class_name, d.max_p, d.status, d.clip_start_s, d.clip_url,
  exists(select 1 from clips c where c.detection_id = d.id) as has_clip,
  s.place_label, s.site_code, s.recorded_on::text as recorded_on, d.votes_yes, d.votes_no, d.votes_unsure
  from detections d join sessions s on s.id = d.session_id`;

/**
 * The next call this listener has not voted on, did not record and did not
 * skip. Only a verified expert is served calls waiting for an expert.
 */
export async function nextForVoter(db: Db, voter: string, expert: boolean, skip: string[] = []): Promise<QueueItem | null> {
  const statuses = expert ? ["needs-expert", ...OPEN_FOR_COMMUNITY] : OPEN_FOR_COMMUNITY;
  const rows = await db.query<DetectionRow>(
    `${ITEM_SELECT}
     where d.status = any($1::text[])
       and s.contributor <> $2
       and not (d.id = any($3::uuid[]))
       and (d.clip_url is not null or exists(select 1 from clips c where c.detection_id = d.id))
       and not exists (select 1 from votes v where v.detection_id = d.id and v.voter = $2)
     order by (d.status = 'needs-expert') desc, (d.votes_yes + d.votes_no + d.votes_unsure) asc, random()
     limit 1`,
    [statuses, voter, skip],
  );
  return rows[0] ? toItem(rows[0]) : null;
}

export type VoteResult = { ok: true; status: DetectionStatus } | { ok: false; reason: "not-found" | "own-call" | "closed" };

export async function castVote(db: Db, detectionId: string, voter: string, vote: CommunityVote, expert: boolean): Promise<VoteResult> {
  const [row] = await db.query<{ contributor: string; status: DetectionStatus }>(
    `select s.contributor, d.status from detections d join sessions s on s.id = d.session_id where d.id = $1`,
    [detectionId],
  );
  if (!row) return { ok: false, reason: "not-found" };
  if (row.contributor === voter) return { ok: false, reason: "own-call" };
  if (!expert && row.status === "needs-expert") return { ok: false, reason: "closed" };

  // One transaction: record the vote, recount, and recompute the status in
  // SQL, so concurrent votes cannot leave a stale status behind.
  await db.batch([
    {
      text: `insert into votes (detection_id, voter, vote, expert) values ($1,$2,$3,$4)
             on conflict (detection_id, voter) do update set vote = excluded.vote, expert = excluded.expert, created_at = now()`,
      params: [detectionId, voter, vote, expert],
    },
    {
      text: `update detections d set
               votes_yes = (select count(*) from votes v where v.detection_id = d.id and v.vote = 'yes' and not v.expert),
               votes_no = (select count(*) from votes v where v.detection_id = d.id and v.vote = 'no' and not v.expert),
               votes_unsure = (select count(*) from votes v where v.detection_id = d.id and v.vote = 'unsure' and not v.expert),
               expert_vote = (select v.vote from votes v where v.detection_id = d.id and v.expert and v.vote <> 'unsure' order by v.created_at desc limit 1)
             where d.id = $1`,
      params: [detectionId],
    },
    { text: `update detections set status = ${STATUS_SQL} where id = $1`, params: [detectionId] },
  ]);
  const [after] = await db.query<{ status: DetectionStatus }>(`select status from detections where id = $1`, [detectionId]);
  return { ok: true, status: after.status };
}

export async function getClip(db: Db, detectionId: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const [row] = await db.query<{ mime: string; data_b64: string }>(`select mime, data_b64 from clips where detection_id = $1`, [detectionId]);
  return row ? { mime: row.mime, bytes: Uint8Array.from(Buffer.from(row.data_b64, "base64")) } : null;
}

export interface SiteSessionSummary {
  id: string;
  siteCode: string | null;
  recordedOn: string;
  source: string;
  contributor: string;
  soundscape: { ndsi: number; audibleShare: number; lifeShare: number };
  attribution: { recordist: string; license: string; url: string } | null;
  detections: Array<{ labelIdx: number; sci: string; en: string; className: string; maxP: number; status: DetectionStatus }>;
}

/** Shared sessions at one research site (or all, when siteCode is null), newest shares first. */
export async function sessionsAt(db: Db, siteCode: string | null): Promise<SiteSessionSummary[]> {
  const sessions = await db.query<{ id: string; recorded_on: string; source: string; contributor: string; soundscape: unknown; attribution: unknown; site_code: string | null }>(
    `select id, recorded_on::text as recorded_on, source, contributor, soundscape, attribution, site_code from sessions
     where ($1::text is null or site_code = $1) order by created_at desc limit 500`,
    [siteCode],
  );
  if (sessions.length === 0) return [];
  const dets = await db.query<{ session_id: string; label_idx: number; sci: string; en: string; class_name: string; max_p: number; status: DetectionStatus }>(
    `select session_id, label_idx, sci, en, class_name, max_p, status from detections where session_id = any($1::uuid[]) order by max_p desc`,
    [sessions.map((s) => s.id)],
  );
  const parse = <T,>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;
  return sessions
    .sort((a, b) => b.recorded_on.localeCompare(a.recorded_on))
    .map((s) => ({
      id: s.id,
      siteCode: s.site_code,
      recordedOn: s.recorded_on,
      source: s.source,
      contributor: s.contributor,
      soundscape: parse(s.soundscape),
      attribution: s.attribution ? parse(s.attribution) : null,
      detections: dets
        .filter((d) => d.session_id === s.id)
        .map((d) => ({ labelIdx: d.label_idx, sci: d.sci, en: d.en, className: d.class_name, maxP: Number(d.max_p), status: d.status })),
    }));
}

export async function commonsStats(db: Db) {
  const [row] = await db.query<{ sessions: number; detections: number; votes: number; agreed: number; expert: number }>(
    `select (select count(*) from sessions) as sessions,
            (select count(*) from detections) as detections,
            (select count(*) from votes) as votes,
            (select count(*) from detections where status in ('community-agreed','expert-verified')) as agreed,
            (select count(*) from detections where status = 'needs-expert') as expert`,
  );
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])) as typeof row;
}
