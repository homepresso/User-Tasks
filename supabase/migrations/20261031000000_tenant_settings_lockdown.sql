-- ============================================================================
-- 20261031000000_tenant_settings_lockdown.sql
--
-- Workspace settings are server-only writes.
--
-- 1. tenants: the `tenant_update` policy let ANY member (any role, incl.
--    viewers) PATCH their workspace row over PostgREST — name, slug, branding,
--    settings (theme policy, retention, …). Every legitimate writer now runs
--    on the server behind a `settings.edit` check with the service role
--    (lib/services/tenant-settings.ts, app/api/tenants/onboarding,
--    lib/tenant-provisioning.ts), so the policy is dropped instead of
--    narrowed: with RLS on and no UPDATE policy, end-user UPDATEs match no
--    rows (the service role bypasses RLS). A column-level or
--    permission-checking policy was not kept because the server path also
--    validates (logo URLs now, the brand theme schema next) and audits.
--
-- 2. users: the `users_update` policy lets a user change any column of their
--    own row, including tenant_id / current_tenant_id. Both feed
--    get_user_tenant_ids() / get_current_tenant_id(), so a PATCH of
--    current_tenant_id to another workspace's id was a self-service join of
--    that workspace. A trigger now rejects, for end-user roles only:
--      * any change of tenant_id (home tenant: invitations/provisioning set it
--        server-side), and
--      * a current_tenant_id that is not NULL (the unified view), the home
--        tenant or an active membership.
--    switch_tenant() (SECURITY DEFINER, checks membership itself) and the
--    service role are unaffected.
--
-- 3. logos storage: insert/update/delete required only a signed-in user, so
--    anyone could overwrite any workspace's logo. They now require the path's
--    first folder (`${tenantId}/logo.png`) to be a workspace the caller
--    belongs to AND `settings.edit` there. Reads stay public (public bucket).
-- ============================================================================

SET lock_timeout = '5s';

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- Home tenant or an active membership (deliberately NOT current_tenant_id,
-- which is user-writable state).
CREATE OR REPLACE FUNCTION public.is_active_tenant_member(p_tenant_id uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
    SELECT p_tenant_id IS NOT NULL AND auth.uid() IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.tenant_id = p_tenant_id)
      OR EXISTS (
        SELECT 1 FROM public.user_memberships m
         WHERE m.user_id = auth.uid() AND m.tenant_id = p_tenant_id AND m.is_active
      )
    )
  $$;

-- Membership + role permission in that tenant. Text input so storage paths
-- (`(storage.foldername(name))[1]`) can be passed as-is; non-uuids are false.
CREATE OR REPLACE FUNCTION public.user_has_tenant_permission(p_tenant text, p_permission text)
  RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_tenant uuid;
BEGIN
  IF p_tenant IS NULL OR p_tenant !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  v_tenant := p_tenant::uuid;
  RETURN public.is_active_tenant_member(v_tenant)
     AND p_permission = ANY (public.get_user_permissions(v_tenant));
END;
$$;

REVOKE ALL ON FUNCTION public.is_active_tenant_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.user_has_tenant_permission(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_tenant_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_tenant_permission(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_active_tenant_member(uuid) IS 'True when the caller''s home tenant is p_tenant_id or they hold an active membership there.';
COMMENT ON FUNCTION public.user_has_tenant_permission(text, text) IS 'True when the caller is an active member of tenant p_tenant (uuid text) and one of their roles there grants p_permission.';

-- ── 1. tenants: no direct end-user updates ─────────────────────────────────
DROP POLICY IF EXISTS tenant_update ON public.tenants;

-- ── 2. users: tenant columns are not self-service ──────────────────────────
-- SECURITY INVOKER on purpose: current_user is the caller's role here
-- (authenticated/anon via PostgREST; postgres inside SECURITY DEFINER
-- functions such as switch_tenant; service_role for server code).
CREATE OR REPLACE FUNCTION public.guard_user_tenant_columns()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'users.tenant_id cannot be changed directly'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.current_tenant_id IS DISTINCT FROM OLD.current_tenant_id
     AND NEW.current_tenant_id IS NOT NULL
     AND NEW.current_tenant_id IS DISTINCT FROM NEW.tenant_id
     AND NOT public.is_active_tenant_member(NEW.current_tenant_id) THEN
    RAISE EXCEPTION 'Not a member of this tenant'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_guard_tenant_columns ON public.users;
CREATE TRIGGER trg_users_guard_tenant_columns
  BEFORE UPDATE OF tenant_id, current_tenant_id ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_tenant_columns();

-- ── 3. logos storage ───────────────────────────────────────────────────────
-- Skipped where there is no Supabase Storage schema (plain Postgres; files
-- then live in the storage provider). Same statements inside the guard.
DO $storage$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage schema not found; skipping storage policies';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Users can upload logos" ON storage.objects;
  DROP POLICY IF EXISTS "Users can update logos" ON storage.objects;
  DROP POLICY IF EXISTS "Users can delete logos" ON storage.objects;

  DROP POLICY IF EXISTS "Workspace editors can upload logos" ON storage.objects;
  CREATE POLICY "Workspace editors can upload logos" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'logos' AND public.user_has_tenant_permission((storage.foldername(name))[1], 'settings.edit'));

  DROP POLICY IF EXISTS "Workspace editors can update logos" ON storage.objects;
  CREATE POLICY "Workspace editors can update logos" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'logos' AND public.user_has_tenant_permission((storage.foldername(name))[1], 'settings.edit'))
    WITH CHECK (bucket_id = 'logos' AND public.user_has_tenant_permission((storage.foldername(name))[1], 'settings.edit'));

  DROP POLICY IF EXISTS "Workspace editors can delete logos" ON storage.objects;
  CREATE POLICY "Workspace editors can delete logos" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'logos' AND public.user_has_tenant_permission((storage.foldername(name))[1], 'settings.edit'));
END $storage$;
