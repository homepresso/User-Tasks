-- ============================================================================
-- 20270101000000_workflow_queue_list.sql
--
-- Workflow queue page: filtering, search and paging in the database, so the
-- default "Active" view never misses an active item that sits behind the
-- newest 200 rows of a mixed list (lib/automations/queue-filters.ts mirrors
-- the rules below; keep them in step).
--
-- public.workflow_queue_list(tenant, filters, scope, sort, dir, limit, offset)
--
--  Items: queue jobs (workflow_queue) with their run, plus runs of
--  middleware-triggered workflows that have no queue job ("run:<id>").
--  A completed task_resume / delay_resume job is folded into its run's start
--  job (one row per run instead of one per resume); pending, failed or dead
--  resume jobs stay visible.
--
--  Effective status: the job's status while it is pending / processing /
--  failed / dead or has no run, else the run's status
--  (running, waiting_for_event, paused, completed, failed, cancelled, migrated).
--
--  Views (filters.view):
--    active     pending, processing, running, waiting_for_event, paused (default)
--    attention  failed, dead, or an active item whose SLA is breached
--    completed  completed, cancelled, migrated
--    all        everything
--
--  Filters (all optional, ANDed): statuses (effective statuses), search
--  (workflow name, job / run id or short id, run title, the open task's title
--  or the current node's label, the starter's name or email), workflow_ids,
--  started_by, assignee_ids (assignee of the open task of the run),
--  date_field (created | started | updated) with date_from / date_to
--  (ISO instants), sla (on_track | warning | breached), trigger_types,
--  version_ids, has_errors.
--
--  Scope (visibility tiers, lib/services/run-visibility): NULL = every item
--  (workflows.view_runs); else {workflow_ids, run_ids, user_id}: a granted
--  workflow, a job whose run is in scope, or a job the person queued — the
--  same rule as queueScopeFilter / runScopeFilter.
--
--  Returns {total, rows, view_counts, status_counts[, facets]}.
--  status_counts: items per effective status over the scope (stat cards).
--  view_counts: items per view with every filter but view / statuses.
--  facets (filters.facets = true): workflows, versions, starters, assignees
--  in scope, for the advanced filter pickers.
--
-- SECURITY INVOKER: RLS applies to a signed-in caller; tenant is also passed
-- explicitly. Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_workflow_queue_tenant_created
  ON public.workflow_queue (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_queue_result_run
  ON public.workflow_queue ((result->>'run_id'));

CREATE OR REPLACE FUNCTION public.workflow_queue_list(
  p_tenant_id uuid,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_scope jsonb DEFAULT NULL,
  p_sort text DEFAULT 'created_at',
  p_dir text DEFAULT 'desc',
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  active_statuses constant text[] := ARRAY['pending', 'processing', 'running', 'waiting_for_event', 'paused'];
  done_statuses constant text[] := ARRAY['completed', 'cancelled', 'migrated'];
  open_tasks constant text[] := ARRAY['draft', 'todo', 'in_progress', 'blocked'];
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_view text := coalesce(nullif(f->>'view', ''), 'active');
  v_statuses text[];
  v_search text := nullif(btrim(f->>'search'), '');
  v_like text;
  v_workflows uuid[];
  v_starters uuid[];
  v_assignees uuid[];
  v_versions uuid[];
  v_sla text[];
  v_triggers text[];
  v_date_field text := coalesce(nullif(f->>'date_field', ''), 'created');
  v_from timestamptz;
  v_to timestamptz;
  v_has_errors boolean := CASE WHEN f->>'has_errors' = 'true' THEN true END;
  v_facets boolean := f->>'facets' = 'true';
  v_all boolean := p_scope IS NULL;
  v_scope_wf uuid[];
  v_scope_runs text[];
  v_scope_user text;
  v_desc boolean := lower(coalesce(p_dir, 'desc')) <> 'asc';
  v_sort text := CASE WHEN p_sort IN ('created_at', 'started_at', 'status') THEN p_sort ELSE 'created_at' END;
  v_limit int := least(greatest(coalesce(p_limit, 25), 0), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
BEGIN
  IF v_view NOT IN ('active', 'attention', 'completed', 'all') THEN v_view := 'active'; END IF;
  IF v_date_field NOT IN ('created', 'started', 'updated') THEN v_date_field := 'created'; END IF;

  IF jsonb_typeof(f->'statuses') = 'array' AND jsonb_array_length(f->'statuses') > 0 THEN
    v_statuses := ARRAY(SELECT jsonb_array_elements_text(f->'statuses'));
  END IF;
  IF jsonb_typeof(f->'workflow_ids') = 'array' AND jsonb_array_length(f->'workflow_ids') > 0 THEN
    v_workflows := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(f->'workflow_ids') x WHERE x ~ uuid_re);
  END IF;
  IF jsonb_typeof(f->'started_by') = 'array' AND jsonb_array_length(f->'started_by') > 0 THEN
    v_starters := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(f->'started_by') x WHERE x ~ uuid_re);
  END IF;
  IF jsonb_typeof(f->'assignee_ids') = 'array' AND jsonb_array_length(f->'assignee_ids') > 0 THEN
    v_assignees := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(f->'assignee_ids') x WHERE x ~ uuid_re);
  END IF;
  IF jsonb_typeof(f->'version_ids') = 'array' AND jsonb_array_length(f->'version_ids') > 0 THEN
    v_versions := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(f->'version_ids') x WHERE x ~ uuid_re);
  END IF;
  IF jsonb_typeof(f->'sla') = 'array' AND jsonb_array_length(f->'sla') > 0 THEN
    v_sla := ARRAY(SELECT jsonb_array_elements_text(f->'sla'));
  END IF;
  IF jsonb_typeof(f->'trigger_types') = 'array' AND jsonb_array_length(f->'trigger_types') > 0 THEN
    v_triggers := ARRAY(SELECT jsonb_array_elements_text(f->'trigger_types'));
  END IF;
  BEGIN
    v_from := nullif(f->>'date_from', '')::timestamptz;
    v_to := nullif(f->>'date_to', '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_from := NULL; v_to := NULL;
  END;
  IF v_search IS NOT NULL THEN
    v_like := '%' || replace(replace(replace(left(v_search, 200), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  IF NOT v_all THEN
    v_scope_wf := ARRAY(SELECT x::uuid FROM jsonb_array_elements_text(coalesce(p_scope->'workflow_ids', '[]'::jsonb)) x WHERE x ~ uuid_re);
    v_scope_runs := ARRAY(SELECT lower(x) FROM jsonb_array_elements_text(coalesce(p_scope->'run_ids', '[]'::jsonb)) x WHERE x ~ uuid_re);
    v_scope_user := CASE WHEN p_scope->>'user_id' ~ uuid_re THEN p_scope->>'user_id' END;
  END IF;

  WITH jobs AS (
    SELECT q.*, x.ref AS run_ref
    FROM public.workflow_queue q
    CROSS JOIN LATERAL (
      SELECT coalesce(q.result->>'run_id', q.trigger_data->>'_resume_run_id', q.trigger_data->'_task_resume'->>'run_id') AS ref
    ) x
    WHERE (p_tenant_id IS NULL OR q.tenant_id = p_tenant_id)
      AND (v_all
        OR q.workflow_id = ANY (v_scope_wf)
        OR (q.result->>'run_id') = ANY (v_scope_runs)
        OR (v_scope_user IS NOT NULL AND q.trigger_data->'_started_by'->>'user_id' = v_scope_user))
  ),
  items AS (
    SELECT
      j.id::text AS id, j.id AS job_id, false AS synthetic, j.tenant_id, j.workflow_id,
      j.status AS job_status, j.trigger_type, j.trigger_data, j.result, j.error AS job_error,
      j.created_at, j.started_at, j.completed_at,
      greatest(j.created_at, j.started_at, j.completed_at, r.paused_at, r.completed_at) AS updated_at,
      r.id AS run_id, r.status AS run_status, r.title AS run_title, r.version_id, r.event_id, r.paused_node_id,
      r.started_at AS run_started_at, r.error AS run_error,
      r.sla_label, r.sla_due_at, r.sla_warning_at, CASE WHEN r.sla_due_at IS NOT NULL THEN r.sla_status END AS sla_status,
      coalesce(r.started_by, CASE WHEN j.trigger_data->'_started_by'->>'user_id' ~ uuid_re THEN (j.trigger_data->'_started_by'->>'user_id')::uuid END) AS started_by,
      CASE WHEN r.id IS NULL OR j.status IN ('pending', 'processing', 'failed', 'dead') THEN j.status ELSE r.status END AS es
    FROM jobs j
    LEFT JOIN public.workflow_runs r ON r.id = CASE WHEN j.run_ref ~ uuid_re THEN j.run_ref::uuid END
    WHERE NOT (
      j.status = 'completed' AND j.trigger_type IN ('task_resume', 'delay_resume') AND r.id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.workflow_queue q0
        WHERE (q0.result->>'run_id') = r.id::text AND q0.created_at <= j.created_at AND q0.id <> j.id
          AND q0.trigger_type NOT IN ('task_resume', 'delay_resume')
      )
    )
    UNION ALL
    SELECT
      'run:' || r.id::text, NULL::uuid, true, r.tenant_id, r.workflow_id,
      r.status, 'middleware_received', NULL::jsonb, jsonb_build_object('run_id', r.id), NULL::text,
      r.started_at, r.started_at, r.completed_at,
      greatest(r.started_at, r.paused_at, r.completed_at),
      r.id, r.status, r.title, r.version_id, r.event_id, r.paused_node_id,
      r.started_at, r.error,
      r.sla_label, r.sla_due_at, r.sla_warning_at, CASE WHEN r.sla_due_at IS NOT NULL THEN r.sla_status END,
      r.started_by,
      r.status
    FROM public.workflow_runs r
    JOIN public.workflows mw ON mw.id = r.workflow_id AND mw.trigger_type = 'middleware_received'
    WHERE (p_tenant_id IS NULL OR r.tenant_id = p_tenant_id)
      AND (v_all OR r.workflow_id = ANY (v_scope_wf) OR r.id::text = ANY (v_scope_runs))
      AND NOT EXISTS (SELECT 1 FROM public.workflow_queue q1 WHERE (q1.result->>'run_id') = r.id::text)
  ),
  named AS (
    SELECT i.*, w.name AS workflow_name, w.trigger_type AS workflow_trigger_type
    FROM items i
    LEFT JOIN public.workflows w ON w.id = i.workflow_id
  ),
  filtered AS (
    SELECT n.*
    FROM named n
    WHERE (v_workflows IS NULL OR n.workflow_id = ANY (v_workflows))
      AND (v_starters IS NULL OR n.started_by = ANY (v_starters))
      AND (v_versions IS NULL OR n.version_id = ANY (v_versions))
      AND (v_sla IS NULL OR n.sla_status = ANY (v_sla))
      AND (v_triggers IS NULL OR n.trigger_type = ANY (v_triggers))
      AND (v_has_errors IS NULL OR (
        coalesce(n.job_error, '') <> '' OR coalesce(n.run_error, '') <> '' OR n.es IN ('failed', 'dead')))
      AND (v_from IS NULL OR (CASE v_date_field WHEN 'started' THEN n.started_at WHEN 'updated' THEN n.updated_at ELSE n.created_at END) >= v_from)
      AND (v_to IS NULL OR (CASE v_date_field WHEN 'started' THEN n.started_at WHEN 'updated' THEN n.updated_at ELSE n.created_at END) <= v_to)
      AND (v_assignees IS NULL OR (n.event_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.event_id = n.event_id AND t.tenant_id = n.tenant_id AND t.deleted_at IS NULL
          AND t.status::text = ANY (open_tasks) AND t.assignee_id = ANY (v_assignees))))
      AND (v_like IS NULL
        OR n.workflow_name ILIKE v_like
        OR n.id ILIKE v_like
        OR n.run_id::text ILIKE v_like
        OR n.run_title ILIKE v_like
        OR (n.started_by IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.users u WHERE u.id = n.started_by AND (u.display_name ILIKE v_like OR u.email ILIKE v_like)))
        OR (n.event_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.tasks t
          WHERE t.event_id = n.event_id AND t.tenant_id = n.tenant_id AND t.deleted_at IS NULL
            AND t.status::text = ANY (open_tasks) AND t.title ILIKE v_like))
        OR (n.paused_node_id IS NOT NULL AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(coalesce(
            (SELECT v.nodes FROM public.workflow_versions v WHERE v.id = n.version_id),
            (SELECT w2.nodes FROM public.workflows w2 WHERE w2.id = n.workflow_id),
            '[]'::jsonb)) node
          WHERE node->>'id' = n.paused_node_id AND node->>'label' ILIKE v_like)))
  ),
  in_view AS (
    SELECT fl.*
    FROM filtered fl
    WHERE (v_view = 'all'
        OR (v_view = 'active' AND fl.es = ANY (active_statuses))
        OR (v_view = 'attention' AND (fl.es IN ('failed', 'dead') OR (fl.sla_status = 'breached' AND fl.es = ANY (active_statuses))))
        OR (v_view = 'completed' AND fl.es = ANY (done_statuses)))
      AND (v_statuses IS NULL OR fl.es = ANY (v_statuses))
  ),
  page AS (
    SELECT iv.*, row_number() OVER (
      ORDER BY
        CASE WHEN v_sort = 'status' AND v_desc THEN iv.es END DESC,
        CASE WHEN v_sort = 'status' AND NOT v_desc THEN iv.es END ASC,
        CASE WHEN v_sort = 'started_at' AND v_desc THEN iv.started_at END DESC NULLS LAST,
        CASE WHEN v_sort = 'started_at' AND NOT v_desc THEN iv.started_at END ASC NULLS FIRST,
        CASE WHEN v_desc THEN iv.created_at END DESC,
        CASE WHEN NOT v_desc THEN iv.created_at END ASC,
        iv.id
    ) AS ord
    FROM in_view iv
    ORDER BY ord
    LIMIT v_limit OFFSET v_offset
  ),
  enriched AS (
    SELECT p.*,
      ot.title AS task_title, ot.assignee_id,
      au.display_name AS assignee_name, au.email AS assignee_email,
      su.display_name AS started_by_name, su.email AS started_by_email,
      wv.version_number,
      (SELECT node->>'label'
         FROM jsonb_array_elements(coalesce(wv.nodes, (SELECT w3.nodes FROM public.workflows w3 WHERE w3.id = p.workflow_id), '[]'::jsonb)) node
        WHERE p.paused_node_id IS NOT NULL AND node->>'id' = p.paused_node_id
        LIMIT 1) AS node_label
    FROM page p
    LEFT JOIN public.workflow_versions wv ON wv.id = p.version_id
    LEFT JOIN LATERAL (
      SELECT t.title, t.assignee_id
      FROM public.tasks t
      WHERE p.event_id IS NOT NULL AND t.event_id = p.event_id AND t.tenant_id = p.tenant_id
        AND t.deleted_at IS NULL AND t.status::text = ANY (open_tasks)
      ORDER BY t.created_at DESC
      LIMIT 1
    ) ot ON true
    LEFT JOIN public.users au ON au.id = ot.assignee_id
    LEFT JOIN public.users su ON su.id = p.started_by
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM in_view),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'job_id', e.job_id, 'synthetic_run', e.synthetic, 'workflow_id', e.workflow_id,
        'workflow', jsonb_build_object('id', e.workflow_id, 'name', coalesce(e.workflow_name, 'Unknown'), 'trigger_type', e.workflow_trigger_type),
        'status', e.job_status, 'effective_status', e.es, 'trigger_type', e.trigger_type,
        'trigger_data', CASE WHEN e.trigger_data ? 'task_id' THEN jsonb_build_object('task_id', e.trigger_data->'task_id') END,
        'result', e.result, 'error', coalesce(nullif(e.job_error, ''), e.run_error),
        'created_at', e.created_at, 'started_at', e.started_at, 'completed_at', e.completed_at, 'updated_at', e.updated_at,
        'run', CASE WHEN e.run_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', e.run_id, 'workflow_id', e.workflow_id, 'version_id', e.version_id, 'version_number', e.version_number,
          'status', e.run_status, 'event_id', e.event_id, 'paused_node_id', e.paused_node_id, 'started_at', e.run_started_at,
          'title', e.run_title, 'sla_label', e.sla_label, 'sla_due_at', e.sla_due_at, 'sla_warning_at', e.sla_warning_at,
          'sla_status', e.sla_status) END,
        'step_label', coalesce(e.task_title, e.node_label),
        'started_by', CASE WHEN e.started_by IS NULL THEN NULL ELSE jsonb_build_object(
          'id', e.started_by, 'name', e.started_by_name, 'email', e.started_by_email) END,
        'assignee', CASE WHEN e.assignee_id IS NULL THEN NULL ELSE jsonb_build_object(
          'id', e.assignee_id, 'name', e.assignee_name, 'email', e.assignee_email) END
      ) ORDER BY e.ord)
      FROM enriched e), '[]'::jsonb),
    'view_counts', (
      SELECT jsonb_build_object(
        'active', count(*) FILTER (WHERE fl.es = ANY (active_statuses)),
        'attention', count(*) FILTER (WHERE fl.es IN ('failed', 'dead') OR (fl.sla_status = 'breached' AND fl.es = ANY (active_statuses))),
        'completed', count(*) FILTER (WHERE fl.es = ANY (done_statuses)),
        'all', count(*))
      FROM filtered fl),
    'status_counts', coalesce((
      SELECT jsonb_object_agg(s.es, s.n) FROM (SELECT es, count(*) AS n FROM items GROUP BY es) s), '{}'::jsonb),
    'facets', CASE WHEN v_facets THEN jsonb_build_object(
      'workflows', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', d.workflow_id, 'name', d.name) ORDER BY d.name)
        FROM (SELECT DISTINCT n.workflow_id, coalesce(n.workflow_name, 'Unknown') AS name FROM named n) d), '[]'::jsonb),
      'versions', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', v.id, 'workflow_id', v.workflow_id, 'version_number', v.version_number) ORDER BY v.workflow_id, v.version_number DESC)
        FROM public.workflow_versions v
        WHERE v.id IN (SELECT DISTINCT i.version_id FROM items i WHERE i.version_id IS NOT NULL)), '[]'::jsonb),
      'starters', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', u.id, 'name', u.display_name, 'email', u.email) ORDER BY lower(coalesce(u.display_name, u.email)))
        FROM (SELECT u0.* FROM public.users u0
              WHERE u0.id IN (SELECT DISTINCT i.started_by FROM items i WHERE i.started_by IS NOT NULL)
              LIMIT 500) u), '[]'::jsonb),
      'assignees', coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', u.id, 'name', u.display_name, 'email', u.email) ORDER BY lower(coalesce(u.display_name, u.email)))
        FROM (SELECT u0.* FROM public.users u0
              WHERE u0.id IN (
                SELECT DISTINCT t.assignee_id FROM public.tasks t
                JOIN items i ON i.event_id IS NOT NULL AND t.event_id = i.event_id AND t.tenant_id = i.tenant_id
                WHERE t.assignee_id IS NOT NULL AND t.deleted_at IS NULL AND t.status::text = ANY (open_tasks)
                  AND i.es = ANY (active_statuses))
              LIMIT 500) u), '[]'::jsonb)
    ) END
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.workflow_queue_list(uuid, jsonb, jsonb, text, text, int, int) IS
  'Workflow queue page: queue items (jobs + middleware runs) in the caller''s run scope, filtered (view, statuses, search, advanced filters), sorted and paged, with view / status counts and optional facets.';

REVOKE ALL ON FUNCTION public.workflow_queue_list(uuid, jsonb, jsonb, text, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_queue_list(uuid, jsonb, jsonb, text, text, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.workflow_queue_list(uuid, jsonb, jsonb, text, text, int, int) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
