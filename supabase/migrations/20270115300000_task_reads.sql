-- ============================================================================
-- 20270115300000_task_reads.sql
--
-- Unread tasks: the dot + bold title on task lists, the unread count next to
-- My tasks, Mark as unread / Mark all as read. Per-person read state.
--
-- THE RULE (lib/tasks/unread.ts mirrors it; docs: Tasks → Unread tasks)
--   A task is unread for a person when ALL of these hold:
--     1. it is open: status todo / in_progress / blocked, not deleted
--        (completed, cancelled and draft tasks are never unread);
--     2. the person holds it: its assignee, a collaborator or claim
--        candidate (task_assignees, not declined), or a member of the
--        assigned team of an unassigned team task (user_teams or the legacy
--        users.team_id);
--     3. they have not opened it since it became theirs: no task_reads row,
--        or seen_at < "since", where since = tasks.routed_at, and for a
--        collaborator the later of routed_at and when they were added.
--   tasks.routed_at is when the task last reached its holders: set on
--   INSERT, and moved to now() when the assignee or the assigned team
--   changes (assign, reassign, delegate, escalate, claim, release) or when
--   the task comes back to work (completed / cancelled / draft → todo /
--   in_progress / blocked: reopened, published, sent back). Other edits
--   (title, fields, comments, progress) leave it alone, so a task stays read
--   while its owner works on it.
--
-- 1. tasks.routed_at (NOT NULL, DEFAULT now()): added with a constant
--    default (no table rewrite); existing rows get the migration time.
--    trg_tasks_routed_at keeps it (BEFORE INSERT OR UPDATE OF assignee_id,
--    assigned_team_id, status).
-- 2. public.task_reads (task_id, user_id, tenant_id, seen_at):
--    PRIMARY KEY (task_id, user_id); FKs ON DELETE CASCADE (task, person,
--    workspace); tenant_id always follows the task (trigger). RLS: a person
--    reads, writes and deletes only their own rows in their member
--    workspaces (rls_member_tenant_ids() — the COALESCE(current_tenant_id,
--    tenant_id) resolution, unified view included); INSERT / UPDATE only for
--    a task they can see (task_view_access). Mark as unread deletes the row.
-- 3. On first apply only: everyone's currently open held tasks are marked
--    read (seen_at = routed_at), so an upgrade doesn't turn every existing
--    task bold. Re-running the file skips this (the column already exists).
-- 4. public.task_unread_ids(p_user_id, p_tenant_id, p_task_ids): the rule
--    as one set-returning query — which of these tasks (NULL: all held
--    tasks) are unread for the person. Indexed: tasks by assignee / team,
--    task_assignees by user, task_reads by primary key; no per-row calls.
--    public.task_unread_count(p_user_id, p_tenant_id, p_top_level): count.
--    public.mark_tasks_read(p_user_id, p_tenant_id, p_task_ids): upsert
--    seen_at = now() for those tasks (NULL: every unread task, "Mark all as
--    read"); returns how many rows it wrote.
--    All SECURITY DEFINER; a signed-in caller can only ask about (or write
--    for) themselves; the service role for anyone.
-- 5. nav_task_counts gains "unread": unread top-level tasks of the My tasks
--    list (same holders), for the badge next to My tasks.
--
-- Additive and idempotent. Until it is applied the app shows no unread
-- state (the reads fall back to "all read") and the mark endpoints report a
-- database error.
-- ============================================================================

SET lock_timeout = '5s';

/* ── 2. task_reads ─────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.task_reads (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

COMMENT ON TABLE public.task_reads IS
  'When a person last opened a task (unread dot on task lists). Written by lib/services/task-reads.ts; no row or seen_at < tasks.routed_at = unread for a holder of an open task.';

CREATE INDEX IF NOT EXISTS idx_task_reads_user ON public.task_reads (user_id, tenant_id);

CREATE OR REPLACE FUNCTION public.task_reads_set_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  SELECT t.tenant_id INTO NEW.tenant_id FROM public.tasks t WHERE t.id = NEW.task_id;
  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_reads_tenant ON public.task_reads;
CREATE TRIGGER trg_task_reads_tenant
  BEFORE INSERT OR UPDATE OF task_id, tenant_id ON public.task_reads
  FOR EACH ROW EXECUTE FUNCTION public.task_reads_set_tenant();

ALTER TABLE public.task_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_reads_select ON public.task_reads;
CREATE POLICY task_reads_select ON public.task_reads FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

DROP POLICY IF EXISTS task_reads_insert ON public.task_reads;
CREATE POLICY task_reads_insert ON public.task_reads FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
    AND public.task_view_access(task_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS task_reads_update ON public.task_reads;
CREATE POLICY task_reads_update ON public.task_reads FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
    AND public.task_view_access(task_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS task_reads_delete ON public.task_reads;
CREATE POLICY task_reads_delete ON public.task_reads FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

REVOKE ALL ON public.task_reads FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_reads TO authenticated;
GRANT ALL ON public.task_reads TO service_role;

-- task_assignees by task (the per-task collaborator check of a list page).
CREATE INDEX IF NOT EXISTS idx_task_assignees_task_user ON public.task_assignees (task_id, user_id);
-- Unassigned open team tasks by team (the team branch of the count; the
-- queue's idx_tasks_team_unassigned_open leaves out blocked tasks).
CREATE INDEX IF NOT EXISTS idx_tasks_team_unassigned_unread ON public.tasks (assigned_team_id)
  WHERE assignee_id IS NULL AND assigned_team_id IS NOT NULL AND deleted_at IS NULL
    AND status IN ('todo', 'in_progress', 'blocked');

/* ── 1 + 3. tasks.routed_at and the first-apply backfill ─────────────── */

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'routed_at'
  ) THEN
    RETURN;  -- already applied: no second backfill
  END IF;
  -- Constant default (now() is evaluated once): no table rewrite.
  ALTER TABLE public.tasks ADD COLUMN routed_at timestamptz NOT NULL DEFAULT now();
  -- First apply: what is open today counts as read for its current holders,
  -- so an upgrade doesn't turn every existing task bold.
  INSERT INTO public.task_reads (task_id, user_id, tenant_id, seen_at)
  SELECT h.task_id, h.user_id, h.tenant_id, h.routed_at
    FROM (
      SELECT t.id AS task_id, t.assignee_id AS user_id, t.tenant_id, t.routed_at
        FROM public.tasks t
       WHERE t.assignee_id IS NOT NULL AND t.deleted_at IS NULL AND t.status IN ('todo', 'in_progress', 'blocked')
      UNION
      SELECT t.id, a.user_id, t.tenant_id, GREATEST(t.routed_at, a.created_at)
        FROM public.task_assignees a
        JOIN public.tasks t ON t.id = a.task_id
       WHERE t.deleted_at IS NULL AND t.status IN ('todo', 'in_progress', 'blocked') AND a.acceptance_status <> 'declined'
      UNION
      SELECT t.id, ut.user_id, t.tenant_id, t.routed_at
        FROM public.tasks t
        JOIN public.user_teams ut ON ut.team_id = t.assigned_team_id
       WHERE t.assignee_id IS NULL AND t.assigned_team_id IS NOT NULL
         AND t.deleted_at IS NULL AND t.status IN ('todo', 'in_progress', 'blocked')
    ) h
    JOIN public.users u ON u.id = h.user_id
  ON CONFLICT (task_id, user_id) DO UPDATE SET seen_at = GREATEST(public.task_reads.seen_at, EXCLUDED.seen_at);
