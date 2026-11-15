-- First SSO sign-in of someone an organisation brought in (identity provider
-- defaultOrg, or a pending directory entry such as a SharePoint site user):
-- create the account directly in that workspace — no personal workspace.
-- provision_auth_user (personal workspace first) stays for everyone else.
-- Additive and idempotent: a new function only.

CREATE OR REPLACE FUNCTION public.provision_auth_user_in(
  p_user_id uuid,
  p_email text,
  p_display_name text,
  p_provider text,
  p_tenant_id uuid
) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_display_name text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('provision_auth_user:' || p_user_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'workspace % not found', p_tenant_id USING ERRCODE = 'P0002';
  END IF;

  v_display_name := COALESCE(NULLIF(btrim(p_display_name), ''), split_part(p_email, '@', 1));

  -- The workspace role (RBAC) comes from the caller: identity provider role mapping / the directory source.
  INSERT INTO public.users (id, tenant_id, email, display_name, role, current_tenant_id)
  VALUES (p_user_id, p_tenant_id, p_email, v_display_name, 'member', p_tenant_id);

  INSERT INTO public.user_memberships (user_id, tenant_id, role, is_home)
  VALUES (p_user_id, p_tenant_id, 'member', true)
  ON CONFLICT (user_id, tenant_id) DO UPDATE SET is_home = true, is_active = true;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_auth_user_in(uuid, text, text, text, uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.provision_auth_user_in(uuid, text, text, text, uuid) FROM anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.provision_auth_user_in(uuid, text, text, text, uuid) TO service_role';
  END IF;
END $$;
