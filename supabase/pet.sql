-- Tamagotchi Monshi: MONSHI-paid premium items and web-push reminders. Server-only tables (service role).
create table if not exists public.pet_purchases (
  id uuid primary key default gen_random_uuid(),
  wallet text not null,
  item text not null,
  tx_hash text not null unique,
  amount_monshi numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists pet_purchases_wallet_idx on public.pet_purchases (lower(wallet));
alter table public.pet_purchases enable row level security;

create table if not exists public.pet_push_subs (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  remind_at timestamptz,
  reason text,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pet_push_due_idx on public.pet_push_subs (remind_at);
alter table public.pet_push_subs enable row level security;
