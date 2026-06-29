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

-- 5) Storage bucket for images (token images, banners, pfps, comment images) ---
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do nothing;

create policy "public read images" on storage.objects
  for select using (bucket_id = 'images');
-- Uploads happen server-side via the service role (POST /api/upload).
