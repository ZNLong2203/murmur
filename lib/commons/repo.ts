import "server-only";
import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { decideStatus, OPEN_FOR_COMMUNITY, type CommunityVote, type DetectionStatus } from "./consensus";

// Everything the commons stores goes through these functions: validated at
// the edge with zod, written with parameterised SQL, statuses recomputed
// from tallies (never trusted from the client).

const MAX_CLIP_B64 = 400_000; // ~290 kB of audio: a 3 s mono 16-bit clip at 24 kHz is 144 kB

export const SessionInput = z.object({
  id: z.uuid(),
  contributor: z.string().regex(/^anon-[a-z0-9-]{4,40}$/i),
  place: z.union([
    z.object({ kind: z.literal("site"), siteCode: z.string().max(12), cityId: z.string().max(4), lat: z.number(), lon: z.number(), label: z.string().max(200) }),
    z.object({ kind: z.literal("point"), lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), label: z.string().max(200) }),
  ]).nullable(),
  recordedOn: z.iso.date(),
  week: z.number().int().min(1).max(48).nullable(),
  durationS: z.number().positive().max(3600),
  model: z.string().max(120),
  threshold: z.number().min(0).max(1),
  soundscape: z.object({ ndsi: z.number(), audibleShare: z.number(), lifeShare: z.number(), windows: z.number().int() }),
  source: z.enum(["upload", "public-sample"]),
  attribution: z.object({ recordist: z.string(), license: z.string(), url: z.url() }).nullable(),
  audioSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  feelings: z.partialRecord(z.enum(["joy", "serenity", "anger", "fear"]), z.number().int().min(1).max(5)).nullable(),
  detections: z
    .array(
      z.object({
        labelIdx: z.number().int().min(0).max(20_000),
        sci: z.string().max(120),
        en: z.string().max(120),
        className: z.string().max(40),
        maxP: z.number().min(0).max(1),
        startS: z.number().min(0),
        endS: z.number().min(0),
        clipStartS: z.number().min(0),
        clipUrl: z.string().startsWith("/samples/").max(200).nullable(),
        recordistVote: z.enum(["yes", "unsure"]).nullable(),
        clip: z.object({ mime: z.literal("audio/wav"), dataB64: z.string().max(MAX_CLIP_B64) }).nullable(),
      }),
    )
    .max(40),
});
export type SessionInput = z.infer<typeof SessionInput>;

export async function saveSession(db: Db, s: SessionInput): Promise<{ detections: number; duplicate: boolean }> {
  const [existing] = await db.query(`select 1 from sessions where id = $1`, [s.id]);
  if (existing) return { detections: 0, duplicate: true };
  const place = s.place;
  const queries = [
    {
      text: `insert into sessions (id, contributor, site_code, city_id, lat, lon, place_label, recorded_on, week, duration_s, model, threshold, soundscape, source, attribution, audio_sha256, feelings)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      params: [
        s.id,
        s.contributor,
        place?.kind === "site" ? place.siteCode : null,
        place?.kind === "site" ? place.cityId : null,
        place ? Math.round(place.lat * 1e4) / 1e4 : null,
        place ? Math.round(place.lon * 1e4) / 1e4 : null,
        place?.label ?? null,
        s.recordedOn,
        s.week,
        s.durationS,
        s.model,
        s.threshold,
        JSON.stringify(s.soundscape),
        s.source,
        s.attribution ? JSON.stringify(s.attribution) : null,
        s.audioSha256,
        s.feelings ? JSON.stringify(s.feelings) : null,
      ],
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
  recorded_on: string | Date;
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
    recordedOn: typeof r.recorded_on === "string" ? r.recorded_on.slice(0, 10) : r.recorded_on.toISOString().slice(0, 10),
    votes: { yes: r.votes_yes, no: r.votes_no, unsure: r.votes_unsure },
  };
}

const ITEM_SELECT = `select d.id, d.label_idx, d.sci, d.en, d.class_name, d.max_p, d.status, d.clip_start_s, d.clip_url,
  exists(select 1 from clips c where c.detection_id = d.id) as has_clip,
  s.place_label, s.site_code, s.recorded_on, d.votes_yes, d.votes_no, d.votes_unsure
  from detections d join sessions s on s.id = d.session_id`;

/** The next call this listener has not voted on and did not record themselves. */
export async function nextForVoter(db: Db, voter: string, expert: boolean): Promise<QueueItem | null> {
  const statuses = expert ? ["needs-expert", ...OPEN_FOR_COMMUNITY] : OPEN_FOR_COMMUNITY;
  const rows = await db.query<DetectionRow>(
    `${ITEM_SELECT}
     where d.status = any($1::text[])
       and s.contributor <> $2
       and (d.clip_url is not null or exists(select 1 from clips c where c.detection_id = d.id))
       and not exists (select 1 from votes v where v.detection_id = d.id and v.voter = $2)
     order by (d.status = 'needs-expert') desc, (d.votes_yes + d.votes_no + d.votes_unsure) asc, random()
     limit 1`,
    [statuses, voter],
  );
  return rows[0] ? toItem(rows[0]) : null;
}

export async function castVote(db: Db, detectionId: string, voter: string, vote: CommunityVote, expert: boolean): Promise<DetectionStatus | null> {
  const [row] = await db.query<{ recordist_vote: "yes" | "unsure" | null; status: DetectionStatus }>(
    `select recordist_vote, status from detections where id = $1`,
    [detectionId],
  );
  if (!row) return null;

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
  ]);

  const [t] = await db.query<{ votes_yes: number; votes_no: number; votes_unsure: number; expert_vote: "yes" | "no" | null }>(
    `select votes_yes, votes_no, votes_unsure, expert_vote from detections where id = $1`,
    [detectionId],
  );
  const status = decideStatus({ recordistVote: row.recordist_vote, yes: Number(t.votes_yes), no: Number(t.votes_no), unsure: Number(t.votes_unsure), expertVote: t.expert_vote });
  await db.query(`update detections set status = $2 where id = $1`, [detectionId, status]);
  return status;
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

/** Shared sessions at one research site (or all, when siteCode is null). */
export async function sessionsAt(db: Db, siteCode: string | null): Promise<SiteSessionSummary[]> {
  const sessions = await db.query<{ id: string; recorded_on: string | Date; source: string; contributor: string; soundscape: unknown; attribution: unknown; site_code: string | null }>(
    `select id, recorded_on, source, contributor, soundscape, attribution, site_code from sessions
     where ($1::text is null or site_code = $1) order by recorded_on desc, created_at desc limit 200`,
    [siteCode],
  );
  if (sessions.length === 0) return [];
  const dets = await db.query<{ session_id: string; label_idx: number; sci: string; en: string; class_name: string; max_p: number; status: DetectionStatus }>(
    `select session_id, label_idx, sci, en, class_name, max_p, status from detections where session_id = any($1::uuid[]) order by max_p desc`,
    [sessions.map((s) => s.id)],
  );
  const parse = <T,>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;
  return sessions.map((s) => ({
    id: s.id,
    siteCode: s.site_code,
    recordedOn: typeof s.recorded_on === "string" ? s.recorded_on.slice(0, 10) : s.recorded_on.toISOString().slice(0, 10),
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
