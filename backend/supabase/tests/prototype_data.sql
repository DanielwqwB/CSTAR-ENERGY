-- Run after 202611140003_prototype_data.sql in the Supabase SQL editor as postgres.
begin;

set local role authenticated;
do $$
begin
  if (select count(*) from public.cstar_demo_dataset_catalog) <> 5 then
    raise exception 'Authenticated user cannot read the seeded demo catalog';
  end if;
  if (select count(*) from public.cstar_demo_monthly_series) <> 12 then
    raise exception 'Authenticated user cannot read the 12-month demo series';
  end if;
  begin
    update public.cstar_demo_monthly_series set radiance = 0;
    raise exception 'Authenticated user could modify the demo series';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role anon;
do $$
begin
  begin
    perform count(*) from public.cstar_demo_dataset_catalog;
    raise exception 'Anonymous user could read the demo catalog';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
