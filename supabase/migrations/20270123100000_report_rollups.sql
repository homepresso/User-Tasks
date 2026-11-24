-- ============================================================================
-- 20270123100000_report_rollups.sql
--
-- Report rollups: flat per-day tables that report metrics (reports hub,
-- process overview / compare, extension pages, app widgets) read instead of
-- aggregating raw runs / tasks / submissions on every load.
--
-- Tables (all keyed by UTC day; `shard` spreads a busy bucket over 4 rows):
--   report_rollup_runs         tenant × workflow × day × shard. Two sides per
--                              row: the runs STARTED that day (counts by
--                              status, completed durations, trace-derived
--                              node visits / edge traversals, a duration
--                              histogram) and the runs COMPLETED that day
--                              (on time vs late against sla_due_at, cycle
--                              time sum + histogram).
--   report_rollup_nodes        tenant × workflow × day × node × shard: node
--                              visits of the runs started that day (the
--                              compare page's "hot nodes").
--   report_rollup_tasks        tenant × day × workflow × team × assignee:
--                              top-level, not deleted tasks CREATED that day
--                              (by current status) and COMPLETED that day
--                              (on time / late / no due date against
--                              due_date, time to complete + histogram). NULL
--                              workflow / team / assignee are stored as the
--                              zero uuid.
--   report_rollup_submissions  tenant × form × day × shard: submissions.
--   report_rollup_state        per tenant: backfill progress and coverage.
--   report_rollup_dirty        day ranges queued for an exact rebuild.
--
-- Maintenance — in the same transaction as the change:
--   AFTER row triggers on workflow_runs, tasks and form_submissions turn each
--   change into a DELTA (new contribution − old contribution, so a status
--   transition counts exactly once and a retry that writes the same values
--   adds nothing) and upsert it into the affected day buckets with
--   INSERT … ON CONFLICT DO UPDATE SET n = n + delta. Never a recompute in
--   the hot path, with one exception: a run whose execution_trace is
--   rewritten (not appended to, e.g. capped) recounts that run's trace.
--   Appended trace entries are counted from the old length on (O(new
--   entries)). Busy buckets: a run / submission lands in shard
--   hashtext(id) & 3, so concurrent writers of one workflow-day contend on
--   4 rows, not 1; reads sum the shards. UPDATE OF column lists keep the
--   triggers off unrelated updates (variables, titles, progress …).
--   Each trigger holds a SHARED advisory lock per (tenant, day) touched for
--   the rest of its transaction; an exact rebuild of a day takes it
--   EXCLUSIVE, so a rebuild never races an in-flight delta.
--   SET usertasks.report_rollups = 'defer' (session / transaction) makes the
--   triggers queue dirty days instead (bulk loads); 'off' skips them (then
--   queue a rebuild). Deletes cascaded from a workflow / form / tenant
--   delete (the parent row is already gone) are skipped: their rollup rows
--   are removed by the workflow / form delete triggers and the tenant FKs.
--
-- Safety net and history (lib/jobs/report-rollups.ts, the report-rollups job
-- of the scheduler tick, and usertasks-admin rollups):
--   report_rollup_drain_next      rebuild queued dirty ranges
--   report_rollup_backfill_next   per tenant, from today backwards in chunks
--                                 of days: exact rebuilds; resumable (cursor
--                                 in report_rollup_state). Days on or after
--                                 covered_from are exact; until a tenant is
--                                 covered, reads fall back to the live RPCs.
--   report_rollup_reconcile_next  hourly per tenant: rebuild today and
--                                 yesterday (also compacts their shards).
--   A rebuild never waits for a lock while it holds another (first lock
--   blocking, the rest try-locks; it stops early instead), so it cannot
--   deadlock with the triggers.
--
-- Reads (SECURITY INVOKER: RLS applies to signed-in callers; the services
-- check permissions and scope the ids exactly as before):
--   report_rollup_run_days / _run_hists / _node_visits / _task_days /
--   _task_hists / _submission_days(tenant, since, until, …) → jsonb
--   Full UTC days inside [since, until) come from the rollups — today too,
--   kept current by the triggers. Partial days at either edge (a window
--   that starts at 14:23, or ends before now) are aggregated live from the
--   raw rows, so any window is exact. An open end (until NULL, or within a
--   minute of now) counts as "up to now". {ok:false, reason} when the
--   tenant is not backfilled far enough back: the caller uses the live path.
--
-- Percentiles: durations are kept in a log histogram — bucket 1 is < 1 ms,
-- bucket b ≥ 2 holds [2^((b−2)/4), 2^((b−1)/4)) ms, 160 buckets (up to ~24
-- years). A percentile is percentile_cont over bucket midpoints
-- (2^((b−1.5)/4)): within 9.1% of the exact value (lib/report-rollups/hist).
-- Counts, sums and averages are exact.
--
-- RLS: run / node rollups readable with workflows.view_runs in the row's
-- workspace, submission rollups with forms.edit, task rollups with
-- tasks.view_all — or the rows of tasks assigned to the caller or queued for
-- a team they are in. No client writes. State / dirty: service role only.
--
-- Additive and idempotent. Indexes added for the live edges and the
-- backfill: workflow_runs (tenant_id, completed_at), tasks (tenant_id,
-- completed_at), form_submissions (tenant_id, created_at). On a large
-- install create them CONCURRENTLY first (docs/migrations.md).
-- ============================================================================

SET lock_timeout = '5s';

/* ── Tables ───────────────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.report_rollup_runs (
  tenant_id            uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  day                  date NOT NULL,
  workflow_id          uuid NOT NULL,
  shard                smallint NOT NULL DEFAULT 0,
  -- runs started this day
  runs                 bigint NOT NULL DEFAULT 0,
  st_completed         bigint NOT NULL DEFAULT 0,
  st_failed            bigint NOT NULL DEFAULT 0,   -- status failed (manual cancellations included)
  st_cancel_manual     bigint NOT NULL DEFAULT 0,   -- failed + 'Manually cancelled'
  st_cancelled         bigint NOT NULL DEFAULT 0,   -- status cancelled / canceled
  st_running           bigint NOT NULL DEFAULT 0,
  st_waiting_for_event bigint NOT NULL DEFAULT 0,
  st_paused            bigint NOT NULL DEFAULT 0,
  st_pending           bigint NOT NULL DEFAULT 0,
  st_waiting           bigint NOT NULL DEFAULT 0,
  done_n               bigint NOT NULL DEFAULT 0,   -- completed with completed_at
  done_ms              double precision NOT NULL DEFAULT 0,
  timed_n              bigint NOT NULL DEFAULT 0,   -- completed_at > started_at, any status
  timed_ms             double precision NOT NULL DEFAULT 0,
  node_visits          bigint NOT NULL DEFAULT 0,
  edge_traversals      bigint NOT NULL DEFAULT 0,
  hist                 integer[] NOT NULL DEFAULT '{}',
  last_started_at      timestamptz,
  last_completed_at    timestamptz,
  -- runs completed this day (status completed)
  fin_n                bigint NOT NULL DEFAULT 0,
  fin_on_time          bigint NOT NULL DEFAULT 0,
  fin_late             bigint NOT NULL DEFAULT 0,
  fin_no_due           bigint NOT NULL DEFAULT 0,
  fin_ms               double precision NOT NULL DEFAULT 0,
  fin_hist             integer[] NOT NULL DEFAULT '{}',
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day, workflow_id, shard)
) WITH (fillfactor = 80);

CREATE INDEX IF NOT EXISTS idx_report_rollup_runs_workflow
  ON public.report_rollup_runs (tenant_id, workflow_id, day);

CREATE TABLE IF NOT EXISTS public.report_rollup_nodes (
  tenant_id   uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL,
  day         date NOT NULL,
  node_id     text NOT NULL,
  shard       smallint NOT NULL DEFAULT 0,
  visits      bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, workflow_id, day, node_id, shard)
) WITH (fillfactor = 80);

CREATE TABLE IF NOT EXISTS public.report_rollup_tasks (
  tenant_id       uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  day             date NOT NULL,
  workflow_id     uuid NOT NULL,
  team_id         uuid NOT NULL,
  assignee_id     uuid NOT NULL,
  -- created this day, by current status
  cr_total        bigint NOT NULL DEFAULT 0,
  cr_draft        bigint NOT NULL DEFAULT 0,
  cr_todo         bigint NOT NULL DEFAULT 0,
  cr_in_progress  bigint NOT NULL DEFAULT 0,
  cr_blocked      bigint NOT NULL DEFAULT 0,
  cr_completed    bigint NOT NULL DEFAULT 0,
  cr_cancelled    bigint NOT NULL DEFAULT 0,
  -- completed this day
  done_n          bigint NOT NULL DEFAULT 0,
  done_on_time    bigint NOT NULL DEFAULT 0,
  done_late       bigint NOT NULL DEFAULT 0,
  done_no_due     bigint NOT NULL DEFAULT 0,
  done_ms         double precision NOT NULL DEFAULT 0,
  done_hist       integer[] NOT NULL DEFAULT '{}',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day, workflow_id, team_id, assignee_id)
) WITH (fillfactor = 80);

CREATE TABLE IF NOT EXISTS public.report_rollup_submissions (
  tenant_id   uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  day         date NOT NULL,
  form_id     uuid NOT NULL,
  shard       smallint NOT NULL DEFAULT 0,
  submissions bigint NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, day, form_id, shard)
) WITH (fillfactor = 80);

CREATE INDEX IF NOT EXISTS idx_report_rollup_submissions_form
  ON public.report_rollup_submissions (tenant_id, form_id, day);

CREATE TABLE IF NOT EXISTS public.report_rollup_state (
  tenant_id             uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  -- Days on or after covered_from are exact (NULL: none yet); every day once backfill_done.
  covered_from          date,
  backfill_cursor       date,
  oldest_day            date,
  backfill_done         boolean NOT NULL DEFAULT false,
  backfill_started_at   timestamptz NOT NULL DEFAULT now(),
  backfill_completed_at timestamptz,
  days_rebuilt          bigint NOT NULL DEFAULT 0,
  last_refresh_at       timestamptz,
  last_reconciled_at    timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.report_rollup_dirty (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  day_from     date NOT NULL,
  day_to       date NOT NULL,
  reason       text NOT NULL DEFAULT 'requested',
  requested_at timestamptz NOT NULL DEFAULT now(),
  CHECK (day_to >= day_from),
  UNIQUE (tenant_id, day_from, day_to)
);

COMMENT ON TABLE public.report_rollup_runs IS 'Report rollup: workflow runs per tenant × workflow × UTC day (started-side and completed-side counters), maintained by deltas from workflow_runs triggers. Migration 20270123100000.';
COMMENT ON TABLE public.report_rollup_nodes IS 'Report rollup: node visits of runs started per tenant × workflow × UTC day × node.';
COMMENT ON TABLE public.report_rollup_tasks IS 'Report rollup: top-level tasks created / completed per tenant × UTC day × workflow × team × assignee (zero uuid = none).';
COMMENT ON TABLE public.report_rollup_submissions IS 'Report rollup: form submissions per tenant × form × UTC day.';
COMMENT ON TABLE public.report_rollup_state IS 'Report rollups: per-tenant backfill progress; days >= covered_from (all once backfill_done) are exact.';
COMMENT ON TABLE public.report_rollup_dirty IS 'Report rollups: day ranges queued for an exact rebuild (requests, deferred trigger work).';

-- Live edges and the backfill's oldest-day probe.
CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant_completed
  ON public.workflow_runs (tenant_id, completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_completed_at
  ON public.tasks (tenant_id, completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_form_submissions_tenant_created
  ON public.form_submissions (tenant_id, created_at);

/* ── Helpers ──────────────────────────────────────────────────────────── */

CREATE OR REPLACE FUNCTION public.report_rollup_day(p_ts timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $$ SELECT (p_ts AT TIME ZONE 'UTC')::date $$;

-- Start of a UTC day as timestamptz (±infinity stay infinite).
CREATE OR REPLACE FUNCTION public.report_rollup_day_start(p_day date)
RETURNS timestamptz LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $$ SELECT p_day::timestamp AT TIME ZONE 'UTC' $$;

CREATE OR REPLACE FUNCTION public.report_rollup_shard(p_id uuid)
RETURNS smallint LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $$ SELECT (hashtext(p_id::text) & 3)::smallint $$;

-- Histogram bucket of a duration in ms (see the header). NULL stays NULL.
CREATE OR REPLACE FUNCTION public.report_rollup_ms_bucket(p_ms double precision)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $$
  SELECT CASE WHEN p_ms IS NULL THEN NULL
              WHEN p_ms < 1 THEN 1
              ELSE least(160, 2 + floor(4 * ln(p_ms) / ln(2::double precision))::integer) END
$$;

-- An int[] with n at position b (1-based, zero-padded); '{}' for NULL b or 0 n.
CREATE OR REPLACE FUNCTION public.report_rollup_hist_one(p_bucket integer, p_n integer)
RETURNS integer[] LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $$
  SELECT CASE WHEN p_bucket IS NULL OR p_bucket < 1 OR coalesce(p_n, 0) = 0 THEN '{}'::integer[]
              ELSE array_fill(0, ARRAY[p_bucket - 1]) || p_n END
$$;

-- Element-wise sum of two histograms (any lengths).
CREATE OR REPLACE FUNCTION public.report_rollup_hist_add(a integer[], b integer[])
RETURNS integer[] LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $$
DECLARE
  la integer := coalesce(cardinality(a), 0);
  lb integer := coalesce(cardinality(b), 0);
  r integer[];
BEGIN
  IF lb = 0 THEN RETURN coalesce(a, '{}'); END IF;
  IF la = 0 THEN RETURN b; END IF;
  IF la >= lb THEN
    r := a;
    FOR i IN 1..lb LOOP r[i] := r[i] + b[i]; END LOOP;
  ELSE
    r := b;
    FOR i IN 1..la LOOP r[i] := r[i] + a[i]; END LOOP;
  END IF;
  RETURN r;
END;
$$;

-- Count one value per bucket (aggregate state function).
CREATE OR REPLACE FUNCTION public.report_rollup_hist_inc(a integer[], p_bucket integer)
RETURNS integer[] LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $$
DECLARE
  n integer := coalesce(cardinality(a), 0);
BEGIN
  IF p_bucket IS NULL OR p_bucket < 1 THEN RETURN a; END IF;
  IF n < p_bucket THEN a := coalesce(a, '{}') || array_fill(0, ARRAY[p_bucket - n]); END IF;
  a[p_bucket] := a[p_bucket] + 1;
  RETURN a;
END;
$$;

DO $agg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'report_rollup_hist_agg') THEN
    CREATE AGGREGATE public.report_rollup_hist_agg(integer) (SFUNC = public.report_rollup_hist_inc, STYPE = integer[], INITCOND = '{}');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'report_rollup_hist_sum') THEN
    CREATE AGGREGATE public.report_rollup_hist_sum(integer[]) (SFUNC = public.report_rollup_hist_add, STYPE = integer[], INITCOND = '{}');
  END IF;
