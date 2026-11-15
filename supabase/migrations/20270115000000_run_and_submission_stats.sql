-- ============================================================================
-- 20270115000000_run_and_submission_stats.sql
--
-- Aggregates for pages that show "how are these workflows / forms doing"
-- (extension pages: ctx.workflows.stats, ctx.forms.submissionStats), computed
-- in the database over a bounded period and a given set of workflows / forms,
-- so a page that opens often never pulls rows to count them.
--
-- public.workflow_run_stats(tenant, workflow_ids, since, until) → jsonb
--   {workflows: [{workflow_id, started, completed, failed, cancelled, avg_ms,
--    p95_ms, running, waiting, queued, per_day: [{day, started, completed,
--    failed, avg_ms}]}], total: {the same over all the given workflows}}
--   Period: runs started in [since, until) (idx_workflow_runs_workflow_started).
--   Durations: completed runs only (completed_at − started_at, ms; p95 is
--   percentile_cont). failed in per_day counts failed + cancelled. A run a
--   person cancelled (stored as failed + 'Manually cancelled') counts as cancelled.
--   running / waiting / queued are NOW, whatever the period: runs running;
--   runs paused / waiting_for_event / waiting; queue jobs pending or
--   processing that have no run yet (resume jobs excluded).
--   Days are UTC (YYYY-MM-DD); only days with runs are returned.
--
-- public.form_submission_stats(tenant, form_ids, since, until) → jsonb
--   {forms: [{form_id, total, last_at, per_day: [{day, count}]}]}
--   Period: submissions created in [since, until) (idx_form_submissions_form);
--   last_at: the newest submission at any time. Counts only, never values.
--
-- Callers pass at most a few hundred ids and a period of at most 90 days.
-- SECURITY INVOKER, service role only (the callers check permissions and
-- scope the ids). Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.workflow_run_stats(
  p_tenant_id uuid,
  p_workflow_ids uuid[],
  p_since timestamptz,
  p_until timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH wf AS (
    SELECT DISTINCT unnest(coalesce(p_workflow_ids, '{}'::uuid[])) AS id
  ),
  period AS (
    SELECT r.workflow_id,
      -- A run cancelled by a person is stored as failed + 'Manually cancelled' (lib/services/workflow-runs).
      CASE WHEN r.status = 'failed' AND r.error = 'Manually cancelled' THEN 'cancelled' ELSE r.status END AS status,
      r.started_at,
      CASE WHEN r.status = 'completed' AND r.completed_at IS NOT NULL
        THEN extract(epoch FROM (r.completed_at - r.started_at)) * 1000 END AS ms
    FROM public.workflow_runs r
    WHERE r.tenant_id = p_tenant_id
      AND r.workflow_id = ANY (p_workflow_ids)
      AND r.started_at >= p_since AND r.started_at < p_until
  ),
  per_wf AS (
    SELECT p.workflow_id,
      count(*) AS started,
      count(*) FILTER (WHERE p.status = 'completed') AS completed,
      count(*) FILTER (WHERE p.status = 'failed') AS failed,
      count(*) FILTER (WHERE p.status IN ('cancelled', 'canceled')) AS cancelled,
      avg(p.ms) AS avg_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY p.ms) FILTER (WHERE p.ms IS NOT NULL) AS p95_ms
    FROM period p
    GROUP BY p.workflow_id
  ),
  per_day AS (
    SELECT d.workflow_id, jsonb_agg(jsonb_build_object('day', d.day, 'started', d.started, 'completed', d.completed, 'failed', d.failed, 'avg_ms', d.avg_ms) ORDER BY d.day) AS days
    FROM (
      SELECT p.workflow_id, to_char(p.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
        count(*) AS started,
        count(*) FILTER (WHERE p.status = 'completed') AS completed,
        count(*) FILTER (WHERE p.status IN ('failed', 'cancelled', 'canceled')) AS failed,
        round(avg(p.ms)::numeric) AS avg_ms
      FROM period p
      GROUP BY 1, 2
    ) d
    GROUP BY d.workflow_id
  ),
  live AS (
    SELECT r.workflow_id,
      count(*) FILTER (WHERE r.status = 'running') AS running,
      count(*) FILTER (WHERE r.status IN ('paused', 'waiting_for_event', 'waiting')) AS waiting
    FROM public.workflow_runs r
    WHERE r.tenant_id = p_tenant_id
      AND r.workflow_id = ANY (p_workflow_ids)
      AND r.status IN ('running', 'paused', 'waiting_for_event', 'waiting')
    GROUP BY r.workflow_id
  ),
  queued AS (
    SELECT q.workflow_id, count(*) AS queued
    FROM public.workflow_queue q
    WHERE q.tenant_id = p_tenant_id
      AND q.workflow_id = ANY (p_workflow_ids)
      AND q.status IN ('pending', 'processing')
      AND q.trigger_type NOT IN ('task_resume', 'delay_resume')
      AND (q.result->>'run_id') IS NULL
    GROUP BY q.workflow_id
  ),
  tot AS (
    SELECT count(*) AS started,
      count(*) FILTER (WHERE p.status = 'completed') AS completed,
      count(*) FILTER (WHERE p.status = 'failed') AS failed,
      count(*) FILTER (WHERE p.status IN ('cancelled', 'canceled')) AS cancelled,
      avg(p.ms) AS avg_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY p.ms) FILTER (WHERE p.ms IS NOT NULL) AS p95_ms
    FROM period p
  ),
  tot_day AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'started', d.started, 'completed', d.completed, 'failed', d.failed, 'avg_ms', d.avg_ms) ORDER BY d.day), '[]'::jsonb) AS days
    FROM (
      SELECT to_char(p.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
        count(*) AS started,
        count(*) FILTER (WHERE p.status = 'completed') AS completed,
        count(*) FILTER (WHERE p.status IN ('failed', 'cancelled', 'canceled')) AS failed,
        round(avg(p.ms)::numeric) AS avg_ms
      FROM period p
      GROUP BY 1
    ) d
  ),
  wf_rows AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'workflow_id', wf.id,
      'started', coalesce(pw.started, 0),
      'completed', coalesce(pw.completed, 0),
      'failed', coalesce(pw.failed, 0),
      'cancelled', coalesce(pw.cancelled, 0),
      'avg_ms', round(pw.avg_ms::numeric),
      'p95_ms', round(pw.p95_ms::numeric),
      'running', coalesce(l.running, 0),
      'waiting', coalesce(l.waiting, 0),
      'queued', coalesce(q.queued, 0),
      'per_day', coalesce(pd.days, '[]'::jsonb)
    )), '[]'::jsonb) AS workflows
    FROM wf
    LEFT JOIN per_wf pw ON pw.workflow_id = wf.id
    LEFT JOIN per_day pd ON pd.workflow_id = wf.id
    LEFT JOIN live l ON l.workflow_id = wf.id
    LEFT JOIN queued q ON q.workflow_id = wf.id
  )
  SELECT jsonb_build_object(
    'workflows', wf_rows.workflows,
    'total', jsonb_build_object(
      'started', tot.started, 'completed', tot.completed, 'failed', tot.failed, 'cancelled', tot.cancelled,
      'avg_ms', round(tot.avg_ms::numeric), 'p95_ms', round(tot.p95_ms::numeric),
      'running', (SELECT coalesce(sum(running), 0) FROM live),
      'waiting', (SELECT coalesce(sum(waiting), 0) FROM live),
      'queued', (SELECT coalesce(sum(queued), 0) FROM queued),
      'per_day', tot_day.days))
  FROM wf_rows, tot, tot_day;
