-- ============================================================================
-- Tag colours: a workspace tag registry (lib/services/tags.ts,
-- lib/tags/palette.ts).
--
-- 1. public.tag_styles: one row per tag name per workspace, mapping the name
--    to a colour TOKEN from the fixed palette (never raw hex; NULL = the
--    automatic colour) and an optional description. `name_key` is the
--    case-insensitive, whitespace-collapsed name (unique per workspace), so
--    "Finance" and "finance" share one style. The tag arrays on tasks,
--    workflows, forms, integrations, references, agents and workflow
--    activities stay as they are: free text, no data migration.
-- 2. RLS: members read their workspace's styles (current workspace, or every
--    member workspace in the unified view); insert / update / delete need
--    tags.manage in the current workspace.
-- 3. Existing tag_definitions (hex colours, used by the workflow and
--    integration lists) are copied in, each hex mapped to its nearest token.
--    tag_definitions itself is left in place, unused by the new code.
-- 4. public.tag_usage(tenant) (tags in use by object type) and
--    public.tag_objects(tenant, tag, type, limit, offset) (the objects
--    carrying a tag, paged): SECURITY INVOKER, so a signed-in caller sees
--    only what RLS shows them. public.rename_tag(tenant, from, to, actor)
--    (rename or merge across every tagged object, moving the style) and
--    public.remove_tag(tenant, tag) (remove from every object, drop the
--    style): one transaction each, SECURITY DEFINER, EXECUTE for
--    service_role only — the service checks tags.manage and audits.
-- 5. Permission tags.manage ("Manage tags"): seed_tenant_roles gives it to
--    Owner, Admin and Manager (re-created from 20270120090000_apps.sql, only
--    adding); existing Owner / Admin / Manager system roles get it.
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

-- ── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tag_styles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  name_key text GENERATED ALWAYS AS (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) STORED,
  color text CHECK (color IS NULL OR color IN (
    'gray', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal',
    'cyan', 'blue', 'indigo', 'violet', 'purple', 'pink', 'rose')),
  description text CHECK (description IS NULL OR char_length(description) <= 280),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tag_styles_tenant_name_key UNIQUE (tenant_id, name_key)
);
COMMENT ON TABLE public.tag_styles IS 'Workspace tag registry: tag name (case-insensitive via name_key) → colour token from lib/tags/palette.ts (NULL = automatic colour) and description. The tags themselves stay free text on each object. lib/services/tags.ts.';

DROP TRIGGER IF EXISTS trg_tag_styles_updated_at ON public.tag_styles;
CREATE TRIGGER trg_tag_styles_updated_at BEFORE UPDATE ON public.tag_styles
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ── 2. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE public.tag_styles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tag_styles_select ON public.tag_styles;
CREATE POLICY tag_styles_select ON public.tag_styles FOR SELECT TO authenticated
  USING (tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[]));

DROP POLICY IF EXISTS tag_styles_insert ON public.tag_styles;
CREATE POLICY tag_styles_insert ON public.tag_styles FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT public.get_current_tenant_id())
    AND tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['tags.manage']))::uuid[]));

DROP POLICY IF EXISTS tag_styles_update ON public.tag_styles;
CREATE POLICY tag_styles_update ON public.tag_styles FOR UPDATE TO authenticated
  USING (tenant_id = (SELECT public.get_current_tenant_id())
    AND tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['tags.manage']))::uuid[]))
  WITH CHECK (tenant_id = (SELECT public.get_current_tenant_id())
    AND tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['tags.manage']))::uuid[]));

DROP POLICY IF EXISTS tag_styles_delete ON public.tag_styles;
CREATE POLICY tag_styles_delete ON public.tag_styles FOR DELETE TO authenticated
  USING (tenant_id = (SELECT public.get_current_tenant_id())
    AND tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['tags.manage']))::uuid[]));

REVOKE ALL ON public.tag_styles FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tag_styles TO authenticated;
GRANT ALL ON public.tag_styles TO service_role;

-- ── 3. Existing tag definitions → styles ────────────────────────────────────

