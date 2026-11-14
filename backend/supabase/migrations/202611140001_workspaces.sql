-- Run in the SQL editor of your Supabase project (or `supabase db push`).
begin;

create table if not exists public.cstar_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check (
    jsonb_typeof(data) = 'object'
    and data ?& array['events', 'records', 'region', 'profile']
    and jsonb_typeof(data->'events') = 'array'
    and jsonb_typeof(data->'records') = 'array'
    and jsonb_typeof(data->'profile') = 'object'
    and jsonb_typeof(data->'region') = 'string'
  ),
  version integer not null default 0 check (version >= 0),
  updated_at timestamptz not null default now()
);

alter table public.cstar_workspaces enable row level security;
revoke all on public.cstar_workspaces from anon;
revoke all on public.cstar_workspaces from authenticated;
grant select, insert, update on public.cstar_workspaces to authenticated;

drop policy if exists "Read own workspace" on public.cstar_workspaces;
create policy "Read own workspace" on public.cstar_workspaces for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Create own workspace" on public.cstar_workspaces;
create policy "Create own workspace" on public.cstar_workspaces for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "Update own workspace" on public.cstar_workspaces;
create policy "Update own workspace" on public.cstar_workspaces for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.stamp_cstar_workspace_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.user_id <> old.user_id then
    raise exception 'Workspace owner cannot change';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'Workspace version must increase by one';
  end if;
  return new;
end;
$$;
drop trigger if exists workspace_update on public.cstar_workspaces;
create trigger workspace_update before update on public.cstar_workspaces
  for each row execute function public.stamp_cstar_workspace_update();

commit;