END $agg$;

-- Per node of one run: its trace visits, else 1 when node_results has it
-- (the semantics of workflow_node_visit_stats, 20261028000000).
CREATE OR REPLACE FUNCTION public.report_rollup_run_nodes(p_trace jsonb, p_results jsonb)
RETURNS TABLE (node_id text, visits bigint)
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $$
  WITH traced AS (
    SELECT e->>'node_id' AS node_id, count(*) AS n
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_trace) = 'array' THEN p_trace ELSE '[]'::jsonb END) e
     WHERE jsonb_typeof(e) = 'object' AND e->>'type' = 'node' AND e->>'node_id' IS NOT NULL
     GROUP BY 1
  ), resulted AS (
    SELECT k AS node_id
      FROM jsonb_object_keys(CASE WHEN jsonb_typeof(p_results) = 'object' THEN p_results ELSE '{}'::jsonb END) k
  )
  SELECT coalesce(t.node_id, x.node_id), coalesce(t.n, 1)::bigint
    FROM traced t FULL JOIN resulted x ON x.node_id = t.node_id
$$;

/* ── Raw aggregates (the definition every rollup row must equal) ─────── */

CREATE OR REPLACE FUNCTION public.report_rollup_runs_agg(p_tenant_id uuid, p_from timestamptz, p_to timestamptz, p_workflow_ids uuid[] DEFAULT NULL)
RETURNS TABLE (
  workflow_id uuid, day date,
  runs bigint, st_completed bigint, st_failed bigint, st_cancel_manual bigint, st_cancelled bigint,
  st_running bigint, st_waiting_for_event bigint, st_paused bigint, st_pending bigint, st_waiting bigint,
  done_n bigint, done_ms double precision, timed_n bigint, timed_ms double precision,
  node_visits bigint, edge_traversals bigint, hist integer[],
  last_started_at timestamptz, last_completed_at timestamptz,
  fin_n bigint, fin_on_time bigint, fin_late bigint, fin_no_due bigint, fin_ms double precision, fin_hist integer[]
)
LANGUAGE sql STABLE SET search_path TO ''
AS $$
  WITH s AS (
    SELECT r.workflow_id, public.report_rollup_day(r.started_at) AS day,
      count(*) AS runs,
      count(*) FILTER (WHERE r.status = 'completed') AS st_completed,
      count(*) FILTER (WHERE r.status = 'failed') AS st_failed,
      count(*) FILTER (WHERE r.status = 'failed' AND r.error = 'Manually cancelled') AS st_cancel_manual,
      count(*) FILTER (WHERE r.status IN ('cancelled', 'canceled')) AS st_cancelled,
      count(*) FILTER (WHERE r.status = 'running') AS st_running,
      count(*) FILTER (WHERE r.status = 'waiting_for_event') AS st_waiting_for_event,
      count(*) FILTER (WHERE r.status = 'paused') AS st_paused,
      count(*) FILTER (WHERE r.status = 'pending') AS st_pending,
      count(*) FILTER (WHERE r.status = 'waiting') AS st_waiting,
      count(*) FILTER (WHERE r.status = 'completed' AND r.completed_at IS NOT NULL) AS done_n,
      coalesce(sum(extract(epoch FROM r.completed_at - r.started_at)::double precision * 1000)
        FILTER (WHERE r.status = 'completed' AND r.completed_at IS NOT NULL), 0) AS done_ms,
      count(*) FILTER (WHERE r.completed_at > r.started_at) AS timed_n,
      coalesce(sum(extract(epoch FROM r.completed_at - r.started_at)::double precision * 1000)
        FILTER (WHERE r.completed_at > r.started_at), 0) AS timed_ms,
      coalesce(sum(CASE WHEN c.trace_node_visits > 0 THEN c.trace_node_visits ELSE c.result_node_count END), 0)::bigint AS node_visits,
      coalesce(sum(c.edge_traversals), 0)::bigint AS edge_traversals,
      public.report_rollup_hist_agg(public.report_rollup_ms_bucket(extract(epoch FROM r.completed_at - r.started_at)::double precision * 1000))
        FILTER (WHERE r.status = 'completed' AND r.completed_at IS NOT NULL) AS hist,
      max(r.started_at) AS last_started_at,
      max(r.completed_at) FILTER (WHERE r.status = 'completed') AS last_completed_at
    FROM public.workflow_runs r
    CROSS JOIN LATERAL public.workflow_run_trace_counts(r.execution_trace, r.node_results) c
    WHERE r.tenant_id = p_tenant_id AND r.started_at >= p_from AND r.started_at < p_to
      AND (p_workflow_ids IS NULL OR r.workflow_id = ANY (p_workflow_ids))
    GROUP BY 1, 2
  ), f AS (
    SELECT r.workflow_id, public.report_rollup_day(r.completed_at) AS day,
      count(*) AS fin_n,
      count(*) FILTER (WHERE r.sla_due_at IS NOT NULL AND r.completed_at <= r.sla_due_at) AS fin_on_time,
      count(*) FILTER (WHERE r.sla_due_at IS NOT NULL AND r.completed_at > r.sla_due_at) AS fin_late,
      count(*) FILTER (WHERE r.sla_due_at IS NULL) AS fin_no_due,
      coalesce(sum(greatest(extract(epoch FROM r.completed_at - r.started_at)::double precision * 1000, 0)), 0) AS fin_ms,
      public.report_rollup_hist_agg(public.report_rollup_ms_bucket(greatest(extract(epoch FROM r.completed_at - r.started_at)::double precision * 1000, 0))) AS fin_hist
    FROM public.workflow_runs r
    WHERE r.tenant_id = p_tenant_id AND r.status = 'completed'
      AND r.completed_at >= p_from AND r.completed_at < p_to
      AND (p_workflow_ids IS NULL OR r.workflow_id = ANY (p_workflow_ids))
    GROUP BY 1, 2
  )
  SELECT coalesce(s.workflow_id, f.workflow_id), coalesce(s.day, f.day),
    coalesce(s.runs, 0), coalesce(s.st_completed, 0), coalesce(s.st_failed, 0), coalesce(s.st_cancel_manual, 0), coalesce(s.st_cancelled, 0),
    coalesce(s.st_running, 0), coalesce(s.st_waiting_for_event, 0), coalesce(s.st_paused, 0), coalesce(s.st_pending, 0), coalesce(s.st_waiting, 0),
    coalesce(s.done_n, 0), coalesce(s.done_ms, 0), coalesce(s.timed_n, 0), coalesce(s.timed_ms, 0),
    coalesce(s.node_visits, 0), coalesce(s.edge_traversals, 0), coalesce(s.hist, '{}'),
    s.last_started_at, s.last_completed_at,
    coalesce(f.fin_n, 0), coalesce(f.fin_on_time, 0), coalesce(f.fin_late, 0), coalesce(f.fin_no_due, 0), coalesce(f.fin_ms, 0), coalesce(f.fin_hist, '{}')
  FROM s FULL JOIN f ON f.workflow_id = s.workflow_id AND f.day = s.day
$$;

CREATE OR REPLACE FUNCTION public.report_rollup_nodes_agg(p_tenant_id uuid, p_from timestamptz, p_to timestamptz, p_workflow_ids uuid[] DEFAULT NULL)
RETURNS TABLE (workflow_id uuid, day date, node_id text, visits bigint)
LANGUAGE sql STABLE SET search_path TO ''
AS $$
  SELECT r.workflow_id, public.report_rollup_day(r.started_at), v.node_id, sum(v.visits)::bigint
    FROM public.workflow_runs r
    CROSS JOIN LATERAL public.report_rollup_run_nodes(r.execution_trace, r.node_results) v
   WHERE r.tenant_id = p_tenant_id AND r.started_at >= p_from AND r.started_at < p_to
     AND (p_workflow_ids IS NULL OR r.workflow_id = ANY (p_workflow_ids))
   GROUP BY 1, 2, 3
$$;

CREATE OR REPLACE FUNCTION public.report_rollup_tasks_agg(p_tenant_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  day date, workflow_id uuid, team_id uuid, assignee_id uuid,
  cr_total bigint, cr_draft bigint, cr_todo bigint, cr_in_progress bigint, cr_blocked bigint, cr_completed bigint, cr_cancelled bigint,
  done_n bigint, done_on_time bigint, done_late bigint, done_no_due bigint, done_ms double precision, done_hist integer[]
)
LANGUAGE sql STABLE SET search_path TO ''
AS $$
  WITH z AS (SELECT '00000000-0000-0000-0000-000000000000'::uuid AS id),
  c AS (
    SELECT public.report_rollup_day(t.created_at) AS day,
      coalesce(t.workflow_id, z.id) AS workflow_id, coalesce(t.assigned_team_id, z.id) AS team_id, coalesce(t.assignee_id, z.id) AS assignee_id,
      count(*) AS cr_total,
      count(*) FILTER (WHERE t.status = 'draft') AS cr_draft,
      count(*) FILTER (WHERE t.status = 'todo') AS cr_todo,
      count(*) FILTER (WHERE t.status = 'in_progress') AS cr_in_progress,
      count(*) FILTER (WHERE t.status = 'blocked') AS cr_blocked,
      count(*) FILTER (WHERE t.status = 'completed') AS cr_completed,
      count(*) FILTER (WHERE t.status = 'cancelled') AS cr_cancelled
    FROM public.tasks t, z
    WHERE t.tenant_id = p_tenant_id AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
      AND t.created_at >= p_from AND t.created_at < p_to
    GROUP BY 1, 2, 3, 4
  ), d AS (
    SELECT public.report_rollup_day(t.completed_at) AS day,
      coalesce(t.workflow_id, z.id) AS workflow_id, coalesce(t.assigned_team_id, z.id) AS team_id, coalesce(t.assignee_id, z.id) AS assignee_id,
      count(*) AS done_n,
      count(*) FILTER (WHERE t.due_date IS NOT NULL AND t.completed_at <= t.due_date) AS done_on_time,
      count(*) FILTER (WHERE t.due_date IS NOT NULL AND t.completed_at > t.due_date) AS done_late,
      count(*) FILTER (WHERE t.due_date IS NULL) AS done_no_due,
      coalesce(sum(greatest(extract(epoch FROM t.completed_at - t.created_at)::double precision * 1000, 0)), 0) AS done_ms,
      public.report_rollup_hist_agg(public.report_rollup_ms_bucket(greatest(extract(epoch FROM t.completed_at - t.created_at)::double precision * 1000, 0))) AS done_hist
    FROM public.tasks t, z
    WHERE t.tenant_id = p_tenant_id AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
      AND t.status = 'completed' AND t.completed_at >= p_from AND t.completed_at < p_to
    GROUP BY 1, 2, 3, 4
  )
  SELECT coalesce(c.day, d.day), coalesce(c.workflow_id, d.workflow_id), coalesce(c.team_id, d.team_id), coalesce(c.assignee_id, d.assignee_id),
    coalesce(c.cr_total, 0), coalesce(c.cr_draft, 0), coalesce(c.cr_todo, 0), coalesce(c.cr_in_progress, 0), coalesce(c.cr_blocked, 0),
    coalesce(c.cr_completed, 0), coalesce(c.cr_cancelled, 0),
    coalesce(d.done_n, 0), coalesce(d.done_on_time, 0), coalesce(d.done_late, 0), coalesce(d.done_no_due, 0), coalesce(d.done_ms, 0), coalesce(d.done_hist, '{}')
  FROM c FULL JOIN d ON d.day = c.day AND d.workflow_id = c.workflow_id AND d.team_id = c.team_id AND d.assignee_id = c.assignee_id
$$;