$$;

COMMENT ON FUNCTION public.workflow_run_stats(uuid, uuid[], timestamptz, timestamptz) IS
  'Run counts, durations (avg / p95 of completed runs) and runs per UTC day of the given workflows over [since, until), plus runs running / waiting / queued now. Service role only.';

REVOKE ALL ON FUNCTION public.workflow_run_stats(uuid, uuid[], timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workflow_run_stats(uuid, uuid[], timestamptz, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workflow_run_stats(uuid, uuid[], timestamptz, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.form_submission_stats(
  p_tenant_id uuid,
  p_form_ids uuid[],
  p_since timestamptz,
  p_until timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH f AS (
    SELECT DISTINCT unnest(coalesce(p_form_ids, '{}'::uuid[])) AS id
  ),
  period AS (
    SELECT s.form_id, to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
    FROM public.form_submissions s
    WHERE s.tenant_id = p_tenant_id
      AND s.form_id = ANY (p_form_ids)
      AND s.created_at >= p_since AND s.created_at < p_until
  ),
  per_day AS (
    SELECT d.form_id, sum(d.n) AS total, jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) ORDER BY d.day) AS days
    FROM (SELECT p.form_id, p.day, count(*) AS n FROM period p GROUP BY 1, 2) d
    GROUP BY d.form_id
  )
  SELECT jsonb_build_object('forms', coalesce(jsonb_agg(jsonb_build_object(
    'form_id', f.id,
    'total', coalesce(pd.total, 0),
    'last_at', (SELECT max(s.created_at) FROM public.form_submissions s WHERE s.tenant_id = p_tenant_id AND s.form_id = f.id),
    'per_day', coalesce(pd.days, '[]'::jsonb)
  )), '[]'::jsonb))
  FROM f
  LEFT JOIN per_day pd ON pd.form_id = f.id;
$$;

COMMENT ON FUNCTION public.form_submission_stats(uuid, uuid[], timestamptz, timestamptz) IS
  'Submission counts of the given forms over [since, until): total and per UTC day, plus the newest submission at any time. Counts only. Service role only.';

REVOKE ALL ON FUNCTION public.form_submission_stats(uuid, uuid[], timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.form_submission_stats(uuid, uuid[], timestamptz, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.form_submission_stats(uuid, uuid[], timestamptz, timestamptz) TO service_role;
