-- Authenticated portal foundation. Apply after the existing workspace,
-- atmosphere, and prototype-data migrations.
begin;

create table if not exists public.cstar_jurisdictions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 200),
  code text not null unique check (length(trim(code)) between 1 and 40),
  level text not null default 'LOCAL' check (level in ('NATIONAL', 'REGION', 'PROVINCE', 'CITY', 'MUNICIPALITY', 'BARANGAY', 'LOCAL')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cstar_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'CSTAR User' check (length(trim(name)) between 1 and 100),
  email text not null,
  role text not null default 'RESIDENT' check (role in ('ADMIN', 'LGU', 'RESEARCHER', 'RESIDENT')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  approval_status text not null default 'NOT_REQUIRED'
    check (approval_status in ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')),
  jurisdiction_id uuid references public.cstar_jurisdictions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cstar_profiles_role_status_idx
  on public.cstar_profiles (role, status);
create index if not exists cstar_profiles_jurisdiction_idx
  on public.cstar_profiles (jurisdiction_id);

-- Role claims are stored in the database, never taken from signup metadata or JWT
-- user metadata. Auth-triggered profiles always begin as ordinary residents.
create or replace function public.create_cstar_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.cstar_profiles (user_id, name, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'CSTAR User'),
    coalesce(new.email, '')
  )
  on conflict (user_id) do update
    set email = excluded.email,
        name = case when excluded.name <> 'CSTAR User'
          then excluded.name else public.cstar_profiles.name end,
        updated_at = now();
  return new;
end;
$$;
drop trigger if exists cstar_auth_user_profile on auth.users;
create trigger cstar_auth_user_profile
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.create_cstar_profile_for_auth_user();

-- SECURITY DEFINER helpers avoid recursive profile RLS lookups inside policies.
create or replace function public.cstar_has_role(allowed_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cstar_profiles p
    where p.user_id = auth.uid()
      and p.status = 'ACTIVE'
      and p.role = any (allowed_roles)
  );
$$;
create or replace function public.cstar_current_jurisdiction()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.jurisdiction_id
  from public.cstar_profiles p
  join public.cstar_jurisdictions j on j.id = p.jurisdiction_id and j.status = 'ACTIVE'
  where p.user_id = auth.uid() and p.status = 'ACTIVE'
  limit 1;
$$;
create or replace function public.cstar_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cstar_profiles p
    where p.user_id = auth.uid() and p.status = 'ACTIVE'
  );
$$;
revoke all on function public.cstar_has_role(text[]) from public, anon;
revoke all on function public.cstar_current_jurisdiction() from public, anon;
revoke all on function public.cstar_is_active() from public, anon;
grant execute on function public.cstar_has_role(text[]) to authenticated;
grant execute on function public.cstar_current_jurisdiction() to authenticated;
grant execute on function public.cstar_is_active() to authenticated;

create table if not exists public.cstar_community_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  jurisdiction_id uuid not null references public.cstar_jurisdictions(id) on delete restrict,
  assigned_to uuid references public.cstar_profiles(user_id) on delete set null,
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null check (length(trim(description)) between 1 and 10000),
  location jsonb not null default '{}'::jsonb check (jsonb_typeof(location) = 'object'),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'UNDER_REVIEW', 'ACTION_PLANNED', 'RESOLVED', 'REJECTED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cstar_reports_jurisdiction_status_idx
  on public.cstar_community_reports (jurisdiction_id, status, created_at desc);
create index if not exists cstar_reports_owner_idx
  on public.cstar_community_reports (owner_id, created_at desc);

create table if not exists public.cstar_action_plans (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.cstar_jurisdictions(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 10000),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cstar_action_plans_jurisdiction_idx
  on public.cstar_action_plans (jurisdiction_id, status);

create table if not exists public.cstar_publications (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid references public.cstar_jurisdictions(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null check (length(trim(title)) between 1 and 200),
  summary text not null default '' check (length(summary) <= 10000),
  url text not null check (url ~ '^https?://'),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cstar_publications_jurisdiction_idx
  on public.cstar_publications (jurisdiction_id, published_at desc);

create table if not exists public.cstar_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cstar_audit_log_created_idx
  on public.cstar_audit_log (created_at desc);

-- Any committed portal mutation is auditable, including writes made through
-- Supabase directly. Sensitive report descriptions and precise locations are
-- intentionally excluded from snapshots.
create or replace function public.audit_cstar_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_row jsonb;
  new_row jsonb;
  resource text;
  resource_id_value text;
begin
  if tg_op <> 'INSERT' then
    old_row := to_jsonb(old) - 'description' - 'location';
  end if;
  if tg_op <> 'DELETE' then
    new_row := to_jsonb(new) - 'description' - 'location';
  end if;
  resource := case
    when tg_table_name = 'cstar_profiles' then 'profile'
    when tg_table_name = 'cstar_jurisdictions' then 'jurisdiction'
    when tg_table_name = 'cstar_community_reports' then 'community_report'
    when tg_table_name = 'cstar_action_plans' then 'action_plan'
    else 'publication'
  end;
  resource_id_value := coalesce(new_row ->> 'user_id', new_row ->> 'id', old_row ->> 'user_id', old_row ->> 'id');
  insert into public.cstar_audit_log
    (actor_id, action, resource_type, resource_id, before_data, after_data)
  values (
    auth.uid(),
    lower(tg_op),
    resource,
    resource_id_value,
    old_row,
    new_row
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.guard_cstar_profile_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare remaining_admins bigint;
begin
  if new.user_id <> old.user_id then
    raise exception 'Profile owner cannot change';
  end if;
  if old.role = 'ADMIN' and old.status = 'ACTIVE'
      and (new.role <> 'ADMIN' or new.status <> 'ACTIVE') then
    select count(*) into remaining_admins
      from public.cstar_profiles
      where role = 'ADMIN' and status = 'ACTIVE' and user_id <> old.user_id;
    if remaining_admins = 0 then
      raise exception 'Cannot suspend or demote the last active administrator';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists guard_cstar_profile_update on public.cstar_profiles;
create trigger guard_cstar_profile_update before update on public.cstar_profiles
  for each row execute function public.guard_cstar_profile_update();

create or replace function public.guard_cstar_report()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  assigned_role text;
  assigned_status text;
  assigned_jurisdiction uuid;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.owner_id <> auth.uid() then
      raise exception 'Report owner must be the current user';
    end if;
    if new.status <> 'PENDING' then
      raise exception 'New community reports must start in pending status';
    end if;
    if not public.cstar_has_role(array['ADMIN']) and
       new.jurisdiction_id is distinct from public.cstar_current_jurisdiction() then
      raise exception 'Report must belong to the current jurisdiction';
    end if;
    return new;
  end if;
  if new.owner_id <> old.owner_id or new.jurisdiction_id <> old.jurisdiction_id then
    raise exception 'Report owner and jurisdiction cannot change';
  end if;
  if new.status <> old.status and not (
    (old.status = 'PENDING' and new.status in ('UNDER_REVIEW', 'REJECTED')) or
    (old.status = 'UNDER_REVIEW' and new.status in ('ACTION_PLANNED', 'RESOLVED', 'REJECTED')) or
    (old.status = 'ACTION_PLANNED' and new.status in ('UNDER_REVIEW', 'RESOLVED'))
  ) then
    raise exception 'Invalid community report status transition';
  end if;
  if new.assigned_to is distinct from old.assigned_to and new.assigned_to is not null then
    select role, status, jurisdiction_id
      into assigned_role, assigned_status, assigned_jurisdiction
      from public.cstar_profiles where user_id = new.assigned_to;
    if assigned_status <> 'ACTIVE' or assigned_role not in ('LGU', 'RESEARCHER')
        or assigned_jurisdiction is distinct from new.jurisdiction_id then
      raise exception 'Assignee must be active LGU or researcher in the report jurisdiction';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists guard_cstar_community_report on public.cstar_community_reports;
create trigger guard_cstar_community_report
  before insert or update on public.cstar_community_reports
  for each row execute function public.guard_cstar_report();

create or replace function public.stamp_cstar_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stamp_cstar_jurisdiction on public.cstar_jurisdictions;
create trigger stamp_cstar_jurisdiction before update on public.cstar_jurisdictions
  for each row execute function public.stamp_cstar_updated_at();
drop trigger if exists stamp_cstar_action_plan on public.cstar_action_plans;
create trigger stamp_cstar_action_plan before update on public.cstar_action_plans
  for each row execute function public.stamp_cstar_updated_at();
drop trigger if exists stamp_cstar_publication on public.cstar_publications;
create trigger stamp_cstar_publication before update on public.cstar_publications
  for each row execute function public.stamp_cstar_updated_at();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'cstar_jurisdictions', 'cstar_profiles', 'cstar_community_reports',
    'cstar_action_plans', 'cstar_publications'
  ] loop
    execute format('drop trigger if exists audit_%I on public.%I', table_name, table_name);
    execute format(
      'create trigger audit_%I after insert or update or delete on public.%I for each row execute function public.audit_cstar_row_change()',
      table_name, table_name
    );
  end loop;
end;
$$;

insert into public.cstar_profiles (user_id, name, email)
select
  u.id,
  coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), 'CSTAR User'),
  coalesce(u.email, '')
from auth.users u
on conflict (user_id) do nothing;

alter table public.cstar_jurisdictions enable row level security;
alter table public.cstar_profiles enable row level security;
alter table public.cstar_community_reports enable row level security;
alter table public.cstar_action_plans enable row level security;
alter table public.cstar_publications enable row level security;
alter table public.cstar_audit_log enable row level security;

revoke all on public.cstar_jurisdictions from anon, authenticated;
revoke all on public.cstar_profiles from anon, authenticated;
revoke all on public.cstar_community_reports from anon, authenticated;
revoke all on public.cstar_action_plans from anon, authenticated;
revoke all on public.cstar_publications from anon, authenticated;
revoke all on public.cstar_audit_log from anon, authenticated;

grant select, insert, update, delete on public.cstar_jurisdictions to authenticated;
grant select on public.cstar_profiles to authenticated;
grant update (name, role, status, approval_status, jurisdiction_id)
  on public.cstar_profiles to authenticated;
grant select, insert on public.cstar_community_reports to authenticated;
grant update (assigned_to, status) on public.cstar_community_reports to authenticated;
grant select, insert on public.cstar_action_plans to authenticated;
grant update (status) on public.cstar_action_plans to authenticated;
grant select, insert, update, delete on public.cstar_publications to authenticated;
grant select on public.cstar_audit_log to authenticated;

grant select, insert, update, delete on public.cstar_jurisdictions to service_role;
grant select, insert, update, delete on public.cstar_profiles to service_role;
grant select, insert, update, delete on public.cstar_community_reports to service_role;
grant select, insert, update, delete on public.cstar_action_plans to service_role;
grant select, insert, update, delete on public.cstar_publications to service_role;
grant select, insert, update, delete on public.cstar_audit_log to service_role;
grant usage, select on sequence public.cstar_audit_log_id_seq to service_role;

drop policy if exists "Read portal jurisdictions" on public.cstar_jurisdictions;
create policy "Read portal jurisdictions" on public.cstar_jurisdictions
  for select to authenticated using (
    public.cstar_has_role(array['ADMIN']) or
    id = (select public.cstar_current_jurisdiction())
  );
drop policy if exists "Admin manages jurisdictions" on public.cstar_jurisdictions;
create policy "Admin manages jurisdictions" on public.cstar_jurisdictions
  for all to authenticated
  using (public.cstar_has_role(array['ADMIN']))
  with check (public.cstar_has_role(array['ADMIN']));

drop policy if exists "Read own or admin profiles" on public.cstar_profiles;
create policy "Read own or admin profiles" on public.cstar_profiles
  for select to authenticated using (
    user_id = (select auth.uid()) or public.cstar_has_role(array['ADMIN'])
  );
drop policy if exists "Admin updates profiles" on public.cstar_profiles;
create policy "Admin updates profiles" on public.cstar_profiles
  for update to authenticated
  using (public.cstar_has_role(array['ADMIN']))
  with check (public.cstar_has_role(array['ADMIN']));

drop policy if exists "Read scoped community reports" on public.cstar_community_reports;
create policy "Read scoped community reports" on public.cstar_community_reports
  for select to authenticated using (
    public.cstar_has_role(array['ADMIN']) or
    (public.cstar_is_active() and (
      owner_id = (select auth.uid()) or
      (public.cstar_has_role(array['LGU', 'RESEARCHER']) and
       jurisdiction_id = (select public.cstar_current_jurisdiction()))
    ))
  );
drop policy if exists "Residents create own reports" on public.cstar_community_reports;
create policy "Residents create own reports" on public.cstar_community_reports
  for insert to authenticated with check (
    owner_id = (select auth.uid()) and
    (
      public.cstar_has_role(array['ADMIN']) or
      (jurisdiction_id = (select public.cstar_current_jurisdiction()) and
       public.cstar_has_role(array['RESIDENT']))
    )
  );
drop policy if exists "Admin or jurisdiction LGU updates reports" on public.cstar_community_reports;
create policy "Admin or jurisdiction LGU updates reports" on public.cstar_community_reports
  for update to authenticated
  using (
    public.cstar_has_role(array['ADMIN']) or
    (public.cstar_has_role(array['LGU']) and
      jurisdiction_id = (select public.cstar_current_jurisdiction()))
  )
  with check (
    public.cstar_has_role(array['ADMIN']) or
    (public.cstar_has_role(array['LGU']) and
      jurisdiction_id = (select public.cstar_current_jurisdiction()))
  );

drop policy if exists "Read scoped action plans" on public.cstar_action_plans;
create policy "Read scoped action plans" on public.cstar_action_plans
  for select to authenticated using (
    public.cstar_has_role(array['ADMIN']) or
    (public.cstar_has_role(array['LGU', 'RESEARCHER']) and
      jurisdiction_id = (select public.cstar_current_jurisdiction()))
  );
drop policy if exists "Admin or LGU create action plans" on public.cstar_action_plans;
create policy "Admin or LGU create action plans" on public.cstar_action_plans
  for insert to authenticated with check (
    created_by = (select auth.uid()) and (
      public.cstar_has_role(array['ADMIN']) or
      (public.cstar_has_role(array['LGU']) and
        jurisdiction_id = (select public.cstar_current_jurisdiction()))
    )
  );
drop policy if exists "Admin or LGU update action plans" on public.cstar_action_plans;
create policy "Admin or LGU update action plans" on public.cstar_action_plans
  for update to authenticated
  using (
    public.cstar_has_role(array['ADMIN']) or
    (public.cstar_has_role(array['LGU']) and
      jurisdiction_id = (select public.cstar_current_jurisdiction()))
  )
  with check (
    public.cstar_has_role(array['ADMIN']) or
    (public.cstar_has_role(array['LGU']) and
      jurisdiction_id = (select public.cstar_current_jurisdiction()))
  );

drop policy if exists "Read scoped publications" on public.cstar_publications;
create policy "Read scoped publications" on public.cstar_publications
  for select to authenticated using (
    public.cstar_is_active() and (
      public.cstar_has_role(array['ADMIN']) or jurisdiction_id is null or
      jurisdiction_id = (select public.cstar_current_jurisdiction())
    )
  );
drop policy if exists "Admin manages publications" on public.cstar_publications;
create policy "Admin manages publications" on public.cstar_publications
  for all to authenticated
  using (public.cstar_has_role(array['ADMIN']))
  with check (public.cstar_has_role(array['ADMIN']));

drop policy if exists "Admin reads audit log" on public.cstar_audit_log;
create policy "Admin reads audit log" on public.cstar_audit_log
  for select to authenticated using (public.cstar_has_role(array['ADMIN']));

revoke all on function public.create_cstar_profile_for_auth_user() from public, anon, authenticated;
revoke all on function public.audit_cstar_row_change() from public, anon, authenticated;
revoke all on function public.guard_cstar_profile_update() from public, anon, authenticated;
revoke all on function public.guard_cstar_report() from public, anon, authenticated;
revoke all on function public.stamp_cstar_updated_at() from public, anon, authenticated;

commit;
