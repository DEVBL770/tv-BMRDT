create table public.refresh_locks (
  lock_name text primary key,
  owner_id uuid not null,
  locked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.refresh_locks enable row level security;
revoke all privileges on public.refresh_locks from anon, authenticated;
grant all privileges on public.refresh_locks to service_role;

create or replace function public.sync_source_record_override_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status := case when new.override_value is null then 'ok' else 'overridden' end;
  return new;
end;
$$;

create trigger source_record_override_status
before insert or update of override_value, override_expires_at
on public.source_records
for each row
execute function public.sync_source_record_override_status();

create or replace function public.consume_rate_limit(
  p_key text,
  p_window_start timestamptz,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_limit < 1 then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));
  delete from public.rate_limits
  where key = p_key and window_start < p_window_start;
  select coalesce(sum(count), 0)::integer
  into v_count
  from public.rate_limits
  where key = p_key and window_start >= p_window_start;
  if v_count >= p_limit then
    return false;
  end if;
  insert into public.rate_limits (key, window_start, count)
  values (p_key, clock_timestamp(), 1)
  on conflict (key, window_start) do update
  set count = public.rate_limits.count + 1;
  return true;
end;
$$;

create or replace function public.consume_device_pairing(
  p_code_hash text,
  p_token_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pairing public.device_pairings%rowtype;
  v_device_id uuid;
begin
  select *
  into v_pairing
  from public.device_pairings
  where code_hash = p_code_hash
    and used_at is null
    and expires_at > now()
  for update;
  if not found then
    return null;
  end if;
  update public.device_pairings
  set used_at = now()
  where id = v_pairing.id;
  insert into public.devices (device_name, token_hash)
  values (v_pairing.device_name, p_token_hash)
  returning id into v_device_id;
  return v_device_id;
end;
$$;

create or replace function public.try_acquire_refresh_lock(
  p_lock_name text,
  p_owner_id uuid,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acquired boolean;
begin
  if p_ttl_seconds < 1 or p_ttl_seconds > 3600 then
    return false;
  end if;
  insert into public.refresh_locks (lock_name, owner_id, locked_until)
  values (p_lock_name, p_owner_id, now() + make_interval(secs => p_ttl_seconds))
  on conflict (lock_name) do update
  set owner_id = excluded.owner_id,
      locked_until = excluded.locked_until,
      updated_at = now()
  where public.refresh_locks.locked_until <= now()
  returning true into v_acquired;
  return coalesce(v_acquired, false);
end;
$$;

create or replace function public.release_refresh_lock(p_lock_name text, p_owner_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.refresh_locks
  where lock_name = p_lock_name and owner_id = p_owner_id;
  return found;
end;
$$;

create or replace function public.upsert_calendar_refresh(
  p_days jsonb,
  p_records jsonb,
  p_data_hash text,
  p_success_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
begin
  if jsonb_typeof(p_days) is distinct from 'array'
    or jsonb_typeof(p_records) is distinct from 'array'
    or p_data_hash is null
    or p_data_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_calendar_payload';
  end if;
  insert into public.jewish_days (
    local_date, hebrew_date, parasha, holidays, holidays_he, holiday_kinds,
    rosh_hodesh, omer, study, zmanim, source_records, fetched_at, valid_until
  )
  select
    entry.local_date, entry.hebrew_date, entry.parasha, entry.holidays, entry.holidays_he,
    entry.holiday_kinds, entry.rosh_hodesh, entry.omer, entry.study, entry.zmanim,
    entry.source_records, entry.fetched_at, entry.valid_until
  from jsonb_to_recordset(p_days) as entry(
    local_date date,
    hebrew_date jsonb,
    parasha jsonb,
    holidays text[],
    holidays_he text[],
    holiday_kinds text[],
    rosh_hodesh text,
    omer smallint,
    study jsonb,
    zmanim jsonb,
    source_records jsonb,
    fetched_at timestamptz,
    valid_until timestamptz
  )
  on conflict (local_date) do update set
    hebrew_date = excluded.hebrew_date,
    parasha = excluded.parasha,
    holidays = excluded.holidays,
    holidays_he = excluded.holidays_he,
    holiday_kinds = excluded.holiday_kinds,
    rosh_hodesh = excluded.rosh_hodesh,
    omer = excluded.omer,
    study = excluded.study,
    zmanim = excluded.zmanim,
    source_records = excluded.source_records,
    fetched_at = excluded.fetched_at,
    valid_until = excluded.valid_until;
  get diagnostics v_days = row_count;
  insert into public.source_records as existing (
    provider, kind, local_date, source_id, instant, value, method, params, fetched_at, valid_until
  )
  select
    entry.provider, entry.kind, entry.local_date, entry.source_id, entry.instant, entry.value,
    entry.method, entry.params, entry.fetched_at, entry.valid_until
  from jsonb_to_recordset(p_records) as entry(
    provider text,
    kind text,
    local_date date,
    source_id text,
    instant timestamptz,
    value jsonb,
    method jsonb,
    params jsonb,
    fetched_at timestamptz,
    valid_until timestamptz
  )
  on conflict (provider, kind, local_date, source_id) do update set
    instant = excluded.instant,
    value = excluded.value,
    method = excluded.method,
    params = excluded.params,
    fetched_at = excluded.fetched_at,
    valid_until = excluded.valid_until,
    status = case when existing.override_value is null then 'ok' else 'overridden' end;
  insert into public.source_health (source, last_success_at, last_error_code, last_error_at, data_hash, updated_at)
  values ('hebcal', p_success_at, null, null, p_data_hash, p_success_at)
  on conflict (source) do update set
    last_success_at = excluded.last_success_at,
    last_error_code = null,
    last_error_at = null,
    data_hash = excluded.data_hash,
    updated_at = excluded.updated_at;
  return v_days;
end;
$$;

revoke all on function public.consume_rate_limit(text, timestamptz, integer) from public;
revoke all on function public.consume_device_pairing(text, text) from public;
revoke all on function public.try_acquire_refresh_lock(text, uuid, integer) from public;
revoke all on function public.release_refresh_lock(text, uuid) from public;
revoke all on function public.upsert_calendar_refresh(jsonb, jsonb, text, timestamptz) from public;
revoke all on function public.consume_rate_limit(text, timestamptz, integer) from anon, authenticated;
revoke all on function public.consume_device_pairing(text, text) from anon, authenticated;
revoke all on function public.try_acquire_refresh_lock(text, uuid, integer) from anon, authenticated;
revoke all on function public.release_refresh_lock(text, uuid) from anon, authenticated;
revoke all on function public.upsert_calendar_refresh(jsonb, jsonb, text, timestamptz) from anon, authenticated;
grant execute on function public.consume_rate_limit(text, timestamptz, integer) to service_role;
grant execute on function public.consume_device_pairing(text, text) to service_role;
grant execute on function public.try_acquire_refresh_lock(text, uuid, integer) to service_role;
grant execute on function public.release_refresh_lock(text, uuid) to service_role;
grant execute on function public.upsert_calendar_refresh(jsonb, jsonb, text, timestamptz) to service_role;