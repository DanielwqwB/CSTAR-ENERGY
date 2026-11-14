  -- Run after 202611140002_atmosphere.sql in the Supabase SQL editor as postgres.
  -- All test rows are rolled back.
  begin;

  insert into public.cstar_atmosphere_runs
    (run_id, manifest, model_name, anomaly_interpretation, start_month, end_month, total_cell_months)
  values
    (repeat('a', 64), '{}', 'spatial_seasonal_climatology', 'climatology residual', '2025-01-01', '2025-01-01', 1),
    (repeat('b', 64), '{}', 'spatial_seasonal_climatology', 'climatology residual', '2025-01-01', '2025-01-01', 2);
  insert into public.cstar_atmosphere_cells
    (run_id, month, cell_id, latitude, longitude, observation_status,
    valid_orbit_count, valid_pixel_count, coverage_fraction,
    expected_no2_umol_m2, observed_no2_umol_m2, anomaly_umol_m2)
  values
    (repeat('a', 64), '2025-01-01', 'cell-a', 13.0, 123.0, 'valid', 7, 20, 0.2, 10.0, 11.0, 1.0),
    (repeat('b', 64), '2025-01-01', 'cell-b', 13.0, 123.1, 'no_observation', 0, 0, 0, 9.0, null, null);
  update public.cstar_atmosphere_runs
  set status = 'published', published_at = now()
  where run_id = repeat('a', 64);
  do $$
  declare blocked boolean := false;
  begin
    begin
      update public.cstar_atmosphere_runs
      set status = 'published', published_at = now()
      where run_id = repeat('b', 64);
    exception when others then
      if sqlerrm not like 'Atmosphere run row count%' then raise; end if;
      blocked := true;
    end;
    if not blocked then raise exception 'Incomplete atmosphere run was published'; end if;
  end;
  $$;

  set local role authenticated;
  do $$
  begin
    if (select count(*) from public.cstar_atmosphere_runs) <> 1 then
      raise exception 'Authenticated user could see staging atmosphere run';
    end if;
    if (select count(*) from public.cstar_atmosphere_cells) <> 1 then
      raise exception 'Authenticated user could see staging atmosphere cells';
    end if;
    begin
      update public.cstar_atmosphere_cells set expected_no2_umol_m2 = 0;
      raise exception 'Authenticated user could update scientific observations';
    exception when insufficient_privilege then null;
    end;
  end;
  $$;
  reset role;

  set local role anon;
  do $$
  begin
    begin
      perform count(*) from public.cstar_atmosphere_cells;
      raise exception 'Unsigned user could read atmosphere data';
    exception when insufficient_privilege then null;
    end;
  end;
  $$;
  reset role;
  rollback;
