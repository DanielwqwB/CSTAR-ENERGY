-- Run after all migrations in Supabase SQL Editor as postgres.
-- All inserted users and portal data are rolled back.
begin;

insert into auth.users (id, aud, role, email, raw_user_meta_data) values
  ('e1100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'portal-admin@example.invalid', '{}'),
  ('e1100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'portal-lgu@example.invalid', '{}'),
  ('e1100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'portal-resident-a@example.invalid', '{"role":"ADMIN"}'),
  ('e1100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'portal-resident-b@example.invalid', '{}');

insert into public.cstar_jurisdictions (id, name, code, level) values
  ('e2200000-0000-4000-8000-000000000001', 'Portal Test Area A', 'PORTAL-TEST-A', 'CITY'),
  ('e2200000-0000-4000-8000-000000000002', 'Portal Test Area B', 'PORTAL-TEST-B', 'CITY');

update public.cstar_profiles
set role = case user_id
  when 'e1100000-0000-4000-8000-000000000001' then 'ADMIN'
  when 'e1100000-0000-4000-8000-000000000002' then 'LGU'
  else 'RESIDENT'
end,
status = 'ACTIVE',
jurisdiction_id = case user_id
  when 'e1100000-0000-4000-8000-000000000002' then 'e2200000-0000-4000-8000-000000000001'::uuid
  when 'e1100000-0000-4000-8000-000000000003' then 'e2200000-0000-4000-8000-000000000001'::uuid
  when 'e1100000-0000-4000-8000-000000000004' then 'e2200000-0000-4000-8000-000000000002'::uuid
  else null
end;

select set_config('request.jwt.claim.sub', 'e1100000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"e1100000-0000-4000-8000-000000000003","role":"authenticated"}', true);
insert into public.cstar_community_reports
  (id, owner_id, jurisdiction_id, title, description)
values (
  'e3300000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000003',
  'e2200000-0000-4000-8000-000000000001',
  'Area A report',
  'Test report'
);
select set_config('request.jwt.claim.sub', 'e1100000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"e1100000-0000-4000-8000-000000000004","role":"authenticated"}', true);
insert into public.cstar_community_reports
  (id, owner_id, jurisdiction_id, title, description)
values (
  'e3300000-0000-4000-8000-000000000002',
  'e1100000-0000-4000-8000-000000000004',
  'e2200000-0000-4000-8000-000000000002',
  'Area B report',
  'Test report'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1100000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"e1100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
declare
  affected integer;
begin
  if (select count(*) from public.cstar_community_reports) <> 1 then
    raise exception 'LGU can read reports outside its jurisdiction';
  end if;
  update public.cstar_community_reports
    set status = 'UNDER_REVIEW'
    where id = 'e3300000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Jurisdiction LGU cannot update its report'; end if;
  update public.cstar_profiles
    set role = 'ADMIN'
    where user_id = 'e1100000-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'LGU could change its own role'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', 'e1100000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"e1100000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
declare
  affected integer;
  rejected boolean := false;
begin
  if (select count(*) from public.cstar_community_reports) <> 1 then
    raise exception 'Resident can read another jurisdiction report';
  end if;
  update public.cstar_community_reports
    set status = 'RESOLVED'
    where id = 'e3300000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Resident could update a report status'; end if;
  begin
    insert into public.cstar_community_reports
      (owner_id, jurisdiction_id, title, description)
    values (
      'e1100000-0000-4000-8000-000000000003',
      'e2200000-0000-4000-8000-000000000002',
      'Forged jurisdiction',
      'This insert must be rejected'
    );
  exception when others then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Resident could file a report outside their jurisdiction';
  end if;
  if (select role from public.cstar_profiles
      where user_id = 'e1100000-0000-4000-8000-000000000003') <> 'RESIDENT' then
    raise exception 'Signup metadata elevated the resident role';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', 'e1100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"e1100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.cstar_profiles) <> 4 then
    raise exception 'Admin cannot list portal profiles';
  end if;
  if (select count(*) from public.cstar_community_reports) <> 2 then
    raise exception 'Admin cannot read all reports';
  end if;
  update public.cstar_profiles
    set role = 'RESEARCHER'
    where user_id = 'e1100000-0000-4000-8000-000000000004';
  if not found then raise exception 'Admin cannot update a profile role'; end if;
end;
$$;

reset role;
rollback;
