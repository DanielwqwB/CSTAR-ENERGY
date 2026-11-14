-- Shared demonstration catalog and chart series. These rows are not
-- measurements and must not be used for scientific inference or model training.
begin;

create table if not exists public.cstar_demo_dataset_catalog (
  dataset_id text primary key,
  sort_order smallint not null unique check (sort_order > 0),
  name text not null unique,
  product text not null,
  scale text not null,
  status text not null check (status in ('Ready', 'Partial', 'Review')),
  description text not null,
  classification text not null default 'synthetic_demo'
    check (classification = 'synthetic_demo')
);

create table if not exists public.cstar_demo_monthly_series (
  period_start date primary key check (
    period_start between date '2024-01-01' and date '2024-12-01'
    and extract(day from period_start) = 1
  ),
  radiance double precision not null,
  adjusted double precision not null,
  no2 double precision not null,
  counter double precision not null,
  classification text not null default 'synthetic_demo'
    check (classification = 'synthetic_demo')
);

alter table public.cstar_demo_dataset_catalog enable row level security;
alter table public.cstar_demo_monthly_series enable row level security;
revoke all on public.cstar_demo_dataset_catalog from anon, authenticated;
revoke all on public.cstar_demo_monthly_series from anon, authenticated;
grant select on public.cstar_demo_dataset_catalog to authenticated;
grant select on public.cstar_demo_monthly_series to authenticated;

drop policy if exists "Read demo dataset catalog" on public.cstar_demo_dataset_catalog;
create policy "Read demo dataset catalog"
  on public.cstar_demo_dataset_catalog for select to authenticated
  using (true);
drop policy if exists "Read demo monthly series" on public.cstar_demo_monthly_series;
create policy "Read demo monthly series"
  on public.cstar_demo_monthly_series for select to authenticated
  using (true);

insert into public.cstar_demo_dataset_catalog
  (dataset_id, sort_order, name, product, scale, status, description)
values
  ('black-marble', 1, 'NASA Black Marble', 'VNP46A2', '~500 m grid product', 'Ready', 'Nighttime radiance and quality flags'),
  ('tropomi-no2', 2, 'Sentinel-5P TROPOMI', 'L2 NO₂', 'Kilometer-scale atmospheric footprint', 'Partial', 'Tropospheric column; not street-level'),
  ('merra-weather', 3, 'NASA MERRA-2 / GEOS-FP', 'Meteorology', 'Gridded reanalysis / forecast', 'Ready', 'Wind and meteorological context'),
  ('sentinel-2', 4, 'Sentinel-2', 'L2A', '10–20 m context layers', 'Ready', 'Land cover and construction context'),
  ('local-records', 5, 'Verified local records', 'Registry v0.4', 'Document-level', 'Review', 'Illustrative intervention records')
on conflict (dataset_id) do update set
  sort_order = excluded.sort_order,
  name = excluded.name,
  product = excluded.product,
  scale = excluded.scale,
  status = excluded.status,
  description = excluded.description;

insert into public.cstar_demo_monthly_series
  (period_start, radiance, adjusted, no2, counter)
values
  ('2024-01-01', 45, 44, 18, 44),
  ('2024-02-01', 46, 45, 17, 45),
  ('2024-03-01', 47, 45, 19, 46),
  ('2024-04-01', 50, 49, 21, 47),
  ('2024-05-01', 54, 52, 23, 48),
  ('2024-06-01', 58, 56, 24, 49),
  ('2024-07-01', 61, 59, 26, 50),
  ('2024-08-01', 64, 62, 27, 51),
  ('2024-09-01', 65, 63, 25, 52),
  ('2024-10-01', 66, 64, 28, 53),
  ('2024-11-01', 67, 65, 26, 54),
  ('2024-12-01', 68, 66, 27, 55)
on conflict (period_start) do update set
  radiance = excluded.radiance,
  adjusted = excluded.adjusted,
  no2 = excluded.no2,
  counter = excluded.counter;

commit;
