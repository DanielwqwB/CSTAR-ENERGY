-- Run AFTER the migration in the Supabase SQL editor, as the postgres role.
-- Test users and rows are rolled back. An assertion failure aborts the transaction.
begin;
insert into auth.users (id, aud, role, email) values
  ('f54abfa0-57ce-44e1-a538-6719f50bf501', 'authenticated', 'authenticated', 'cstar-rls-test-a@example.invalid'),
  ('f54abfa0-57ce-44e1-a538-6719f50bf502', 'authenticated', 'authenticated', 'cstar-rls-test-b@example.invalid'),
  ('f54abfa0-57ce-44e1-a538-6719f50bf503', 'authenticated', 'authenticated', 'cstar-rls-test-c@example.invalid');
insert into public.cstar_workspaces (user_id, data) values
  ('f54abfa0-57ce-44e1-a538-6719f50bf501', '{"events":[],"records":[],"region":"test-a","profile":{}}'),
  ('f54abfa0-57ce-44e1-a538-6719f50bf502', '{"events":[],"records":[],"region":"test-b","profile":{}}');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f54abfa0-57ce-44e1-a538-6719f50bf501', true);
select set_config('request.jwt.claims', '{"sub":"f54abfa0-57ce-44e1-a538-6719f50bf501","role":"authenticated"}', true);
do $$
declare affected integer;
begin
  if (select count(*) from public.cstar_workspaces) <> 1 then
    raise exception 'RLS did not isolate workspace reads';
  end if;
  update public.cstar_workspaces set version = version + 1
    where user_id = 'f54abfa0-57ce-44e1-a538-6719f50bf502';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'RLS allowed cross-user update'; end if;
  update public.cstar_workspaces set version = version + 1
    where user_id = 'f54abfa0-57ce-44e1-a538-6719f50bf501' and version = 0;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Own workspace update failed'; end if;
  update public.cstar_workspaces set version = version + 1
    where user_id = 'f54abfa0-57ce-44e1-a538-6719f50bf501' and version = 0;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Stale save was accepted'; end if;
  begin
    insert into public.cstar_workspaces(user_id, data) values
      ('f54abfa0-57ce-44e1-a538-6719f50bf503', '{"events":[],"records":[],"region":"forbidden","profile":{}}');
    raise exception 'RLS allowed cross-user insert';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role anon;
do $$
begin
  begin
    perform count(*) from public.cstar_workspaces;
    raise exception 'Unauthenticated access was allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