CREATE OR REPLACE FUNCTION public.report_rollup_submissions_agg(p_tenant_id uuid, p_from timestamptz, p_to timestamptz, p_form_ids uuid[] DEFAULT NULL)
RETURNS TABLE (form_id uuid, day date, submissions bigint)
LANGUAGE sql STABLE SET search_path TO ''
AS $$
  SELECT s.form_id, public.report_rollup_day(s.created_at), count(*)
    FROM public.form_submissions s
   WHERE s.tenant_id = p_tenant_id AND s.created_at >= p_from AND s.created_at < p_to
     AND (p_form_ids IS NULL OR s.form_id = ANY (p_form_ids))
   GROUP BY 1, 2
$$;

/* ── Locks ────────────────────────────────────────────────────────────── */

-- Advisory lock key of a (tenant, day): class 1381127504, object hashtext.
CREATE OR REPLACE FUNCTION public.report_rollup_lock_key(p_tenant_id uuid, p_day date)
RETURNS integer LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO ''
AS $$ SELECT hashtext(p_tenant_id::text || ':' || p_day::text) $$;

/* ── Triggers (the hot path) ──────────────────────────────────────────── */

CREATE OR REPLACE FUNCTION public.report_rollup_runs_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_mode text := coalesce(current_setting('usertasks.report_rollups', true), '');
  o public.workflow_runs;
  n public.workflow_runs;
  v_same boolean := false;
  v_trace_changed boolean := false;
  v_inc boolean := false;
  o_len integer;
  n_len integer;
  app_nodes integer := 0;
  app_edges integer := 0;
  d_nodes bigint := 0;
  d_edges bigint := 0;
  v_res_changed boolean := false;
  v_old_has boolean;
  o_nv bigint := 0;
  o_ev bigint := 0;
  n_nv bigint := 0;
  n_ev bigint := 0;
  o_ms double precision;
  n_ms double precision;
  v_key integer;
BEGIN
  IF v_mode = 'off' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN
    -- Cascaded from a workflow / tenant delete (the parent row is already
    -- gone in this transaction): its rollup rows are removed wholesale.
    IF NOT EXISTS (SELECT 1 FROM public.workflows w WHERE w.id = OLD.workflow_id) THEN RETURN NULL; END IF;
    o := OLD;
  ELSIF TG_OP = 'INSERT' THEN
    n := NEW;
  ELSE
    o := OLD; n := NEW;
  END IF;

  IF v_mode = 'defer' THEN
    INSERT INTO public.report_rollup_dirty (tenant_id, day_from, day_to, reason)
    SELECT DISTINCT u.t, u.d, u.d, 'deferred'
      FROM unnest(ARRAY[o.tenant_id, o.tenant_id, n.tenant_id, n.tenant_id],
                  ARRAY[public.report_rollup_day(o.started_at), public.report_rollup_day(o.completed_at),
                        public.report_rollup_day(n.started_at), public.report_rollup_day(n.completed_at)]) AS u(t, d)
     WHERE u.t IS NOT NULL AND u.d IS NOT NULL
    ON CONFLICT (tenant_id, day_from, day_to) DO NOTHING;
    RETURN NULL;
  END IF;

  -- Shared locks per (tenant, day) touched (an exact rebuild of a day takes it exclusive).
  FOR v_key IN
    SELECT DISTINCT x FROM unnest(ARRAY[
      public.report_rollup_lock_key(o.tenant_id, public.report_rollup_day(o.started_at)),
      public.report_rollup_lock_key(o.tenant_id, public.report_rollup_day(o.completed_at)),
      public.report_rollup_lock_key(n.tenant_id, public.report_rollup_day(n.started_at)),
      public.report_rollup_lock_key(n.tenant_id, public.report_rollup_day(n.completed_at))]) AS x
     WHERE x IS NOT NULL ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock_shared(1381127504, v_key);
  END LOOP;

  v_same := TG_OP = 'UPDATE' AND o.id = n.id AND o.tenant_id = n.tenant_id
            AND o.workflow_id = n.workflow_id AND o.started_at = n.started_at;

  IF v_same THEN
    v_trace_changed := n.execution_trace IS DISTINCT FROM o.execution_trace;
    v_res_changed := n.node_results IS DISTINCT FROM o.node_results;
    IF v_trace_changed OR v_res_changed THEN
      o_len := CASE WHEN jsonb_typeof(o.execution_trace) = 'array' THEN jsonb_array_length(o.execution_trace) END;
      n_len := CASE WHEN jsonb_typeof(n.execution_trace) = 'array' THEN jsonb_array_length(n.execution_trace) END;
      -- Append-only: the new trace starts with the old one (last old entry unchanged).
      v_inc := o_len IS NOT NULL AND n_len IS NOT NULL AND n_len >= o_len
               AND (o_len = 0 OR (n.execution_trace -> (o_len - 1)) = (o.execution_trace -> (o_len - 1)));
      IF v_inc THEN
        IF n_len > o_len THEN
          SELECT count(*) FILTER (WHERE e->>'type' = 'node' AND jsonb_typeof(e->'node_id') = 'string'),
                 count(*) FILTER (WHERE e->>'type' = 'edge')
            INTO app_nodes, app_edges
            FROM generate_series(o_len, n_len - 1) AS i
            CROSS JOIN LATERAL (SELECT n.execution_trace -> i AS e) z
           WHERE jsonb_typeof(z.e) = 'object';
        END IF;
        d_edges := app_edges;
        IF app_nodes > 0 OR v_res_changed THEN
          v_old_has := o_len > 0 AND jsonb_path_exists(o.execution_trace, '$[*] ? (@.type == "node" && @.node_id.type() == "string")');
          IF v_old_has THEN
            d_nodes := app_nodes;
          ELSE
            d_nodes := (CASE WHEN app_nodes > 0 THEN app_nodes
                             WHEN jsonb_typeof(n.node_results) = 'object' THEN (SELECT count(*) FROM jsonb_object_keys(n.node_results))
                             ELSE 0 END)
                     - (CASE WHEN jsonb_typeof(o.node_results) = 'object' THEN (SELECT count(*) FROM jsonb_object_keys(o.node_results)) ELSE 0 END);
          END IF;
        END IF;

        -- Node visits of the nodes this change touches (appended entries, added / removed results).
        INSERT INTO public.report_rollup_nodes AS t (tenant_id, workflow_id, day, node_id, shard, visits)
        SELECT n.tenant_id, n.workflow_id, public.report_rollup_day(n.started_at), q.node_id, public.report_rollup_shard(n.id), q.delta
          FROM (
            WITH app AS (
              SELECT z.e->>'node_id' AS node_id, count(*) AS a
                FROM generate_series(o_len, n_len - 1) AS i
                CROSS JOIN LATERAL (SELECT n.execution_trace -> i AS e) z
               WHERE n_len > o_len AND jsonb_typeof(z.e) = 'object' AND z.e->>'type' = 'node' AND z.e->>'node_id' IS NOT NULL
               GROUP BY 1
            ), nk AS (
              SELECT k FROM jsonb_object_keys(CASE WHEN v_res_changed AND jsonb_typeof(n.node_results) = 'object' THEN n.node_results ELSE '{}'::jsonb END) k
            ), ok AS (
              SELECT k FROM jsonb_object_keys(CASE WHEN v_res_changed AND jsonb_typeof(o.node_results) = 'object' THEN o.node_results ELSE '{}'::jsonb END) k
            ), aff AS (
              SELECT app.node_id FROM app
              UNION SELECT k FROM (SELECT k FROM nk EXCEPT SELECT k FROM ok) a
              UNION SELECT k FROM (SELECT k FROM ok EXCEPT SELECT k FROM nk) b
            )
            SELECT aff.node_id,
              CASE WHEN o_len > 0 AND o.execution_trace @> jsonb_build_array(jsonb_build_object('type', 'node', 'node_id', aff.node_id))
                     THEN coalesce(app.a, 0)
                   ELSE (CASE WHEN coalesce(app.a, 0) > 0 THEN app.a
                              WHEN jsonb_typeof(n.node_results) = 'object' AND n.node_results ? aff.node_id THEN 1 ELSE 0 END)
                      - (CASE WHEN jsonb_typeof(o.node_results) = 'object' AND o.node_results ? aff.node_id THEN 1 ELSE 0 END)
              END AS delta
            FROM aff LEFT JOIN app ON app.node_id = aff.node_id
          ) q
         WHERE q.delta <> 0
        ON CONFLICT (tenant_id, workflow_id, day, node_id, shard) DO UPDATE SET visits = t.visits + EXCLUDED.visits;
      ELSE
        -- Trace rewritten: recount this run's trace (old out, new in).
        SELECT coalesce(sum(CASE WHEN c.trace_node_visits > 0 THEN c.trace_node_visits ELSE c.result_node_count END), 0)
          INTO d_nodes FROM public.workflow_run_trace_counts(n.execution_trace, n.node_results) c;
        d_nodes := d_nodes - (SELECT coalesce(sum(CASE WHEN c.trace_node_visits > 0 THEN c.trace_node_visits ELSE c.result_node_count END), 0)
                                FROM public.workflow_run_trace_counts(o.execution_trace, o.node_results) c);
        d_edges := (SELECT coalesce(sum(c.edge_traversals), 0) FROM public.workflow_run_trace_counts(n.execution_trace, n.node_results) c)
                 - (SELECT coalesce(sum(c.edge_traversals), 0) FROM public.workflow_run_trace_counts(o.execution_trace, o.node_results) c);
      END IF;
    END IF;
  END IF;

  -- Trace-derived counts of the whole row (insert / delete / key change); an
  -- empty trace and results (a run just queued) need no work.
  IF NOT v_same THEN
    IF o.id IS NOT NULL AND (o.execution_trace IS DISTINCT FROM '[]'::jsonb OR o.node_results IS DISTINCT FROM '{}'::jsonb) THEN
      SELECT CASE WHEN c.trace_node_visits > 0 THEN c.trace_node_visits ELSE c.result_node_count END, c.edge_traversals INTO o_nv, o_ev
        FROM public.workflow_run_trace_counts(o.execution_trace, o.node_results) c;
    END IF;
    IF n.id IS NOT NULL AND (n.execution_trace IS DISTINCT FROM '[]'::jsonb OR n.node_results IS DISTINCT FROM '{}'::jsonb) THEN
      SELECT CASE WHEN c.trace_node_visits > 0 THEN c.trace_node_visits ELSE c.result_node_count END, c.edge_traversals INTO n_nv, n_ev
        FROM public.workflow_run_trace_counts(n.execution_trace, n.node_results) c;
    END IF;
  END IF;

  -- Full node contributions when the key changed, on insert / delete, or after a rewrite.
  IF (NOT v_same AND (o_nv <> 0 OR n_nv <> 0)) OR ((v_trace_changed OR v_res_changed) AND NOT v_inc) THEN
    INSERT INTO public.report_rollup_nodes AS t (tenant_id, workflow_id, day, node_id, shard, visits)
    SELECT q.tenant_id, q.workflow_id, q.day, q.node_id, q.shard, sum(q.v)
      FROM (
        SELECT o.tenant_id, o.workflow_id, public.report_rollup_day(o.started_at) AS day, public.report_rollup_shard(o.id) AS shard, v.node_id, -v.visits AS v
          FROM public.report_rollup_run_nodes(o.execution_trace, o.node_results) v WHERE o.id IS NOT NULL
        UNION ALL
        SELECT n.tenant_id, n.workflow_id, public.report_rollup_day(n.started_at), public.report_rollup_shard(n.id), v.node_id, v.visits
          FROM public.report_rollup_run_nodes(n.execution_trace, n.node_results) v WHERE n.id IS NOT NULL
      ) q
     GROUP BY q.tenant_id, q.workflow_id, q.day, q.node_id, q.shard
    HAVING sum(q.v) <> 0
    ON CONFLICT (tenant_id, workflow_id, day, node_id, shard) DO UPDATE SET visits = t.visits + EXCLUDED.visits;
  END IF;

  o_ms := extract(epoch FROM o.completed_at - o.started_at)::double precision * 1000;
  n_ms := extract(epoch FROM n.completed_at - n.started_at)::double precision * 1000;

  -- One upsert per affected bucket: old contribution out, new in (inline, no
  -- function calls per row: the plan is cached with the trigger).
  INSERT INTO public.report_rollup_runs AS t (tenant_id, workflow_id, day, shard, runs, st_completed, st_failed, st_cancel_manual, st_cancelled, st_running, st_waiting_for_event, st_paused, st_pending, st_waiting, done_n, done_ms, timed_n, timed_ms, node_visits, edge_traversals, hist, last_started_at, last_completed_at, fin_n, fin_on_time, fin_late, fin_no_due, fin_ms, fin_hist)
  SELECT d.tenant_id, d.workflow_id, d.day, d.shard,
    sum(d.runs), sum(d.st_completed), sum(d.st_failed), sum(d.st_cancel_manual), sum(d.st_cancelled), sum(d.st_running),
    sum(d.st_waiting_for_event), sum(d.st_paused), sum(d.st_pending), sum(d.st_waiting),
    sum(d.done_n), sum(d.done_ms), sum(d.timed_n), sum(d.timed_ms), sum(d.node_visits), sum(d.edge_traversals),
    public.report_rollup_hist_sum(d.hist), max(d.last_started_at), max(d.last_completed_at),
    sum(d.fin_n), sum(d.fin_on_time), sum(d.fin_late), sum(d.fin_no_due), sum(d.fin_ms), public.report_rollup_hist_sum(d.fin_hist)
  FROM (VALUES
    (o.tenant_id, o.workflow_id, public.report_rollup_day(o.started_at), public.report_rollup_shard(o.id), -1, -(o.status = 'completed')::int, -(o.status = 'failed')::int, -(o.status = 'failed' AND o.error IS NOT DISTINCT FROM 'Manually cancelled')::int, -(o.status IN ('cancelled', 'canceled'))::int, -(o.status = 'running')::int, -(o.status = 'waiting_for_event')::int, -(o.status = 'paused')::int, -(o.status = 'pending')::int, -(o.status = 'waiting')::int, -((o.status = 'completed' AND o.completed_at IS NOT NULL))::int, CASE WHEN (o.status = 'completed' AND o.completed_at IS NOT NULL) THEN -o_ms ELSE 0 END, -(coalesce(o.completed_at > o.started_at, false))::int, CASE WHEN coalesce(o.completed_at > o.started_at, false) THEN -o_ms ELSE 0 END, -o_nv, -o_ev, public.report_rollup_hist_one(CASE WHEN (o.status = 'completed' AND o.completed_at IS NOT NULL) THEN public.report_rollup_ms_bucket(o_ms) END, -1), NULL::timestamptz, NULL::timestamptz, 0, 0, 0, 0, 0::double precision, '{}'::integer[]),
    (o.tenant_id, o.workflow_id, CASE WHEN (o.status = 'completed' AND o.completed_at IS NOT NULL) THEN public.report_rollup_day(o.completed_at) END, public.report_rollup_shard(o.id), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0::double precision, 0, 0::double precision, 0, 0, '{}'::integer[], NULL::timestamptz, NULL::timestamptz, -1, -(o.sla_due_at IS NOT NULL AND o.completed_at <= o.sla_due_at)::int, -(o.sla_due_at IS NOT NULL AND o.completed_at > o.sla_due_at)::int, -(o.sla_due_at IS NULL)::int, -greatest(o_ms, 0), public.report_rollup_hist_one(public.report_rollup_ms_bucket(greatest(o_ms, 0)), -1)),
    (n.tenant_id, n.workflow_id, public.report_rollup_day(n.started_at), public.report_rollup_shard(n.id), 1, (n.status = 'completed')::int, (n.status = 'failed')::int, (n.status = 'failed' AND n.error IS NOT DISTINCT FROM 'Manually cancelled')::int, (n.status IN ('cancelled', 'canceled'))::int, (n.status = 'running')::int, (n.status = 'waiting_for_event')::int, (n.status = 'paused')::int, (n.status = 'pending')::int, (n.status = 'waiting')::int, ((n.status = 'completed' AND n.completed_at IS NOT NULL))::int, CASE WHEN (n.status = 'completed' AND n.completed_at IS NOT NULL) THEN n_ms ELSE 0 END, (coalesce(n.completed_at > n.started_at, false))::int, CASE WHEN coalesce(n.completed_at > n.started_at, false) THEN n_ms ELSE 0 END, n_nv, n_ev, public.report_rollup_hist_one(CASE WHEN (n.status = 'completed' AND n.completed_at IS NOT NULL) THEN public.report_rollup_ms_bucket(n_ms) END, 1), n.started_at, CASE WHEN n.status = 'completed' THEN n.completed_at END, 0, 0, 0, 0, 0::double precision, '{}'::integer[]),
    (n.tenant_id, n.workflow_id, CASE WHEN (n.status = 'completed' AND n.completed_at IS NOT NULL) THEN public.report_rollup_day(n.completed_at) END, public.report_rollup_shard(n.id), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0::double precision, 0, 0::double precision, 0, 0, '{}'::integer[], NULL::timestamptz, NULL::timestamptz, 1, (n.sla_due_at IS NOT NULL AND n.completed_at <= n.sla_due_at)::int, (n.sla_due_at IS NOT NULL AND n.completed_at > n.sla_due_at)::int, (n.sla_due_at IS NULL)::int, greatest(n_ms, 0), public.report_rollup_hist_one(public.report_rollup_ms_bucket(greatest(n_ms, 0)), 1)),
    (CASE WHEN v_same AND (d_nodes <> 0 OR d_edges <> 0) THEN n.tenant_id END, n.workflow_id, public.report_rollup_day(n.started_at), public.report_rollup_shard(n.id),
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0::double precision, 0, 0::double precision, d_nodes, d_edges, '{}'::integer[], NULL::timestamptz, NULL::timestamptz,
      0, 0, 0, 0, 0::double precision, '{}'::integer[])
  ) AS d(tenant_id, workflow_id, day, shard, runs, st_completed, st_failed, st_cancel_manual, st_cancelled, st_running, st_waiting_for_event, st_paused, st_pending, st_waiting, done_n, done_ms, timed_n, timed_ms, node_visits, edge_traversals, hist, last_started_at, last_completed_at, fin_n, fin_on_time, fin_late, fin_no_due, fin_ms, fin_hist)
  WHERE d.tenant_id IS NOT NULL AND d.day IS NOT NULL
  GROUP BY d.tenant_id, d.workflow_id, d.day, d.shard
  HAVING sum(d.runs) <> 0 OR sum(d.st_completed) <> 0 OR sum(d.st_failed) <> 0 OR sum(d.st_cancel_manual) <> 0
      OR sum(d.st_cancelled) <> 0 OR sum(d.st_running) <> 0 OR sum(d.st_waiting_for_event) <> 0 OR sum(d.st_paused) <> 0
      OR sum(d.st_pending) <> 0 OR sum(d.st_waiting) <> 0 OR sum(d.done_n) <> 0 OR sum(d.done_ms) <> 0 OR sum(d.timed_n) <> 0
      OR sum(d.timed_ms) <> 0 OR sum(d.node_visits) <> 0 OR sum(d.edge_traversals) <> 0 OR sum(d.fin_n) <> 0
      OR sum(d.fin_on_time) <> 0 OR sum(d.fin_late) <> 0 OR sum(d.fin_no_due) <> 0 OR sum(d.fin_ms) <> 0
  ON CONFLICT (tenant_id, day, workflow_id, shard) DO UPDATE SET
    runs = t.runs + EXCLUDED.runs,
    st_completed = t.st_completed + EXCLUDED.st_completed,
    st_failed = t.st_failed + EXCLUDED.st_failed,
    st_cancel_manual = t.st_cancel_manual + EXCLUDED.st_cancel_manual,
    st_cancelled = t.st_cancelled + EXCLUDED.st_cancelled,
    st_running = t.st_running + EXCLUDED.st_running,
    st_waiting_for_event = t.st_waiting_for_event + EXCLUDED.st_waiting_for_event,
    st_paused = t.st_paused + EXCLUDED.st_paused,
    st_pending = t.st_pending + EXCLUDED.st_pending,
    st_waiting = t.st_waiting + EXCLUDED.st_waiting,
    done_n = t.done_n + EXCLUDED.done_n,
    done_ms = t.done_ms + EXCLUDED.done_ms,
    timed_n = t.timed_n + EXCLUDED.timed_n,
    timed_ms = t.timed_ms + EXCLUDED.timed_ms,
    node_visits = t.node_visits + EXCLUDED.node_visits,
    edge_traversals = t.edge_traversals + EXCLUDED.edge_traversals,
    hist = CASE WHEN cardinality(EXCLUDED.hist) = 0 THEN t.hist ELSE public.report_rollup_hist_add(t.hist, EXCLUDED.hist) END,
    last_started_at = greatest(t.last_started_at, EXCLUDED.last_started_at),
    last_completed_at = greatest(t.last_completed_at, EXCLUDED.last_completed_at),
    fin_n = t.fin_n + EXCLUDED.fin_n,
    fin_on_time = t.fin_on_time + EXCLUDED.fin_on_time,
    fin_late = t.fin_late + EXCLUDED.fin_late,
    fin_no_due = t.fin_no_due + EXCLUDED.fin_no_due,
    fin_ms = t.fin_ms + EXCLUDED.fin_ms,
    fin_hist = CASE WHEN cardinality(EXCLUDED.fin_hist) = 0 THEN t.fin_hist ELSE public.report_rollup_hist_add(t.fin_hist, EXCLUDED.fin_hist) END,
    updated_at = now();

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_rollup_tasks_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_mode text := coalesce(current_setting('usertasks.report_rollups', true), '');
  o public.tasks;
  n public.tasks;
  v_key integer;
