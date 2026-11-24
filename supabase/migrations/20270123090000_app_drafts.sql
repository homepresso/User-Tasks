-- ============================================================================
-- 20270123090000_app_drafts.sql
--
-- Drafts and publishing for apps (lib/services/app-versions.ts), like forms.
--
-- The model:
--  - The app's own rows — public.apps (name, subtitle, description, icon,
--    colour, menu, settings: nav / params / variables / rules / style) and
--    public.app_pages (pages, their order, layouts, page options, filters) —
--    are the WORKING DRAFT, edited by the builder, the REST / MCP page and
--    app writes, the Agent's apps_apply_spec and package upgrades.
--  - public.app_versions holds immutable PUBLISHED snapshots: one per
--    publish (version 1, 2, ...), with who published it, when and an
--    optional note. apps.published_version points at the live one. The
--    audience (everyone who is not an editor) is always shown the snapshot
--    named there: pages, widgets, menu, rules, server rule actions, the
--    embed route and the Apps menu cards. An app that was never published
--    (published_version IS NULL) is visible to its editors only.
--  - Not versioned (effective at once, like form permission grants): the
--    slug (the app's address), the audience and the editors.
--  - apps.has_draft_changes: the draft differs from the published version
--    ("Changes not published"); set by every draft write, cleared by
--    publish and discard. draft_updated_at / draft_updated_by: the last draft
--    change and who made it.
--
-- 1. Columns on apps (additive): published_version, published_at,
--    published_by, has_draft_changes, draft_updated_at, draft_updated_by.
-- 2. public.app_versions (tenant_id from the app by trigger; immutable — any
--    UPDATE is refused; rows go with their app, ON DELETE CASCADE).
-- 3. Every existing app is snapshotted as version 1 and published, so
--    nothing changes for anyone who uses an app today.
-- 4. public.app_published_version(app): the live version (SECURITY DEFINER,
--    for the policies).
-- 5. RLS: apps and app_pages (the draft) are now readable by the app's
--    EDITORS only (app_access = 'edit'); app_versions: editors read every
--    version, the audience (app_access = 'view') reads only the published
--    one. Current workspace or the unified view, as before. SELECT is the
--    only grant to authenticated; the service writes with the service role.
--
-- Plain PostgreSQL (jsonb, plpgsql); additive and idempotent. Code deployed
-- before this migration keeps today's behaviour (no drafts: every save is
-- live), detected by the missing app_versions table.
-- ============================================================================

SET lock_timeout = '5s';

-- ── 1. Draft / publish state on apps ────────────────────────────────────────

ALTER TABLE public.apps ADD COLUMN IF NOT EXISTS published_version integer;
ALTER TABLE public.apps ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE public.apps ADD COLUMN IF NOT EXISTS published_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.apps ADD COLUMN IF NOT EXISTS has_draft_changes boolean NOT NULL DEFAULT false;
ALTER TABLE public.apps ADD COLUMN IF NOT EXISTS draft_updated_at timestamptz;
ALTER TABLE public.apps ADD COLUMN IF NOT EXISTS draft_updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apps_published_version_check') THEN
    ALTER TABLE public.apps ADD CONSTRAINT apps_published_version_check CHECK (published_version IS NULL OR published_version >= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.apps.published_version IS 'The app_versions.version the audience sees; NULL = never published (editors only).';
COMMENT ON COLUMN public.apps.has_draft_changes IS 'The working draft (apps + app_pages) has changes that are not published.';

-- ── 2. Published snapshots ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.app_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  app_id       uuid NOT NULL REFERENCES public.apps(id) ON DELETE CASCADE,
  version      integer NOT NULL CHECK (version >= 1),
  -- { format: 1, app: { name, subtitle, description, icon, color, menu, settings }, pages: [{ id, slug, title, icon, position, layout, filters }] }
  snapshot     jsonb NOT NULL,
  -- { name, subtitle, description, icon, color, home_page, pages }: what the Apps menu cards need without the layouts.
  summary      jsonb NOT NULL DEFAULT '{}'::jsonb,
  note         text CHECK (note IS NULL OR char_length(note) <= 1000),
  -- publish | initial (this migration) | import (package install / upgrade, config apply)
  source       text NOT NULL DEFAULT 'publish' CHECK (source IN ('publish', 'initial', 'import')),
  published_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_versions_app_version_key UNIQUE (app_id, version)
);
CREATE INDEX IF NOT EXISTS idx_app_versions_tenant ON public.app_versions (tenant_id, app_id, version DESC);
COMMENT ON TABLE public.app_versions IS 'Immutable published snapshots of an app (lib/services/app-versions.ts); apps.published_version names the live one. The app rows are the working draft.';

DROP TRIGGER IF EXISTS trg_app_versions_tenant ON public.app_versions;
CREATE TRIGGER trg_app_versions_tenant BEFORE INSERT ON public.app_versions
  FOR EACH ROW EXECUTE FUNCTION public.app_child_set_tenant();

