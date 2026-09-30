create table public.settings (
  id boolean primary key default true check (id),
  site_name text not null default 'Beth Menahem',
  site_address text not null default '',
  timezone text not null default 'Europe/Paris' check (timezone = 'Europe/Paris'),
  latitude numeric(8, 5) not null default 48.8885 check (latitude between -90 and 90),
  longitude numeric(8, 5) not null default 2.3821 check (longitude between -180 and 180),
  candle_lighting_minutes smallint not null default 18 check (candle_lighting_minutes between 0 and 120),
  havdalah_mode text not null default 'M=on' check (havdalah_mode = 'M=on'),
  alot_angle numeric(4, 1) not null default 16.1 check (alot_angle > 0 and alot_angle < 90),
  misheyakir_angle numeric(4, 1) not null default 11.5 check (misheyakir_angle > 0 and misheyakir_angle < 90),
  rambam_cycle text not null default 'dr3' check (rambam_cycle = 'dr3'),
  hebrew_day_change text not null default 'sunset' check (hebrew_day_change in ('sunset', 'tzeit', 'midnight')),
  religious_method_status text not null default 'pending' check (religious_method_status in ('pending', 'approved')),
  religious_method_params jsonb not null default '{}'::jsonb,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  sponsor_margin_before_min smallint not null default 30 check (sponsor_margin_before_min >= 0),
  sponsor_margin_after_min smallint not null default 0 check (sponsor_margin_after_min >= 0),
  hide_commercial_on_chol_hamoed boolean not null default false,
  version_retention smallint not null default 60 check (version_retention >= 1),
  audit_retention_days integer not null default 365 check (audit_retention_days >= 1),
  media_active_budget_mb integer not null default 500 check (media_active_budget_mb >= 1),
  updated_at timestamptz not null default now(),
  check (
    (religious_method_status = 'approved' and approved_by is not null and approved_at is not null)
    or (religious_method_status = 'pending' and approved_by is null and approved_at is null)
  )
);

create table public.minyan_rules (
  id uuid primary key default gen_random_uuid(),
  office text not null check (office in ('Chaharit', 'Min’ha', 'Arvit')),
  time text not null check (time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  valid_from date,
  valid_to date,
  weekdays integer[] not null default '{}',
  day_kinds text[] not null default '{}',
  priority integer not null default 0,
  active boolean not null default true,
  status text not null default 'to_confirm' check (status in ('to_confirm', 'confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_from is null or valid_to is null or valid_from <= valid_to),
  check (weekdays <@ array[0, 1, 2, 3, 4, 5, 6]),
  check (day_kinds <@ array['weekday', 'erev_shabbat', 'shabbat', 'erev_yomtov', 'yomtov', 'chol_hamoed']::text[])
);

create table public.minyan_exceptions (
  id uuid primary key default gen_random_uuid(),
  local_date date not null,
  office text not null check (office in ('Chaharit', 'Min’ha', 'Arvit')),
  time text check (time is null or time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  cancelled boolean not null default false,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (local_date, office),
  check ((cancelled and time is null) or (not cancelled and time is not null))
);

create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  kind text not null,
  local_date date,
  source_id text,
  instant timestamptz,
  value jsonb not null,
  method jsonb not null default '{}'::jsonb,
  params jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null,
  valid_until timestamptz,
  status text not null default 'ok' check (status in ('ok', 'stale', 'error', 'overridden')),
  override_value jsonb,
  override_by uuid references auth.users(id) on delete set null,
  override_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, kind, local_date, source_id),
  check ((override_value is null) = (override_by is null)),
  check (override_value is not null or override_expires_at is null)
);

create table public.jewish_days (
  local_date date primary key,
  hebrew_date jsonb not null,
  parasha jsonb,
  holidays text[] not null default '{}',
  holidays_he text[] not null default '{}',
  holiday_kinds text[] not null default '{}',
  rosh_hodesh text,
  omer smallint check (omer is null or omer between 1 and 49),
  study jsonb not null default '{}'::jsonb,
  zmanim jsonb not null default '{}'::jsonb,
  source_records jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  valid_until timestamptz,
  check (holiday_kinds <@ array['erev_yomtov', 'yomtov', 'chol_hamoed']::text[]),
  check (jsonb_typeof(hebrew_date) = 'object'),
  check (jsonb_typeof(study) = 'object'),
  check (jsonb_typeof(zmanim) = 'object')
);

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('announcement', 'event', 'mazal_tov', 'azkara', 'dedication', 'kiddouch', 'bar_mitsva', 'photo', 'pdf', 'qr', 'urgent', 'sponsor')),
  title text not null,
  body text,
  title_he text,
  media_ids uuid[] not null default '{}',
  qr_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  weekdays integer[] not null default '{}',
  time_windows jsonb not null default '[]'::jsonb,
  shabbat_visibility text not null default 'show' check (shabbat_visibility in ('show', 'hide')),
  is_commercial boolean not null default false,
  priority integer not null default 0,
  duration_sec integer not null default 20 check (duration_sec > 0),
  status text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or starts_at <= ends_at),
  check (weekdays <@ array[0, 1, 2, 3, 4, 5, 6]),
  check (jsonb_typeof(time_windows) = 'array'),
  check (type <> 'sponsor' or is_commercial)
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  bucket text not null default 'media' check (bucket = 'media'),
  storage_path text not null unique,
  kind text not null check (kind in ('image', 'pdf', 'pdf_page')),
  mime text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  bytes bigint not null default 0 check (bytes >= 0),
  width integer check (width is null or width between 1 and 8000),
  height integer check (height is null or height between 1 and 8000),
  pages smallint check (pages is null or pages between 1 and 6),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  variants jsonb not null default '{}'::jsonb,
  parent_id uuid references public.media_assets(id) on delete set null,
  page_index smallint check (page_index is null or page_index between 1 and 6),
  original_name_label text not null default '',
  status text not null default 'pending' check (status in ('pending', 'ready', 'rejected')),
  error_code text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(variants) = 'object'),
  check (status <> 'ready' or sha256 is not null),
  check (kind <> 'pdf_page' or parent_id is not null)
);

