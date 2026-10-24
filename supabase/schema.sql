-- Mon-Pad — Supabase schema (off-chain social/metadata layer)
-- =============================================================================
-- The frontend reads token/trade/price data ON-CHAIN (no DB needed for that).
-- Supabase only backs the off-chain extras served by your backend server:
--   token images + socials, comments, profiles, bug reports, image uploads.
--
-- Everything here is keyed by token ADDRESS or WALLET, so it is chain-/version-
-- agnostic: V3 tokens just create new rows. If you already ran a similar schema,
-- you likely need nothing new — this is the reference / fresh-setup version.
--
-- Writes go through your server using the SERVICE ROLE key (which bypasses RLS)
-- after it verifies the wallet signature. The anon key only ever gets reads.
-- =============================================================================

-- 1) Profiles (per wallet) -----------------------------------------------------
create table if not exists profiles (
  wallet        text primary key,          -- lowercase 0x… address
  display_name  text,
  bio           text,
  pfp_url       text,
  created_at    timestamptz not null default now()
);

-- 2) Token metadata (off-chain: image, banner, socials) by token address -------
create table if not exists token_meta (
  address       text primary key,          -- lowercase token contract address
  name          text,
  symbol        text,
  image_url     text,
  banner_url    text,
  description   text,
  twitter       text,
  telegram      text,
  website       text,
  creator       text,                      -- lowercase creator wallet
  created_at    timestamptz not null default now()
);

-- 3) Comments (per token, threaded) -------------------------------------------
create table if not exists comments (
  id            uuid primary key default gen_random_uuid(),
  token_address text not null,
  wallet        text not null,
  text          text not null,
  image_url     text,
  parent_id     uuid references comments(id) on delete cascade,
  created_at    timestamptz not null default now()
);
create index if not exists comments_token_idx on comments (token_address, created_at desc);

-- 4) Bug reports ---------------------------------------------------------------
create table if not exists bug_reports (
  id            uuid primary key default gen_random_uuid(),
  description   text not null,
  contact       text,
  wallet        text,
  status        text not null default 'new',   -- new | triaged | resolved
  notes         text,
  created_at    timestamptz not null default now()
);

-- RLS: public read on safe tables; no public writes (server uses service role) --
alter table profiles    enable row level security;
alter table token_meta  enable row level security;
alter table comments    enable row level security;
alter table bug_reports enable row level security;

create policy "public read profiles"   on profiles   for select using (true);
create policy "public read token_meta" on token_meta for select using (true);
create policy "public read comments"   on comments   for select using (true);
-- bug_reports: intentionally no public read policy (admin-only via service role).

-- 4b) Rewards (points / streaks / referrals) ---------------------------------
create table if not exists rewards (
  wallet        text primary key,
  points        bigint not null default 0,
  streak        int not null default 0,
  last_checkin  date,
  referred_by   text,
  ref_count     int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table rewards enable row level security;
create policy "public read rewards" on rewards for select using (true);
create index if not exists rewards_points_idx on rewards (points desc);

-- 4c) Monshi Studio (AI credits + payments + usage) ----------------------------
create table if not exists studio_accounts (
  wallet      text primary key,
  credits     bigint not null default 0,     -- 1 credit = $0.01 face value
  access      boolean not null default false,
  free_used   int not null default 0,        -- holder free-chat messages used today
  free_date   date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists studio_payments (
  tx_hash     text primary key,              -- prevents replaying the same payment
  wallet      text not null,
  mon         numeric not null,
  kind        text not null,                 -- access | credits
  credits     bigint not null default 0,
  created_at  timestamptz not null default now()
);
create table if not exists studio_usage (
  id          uuid primary key default gen_random_uuid(),
  wallet      text not null,
  mode        text not null,                 -- free | chat | code | image | video
  model       text not null,
  credits     bigint not null default 0,
  created_at  timestamptz not null default now()
);
alter table studio_accounts enable row level security;
alter table studio_payments enable row level security;
alter table studio_usage    enable row level security;
-- no public policies: studio tables are server-only (service role)

-- Atomic credit spend/refund (prevents the concurrent double-spend where N parallel
-- requests all read the same balance and all proceed). The `credits >= p_cost` guard
-- is evaluated under the row lock the UPDATE takes, so only one of K racing spends can
-- win. spend returns the post-debit balance, or NULL when the row is missing or has
-- insufficient credits — the API treats NULL as 402. Refund is a relative +delta (never
-- a stale absolute snapshot), so it can't clobber a concurrent legit debit.
-- ⚠️ MIGRATION: run this in the Supabase SQL editor before deploying the atomic-debit build.
create or replace function studio_spend_credits(p_wallet text, p_cost bigint)
returns bigint
language plpgsql
as $$
declare
  new_credits bigint;
begin
  update studio_accounts
     set credits = credits - p_cost,
         updated_at = now()
   where wallet = p_wallet
     and credits >= p_cost
  returning credits into new_credits;
  return new_credits; -- NULL when no row matched (missing wallet or insufficient credits)
end;
$$;

create or replace function studio_add_credits(p_wallet text, p_amount bigint)
returns bigint
language plpgsql
as $$
declare
  new_credits bigint;
begin
  update studio_accounts
     set credits = credits + p_amount,
         updated_at = now()
   where wallet = p_wallet
  returning credits into new_credits;
  return new_credits;
end;
$$;

-- 4d) Bounties ------------------------------------------------------------------
create table if not exists bounties (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null,
  reward      text not null,                 -- e.g. "5M MONSHI"
  poster      text not null,
  contact     text,                          -- tg handle etc.
  status      text not null default 'open',  -- open | awarded | closed
  claimer     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table bounties enable row level security;
create policy "public read bounties" on bounties for select using (true);

-- 5) Storage bucket for images (token images, banners, pfps, comment images) ---
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

