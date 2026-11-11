-- ============================================================================
-- 20270105000000_task_viewers.sql
--
-- Invite (read only): people who can act on a task share it with a person,
-- a team or a role. Everyone the invite names may open the task, its
-- subtasks (include_subtasks), comments, attachments, history and the
-- process view of its run, and comment on it. Nothing else: completing,
-- outcomes, the form, subtasks, reassigning and inviting stay with the people
-- working on it (lib/task-authz.ts; the writes re-check there).
--
-- 1. public.task_viewers (id, tenant_id, task_id, principal_type user / team
--    / role, principal_id, invited_by, include_subtasks, note, auto_followed,
--    created_at); UNIQUE (task_id, principal_type, principal_id); tenant_id
--    always follows the task (trigger). Written by lib/services/task-viewers.ts
--    on the service-role client after its own checks: authenticated callers
--    get SELECT only — rows of tasks they can see, in their visible
--    workspaces (COALESCE(current tenant, member tenants)).
-- 2. public.task_viewer_grant(p_task_id, p_user_id): the invite that lets
--    the person see the task (on the task itself, or on a parent up to five
--    levels with include_subtasks), naming them, a team of the workspace they
--    are in, or a role they hold there; NULL when none. Active members only.
--    A signed-in caller can only ask about themselves.
-- 3. task_view_access (Task tracker → Following, follow bells),
--    task_attachment_access ('view') and can_view_run_progress (the process
--    view) now admit invited viewers. Bodies are the earlier ones plus the
--    viewer branch.
-- 4. public.list_viewer_tasks(p_user_id, p_tenant_id): the tasks shared with
--    the person directly or through a team / role (the tracker's "Shared with
--    me"), not deleted, newest invite first, at most 1000.
-- 5. public.search_visible_tasks(...): the dependency picker's search for
--    people without task oversight — open tasks they can see
--    (task_view_access, invites included), newest first.
--
-- Additive and idempotent. Until it is applied the Invite dialog reports a
-- database error and nothing else changes.
-- ============================================================================

SET lock_timeout = '5s';

/* ── 1. task_viewers ─────────────────────────────────────────────────── */

CREATE TABLE IF NOT EXISTS public.task_viewers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  principal_type text NOT NULL CHECK (principal_type IN ('user', 'team', 'role')),
  principal_id uuid NOT NULL,
  invited_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  include_subtasks boolean NOT NULL DEFAULT true,
  note text CHECK (note IS NULL OR char_length(note) <= 2000),
  -- The invite followed the task for its (user) principal: removing it unfollows.
  auto_followed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_viewers_task_principal_key UNIQUE (task_id, principal_type, principal_id)
);

COMMENT ON TABLE public.task_viewers IS
  'Invite (read only): a person, team or role invited to view a task (and its subtasks). Written by lib/services/task-viewers.ts; authenticated callers read rows of tasks they can see.';

CREATE INDEX IF NOT EXISTS idx_task_viewers_principal ON public.task_viewers (tenant_id, principal_type, principal_id);
CREATE INDEX IF NOT EXISTS idx_task_viewers_task ON public.task_viewers (task_id);

CREATE OR REPLACE FUNCTION public.task_viewers_set_tenant()
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

DROP TRIGGER IF EXISTS trg_task_viewers_tenant ON public.task_viewers;
CREATE TRIGGER trg_task_viewers_tenant
  BEFORE INSERT OR UPDATE OF task_id, tenant_id ON public.task_viewers
  FOR EACH ROW EXECUTE FUNCTION public.task_viewers_set_tenant();

/* ── 2. task_viewer_grant ────────────────────────────────────────────── */

CREATE OR REPLACE FUNCTION public.task_viewer_grant(p_task_id uuid, p_user_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_tenant uuid;
  v_found uuid;
BEGIN
  IF p_task_id IS NULL OR p_user_id IS NULL THEN RETURN NULL; END IF;
  IF v_caller IS NOT NULL AND v_caller <> p_user_id THEN RETURN NULL; END IF;
  SELECT tenant_id INTO v_tenant FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_memberships m WHERE m.user_id = p_user_id AND m.tenant_id = v_tenant AND m.is_active
  ) THEN
    RETURN NULL;
  END IF;

  WITH RECURSIVE up(id, parent, depth) AS (
    SELECT t.id, t.parent_task_id, 0 FROM public.tasks t WHERE t.id = p_task_id AND t.tenant_id = v_tenant
    UNION ALL
    SELECT t.id, t.parent_task_id, up.depth + 1
      FROM up JOIN public.tasks t ON t.id = up.parent AND t.tenant_id = v_tenant AND t.deleted_at IS NULL
     WHERE up.depth < 5
  )
  SELECT v.id INTO v_found
    FROM up
    JOIN public.task_viewers v ON v.task_id = up.id AND v.tenant_id = v_tenant
   WHERE (up.depth = 0 OR v.include_subtasks)
     AND (
       (v.principal_type = 'user' AND v.principal_id = p_user_id)
       OR (v.principal_type = 'team' AND EXISTS (
             SELECT 1 FROM public.user_teams ut JOIN public.teams tm ON tm.id = ut.team_id AND tm.tenant_id = v_tenant
              WHERE ut.team_id = v.principal_id AND ut.user_id = p_user_id))
       OR (v.principal_type = 'role' AND EXISTS (
             SELECT 1 FROM public.user_roles ur
              WHERE ur.role_id = v.principal_id AND ur.user_id = p_user_id AND ur.tenant_id = v_tenant))
     )
   ORDER BY up.depth, (v.principal_type = 'user') DESC, v.created_at
   LIMIT 1;
  RETURN v_found;
