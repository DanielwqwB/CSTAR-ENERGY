-- Run after 202611150001_atmosphere_input_storage.sql as postgres.
begin;

do $$
declare
  bucket_public boolean;
  bucket_file_size_limit bigint;
begin
  select public, file_size_limit
  into bucket_public, bucket_file_size_limit
  from storage.buckets
  where id = 'cstar-atmosphere-inputs';

  if not found then
    raise exception 'Atmosphere input bucket is missing';
  end if;
  if bucket_public then
    raise exception 'Atmosphere input bucket must remain private';
  end if;
  if bucket_file_size_limit < 45151732 then
    raise exception 'Atmosphere input bucket cannot accept the current source table';
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Deny client access to atmosphere inputs'
      and permissive = 'RESTRICTIVE'
      and roles @> array['anon'::name, 'authenticated'::name]
      and qual like '%cstar-atmosphere-inputs%'
      and with_check like '%cstar-atmosphere-inputs%'
  ) then
    raise exception 'Client roles are not restricted from atmosphere input objects';
  end if;
end;
$$;

rollback;
