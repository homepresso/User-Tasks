-- ============================================================================
-- 20261101000000_workspace_themes.sql
--
-- One brand theme per workspace, applied to every member (replaces the
-- personal theme picker, per-browser custom themes and
-- settings.theme_policy.allow_user_override).
--
-- * workspace_themes: tenant_id (PK), theme jsonb, version, updated_by,
--   updated_at. `theme` is either a full WorkspaceTheme (lib/theme/schema.ts)
--   or the stub {"base_preset": "<built-in id>"}, which the app expands from
--   its preset table (lib/theme/presets.ts) — so this SQL never has to
--   duplicate the preset contents, and an unknown id falls back to the
--   platform default at read time.
-- * RLS: active members (home tenant or active membership) can SELECT their
--   workspace's row. There is no INSERT/UPDATE/DELETE policy: writes go
--   through lib/services/workspace-theme.ts (settings.edit, schema +
--   contrast validation, audit, version check) with the service role.
-- * Every tenant gets a row: existing ones are seeded from their current
--   settings.theme_policy.default_theme_id (or 'basecamp', the platform
--   default), new ones by an AFTER INSERT trigger on tenants.
--
-- settings.theme_policy is left in place (no longer read) so a rollback of
-- the app keeps working.
-- ============================================================================

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.workspace_themes (
  tenant_id   uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  theme       jsonb NOT NULL DEFAULT '{"base_preset":"basecamp"}'::jsonb,
  version     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_themes_theme_is_object CHECK (jsonb_typeof(theme) = 'object'),
  CONSTRAINT workspace_themes_theme_size CHECK (pg_column_size(theme) <= 65536)
);

COMMENT ON TABLE public.workspace_themes IS 'The brand theme every member of a workspace sees. theme = WorkspaceTheme JSON or {"base_preset": id}; written only by the server (settings.edit).';

ALTER TABLE public.workspace_themes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_themes_select ON public.workspace_themes;
CREATE POLICY workspace_themes_select ON public.workspace_themes
  FOR SELECT TO authenticated
  USING (public.is_active_tenant_member(tenant_id));

REVOKE ALL ON public.workspace_themes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.workspace_themes FROM authenticated;
GRANT SELECT ON public.workspace_themes TO authenticated;
GRANT ALL ON public.workspace_themes TO service_role;

-- ── New workspaces start on the platform default ───────────────────────────
CREATE OR REPLACE FUNCTION public.seed_workspace_theme()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  INSERT INTO public.workspace_themes (tenant_id, theme)
  VALUES (NEW.id, '{"base_preset":"basecamp"}'::jsonb)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_workspace_theme() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tenants_seed_workspace_theme ON public.tenants;
CREATE TRIGGER trg_tenants_seed_workspace_theme
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.seed_workspace_theme();

-- ── Existing workspaces keep the theme their policy selected ───────────────
INSERT INTO public.workspace_themes (tenant_id, theme)
SELECT t.id,
       jsonb_build_object(
         'base_preset',
         CASE
           WHEN jsonb_typeof(t.settings -> 'theme_policy' -> 'default_theme_id') = 'string'
            AND (t.settings -> 'theme_policy' ->> 'default_theme_id') ~ '^[a-z0-9-]{1,40}$'
           THEN t.settings -> 'theme_policy' ->> 'default_theme_id'
           ELSE 'basecamp'
         END
       )
  FROM public.tenants t
ON CONFLICT (tenant_id) DO NOTHING;
