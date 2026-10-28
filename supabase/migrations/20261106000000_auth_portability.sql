-- Auth portability (providers phase 9a).
--
-- 1. Foreign keys to auth.users are repointed at public.users(id). Built-in,
--    OIDC and SAML users have no auth.users row (and a non-Supabase Postgres
--    has no auth schema at all), so nothing in public may reference it:
--
--      users.id                         FK dropped (users.id stays the PK; the
--                                       id is the auth provider's user id)
--      user_roles.user_id               → users(id) ON DELETE CASCADE
--      agents.created_by                → users(id)            (NO ACTION, as before)
--      form_template_versions.published_by → users(id)         (NO ACTION; when the table exists)
--      reports.created_by               → users(id) ON DELETE SET NULL
--      workspace_themes.updated_by      → users(id) ON DELETE SET NULL
--
--    Constraint names are unchanged. The new FKs are added NOT VALID and then
--    validated when existing rows allow it: rows that reference an auth user
--    without a public.users row (possible in old data) keep working, and every
--    new row is checked.
--
-- 2. Deletion semantics for Supabase Auth are kept by a trigger instead of the
--    old ON DELETE CASCADE: deleting an auth.users row deletes its public.users
--    row (and any orphaned user_roles rows), which cascades / sets null / is
--    blocked exactly as the FKs to auth.users did. Created only when the auth
--    schema exists.
--
-- 3. public.provision_auth_user(): the personal-workspace provisioning that the
--    on_auth_user_created trigger (handle_new_user) did, as an idempotent
--    function. The Supabase trigger now calls it, and the app calls it for
--    built-in / OIDC / SAML users (lib/providers/auth/provisioning.ts), so the
--    two paths can never double-create: a user that already has a
--    public.users row is left alone. Service role only.
--
-- RLS policies are untouched (auth.uid() reads the JWT claims, whichever
-- provider issued them). Idempotent.

-- Production applies this while the app serves traffic: the FK changes take ACCESS EXCLUSIVE on public.users (and the trigger
-- briefly locks auth.users). Fail fast
-- instead of queueing every query behind a long-running transaction; re-run
-- the push if it times out (the file is idempotent).
SET lock_timeout = '5s';

-- ── 1. FK repoint ────────────────────────────────────────────────────────────
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_id_fkey;

-- Tables that a later migration dropped (form_template_versions) are skipped.
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN SELECT * FROM (VALUES
    ('user_roles', 'user_id', 'user_roles_user_id_fkey', ' ON DELETE CASCADE'),
    ('agents', 'created_by', 'agents_created_by_fkey', ''),
    ('form_template_versions', 'published_by', 'form_template_versions_published_by_fkey', ''),
    ('reports', 'created_by', 'reports_created_by_fkey', ' ON DELETE SET NULL'),
    ('workspace_themes', 'updated_by', 'workspace_themes_updated_by_fkey', ' ON DELETE SET NULL')
  ) AS t(tbl, col, con, on_delete) LOOP
    CONTINUE WHEN to_regclass(format('public.%I', v.tbl)) IS NULL;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', v.tbl, v.con);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.users(id)%s NOT VALID',
                   v.tbl, v.con, v.col, v.on_delete);
    BEGIN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', v.tbl, v.con);
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'auth_portability: % has rows without a public.users row; % stays NOT VALID (new rows are still checked)', v.tbl, v.con;
    END;
  END LOOP;
END $$;

-- ── 2. Supabase Auth deletions ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_auth_user_deleted() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- What ON DELETE CASCADE from auth.users used to do.
  DELETE FROM public.user_roles WHERE user_id = OLD.id;
  DELETE FROM public.users WHERE id = OLD.id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_auth_user_deleted() FROM PUBLIC;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users';
    EXECUTE 'CREATE TRIGGER on_auth_user_deleted AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_deleted()';
  END IF;
END $$;

-- ── 3. Idempotent user provisioning ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.provision_auth_user(
  p_user_id uuid,
  p_email text,
  p_display_name text DEFAULT NULL,
  p_provider text DEFAULT 'email'
) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tenant_id uuid;
  v_display_name text;
BEGIN
  -- One provisioning per user even when the trigger and the app race.
  PERFORM pg_advisory_xact_lock(hashtextextended('provision_auth_user:' || p_user_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RETURN false;
  END IF;

  v_display_name := COALESCE(NULLIF(btrim(p_display_name), ''), split_part(p_email, '@', 1));

  INSERT INTO public.tenants (name, slug, plan, auth_provider)
  VALUES (
    v_display_name || '''s Workspace',
    'personal-' || substr(p_user_id::text, 1, 8),
    'personal_free',
    CASE p_provider
      WHEN 'google' THEN 'google'::public.auth_provider
      WHEN 'azure_ad' THEN 'azure_ad'::public.auth_provider
      WHEN 'saml' THEN 'saml'::public.auth_provider
      ELSE 'email'::public.auth_provider
    END
  ) RETURNING id INTO v_tenant_id;

  INSERT INTO public.users (id, tenant_id, email, display_name, role, current_tenant_id)
  VALUES (p_user_id, v_tenant_id, p_email, v_display_name, 'owner', v_tenant_id);

  INSERT INTO public.user_memberships (user_id, tenant_id, role, is_home)
  VALUES (p_user_id, v_tenant_id, 'owner', true);

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.provision_auth_user(uuid, text, text, text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.provision_auth_user(uuid, text, text, text) FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION public.handle_auth_user_deleted() FROM anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.provision_auth_user(uuid, text, text, text) TO service_role';
  END IF;
END $$;

-- The Supabase trigger keeps its behaviour through the shared function.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.provision_auth_user(
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    CASE WHEN NEW.raw_app_meta_data->>'provider' = 'google' THEN 'google' ELSE 'email' END
  );
  RETURN NEW;
END;
$$;

RESET lock_timeout;