INSERT INTO public.tag_styles (tenant_id, name, color, created_at)
SELECT DISTINCT ON (d.tenant_id, lower(btrim(regexp_replace(d.name, '\s+', ' ', 'g'))))
       d.tenant_id,
       btrim(regexp_replace(d.name, '\s+', ' ', 'g')),
       CASE
         WHEN lower(d.color) ~ '^#[0-9a-f]{6}$' THEN COALESCE(
           (SELECT legacy.token FROM (VALUES
              ('#6b7280', 'gray'), ('#ef4444', 'red'), ('#f97316', 'orange'), ('#f59e0b', 'amber'),
              ('#22c55e', 'green'), ('#17150f', 'teal'), ('#3b82f6', 'blue'), ('#6366f1', 'indigo'),
              ('#8b5cf6', 'violet'), ('#ec4899', 'pink')) AS legacy(hex, token)
             WHERE legacy.hex = lower(d.color)),
           (SELECT p.token FROM (VALUES
              ('gray', '6b7280'), ('red', 'ef4444'), ('orange', 'f97316'), ('amber', 'f59e0b'),
              ('yellow', 'eab308'), ('lime', '84cc16'), ('green', '22c55e'), ('teal', '14b8a6'),
              ('cyan', '06b6d4'), ('blue', '3b82f6'), ('indigo', '6366f1'), ('violet', '8b5cf6'),
              ('purple', 'a855f7'), ('pink', 'ec4899'), ('rose', 'f43f5e')) AS p(token, hex)
             ORDER BY
               power(('x' || substr(lower(d.color), 2, 2))::bit(8)::int - ('x' || substr(p.hex, 1, 2))::bit(8)::int, 2)
             + power(('x' || substr(lower(d.color), 4, 2))::bit(8)::int - ('x' || substr(p.hex, 3, 2))::bit(8)::int, 2)
             + power(('x' || substr(lower(d.color), 6, 2))::bit(8)::int - ('x' || substr(p.hex, 5, 2))::bit(8)::int, 2)
             LIMIT 1))
         ELSE NULL
       END,
       d.created_at
  FROM public.tag_definitions d
 WHERE d.tenant_id IS NOT NULL
   AND char_length(btrim(regexp_replace(d.name, '\s+', ' ', 'g'))) BETWEEN 1 AND 60
 ORDER BY d.tenant_id, lower(btrim(regexp_replace(d.name, '\s+', ' ', 'g'))), d.created_at
ON CONFLICT (tenant_id, name_key) DO NOTHING;

-- ── 4. Usage and rename ─────────────────────────────────────────────────────