BEGIN
  IF v_mode = 'off' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.tenants x WHERE x.id = OLD.tenant_id) THEN RETURN NULL; END IF;
    o := OLD;
  ELSIF TG_OP = 'INSERT' THEN
    n := NEW;
  ELSE
    o := OLD; n := NEW;
  END IF;

  IF v_mode = 'defer' THEN
    INSERT INTO public.report_rollup_dirty (tenant_id, day_from, day_to, reason)
    SELECT DISTINCT u.t, u.d, u.d, 'deferred'
      FROM unnest(ARRAY[o.tenant_id, o.tenant_id, n.tenant_id, n.tenant_id],
                  ARRAY[public.report_rollup_day(o.created_at), public.report_rollup_day(o.completed_at),
                        public.report_rollup_day(n.created_at), public.report_rollup_day(n.completed_at)]) AS u(t, d)
     WHERE u.t IS NOT NULL AND u.d IS NOT NULL
    ON CONFLICT (tenant_id, day_from, day_to) DO NOTHING;
    RETURN NULL;
  END IF;

  FOR v_key IN
    SELECT DISTINCT x FROM unnest(ARRAY[
      public.report_rollup_lock_key(o.tenant_id, public.report_rollup_day(o.created_at)),
      public.report_rollup_lock_key(o.tenant_id, public.report_rollup_day(o.completed_at)),
      public.report_rollup_lock_key(n.tenant_id, public.report_rollup_day(n.created_at)),
      public.report_rollup_lock_key(n.tenant_id, public.report_rollup_day(n.completed_at))]) AS x
     WHERE x IS NOT NULL ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock_shared(1381127504, v_key);
  END LOOP;

  INSERT INTO public.report_rollup_tasks AS t (
    tenant_id, day, workflow_id, team_id, assignee_id,
    cr_total, cr_draft, cr_todo, cr_in_progress, cr_blocked, cr_completed, cr_cancelled,
    done_n, done_on_time, done_late, done_no_due, done_ms, done_hist)
  SELECT d.tenant_id, d.day, d.workflow_id, d.team_id, d.assignee_id,
    sum(d.cr_total), sum(d.cr_draft), sum(d.cr_todo), sum(d.cr_in_progress), sum(d.cr_blocked), sum(d.cr_completed), sum(d.cr_cancelled),
    sum(d.done_n), sum(d.done_on_time), sum(d.done_late), sum(d.done_no_due), sum(d.done_ms), public.report_rollup_hist_sum(d.done_hist)
  FROM (VALUES
    (CASE WHEN (o.id IS NOT NULL AND o.deleted_at IS NULL AND o.parent_task_id IS NULL) THEN o.tenant_id END, public.report_rollup_day(o.created_at), coalesce(o.workflow_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(o.assigned_team_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(o.assignee_id, '00000000-0000-0000-0000-000000000000'::uuid), -1, -(o.status = 'draft')::int, -(o.status = 'todo')::int, -(o.status = 'in_progress')::int, -(o.status = 'blocked')::int, -(o.status = 'completed')::int, -(o.status = 'cancelled')::int, 0, 0, 0, 0, 0::double precision, '{}'::integer[]),
    (CASE WHEN (o.id IS NOT NULL AND o.deleted_at IS NULL AND o.parent_task_id IS NULL) THEN o.tenant_id END, CASE WHEN (o.status = 'completed' AND o.completed_at IS NOT NULL) THEN public.report_rollup_day(o.completed_at) END, coalesce(o.workflow_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(o.assigned_team_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(o.assignee_id, '00000000-0000-0000-0000-000000000000'::uuid), 0, 0, 0, 0, 0, 0, 0, -1, -(o.due_date IS NOT NULL AND o.completed_at <= o.due_date)::int, -(o.due_date IS NOT NULL AND o.completed_at > o.due_date)::int, -(o.due_date IS NULL)::int, -greatest(extract(epoch FROM o.completed_at - o.created_at)::double precision * 1000, 0), public.report_rollup_hist_one(public.report_rollup_ms_bucket(greatest(extract(epoch FROM o.completed_at - o.created_at)::double precision * 1000, 0)), -1)),
    (CASE WHEN (n.id IS NOT NULL AND n.deleted_at IS NULL AND n.parent_task_id IS NULL) THEN n.tenant_id END, public.report_rollup_day(n.created_at), coalesce(n.workflow_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(n.assigned_team_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(n.assignee_id, '00000000-0000-0000-0000-000000000000'::uuid), 1, (n.status = 'draft')::int, (n.status = 'todo')::int, (n.status = 'in_progress')::int, (n.status = 'blocked')::int, (n.status = 'completed')::int, (n.status = 'cancelled')::int, 0, 0, 0, 0, 0::double precision, '{}'::integer[]),
    (CASE WHEN (n.id IS NOT NULL AND n.deleted_at IS NULL AND n.parent_task_id IS NULL) THEN n.tenant_id END, CASE WHEN (n.status = 'completed' AND n.completed_at IS NOT NULL) THEN public.report_rollup_day(n.completed_at) END, coalesce(n.workflow_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(n.assigned_team_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(n.assignee_id, '00000000-0000-0000-0000-000000000000'::uuid), 0, 0, 0, 0, 0, 0, 0, 1, (n.due_date IS NOT NULL AND n.completed_at <= n.due_date)::int, (n.due_date IS NOT NULL AND n.completed_at > n.due_date)::int, (n.due_date IS NULL)::int, greatest(extract(epoch FROM n.completed_at - n.created_at)::double precision * 1000, 0), public.report_rollup_hist_one(public.report_rollup_ms_bucket(greatest(extract(epoch FROM n.completed_at - n.created_at)::double precision * 1000, 0)), 1))
  ) AS d(tenant_id, day, workflow_id, team_id, assignee_id, cr_total, cr_draft, cr_todo, cr_in_progress, cr_blocked, cr_completed, cr_cancelled, done_n, done_on_time, done_late, done_no_due, done_ms, done_hist)
  WHERE d.tenant_id IS NOT NULL AND d.day IS NOT NULL
  GROUP BY d.tenant_id, d.day, d.workflow_id, d.team_id, d.assignee_id
  HAVING sum(d.cr_total) <> 0 OR sum(d.cr_draft) <> 0 OR sum(d.cr_todo) <> 0 OR sum(d.cr_in_progress) <> 0 OR sum(d.cr_blocked) <> 0
      OR sum(d.cr_completed) <> 0 OR sum(d.cr_cancelled) <> 0 OR sum(d.done_n) <> 0 OR sum(d.done_on_time) <> 0
      OR sum(d.done_late) <> 0 OR sum(d.done_no_due) <> 0 OR sum(d.done_ms) <> 0
  ON CONFLICT (tenant_id, day, workflow_id, team_id, assignee_id) DO UPDATE SET
    cr_total = t.cr_total + EXCLUDED.cr_total,
    cr_draft = t.cr_draft + EXCLUDED.cr_draft,
    cr_todo = t.cr_todo + EXCLUDED.cr_todo,
    cr_in_progress = t.cr_in_progress + EXCLUDED.cr_in_progress,
    cr_blocked = t.cr_blocked + EXCLUDED.cr_blocked,
    cr_completed = t.cr_completed + EXCLUDED.cr_completed,
    cr_cancelled = t.cr_cancelled + EXCLUDED.cr_cancelled,
    done_n = t.done_n + EXCLUDED.done_n,
    done_on_time = t.done_on_time + EXCLUDED.done_on_time,
    done_late = t.done_late + EXCLUDED.done_late,
    done_no_due = t.done_no_due + EXCLUDED.done_no_due,
    done_ms = t.done_ms + EXCLUDED.done_ms,
    done_hist = CASE WHEN cardinality(EXCLUDED.done_hist) = 0 THEN t.done_hist ELSE public.report_rollup_hist_add(t.done_hist, EXCLUDED.done_hist) END,
    updated_at = now();

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_rollup_submissions_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_mode text := coalesce(current_setting('usertasks.report_rollups', true), '');
  o public.form_submissions;
  n public.form_submissions;
BEGIN
  IF v_mode = 'off' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.forms f WHERE f.id = OLD.form_id) THEN RETURN NULL; END IF;
    o := OLD;
  ELSIF TG_OP = 'INSERT' THEN
    n := NEW;
  ELSE
    o := OLD; n := NEW;
    IF o.tenant_id = n.tenant_id AND o.form_id = n.form_id AND public.report_rollup_day(o.created_at) = public.report_rollup_day(n.created_at)
       AND public.report_rollup_shard(o.id) = public.report_rollup_shard(n.id) THEN
      RETURN NULL;
    END IF;
  END IF;

  IF v_mode = 'defer' THEN
    INSERT INTO public.report_rollup_dirty (tenant_id, day_from, day_to, reason)
    SELECT DISTINCT u.t, u.d, u.d, 'deferred'
      FROM unnest(ARRAY[o.tenant_id, n.tenant_id], ARRAY[public.report_rollup_day(o.created_at), public.report_rollup_day(n.created_at)]) AS u(t, d)
     WHERE u.t IS NOT NULL AND u.d IS NOT NULL
    ON CONFLICT (tenant_id, day_from, day_to) DO NOTHING;
    RETURN NULL;
  END IF;

  IF o.id IS NOT NULL THEN PERFORM pg_advisory_xact_lock_shared(1381127504, public.report_rollup_lock_key(o.tenant_id, public.report_rollup_day(o.created_at))); END IF;
  IF n.id IS NOT NULL THEN PERFORM pg_advisory_xact_lock_shared(1381127504, public.report_rollup_lock_key(n.tenant_id, public.report_rollup_day(n.created_at))); END IF;

  INSERT INTO public.report_rollup_submissions AS t (tenant_id, day, form_id, shard, submissions)
  SELECT q.tenant_id, q.day, q.form_id, q.shard, sum(q.v)
    FROM (
      SELECT o.tenant_id, public.report_rollup_day(o.created_at) AS day, o.form_id, public.report_rollup_shard(o.id) AS shard, -1 AS v WHERE o.id IS NOT NULL
      UNION ALL
      SELECT n.tenant_id, public.report_rollup_day(n.created_at), n.form_id, public.report_rollup_shard(n.id), 1 WHERE n.id IS NOT NULL
    ) q
   GROUP BY q.tenant_id, q.day, q.form_id, q.shard
  HAVING sum(q.v) <> 0
  ON CONFLICT (tenant_id, day, form_id, shard) DO UPDATE SET submissions = t.submissions + EXCLUDED.submissions, updated_at = now();

  RETURN NULL;
END;
$$;

-- A deleted workflow / form takes its rollup rows with it (its runs /
-- submissions go by cascade, which the row triggers skip).
CREATE OR REPLACE FUNCTION public.report_rollup_workflow_deleted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  DELETE FROM public.report_rollup_runs WHERE tenant_id = OLD.tenant_id AND workflow_id = OLD.id;
  DELETE FROM public.report_rollup_nodes WHERE tenant_id = OLD.tenant_id AND workflow_id = OLD.id;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_rollup_form_deleted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  DELETE FROM public.report_rollup_submissions WHERE tenant_id = OLD.tenant_id AND form_id = OLD.id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_rollup_runs ON public.workflow_runs;
CREATE TRIGGER trg_report_rollup_runs
  AFTER INSERT OR DELETE OR UPDATE OF tenant_id, workflow_id, status, error, started_at, completed_at, sla_due_at, execution_trace, node_results
  ON public.workflow_runs
  FOR EACH ROW EXECUTE FUNCTION public.report_rollup_runs_trg();

DROP TRIGGER IF EXISTS trg_report_rollup_tasks ON public.tasks;
CREATE TRIGGER trg_report_rollup_tasks
  AFTER INSERT OR DELETE OR UPDATE OF tenant_id, status, created_at, completed_at, due_date, deleted_at, parent_task_id, workflow_id, assigned_team_id, assignee_id
  ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.report_rollup_tasks_trg();

DROP TRIGGER IF EXISTS trg_report_rollup_submissions ON public.form_submissions;
CREATE TRIGGER trg_report_rollup_submissions
  AFTER INSERT OR DELETE OR UPDATE OF tenant_id, form_id, created_at
  ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.report_rollup_submissions_trg();

DROP TRIGGER IF EXISTS trg_report_rollup_workflow_deleted ON public.workflows;
CREATE TRIGGER trg_report_rollup_workflow_deleted
  AFTER DELETE ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.report_rollup_workflow_deleted();

DROP TRIGGER IF EXISTS trg_report_rollup_form_deleted ON public.forms;
CREATE TRIGGER trg_report_rollup_form_deleted
  AFTER DELETE ON public.forms
  FOR EACH ROW EXECUTE FUNCTION public.report_rollup_form_deleted();

/* ── Exact rebuilds ───────────────────────────────────────────────────── */

-- Rebuild days of one tenant from the raw rows, newest first: waits for the
-- first day's lock only, try-locks the rest and stops at the first that is
-- busy (so it never waits while holding a lock). Writes shard 0 only, which
-- also compacts the day. Returns {from, to, days} actually rebuilt.
CREATE OR REPLACE FUNCTION public.report_rollup_rebuild(p_tenant_id uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  d date := p_to;
  v_low date := NULL;
  t_from timestamptz;
  t_to timestamptz;
BEGIN
  IF p_tenant_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RETURN jsonb_build_object('from', NULL, 'to', NULL, 'days', 0);
  END IF;
  PERFORM pg_advisory_xact_lock(1381127504, public.report_rollup_lock_key(p_tenant_id, d));
  v_low := d;
  d := d - 1;
  WHILE d >= p_from LOOP
    EXIT WHEN NOT pg_try_advisory_xact_lock(1381127504, public.report_rollup_lock_key(p_tenant_id, d));
    v_low := d;
    d := d - 1;
  END LOOP;

  t_from := public.report_rollup_day_start(v_low);
  t_to := public.report_rollup_day_start(p_to + 1);

  DELETE FROM public.report_rollup_runs WHERE tenant_id = p_tenant_id AND day BETWEEN v_low AND p_to;
  DELETE FROM public.report_rollup_nodes WHERE tenant_id = p_tenant_id AND day BETWEEN v_low AND p_to;
  DELETE FROM public.report_rollup_tasks WHERE tenant_id = p_tenant_id AND day BETWEEN v_low AND p_to;
  DELETE FROM public.report_rollup_submissions WHERE tenant_id = p_tenant_id AND day BETWEEN v_low AND p_to;

  INSERT INTO public.report_rollup_runs (
    tenant_id, workflow_id, day, shard,
    runs, st_completed, st_failed, st_cancel_manual, st_cancelled, st_running, st_waiting_for_event, st_paused, st_pending, st_waiting,
    done_n, done_ms, timed_n, timed_ms, node_visits, edge_traversals, hist, last_started_at, last_completed_at,
    fin_n, fin_on_time, fin_late, fin_no_due, fin_ms, fin_hist)
  SELECT p_tenant_id, a.workflow_id, a.day, 0,
    a.runs, a.st_completed, a.st_failed, a.st_cancel_manual, a.st_cancelled, a.st_running, a.st_waiting_for_event, a.st_paused, a.st_pending, a.st_waiting,
    a.done_n, a.done_ms, a.timed_n, a.timed_ms, a.node_visits, a.edge_traversals, a.hist, a.last_started_at, a.last_completed_at,
    a.fin_n, a.fin_on_time, a.fin_late, a.fin_no_due, a.fin_ms, a.fin_hist
  FROM public.report_rollup_runs_agg(p_tenant_id, t_from, t_to, NULL) a;

  INSERT INTO public.report_rollup_nodes (tenant_id, workflow_id, day, node_id, shard, visits)
  SELECT p_tenant_id, a.workflow_id, a.day, a.node_id, 0, a.visits
    FROM public.report_rollup_nodes_agg(p_tenant_id, t_from, t_to, NULL) a;

  INSERT INTO public.report_rollup_tasks (
    tenant_id, day, workflow_id, team_id, assignee_id,
    cr_total, cr_draft, cr_todo, cr_in_progress, cr_blocked, cr_completed, cr_cancelled,
    done_n, done_on_time, done_late, done_no_due, done_ms, done_hist)
  SELECT p_tenant_id, a.day, a.workflow_id, a.team_id, a.assignee_id,
    a.cr_total, a.cr_draft, a.cr_todo, a.cr_in_progress, a.cr_blocked, a.cr_completed, a.cr_cancelled,
    a.done_n, a.done_on_time, a.done_late, a.done_no_due, a.done_ms, a.done_hist
  FROM public.report_rollup_tasks_agg(p_tenant_id, t_from, t_to) a;

  INSERT INTO public.report_rollup_submissions (tenant_id, day, form_id, shard, submissions)
  SELECT p_tenant_id, a.day, a.form_id, 0, a.submissions
    FROM public.report_rollup_submissions_agg(p_tenant_id, t_from, t_to, NULL) a;

  UPDATE public.report_rollup_state
     SET last_refresh_at = now(), days_rebuilt = days_rebuilt + (p_to - v_low + 1), updated_at = now()
   WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object('from', v_low, 'to', p_to, 'days', p_to - v_low + 1);
END;
$$;

-- Next backfill chunk: the given tenant, else one not finished (in progress
-- first). Starts at today (UTC) and walks back p_days at a time to the
-- tenant's oldest data. Resumable: the cursor is kept in report_rollup_state.
CREATE OR REPLACE FUNCTION public.report_rollup_backfill_next(p_tenant_id uuid DEFAULT NULL, p_days integer DEFAULT 14)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_tenant uuid := p_tenant_id;
  v_cand uuid;
  st public.report_rollup_state;
  v_days integer := least(greatest(coalesce(p_days, 14), 1), 366);
  v_from date;
  v_res jsonb;
  v_low date;
  v_today date := public.report_rollup_day(now());
BEGIN
  IF v_tenant IS NULL THEN
    -- Try-lock in a loop (not in the WHERE clause, which may lock every candidate).
    FOR v_cand IN
      SELECT t.id
        FROM public.tenants t
        LEFT JOIN public.report_rollup_state s ON s.tenant_id = t.id
       WHERE s.tenant_id IS NULL OR NOT s.backfill_done
       ORDER BY (s.tenant_id IS NOT NULL) DESC, t.created_at, t.id
       LIMIT 20
    LOOP
      IF pg_try_advisory_xact_lock(1381127505, hashtext(v_cand::text)) THEN v_tenant := v_cand; EXIT; END IF;
    END LOOP;
    IF v_tenant IS NULL THEN RETURN jsonb_build_object('idle', true); END IF;
  ELSIF NOT pg_try_advisory_xact_lock(1381127505, hashtext(v_tenant::text)) THEN
    RETURN jsonb_build_object('tenant_id', v_tenant, 'busy', true);
  END IF;

  SELECT * INTO st FROM public.report_rollup_state WHERE tenant_id = v_tenant;
  IF NOT FOUND THEN
    INSERT INTO public.report_rollup_state (tenant_id, backfill_cursor, oldest_day)
    VALUES (v_tenant, v_today, least(
      (SELECT public.report_rollup_day(min(r.started_at)) FROM public.workflow_runs r WHERE r.tenant_id = v_tenant),
      (SELECT public.report_rollup_day(min(t.created_at)) FROM public.tasks t WHERE t.tenant_id = v_tenant AND t.deleted_at IS NULL),
      (SELECT public.report_rollup_day(min(s.created_at)) FROM public.form_submissions s WHERE s.tenant_id = v_tenant),
      v_today))
    ON CONFLICT (tenant_id) DO NOTHING;
    SELECT * INTO st FROM public.report_rollup_state WHERE tenant_id = v_tenant;
  END IF;
  IF st.backfill_done THEN
    RETURN jsonb_build_object('tenant_id', v_tenant, 'done', true, 'covered_from', st.covered_from);
  END IF;

  v_from := greatest(st.backfill_cursor - v_days + 1, coalesce(st.oldest_day, st.backfill_cursor));
  v_res := public.report_rollup_rebuild(v_tenant, v_from, st.backfill_cursor);
  v_low := (v_res->>'from')::date;

  UPDATE public.report_rollup_state
     SET covered_from = v_low,
         backfill_cursor = v_low - 1,
         backfill_done = (v_low <= coalesce(oldest_day, v_low)),
         backfill_completed_at = CASE WHEN v_low <= coalesce(oldest_day, v_low) THEN now() END,
         updated_at = now()
   WHERE tenant_id = v_tenant
  RETURNING * INTO st;

  RETURN jsonb_build_object('tenant_id', v_tenant, 'rebuilt', v_res, 'covered_from', st.covered_from,
                            'oldest_day', st.oldest_day, 'done', st.backfill_done);
END;
$$;

-- Hourly safety net per tenant: rebuild today and yesterday (exact, and
-- compacts their shards). One tenant per call.
CREATE OR REPLACE FUNCTION public.report_rollup_reconcile_next(p_min_age_minutes integer DEFAULT 60, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  v_tenant uuid := p_tenant_id;
  v_cand uuid;
  v_today date := public.report_rollup_day(now());
  v_res jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    FOR v_cand IN
      SELECT s.tenant_id
        FROM public.report_rollup_state s
       WHERE (s.backfill_done OR s.covered_from IS NOT NULL)
         AND (s.last_reconciled_at IS NULL OR s.last_reconciled_at < now() - make_interval(mins => greatest(coalesce(p_min_age_minutes, 60), 0)))
       ORDER BY s.last_reconciled_at NULLS FIRST, s.tenant_id
       LIMIT 20
    LOOP
      IF pg_try_advisory_xact_lock(1381127505, hashtext(v_cand::text)) THEN v_tenant := v_cand; EXIT; END IF;
    END LOOP;
    IF v_tenant IS NULL THEN RETURN jsonb_build_object('idle', true); END IF;
  END IF;
  v_res := public.report_rollup_rebuild(v_tenant, v_today - 1, v_today);
  -- Only a complete pass counts (a busy yesterday is retried next time).
  UPDATE public.report_rollup_state SET last_reconciled_at = now(), updated_at = now()
   WHERE tenant_id = v_tenant AND (v_res->>'from')::date = v_today - 1;
  RETURN jsonb_build_object('tenant_id', v_tenant, 'rebuilt', v_res);
END;
$$;

-- Queue a rebuild: a day range of one tenant, or (no range) restart the
-- tenant's backfill from today. Returns the number of queued rows / tenants.
CREATE OR REPLACE FUNCTION public.report_rollup_request_rebuild(p_tenant_id uuid DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  n integer;
BEGIN
  IF p_from IS NULL AND p_to IS NULL THEN
    DELETE FROM public.report_rollup_state WHERE p_tenant_id IS NULL OR tenant_id = p_tenant_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
  END IF;
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'a tenant is required for a day range' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.report_rollup_dirty (tenant_id, day_from, day_to, reason)
  VALUES (p_tenant_id, coalesce(p_from, p_to), coalesce(p_to, p_from), 'requested')
  ON CONFLICT (tenant_id, day_from, day_to) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Rebuild the next queued dirty range, newest days first, up to p_days days.
CREATE OR REPLACE FUNCTION public.report_rollup_drain_next(p_days integer DEFAULT 31)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  q public.report_rollup_dirty;
  v_days integer := least(greatest(coalesce(p_days, 31), 1), 366);
  v_res jsonb;
  v_low date;
BEGIN
  SELECT * INTO q FROM public.report_rollup_dirty ORDER BY requested_at, id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('idle', true); END IF;
  v_res := public.report_rollup_rebuild(q.tenant_id, greatest(q.day_from, q.day_to - v_days + 1), q.day_to);
  v_low := (v_res->>'from')::date;
  IF v_low <= q.day_from THEN
    DELETE FROM public.report_rollup_dirty WHERE id = q.id;
  ELSE
    UPDATE public.report_rollup_dirty SET day_to = v_low - 1 WHERE id = q.id;
  END IF;
  RETURN jsonb_build_object('tenant_id', q.tenant_id, 'rebuilt', v_res);
END;
$$;

-- Anything for the job to do (cheap): dirty ranges, unfinished backfills, due reconciles.
CREATE OR REPLACE FUNCTION public.report_rollup_pending(p_min_age_minutes integer DEFAULT 60)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $$
  SELECT jsonb_build_object(
    'dirty', EXISTS (SELECT 1 FROM public.report_rollup_dirty),
    'backfill', EXISTS (SELECT 1 FROM public.tenants t LEFT JOIN public.report_rollup_state s ON s.tenant_id = t.id
                         WHERE s.tenant_id IS NULL OR NOT s.backfill_done),
    'reconcile', EXISTS (SELECT 1 FROM public.report_rollup_state s
                          WHERE (s.backfill_done OR s.covered_from IS NOT NULL)
                            AND (s.last_reconciled_at IS NULL OR s.last_reconciled_at < now() - make_interval(mins => greatest(coalesce(p_min_age_minutes, 60), 0)))))
$$;

-- Ops status (Settings → Infrastructure, usertasks-admin rollups status, doctor).
CREATE OR REPLACE FUNCTION public.report_rollup_status()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $$
  SELECT jsonb_build_object(
    'installed', true,
    'tenants', (SELECT count(*) FROM public.tenants),
    'backfilled', (SELECT count(*) FROM public.report_rollup_state WHERE backfill_done),
    'in_progress', (SELECT count(*) FROM public.report_rollup_state WHERE NOT backfill_done),
    'not_started', (SELECT count(*) FROM public.tenants t WHERE NOT EXISTS (SELECT 1 FROM public.report_rollup_state s WHERE s.tenant_id = t.id)),
    'dirty_ranges', (SELECT count(*) FROM public.report_rollup_dirty),
    'oldest_dirty_at', (SELECT min(requested_at) FROM public.report_rollup_dirty),
    'last_refresh_at', (SELECT max(last_refresh_at) FROM public.report_rollup_state),
    'oldest_reconciled_at', (SELECT min(coalesce(last_reconciled_at, '-infinity'::timestamptz)) FROM public.report_rollup_state
                              WHERE backfill_done OR covered_from IS NOT NULL),
    'newest_delta_at', (SELECT max(updated_at) FROM public.report_rollup_runs WHERE day >= public.report_rollup_day(now()) - 1),
    'rows', jsonb_build_object(
      'runs', (SELECT greatest(reltuples, 0)::bigint FROM pg_catalog.pg_class WHERE oid = 'public.report_rollup_runs'::regclass),
      'nodes', (SELECT greatest(reltuples, 0)::bigint FROM pg_catalog.pg_class WHERE oid = 'public.report_rollup_nodes'::regclass),
      'tasks', (SELECT greatest(reltuples, 0)::bigint FROM pg_catalog.pg_class WHERE oid = 'public.report_rollup_tasks'::regclass),
      'submissions', (SELECT greatest(reltuples, 0)::bigint FROM pg_catalog.pg_class WHERE oid = 'public.report_rollup_submissions'::regclass)),
    'tenants_detail', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'tenant_id', s.tenant_id, 'name', t.name, 'covered_from', s.covered_from, 'oldest_day', s.oldest_day,
               'done', s.backfill_done, 'days_rebuilt', s.days_rebuilt, 'started_at', s.backfill_started_at,
               'completed_at', s.backfill_completed_at, 'last_refresh_at', s.last_refresh_at,
               'last_reconciled_at', s.last_reconciled_at) ORDER BY s.backfill_done, t.name)
        FROM (SELECT * FROM public.report_rollup_state ORDER BY backfill_done, updated_at DESC LIMIT 50) s
        JOIN public.tenants t ON t.id = s.tenant_id), '[]'::jsonb)
  )
$$;

/* ── Reads ────────────────────────────────────────────────────────────── */

-- Which days of [since, until) come from the rollups ([d_from, d_to)) and
-- which partial edges are aggregated live. ok = false (with reason) when
-- the tenant is not backfilled far enough back for that range.
CREATE OR REPLACE FUNCTION public.report_rollup_window(
  p_tenant_id uuid, p_since timestamptz, p_until timestamptz,
  OUT ok boolean, OUT reason text, OUT d_from date, OUT d_to date,
  OUT live1_from timestamptz, OUT live1_to timestamptz, OUT live2_from timestamptz, OUT live2_to timestamptz)
-- DEFINER: reads only report_rollup_state (coverage), which clients cannot select.
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  st record;
  s timestamptz := coalesce(p_since, '-infinity'::timestamptz);
  v_open boolean := p_until IS NULL OR p_until >= now() - interval '1 minute';
  u timestamptz := CASE WHEN v_open THEN 'infinity'::timestamptz ELSE p_until END;
  v_cov date;
BEGIN
  ok := false;
  -- DEFINER: a signed-in caller (role authenticated) only learns about workspaces they belong to.
  IF current_setting('role', true) = 'authenticated'
     AND NOT (p_tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])) THEN
    reason := 'forbidden';
    RETURN;
  END IF;
  SELECT s2.covered_from, s2.backfill_done INTO st FROM public.report_rollup_state s2 WHERE s2.tenant_id = p_tenant_id;
  IF NOT FOUND OR (st.covered_from IS NULL AND NOT st.backfill_done) THEN
    reason := 'not_backfilled';
    RETURN;
  END IF;
  v_cov := CASE WHEN st.backfill_done THEN '-infinity'::date ELSE st.covered_from END;
  IF s = '-infinity'::timestamptz THEN
    d_from := '-infinity'::date;
  ELSE
    d_from := public.report_rollup_day(s) + CASE WHEN s = public.report_rollup_day_start(public.report_rollup_day(s)) THEN 0 ELSE 1 END;
  END IF;
  d_to := CASE WHEN v_open THEN public.report_rollup_day(now()) + 1 ELSE public.report_rollup_day(u) END;
  IF d_from >= d_to THEN
    -- No whole day inside: the window is aggregated live (less than two days of rows).
    d_from := NULL; d_to := NULL;
    IF s = '-infinity'::timestamptz THEN reason := 'not_covered'; RETURN; END IF;
    live1_from := s; live1_to := u;
    ok := true;
    RETURN;
  END IF;
  IF d_from < v_cov THEN
    reason := 'not_covered';
    RETURN;
  END IF;
  IF s < public.report_rollup_day_start(d_from) THEN live1_from := s; live1_to := public.report_rollup_day_start(d_from); END IF;
  IF NOT v_open AND u > public.report_rollup_day_start(d_to) THEN live2_from := public.report_rollup_day_start(d_to); live2_to := u; END IF;
  ok := true;
END;
$$;

-- Runs per workflow × UTC day over [since, until): started-side and
-- completed-side counters (no histograms). Rows are arrays in `cols` order.
-- p_by_day false: one row per workflow (day null) — totals, far less to send.
CREATE OR REPLACE FUNCTION public.report_rollup_run_days(p_tenant_id uuid, p_since timestamptz, p_until timestamptz DEFAULT NULL, p_workflow_ids uuid[] DEFAULT NULL, p_by_day boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO ''
AS $$
DECLARE
  w record;
  v_rows jsonb;
BEGIN
  SELECT * INTO w FROM public.report_rollup_window(p_tenant_id, p_since, p_until);
  IF NOT w.ok THEN RETURN jsonb_build_object('ok', false, 'reason', w.reason); END IF;
  WITH parts AS (
    SELECT r.workflow_id, r.day, r.runs, r.st_completed, r.st_failed, r.st_cancel_manual, r.st_cancelled, r.st_running,
           r.st_waiting_for_event, r.st_paused, r.st_pending, r.st_waiting, r.done_n, r.done_ms, r.timed_n, r.timed_ms,
           r.node_visits, r.edge_traversals, r.last_started_at, r.last_completed_at,
           r.fin_n, r.fin_on_time, r.fin_late, r.fin_no_due, r.fin_ms
      FROM public.report_rollup_runs r
     WHERE w.d_from IS NOT NULL AND r.tenant_id = p_tenant_id AND r.day >= w.d_from AND r.day < w.d_to
       AND (p_workflow_ids IS NULL OR r.workflow_id = ANY (p_workflow_ids))
    UNION ALL
    SELECT a.workflow_id, a.day, a.runs, a.st_completed, a.st_failed, a.st_cancel_manual, a.st_cancelled, a.st_running,
           a.st_waiting_for_event, a.st_paused, a.st_pending, a.st_waiting, a.done_n, a.done_ms, a.timed_n, a.timed_ms,
           a.node_visits, a.edge_traversals, a.last_started_at, a.last_completed_at,
           a.fin_n, a.fin_on_time, a.fin_late, a.fin_no_due, a.fin_ms
      FROM public.report_rollup_runs_agg(p_tenant_id, w.live1_from, w.live1_to, p_workflow_ids) a
     WHERE w.live1_from IS NOT NULL
    UNION ALL
    SELECT a.workflow_id, a.day, a.runs, a.st_completed, a.st_failed, a.st_cancel_manual, a.st_cancelled, a.st_running,
           a.st_waiting_for_event, a.st_paused, a.st_pending, a.st_waiting, a.done_n, a.done_ms, a.timed_n, a.timed_ms,
           a.node_visits, a.edge_traversals, a.last_started_at, a.last_completed_at,
           a.fin_n, a.fin_on_time, a.fin_late, a.fin_no_due, a.fin_ms
      FROM public.report_rollup_runs_agg(p_tenant_id, w.live2_from, w.live2_to, p_workflow_ids) a
     WHERE w.live2_from IS NOT NULL
  ), g AS (
    SELECT p.workflow_id, CASE WHEN p_by_day THEN p.day END AS day,
      sum(p.runs) AS runs, sum(p.st_completed) AS st_completed, sum(p.st_failed) AS st_failed, sum(p.st_cancel_manual) AS st_cancel_manual,
      sum(p.st_cancelled) AS st_cancelled, sum(p.st_running) AS st_running, sum(p.st_waiting_for_event) AS st_waiting_for_event,
      sum(p.st_paused) AS st_paused, sum(p.st_pending) AS st_pending, sum(p.st_waiting) AS st_waiting,
      sum(p.done_n) AS done_n, sum(p.done_ms) AS done_ms, sum(p.timed_n) AS timed_n, sum(p.timed_ms) AS timed_ms,
      sum(p.node_visits) AS node_visits, sum(p.edge_traversals) AS edge_traversals,
      max(p.last_started_at) AS last_started_at, max(p.last_completed_at) AS last_completed_at,
      sum(p.fin_n) AS fin_n, sum(p.fin_on_time) AS fin_on_time, sum(p.fin_late) AS fin_late, sum(p.fin_no_due) AS fin_no_due, sum(p.fin_ms) AS fin_ms
    FROM parts p
    GROUP BY p.workflow_id, CASE WHEN p_by_day THEN p.day END
  )
  SELECT coalesce(jsonb_agg(jsonb_build_array(
      g.workflow_id, to_char(g.day, 'YYYY-MM-DD'), g.runs, g.st_completed, g.st_failed, g.st_cancel_manual, g.st_cancelled, g.st_running,
      g.st_waiting_for_event, g.st_paused, g.st_pending, g.st_waiting, g.done_n, g.done_ms, g.timed_n, g.timed_ms,
      g.node_visits, g.edge_traversals, g.last_started_at, g.last_completed_at,
      g.fin_n, g.fin_on_time, g.fin_late, g.fin_no_due, g.fin_ms) ORDER BY g.day, g.workflow_id), '[]'::jsonb)
    INTO v_rows
    FROM g
   WHERE g.runs <> 0 OR g.fin_n <> 0;
  RETURN jsonb_build_object('ok', true,
    'cols', jsonb_build_array('workflow_id', 'day', 'runs', 'st_completed', 'st_failed', 'st_cancel_manual', 'st_cancelled', 'st_running',
      'st_waiting_for_event', 'st_paused', 'st_pending', 'st_waiting', 'done_n', 'done_ms', 'timed_n', 'timed_ms',
      'node_visits', 'edge_traversals', 'last_started_at', 'last_completed_at', 'fin_n', 'fin_on_time', 'fin_late', 'fin_no_due', 'fin_ms'),
    'rows', v_rows,
    'live_edges', (w.live1_from IS NOT NULL)::int + (w.live2_from IS NOT NULL)::int);
END;
$$;

-- Duration histograms over [since, until): side 'started' (completed runs
-- by start day: run duration) or 'completed' (by completion day: cycle
-- time), grouped by 'workflow', 'day' or 'all'. Rows: [key, count, hist].
CREATE OR REPLACE FUNCTION public.report_rollup_run_hists(p_tenant_id uuid, p_since timestamptz, p_until timestamptz DEFAULT NULL, p_workflow_ids uuid[] DEFAULT NULL,
                                                          p_side text DEFAULT 'started', p_group text DEFAULT 'workflow')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO ''
AS $$
DECLARE
  w record;
  v_rows jsonb;
  v_fin boolean := p_side = 'completed';
BEGIN
  SELECT * INTO w FROM public.report_rollup_window(p_tenant_id, p_since, p_until);
  IF NOT w.ok THEN RETURN jsonb_build_object('ok', false, 'reason', w.reason); END IF;
  WITH parts AS (
    SELECT r.workflow_id, r.day, CASE WHEN v_fin THEN r.fin_hist ELSE r.hist END AS h
      FROM public.report_rollup_runs r
     WHERE w.d_from IS NOT NULL AND r.tenant_id = p_tenant_id AND r.day >= w.d_from AND r.day < w.d_to
       AND (p_workflow_ids IS NULL OR r.workflow_id = ANY (p_workflow_ids))
    UNION ALL
    SELECT a.workflow_id, a.day, CASE WHEN v_fin THEN a.fin_hist ELSE a.hist END
      FROM public.report_rollup_runs_agg(p_tenant_id, w.live1_from, w.live1_to, p_workflow_ids) a WHERE w.live1_from IS NOT NULL
    UNION ALL
    SELECT a.workflow_id, a.day, CASE WHEN v_fin THEN a.fin_hist ELSE a.hist END
      FROM public.report_rollup_runs_agg(p_tenant_id, w.live2_from, w.live2_to, p_workflow_ids) a WHERE w.live2_from IS NOT NULL
  ), g AS (
    SELECT CASE p_group WHEN 'workflow' THEN p.workflow_id::text WHEN 'day' THEN to_char(p.day, 'YYYY-MM-DD') ELSE NULL END AS k,
           public.report_rollup_hist_sum(p.h) AS h
      FROM parts p
     WHERE cardinality(p.h) > 0
     GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_array(g.k, (SELECT coalesce(sum(x), 0) FROM unnest(g.h) x), g.h) ORDER BY g.k), '[]'::jsonb)
    INTO v_rows FROM g;
  RETURN jsonb_build_object('ok', true, 'rows', v_rows);
END;
$$;

-- Node visits per workflow × node of the runs started in [since, until)
-- (since NULL: all time). Rows: [workflow_id, node_id, visits].
CREATE OR REPLACE FUNCTION public.report_rollup_node_visits(p_tenant_id uuid, p_workflow_ids uuid[], p_since timestamptz DEFAULT NULL, p_until timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO ''
AS $$
DECLARE
  w record;
  v_rows jsonb;
BEGIN
  SELECT * INTO w FROM public.report_rollup_window(p_tenant_id, p_since, p_until);
  IF NOT w.ok THEN RETURN jsonb_build_object('ok', false, 'reason', w.reason); END IF;
  WITH parts AS (
    SELECT r.workflow_id, r.node_id, r.visits
      FROM public.report_rollup_nodes r
     WHERE w.d_from IS NOT NULL AND r.tenant_id = p_tenant_id AND r.workflow_id = ANY (p_workflow_ids)
       AND r.day >= w.d_from AND r.day < w.d_to
    UNION ALL
    SELECT a.workflow_id, a.node_id, a.visits FROM public.report_rollup_nodes_agg(p_tenant_id, w.live1_from, w.live1_to, p_workflow_ids) a WHERE w.live1_from IS NOT NULL
    UNION ALL
    SELECT a.workflow_id, a.node_id, a.visits FROM public.report_rollup_nodes_agg(p_tenant_id, w.live2_from, w.live2_to, p_workflow_ids) a WHERE w.live2_from IS NOT NULL
  ), g AS (
    SELECT p.workflow_id, p.node_id, sum(p.visits) AS visits FROM parts p GROUP BY 1, 2
  )
  SELECT coalesce(jsonb_agg(jsonb_build_array(g.workflow_id, g.node_id, g.visits) ORDER BY g.workflow_id, g.node_id), '[]'::jsonb)
    INTO v_rows FROM g WHERE g.visits <> 0;
  RETURN jsonb_build_object('ok', true, 'rows', v_rows);
END;
$$;

-- Tasks per UTC day over [since, until), optionally by workflow / assignee.
-- Scope: p_scope_user NULL = every task (tasks.view_all); else tasks
-- assigned to p_scope_user or queued for one of p_scope_teams. Filters:
-- workflow, assignee, teams (as the widget queries). Rows in `cols` order.
CREATE OR REPLACE FUNCTION public.report_rollup_task_days(
  p_tenant_id uuid, p_since timestamptz, p_until timestamptz DEFAULT NULL,
  p_workflow_id uuid DEFAULT NULL, p_assignee_id uuid DEFAULT NULL, p_team_ids uuid[] DEFAULT NULL,
  p_scope_user uuid DEFAULT NULL, p_scope_teams uuid[] DEFAULT NULL,
  p_by_workflow boolean DEFAULT false, p_by_assignee boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO ''
AS $$
DECLARE
  w record;
  v_rows jsonb;
BEGIN
  SELECT * INTO w FROM public.report_rollup_window(p_tenant_id, p_since, p_until);
  IF NOT w.ok THEN RETURN jsonb_build_object('ok', false, 'reason', w.reason); END IF;
  WITH parts AS (
    SELECT r.day, r.workflow_id, r.team_id, r.assignee_id, r.cr_total, r.cr_draft, r.cr_todo, r.cr_in_progress, r.cr_blocked,
           r.cr_completed, r.cr_cancelled, r.done_n, r.done_on_time, r.done_late, r.done_no_due, r.done_ms
      FROM public.report_rollup_tasks r
     WHERE w.d_from IS NOT NULL AND r.tenant_id = p_tenant_id AND r.day >= w.d_from AND r.day < w.d_to
    UNION ALL
    SELECT a.day, a.workflow_id, a.team_id, a.assignee_id, a.cr_total, a.cr_draft, a.cr_todo, a.cr_in_progress, a.cr_blocked,
           a.cr_completed, a.cr_cancelled, a.done_n, a.done_on_time, a.done_late, a.done_no_due, a.done_ms
      FROM public.report_rollup_tasks_agg(p_tenant_id, w.live1_from, w.live1_to) a WHERE w.live1_from IS NOT NULL
    UNION ALL
    SELECT a.day, a.workflow_id, a.team_id, a.assignee_id, a.cr_total, a.cr_draft, a.cr_todo, a.cr_in_progress, a.cr_blocked,
           a.cr_completed, a.cr_cancelled, a.done_n, a.done_on_time, a.done_late, a.done_no_due, a.done_ms
      FROM public.report_rollup_tasks_agg(p_tenant_id, w.live2_from, w.live2_to) a WHERE w.live2_from IS NOT NULL
  ), f AS (
    SELECT * FROM parts p
     WHERE (p_scope_user IS NULL OR p.assignee_id = p_scope_user OR p.team_id = ANY (coalesce(p_scope_teams, '{}')))
       AND (p_workflow_id IS NULL OR p.workflow_id = p_workflow_id)
       AND (p_assignee_id IS NULL OR p.assignee_id = p_assignee_id)
       AND (p_team_ids IS NULL OR p.team_id = ANY (p_team_ids))
  ), g AS (
    SELECT f.day,
      CASE WHEN p_by_workflow THEN f.workflow_id END AS workflow_id,
      CASE WHEN p_by_assignee THEN f.assignee_id END AS assignee_id,
      sum(f.cr_total) AS cr_total, sum(f.cr_draft) AS cr_draft, sum(f.cr_todo) AS cr_todo, sum(f.cr_in_progress) AS cr_in_progress,
      sum(f.cr_blocked) AS cr_blocked, sum(f.cr_completed) AS cr_completed, sum(f.cr_cancelled) AS cr_cancelled,
      sum(f.done_n) AS done_n, sum(f.done_on_time) AS done_on_time, sum(f.done_late) AS done_late, sum(f.done_no_due) AS done_no_due,
      sum(f.done_ms) AS done_ms
    FROM f GROUP BY 1, 2, 3
  )
  SELECT coalesce(jsonb_agg(jsonb_build_array(
      to_char(g.day, 'YYYY-MM-DD'), g.workflow_id, g.assignee_id, g.cr_total, g.cr_draft, g.cr_todo, g.cr_in_progress, g.cr_blocked,
      g.cr_completed, g.cr_cancelled, g.done_n, g.done_on_time, g.done_late, g.done_no_due, g.done_ms) ORDER BY g.day), '[]'::jsonb)
    INTO v_rows FROM g WHERE g.cr_total <> 0 OR g.done_n <> 0;
  RETURN jsonb_build_object('ok', true,
    'cols', jsonb_build_array('day', 'workflow_id', 'assignee_id', 'cr_total', 'cr_draft', 'cr_todo', 'cr_in_progress', 'cr_blocked',
      'cr_completed', 'cr_cancelled', 'done_n', 'done_on_time', 'done_late', 'done_no_due', 'done_ms'),
    'rows', v_rows);
END;
$$;

-- Time-to-complete histograms of tasks completed in [since, until), same
-- scope / filters as report_rollup_task_days, grouped by 'day' or 'all'.
CREATE OR REPLACE FUNCTION public.report_rollup_task_hists(
  p_tenant_id uuid, p_since timestamptz, p_until timestamptz DEFAULT NULL,
  p_workflow_id uuid DEFAULT NULL, p_assignee_id uuid DEFAULT NULL, p_team_ids uuid[] DEFAULT NULL,
  p_scope_user uuid DEFAULT NULL, p_scope_teams uuid[] DEFAULT NULL, p_group text DEFAULT 'day')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO ''
AS $$
DECLARE
  w record;
  v_rows jsonb;
BEGIN
  SELECT * INTO w FROM public.report_rollup_window(p_tenant_id, p_since, p_until);
  IF NOT w.ok THEN RETURN jsonb_build_object('ok', false, 'reason', w.reason); END IF;
  WITH parts AS (
    SELECT r.day, r.workflow_id, r.team_id, r.assignee_id, r.done_hist AS h
      FROM public.report_rollup_tasks r
     WHERE w.d_from IS NOT NULL AND r.tenant_id = p_tenant_id AND r.day >= w.d_from AND r.day < w.d_to AND cardinality(r.done_hist) > 0
    UNION ALL
    SELECT a.day, a.workflow_id, a.team_id, a.assignee_id, a.done_hist FROM public.report_rollup_tasks_agg(p_tenant_id, w.live1_from, w.live1_to) a WHERE w.live1_from IS NOT NULL
    UNION ALL
    SELECT a.day, a.workflow_id, a.team_id, a.assignee_id, a.done_hist FROM public.report_rollup_tasks_agg(p_tenant_id, w.live2_from, w.live2_to) a WHERE w.live2_from IS NOT NULL
  ), g AS (
    SELECT CASE WHEN p_group = 'day' THEN to_char(p.day, 'YYYY-MM-DD') END AS k, public.report_rollup_hist_sum(p.h) AS h
      FROM parts p
     WHERE cardinality(p.h) > 0
       AND (p_scope_user IS NULL OR p.assignee_id = p_scope_user OR p.team_id = ANY (coalesce(p_scope_teams, '{}')))
       AND (p_workflow_id IS NULL OR p.workflow_id = p_workflow_id)
       AND (p_assignee_id IS NULL OR p.assignee_id = p_assignee_id)
       AND (p_team_ids IS NULL OR p.team_id = ANY (p_team_ids))
     GROUP BY 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_array(g.k, (SELECT coalesce(sum(x), 0) FROM unnest(g.h) x), g.h) ORDER BY g.k), '[]'::jsonb)
    INTO v_rows FROM g;
  RETURN jsonb_build_object('ok', true, 'rows', v_rows);
END;
$$;

-- Submissions per form × UTC day over [since, until). Rows: [form_id, day, n].
CREATE OR REPLACE FUNCTION public.report_rollup_submission_days(p_tenant_id uuid, p_since timestamptz, p_until timestamptz DEFAULT NULL, p_form_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO ''
AS $$
DECLARE
  w record;
  v_rows jsonb;
BEGIN
  SELECT * INTO w FROM public.report_rollup_window(p_tenant_id, p_since, p_until);
  IF NOT w.ok THEN RETURN jsonb_build_object('ok', false, 'reason', w.reason); END IF;
  WITH parts AS (
    SELECT r.form_id, r.day, r.submissions AS n
      FROM public.report_rollup_submissions r
     WHERE w.d_from IS NOT NULL AND r.tenant_id = p_tenant_id AND r.day >= w.d_from AND r.day < w.d_to
       AND (p_form_ids IS NULL OR r.form_id = ANY (p_form_ids))
    UNION ALL
    SELECT a.form_id, a.day, a.submissions FROM public.report_rollup_submissions_agg(p_tenant_id, w.live1_from, w.live1_to, p_form_ids) a WHERE w.live1_from IS NOT NULL
    UNION ALL
    SELECT a.form_id, a.day, a.submissions FROM public.report_rollup_submissions_agg(p_tenant_id, w.live2_from, w.live2_to, p_form_ids) a WHERE w.live2_from IS NOT NULL
  ), g AS (
    SELECT p.form_id, p.day, sum(p.n) AS n FROM parts p GROUP BY 1, 2
  )
  SELECT coalesce(jsonb_agg(jsonb_build_array(g.form_id, to_char(g.day, 'YYYY-MM-DD'), g.n) ORDER BY g.day, g.form_id), '[]'::jsonb)
    INTO v_rows FROM g WHERE g.n <> 0;
  RETURN jsonb_build_object('ok', true, 'rows', v_rows);
END;
$$;

-- Runs per workflow right now, whatever the period (workflow_run_stats'
-- running / waiting / queued): rows [workflow_id, running, waiting, queued].
CREATE OR REPLACE FUNCTION public.report_rollup_run_now(p_tenant_id uuid, p_workflow_ids uuid[])
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $$
  WITH live AS (
    SELECT r.workflow_id,
      count(*) FILTER (WHERE r.status = 'running') AS running,
      count(*) FILTER (WHERE r.status IN ('paused', 'waiting_for_event', 'waiting')) AS waiting
    FROM public.workflow_runs r
    WHERE r.tenant_id = p_tenant_id AND r.workflow_id = ANY (p_workflow_ids)
      AND r.status IN ('running', 'paused', 'waiting_for_event', 'waiting')
    GROUP BY r.workflow_id
  ), queued AS (
    SELECT q.workflow_id, count(*) AS queued
    FROM public.workflow_queue q
    WHERE q.tenant_id = p_tenant_id AND q.workflow_id = ANY (p_workflow_ids)
      AND q.status IN ('pending', 'processing')
      AND q.trigger_type NOT IN ('task_resume', 'delay_resume')
      AND (q.result->>'run_id') IS NULL
    GROUP BY q.workflow_id
  )
  SELECT jsonb_build_object('ok', true, 'rows', coalesce(jsonb_agg(jsonb_build_array(
           coalesce(l.workflow_id, q.workflow_id), coalesce(l.running, 0), coalesce(l.waiting, 0), coalesce(q.queued, 0))), '[]'::jsonb))
    FROM live l FULL JOIN queued q ON q.workflow_id = l.workflow_id
$$;

-- Newest submission of each form, at any time: rows [form_id, last_at].
CREATE OR REPLACE FUNCTION public.report_rollup_form_last(p_tenant_id uuid, p_form_ids uuid[])
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $$
  SELECT jsonb_build_object('ok', true, 'rows', coalesce(jsonb_agg(jsonb_build_array(f.id, x.last_at)), '[]'::jsonb))
    FROM (SELECT DISTINCT unnest(coalesce(p_form_ids, '{}'::uuid[])) AS id) f
    CROSS JOIN LATERAL (SELECT max(s.created_at) AS last_at FROM public.form_submissions s WHERE s.tenant_id = p_tenant_id AND s.form_id = f.id) x
   WHERE x.last_at IS NOT NULL
$$;

-- One workspace's coverage and queue (Settings → Query; "Auto" reads the
-- rollups only when nothing is queued for the workspace). Members of the
-- workspace and the service role.
CREATE OR REPLACE FUNCTION public.report_rollup_tenant_freshness(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT jsonb_build_object(
    'installed', true,
    'covered_from', s.covered_from,
    'oldest_day', s.oldest_day,
    'done', coalesce(s.backfill_done, false),
    'started', s.tenant_id IS NOT NULL,
    'days_rebuilt', coalesce(s.days_rebuilt, 0),
    'last_refresh_at', s.last_refresh_at,
    'last_reconciled_at', s.last_reconciled_at,
    'dirty_ranges', (SELECT count(*) FROM public.report_rollup_dirty d WHERE d.tenant_id = p_tenant_id),
    'newest_delta_at', (SELECT max(r.updated_at) FROM public.report_rollup_runs r WHERE r.tenant_id = p_tenant_id AND r.day >= public.report_rollup_day(now()) - 1))
  FROM (SELECT p_tenant_id AS id) t
  LEFT JOIN public.report_rollup_state s ON s.tenant_id = t.id
  -- DEFINER: a signed-in caller (role authenticated) only gets workspaces they belong to; service role any.
  WHERE current_setting('role', true) IS DISTINCT FROM 'authenticated'
     OR p_tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
$$;

/* ── Access ───────────────────────────────────────────────────────────── */

ALTER TABLE public.report_rollup_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_rollup_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_rollup_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_rollup_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_rollup_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_rollup_dirty ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_rollup_runs_select ON public.report_rollup_runs;
CREATE POLICY report_rollup_runs_select ON public.report_rollup_runs FOR SELECT TO authenticated
  USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['workflows.view_runs']))::uuid[]));

DROP POLICY IF EXISTS report_rollup_nodes_select ON public.report_rollup_nodes;
CREATE POLICY report_rollup_nodes_select ON public.report_rollup_nodes FOR SELECT TO authenticated
  USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['workflows.view_runs']))::uuid[]));

