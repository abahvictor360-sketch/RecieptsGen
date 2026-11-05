-- Daily recurring-invoice job. The edge function only runs when the caller
-- sends the secret stored in Supabase Vault.
create extension if not exists pg_cron;
create extension if not exists pg_net schema extensions;

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'recurring_cron_secret', 'Header secret for the recurring edge function');

create or replace function public.check_cron_secret(p text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'recurring_cron_secret' and decrypted_secret = p);
$$;
revoke all on function public.check_cron_secret(text) from public, anon, authenticated;
grant execute on function public.check_cron_secret(text) to service_role;

-- Signed-in users may only check their own plan; edge functions use service_role.
create or replace function public.is_pro(uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select pro_until > now() from public.profiles
    where id = uid and (uid = auth.uid() or auth.role() = 'service_role')
  ), false);
$$;

-- Replace <project-ref> with the project ref before running.
select cron.schedule(
  'recurring-invoices-daily',
  '15 6 * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/recurring',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'recurring_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
