-- Published scientific exports are shared, read-only data for signed-in users.
-- Run after 202611140001_workspaces.sql. Import with a server-only secret key.
begin;

create table if not exists public.cstar_atmosphere_runs (
  run_id text primary key check (run_id ~ '^[0-9a-f]{64}$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  model_name text not null,
  anomaly_interpretation text not null,
  start_month date not null,
  end_month date not null check (end_month >= start_month),
  total_cell_months integer not null check (total_cell_months > 0),
  status text not null default 'staging' check (status in ('staging', 'published')),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint atmosphere_run_published_at_check check (
    (status = 'staging' and published_at is null) or
    (status = 'published' and published_at is not null)
  )
);

create table if not exists public.cstar_atmosphere_cells (
  run_id text not null references public.cstar_atmosphere_runs(run_id),
  month date not null check (extract(day from month) = 1),
  cell_id text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  observation_status text not null check (
    observation_status in ('valid', 'low_coverage', 'low_qa', 'missing_no2', 'no_observation')
  ),
  qa_mean double precision,
  valid_orbit_count integer not null check (valid_orbit_count >= 0),
  valid_pixel_count integer not null check (valid_pixel_count >= 0),
  coverage_fraction double precision not null check (coverage_fraction between 0 and 1),
  source_product text,
  expected_no2_umol_m2 double precision not null,
  observed_no2_umol_m2 double precision,
  anomaly_umol_m2 double precision,
  interval_lower_umol_m2 double precision,
  interval_upper_umol_m2 double precision,
  significant_anomaly boolean,
  primary key (run_id, month, cell_id),
  constraint atmosphere_observation_nullability check (
    (observation_status = 'valid' and observed_no2_umol_m2 is not null and anomaly_umol_m2 is not null) or
    (observation_status <> 'valid' and observed_no2_umol_m2 is null and anomaly_umol_m2 is null and significant_anomaly is null)
  )
);

create index if not exists cstar_atmosphere_cells_month_status_idx
  on public.cstar_atmosphere_cells (run_id, month, observation_status);
create index if not exists cstar_atmosphere_runs_published_idx
  on public.cstar_atmosphere_runs (published_at desc) where status = 'published';

alter table public.cstar_atmosphere_runs enable row level security;
alter table public.cstar_atmosphere_cells enable row level security;
revoke all on public.cstar_atmosphere_runs from anon, authenticated;
revoke all on public.cstar_atmosphere_cells from anon, authenticated;
grant select on public.cstar_atmosphere_runs to authenticated;
grant select on public.cstar_atmosphere_cells to authenticated;
grant select, insert, update, delete on public.cstar_atmosphere_runs to service_role;
grant select, insert, update, delete on public.cstar_atmosphere_cells to service_role;

drop policy if exists "Read published atmosphere runs" on public.cstar_atmosphere_runs;
create policy "Read published atmosphere runs"
  on public.cstar_atmosphere_runs for select to authenticated
  using (status = 'published');
drop policy if exists "Read published atmosphere cells" on public.cstar_atmosphere_cells;
create policy "Read published atmosphere cells"
  on public.cstar_atmosphere_cells for select to authenticated
  using (exists (
    select 1 from public.cstar_atmosphere_runs as run
    where run.run_id = cstar_atmosphere_cells.run_id and run.status = 'published'
  ));

-- A failed import leaves a staging run invisible. Publication checks its count.
create or replace function public.guard_cstar_atmosphere_run()
returns trigger language plpgsql set search_path = '' as $$
declare actual_count bigint;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'staging' or new.published_at is not null then
      raise exception 'Atmosphere runs must start in staging';
    end if;
    return new;
  end if;
  if old.status = 'published' then
    raise exception 'Published atmosphere runs are immutable';
  end if;
  if new.run_id <> old.run_id then
    raise exception 'Atmosphere run ID cannot change';
  end if;
  if new.status = 'published' then
    select count(*) into actual_count
    from public.cstar_atmosphere_cells where run_id = new.run_id;
    if actual_count <> new.total_cell_months then
      raise exception 'Atmosphere run row count % does not match manifest %',
        actual_count, new.total_cell_months;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_atmosphere_run on public.cstar_atmosphere_runs;
create trigger guard_atmosphere_run before insert or update on public.cstar_atmosphere_runs
  for each row execute function public.guard_cstar_atmosphere_run();

create or replace function public.guard_cstar_atmosphere_cell()
returns trigger language plpgsql set search_path = '' as $$
declare run_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select status into run_status from public.cstar_atmosphere_runs where run_id = old.run_id;
    if run_status = 'published' then
      raise exception 'Published atmosphere cells are immutable';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    select status into run_status from public.cstar_atmosphere_runs where run_id = new.run_id;
    if run_status <> 'staging' then
      raise exception 'Atmosphere cells can only be imported into staging runs';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_atmosphere_cell on public.cstar_atmosphere_cells;
create trigger guard_atmosphere_cell before insert or update or delete
  on public.cstar_atmosphere_cells for each row
  execute function public.guard_cstar_atmosphere_cell();

revoke execute on function public.guard_cstar_atmosphere_run() from public, anon, authenticated;
revoke execute on function public.guard_cstar_atmosphere_cell() from public, anon, authenticated;
grant execute on function public.guard_cstar_atmosphere_run() to service_role;
grant execute on function public.guard_cstar_atmosphere_cell() to service_role;

commit;
