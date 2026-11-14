-- Private source and checkpoint files for the operator-run atmosphere worker.
begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'cstar-atmosphere-inputs',
  'cstar-atmosphere-inputs',
  false,
  50000000,
  array[
    'application/gzip',
    'application/x-gzip',
    'application/geo+json',
    'application/json',
    'application/octet-stream',
    'application/x-joblib'
  ]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- A restrictive policy prevents broad client policies from exposing this bucket.
drop policy if exists "Deny client access to atmosphere inputs" on storage.objects;
create policy "Deny client access to atmosphere inputs"
  on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'cstar-atmosphere-inputs')
  with check (bucket_id <> 'cstar-atmosphere-inputs');

commit;