END;
$$;

COMMENT ON FUNCTION public.task_viewer_grant(uuid, uuid) IS
  'Invite (read only): the task_viewers row that lets p_user_id view p_task_id (on the task, or a parent with include_subtasks; naming them, a team they are in or a role they hold), NULL when none. Active members only; end users can only ask about themselves.';

REVOKE ALL ON FUNCTION public.task_viewer_grant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_viewer_grant(uuid, uuid) TO authenticated, service_role;

/* RLS: read rows of tasks you can see; no end-user writes. */
ALTER TABLE public.task_viewers ENABLE ROW LEVEL SECURITY;

/* ── 3a. task_view_access (+ invited viewers) ────────────────────────── */

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
  -- Invited to view it (20270105000000): directly, through a team or a role.
  IF public.task_viewer_grant(t.id, p_user_id) IS NOT NULL THEN RETURN true; END IF;

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
  'May p_user_id see task p_task_id (active member and assignee, collaborator, team member of an unassigned team task, invited viewer, manager of an assignee, assigner, tasks.view_all or tasks.manage_queue)? End users can only ask about themselves.';

REVOKE ALL ON FUNCTION public.task_view_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_view_access(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS task_viewers_select ON public.task_viewers;
CREATE POLICY task_viewers_select ON public.task_viewers FOR SELECT TO authenticated
  USING (
    tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[])
    AND public.task_view_access(task_id, (SELECT auth.uid()))
  );

REVOKE ALL ON public.task_viewers FROM anon, authenticated;
GRANT SELECT ON public.task_viewers TO authenticated;
GRANT ALL ON public.task_viewers TO service_role;

/* ── 3b. task_attachment_access (+ invited viewers: 'view') ──────────── */

CREATE OR REPLACE FUNCTION public.task_attachment_access(p_task_id uuid)
  RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_uid uuid := auth.uid();
  t record;
  v_perms text[];
  v_assignee boolean;
  v_team boolean := false;
  v_manager boolean := false;
BEGIN
  IF v_uid IS NULL OR p_task_id IS NULL THEN RETURN 'none'; END IF;
  SELECT id, tenant_id, assignee_id, assigner_id, assigned_team_id, status, is_workflow_task
    INTO t FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN 'none'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_memberships m WHERE m.user_id = v_uid AND m.tenant_id = t.tenant_id AND m.is_active) THEN
    RETURN 'none';
  END IF;
  v_perms := public.get_user_permissions(t.tenant_id);
  v_assignee := t.assignee_id = v_uid
    OR EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = t.id AND a.tenant_id = t.tenant_id AND a.user_id = v_uid);
  IF NOT v_assignee AND t.assigned_team_id IS NOT NULL AND t.assignee_id IS NULL THEN
    v_team := EXISTS (SELECT 1 FROM public.user_teams ut WHERE ut.team_id = t.assigned_team_id AND ut.user_id = v_uid);
  END IF;
  IF NOT v_assignee AND NOT v_team THEN
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
    SELECT EXISTS (SELECT 1 FROM chain WHERE user_id = v_uid AND depth > 0) INTO v_manager;
  END IF;

  IF t.status NOT IN ('completed', 'cancelled') AND 'tasks.complete' = ANY (v_perms) AND (
       v_assignee OR v_team OR v_manager OR 'tasks.complete_any' = ANY (v_perms)
       OR (NOT COALESCE(t.is_workflow_task, false) AND 'tasks.manage_queue' = ANY (v_perms))
     ) THEN
    RETURN 'work';
  END IF;
  IF v_assignee OR v_team OR v_manager OR t.assigner_id = v_uid
     OR 'tasks.view_all' = ANY (v_perms) OR 'tasks.manage_queue' = ANY (v_perms) THEN
    RETURN 'view';
  END IF;
  -- Invited viewers read the files (20270105000000); they never add them.
  IF public.task_viewer_grant(t.id, v_uid) IS NOT NULL THEN RETURN 'view'; END IF;
  RETURN 'none';
END;
$$;

REVOKE ALL ON FUNCTION public.task_attachment_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_attachment_access(uuid) TO authenticated, service_role;

/* ── 3c. can_view_run_progress (+ viewers of a task in the run) ──────── */

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
            -- Invited to view one of its tasks (20270105000000).
            OR EXISTS (
              SELECT 1 FROM public.tasks t
               WHERE t.workflow_run_id = r.id AND t.tenant_id = r.tenant_id AND t.deleted_at IS NULL
                 AND EXISTS (SELECT 1 FROM public.task_viewers v WHERE v.task_id = t.id)
                 AND public.task_viewer_grant(t.id, p_user_id) IS NOT NULL
            )
          )
     )