DROP POLICY IF EXISTS report_rollup_submissions_select ON public.report_rollup_submissions;
CREATE POLICY report_rollup_submissions_select ON public.report_rollup_submissions FOR SELECT TO authenticated
  USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['forms.edit']))::uuid[]));

DROP POLICY IF EXISTS report_rollup_tasks_select ON public.report_rollup_tasks;
CREATE POLICY report_rollup_tasks_select ON public.report_rollup_tasks FOR SELECT TO authenticated
  USING (
    tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['tasks.view_all']))::uuid[])
    OR (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
        AND (assignee_id = (SELECT auth.uid())
             OR team_id IN (SELECT ut.team_id FROM public.user_teams ut WHERE ut.user_id = (SELECT auth.uid()))))
  );

REVOKE ALL ON public.report_rollup_runs, public.report_rollup_nodes, public.report_rollup_tasks, public.report_rollup_submissions FROM anon, authenticated;
REVOKE ALL ON public.report_rollup_state, public.report_rollup_dirty FROM anon, authenticated;
GRANT SELECT ON public.report_rollup_runs, public.report_rollup_nodes, public.report_rollup_tasks, public.report_rollup_submissions TO authenticated;
GRANT ALL ON public.report_rollup_runs, public.report_rollup_nodes, public.report_rollup_tasks, public.report_rollup_submissions,
             public.report_rollup_state, public.report_rollup_dirty TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.report_rollup_dirty_id_seq TO service_role;