CREATE OR REPLACE FUNCTION public.app_versions_immutable() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $$
BEGIN
  RAISE EXCEPTION 'app versions are immutable (publish a new version instead)' USING ERRCODE = '55000';
END
$$;
REVOKE ALL ON FUNCTION public.app_versions_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_app_versions_immutable ON public.app_versions;
CREATE TRIGGER trg_app_versions_immutable BEFORE UPDATE ON public.app_versions
  FOR EACH ROW EXECUTE FUNCTION public.app_versions_immutable();

-- ── 3. Existing apps: version 1, published ──────────────────────────────────
-- The snapshot shape matches lib/apps/versions.ts buildAppSnapshot; the
-- summary matches snapshotSummary (home page: the first page in the menu
-- that every audience role may open, else the first page).

WITH snap AS (
  SELECT a.id AS app_id, a.tenant_id, a.updated_by,
    jsonb_build_object(
      'format', 1,
      'app', jsonb_build_object(
        'name', a.name, 'subtitle', a.subtitle, 'description', a.description, 'icon', a.icon, 'color', a.color,
        'menu', COALESCE(a.menu, '[]'::jsonb),
        'settings', COALESCE(a.settings, '{}'::jsonb) - 'access_issues' - 'access_checked_at' - 'package'
      ),
      'pages', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', p.id, 'slug', p.slug, 'title', p.title, 'icon', p.icon, 'position', p.position,
          'layout', COALESCE(p.layout, '{"widgets": []}'::jsonb), 'filters', COALESCE(p.filters, '[]'::jsonb)
        ) ORDER BY p.position, p.created_at, p.id)
        FROM public.app_pages p WHERE p.app_id = a.id
      ), '[]'::jsonb)
    ) AS snapshot,
    jsonb_build_object(
      'name', a.name, 'subtitle', a.subtitle, 'description', a.description, 'icon', a.icon, 'color', a.color,
      'home_page', COALESCE(
        (SELECT p.slug FROM public.app_pages p WHERE p.app_id = a.id
            AND COALESCE(p.layout->'options'->>'hidden', 'false') <> 'true'
            AND COALESCE(p.layout->'options'->>'min_role', 'viewer') = 'viewer'
          ORDER BY p.position, p.created_at, p.id LIMIT 1),
        (SELECT p.slug FROM public.app_pages p WHERE p.app_id = a.id ORDER BY p.position, p.created_at, p.id LIMIT 1)
      )
    ) AS summary
  FROM public.apps a
  WHERE a.published_version IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.app_versions v WHERE v.app_id = a.id)
)
INSERT INTO public.app_versions (tenant_id, app_id, version, snapshot, summary, note, source, published_by)
SELECT s.tenant_id, s.app_id, 1, s.snapshot, s.summary, 'Published when drafts were introduced', 'initial', s.updated_by
  FROM snap s
ON CONFLICT (app_id, version) DO NOTHING;

UPDATE public.apps a
   SET published_version = v.version, published_at = v.published_at, published_by = v.published_by, has_draft_changes = false
  FROM public.app_versions v
 WHERE v.app_id = a.id AND v.version = 1 AND v.source = 'initial' AND a.published_version IS NULL;

-- ── 4. The live version (for the policies) ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.app_published_version(p_app_id uuid) RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
    SELECT a.published_version FROM public.apps a WHERE a.id = p_app_id
  $$;
REVOKE ALL ON FUNCTION public.app_published_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_published_version(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.app_published_version(uuid) IS 'App drafts: the published version of an app (NULL = never published). For the app_versions SELECT policy.';

-- ── 5. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.app_versions ENABLE ROW LEVEL SECURITY;

-- The draft (app rows and pages): the app's editors only.
DROP POLICY IF EXISTS apps_select ON public.apps;
CREATE POLICY apps_select ON public.apps FOR SELECT TO authenticated
  USING (tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[]) AND public.app_access(id) = 'edit');

DROP POLICY IF EXISTS app_pages_select ON public.app_pages;
CREATE POLICY app_pages_select ON public.app_pages FOR SELECT TO authenticated
  USING (tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[]) AND public.app_access(app_id) = 'edit');

-- Published snapshots: editors read every version; the audience the live one.
DROP POLICY IF EXISTS app_versions_select ON public.app_versions;
CREATE POLICY app_versions_select ON public.app_versions FOR SELECT TO authenticated
  USING (
    tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[])
    AND (
      public.app_access(app_id) = 'edit'
      OR (public.app_access(app_id) = 'view' AND version = public.app_published_version(app_id))
    )
  );

REVOKE ALL ON public.app_versions FROM anon, authenticated;
GRANT SELECT ON public.app_versions TO authenticated;
GRANT ALL ON public.app_versions TO service_role;