$$;

COMMENT ON FUNCTION public.can_view_run_progress(uuid, uuid) IS
  'Home: may the person see this run''s progress (started it, their form submission started it, they have a task in it, they are invited to view one of its tasks, or workflows.view_runs). Members of the run''s workspace only.';

REVOKE ALL ON FUNCTION public.can_view_run_progress(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_run_progress(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_view_run_progress(uuid, uuid) TO authenticated, service_role;

/* ── 4. list_viewer_tasks ────────────────────────────────────────────── */

CREATE OR REPLACE FUNCTION public.list_viewer_tasks(p_user_id uuid, p_tenant_id uuid DEFAULT NULL)
  RETURNS TABLE (task_id uuid, tenant_id uuid, status text, viewer_id uuid, principal_type text, principal_id uuid, invited_by uuid, shared_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF p_user_id IS NULL OR (v_caller IS NOT NULL AND v_caller <> p_user_id) THEN RETURN; END IF;
  RETURN QUERY
    SELECT DISTINCT ON (v.task_id) v.task_id, v.tenant_id, t.status::text, v.id, v.principal_type, v.principal_id, v.invited_by, v.created_at
      FROM public.task_viewers v
      JOIN public.tasks t ON t.id = v.task_id AND t.tenant_id = v.tenant_id AND t.deleted_at IS NULL
      JOIN public.user_memberships m ON m.user_id = p_user_id AND m.tenant_id = v.tenant_id AND m.is_active
     WHERE (p_tenant_id IS NULL OR v.tenant_id = p_tenant_id)
       AND (
         (v.principal_type = 'user' AND v.principal_id = p_user_id)
         OR (v.principal_type = 'team' AND EXISTS (
               SELECT 1 FROM public.user_teams ut JOIN public.teams tm ON tm.id = ut.team_id AND tm.tenant_id = v.tenant_id
                WHERE ut.team_id = v.principal_id AND ut.user_id = p_user_id))
         OR (v.principal_type = 'role' AND EXISTS (
               SELECT 1 FROM public.user_roles ur
                WHERE ur.role_id = v.principal_id AND ur.user_id = p_user_id AND ur.tenant_id = v.tenant_id))
       )
     ORDER BY v.task_id, (v.principal_type = 'user') DESC, v.created_at DESC
     LIMIT 1000;
END;
$$;

COMMENT ON FUNCTION public.list_viewer_tasks(uuid, uuid) IS
  'Task tracker → Shared with me: tasks (not deleted) shared with p_user_id directly, through a team they are in or a role they hold, in active member workspaces (p_tenant_id NULL = every one). End users can only ask about themselves.';

REVOKE ALL ON FUNCTION public.list_viewer_tasks(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_viewer_tasks(uuid, uuid) TO authenticated, service_role;

/* ── 5. search_visible_tasks (dependency picker) ─────────────────────── */

CREATE OR REPLACE FUNCTION public.search_visible_tasks(
  p_user_id uuid,
  p_tenant_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_exclude uuid DEFAULT NULL,
  p_limit integer DEFAULT 8
)
  RETURNS TABLE (id uuid, title text, status text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_pattern text;
BEGIN
  IF p_user_id IS NULL OR (v_caller IS NOT NULL AND v_caller <> p_user_id) THEN RETURN; END IF;
  v_pattern := CASE WHEN coalesce(btrim(p_search), '') = '' THEN NULL
    ELSE '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' END;
  RETURN QUERY
    SELECT c.id, c.title, c.status
      FROM (
        SELECT t.id, t.title::text AS title, t.status::text AS status, t.created_at
          FROM public.tasks t
          JOIN public.user_memberships m ON m.user_id = p_user_id AND m.tenant_id = t.tenant_id AND m.is_active
         WHERE t.deleted_at IS NULL
           AND t.status::text NOT IN ('completed', 'cancelled')
           AND (p_tenant_id IS NULL OR t.tenant_id = p_tenant_id)
           AND (p_exclude IS NULL OR t.id <> p_exclude)
           AND (v_pattern IS NULL OR t.title ILIKE v_pattern)
         ORDER BY t.created_at DESC
         LIMIT 2000
      ) c
     WHERE public.task_view_access(c.id, p_user_id)
     ORDER BY c.created_at DESC
     LIMIT least(greatest(coalesce(p_limit, 8), 1), 50);
END;
$$;

COMMENT ON FUNCTION public.search_visible_tasks(uuid, uuid, text, uuid, integer) IS
  'Dependency picker: open tasks p_user_id can see (task_view_access — invites included) whose title contains p_search, newest first (scans the newest 2000 matches). End users can only ask about themselves.';

REVOKE ALL ON FUNCTION public.search_visible_tasks(uuid, uuid, text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_visible_tasks(uuid, uuid, text, uuid, integer) TO authenticated, service_role;

RESET lock_timeout;