create policy "public read images" on storage.objects
  for select using (bucket_id = 'images');
-- Uploads happen server-side via the service role (POST /api/upload).

-- 4e) Launch-by-chat + living coins ---------------------------------------------
-- ⚠️ MIGRATION: run in the Supabase SQL editor before deploying the launch agent.
create table if not exists launch_characters (
  id             uuid primary key default gen_random_uuid(),
  wallet         text not null,
  token          text,                         -- token address once launched/linked
  source_image   text not null,                -- public https image the 3D model is built from
  stage          text not null default 'model',-- model | rig | ready | failed
  model_task     text,                         -- Meshy image-to-3d task id
  rig_task       text,                         -- Meshy rigging task id
  glb_url        text,                         -- our own stored copy (Meshy links expire)
  rigged         boolean not null default false,
  credits        bigint not null default 0,    -- Monpad credits charged to the user
  meshy_credits  int not null default 0,       -- provider credits we spent (for real-cost tracking)
  refunded       boolean not null default false,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists launch_characters_wallet_idx on launch_characters (wallet, created_at desc);
create index if not exists launch_characters_token_idx on launch_characters (token);
alter table launch_characters enable row level security;
-- no public policies: server-only (service role)

-- 4f) Munchy Kart: player loadouts + milk balance --------------------------------
-- ⚠️ MIGRATION: run in the Supabase SQL editor before deploying /api/game/*.
create table if not exists game_players (
  wallet      text primary key,                 -- lowercase 0x address
  milk        bigint not null default 0 check (milk >= 0),
  loadout     jsonb  not null default '{"car":1,"cars":[1],"inv":{"nitro":0,"shield":0,"magnet":0},"up":{"engine":0,"zap":0,"tires":0}}',
  best        int    not null default 0,
  races       int    not null default 0,
  nonce       bigint not null default 0,         -- bumps on every signed write (replay guard)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table game_players enable row level security;
-- no public policies: server-only (service role)

-- Atomic milk credit/debit (no read-modify-write race). Raises 'insufficient milk' if it would go below 0.
create or replace function game_adjust_milk(p_wallet text, p_delta bigint) returns bigint
language plpgsql security definer as $$
declare v bigint;
begin
  insert into game_players (wallet, milk) values (p_wallet, greatest(p_delta, 0))
    on conflict (wallet) do update set milk = game_players.milk + p_delta, updated_at = now()
    returning milk into v;
  return v;
exception when check_violation then
  raise exception 'insufficient milk';
end $$;
revoke all on function game_adjust_milk(text, bigint) from public, anon, authenticated;

-- 4g) Munchy Kart: race tickets, milk claims, Telegram <-> wallet links -----------
-- ⚠️ MIGRATION: run after 4f.
create table if not exists game_races (
  id          uuid primary key default gen_random_uuid(),
  wallet      text not null,
  seed        bigint not null,
  started_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  milk        bigint
);
create index if not exists game_races_wallet_idx on game_races (wallet, started_at desc);
alter table game_races enable row level security;

create table if not exists game_links (
  tg_id       text primary key,
  wallet      text not null unique,
  created_at  timestamptz not null default now()
);
alter table game_links enable row level security;

create table if not exists game_link_codes (
  code        text primary key,
  tg_id       text not null,
  expires_at  timestamptz not null
);
alter table game_link_codes enable row level security;

-- Claim a finished race once: enforces minimum duration and a per-race milk cap, then credits the wallet.
create or replace function game_claim_race(p_id uuid, p_milk bigint, p_min_secs int, p_max_milk bigint) returns bigint
language plpgsql security definer as $$
declare r game_races; v bigint;
begin
  select * into r from game_races where id = p_id for update;
  if not found then raise exception 'unknown ticket'; end if;
  if r.claimed_at is not null then raise exception 'already claimed'; end if;
  if extract(epoch from (now() - r.started_at)) < p_min_secs then raise exception 'too fast'; end if;
  if p_milk < 0 or p_milk > p_max_milk then raise exception 'milk out of range'; end if;
  update game_races set claimed_at = now(), milk = p_milk where id = p_id;
  return game_adjust_milk(r.wallet, p_milk);
end $$;
revoke all on function game_claim_race(uuid, bigint, int, bigint) from public, anon, authenticated;

-- Save a loadout and charge its cost atomically; the nonce stops replays. Raises 'insufficient milk' / 'nonce changed'.
create or replace function game_save_loadout(p_wallet text, p_nonce bigint, p_loadout jsonb, p_cost bigint) returns game_players
language plpgsql security definer as $$
declare g game_players;
begin
  insert into game_players (wallet) values (p_wallet) on conflict do nothing;
  update game_players set milk = milk - p_cost, loadout = p_loadout, nonce = nonce + 1, updated_at = now()
    where wallet = p_wallet and nonce = p_nonce returning * into g;
  if not found then raise exception 'nonce changed'; end if;
  return g;
exception when check_violation then
  raise exception 'insufficient milk';
end $$;
revoke all on function game_save_loadout(text, bigint, jsonb, bigint) from public, anon, authenticated;
