-- ============================================================================
-- 20261226000000_task_followers.sql
--
-- Task tracker → Following: tasks a person follows (the bell on each tracker
-- row and on the task page). Mirrors run_followers (Home → Following, runs).
--
-- 1. public.task_view_access(p_task_id, p_user_id): may this person see the
--    task? Active member of its workspace AND (assignee, collaborator, member
--    of the assigned team of an unassigned task, a manager of an assignee —
--    up to 10 levels — the assigner, tasks.view_all or tasks.manage_queue).
--    The same "view" rule as task_attachment_access. A signed-in caller can
--    only ask about themselves (another person's id answers false); the
--    service role asks for anyone.
-- 2. public.task_followers (tenant_id, user_id, task_id, created_at):
--    PRIMARY KEY (user_id, task_id); tenant_id always follows the task
--    (trigger). RLS: a person reads and deletes their own rows in their member
--    workspaces; INSERT only for a task they can see (task_view_access); no
--    UPDATE grant. Deleting the task (hard) removes its follows (FK cascade);
--    soft-deleted tasks drop out of the lists (they are filtered out).
-- 3. public.list_followed_tasks(p_user_id, p_tenant_id): the follows whose
--    task is not deleted and is still visible to the person (re-checked on
--    every read, so a task they lost access to disappears without leaking),
--    newest follow first, at most 1000. p_tenant_id NULL = every member
--    workspace (the unified view).
--
-- Additive and idempotent. Until it is applied the tracker's Following tab
-- and the follow buttons report a database error; nothing else changes.
-- ============================================================================

SET lock_timeout = '5s';

/* ── 1. task_view_access ─────────────────────────────────────────────── */

CREATE OR REPLACE FUNCTION public.task_view_access(p_task_id uuid, p_user_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_caller uuid := auth.uid();
  t record;
  v_perms text[];
  v_found boolean;
BEGIN
  IF p_task_id IS NULL OR p_user_id IS NULL THEN RETURN false; END IF;
  -- End users may only ask about themselves.
  IF v_caller IS NOT NULL AND v_caller <> p_user_id THEN RETURN false; END IF;

  SELECT id, tenant_id, assignee_id, assigner_id, assigned_team_id
    INTO t FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_memberships m
     WHERE m.user_id = p_user_id AND m.tenant_id = t.tenant_id AND m.is_active
  ) THEN
    RETURN false;
  END IF;

  IF t.assignee_id = p_user_id OR t.assigner_id = p_user_id THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = t.id AND a.tenant_id = t.tenant_id AND a.user_id = p_user_id) THEN
    RETURN true;
  END IF;
  IF t.assigned_team_id IS NOT NULL AND t.assignee_id IS NULL
     AND EXISTS (SELECT 1 FROM public.user_teams ut WHERE ut.team_id = t.assigned_team_id AND ut.user_id = p_user_id) THEN
    RETURN true;
  END IF;

  SELECT coalesce(array_agg(DISTINCT perm), '{}') INTO v_perms
    FROM public.user_roles ur
    JOIN public.roles ro ON ro.id = ur.role_id AND ro.tenant_id = ur.tenant_id
    CROSS JOIN LATERAL unnest(ro.permissions) AS perm
   WHERE ur.user_id = p_user_id AND ur.tenant_id = t.tenant_id;
  IF 'tasks.view_all' = ANY (v_perms) OR 'tasks.manage_queue' = ANY (v_perms) THEN RETURN true; END IF;

  -- A manager (up to 10 levels) of an assignee or collaborator.
  WITH RECURSIVE chain(user_id, depth) AS (
    SELECT x.user_id, 0 FROM (
      SELECT t.assignee_id AS user_id WHERE t.assignee_id IS NOT NULL
      UNION SELECT a.user_id FROM public.task_assignees a WHERE a.task_id = t.id AND a.tenant_id = t.tenant_id
    ) x
    UNION
    SELECT m.manager_user_id, c.depth + 1
      FROM chain c
      JOIN public.user_memberships m ON m.user_id = c.user_id AND m.tenant_id = t.tenant_id AND m.is_active
     WHERE c.depth < 10 AND m.manager_user_id IS NOT NULL
  )
  SELECT EXISTS (SELECT 1 FROM chain WHERE user_id = p_user_id AND depth > 0) INTO v_found;
  RETURN coalesce(v_found, false);
END;
$$;

COMMENT ON FUNCTION public.task_view_access(uuid, uuid) IS
  'May p_user_id see task p_task_id (active member and assignee, collaborator, team member of an unassigned team task, manager of an assignee, assigner, tasks.view_all or tasks.manage_queue)? End users can only ask about themselves.';

REVOKE ALL ON FUNCTION public.task_view_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_view_access(uuid, uuid) TO authenticated, service_role;

/* ── 2. task_followers ───────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.task_followers (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, task_id)
);

COMMENT ON TABLE public.task_followers IS
  'Tasks a person follows (Task tracker → Following). Written by lib/services/task-follows.ts; RLS mirrors its rules for direct access.';

CREATE INDEX IF NOT EXISTS idx_task_followers_user ON public.task_followers (tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_followers_task ON public.task_followers (task_id);

-- tenant_id is always the task's.
CREATE OR REPLACE FUNCTION public.task_followers_set_tenant()
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

DROP TRIGGER IF EXISTS trg_task_followers_tenant ON public.task_followers;
CREATE TRIGGER trg_task_followers_tenant
  BEFORE INSERT OR UPDATE OF task_id, tenant_id ON public.task_followers
  FOR EACH ROW EXECUTE FUNCTION public.task_followers_set_tenant();

ALTER TABLE public.task_followers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_followers_select ON public.task_followers;
CREATE POLICY task_followers_select ON public.task_followers FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

DROP POLICY IF EXISTS task_followers_insert ON public.task_followers;
CREATE POLICY task_followers_insert ON public.task_followers FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
    AND public.task_view_access(task_id, (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS task_followers_delete ON public.task_followers;
CREATE POLICY task_followers_delete ON public.task_followers FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

REVOKE ALL ON public.task_followers FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.task_followers TO authenticated;
GRANT ALL ON public.task_followers TO service_role;

/* ── 3. list_followed_tasks ──────────────────────────────────────────── */

CREATE OR REPLACE FUNCTION public.list_followed_tasks(p_user_id uuid, p_tenant_id uuid DEFAULT NULL)
  RETURNS TABLE (task_id uuid, tenant_id uuid, status text, followed_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF p_user_id IS NULL OR (v_caller IS NOT NULL AND v_caller <> p_user_id) THEN RETURN; END IF;
  RETURN QUERY
    SELECT f.task_id, f.tenant_id, t.status::text, f.created_at
      FROM public.task_followers f
      JOIN public.tasks t ON t.id = f.task_id AND t.tenant_id = f.tenant_id AND t.deleted_at IS NULL
     WHERE f.user_id = p_user_id
       AND (p_tenant_id IS NULL OR f.tenant_id = p_tenant_id)
       AND public.task_view_access(f.task_id, p_user_id)
     ORDER BY f.created_at DESC
     LIMIT 1000;
END;
$$;

COMMENT ON FUNCTION public.list_followed_tasks(uuid, uuid) IS
  'Task tracker → Following: the person''s follows whose task is not deleted and still visible to them (task_view_access), newest first, at most 1000. p_tenant_id NULL = every member workspace.';

REVOKE ALL ON FUNCTION public.list_followed_tasks(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_followed_tasks(uuid, uuid) TO authenticated, service_role;
