-- RecieptsGen schema: profiles, free export quota, cloud documents, templates,
-- recurring invoices and payments. Plan changes only happen server side.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  pro_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.export_claims (
  user_id uuid not null references auth.users (id) on delete cascade,
  doc_id text not null,
  doc_type text not null check (doc_type in ('invoice', 'receipt')),
  created_at timestamptz not null default now(),
  primary key (user_id, doc_id)
);

create table if not exists public.documents (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.templates (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.recurring (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  doc jsonb not null,
  every text not null check (every in ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_run date not null,
  send_email boolean not null default false,
  active boolean not null default true,
  runs integer not null default 0,
  last_run timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  tx_ref text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  amount numeric not null,
  currency text not null default 'NGN',
  status text not null default 'pending',
  flw_id text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create table if not exists public.email_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  recipient text not null,
  doc_id text,
  created_at timestamptz not null default now()
);

create index if not exists email_log_user_time on public.email_log (user_id, created_at);
create index if not exists recurring_due on public.recurring (next_run) where active;

-- ---------- helpers ----------
create or replace function public.is_pro(uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select pro_until > now() from public.profiles where id = uid), false);
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Free users get 2 receipts and 1 invoice exported without the footer line.
create or replace function public.quota_status()
returns json
language plpgsql stable security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r int; i int; until timestamptz;
begin
  if uid is null then return json_build_object('signed_in', false); end if;
  select pro_until into until from public.profiles where id = uid;
  select count(*) filter (where doc_type = 'receipt'), count(*) filter (where doc_type = 'invoice')
    into r, i from public.export_claims where user_id = uid;
  return json_build_object(
    'signed_in', true,
    'pro', coalesce(until > now(), false),
    'pro_until', until,
    'receipts_left', greatest(0, 2 - r),
    'invoices_left', greatest(0, 1 - i),
    'claimed', coalesce((select json_agg(doc_id) from public.export_claims where user_id = uid), '[]'::json)
  );
end;
$$;

create or replace function public.claim_clean_export(p_doc_id text, p_type text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  used int; lim int;
begin
  if uid is null then return json_build_object('allowed', false, 'reason', 'signin'); end if;
  if p_type not in ('invoice', 'receipt') then raise exception 'bad type'; end if;
  if public.is_pro(uid) then return json_build_object('allowed', true, 'pro', true); end if;
  if exists (select 1 from public.export_claims where user_id = uid and doc_id = p_doc_id) then
    return json_build_object('allowed', true, 'again', true);
  end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  lim := case when p_type = 'receipt' then 2 else 1 end;
  select count(*) into used from public.export_claims where user_id = uid and doc_type = p_type;
  if used >= lim then return json_build_object('allowed', false, 'reason', 'quota'); end if;
  insert into public.export_claims (user_id, doc_id, doc_type) values (uid, left(p_doc_id, 64), p_type);
  return json_build_object('allowed', true, 'left', lim - used - 1);
end;
$$;

revoke all on function public.claim_clean_export(text, text) from public, anon;
revoke all on function public.quota_status() from public, anon;
revoke all on function public.is_pro(uuid) from public, anon;
grant execute on function public.claim_clean_export(text, text) to authenticated;
grant execute on function public.quota_status() to authenticated;
grant execute on function public.is_pro(uuid) to authenticated;

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.export_claims enable row level security;
alter table public.documents enable row level security;
alter table public.templates enable row level security;
alter table public.recurring enable row level security;
alter table public.payments enable row level security;
alter table public.email_log enable row level security;

create policy "own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "own claims" on public.export_claims for select to authenticated using (user_id = (select auth.uid()));
create policy "own payments" on public.payments for select to authenticated using (user_id = (select auth.uid()));

-- Cloud sync, templates and recurring are Pro features.
create policy "pro docs" on public.documents for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_pro((select auth.uid())));
create policy "pro templates" on public.templates for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_pro((select auth.uid())));
create policy "pro recurring" on public.recurring for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_pro((select auth.uid())));