END;
$$;

COMMENT ON COLUMN public.tasks.routed_at IS
  'When the task last reached its holders (created, assignee / team changed, or back to work from completed / cancelled / draft). A holder with no task_reads row, or one older than this, sees the task as unread.';

CREATE OR REPLACE FUNCTION public.tasks_set_routed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.routed_at := now();
    RETURN NEW;
  END IF;
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
     OR NEW.assigned_team_id IS DISTINCT FROM OLD.assigned_team_id
     OR (OLD.status IN ('completed', 'cancelled', 'draft') AND NEW.status IN ('todo', 'in_progress', 'blocked')) THEN
    NEW.routed_at := now();
  ELSE
    NEW.routed_at := OLD.routed_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_routed_at ON public.tasks;
CREATE TRIGGER trg_tasks_routed_at
  BEFORE INSERT OR UPDATE OF assignee_id, assigned_team_id, status, routed_at ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_set_routed_at();

/* ── 4. The rule ─────────────────────────────────────────────────────── */

CREATE OR REPLACE FUNCTION public.task_unread_ids(p_user_id uuid, p_tenant_id uuid DEFAULT NULL, p_task_ids uuid[] DEFAULT NULL)
  RETURNS TABLE (task_id uuid)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_teams uuid[];
BEGIN
  IF p_user_id IS NULL OR (v_caller IS NOT NULL AND v_caller <> p_user_id) THEN RETURN; END IF;
  -- My teams (user_teams, plus the legacy users.team_id).
  SELECT coalesce(array_agg(DISTINCT x.team_id), '{}') INTO v_teams FROM (
    SELECT ut.team_id FROM public.user_teams ut WHERE ut.user_id = p_user_id
    UNION ALL
    SELECT u.team_id FROM public.users u WHERE u.id = p_user_id AND u.team_id IS NOT NULL
  ) x;

  IF p_task_ids IS NOT NULL THEN
    -- One list page: the given tasks by primary key, each checked against the rule.
    RETURN QUERY
      SELECT t.id
        FROM public.tasks t
        LEFT JOIN public.task_reads r ON r.task_id = t.id AND r.user_id = p_user_id
       WHERE t.id = ANY (p_task_ids)
         AND t.status IN ('todo', 'in_progress', 'blocked') AND t.deleted_at IS NULL
         AND (p_tenant_id IS NULL OR t.tenant_id = p_tenant_id)
         AND (
           SELECT max(h.since) FROM (
             SELECT t.routed_at AS since WHERE t.assignee_id = p_user_id
             UNION ALL
             SELECT t.routed_at WHERE t.assignee_id IS NULL AND t.assigned_team_id = ANY (v_teams)
             UNION ALL
             SELECT GREATEST(t.routed_at, a.created_at)
               FROM public.task_assignees a
              WHERE a.task_id = t.id AND a.user_id = p_user_id AND a.acceptance_status <> 'declined'
           ) h
         ) > coalesce(r.seen_at, '-infinity'::timestamptz);
    RETURN;
  END IF;

  -- Everything I hold (counts, Mark all as read): three indexed branches.
  RETURN QUERY
    WITH held AS (
      SELECT t.id, t.routed_at AS since
        FROM public.tasks t
       WHERE t.assignee_id = p_user_id
         AND t.status IN ('todo', 'in_progress', 'blocked') AND t.deleted_at IS NULL
         AND (p_tenant_id IS NULL OR t.tenant_id = p_tenant_id)
      UNION ALL
      SELECT t.id, t.routed_at
        FROM public.tasks t
       WHERE t.assignee_id IS NULL AND t.assigned_team_id = ANY (v_teams)
         AND t.status IN ('todo', 'in_progress', 'blocked') AND t.deleted_at IS NULL
         AND (p_tenant_id IS NULL OR t.tenant_id = p_tenant_id)
      UNION ALL
      SELECT t.id, GREATEST(t.routed_at, a.created_at)
        FROM public.task_assignees a
        JOIN public.tasks t ON t.id = a.task_id
       WHERE a.user_id = p_user_id AND a.acceptance_status <> 'declined'
         AND t.status IN ('todo', 'in_progress', 'blocked') AND t.deleted_at IS NULL
         AND (p_tenant_id IS NULL OR t.tenant_id = p_tenant_id)
    ),
    latest AS (
      SELECT held.id, max(held.since) AS since FROM held GROUP BY held.id
    )
    SELECT l.id
      FROM latest l
      LEFT JOIN public.task_reads r ON r.task_id = l.id AND r.user_id = p_user_id
     WHERE r.seen_at IS NULL OR r.seen_at < l.since;
