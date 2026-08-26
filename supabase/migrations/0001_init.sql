-- =====================================================================
-- TradeSNA Web :: initial schema
-- Port of the desktop SQLite schema to Postgres with per-user isolation.
--
-- Design notes:
--  * Every user-owned table is keyed on (user_id, id). This lets us keep
--    the ORIGINAL text ids from a desktop backup verbatim on import --
--    including the legacy literal 'main-account' -- without risking a
--    collision between two users who import the same file.
--  * Date-like columns the app reads/writes are TEXT holding ISO strings,
--    exactly as SQLite stored them. Keeping the wire format identical
--    means zero timezone drift versus the desktop app.
--  * Columns that held JSON-encoded TEXT in SQLite are jsonb here. The
--    client maps them; the backup importer parses the old strings.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- accounts
create table if not exists public.accounts (
  user_id       uuid not null references auth.users(id) on delete cascade,
  id            text not null,
  name          text not null,
  is_aggregated boolean not null default true,
  color         text,
  created_at    timestamptz not null default now(),
  primary key (user_id, id)
);

-- ------------------------------------------------------------------ trades
create table if not exists public.trades (
  user_id                uuid not null references auth.users(id) on delete cascade,
  id                     text not null,
  account_id             text,

  market                 text not null,
  direction              text not null,          -- 'Long' | 'Short'
  entry_date_time        text not null,          -- ISO string
  exit_time              text,                   -- ISO string

  setup                  text,
  entry_trigger          text,
  confluences            jsonb not null default '[]'::jsonb,

  entry_price            double precision,
  exit_price             double precision,
  planned_sl             double precision,
  initial_sl             double precision,       -- static risk anchor
  planned_tp             double precision,
  contracts              integer,

  risk                   double precision,
  pnl                    double precision,
  planned_rr             double precision,
  achieved_r             double precision,
  win                    boolean,
  duration_seconds       double precision,

  mae_price              double precision,
  mfe_price              double precision,

  heat_percent           double precision,
  mfe_r                  double precision,
  mae_r                  double precision,
  profit_capture_percent double precision,

  notes_raw              text,
  notes_clean            text,
  ai_verdict             text,
  emotion_pre            text,
  emotion_post           text,
  tilt_score             integer,

  session                text,
  tags                   jsonb not null default '[]'::jsonb,
  mistakes               jsonb not null default '[]'::jsonb,
  images                 jsonb not null default '[]'::jsonb,
  image_annotations      jsonb not null default '{}'::jsonb,
  video_url              text,
  meta                   jsonb not null default '{}'::jsonb,

  status                 text not null default 'CLOSED',  -- OPEN|CLOSED|SKIPPED

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  primary key (user_id, id),
  foreign key (user_id, account_id)
    references public.accounts(user_id, id) on delete set null
);

create index if not exists idx_trades_user_date
  on public.trades (user_id, entry_date_time desc);
create index if not exists idx_trades_user_market
  on public.trades (user_id, market);
create index if not exists idx_trades_account
  on public.trades (user_id, account_id);

-- --------------------------------------------------------- journal_entries
create table if not exists public.journal_entries (
  user_id    uuid not null references auth.users(id) on delete cascade,
  id         text not null,
  date       text not null,                       -- YYYY-MM-DD
  content    text,
  mood       text,
  tags       jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, date)                          -- one entry per day per user
);

-- ---------------------------------------------------------------- settings
create table if not exists public.settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  key     text not null,
  value   text,
  primary key (user_id, key)
);

-- ------------------------------------------------------------------ quotes
create table if not exists public.quotes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  text       text not null,
  author     text,
  is_custom  boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_quotes_user on public.quotes (user_id, id desc);

-- --------------------------------------------------------- import_profiles
create table if not exists public.import_profiles (
  user_id         uuid not null references auth.users(id) on delete cascade,
  id              text not null,
  name            text not null,
  type            text not null default 'custom',
  column_mappings jsonb not null default '{}'::jsonb,
  date_format     text,
  delimiter       text not null default ',',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, id)
);

-- ---------------------------------------------------------- weekly_reviews
create table if not exists public.weekly_reviews (
  user_id    uuid not null references auth.users(id) on delete cascade,
  id         text not null,                       -- 'YYYY-MM-DD' (Monday)
  week_label text,
  start_date text,
  end_date   text,
  json_data  jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- ------------------------------------------------------------- cot_reports
-- CFTC Commitment of Traders data is public market data, not user data:
-- one shared copy, readable by any signed-in user, written only by the
-- serverless fetcher using the service-role key.
create table if not exists public.cot_reports (
  date       text primary key,                    -- YYYY-MM-DD
  data       jsonb not null,
  fetched_at timestamptz not null default now()
);

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.accounts        enable row level security;
alter table public.trades          enable row level security;
alter table public.journal_entries enable row level security;
alter table public.settings        enable row level security;
alter table public.quotes          enable row level security;
alter table public.import_profiles enable row level security;
alter table public.weekly_reviews  enable row level security;
alter table public.cot_reports     enable row level security;

-- Owner-only access on every user-owned table.
DO LANGUAGE plpgsql $$
declare t text;
begin
  foreach t in array array[
    'accounts','trades','journal_entries','settings',
    'quotes','import_profiles','weekly_reviews'
  ] loop
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format(
      'create policy owner_all on public.%I
         for all
         to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end
$$;

-- COT: readable by any signed-in user; writes go through the service role,
-- which bypasses RLS entirely, so no write policy is defined here.
drop policy if exists cot_read on public.cot_reports;
create policy cot_read on public.cot_reports
  for select to authenticated using (true);

-- =====================================================================
-- New-user bootstrap: give every signup a default account so the app has
-- somewhere to put a first trade. Mirrors the desktop 'Main Account'
-- migration in electron/db/index.ts.
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.accounts (user_id, id, name, is_aggregated, color)
  values (new.id, 'main-account', 'Main Account', true, '#3b82f6')
  on conflict do nothing;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