-- The tag key (as name_key): trimmed, inner whitespace collapsed, lower case.
CREATE OR REPLACE FUNCTION public.tag_key(p_name text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path TO ''
  AS $$ SELECT lower(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'))) $$;
COMMENT ON FUNCTION public.tag_key(text) IS 'Tag registry key (= tag_styles.name_key; lib/tags/palette.ts tagKey).';

-- A tag array with every tag whose key is p_from_key replaced by p_to, then
-- de-duplicated by key (first spelling and position kept).
CREATE OR REPLACE FUNCTION public.tag_array_rename(p_tags text[], p_from_key text, p_to text) RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path TO ''
  AS $$
    SELECT coalesce(array_agg(d.tag ORDER BY d.ord), '{}'::text[])
      FROM (
        SELECT DISTINCT ON (public.tag_key(r.tag)) r.tag, r.ord
          FROM (
            SELECT CASE WHEN public.tag_key(u.tag) = p_from_key THEN p_to ELSE u.tag END AS tag, u.ord
              FROM unnest(coalesce(p_tags, '{}'::text[])) WITH ORDINALITY AS u(tag, ord)
             WHERE public.tag_key(u.tag) <> ''
          ) r
         ORDER BY public.tag_key(r.tag), r.ord
      ) d
  $$;

-- Tags in use in one workspace, by object type: key, the most used spelling,
-- and the number of objects carrying it. Deleted tasks are left out.
-- SECURITY INVOKER: a signed-in caller counts only the rows their RLS lets
-- them see, so counts never reveal hidden objects.
CREATE OR REPLACE FUNCTION public.tag_usage(p_tenant_id uuid)
  RETURNS TABLE (name_key text, name text, object_type text, uses bigint)
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path TO ''
  AS $$
    WITH tagged AS (
      SELECT 'tasks'::text AS object_type, t.id, u.tag FROM public.tasks t, unnest(t.tags) AS u(tag)
       WHERE t.tenant_id = p_tenant_id AND t.deleted_at IS NULL AND cardinality(t.tags) > 0
      UNION ALL
      SELECT 'workflows', w.id, u.tag FROM public.workflows w, unnest(w.tags) AS u(tag)
       WHERE w.tenant_id = p_tenant_id AND cardinality(w.tags) > 0
      UNION ALL
      SELECT 'forms', f.id, u.tag FROM public.forms f, unnest(f.tags) AS u(tag)
       WHERE f.tenant_id = p_tenant_id AND cardinality(f.tags) > 0
      UNION ALL
      SELECT 'integrations', i.id, u.tag FROM public.integrations i, unnest(i.tags) AS u(tag)
       WHERE i.tenant_id = p_tenant_id AND cardinality(i.tags) > 0
      UNION ALL
      SELECT 'references', r.id, u.tag FROM public.integration_references r, unnest(r.tags) AS u(tag)
       WHERE r.tenant_id = p_tenant_id AND cardinality(r.tags) > 0
      UNION ALL
      SELECT 'agents', a.id, u.tag FROM public.agents a, unnest(a.tags) AS u(tag)
       WHERE a.tenant_id = p_tenant_id AND cardinality(a.tags) > 0
      UNION ALL
      SELECT 'activities', c.id, u.tag FROM public.custom_workflow_activities c, unnest(c.tags) AS u(tag)
       WHERE c.tenant_id = p_tenant_id AND cardinality(c.tags) > 0
    )
    SELECT public.tag_key(tag) AS name_key,
           mode() WITHIN GROUP (ORDER BY btrim(regexp_replace(tag, '\s+', ' ', 'g'))) AS name,
           object_type,
           count(DISTINCT id) AS uses
      FROM tagged
     WHERE public.tag_key(tag) <> ''
     GROUP BY public.tag_key(tag), object_type
  $$;
COMMENT ON FUNCTION public.tag_usage(uuid) IS 'Tags in use in a workspace by object type (lib/services/tags.ts listTags). SECURITY INVOKER: callers count only the rows RLS shows them; the service also filters object types by the caller''s view permissions.';

-- The objects of one type carrying a tag (Settings → Tags detail panel),
-- by name, one page at a time, with the total. SECURITY INVOKER: RLS
-- decides which rows the caller sees.
CREATE OR REPLACE FUNCTION public.tag_objects(p_tenant_id uuid, p_key text, p_type text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
  RETURNS TABLE (id uuid, name text, parent_id uuid, total bigint)
  LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path TO ''
  AS $$
    WITH hits AS (
      SELECT t.id, t.title AS name, NULL::uuid AS parent_id FROM public.tasks t
       WHERE p_type = 'tasks' AND t.tenant_id = p_tenant_id AND t.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM unnest(t.tags) AS u(tag) WHERE public.tag_key(u.tag) = public.tag_key(p_key))
      UNION ALL
      SELECT w.id, w.name, NULL FROM public.workflows w
       WHERE p_type = 'workflows' AND w.tenant_id = p_tenant_id
         AND EXISTS (SELECT 1 FROM unnest(w.tags) AS u(tag) WHERE public.tag_key(u.tag) = public.tag_key(p_key))
      UNION ALL
      SELECT f.id, f.name, NULL FROM public.forms f
       WHERE p_type = 'forms' AND f.tenant_id = p_tenant_id
         AND EXISTS (SELECT 1 FROM unnest(f.tags) AS u(tag) WHERE public.tag_key(u.tag) = public.tag_key(p_key))
      UNION ALL
      SELECT i.id, i.name, NULL FROM public.integrations i
       WHERE p_type = 'integrations' AND i.tenant_id = p_tenant_id
         AND EXISTS (SELECT 1 FROM unnest(i.tags) AS u(tag) WHERE public.tag_key(u.tag) = public.tag_key(p_key))
      UNION ALL
      SELECT r.id, r.name, r.integration_id FROM public.integration_references r
       WHERE p_type = 'references' AND r.tenant_id = p_tenant_id
         AND EXISTS (SELECT 1 FROM unnest(r.tags) AS u(tag) WHERE public.tag_key(u.tag) = public.tag_key(p_key))
      UNION ALL
      SELECT a.id, a.name, NULL FROM public.agents a
       WHERE p_type = 'agents' AND a.tenant_id = p_tenant_id
         AND EXISTS (SELECT 1 FROM unnest(a.tags) AS u(tag) WHERE public.tag_key(u.tag) = public.tag_key(p_key))
      UNION ALL
      SELECT c.id, c.name, NULL FROM public.custom_workflow_activities c
       WHERE p_type = 'activities' AND c.tenant_id = p_tenant_id
         AND EXISTS (SELECT 1 FROM unnest(c.tags) AS u(tag) WHERE public.tag_key(u.tag) = public.tag_key(p_key))
    )
    SELECT h.id, h.name, h.parent_id, count(*) OVER () AS total
      FROM hits h
     ORDER BY lower(h.name), h.id
     LIMIT greatest(1, least(coalesce(p_limit, 20), 100)) OFFSET greatest(0, coalesce(p_offset, 0))
  $$;
COMMENT ON FUNCTION public.tag_objects(uuid, text, text, integer, integer) IS 'Objects of one type carrying a tag, by name, paged, with the total (Settings → Tags; lib/services/tags.ts listTagObjects). SECURITY INVOKER: RLS applies.';

-- Remove a tag from every tagged object of the workspace and drop its
-- style, in one transaction. Returns the objects changed per type.
CREATE OR REPLACE FUNCTION public.remove_tag(p_tenant_id uuid, p_name text)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_key text := public.tag_key(p_name);
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
BEGIN
  IF p_tenant_id IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'workspace and tag required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.tasks SET tags = array(SELECT u.tag FROM unnest(tags) WITH ORDINALITY AS u(tag, ord) WHERE public.tag_key(u.tag) <> v_key ORDER BY u.ord)
   WHERE tenant_id = p_tenant_id AND tags IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('tasks', v_n);
  UPDATE public.workflows SET tags = array(SELECT u.tag FROM unnest(tags) WITH ORDINALITY AS u(tag, ord) WHERE public.tag_key(u.tag) <> v_key ORDER BY u.ord)
   WHERE tenant_id = p_tenant_id AND tags IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('workflows', v_n);
  UPDATE public.forms SET tags = array(SELECT u.tag FROM unnest(tags) WITH ORDINALITY AS u(tag, ord) WHERE public.tag_key(u.tag) <> v_key ORDER BY u.ord)
   WHERE tenant_id = p_tenant_id AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('forms', v_n);
  UPDATE public.integrations SET tags = array(SELECT u.tag FROM unnest(tags) WITH ORDINALITY AS u(tag, ord) WHERE public.tag_key(u.tag) <> v_key ORDER BY u.ord)
   WHERE tenant_id = p_tenant_id AND tags IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('integrations', v_n);
  UPDATE public.integration_references SET tags = array(SELECT u.tag FROM unnest(tags) WITH ORDINALITY AS u(tag, ord) WHERE public.tag_key(u.tag) <> v_key ORDER BY u.ord)
   WHERE tenant_id = p_tenant_id AND tags IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('references', v_n);
  UPDATE public.agents SET tags = array(SELECT u.tag FROM unnest(tags) WITH ORDINALITY AS u(tag, ord) WHERE public.tag_key(u.tag) <> v_key ORDER BY u.ord)
   WHERE tenant_id = p_tenant_id AND tags IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('agents', v_n);
  UPDATE public.custom_workflow_activities SET tags = array(SELECT u.tag FROM unnest(tags) WITH ORDINALITY AS u(tag, ord) WHERE public.tag_key(u.tag) <> v_key ORDER BY u.ord)
   WHERE tenant_id = p_tenant_id AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('activities', v_n);
  DELETE FROM public.tag_styles WHERE tenant_id = p_tenant_id AND name_key = v_key;
  RETURN jsonb_build_object('objects', v_counts);
END
$$;
COMMENT ON FUNCTION public.remove_tag(uuid, text) IS 'Remove a tag from every tagged object of a workspace and drop its style, in one transaction (lib/services/tags.ts removeTag, which checks tags.manage and audits). service_role only.';

-- Rename (or merge into an existing tag) across every tagged object of the
-- workspace and move the style, in one transaction. Returns the objects
-- changed per type and whether the target already had a style (merge).
CREATE OR REPLACE FUNCTION public.rename_tag(p_tenant_id uuid, p_from text, p_to text, p_actor uuid DEFAULT NULL)
  RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_from text := public.tag_key(p_from);
  v_to text := btrim(regexp_replace(coalesce(p_to, ''), '\s+', ' ', 'g'));
  v_to_key text := public.tag_key(p_to);
  v_counts jsonb := '{}'::jsonb;
  v_n bigint;
  v_from_style public.tag_styles%ROWTYPE;
  v_to_style public.tag_styles%ROWTYPE;
  v_merged boolean := false;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'workspace required' USING ERRCODE = '22023';
  END IF;
  IF v_from = '' OR v_to_key = '' OR char_length(v_to) > 60 THEN
    RAISE EXCEPTION 'tag names must be 1-60 characters' USING ERRCODE = '22023';
  END IF;

  UPDATE public.tasks SET tags = public.tag_array_rename(tags, v_from, v_to)
   WHERE tenant_id = p_tenant_id AND tags IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('tasks', v_n);

  UPDATE public.workflows SET tags = public.tag_array_rename(tags, v_from, v_to)
   WHERE tenant_id = p_tenant_id AND tags IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('workflows', v_n);

  UPDATE public.forms SET tags = public.tag_array_rename(tags, v_from, v_to)
   WHERE tenant_id = p_tenant_id
     AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('forms', v_n);

  UPDATE public.integrations SET tags = public.tag_array_rename(tags, v_from, v_to)
   WHERE tenant_id = p_tenant_id AND tags IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('integrations', v_n);

  UPDATE public.integration_references SET tags = public.tag_array_rename(tags, v_from, v_to)
   WHERE tenant_id = p_tenant_id AND tags IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('references', v_n);

  UPDATE public.agents SET tags = public.tag_array_rename(tags, v_from, v_to)
   WHERE tenant_id = p_tenant_id AND tags IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('agents', v_n);

  UPDATE public.custom_workflow_activities SET tags = public.tag_array_rename(tags, v_from, v_to)
   WHERE tenant_id = p_tenant_id
     AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('activities', v_n);

  -- The style follows the tag: kept by the target if it has one (merge),
  -- else renamed. A case-only rename keeps the row and fixes the spelling.
  SELECT * INTO v_from_style FROM public.tag_styles WHERE tenant_id = p_tenant_id AND name_key = v_from;
  IF v_to_key <> v_from THEN
    SELECT * INTO v_to_style FROM public.tag_styles WHERE tenant_id = p_tenant_id AND name_key = v_to_key;
    v_merged := v_to_style.id IS NOT NULL;
    IF v_from_style.id IS NOT NULL THEN
      IF v_merged THEN
        UPDATE public.tag_styles
           SET color = coalesce(v_to_style.color, v_from_style.color),
               description = coalesce(v_to_style.description, v_from_style.description),
               updated_by = coalesce(p_actor, updated_by)
         WHERE id = v_to_style.id;
        DELETE FROM public.tag_styles WHERE id = v_from_style.id;
      ELSE
        UPDATE public.tag_styles SET name = v_to, updated_by = coalesce(p_actor, updated_by) WHERE id = v_from_style.id;
      END IF;
    END IF;
  ELSIF v_from_style.id IS NOT NULL THEN
    UPDATE public.tag_styles SET name = v_to, updated_by = coalesce(p_actor, updated_by) WHERE id = v_from_style.id;
  END IF;

  RETURN jsonb_build_object('objects', v_counts, 'merged', v_merged, 'name', v_to);
END
$$;
COMMENT ON FUNCTION public.rename_tag(uuid, text, text, uuid) IS 'Rename or merge a tag across every tagged object of a workspace and move its style, in one transaction (lib/services/tags.ts renameTag, which checks tags.manage and audits). service_role only.';

REVOKE ALL ON FUNCTION public.tag_usage(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tag_objects(uuid, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rename_tag(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_tag(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tag_usage(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tag_objects(uuid, text, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_tag(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rename_tag(uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tag_key(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tag_array_rename(text[], text, text) TO service_role;

-- ── 5. Permissions ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.seed_tenant_roles(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_all text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'workflows.view_queue', 'workflows.manage_runs', 'forms.view', 'forms.edit',
    'forms.delete', 'forms.submit', 'forms.wizard', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'apps.view', 'apps.manage', 'tags.manage',
    'team.view_members', 'team.invite', 'team.remove', 'team.change_roles',
    'org.view', 'org.manage', 'projects.view', 'projects.manage',
    'settings.view', 'settings.edit', 'settings.manage_api_keys',
    'settings.manage_webhooks', 'sync.view', 'sync.manage', 'sync.deploy',
    'observability.view', 'packages.view', 'packages.manage', 'packages.install',
    'assistants.manage'
  ];
  -- Completing anyone's workflow task on their behalf: Owner and Admin.
  v_owner text[] := v_all || array['tasks.complete_any'];
  -- ALL minus settings.manage_*, settings.edit, team.change_roles, team.remove,
  -- org.manage, observability.view, assistants.manage
  v_manager text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'workflows.view_queue', 'workflows.manage_runs', 'forms.view', 'forms.edit',
    'forms.delete', 'forms.submit', 'forms.wizard', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'apps.view', 'apps.manage', 'tags.manage',
    'team.view_members', 'team.invite', 'org.view', 'projects.view',
    'projects.manage', 'settings.view', 'sync.view',
    'sync.manage', 'sync.deploy', 'packages.view', 'packages.manage',
    'packages.install'
  ];
  -- Read-only consumer: own tasks, forms they are given, data, reports, apps shared with them, people.
  v_viewer text[] := array[
    'tasks.view_own', 'tasks.complete', 'forms.submit', 'data.view',
    'reports.view', 'apps.view', 'team.view_members', 'org.view', 'projects.view'
  ];
  v_member text[] := v_viewer || array[
    'tasks.create', 'tasks.assign', 'data.manage_rows', 'reports.create',
    'reports.edit_own', 'workflows.view_queue', 'forms.wizard'
  ];
begin
  insert into roles (tenant_id, name, slug, description, permissions, is_system, base_role) values
    (p_tenant_id, 'Owner',   'owner',   'Full access to everything, including billing and API keys', v_owner,   true, 'owner'),
    (p_tenant_id, 'Admin',   'admin',   'Full administrative access',                                v_owner,   true, 'admin'),
    (p_tenant_id, 'Manager', 'manager', 'Builds and manages work; no org administration',            v_manager, true, 'manager'),
    (p_tenant_id, 'Member',  'member',  'Works tasks, data, and reports',                            v_member,  true, 'member'),
    (p_tenant_id, 'Viewer',  'viewer',  'Read-only access',                                          v_viewer,  true, 'viewer');
end;
$$;

UPDATE public.roles
   SET permissions = permissions || ARRAY['tags.manage']
 WHERE is_system AND slug IN ('owner', 'admin', 'manager')
   AND NOT ('tags.manage' = ANY (permissions));
