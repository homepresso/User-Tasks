-- ============================================================================
-- 20261217000000_home_dashboard.sql
--
-- The Home page (/home): metrics, My tasks, Task queue, Following, My
-- submissions and Favourite forms.
--
-- 1. workflow_runs.started_by / started_via / form_submission_id: who started
--    the run (the person — never the owner fallback; NULL for system starts
--    and designer test runs), how, and the form submission that started it
--    (button "Start workflow" and "Form submitted" runs). Set by the engine
--    when it creates the run; existing runs are backfilled from their stored
--    variables. Indexed for "runs I started" and "runs of my submissions".
--
-- 2. tasks.workflow_run_id: the run a workflow task belongs to (set by the
--    engine; tasks.event_id only matches the run while it waits on that
--    task). Backfilled for tasks whose run still waits on them.
--
-- 3. public.run_followers (tenant_id, user_id, run_id, source, created_at):
--    the runs a person follows. RLS: a person reads and deletes their own
--    rows in their workspaces and may only add a row for a run they can see
--    (can_view_run_progress). tenant_id is always the run's (trigger).
--    Auto-follow: a run a person starts (a form they submit included) is
--    followed for them, unless their preferences say auto_follow_runs =
--    false. Sub-workflow runs are not auto-followed.
--
-- 4. public.form_favorites (tenant_id, user_id, form_id, created_at): starred
--    forms. RLS: own rows; a form can be starred only when the person can
--    open it (can_open_form: forms.submit in the form's workspace).
--    list_favorite_forms hides favourites whose access was revoked.
--
-- 5. Reads: home_task_metrics, home_submission_metrics, home_follow_metrics
--    (one round trip per card), list_my_submissions, list_followed_runs,
--    workflow_node_labels (step labels only — never configs).
--
--    The read functions are SECURITY INVOKER (RLS applies) and a signed-in
--    caller can only ask for their own rows (p_user_id must be auth.uid());
--    the service (service role, API callers acting as a user) passes the
--    tenant and user explicitly and every table is filtered by p_tenant_id.
--
-- Additive and idempotent.
-- ============================================================================

SET lock_timeout = '5s';

/* ── 1. workflow_runs: who started it, and from which submission ─────── */

ALTER TABLE public.workflow_runs ADD COLUMN IF NOT EXISTS started_by uuid;
ALTER TABLE public.workflow_runs ADD COLUMN IF NOT EXISTS started_via text;
ALTER TABLE public.workflow_runs ADD COLUMN IF NOT EXISTS form_submission_id uuid;

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_runs_started_by_fkey') THEN
    ALTER TABLE public.workflow_runs ADD CONSTRAINT workflow_runs_started_by_fkey
      FOREIGN KEY (started_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_runs_form_submission_id_fkey') THEN
    ALTER TABLE public.workflow_runs ADD CONSTRAINT workflow_runs_form_submission_id_fkey
      FOREIGN KEY (form_submission_id) REFERENCES public.form_submissions(id) ON DELETE SET NULL;
  END IF;
END $fk$;

COMMENT ON COLUMN public.workflow_runs.started_by IS
  'The person who started the run (NULL for system starts and designer test runs). Home → Following auto-follows it for them.';
COMMENT ON COLUMN public.workflow_runs.started_via IS
  'How the run was started (ui, api, cli, mcp, form, task, subworkflow, schedule, …; lib/workflow-initiator.ts).';
COMMENT ON COLUMN public.workflow_runs.form_submission_id IS
  'The form submission that started the run (button Start workflow or a Form submitted trigger). Home → My submissions.';

CREATE INDEX IF NOT EXISTS idx_workflow_runs_started_by
  ON public.workflow_runs (tenant_id, started_by, started_at DESC) WHERE started_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_runs_form_submission
  ON public.workflow_runs (form_submission_id) WHERE form_submission_id IS NOT NULL;

-- Backfill from the stored variables (the person, never the owner fallback).
UPDATE public.workflow_runs r
   SET started_by = u.id,
       started_via = coalesce(r.started_via, nullif(coalesce(r.variables, r.pause_variables)->>'workflow_started_via', ''))
  FROM public.users u
 WHERE r.started_by IS NULL
   AND coalesce(r.variables, r.pause_variables) IS NOT NULL
   AND coalesce(coalesce(r.variables, r.pause_variables)->>'workflow_started_via', '') NOT IN ('test', 'system', 'schedule', 'webhook', 'event')
   AND u.id::text = coalesce(
         nullif(coalesce(r.variables, r.pause_variables)->>'workflow_initiator_user_id', ''),
         coalesce(r.variables, r.pause_variables)->>'workflow_started_by');

UPDATE public.workflow_runs r
   SET form_submission_id = s.id
  FROM public.form_submissions s
 WHERE r.form_submission_id IS NULL
   AND coalesce(r.variables, r.pause_variables)->>'workflow_started_via' = 'form'
   AND s.id::text = coalesce(r.variables, r.pause_variables)->>'form_submission_id'
   AND s.tenant_id = r.tenant_id;

/* ── 2. tasks.workflow_run_id ─────────────────────────────────────────── */

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS workflow_run_id uuid;

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_workflow_run_id_fkey') THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_workflow_run_id_fkey
      FOREIGN KEY (workflow_run_id) REFERENCES public.workflow_runs(id) ON DELETE SET NULL;
  END IF;
END $fk$;

COMMENT ON COLUMN public.tasks.workflow_run_id IS 'The workflow run this task belongs to (workflow tasks; set by the engine).';

CREATE INDEX IF NOT EXISTS idx_tasks_workflow_run
  ON public.tasks (workflow_run_id) WHERE workflow_run_id IS NOT NULL;
-- My tasks: completed in the last 30 days.
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_assignee_completed
  ON public.tasks (tenant_id, assignee_id, completed_at DESC) WHERE status = 'completed' AND deleted_at IS NULL;
-- Task queue: unassigned team tasks.
CREATE INDEX IF NOT EXISTS idx_tasks_team_unassigned_open
  ON public.tasks (assigned_team_id, created_at DESC)
  WHERE assignee_id IS NULL AND assigned_team_id IS NOT NULL AND deleted_at IS NULL AND status IN ('todo', 'in_progress');

UPDATE public.tasks t
   SET workflow_run_id = r.id
  FROM public.workflow_runs r
 WHERE t.workflow_run_id IS NULL
   AND t.event_id IS NOT NULL
   AND r.event_id = t.event_id
   AND r.tenant_id = t.tenant_id;

/* ── Who can see a run's progress ─────────────────────────────────────── */

-- p_user_id may see run p_run_id's progress (the Home flow view, following):
-- they are an active member of the run's workspace AND
--   - they started it, or
--   - it was started by a form submission of theirs, or
--   - they are (or were) assigned a task in it, or
--   - they hold workflows.view_runs in that workspace.
-- A signed-in caller can only ask about themselves.
CREATE OR REPLACE FUNCTION public.can_view_run_progress(p_run_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT p_run_id IS NOT NULL AND p_user_id IS NOT NULL
     AND (auth.uid() IS NULL OR auth.uid() = p_user_id)
     AND EXISTS (
       SELECT 1
         FROM public.workflow_runs r
        WHERE r.id = p_run_id
          AND (
            EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.tenant_id = r.tenant_id AND u.deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM public.user_memberships m WHERE m.user_id = p_user_id AND m.tenant_id = r.tenant_id AND m.is_active)
          )
          AND (
            r.started_by = p_user_id
            OR EXISTS (
              SELECT 1 FROM public.form_submissions s
               WHERE s.id = r.form_submission_id AND s.tenant_id = r.tenant_id AND s.submitted_by = p_user_id
            )
            OR EXISTS (
              SELECT 1 FROM public.tasks t
               WHERE t.workflow_run_id = r.id AND t.tenant_id = r.tenant_id AND t.deleted_at IS NULL
                 AND (t.assignee_id = p_user_id
                      OR EXISTS (SELECT 1 FROM public.task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = p_user_id))
            )
            OR EXISTS (
              SELECT 1
                FROM public.user_roles ur
                JOIN public.roles ro ON ro.id = ur.role_id AND ro.tenant_id = ur.tenant_id
               WHERE ur.user_id = p_user_id AND ur.tenant_id = r.tenant_id
                 AND 'workflows.view_runs' = ANY (ro.permissions)
            )
          )
     )
$$;

COMMENT ON FUNCTION public.can_view_run_progress(uuid, uuid) IS
  'Home: may the person see this run''s progress (started it, their form submission started it, they have a task in it, or workflows.view_runs). Members of the run''s workspace only.';

REVOKE ALL ON FUNCTION public.can_view_run_progress(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_run_progress(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_view_run_progress(uuid, uuid) TO authenticated, service_role;

-- p_user_id can open form p_form_id: an active member of the form's
-- workspace holding forms.submit there (the /f/<id> page's rule).
CREATE OR REPLACE FUNCTION public.can_open_form(p_form_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT p_form_id IS NOT NULL AND p_user_id IS NOT NULL
     AND (auth.uid() IS NULL OR auth.uid() = p_user_id)
     AND EXISTS (
       SELECT 1
         FROM public.forms f
        WHERE f.id = p_form_id
          AND (
            EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.tenant_id = f.tenant_id AND u.deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM public.user_memberships m WHERE m.user_id = p_user_id AND m.tenant_id = f.tenant_id AND m.is_active)
          )
          AND EXISTS (
            SELECT 1
              FROM public.user_roles ur
              JOIN public.roles ro ON ro.id = ur.role_id AND ro.tenant_id = ur.tenant_id
             WHERE ur.user_id = p_user_id AND ur.tenant_id = f.tenant_id
               AND 'forms.submit' = ANY (ro.permissions)
          )
     )
$$;

COMMENT ON FUNCTION public.can_open_form(uuid, uuid) IS
  'Home favourites: may the person open this form (forms.submit in the form''s workspace, active member).';

REVOKE ALL ON FUNCTION public.can_open_form(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_open_form(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_open_form(uuid, uuid) TO authenticated, service_role;

/* ── 3. run_followers ─────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.run_followers (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, run_id)
);

COMMENT ON TABLE public.run_followers IS
  'Workflow runs a person follows (Home → Following). source auto: followed because they started it.';

CREATE INDEX IF NOT EXISTS idx_run_followers_user ON public.run_followers (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_followers_run ON public.run_followers (run_id);

-- tenant_id is always the run's.
CREATE OR REPLACE FUNCTION public.run_followers_set_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  SELECT r.tenant_id INTO NEW.tenant_id FROM public.workflow_runs r WHERE r.id = NEW.run_id;
  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Run not found' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_run_followers_tenant ON public.run_followers;
CREATE TRIGGER trg_run_followers_tenant
  BEFORE INSERT OR UPDATE OF run_id, tenant_id ON public.run_followers
  FOR EACH ROW EXECUTE FUNCTION public.run_followers_set_tenant();

ALTER TABLE public.run_followers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS run_followers_select ON public.run_followers;
CREATE POLICY run_followers_select ON public.run_followers FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

DROP POLICY IF EXISTS run_followers_insert ON public.run_followers;
CREATE POLICY run_followers_insert ON public.run_followers FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
    AND public.can_view_run_progress(run_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS run_followers_delete ON public.run_followers;
CREATE POLICY run_followers_delete ON public.run_followers FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

REVOKE ALL ON public.run_followers FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.run_followers TO authenticated;
GRANT ALL ON public.run_followers TO service_role;

-- Auto-follow: the person who started a run follows it (preference
-- users.preferences.auto_follow_runs, default on). Never fails the run.
CREATE OR REPLACE FUNCTION public.workflow_runs_auto_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.started_by IS NULL OR coalesce(NEW.started_via, '') IN ('subworkflow', 'test') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.started_by IS NOT DISTINCT FROM NEW.started_by THEN
    RETURN NEW;
  END IF;
  BEGIN
    INSERT INTO public.run_followers (tenant_id, user_id, run_id, source)
    SELECT NEW.tenant_id, u.id, NEW.id, 'auto'
      FROM public.users u
     WHERE u.id = NEW.started_by
       AND coalesce(u.preferences->>'auto_follow_runs', 'true') <> 'false'
    ON CONFLICT (user_id, run_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'auto-follow of run % failed: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_workflow_runs_auto_follow ON public.workflow_runs;
CREATE TRIGGER trg_workflow_runs_auto_follow
  AFTER INSERT OR UPDATE OF started_by ON public.workflow_runs
  FOR EACH ROW EXECUTE FUNCTION public.workflow_runs_auto_follow();

-- Existing runs still in progress are followed by the person who started
-- them (finished ones are not, so Following doesn't start out cluttered).
INSERT INTO public.run_followers (tenant_id, user_id, run_id, source)
SELECT r.tenant_id, r.started_by, r.id, 'auto'
  FROM public.workflow_runs r
  JOIN public.users u ON u.id = r.started_by
 WHERE r.started_by IS NOT NULL
   AND r.status IN ('running', 'waiting_for_event', 'paused')
   AND coalesce(r.started_via, '') NOT IN ('subworkflow', 'test')
   AND coalesce(u.preferences->>'auto_follow_runs', 'true') <> 'false'
ON CONFLICT (user_id, run_id) DO NOTHING;

/* ── 4. form_favorites ────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.form_favorites (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES public.forms(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, form_id)
);

COMMENT ON TABLE public.form_favorites IS 'Starred forms (Home → Favourite forms). Hidden when the person can no longer open the form.';

CREATE INDEX IF NOT EXISTS idx_form_favorites_user ON public.form_favorites (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_form_favorites_form ON public.form_favorites (form_id);

CREATE OR REPLACE FUNCTION public.form_favorites_set_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  SELECT f.tenant_id INTO NEW.tenant_id FROM public.forms f WHERE f.id = NEW.form_id;
  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Form not found' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_form_favorites_tenant ON public.form_favorites;
CREATE TRIGGER trg_form_favorites_tenant
  BEFORE INSERT OR UPDATE OF form_id, tenant_id ON public.form_favorites
  FOR EACH ROW EXECUTE FUNCTION public.form_favorites_set_tenant();

ALTER TABLE public.form_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS form_favorites_select ON public.form_favorites;
CREATE POLICY form_favorites_select ON public.form_favorites FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

DROP POLICY IF EXISTS form_favorites_insert ON public.form_favorites;
CREATE POLICY form_favorites_insert ON public.form_favorites FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
    AND public.can_open_form(form_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS form_favorites_delete ON public.form_favorites;
CREATE POLICY form_favorites_delete ON public.form_favorites FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

REVOKE ALL ON public.form_favorites FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.form_favorites TO authenticated;
GRANT ALL ON public.form_favorites TO service_role;

-- The person's favourite forms they can still open, alphabetical.
CREATE OR REPLACE FUNCTION public.list_favorite_forms(p_tenant_id uuid, p_user_id uuid)
RETURNS TABLE (id uuid, name text, description text, favorited_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  SELECT f.id, f.name, f.description, ff.created_at
    FROM public.form_favorites ff
    JOIN public.forms f ON f.id = ff.form_id AND f.tenant_id = ff.tenant_id
   WHERE p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL
     AND (auth.uid() IS NULL OR auth.uid() = p_user_id)
     AND ff.tenant_id = p_tenant_id
     AND ff.user_id = p_user_id
     AND EXISTS (
       SELECT 1
         FROM public.user_roles ur
         JOIN public.roles ro ON ro.id = ur.role_id AND ro.tenant_id = ur.tenant_id
        WHERE ur.user_id = p_user_id AND ur.tenant_id = p_tenant_id
          AND 'forms.submit' = ANY (ro.permissions)
     )
   ORDER BY lower(f.name), f.name, f.id
$$;

REVOKE ALL ON FUNCTION public.list_favorite_forms(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_favorite_forms(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_favorite_forms(uuid, uuid) TO authenticated, service_role;

/* ── 5. Home reads ────────────────────────────────────────────────────── */

-- My tasks card: open (assigned to me, accepted or not yet asked), overdue,
-- SLA breached, completed in the last 30 days, and the queue size.
CREATE OR REPLACE FUNCTION public.home_task_metrics(p_tenant_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH guard AS (
    SELECT (p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL AND (auth.uid() IS NULL OR auth.uid() = p_user_id)) AS ok
  ),
  mine AS (
    SELECT t.id, t.due_date, t.event_id
      FROM public.tasks t, guard
     WHERE guard.ok
       AND t.tenant_id = p_tenant_id
       AND t.assignee_id = p_user_id
       AND t.deleted_at IS NULL
       AND t.parent_task_id IS NULL
       AND t.status NOT IN ('completed', 'cancelled', 'draft')
       AND t.acceptance_status <> 'pending'
  ),
  teams AS (
    SELECT ut.team_id FROM public.user_teams ut JOIN public.teams tm ON tm.id = ut.team_id AND tm.tenant_id = p_tenant_id
     WHERE ut.user_id = p_user_id
  )
  SELECT jsonb_build_object(
    'open', (SELECT count(*) FROM mine),
    'overdue', (SELECT count(*) FROM mine WHERE due_date < now()),
    'sla_breached', (SELECT count(*) FROM mine m WHERE m.event_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.workflow_runs r WHERE r.event_id = m.event_id AND r.tenant_id = p_tenant_id AND r.sla_status = 'breached')),
    'completed_30d', (SELECT count(*) FROM public.tasks t, guard
        WHERE guard.ok AND t.tenant_id = p_tenant_id AND t.assignee_id = p_user_id AND t.status = 'completed'
          AND t.deleted_at IS NULL AND t.completed_at >= now() - interval '30 days'),
    'queue', (SELECT count(*) FROM public.tasks t, guard
        WHERE guard.ok AND t.tenant_id = p_tenant_id AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
          AND (
            (t.assignee_id = p_user_id AND t.acceptance_status = 'pending' AND t.status NOT IN ('completed', 'cancelled'))
            OR (t.assignee_id IS NULL AND t.assigned_team_id IN (SELECT team_id FROM teams) AND t.status IN ('todo', 'in_progress'))
          ))
  )
$$;

-- A submission's workflow start is still pending: a button start whose
-- queue job hasn't run yet, or a "Form submitted" trigger fired in the last
-- 15 minutes that has no run yet (the caller checks there is no run).
CREATE OR REPLACE FUNCTION public.submission_start_pending(p_result jsonb, p_created_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT coalesce(
    EXISTS (
      SELECT 1 FROM public.workflow_queue q
       WHERE q.id = ANY (ARRAY(
               SELECT (r->>'job_id')::uuid
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_result->'runs') = 'array' THEN p_result->'runs' ELSE '[]'::jsonb END) AS r
                WHERE r->>'job_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
         AND q.status IN ('pending', 'processing')
    )
    OR (coalesce((p_result->>'triggered')::int, 0) > 0 AND p_created_at > now() - interval '15 minutes'),
    false)
$$;

REVOKE ALL ON FUNCTION public.submission_start_pending(jsonb, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submission_start_pending(jsonb, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.submission_start_pending(jsonb, timestamptz) TO authenticated, service_role;

-- My submissions card: in progress (a linked run running / waiting, or a
-- start still queued) and completed in the last 30 days. Task-form
-- submissions are task completions, not counted here.
CREATE OR REPLACE FUNCTION public.home_submission_metrics(p_tenant_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH subs AS (
    SELECT s.id, s.created_at, s.result,
           (SELECT array_agg(r.status) FROM public.workflow_runs r WHERE r.form_submission_id = s.id AND r.tenant_id = s.tenant_id) AS statuses,
           (SELECT max(r.completed_at) FROM public.workflow_runs r WHERE r.form_submission_id = s.id AND r.tenant_id = s.tenant_id) AS completed_at
      FROM public.form_submissions s
     WHERE p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL
       AND (auth.uid() IS NULL OR auth.uid() = p_user_id)
       AND s.tenant_id = p_tenant_id
       AND s.submitted_by = p_user_id
       AND s.source <> 'task'
  )
  SELECT jsonb_build_object(
    'in_progress', (SELECT count(*) FROM subs WHERE
        statuses && ARRAY['running', 'waiting_for_event', 'paused']
        OR (statuses IS NULL AND public.submission_start_pending(result, created_at))),
    'completed_30d', (SELECT count(*) FROM subs WHERE statuses IS NOT NULL
        AND NOT (statuses && ARRAY['running', 'waiting_for_event', 'paused'])
        AND 'completed' = ANY (statuses) AND completed_at >= now() - interval '30 days'),
    'submitted_30d', (SELECT count(*) FROM subs WHERE created_at >= now() - interval '30 days')
  )
$$;

-- Following card: runs I follow that are still active, and those updated today.
CREATE OR REPLACE FUNCTION public.home_follow_metrics(p_tenant_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH f AS (
    SELECT r.status, greatest(r.started_at, r.paused_at, r.completed_at) AS updated_at
      FROM public.run_followers rf
      JOIN public.workflow_runs r ON r.id = rf.run_id AND r.tenant_id = rf.tenant_id
     WHERE p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL
       AND (auth.uid() IS NULL OR auth.uid() = p_user_id)
       AND rf.tenant_id = p_tenant_id
       AND rf.user_id = p_user_id
  )
  SELECT jsonb_build_object(
    'active', (SELECT count(*) FROM f WHERE status IN ('running', 'waiting_for_event', 'paused')),
    'updated_today', (SELECT count(*) FROM f WHERE updated_at >= date_trunc('day', now())),
    'total', (SELECT count(*) FROM f)
  )
$$;

-- The step ids, types and labels of workflow versions / drafts (never
-- configs): what Home shows as a run's stage.
CREATE OR REPLACE FUNCTION public.workflow_node_labels(p_tenant_id uuid, p_version_ids uuid[], p_workflow_ids uuid[])
RETURNS TABLE (version_id uuid, workflow_id uuid, node_id text, node_type text, label text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  SELECT v.id, v.workflow_id, n->>'id', n->>'type', n->>'label'
    FROM public.workflow_versions v
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.nodes) = 'array' THEN v.nodes ELSE '[]'::jsonb END) AS n
   WHERE v.tenant_id = p_tenant_id AND v.id = ANY (coalesce(p_version_ids, '{}'))
  UNION ALL
  SELECT NULL::uuid, w.id, n->>'id', n->>'type', n->>'label'
    FROM public.workflows w
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(w.nodes) = 'array' THEN w.nodes ELSE '[]'::jsonb END) AS n
   WHERE w.tenant_id = p_tenant_id AND w.id = ANY (coalesce(p_workflow_ids, '{}'))
$$;

-- My submissions, newest first: the submission, its main run (a live one
-- first, else the latest) and how many runs it started. p_status: all |
-- active | completed | failed. p_search matches the form or process name.
CREATE OR REPLACE FUNCTION public.list_my_submissions(
  p_tenant_id uuid, p_user_id uuid, p_search text DEFAULT NULL, p_status text DEFAULT 'all', p_limit int DEFAULT 25, p_offset int DEFAULT 0)
RETURNS TABLE (
  submission_id uuid, form_id uuid, form_name text, source text, submitted_at timestamptz,
  run_id uuid, run_status text, workflow_id uuid, workflow_name text, version_id uuid, event_id text,
  paused_node_id text, wait_node_ids text[], started_at timestamptz, completed_at timestamptz, updated_at timestamptz,
  run_count int, queued boolean, total_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH base AS (
    SELECT s.id, s.form_id, s.form_name, s.source, s.created_at, s.result,
           r.id AS run_id, r.status AS run_status, r.workflow_id, w.name AS workflow_name, r.version_id, r.event_id,
           r.paused_node_id,
           CASE WHEN r.status IN ('waiting_for_event', 'paused') THEN ARRAY(
             SELECT x->>'node_id' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.pause_variables->'_parallel'->'waits') = 'array'
               THEN r.pause_variables->'_parallel'->'waits' ELSE '[]'::jsonb END) AS x) END AS wait_node_ids,
           r.started_at, r.completed_at, r.paused_at,
           (SELECT count(*) FROM public.workflow_runs r2 WHERE r2.form_submission_id = s.id AND r2.tenant_id = s.tenant_id)::int AS run_count
      FROM public.form_submissions s
      LEFT JOIN LATERAL (
        SELECT r1.* FROM public.workflow_runs r1
         WHERE r1.form_submission_id = s.id AND r1.tenant_id = s.tenant_id
         ORDER BY (r1.status IN ('running', 'waiting_for_event', 'paused')) DESC, r1.started_at DESC
         LIMIT 1
      ) r ON true
      LEFT JOIN public.workflows w ON w.id = r.workflow_id
     WHERE p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL
       AND (auth.uid() IS NULL OR auth.uid() = p_user_id)
       AND s.tenant_id = p_tenant_id
       AND s.submitted_by = p_user_id
       AND s.source <> 'task'
  ),
  shaped AS (
    SELECT b.*,
           (b.run_id IS NULL AND public.submission_start_pending(b.result, b.created_at)) AS is_queued,
           greatest(b.created_at, b.started_at, b.paused_at, b.completed_at) AS last_update
      FROM base b
  ),
  filtered AS (
    SELECT * FROM shaped
     WHERE (coalesce(p_search, '') = ''
            OR form_name ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            OR workflow_name ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
       AND (coalesce(p_status, 'all') = 'all'
            OR (p_status = 'active' AND (run_status IN ('running', 'waiting_for_event', 'paused') OR is_queued))
            OR (p_status = 'completed' AND run_status = 'completed')
            OR (p_status = 'failed' AND run_status IN ('failed', 'cancelled')))
  )
  SELECT id, form_id, form_name, source, created_at,
         run_id, run_status, workflow_id, workflow_name, version_id, event_id,
         paused_node_id, wait_node_ids, started_at, completed_at, last_update,
         run_count, coalesce(is_queued, false), count(*) OVER ()
    FROM filtered
   ORDER BY created_at DESC, id
   LIMIT greatest(1, least(coalesce(p_limit, 25), 100)) OFFSET greatest(0, coalesce(p_offset, 0))
$$;

-- Runs I follow (that I can still see), most recently updated first.
-- p_status: all | active | completed | failed.
CREATE OR REPLACE FUNCTION public.list_followed_runs(
  p_tenant_id uuid, p_user_id uuid, p_search text DEFAULT NULL, p_status text DEFAULT 'all', p_limit int DEFAULT 25, p_offset int DEFAULT 0)
RETURNS TABLE (
  run_id uuid, run_status text, workflow_id uuid, workflow_name text, run_title text, version_id uuid, event_id text,
  paused_node_id text, wait_node_ids text[], started_at timestamptz, completed_at timestamptz, updated_at timestamptz,
  followed_at timestamptz, follow_source text, form_submission_id uuid, total_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH base AS (
    SELECT r.id, r.status, r.workflow_id, w.name AS workflow_name, r.title, r.version_id, r.event_id, r.paused_node_id,
           CASE WHEN r.status IN ('waiting_for_event', 'paused') THEN ARRAY(
             SELECT x->>'node_id' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.pause_variables->'_parallel'->'waits') = 'array'
               THEN r.pause_variables->'_parallel'->'waits' ELSE '[]'::jsonb END) AS x) END AS wait_node_ids,
           r.started_at, r.completed_at, greatest(r.started_at, r.paused_at, r.completed_at) AS updated_at,
           rf.created_at AS followed_at, rf.source, r.form_submission_id
      FROM public.run_followers rf
      JOIN public.workflow_runs r ON r.id = rf.run_id AND r.tenant_id = rf.tenant_id
      LEFT JOIN public.workflows w ON w.id = r.workflow_id
     WHERE p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL
       AND (auth.uid() IS NULL OR auth.uid() = p_user_id)
       AND rf.tenant_id = p_tenant_id
       AND rf.user_id = p_user_id
       AND (coalesce(p_search, '') = ''
            OR w.name ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
            OR r.title ILIKE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
       AND (coalesce(p_status, 'all') = 'all'
            OR (p_status = 'active' AND r.status IN ('running', 'waiting_for_event', 'paused'))
            OR (p_status = 'completed' AND r.status = 'completed')
            OR (p_status = 'failed' AND r.status IN ('failed', 'cancelled')))
  ),
  visible AS (
    SELECT * FROM base WHERE public.can_view_run_progress(base.id, p_user_id)
  )
  SELECT id, status, workflow_id, workflow_name, title, version_id, event_id, paused_node_id, wait_node_ids,
         started_at, completed_at, updated_at, followed_at, source, form_submission_id, count(*) OVER ()
    FROM visible
   ORDER BY (status IN ('running', 'waiting_for_event', 'paused')) DESC, updated_at DESC, id
   LIMIT greatest(1, least(coalesce(p_limit, 25), 100)) OFFSET greatest(0, coalesce(p_offset, 0))
$$;

DO $grants$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.home_task_metrics(uuid, uuid)',
    'public.home_submission_metrics(uuid, uuid)',
    'public.home_follow_metrics(uuid, uuid)',
    'public.workflow_node_labels(uuid, uuid[], uuid[])',
    'public.list_my_submissions(uuid, uuid, text, text, int, int)',
    'public.list_followed_runs(uuid, uuid, text, text, int, int)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $grants$;
