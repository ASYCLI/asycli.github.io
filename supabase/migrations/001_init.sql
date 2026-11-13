-- ASYCLI core schema. All tables are deny-all under RLS: every read/write
-- goes through the `api` / `stripe-webhook` Edge Functions, which enforce
-- ownership and admin checks server-side.

create extension if not exists pgcrypto;

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.admins (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email text not null check (email = lower(email)),
  name text,
  phone text,
  stripe_customer_id text unique,
  notes text,
  created_at timestamptz not null default now()
);
create unique index customers_email_key on public.customers (email);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  address text not null,
  zip text,
  lat double precision,
  lng double precision,
  drive_minutes numeric,
  drive_source text, -- 'census+estimate' | 'manual' | 'unknown'
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index properties_customer_idx on public.properties (customer_id);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  manage_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  customer_id uuid not null references public.customers(id) on delete restrict,
  property_id uuid references public.properties(id) on delete set null,
  service text not null check (service in ('spring','summer','fall','winter')),
  kind text not null default 'one_time' check (kind in ('one_time','quote','storm_visit','manual')),
  status text not null check (status in ('quote_requested','pending_review','approved','pending_payment','confirmed','in_progress','completed','cancelled','expired')),
  service_date date,
  time_window text check (time_window in ('am','pm','storm')),
  est_hours numeric,
  block_hours numeric not null default 0,
  inputs jsonb not null default '{}',
  quote jsonb, -- customer-facing snapshot (never recomputed at checkout)
  subtotal_cents integer,
  tax_cents integer,
  total_cents integer,
  deposit_cents integer,
  paid_cents integer not null default 0,
  refunded_cents integer not null default 0,
  hold_until timestamptz,
  checkout_session_id text,
  needs_review boolean not null default false,
  review_reasons text[] not null default '{}',
  access_notes text,
  customer_notes text,
  internal_notes text,
  photos text[] not null default '{}',
  after_photos text[] not null default '{}',
  weather_flag text,
  assigned_to text,
  consent jsonb,
  cancel_requested_at timestamptz,
  reschedule_request text,
  reminder_sent_at timestamptz,
  review_requested_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookings_slot_idx on public.bookings (service_date, time_window) where status not in ('cancelled','expired');
create index bookings_customer_idx on public.bookings (customer_id);
create index bookings_status_idx on public.bookings (status);

