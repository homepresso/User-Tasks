-- ============================================================================
-- 20261102000000_brand_fonts_bucket.sql
--
-- `brand-fonts`: woff2 files uploaded for a workspace theme
-- (lib/services/workspace-theme.ts uploadWorkspaceThemeFont, the theme
-- designer and POST /api/v1/workspace-theme/fonts). One folder per tenant:
-- `<tenant_id>/<family-slug>-<hash>.woff2`.
--
-- Public read (the server-rendered @font-face points at the public URL);
-- writes need membership + settings.edit for the path's tenant folder — the
-- same rule as the `logos` bucket (20261031000000_tenant_settings_lockdown).
-- The bucket itself only accepts font/woff2 up to 1 MB; the service checks
-- the woff2 signature and the size again before uploading.
-- ============================================================================

-- Skipped where there is no Supabase Storage schema (plain Postgres; files
-- then live in the storage provider). Same statements inside the guard.
do $storage$
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise notice 'storage schema not found; skipping the brand-fonts bucket';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('brand-fonts', 'brand-fonts', true, 1048576, array['font/woff2'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists "Public brand font access" on storage.objects;
  create policy "Public brand font access" on storage.objects
    for select using (bucket_id = 'brand-fonts');

  drop policy if exists "Workspace editors can upload brand fonts" on storage.objects;
  create policy "Workspace editors can upload brand fonts" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'brand-fonts' and public.user_has_tenant_permission((storage.foldername(name))[1], 'settings.edit'));

  drop policy if exists "Workspace editors can update brand fonts" on storage.objects;
  create policy "Workspace editors can update brand fonts" on storage.objects
    for update to authenticated
    using (bucket_id = 'brand-fonts' and public.user_has_tenant_permission((storage.foldername(name))[1], 'settings.edit'))
    with check (bucket_id = 'brand-fonts' and public.user_has_tenant_permission((storage.foldername(name))[1], 'settings.edit'));

  drop policy if exists "Workspace editors can delete brand fonts" on storage.objects;
  create policy "Workspace editors can delete brand fonts" on storage.objects
    for delete to authenticated
    using (bucket_id = 'brand-fonts' and public.user_has_tenant_permission((storage.foldername(name))[1], 'settings.edit'));
end $storage$;
