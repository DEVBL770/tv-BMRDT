alter table public.minyan_rules
  alter column time drop not null,
  add column cancelled boolean not null default false,
  add constraint minyan_rules_time_cancelled_check
    check ((cancelled and time is null) or (not cancelled and time is not null));

alter table public.settings
  add column logo_media_id uuid references public.media_assets(id) on delete set null;

alter table public.settings
  drop constraint settings_rambam_cycle_check,
  add constraint settings_rambam_cycle_check check (rambam_cycle in ('dr1', 'dr3'));

alter table public.source_records
  add column override_reason text;

grant update (override_reason) on public.source_records to authenticated;

do $$
declare
  sponsor_constraint text;
begin
  select conname into sponsor_constraint
  from pg_constraint
  where conrelid = 'public.content_items'::regclass
    and contype = 'c'
    and position('sponsor' in pg_get_constraintdef(oid)) > 0
    and position('is_commercial' in pg_get_constraintdef(oid)) > 0;
  if sponsor_constraint is not null then
    execute format('alter table public.content_items drop constraint %I', sponsor_constraint);
  end if;
end;
$$;
