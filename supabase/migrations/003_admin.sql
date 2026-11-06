-- Admin dashboard: admin list, audit log and read/write RPCs.
-- Every function checks is_admin() first; nothing here is reachable by normal users.

create table if not exists public.admins (
  email text primary key,
  added_at timestamptz not null default now()
);
create table if not exists public.admin_log (
  id bigint generated always as identity primary key,
  admin_email text not null,
  action text not null,
  target text,
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
alter table public.admin_log enable row level security;
-- No policies on purpose: only the security definer functions below read these tables.

insert into public.admins (email) values ('abahvictor360@gmail.com') on conflict do nothing;

-- Admin = signed in, email confirmed, and email listed in public.admins.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    join public.admins a on lower(a.email) = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

create or replace function public._admin_guard()
returns text
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return (select email from auth.users where id = auth.uid());
end;
$$;

-- ---------- overview numbers and 30-day charts ----------
create or replace function public.admin_overview()
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  out json;
begin
  perform public._admin_guard();
  with days as (
    select generate_series((now() at time zone 'utc')::date - 29, (now() at time zone 'utc')::date, interval '1 day')::date as day
  )
  select json_build_object(
    'users_total', (select count(*) from auth.users),
    'users_7d', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'users_30d', (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'pro_active', (select count(*) from public.profiles where pro_until > now()),
    'revenue_total', (select coalesce(sum(amount), 0) from public.payments where status = 'successful'),
    'revenue_30d', (select coalesce(sum(amount), 0) from public.payments where status = 'successful' and paid_at > now() - interval '30 days'),
    'payments_success', (select count(*) from public.payments where status = 'successful'),
    'payments_pending', (select count(*) from public.payments where status <> 'successful'),
    'exports_total', (select count(*) from public.export_claims),
    'emails_30d', (select count(*) from public.email_log where created_at > now() - interval '30 days'),
    'recurring_active', (select count(*) from public.recurring where active),
    'docs_synced', (select count(*) from public.documents where not deleted),
    'signups_daily', (select json_agg(json_build_object('day', d.day, 'n',
        (select count(*) from auth.users u where (u.created_at at time zone 'utc')::date = d.day)) order by d.day) from days d),
    'revenue_daily', (select json_agg(json_build_object('day', d.day, 'n',
        (select coalesce(sum(p.amount), 0) from public.payments p where p.status = 'successful' and (p.paid_at at time zone 'utc')::date = d.day)) order by d.day) from days d)
  ) into out;
  return out;
end;
$$;

-- ---------- users ----------
create or replace function public.admin_users(p_search text default '', p_filter text default 'all', p_limit int default 25, p_offset int default 0)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  q text := '%' || lower(coalesce(p_search, '')) || '%';
  lim int := least(greatest(coalesce(p_limit, 25), 1), 100);
  off int := greatest(coalesce(p_offset, 0), 0);
  out json;
begin
  perform public._admin_guard();
  with base as (
    select u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null as confirmed, p.pro_until
    from auth.users u left join public.profiles p on p.id = u.id
    where lower(coalesce(u.email, '')) like q
      and (p_filter = 'all'
        or (p_filter = 'pro' and p.pro_until > now())
        or (p_filter = 'free' and (p.pro_until is null or p.pro_until <= now())))
  )
  select json_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((select json_agg(r) from (
      select b.*,
        (select count(*) from public.export_claims c where c.user_id = b.id and c.doc_type = 'receipt') as receipts_used,
        (select count(*) from public.export_claims c where c.user_id = b.id and c.doc_type = 'invoice') as invoices_used,
        (select count(*) from public.documents d where d.user_id = b.id and not d.deleted) as docs,
        (select coalesce(sum(amount), 0) from public.payments pa where pa.user_id = b.id and pa.status = 'successful') as paid_total
      from base b order by b.created_at desc limit lim offset off
    ) r), '[]'::json)
  ) into out;
  return out;
end;
$$;

-- ---------- payments ----------
create or replace function public.admin_payments(p_status text default 'all', p_limit int default 25, p_offset int default 0)
returns json
language plpgsql stable security definer set search_path = ''
as $$
declare
  lim int := least(greatest(coalesce(p_limit, 25), 1), 100);
  off int := greatest(coalesce(p_offset, 0), 0);
  out json;
begin
  perform public._admin_guard();
  with base as (
    select pa.tx_ref, pa.amount, pa.currency, pa.status, pa.flw_id, pa.created_at, pa.paid_at, u.email
    from public.payments pa left join auth.users u on u.id = pa.user_id
    where p_status = 'all' or (p_status = 'successful' and pa.status = 'successful') or (p_status = 'pending' and pa.status <> 'successful')
  )
  select json_build_object(
    'total', (select count(*) from base),
    'rows', coalesce((select json_agg(r) from (select * from base order by created_at desc limit lim offset off) r), '[]'::json)
  ) into out;
  return out;
end;
$$;

-- ---------- activity ----------
create or replace function public.admin_activity(p_limit int default 50)
returns json
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._admin_guard();
  return json_build_object(
    'log', coalesce((select json_agg(r) from (select admin_email, action, target, detail, created_at from public.admin_log order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) r), '[]'::json),
    'emails', coalesce((select json_agg(r) from (select e.recipient, e.doc_id, e.created_at, u.email as sender from public.email_log e left join auth.users u on u.id = e.user_id order by e.created_at desc limit 50) r), '[]'::json),
    'admins', coalesce((select json_agg(r) from (select email, added_at from public.admins order by added_at) r), '[]'::json)
  );
end;
$$;

-- ---------- actions ----------
-- p_days > 0 adds that many days of Pro (from today or from the current end date); p_days = 0 ends Pro now.
create or replace function public.admin_set_pro(p_user uuid, p_days int)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  me text := public._admin_guard();
  cur timestamptz;
  until timestamptz;
begin
  if p_days is null or p_days < 0 or p_days > 3660 then raise exception 'days must be 0 to 3660'; end if;
  select pro_until into cur from public.profiles where id = p_user;
  if not found then raise exception 'user not found'; end if;
  until := case when p_days = 0 then now() else greatest(now(), coalesce(cur, now())) + make_interval(days => p_days) end;
  update public.profiles set pro_until = until where id = p_user;
  insert into public.admin_log (admin_email, action, target, detail)
    values (me, case when p_days = 0 then 'end_pro' else 'grant_pro' end, p_user::text, json_build_object('days', p_days, 'pro_until', until)::jsonb);
  return json_build_object('pro_until', until);
end;
$$;

create or replace function public.admin_reset_quota(p_user uuid)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  me text := public._admin_guard();
  n int;
begin
  delete from public.export_claims where user_id = p_user;
  get diagnostics n = row_count;
  insert into public.admin_log (admin_email, action, target, detail) values (me, 'reset_quota', p_user::text, json_build_object('removed', n)::jsonb);
  return json_build_object('removed', n);
end;
$$;

create or replace function public.admin_add(p_email text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  me text := public._admin_guard();
  e text := lower(trim(coalesce(p_email, '')));
begin
  if e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'invalid email'; end if;
  insert into public.admins (email) values (e) on conflict do nothing;
  insert into public.admin_log (admin_email, action, target) values (me, 'add_admin', e);
  return json_build_object('ok', true);
end;
$$;

create or replace function public.admin_remove(p_email text)
returns json
language plpgsql security definer set search_path = ''
as $$
declare
  me text := public._admin_guard();
  e text := lower(trim(coalesce(p_email, '')));
begin
  if e = lower(me) then raise exception 'you cannot remove yourself'; end if;
  delete from public.admins where lower(email) = e;
  insert into public.admin_log (admin_email, action, target) values (me, 'remove_admin', e);
  return json_build_object('ok', true);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'is_admin()', '_admin_guard()', 'admin_overview()', 'admin_users(text, text, int, int)',
    'admin_payments(text, int, int)', 'admin_activity(int)', 'admin_set_pro(uuid, int)',
    'admin_reset_quota(uuid)', 'admin_add(text)', 'admin_remove(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
