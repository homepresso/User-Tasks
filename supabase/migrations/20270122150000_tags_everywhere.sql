-- ============================================================================
-- Tags on every object type (lib/services/object-tags.ts, lib/services/tags.ts).
--
-- 1. A free-text `tags text[] NOT NULL DEFAULT '{}'` column (+ GIN index) on
--    the object types that had none: data tables (custom_tables), reports,
--    business rules (decision_tables), email templates, form controls
--    (form_controls), apps and authored packages (packages). Adding a column
--    with a constant default is a metadata-only change on PostgreSQL 11+.
-- 2. RLS is unchanged: each object's tags are written through its own update
--    service with the permission that edits the object (form controls, apps
--    and packages are already service-role writes; data tables, reports,
--    business rules and email templates keep their existing UPDATE policies).
-- 3. public.tag_usage / public.tag_objects (SECURITY INVOKER, so RLS decides
--    what a signed-in caller sees) and public.rename_tag / public.remove_tag
--    (SECURITY DEFINER, service_role only) are re-created from
--    20270121150000_tag_styles.sql, only adding the new object types. Authored
--    packages are readable by service_role only (no grant to authenticated),
--    so the invoker functions leave them out and lib/services/tags.ts counts
--    them itself behind packages.view; rename / remove cover them.
--
-- Additive and idempotent. Portable to plain PostgreSQL 16.
-- ============================================================================

SET lock_timeout = '5s';

-- ── 1. Columns and indexes ──────────────────────────────────────────────────

ALTER TABLE public.custom_tables   ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.reports         ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.decision_tables ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.email_templates ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.form_controls   ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.apps            ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.packages        ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_custom_tables_tags   ON public.custom_tables   USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_reports_tags         ON public.reports         USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_decision_tables_tags ON public.decision_tables USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_email_templates_tags ON public.email_templates USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_form_controls_tags   ON public.form_controls   USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_apps_tags            ON public.apps            USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_packages_tags        ON public.packages        USING gin (tags);

COMMENT ON COLUMN public.custom_tables.tags   IS 'Free-text tags (lib/services/object-tags.ts; colours in tag_styles).';
COMMENT ON COLUMN public.reports.tags         IS 'Free-text tags (lib/services/object-tags.ts; colours in tag_styles).';
COMMENT ON COLUMN public.decision_tables.tags IS 'Free-text tags (lib/services/object-tags.ts; colours in tag_styles).';
COMMENT ON COLUMN public.email_templates.tags IS 'Free-text tags (lib/services/object-tags.ts; colours in tag_styles).';
COMMENT ON COLUMN public.form_controls.tags   IS 'Free-text tags (lib/services/object-tags.ts; colours in tag_styles).';
COMMENT ON COLUMN public.apps.tags            IS 'Free-text tags (lib/services/object-tags.ts; colours in tag_styles).';
COMMENT ON COLUMN public.packages.tags        IS 'Free-text tags (lib/services/object-tags.ts; colours in tag_styles).';

-- ── 2. Usage (SECURITY INVOKER) ─────────────────────────────────────────────

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
      UNION ALL
      SELECT 'data_tables', d.id, u.tag FROM public.custom_tables d, unnest(d.tags) AS u(tag)
       WHERE d.tenant_id = p_tenant_id AND cardinality(d.tags) > 0
      UNION ALL
      SELECT 'reports', rp.id, u.tag FROM public.reports rp, unnest(rp.tags) AS u(tag)
       WHERE rp.tenant_id = p_tenant_id AND cardinality(rp.tags) > 0
      UNION ALL
      SELECT 'business_rules', b.id, u.tag FROM public.decision_tables b, unnest(b.tags) AS u(tag)
       WHERE b.tenant_id = p_tenant_id AND cardinality(b.tags) > 0
      UNION ALL
      SELECT 'email_templates', e.id, u.tag FROM public.email_templates e, unnest(e.tags) AS u(tag)
       WHERE e.tenant_id = p_tenant_id AND cardinality(e.tags) > 0
      UNION ALL
      SELECT 'form_controls', fc.id, u.tag FROM public.form_controls fc, unnest(fc.tags) AS u(tag)
       WHERE fc.tenant_id = p_tenant_id AND cardinality(fc.tags) > 0
      UNION ALL
      SELECT 'apps', ap.id, u.tag FROM public.apps ap, unnest(ap.tags) AS u(tag)
       WHERE ap.tenant_id = p_tenant_id AND cardinality(ap.tags) > 0
    )
    SELECT public.tag_key(tag) AS name_key,
           mode() WITHIN GROUP (ORDER BY btrim(regexp_replace(tag, '\s+', ' ', 'g'))) AS name,
           object_type,
           count(DISTINCT id) AS uses
      FROM tagged
     WHERE public.tag_key(tag) <> ''
     GROUP BY public.tag_key(tag), object_type
  $$;