create table public.booking_costs (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  internal jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.availability (
  date date not null,
  time_window text not null check (time_window in ('am','pm')),
  capacity_hours numeric,
  blocked boolean not null default false,
  note text,
  primary key (date, time_window)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  property_id uuid references public.properties(id) on delete set null,
  service text not null check (service in ('spring','summer','fall','winter')),
  tier text not null,
  status text not null default 'incomplete',
  stripe_subscription_id text unique,
  checkout_session_id text unique,
  monthly_cents integer not null,
  current_period_end timestamptz,
  cancel_at timestamptz,
  cancel_at_period_end boolean not null default false,
  consent jsonb not null,
  storm_visits_used jsonb not null default '{}', -- { "2026-12": 1 }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memberships_customer_idx on public.memberships (customer_id);
create index memberships_status_idx on public.memberships (service, status);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  membership_id uuid references public.memberships(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  stripe_object_id text unique, -- payment_intent or invoice id
  kind text not null check (kind in ('deposit','balance','full','subscription','storm_visit','manual')),
  method text not null default 'card' check (method in ('card','cash','check','other')),
  amount_cents integer not null,
  fee_cents integer,
  refunded_cents integer not null default 0,
  status text not null,
  receipt_url text,
  note text,
  created_at timestamptz not null default now()
);
create index payments_created_idx on public.payments (created_at desc);
create index payments_customer_idx on public.payments (customer_id);

create table public.webhook_events (
  id text primary key,
  type text not null,
  status text not null default 'processing' check (status in ('processing','done','failed')),
  attempts integer not null default 1,
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  template text not null,
  subject text not null,
  body_html text not null,
  status text not null default 'queued' check (status in ('queued','accepted','failed','skipped')),
  provider_id text,
  error text,
  booking_id uuid references public.bookings(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notifications_status_idx on public.notifications (status, created_at);

create table public.gallery (
  id uuid primary key default gen_random_uuid(),
  before_path text not null,
  after_path text not null,
  service text not null check (service in ('spring','summer','fall','winter')),
  location text,
  completed_on date,
  caption text,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid unique references public.bookings(id) on delete set null,
  name text not null,
  town text,
  rating integer not null check (rating between 1 and 5),
  body text not null,
  status text not null default 'pending' check (status in ('pending','approved','hidden')),
  created_at timestamptz not null default now()
);

create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);

create table public.error_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  source text not null,
  message text not null,
  detail jsonb
);

create table public.geocode_cache (
  address_key text primary key,
  lat double precision,
  lng double precision,
  matched text,
  zip text,
  created_at timestamptz not null default now()
);

-- Deny-all RLS on everything (service role bypasses RLS)
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
create trigger bookings_touch before update on public.bookings for each row execute function public.touch_updated_at();
create trigger memberships_touch before update on public.memberships for each row execute function public.touch_updated_at();

-- Atomic slot reservation: one transaction-scoped lock per date+window.
create or replace function public.reserve_slot(p_booking uuid, p_date date, p_window text, p_hours numeric, p_default_capacity numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cap numeric;
  blk boolean;
  used numeric;
begin
  perform pg_advisory_xact_lock(hashtext('slot:' || p_date::text || ':' || p_window));
  select capacity_hours, blocked into cap, blk from availability where date = p_date and time_window = p_window;
  if coalesce(blk, false) then return false; end if;
  cap := coalesce(cap, p_default_capacity);
  select coalesce(sum(block_hours), 0) into used
    from bookings
   where service_date = p_date and time_window = p_window and id <> p_booking
     and (status in ('approved','confirmed','in_progress','completed')
          or (status = 'pending_payment' and hold_until > now())
          or (status = 'pending_review' and service_date is not null));
  if used + p_hours > cap then return false; end if;
  update bookings set service_date = p_date, time_window = p_window, block_hours = p_hours where id = p_booking;
  return true;
end $$;

create or replace function public.slot_usage(p_from date, p_to date)
returns table (date date, time_window text, used numeric)
language sql stable security definer set search_path = public as $$
  select service_date, time_window, coalesce(sum(block_hours), 0)
    from bookings
   where service_date between p_from and p_to and time_window in ('am','pm')
     and (status in ('approved','confirmed','in_progress','completed')
          or (status = 'pending_payment' and hold_until > now())
          or (status = 'pending_review' and service_date is not null))
   group by 1, 2
$$;

-- Simple fixed-window rate limiter
create or replace function public.hit_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql security definer set search_path = public as $$
declare r rate_limits;
begin
  insert into rate_limits(key, window_start, count) values (p_key, now(), 1)
  on conflict (key) do update
    set count = case when rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then 1 else rate_limits.count + 1 end,
        window_start = case when rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then now() else rate_limits.window_start end
  returning * into r;
  return r.count <= p_max;
end $$;

revoke execute on function public.reserve_slot(uuid, date, text, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.slot_usage(date, date) from public, anon, authenticated;
revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;

insert into public.admins(email) values ('asyclongisland@gmail.com');

create index payments_booking_idx on public.payments (booking_id);
create index payments_membership_idx on public.payments (membership_id);
create index bookings_property_idx on public.bookings (property_id);
create index memberships_property_idx on public.memberships (property_id);
create index notifications_booking_idx on public.notifications (booking_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 8388608, array['image/jpeg','image/png','image/webp','image/heic']),
       ('gallery', 'gallery', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
