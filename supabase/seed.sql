insert into public.settings (
  id,
  site_name,
  site_address,
  latitude,
  longitude,
  candle_lighting_minutes,
  havdalah_mode,
  alot_angle,
  misheyakir_angle,
  rambam_cycle,
  hebrew_day_change,
  religious_method_status,
  religious_method_params,
  sponsor_margin_before_min,
  sponsor_margin_after_min,
  hide_commercial_on_chol_hamoed,
  version_retention,
  audit_retention_days,
  media_active_budget_mb
)
values (
  true,
  'Beth Menahem',
  'Paris 19e — adresse de démonstration',
  48.8885,
  2.3821,
  18,
  'M=on',
  16.1,
  11.5,
  'dr3',
  'sunset',
  'pending',
  '{"alotAngle":16.1,"misheyakirAngle":11.5,"candleLightingMinutes":18,"havdalah":"M=on"}'::jsonb,
  30,
  0,
  false,
  60,
  365,
  500
)
on conflict (id) do update set
  site_name = excluded.site_name,
  site_address = excluded.site_address,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  candle_lighting_minutes = excluded.candle_lighting_minutes,
  havdalah_mode = excluded.havdalah_mode,
  alot_angle = excluded.alot_angle,
  misheyakir_angle = excluded.misheyakir_angle,
  rambam_cycle = excluded.rambam_cycle,
  hebrew_day_change = excluded.hebrew_day_change,
  religious_method_status = excluded.religious_method_status,
  religious_method_params = excluded.religious_method_params,
  sponsor_margin_before_min = excluded.sponsor_margin_before_min,
  sponsor_margin_after_min = excluded.sponsor_margin_after_min,
  hide_commercial_on_chol_hamoed = excluded.hide_commercial_on_chol_hamoed,
  version_retention = excluded.version_retention,
  audit_retention_days = excluded.audit_retention_days,
  media_active_budget_mb = excluded.media_active_budget_mb,
  updated_at = now();

insert into public.minyan_rules (id, office, time, priority, active, status)
values
  ('10000000-0000-4000-8000-000000000001', 'Chaharit', '08:30', 0, true, 'to_confirm'),
  ('10000000-0000-4000-8000-000000000002', 'Min’ha', '19:00', 0, true, 'to_confirm'),
  ('10000000-0000-4000-8000-000000000003', 'Arvit', '20:00', 0, true, 'to_confirm')
on conflict (id) do update set
  office = excluded.office,
  time = excluded.time,
  priority = excluded.priority,
  active = excluded.active,
  status = excluded.status,
  updated_at = now();

insert into public.minyan_exceptions (id, local_date, office, time, cancelled, comment)
values (
  '20000000-0000-4000-8000-000000000001',
  '2026-10-04',
  'Chaharit',
  '09:00',
  false,
  'Exception de démonstration'
)
on conflict (id) do update set
  local_date = excluded.local_date,
  office = excluded.office,
  time = excluded.time,
  cancelled = excluded.cancelled,
  comment = excluded.comment,
  updated_at = now();

insert into public.layout_draft (id, mode, zones, slides, options, theme)
values (
  true,
  'fixed',
  '{"offices":{"enabled":true},"zmanim":{"enabled":true},"community":{"enabled":true}}'::jsonb,
  '[{"id":"schedule","kind":"schedule","durationSec":30},{"id":"shabbat","kind":"shabbat","durationSec":18},{"id":"community","kind":"content","contentIds":["30000000-0000-4000-8000-000000000001","30000000-0000-4000-8000-000000000002"],"durationSec":22},{"id":"study","kind":"study","durationSec":20}]'::jsonb,
  '{"showStudy":true,"showWeather":true}'::jsonb,
  'auto'
)
on conflict (id) do update set
  mode = excluded.mode,
  zones = excluded.zones,
  slides = excluded.slides,
  options = excluded.options,
  theme = excluded.theme,
  updated_at = now();

insert into public.content_items (
  id, type, title, body, media_ids, shabbat_visibility, is_commercial, priority, duration_sec, status
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    'announcement',
    'Cours de pensée juive',
    'Jeudi à 20 h — ouvert à tous.',
    '{}',
    'hide',
    false,
    40,
    22,
    'ready'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    'kiddouch',
    'Kiddouch offert par la communauté',
    'À l’occasion d’une joyeuse célébration.',
    '{}',
    'show',
    false,
    60,
    24,
    'ready'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    'mazal_tov',
    'Mazal tov !',
    'Une grande sim’ha pour la communauté.',
    '{}',
    'show',
    false,
    50,
    22,
    'ready'
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    'azkara',
    'À la mémoire d’un proche',
    'Que son souvenir soit une bénédiction.',
    '{}',
    'show',
    false,
    45,
    20,
    'ready'
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    'dedication',
    'Une dédicace',
    'Pour l’élévation de l’âme.',
    '{}',
    'show',
    false,
    45,
    20,
    'ready'
  ),
  (
    '30000000-0000-4000-8000-000000000006',
    'sponsor',
    'Boulangerie du quartier',
    'Merci pour son soutien à la communauté.',
    '{}',
    'hide',
    true,
    10,
    20,
    'ready'
  ),
  (
    '30000000-0000-4000-8000-000000000007',
    'urgent',
    'Horaires',
    'Vérifiez les horaires avant chaque office.',
    '{}',
    'show',
    false,
    100,
    18,
    'ready'
  ),
  (
    '30000000-0000-4000-8000-000000000008',
    'qr',
    'Étude quotidienne',
    'Retrouvez l’étude du jour.',
    '{}',
    'show',
    false,
    30,
    20,
    'ready'
  )
on conflict (id) do update set
  type = excluded.type,
  title = excluded.title,
  body = excluded.body,
  media_ids = excluded.media_ids,
  shabbat_visibility = excluded.shabbat_visibility,
  is_commercial = excluded.is_commercial,
  priority = excluded.priority,
  duration_sec = excluded.duration_sec,
  status = excluded.status,
  updated_at = now();

insert into public.public_state (id, current_version_number)
values (true, 0)
on conflict (id) do nothing;

insert into public.weather_cache (id, payload, attribution)
values (true, '{}'::jsonb, 'Météo : MET Norway')
on conflict (id) do nothing;