COMMENT ON FUNCTION public.tag_usage(uuid) IS 'Tags in use in a workspace by object type (lib/services/tags.ts listTags). SECURITY INVOKER: callers count only the rows RLS shows them; the service also filters object types by the caller''s view permissions. Authored packages are counted by the service (service-role table).';

-- ── 3. Where used (SECURITY INVOKER) ────────────────────────────────────────

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
      UNION ALL
      SELECT d.id, d.name, NULL FROM public.custom_tables d
       WHERE p_type = 'data_tables' AND d.tenant_id = p_tenant_id
         AND EXISTS (SELECT 1 FROM unnest(d.tags) AS u(tag) WHERE public.tag_key(u.tag) = public.tag_key(p_key))
      UNION ALL
      SELECT rp.id, rp.name, NULL FROM public.reports rp
       WHERE p_type = 'reports' AND rp.tenant_id = p_tenant_id
         AND EXISTS (SELECT 1 FROM unnest(rp.tags) AS u(tag) WHERE public.tag_key(u.tag) = public.tag_key(p_key))
      UNION ALL
      SELECT b.id, b.name, NULL FROM public.decision_tables b
       WHERE p_type = 'business_rules' AND b.tenant_id = p_tenant_id
         AND EXISTS (SELECT 1 FROM unnest(b.tags) AS u(tag) WHERE public.tag_key(u.tag) = public.tag_key(p_key))
      UNION ALL
      SELECT e.id, e.name, NULL FROM public.email_templates e
       WHERE p_type = 'email_templates' AND e.tenant_id = p_tenant_id
         AND EXISTS (SELECT 1 FROM unnest(e.tags) AS u(tag) WHERE public.tag_key(u.tag) = public.tag_key(p_key))
      UNION ALL
      SELECT fc.id, fc.name, NULL FROM public.form_controls fc
       WHERE p_type = 'form_controls' AND fc.tenant_id = p_tenant_id
         AND EXISTS (SELECT 1 FROM unnest(fc.tags) AS u(tag) WHERE public.tag_key(u.tag) = public.tag_key(p_key))
      UNION ALL
      SELECT ap.id, ap.name, NULL FROM public.apps ap
       WHERE p_type = 'apps' AND ap.tenant_id = p_tenant_id
         AND EXISTS (SELECT 1 FROM unnest(ap.tags) AS u(tag) WHERE public.tag_key(u.tag) = public.tag_key(p_key))
    )
    SELECT h.id, h.name, h.parent_id, count(*) OVER () AS total
      FROM hits h
     ORDER BY lower(h.name), h.id
     LIMIT greatest(1, least(coalesce(p_limit, 20), 100)) OFFSET greatest(0, coalesce(p_offset, 0))
  $$;
COMMENT ON FUNCTION public.tag_objects(uuid, text, text, integer, integer) IS 'Objects of one type carrying a tag, by name, paged, with the total (Settings → Tags; lib/services/tags.ts listTagObjects). SECURITY INVOKER: RLS applies. Authored packages are listed by the service (service-role table).';

