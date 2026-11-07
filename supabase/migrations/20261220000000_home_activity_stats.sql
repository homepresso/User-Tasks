-- ============================================================================
-- 20261220000000_home_activity_stats.sql
--
-- Home → My activity: the charts of the signed-in person's own work over a
-- period (7, 30 or 90 days), computed here so the browser never sees rows.
--
-- 1. public.home_outcome_kind(outcome, available_outcomes): how a completed
--    task's outcome counts — approve | reject | return | other | completion.
--    The mapping (docs: Home → My activity, lib/home/activity.ts):
--      reject      reject*, declin*, deny / denied, refus*, disapprov*, veto*,
--                  "not approved", unapproved, "no", fail / failed
--      approve     approv*, accept*, authoris* / authoriz*, endors*, grant*,
--                  "sign off" / "signed off", agree*, "yes", pass / passed,
--                  "go ahead"
--      return      "send back" / "sent back", return*, "request(ed) changes",
--                  "changes requested", rework*, revis*, "more info*",
--                  "need(s) (more) info*"
--      completion  empty, or exactly completed / complete / done / submit /
--                  submitted / finish / finished / close / closed /
--                  acknowledge / acknowledged / noted / ok / okay / save / saved
--      other       anything else, when the task offered two or more outcomes
--                  (a real choice: "Escalate", "Partial release" …)
--      completion  anything else on a task with one outcome or none
--                  ("Records gathered") — it was work, not a decision.
--    Matching is case-insensitive on whole words, reject before approve (so
--    "Disapprove" and "Not approved" are rejections).
--    A decision is approve, reject, return or other. Approval rate = approve
--    ÷ decisions.
--
-- 2. public.home_task_stats(tenant, user, days, tz): the caller's completed
--    tasks in the period — per-bucket counts and durations (days for 7 / 30,
--    ISO weeks for 90, in time zone tz), decisions, time to complete and to
--    pick up (median, p90), on time vs late, top processes.
--      "My task": completed, not deleted, assigned to me — or, with no single
--      assignee (team / collaborative tasks), one I responded to.
--      My outcome: my own response (task_responses), else the task's outcome.
--      Assigned at: the task's creation, or its last reassignment
--      (assigned, reassigned, redirected, delegated, escalated events) before
--      it was completed. Time to complete = completed_at − assigned at.
--      Time to pick up = accepted_at − assigned at (tasks that went through
--      acceptance or a team claim).
--      Deadline: the task's due date, else its run's SLA due time. On time =
--      completed at or before the deadline; tasks with neither are "no
--      deadline" and left out of the share.
--
-- 3. public.home_submission_stats(tenant, user, days): the forms I submitted
--    in the period by their process's status (the main run: a live one, else
--    the latest) and the median / p90 end-to-end time of the completed ones
--    (submitted → the main run completed).
--
-- Time zone: tz when it is a valid zone name (the app sends the browser's),
-- else the person's profile time zone (users.timezone), else UTC. The period
-- starts at local midnight (days − 1) days ago and ends now.
--
-- Both reads are SECURITY INVOKER (RLS applies to a signed-in caller, who may
-- only ask about themselves); the service passes tenant and user explicitly.
-- Index: task_responses (tenant_id, user_id) for the collaborative branch;
-- the rest reuse idx_tasks_tenant_assignee_completed,
-- idx_form_submissions_submitter, idx_workflow_runs_form_submission and
-- idx_lifecycle_events_task.
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_task_responses_tenant_user
  ON public.task_responses (tenant_id, user_id);

/* ── 1. Outcome mapping ───────────────────────────────────────────────── */

CREATE OR REPLACE FUNCTION public.home_outcome_kind(p_outcome text, p_available jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $$
  WITH o AS (
    SELECT btrim(regexp_replace(lower(coalesce(p_outcome, '')), '[^[:alnum:]]+', ' ', 'g')) AS v,
           CASE WHEN jsonb_typeof(p_available) = 'array' THEN jsonb_array_length(p_available) ELSE 0 END AS n
  )
  SELECT CASE
    WHEN v = '' THEN 'completion'
    WHEN v ~ '\m(reject\w*|declin\w*|deny|denied|refus\w*|disapprov\w*|veto\w*|not approved?|unapproved)\M'
      OR v IN ('no', 'fail', 'failed') THEN 'reject'
    WHEN v ~ '\m(approv\w*|accept\w*|authori[sz]\w*|endors\w*|grant\w*|signs? off|signed off|agree\w*|go ahead)\M'
      OR v IN ('yes', 'pass', 'passed') THEN 'approve'
    WHEN v ~ '\m(sen[dt] back|return\w*|requests? changes?|requested changes?|changes? requested|rework\w*|revis\w*|more info\w*|needs? (more )?info\w*)\M' THEN 'return'
    WHEN v IN ('completed', 'complete', 'done', 'submit', 'submitted', 'finish', 'finished', 'close', 'closed',
               'acknowledge', 'acknowledged', 'noted', 'ok', 'okay', 'save', 'saved') THEN 'completion'
    WHEN n >= 2 THEN 'other'
    ELSE 'completion'
  END
  FROM o
$$;

COMMENT ON FUNCTION public.home_outcome_kind(text, jsonb) IS
  'Home → My activity: approve | reject | return | other | completion for a completed task''s outcome (see the migration header for the mapping).';

/* ── 2. My tasks over the period ──────────────────────────────────────── */

-- The zone to bucket by: p_tz when valid, else the profile's, else UTC.
CREATE OR REPLACE FUNCTION public.home_stats_timezone(p_user_id uuid, p_tz text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  z text;
BEGIN
  FOREACH z IN ARRAY ARRAY[p_tz, (SELECT u.timezone FROM public.users u WHERE u.id = p_user_id)] LOOP
    IF z IS NOT NULL AND btrim(z) <> '' AND length(z) <= 64 THEN
      BEGIN
        PERFORM now() AT TIME ZONE z;
        RETURN z;
      EXCEPTION WHEN OTHERS THEN
        NULL; -- not a zone: try the next
      END;
    END IF;
  END LOOP;
  RETURN 'UTC';
END;
$$;

CREATE OR REPLACE FUNCTION public.home_task_stats(p_tenant_id uuid, p_user_id uuid, p_days int DEFAULT 30, p_tz text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH cfg0 AS (
    SELECT (p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL AND (auth.uid() IS NULL OR auth.uid() = p_user_id)) AS ok,
           public.home_stats_timezone(p_user_id, p_tz) AS tz,
           CASE WHEN p_days IN (7, 30, 90) THEN p_days ELSE 30 END AS days
  ),
  cfg AS (
    SELECT c.ok, c.tz, c.days,
           CASE WHEN c.days > 30 THEN 'week' ELSE 'day' END AS unit,
           date_trunc('day', now() AT TIME ZONE c.tz) - make_interval(days => c.days - 1) AS start_local,
           now() AT TIME ZONE c.tz AS now_local
      FROM cfg0 c
  ),
  win AS (SELECT cfg.*, cfg.start_local AT TIME ZONE cfg.tz AS start_ts FROM cfg),
  picked AS (
    -- Assigned to me.
    SELECT t.id
      FROM public.tasks t, win
     WHERE win.ok AND t.tenant_id = p_tenant_id AND t.assignee_id = p_user_id
       AND t.status = 'completed' AND t.deleted_at IS NULL AND t.completed_at >= win.start_ts
    UNION
    -- No single assignee (team / collaborative): one I responded to.
    SELECT t.id
      FROM public.task_responses r
      JOIN public.tasks t ON t.id = r.task_id AND t.tenant_id = r.tenant_id, win
     WHERE win.ok AND r.tenant_id = p_tenant_id AND r.user_id = p_user_id
       AND t.assignee_id IS NULL AND t.status = 'completed' AND t.deleted_at IS NULL AND t.completed_at >= win.start_ts
  ),
  mine AS (
    SELECT t.id, t.completed_at, t.accepted_at, t.workflow_id,
           greatest(t.created_at, (
             SELECT max(e.created_at) FROM public.lifecycle_events e
              WHERE e.task_id = t.id AND e.created_at <= t.completed_at
                AND e.event_type::text IN ('assigned', 'reassigned', 'redirected', 'delegated', 'escalated', 'task_redirected', 'task_escalated')
           )) AS assigned_at,
           coalesce(t.due_date, (SELECT r.sla_due_at FROM public.workflow_runs r WHERE r.id = t.workflow_run_id AND r.tenant_id = t.tenant_id)) AS deadline,
           coalesce((SELECT tr.outcome FROM public.task_responses tr WHERE tr.task_id = t.id AND tr.user_id = p_user_id), t.outcome) AS outcome,
           t.available_outcomes,
           date_trunc((SELECT unit FROM win), t.completed_at AT TIME ZONE (SELECT tz FROM win))::date AS bucket
      FROM picked p JOIN public.tasks t ON t.id = p.id
  ),
  m AS (
    SELECT mine.*,
           greatest(extract(epoch FROM completed_at - assigned_at), 0)::float8 AS duration_s,
           CASE WHEN accepted_at IS NOT NULL AND accepted_at >= assigned_at AND accepted_at <= completed_at
                THEN extract(epoch FROM accepted_at - assigned_at)::float8 END AS pickup_s,
           public.home_outcome_kind(outcome, available_outcomes) AS kind,
           CASE public.home_outcome_kind(outcome, available_outcomes)
             WHEN 'approve' THEN 'Approved' WHEN 'reject' THEN 'Rejected' WHEN 'return' THEN 'Sent back'
             WHEN 'completion' THEN 'Completed'
             ELSE initcap(btrim(regexp_replace(lower(outcome), '\s+', ' ', 'g'))) END AS label
      FROM mine
  ),
  buckets AS (
    SELECT g::date AS bucket
      FROM win, generate_series(date_trunc(win.unit, win.start_local), date_trunc(win.unit, win.now_local), ('1 ' || win.unit)::interval) AS g
     WHERE win.ok
  ),
  per_bucket AS (
    SELECT b.bucket, count(m.id) AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY m.duration_s) AS median_s,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY m.duration_s) AS p90_s
      FROM buckets b LEFT JOIN m ON m.bucket = b.bucket
     GROUP BY b.bucket
  ),
  groups AS (
    SELECT kind, label, count(*) AS n FROM m WHERE kind <> 'completion' GROUP BY kind, label
  ),
  ranked AS (
    SELECT g.*, row_number() OVER (ORDER BY CASE g.kind WHEN 'approve' THEN 0 WHEN 'reject' THEN 1 WHEN 'return' THEN 2 ELSE 3 END, g.n DESC, g.label) AS rn
      FROM groups g
  ),
  shown AS (
    SELECT kind, label, n, rn FROM ranked WHERE rn <= 5
    UNION ALL
    SELECT 'other', 'Other decisions', sum(n), 6 FROM ranked WHERE rn > 5 HAVING count(*) > 0
  ),
  dec AS (
    SELECT count(*) FILTER (WHERE kind <> 'completion') AS decisions,
           count(*) FILTER (WHERE kind = 'approve') AS approved,
           count(*) FILTER (WHERE kind = 'reject') AS rejected,
           count(*) FILTER (WHERE kind = 'return') AS returned,
           count(*) FILTER (WHERE kind = 'completion') AS non_decision
      FROM m
  ),
  procs AS (
    SELECT m.workflow_id, w.name, count(*) AS n
      FROM m JOIN public.workflows w ON w.id = m.workflow_id AND w.tenant_id = p_tenant_id
     GROUP BY m.workflow_id, w.name
     ORDER BY count(*) DESC, w.name
     LIMIT 5
  )
  SELECT jsonb_build_object(
    'period', (SELECT jsonb_build_object('days', days, 'unit', unit, 'timezone', tz,
                 'start', to_char(start_local, 'YYYY-MM-DD'), 'end', to_char(now_local, 'YYYY-MM-DD')) FROM win),
    'completed', jsonb_build_object(
      'total', (SELECT count(*) FROM m),
      'buckets', coalesce((SELECT jsonb_agg(jsonb_build_object('start', to_char(bucket, 'YYYY-MM-DD'), 'count', n,
                   'median_s', round(median_s::numeric), 'p90_s', round(p90_s::numeric)) ORDER BY bucket) FROM per_bucket), '[]'::jsonb)),
    'decisions', (SELECT jsonb_build_object(
      'total', decisions, 'approved', approved, 'rejected', rejected, 'returned', returned,
      'approval_rate', CASE WHEN decisions > 0 THEN round(approved::numeric / decisions, 4) END,
      'non_decision', non_decision,
      'groups', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'label', label, 'count', n) ORDER BY rn) FROM shown), '[]'::jsonb),
      'non_decision_labels', coalesce((SELECT jsonb_agg(x.o ORDER BY x.n DESC, x.o) FROM (
          SELECT initcap(btrim(outcome)) AS o, count(*) AS n FROM m WHERE kind = 'completion' AND coalesce(btrim(outcome), '') <> ''
           GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 3) x), '[]'::jsonb)
    ) FROM dec),
    'durations', jsonb_build_object(
      'count', (SELECT count(*) FROM m),
      'median_s', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_s)::numeric) FROM m),
      'p90_s', (SELECT round(percentile_cont(0.9) WITHIN GROUP (ORDER BY duration_s)::numeric) FROM m),
      'pickup', (SELECT jsonb_build_object('count', count(pickup_s),
                   'median_s', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY pickup_s))::numeric),
                   'p90_s', round((percentile_cont(0.9) WITHIN GROUP (ORDER BY pickup_s))::numeric)) FROM m WHERE pickup_s IS NOT NULL)),
    'on_time', (SELECT jsonb_build_object(
      'with_deadline', count(*) FILTER (WHERE deadline IS NOT NULL),
      'on_time', count(*) FILTER (WHERE deadline IS NOT NULL AND completed_at <= deadline),
      'late', count(*) FILTER (WHERE deadline IS NOT NULL AND completed_at > deadline),
      'no_deadline', count(*) FILTER (WHERE deadline IS NULL),
      'rate', CASE WHEN count(*) FILTER (WHERE deadline IS NOT NULL) > 0
                THEN round((count(*) FILTER (WHERE deadline IS NOT NULL AND completed_at <= deadline))::numeric
                           / count(*) FILTER (WHERE deadline IS NOT NULL), 4) END) FROM m),
    'top_processes', coalesce((SELECT jsonb_agg(jsonb_build_object('workflow_id', workflow_id, 'name', name, 'count', n) ORDER BY n DESC, name) FROM procs), '[]'::jsonb)
  )