DO $grants$
DECLARE
  fn text;
BEGIN
  -- Internal helpers, triggers and maintenance: service role only.
  FOREACH fn IN ARRAY ARRAY[
    'public.report_rollup_runs_trg()', 'public.report_rollup_tasks_trg()', 'public.report_rollup_submissions_trg()',
    'public.report_rollup_workflow_deleted()', 'public.report_rollup_form_deleted()',
    'public.report_rollup_rebuild(uuid, date, date)', 'public.report_rollup_backfill_next(uuid, integer)',
    'public.report_rollup_reconcile_next(integer, uuid)', 'public.report_rollup_request_rebuild(uuid, date, date)',
    'public.report_rollup_drain_next(integer)', 'public.report_rollup_pending(integer)', 'public.report_rollup_status()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
  -- Reads and their building blocks (SECURITY INVOKER: RLS applies).
  FOREACH fn IN ARRAY ARRAY[
    'public.report_rollup_day(timestamptz)', 'public.report_rollup_day_start(date)', 'public.report_rollup_shard(uuid)',
    'public.report_rollup_ms_bucket(double precision)', 'public.report_rollup_hist_one(integer, integer)',
    'public.report_rollup_hist_add(integer[], integer[])', 'public.report_rollup_hist_inc(integer[], integer)',
    'public.report_rollup_hist_agg(integer)', 'public.report_rollup_hist_sum(integer[])',
    'public.report_rollup_lock_key(uuid, date)', 'public.report_rollup_run_nodes(jsonb, jsonb)',
    'public.report_rollup_runs_agg(uuid, timestamptz, timestamptz, uuid[])', 'public.report_rollup_nodes_agg(uuid, timestamptz, timestamptz, uuid[])',
    'public.report_rollup_tasks_agg(uuid, timestamptz, timestamptz)', 'public.report_rollup_submissions_agg(uuid, timestamptz, timestamptz, uuid[])',
    'public.report_rollup_window(uuid, timestamptz, timestamptz)',
    'public.report_rollup_run_days(uuid, timestamptz, timestamptz, uuid[], boolean)',
    'public.report_rollup_run_hists(uuid, timestamptz, timestamptz, uuid[], text, text)',
    'public.report_rollup_node_visits(uuid, uuid[], timestamptz, timestamptz)',
    'public.report_rollup_task_days(uuid, timestamptz, timestamptz, uuid, uuid, uuid[], uuid, uuid[], boolean, boolean)',
    'public.report_rollup_task_hists(uuid, timestamptz, timestamptz, uuid, uuid, uuid[], uuid, uuid[], text)',
    'public.report_rollup_submission_days(uuid, timestamptz, timestamptz, uuid[])',
    'public.report_rollup_run_now(uuid, uuid[])', 'public.report_rollup_form_last(uuid, uuid[])',
    'public.report_rollup_tenant_freshness(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $grants$;

NOTIFY pgrst, 'reload schema';
