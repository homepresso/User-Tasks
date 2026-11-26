-- App tags for an app's audience again (tags on apps, 20270122150000, met app
-- drafts, 20270123090000: the apps row became the editors' working draft, so
-- tag_usage / tag_objects, which read it under RLS, stopped counting or listing
-- apps for the people they are shared with).
--
-- public.app_audience_tagged(tenant): the tagged apps of a workspace that the
-- caller sees as AUDIENCE — app_access(app) = 'view' (apps.view and named in
-- the audience by user, team or role) — and that are PUBLISHED
-- (published_version IS NOT NULL), in a workspace the caller can see
-- (rls_visible_tenant_ids). Editors keep reading the apps row through RLS as
-- before (app_access = 'edit' is excluded here: no double rows). The name is
-- the published version's (what the audience sees in the Apps menu), never an
-- unpublished draft name. SECURITY DEFINER, so it reads only id, name and tags
-- of rows that pass those checks; executable by authenticated and service_role (who gets no rows: no auth.uid()).
-- tag_usage and tag_objects add its rows to their apps branch; both stay
-- SECURITY INVOKER, with every other type unchanged.
--
-- Plain PostgreSQL; additive and idempotent (CREATE OR REPLACE).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_audience_tagged(p_tenant_id uuid)
  RETURNS TABLE (id uuid, name text, tags text[])
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
    SELECT a.id, COALESCE(NULLIF(v.summary->>'name', ''), v.snapshot->'app'->>'name', a.name) AS name, a.tags
      FROM public.apps a
      JOIN public.app_versions v ON v.app_id = a.id AND v.version = a.published_version
     WHERE a.tenant_id = p_tenant_id
       AND p_tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[])
       AND a.published_version IS NOT NULL
       AND cardinality(a.tags) > 0
       AND public.app_access(a.id) = 'view'
  $$;
REVOKE ALL ON FUNCTION public.app_audience_tagged(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_audience_tagged(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.app_audience_tagged(uuid) IS 'Tags: the published, tagged apps the caller sees as audience (app_access = view) in a visible workspace, under the published name. For tag_usage / tag_objects (app drafts made the apps row editors-only).';

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
      UNION ALL
      -- The audience of a published app (app drafts made the apps row editors-only).
      SELECT 'apps', aa.id, u.tag FROM public.app_audience_tagged(p_tenant_id) aa, unnest(aa.tags) AS u(tag)
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
      UNION ALL
      -- The audience of a published app, under the published name.
      SELECT aa.id, aa.name, NULL FROM public.app_audience_tagged(p_tenant_id) aa
       WHERE p_type = 'apps'
         AND EXISTS (SELECT 1 FROM unnest(aa.tags) AS u(tag) WHERE public.tag_key(u.tag) = public.tag_key(p_key))
    )
    SELECT h.id, h.name, h.parent_id, count(*) OVER () AS total
      FROM hits h
     ORDER BY lower(h.name), h.id
     LIMIT greatest(1, least(coalesce(p_limit, 20), 100)) OFFSET greatest(0, coalesce(p_offset, 0))
  $$;
COMMENT ON FUNCTION public.tag_objects(uuid, text, text, integer, integer) IS 'Objects of one type carrying a tag, by name, paged, with the total (Settings → Tags; lib/services/tags.ts listTagObjects). SECURITY INVOKER: RLS applies. Authored packages are listed by the service (service-role table).';

REVOKE ALL ON FUNCTION public.tag_usage(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tag_objects(uuid, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tag_usage(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tag_objects(uuid, text, text, integer, integer) TO authenticated, service_role;