$$;

COMMENT ON FUNCTION public.home_task_stats(uuid, uuid, int, text) IS
  'Home → My activity: the person''s completed tasks over 7 / 30 / 90 days (buckets, decisions, durations, on time, top processes). Own data only.';

/* ── 3. My submissions over the period ────────────────────────────────── */

CREATE OR REPLACE FUNCTION public.home_submission_stats(p_tenant_id uuid, p_user_id uuid, p_days int DEFAULT 30, p_tz text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH cfg AS (
    SELECT (p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL AND (auth.uid() IS NULL OR auth.uid() = p_user_id)) AS ok,
           public.home_stats_timezone(p_user_id, p_tz) AS tz,
           CASE WHEN p_days IN (7, 30, 90) THEN p_days ELSE 30 END AS days
  ),
  win AS (
    SELECT ok, (date_trunc('day', now() AT TIME ZONE tz) - make_interval(days => days - 1)) AT TIME ZONE tz AS start_ts FROM cfg
  ),
  subs AS (
    SELECT s.id, s.created_at, s.result, r.status AS run_status, r.completed_at AS run_completed_at
      FROM public.form_submissions s
      CROSS JOIN win
      LEFT JOIN LATERAL (
        SELECT r1.status, r1.completed_at FROM public.workflow_runs r1
         WHERE r1.form_submission_id = s.id AND r1.tenant_id = s.tenant_id
         ORDER BY (r1.status IN ('running', 'waiting_for_event', 'paused')) DESC, r1.started_at DESC
         LIMIT 1
      ) r ON true
     WHERE win.ok AND s.tenant_id = p_tenant_id AND s.submitted_by = p_user_id
       AND s.source <> 'task' AND s.created_at >= win.start_ts
  ),
  shaped AS (
    SELECT CASE
             WHEN run_status IN ('running', 'waiting_for_event', 'paused') THEN 'in_progress'
             WHEN run_status = 'completed' THEN 'completed'
             WHEN run_status = 'failed' THEN 'failed'
             WHEN run_status = 'cancelled' THEN 'cancelled'
             WHEN run_status IS NULL AND public.submission_start_pending(result, created_at) THEN 'in_progress'
             WHEN run_status IS NULL THEN 'no_process'
             ELSE 'in_progress'
           END AS status,
           CASE WHEN run_status = 'completed' AND run_completed_at >= created_at
                THEN extract(epoch FROM run_completed_at - created_at)::float8 END AS e2e_s
      FROM subs
  )
  SELECT jsonb_build_object(
    'days', (SELECT days FROM cfg),
    'timezone', (SELECT tz FROM cfg),
    'total', count(*),
    'completed', count(*) FILTER (WHERE status = 'completed'),
    'in_progress', count(*) FILTER (WHERE status = 'in_progress'),
    'failed', count(*) FILTER (WHERE status = 'failed'),
    'cancelled', count(*) FILTER (WHERE status = 'cancelled'),
    'no_process', count(*) FILTER (WHERE status = 'no_process'),
    'median_s', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY e2e_s))::numeric),
    'p90_s', round((percentile_cont(0.9) WITHIN GROUP (ORDER BY e2e_s))::numeric)
  )
  FROM shaped
$$;

COMMENT ON FUNCTION public.home_submission_stats(uuid, uuid, int, text) IS
  'Home → My activity: the forms the person submitted over 7 / 30 / 90 days by process status, and the median / p90 submitted → completed time. Own data only.';

DO $grants$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.home_outcome_kind(text, jsonb)',
    'public.home_stats_timezone(uuid, text)',
    'public.home_task_stats(uuid, uuid, int, text)',
    'public.home_submission_stats(uuid, uuid, int, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $grants$;