-- ── 4. Remove (SECURITY DEFINER, service_role only) ─────────────────────────

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
  UPDATE public.custom_tables SET tags = array(SELECT u.tag FROM unnest(tags) WITH ORDINALITY AS u(tag, ord) WHERE public.tag_key(u.tag) <> v_key ORDER BY u.ord)
   WHERE tenant_id = p_tenant_id AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('data_tables', v_n);
  UPDATE public.reports SET tags = array(SELECT u.tag FROM unnest(tags) WITH ORDINALITY AS u(tag, ord) WHERE public.tag_key(u.tag) <> v_key ORDER BY u.ord)
   WHERE tenant_id = p_tenant_id AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('reports', v_n);
  UPDATE public.decision_tables SET tags = array(SELECT u.tag FROM unnest(tags) WITH ORDINALITY AS u(tag, ord) WHERE public.tag_key(u.tag) <> v_key ORDER BY u.ord)
   WHERE tenant_id = p_tenant_id AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('business_rules', v_n);
  UPDATE public.email_templates SET tags = array(SELECT u.tag FROM unnest(tags) WITH ORDINALITY AS u(tag, ord) WHERE public.tag_key(u.tag) <> v_key ORDER BY u.ord)
   WHERE tenant_id = p_tenant_id AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('email_templates', v_n);
  UPDATE public.form_controls SET tags = array(SELECT u.tag FROM unnest(tags) WITH ORDINALITY AS u(tag, ord) WHERE public.tag_key(u.tag) <> v_key ORDER BY u.ord)
   WHERE tenant_id = p_tenant_id AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('form_controls', v_n);
  UPDATE public.apps SET tags = array(SELECT u.tag FROM unnest(tags) WITH ORDINALITY AS u(tag, ord) WHERE public.tag_key(u.tag) <> v_key ORDER BY u.ord)
   WHERE tenant_id = p_tenant_id AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('apps', v_n);
  UPDATE public.packages SET tags = array(SELECT u.tag FROM unnest(tags) WITH ORDINALITY AS u(tag, ord) WHERE public.tag_key(u.tag) <> v_key ORDER BY u.ord)
   WHERE tenant_id = p_tenant_id AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_key);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('packages', v_n);
  DELETE FROM public.tag_styles WHERE tenant_id = p_tenant_id AND name_key = v_key;
  RETURN jsonb_build_object('objects', v_counts);
END
$$;
COMMENT ON FUNCTION public.remove_tag(uuid, text) IS 'Remove a tag from every tagged object of a workspace and drop its style, in one transaction (lib/services/tags.ts removeTag, which checks tags.manage and audits). service_role only.';

-- ── 5. Rename / merge (SECURITY DEFINER, service_role only) ─────────────────

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

  UPDATE public.custom_tables SET tags = public.tag_array_rename(tags, v_from, v_to)
   WHERE tenant_id = p_tenant_id
     AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('data_tables', v_n);

  UPDATE public.reports SET tags = public.tag_array_rename(tags, v_from, v_to)
   WHERE tenant_id = p_tenant_id
     AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('reports', v_n);

  UPDATE public.decision_tables SET tags = public.tag_array_rename(tags, v_from, v_to)
   WHERE tenant_id = p_tenant_id
     AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('business_rules', v_n);

  UPDATE public.email_templates SET tags = public.tag_array_rename(tags, v_from, v_to)
   WHERE tenant_id = p_tenant_id
     AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('email_templates', v_n);

  UPDATE public.form_controls SET tags = public.tag_array_rename(tags, v_from, v_to)
   WHERE tenant_id = p_tenant_id
     AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('form_controls', v_n);

  UPDATE public.apps SET tags = public.tag_array_rename(tags, v_from, v_to)
   WHERE tenant_id = p_tenant_id
     AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('apps', v_n);

  UPDATE public.packages SET tags = public.tag_array_rename(tags, v_from, v_to)
   WHERE tenant_id = p_tenant_id
     AND EXISTS (SELECT 1 FROM unnest(tags) AS u(tag) WHERE public.tag_key(u.tag) = v_from);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_counts := v_counts || jsonb_build_object('packages', v_n);

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

-- ── 6. Grants (unchanged from 20270121150000) ───────────────────────────────

REVOKE ALL ON FUNCTION public.tag_usage(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tag_objects(uuid, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rename_tag(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_tag(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tag_usage(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tag_objects(uuid, text, text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_tag(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rename_tag(uuid, text, text, uuid) TO service_role;
