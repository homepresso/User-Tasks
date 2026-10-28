-- Perf phase 4: API, auth & data fetching.
--
-- 1. workflows.node_count — stored node count so the workflow list no longer
--    downloads every definition (nodes/edges) just to show "N nodes". Kept up
--    to date by a BEFORE INSERT/UPDATE trigger, so every writer (services, UI
--    actions, import, GitHub sync) maintains it without code changes.
-- 2. tag_definitions: "Users can create tags" allowed anon and tenant-less
--    (global) rows; inserts now need an authenticated user and their current
--    tenant (the set_tag_tenant_id trigger fills tenant_id when omitted).
-- 3. Run-report RPCs (SECURITY INVOKER — workflow_runs RLS applies as before)
--    so report pages aggregate in SQL instead of downloading up to 10k runs
--    with execution_trace/node_results:
--      workflow_run_daily_stats     per workflow per UTC day (hub KPIs/trend/anomalies)
--      workflow_run_duration_stats  per workflow + overall: status counts, avg/p50/p95
--      workflow_run_summaries       run rows without traces, with trace-derived counts
--      workflow_node_visit_stats    per-node visit counts from traces / node_results

-- ── 1. workflows.node_count ──────────────────────────────────────────────────

ALTER TABLE public.workflows ADD COLUMN IF NOT EXISTS node_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.workflows_set_node_count()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
AS $$
BEGIN
  NEW.node_count := CASE WHEN jsonb_typeof(NEW.nodes) = 'array' THEN jsonb_array_length(NEW.nodes) ELSE 0 END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workflows_node_count ON public.workflows;
CREATE TRIGGER trg_workflows_node_count
  BEFORE INSERT OR UPDATE ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.workflows_set_node_count();

-- Backfill without bumping updated_at (the list sorts by it).
ALTER TABLE public.workflows DISABLE TRIGGER trg_workflows_updated;
UPDATE public.workflows
   SET node_count = CASE WHEN jsonb_typeof(nodes) = 'array' THEN jsonb_array_length(nodes) ELSE 0 END;
ALTER TABLE public.workflows ENABLE TRIGGER trg_workflows_updated;

-- ── 2. tag_definitions insert policy ─────────────────────────────────────────

DROP POLICY IF EXISTS "Users can create tags" ON public.tag_definitions;
CREATE POLICY "Users can create tags" ON public.tag_definitions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = (SELECT public.get_current_tenant_id()));

-- ── 3. Run-report RPCs ───────────────────────────────────────────────────────

-- Trace-derived counts for one run, matching the report pages' JS:
--   trace_node_visits  execution_trace entries with type 'node' and a string node_id
--   edge_traversals    execution_trace entries with type 'edge'
--   result_node_count  keys of node_results (fallback when there is no trace)
CREATE OR REPLACE FUNCTION public.workflow_run_trace_counts(
  p_trace jsonb,
  p_results jsonb,
  OUT trace_node_visits integer,
  OUT edge_traversals integer,
  OUT result_node_count integer
)
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path TO ''
AS $$
  SELECT
    coalesce((
      SELECT count(*) FILTER (WHERE e->>'type' = 'node' AND jsonb_typeof(e->'node_id') = 'string')
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_trace) = 'array' THEN p_trace ELSE '[]'::jsonb END) e
       WHERE jsonb_typeof(e) = 'object'
    ), 0)::integer,
    coalesce((
      SELECT count(*) FILTER (WHERE e->>'type' = 'edge')
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_trace) = 'array' THEN p_trace ELSE '[]'::jsonb END) e
       WHERE jsonb_typeof(e) = 'object'
    ), 0)::integer,
    CASE WHEN jsonb_typeof(p_results) = 'object'
      THEN (SELECT count(*) FROM jsonb_object_keys(p_results))::integer
      ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public.workflow_run_daily_stats(
  p_since timestamptz,
  p_workflow_ids uuid[] DEFAULT NULL
)
  RETURNS TABLE (
    workflow_id uuid,
    day date,
    runs integer,
    active integer,
    errors integer,
    completed integer,
    completed_ms double precision,
    timed integer,
    timed_ms double precision,
    node_visits bigint,
    edge_traversals bigint,
    last_started_at timestamptz,
    last_completed_at timestamptz
  )
  LANGUAGE sql STABLE
  SET search_path TO ''
AS $$
  SELECT
    r.workflow_id,
    (r.started_at AT TIME ZONE 'UTC')::date AS day,
    count(*)::integer,
    count(*) FILTER (WHERE r.status IN ('running', 'waiting_for_event', 'paused', 'pending'))::integer,
    count(*) FILTER (WHERE r.status = 'failed')::integer,
    count(*) FILTER (WHERE r.status = 'completed' AND r.completed_at IS NOT NULL)::integer,
    coalesce(sum(extract(epoch FROM r.completed_at - r.started_at) * 1000)
      FILTER (WHERE r.status = 'completed' AND r.completed_at IS NOT NULL), 0)::double precision,
    count(*) FILTER (WHERE r.completed_at > r.started_at)::integer,
    coalesce(sum(extract(epoch FROM r.completed_at - r.started_at) * 1000)
      FILTER (WHERE r.completed_at > r.started_at), 0)::double precision,
    coalesce(sum(CASE WHEN c.trace_node_visits > 0 THEN c.trace_node_visits ELSE c.result_node_count END), 0)::bigint,
    coalesce(sum(c.edge_traversals), 0)::bigint,
    max(r.started_at),
    max(r.completed_at) FILTER (WHERE r.status = 'completed')
  FROM public.workflow_runs r
  CROSS JOIN LATERAL public.workflow_run_trace_counts(r.execution_trace, r.node_results) c
  WHERE r.started_at >= p_since
    AND (p_workflow_ids IS NULL OR r.workflow_id = ANY (p_workflow_ids))
  GROUP BY r.workflow_id, (r.started_at AT TIME ZONE 'UTC')::date
