create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_admin a
    where a.user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

alter table public.settings enable row level security;
alter table public.minyan_rules enable row level security;
alter table public.minyan_exceptions enable row level security;
alter table public.source_records enable row level security;
alter table public.jewish_days enable row level security;
alter table public.content_items enable row level security;
alter table public.media_assets enable row level security;
alter table public.layout_draft enable row level security;
alter table public.published_versions enable row level security;
alter table public.public_state enable row level security;
alter table public.audit_events enable row level security;
alter table public.devices enable row level security;
alter table public.device_pairings enable row level security;
alter table public.source_health enable row level security;
alter table public.daily_study_entries enable row level security;
alter table public.weather_cache enable row level security;
alter table public.rate_limits enable row level security;
alter table public.app_admin enable row level security;

revoke all privileges on all tables in schema public from anon, authenticated;
grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

grant select, insert, update, delete on public.settings to authenticated;
grant select, insert, update, delete on public.minyan_rules to authenticated;
grant select, insert, update, delete on public.minyan_exceptions to authenticated;
grant select on public.source_records to authenticated;
grant update (override_value, override_by, override_expires_at) on public.source_records to authenticated;
grant select on public.jewish_days to authenticated;
grant select, insert, update, delete on public.content_items to authenticated;
grant select, insert, update, delete on public.media_assets to authenticated;
grant select, insert, update, delete on public.layout_draft to authenticated;
grant select on public.published_versions to authenticated;
grant select on public.public_state to authenticated;
grant select on public.audit_events to authenticated;
grant select (
  id,
  device_name,
  revoked_at,
  last_seen,
  displayed_version,
  build,
  client_time,
  clock_skew_seconds,
  cache_status,
  last_error_code,
  created_at,
  updated_at
) on public.devices to authenticated;
grant update (device_name, revoked_at) on public.devices to authenticated;
grant select on public.source_health to authenticated;
grant select, insert, update, delete on public.daily_study_entries to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
revoke all privileges on all tables in schema public from anon;
revoke all privileges on storage.objects from anon;

create policy settings_admin_all on public.settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
create policy minyan_rules_admin_all on public.minyan_rules
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
create policy minyan_exceptions_admin_all on public.minyan_exceptions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
create policy source_records_admin_select on public.source_records
  for select to authenticated
  using (public.is_admin());
create policy source_records_admin_override on public.source_records
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
create policy jewish_days_admin_select on public.jewish_days
  for select to authenticated
  using (public.is_admin());
create policy content_items_admin_all on public.content_items
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
create policy media_assets_admin_all on public.media_assets
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
create policy layout_draft_admin_all on public.layout_draft
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
create policy published_versions_admin_select on public.published_versions
  for select to authenticated
  using (public.is_admin());
create policy public_state_admin_select on public.public_state
  for select to authenticated
  using (public.is_admin());
create policy audit_events_admin_select on public.audit_events
  for select to authenticated
  using (public.is_admin());
create policy devices_admin_select on public.devices
  for select to authenticated
  using (public.is_admin());
create policy devices_admin_update on public.devices
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());
create view public.device_status with (security_invoker = true) as
  select
    id,
    device_name,
    revoked_at,
    last_seen,
    displayed_version,
    build,
    client_time,
    clock_skew_seconds,
    cache_status,
    last_error_code,
    (revoked_at is null and last_seen >= now() - interval '60 seconds') as online
  from public.devices;
grant select on public.device_status to authenticated, service_role;
create policy source_health_admin_select on public.source_health
  for select to authenticated
  using (public.is_admin());
create policy daily_study_entries_admin_all on public.daily_study_entries
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
create policy media_bucket_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'media' and public.is_admin())
  with check (bucket_id = 'media' and public.is_admin());

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_record_id text;
begin
  if tg_op <> 'INSERT' then
    v_before := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    v_after := to_jsonb(new);
  end if;
  if tg_table_name = 'devices' then
    v_before := v_before - 'token_hash';
    v_after := v_after - 'token_hash';
  end if;
  v_record_id := coalesce(
    v_after ->> 'id',
    v_before ->> 'id',
    v_after ->> 'local_date',
    v_before ->> 'local_date',
    v_after ->> 'source',
    v_before ->> 'source'
  );
  insert into public.audit_events (actor_id, action, table_name, record_id, before_data, after_data)
  values (auth.uid(), lower(tg_op), tg_table_name, v_record_id, v_before, v_after);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_row_change() from public;

