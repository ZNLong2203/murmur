-- Murmur commons: sessions people chose to share, the calls in them, the
-- 3-second clips others listen to, and everyone's votes. Idempotent.

create table if not exists sessions (
  id uuid primary key,
  created_at timestamptz not null default now(),
  contributor text not null,
  site_code text,
  city_id text,
  lat double precision,
  lon double precision,
  place_label text,
  recorded_on date not null,
  week int,
  duration_s real not null,
  model text not null,
  threshold real not null,
  soundscape jsonb not null,
  source text not null,
  attribution jsonb,
  audio_sha256 text,
  feelings jsonb
);

create table if not exists detections (
  id uuid primary key,
  session_id uuid not null references sessions(id) on delete cascade,
  label_idx int not null,
  sci text not null,
  en text not null,
  class_name text not null,
  max_p real not null,
  start_s real not null,
  end_s real not null,
  clip_start_s real not null,
  clip_url text,
  recordist_vote text,
  status text not null,
  votes_yes int not null default 0,
  votes_no int not null default 0,
  votes_unsure int not null default 0,
  expert_vote text,
  created_at timestamptz not null default now()
);
create index if not exists detections_session on detections (session_id);
create index if not exists detections_status on detections (status);

create table if not exists clips (
  detection_id uuid primary key references detections(id) on delete cascade,
  mime text not null,
  data_b64 text not null
);

create table if not exists votes (
  detection_id uuid not null references detections(id) on delete cascade,
  voter text not null,
  vote text not null,
  expert boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (detection_id, voter)
);