create table public.layout_draft (
  id boolean primary key default true check (id),
  mode text not null default 'fixed' check (mode in ('fixed', 'playlist')),
  zones jsonb not null default '{}'::jsonb,
  slides jsonb not null default '[{"id":"schedule","kind":"schedule","durationSec":30}]'::jsonb,
  options jsonb not null default '{}'::jsonb,
  theme text not null default 'auto' check (theme in ('auto', 'weekday', 'shabbat', 'yomtov')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(zones) = 'object'),
  check (jsonb_typeof(slides) = 'array'),
  check (jsonb_typeof(options) = 'object')
);

create table public.published_versions (
  id uuid primary key default gen_random_uuid(),
  version_number integer not null unique check (version_number > 0),
  package jsonb not null,
  package_hash text not null check (package_hash ~ '^[a-f0-9]{64}$'),
  media_manifest jsonb not null default '[]'::jsonb,
  draft_snapshot jsonb not null,
  source text not null check (source in ('admin', 'refresh', 'restore')),
  restored_from uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(package) = 'object'),
  check (jsonb_typeof(media_manifest) = 'array'),
  check (jsonb_typeof(draft_snapshot) = 'object'),
  check ((source = 'restore') = (restored_from is not null))
);

create table public.public_state (
  id boolean primary key default true check (id),
  current_version_id uuid references public.published_versions(id) on delete restrict,
  current_version_number integer not null default 0 check (current_version_number >= 0),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((current_version_number = 0) = (current_version_id is null))
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  before_data jsonb,
  after_data jsonb,
  version_id uuid references public.published_versions(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  device_name text not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  revoked_at timestamptz,
  last_seen timestamptz,
  displayed_version integer,
  build text,
  client_time timestamptz,
  clock_skew_seconds integer,
  cache_status text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.device_pairings (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  device_name text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.source_health (
  source text primary key,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  data_hash text check (data_hash is null or data_hash ~ '^[a-f0-9]{64}$'),
  data_age_seconds integer check (data_age_seconds is null or data_age_seconds >= 0),
  fallback_available boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.daily_study_entries (
  id uuid primary key default gen_random_uuid(),
  local_date date not null,
  hebrew_date text,
  kind text not null check (kind in ('hayom_yom', 'tanya', 'rambam')),
  reference text not null,
  text_fr text,
  url text,
  status text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
  validated_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (local_date, kind)
);

create table public.weather_cache (
  id boolean primary key default true check (id),
  temperature_c numeric(5, 2),
  symbol text,
  updated_at timestamptz,
  expires_at timestamptz,
  last_modified text,
  attribution text not null default 'Météo : MET Norway',
  payload jsonb not null default '{}'::jsonb,
  check (jsonb_typeof(payload) = 'object')
);

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  primary key (key, window_start)
);

create table public.app_admin (
  id boolean primary key default true check (id),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index minyan_rules_office_active_idx on public.minyan_rules (office, active, priority desc);
create index minyan_exceptions_date_idx on public.minyan_exceptions (local_date);
create index source_records_lookup_idx on public.source_records (provider, kind, local_date);
create index source_records_override_expiry_idx on public.source_records (override_expires_at) where override_value is not null;
create index jewish_days_horizon_idx on public.jewish_days (local_date desc);
create index content_items_ready_idx on public.content_items (priority desc, starts_at, ends_at) where status = 'ready';
create index media_assets_status_idx on public.media_assets (status);
create index published_versions_created_at_idx on public.published_versions (created_at desc);
create index audit_events_created_at_idx on public.audit_events (created_at desc);
create index devices_last_seen_idx on public.devices (last_seen desc);
create index device_pairings_expiration_idx on public.device_pairings (expires_at) where used_at is null;
create index daily_study_entries_date_idx on public.daily_study_entries (local_date, kind);
create index rate_limits_window_idx on public.rate_limits (window_start);

insert into public.settings (id) values (true) on conflict (id) do nothing;
insert into public.layout_draft (id) values (true) on conflict (id) do nothing;
insert into public.public_state (id, current_version_number)
values (true, 0)
on conflict (id) do nothing;
insert into public.weather_cache (id) values (true) on conflict (id) do nothing;