$$;

CREATE OR REPLACE FUNCTION public.workflow_run_duration_stats(
  p_since timestamptz,
  p_workflow_ids uuid[] DEFAULT NULL
)
  RETURNS TABLE (
    workflow_id uuid,
    runs integer,
    completed integer,
    failed integer,
    active integer,
    avg_ms double precision,
    p50_ms double precision,
    p95_ms double precision
  )
  LANGUAGE sql STABLE
  SET search_path TO ''
AS $$
  -- One row per workflow plus an overall row (workflow_id NULL). Durations
  -- are completed runs only, as on the report pages.
  SELECT
    r.workflow_id,
    count(*)::integer,
    count(*) FILTER (WHERE r.status = 'completed')::integer,
    count(*) FILTER (WHERE r.status = 'failed')::integer,
    count(*) FILTER (WHERE r.status IN ('running', 'waiting_for_event', 'paused', 'pending'))::integer,
    avg(d.ms),
    percentile_cont(0.5) WITHIN GROUP (ORDER BY d.ms),
    percentile_cont(0.95) WITHIN GROUP (ORDER BY d.ms)
  FROM public.workflow_runs r
  CROSS JOIN LATERAL (
    SELECT CASE WHEN r.status = 'completed' AND r.completed_at IS NOT NULL
      THEN extract(epoch FROM r.completed_at - r.started_at)::double precision * 1000 END AS ms
  ) d
  WHERE r.started_at >= p_since
    AND (p_workflow_ids IS NULL OR r.workflow_id = ANY (p_workflow_ids))
  GROUP BY GROUPING SETS ((r.workflow_id), ())
$$;

CREATE OR REPLACE FUNCTION public.workflow_run_summaries(
  p_workflow_ids uuid[],
  p_since timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 2000
)
  RETURNS TABLE (
    id uuid,
    workflow_id uuid,
    task_id uuid,
    status text,
    started_at timestamptz,
    completed_at timestamptz,
    error text,
    title text,
    paused_at timestamptz,
    paused_node_id text,
    sla_label text,
    sla_due_at timestamptz,
    sla_warning_at timestamptz,
    sla_status text,
    trace_node_visits integer,
    edge_traversals integer,
    result_node_count integer
  )
  LANGUAGE sql STABLE
  SET search_path TO ''
AS $$
  SELECT r.id, r.workflow_id, r.task_id, r.status, r.started_at, r.completed_at, r.error, r.title,
         r.paused_at, r.paused_node_id, r.sla_label, r.sla_due_at, r.sla_warning_at, r.sla_status,
         c.trace_node_visits, c.edge_traversals, c.result_node_count
    FROM (
      SELECT * FROM public.workflow_runs w
       WHERE w.workflow_id = ANY (p_workflow_ids)
         AND (p_since IS NULL OR w.started_at >= p_since)
       ORDER BY w.started_at DESC
       LIMIT least(greatest(coalesce(p_limit, 2000), 1), 10000)
    ) r
    CROSS JOIN LATERAL public.workflow_run_trace_counts(r.execution_trace, r.node_results) c
   ORDER BY r.started_at DESC
$$;

CREATE OR REPLACE FUNCTION public.workflow_node_visit_stats(
  p_workflow_ids uuid[],
  p_since timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 5000
)
  RETURNS TABLE (workflow_id uuid, node_id text, visits bigint)
  LANGUAGE sql STABLE
  SET search_path TO ''
AS $$
  -- Per run and node: the node's trace visits, else 1 when node_results has
  -- it (the compare page's "hot nodes"), over the newest p_limit runs.
  WITH runs AS (
    SELECT w.id, w.workflow_id, w.execution_trace, w.node_results
      FROM public.workflow_runs w
     WHERE w.workflow_id = ANY (p_workflow_ids)
       AND (p_since IS NULL OR w.started_at >= p_since)
     ORDER BY w.started_at DESC
     LIMIT least(greatest(coalesce(p_limit, 5000), 1), 10000)
  ), traced AS (
    SELECT r.id, r.workflow_id, e->>'node_id' AS node_id, count(*) AS n
      FROM runs r
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(r.execution_trace) = 'array' THEN r.execution_trace ELSE '[]'::jsonb END) e
     WHERE jsonb_typeof(e) = 'object' AND e->>'type' = 'node' AND e->>'node_id' IS NOT NULL
     GROUP BY r.id, r.workflow_id, e->>'node_id'
  ), resulted AS (
    SELECT r.id, r.workflow_id, k AS node_id
      FROM runs r
      CROSS JOIN LATERAL jsonb_object_keys(
        CASE WHEN jsonb_typeof(r.node_results) = 'object' THEN r.node_results ELSE '{}'::jsonb END) k
  )
  SELECT coalesce(t.workflow_id, x.workflow_id), coalesce(t.node_id, x.node_id), sum(coalesce(t.n, 1))::bigint
    FROM traced t
    FULL JOIN resulted x ON x.id = t.id AND x.node_id = t.node_id
   GROUP BY 1, 2
$$;

REVOKE ALL ON FUNCTION public.workflow_run_trace_counts(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workflow_run_daily_stats(timestamptz, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workflow_run_duration_stats(timestamptz, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workflow_run_summaries(uuid[], timestamptz, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workflow_node_visit_stats(uuid[], timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workflow_run_trace_counts(jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workflow_run_daily_stats(timestamptz, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workflow_run_duration_stats(timestamptz, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workflow_run_summaries(uuid[], timestamptz, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workflow_node_visit_stats(uuid[], timestamptz, integer) TO authenticated, service_role;