END;
$$;

COMMENT ON FUNCTION public.task_unread_ids(uuid, uuid, uuid[]) IS
  'Which of p_task_ids (NULL: all) are unread for p_user_id: open, held by them (assignee, collaborator / claim candidate, member of the team of an unassigned team task), and no task_reads row or seen_at < routed_at (collaborator: or when added). p_tenant_id NULL = every workspace. End users can only ask about themselves.';

REVOKE ALL ON FUNCTION public.task_unread_ids(uuid, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_unread_ids(uuid, uuid, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.task_unread_count(p_user_id uuid, p_tenant_id uuid DEFAULT NULL, p_top_level boolean DEFAULT true)
  RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
  SELECT count(*)::integer
    FROM public.task_unread_ids(p_user_id, p_tenant_id, NULL) u
    JOIN public.tasks t ON t.id = u.task_id
   WHERE NOT p_top_level OR t.parent_task_id IS NULL
$$;

COMMENT ON FUNCTION public.task_unread_count(uuid, uuid, boolean) IS
  'How many tasks are unread for p_user_id (task_unread_ids); p_top_level (default) counts only top-level tasks, as My tasks lists them.';

REVOKE ALL ON FUNCTION public.task_unread_count(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_unread_count(uuid, uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_tasks_read(p_user_id uuid, p_tenant_id uuid DEFAULT NULL, p_task_ids uuid[] DEFAULT NULL)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR (v_caller IS NOT NULL AND v_caller <> p_user_id) THEN RETURN 0; END IF;
  INSERT INTO public.task_reads (task_id, user_id, tenant_id, seen_at)
  SELECT t.id, p_user_id, t.tenant_id, now()
    FROM public.task_unread_ids(p_user_id, p_tenant_id, p_task_ids) u
    JOIN public.tasks t ON t.id = u.task_id
  ON CONFLICT (task_id, user_id) DO UPDATE SET seen_at = EXCLUDED.seen_at;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.mark_tasks_read(uuid, uuid, uuid[]) IS
  'Mark as read (seen_at = now()) the tasks of p_task_ids (NULL: all) that are unread for p_user_id; returns how many. End users can only write for themselves.';

REVOKE ALL ON FUNCTION public.mark_tasks_read(uuid, uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_tasks_read(uuid, uuid, uuid[]) TO authenticated, service_role;

/* ── 5. nav_task_counts + unread ─────────────────────────────────────── */

CREATE OR REPLACE FUNCTION public.nav_task_counts(p_tenant_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH guard AS (
    SELECT (p_tenant_id IS NOT NULL AND p_user_id IS NOT NULL AND (auth.uid() IS NULL OR auth.uid() = p_user_id)) AS ok
  ),
  teams AS (
    SELECT ut.team_id FROM public.user_teams ut JOIN public.teams tm ON tm.id = ut.team_id AND tm.tenant_id = p_tenant_id
     WHERE ut.user_id = p_user_id
  )
  SELECT jsonb_build_object(
    -- = home_task_metrics.open
    'my_tasks', (SELECT count(*) FROM public.tasks t, guard
        WHERE guard.ok AND t.tenant_id = p_tenant_id AND t.assignee_id = p_user_id
          AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
          AND t.status NOT IN ('completed', 'cancelled', 'draft')
          AND t.acceptance_status <> 'pending'),
    -- = home_task_metrics.queue
    'queue', (SELECT count(*) FROM public.tasks t, guard
        WHERE guard.ok AND t.tenant_id = p_tenant_id AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
          AND (
            (t.assignee_id = p_user_id AND t.acceptance_status = 'pending' AND t.status NOT IN ('completed', 'cancelled'))
            OR (t.assignee_id IS NULL AND t.assigned_team_id IN (SELECT team_id FROM teams) AND t.status IN ('todo', 'in_progress'))
          )),
    -- Task Tracker's default view (Assigned by me), open only.
    'tracker', (SELECT count(*) FROM public.tasks t, guard
        WHERE guard.ok AND t.tenant_id = p_tenant_id AND t.assigner_id = p_user_id
          AND t.assignee_id IS NOT NULL AND t.assignee_id <> p_user_id
          AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
          AND t.status NOT IN ('completed', 'cancelled', 'draft')),
    -- Unread top-level tasks I hold (task_unread_ids), next to My tasks.
    'unread', (SELECT CASE WHEN guard.ok THEN public.task_unread_count(p_user_id, p_tenant_id, true) ELSE 0 END FROM guard)
  )
$$;

COMMENT ON FUNCTION public.nav_task_counts(uuid, uuid) IS
  'Side menu badges: my_tasks (= home_task_metrics.open), queue (= home_task_metrics.queue), tracker (open tasks I assigned to others), unread (unread top-level tasks I hold).';

REVOKE ALL ON FUNCTION public.nav_task_counts(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nav_task_counts(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.nav_task_counts(uuid, uuid) TO authenticated, service_role;