create trigger settings_audit after insert or update or delete on public.settings
  for each row execute function public.audit_row_change();
create trigger minyan_rules_audit after insert or update or delete on public.minyan_rules
  for each row execute function public.audit_row_change();
create trigger minyan_exceptions_audit after insert or update or delete on public.minyan_exceptions
  for each row execute function public.audit_row_change();
create trigger content_items_audit after insert or update or delete on public.content_items
  for each row execute function public.audit_row_change();
create trigger layout_draft_audit after insert or update or delete on public.layout_draft
  for each row execute function public.audit_row_change();
create trigger media_assets_audit after insert or update or delete on public.media_assets
  for each row execute function public.audit_row_change();
create trigger daily_study_entries_audit after insert or update or delete on public.daily_study_entries
  for each row execute function public.audit_row_change();
create trigger devices_audit after insert or update or delete on public.devices
  for each row execute function public.audit_row_change();

create or replace function public.guard_published_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception using errcode = '42501', message = 'published_version_immutable';
  end if;
  if current_setting('app.purge_old_versions', true) is distinct from 'on' then
    raise exception using errcode = '42501', message = 'published_version_immutable';
  end if;
  if old.id = (select current_version_id from public.public_state where id = true) then
    raise exception using errcode = '42501', message = 'published_version_current';
  end if;
  return old;
end;
$$;

create trigger published_versions_immutable
  before update or delete on public.published_versions
  for each row execute function public.guard_published_version_mutation();

create or replace function public.purge_old_versions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retention integer;
  v_deleted integer;
begin
  select version_retention into v_retention from public.settings where id = true;
  v_retention := greatest(1, coalesce(v_retention, 60));
  perform set_config('app.purge_old_versions', 'on', true);
  with ordered_versions as (
    select
      version.id,
      row_number() over (order by version.version_number desc) as position
    from public.published_versions version
  ),
  purge_candidates as (
    select ordered.id
    from ordered_versions ordered
    where ordered.position > v_retention
      and ordered.id <> (select current_version_id from public.public_state where id = true)
  )
  delete from public.published_versions version
  using purge_candidates candidate
  where version.id = candidate.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_old_versions() from public;
grant execute on function public.purge_old_versions() to service_role;

create or replace function public.publish_package(
  p_expected_number integer,
  p_package jsonb,
  p_hash text,
  p_manifest jsonb,
  p_snapshot jsonb,
  p_source text,
  p_restored_from uuid,
  p_actor uuid
)
returns table (id uuid, version_number integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_number integer;
  v_version_id uuid;
begin
  insert into public.public_state (id, current_version_number)
  values (true, 0)
  on conflict on constraint public_state_pkey do nothing;
  select state.current_version_number
  into v_current_number
  from public.public_state state
  where state.id = true
  for update;
  if v_current_number + 1 <> p_expected_number then
    raise exception using errcode = 'P0001', message = 'version_conflict';
  end if;
  if p_hash !~ '^[a-f0-9]{64}$' or p_package ->> 'packageHash' is distinct from p_hash then
    raise exception using errcode = '22023', message = 'invalid_package_hash';
  end if;
  insert into public.published_versions (
    version_number,
    package,
    package_hash,
    media_manifest,
    draft_snapshot,
    source,
    restored_from,
    created_by
  )
  values (
    p_expected_number,
    p_package,
    p_hash,
    p_manifest,
    p_snapshot,
    p_source,
    p_restored_from,
    p_actor
  )
  returning published_versions.id into v_version_id;
  update public.public_state as state
  set current_version_id = v_version_id,
      current_version_number = p_expected_number,
      published_at = now(),
      updated_at = now()
  where state.id = true;
  insert into public.audit_events (actor_id, action, table_name, record_id, after_data, version_id)
  values (
    p_actor,
    'publish',
    'published_versions',
    v_version_id::text,
    jsonb_build_object('version_number', p_expected_number, 'source', p_source),
    v_version_id
  );
  perform public.purge_old_versions();
  return query select v_version_id, p_expected_number;
end;
$$;

revoke all on function public.publish_package(integer, jsonb, text, jsonb, jsonb, text, uuid, uuid) from public;
revoke all on function public.publish_package(integer, jsonb, text, jsonb, jsonb, text, uuid, uuid) from anon, authenticated;
grant execute on function public.publish_package(integer, jsonb, text, jsonb, jsonb, text, uuid, uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  false,
  12582912,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;