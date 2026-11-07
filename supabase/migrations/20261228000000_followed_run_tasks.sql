-- ============================================================================
-- 20261228000000_followed_run_tasks.sql
--
-- Task tracker → Following shows, besides the tasks a person follows, the
-- tasks of the workflow runs they follow (run_followers — runs they started,
-- or acted on: lib/services/task-actions autoFollowActedRun), so they can
-- watch a request move through its later steps.
--
-- public.list_followed_run_tasks(p_user_id, p_tenant_id, p_include_closed):
-- the (not deleted) tasks of runs p_user_id follows, only for runs they may
-- still see (can_view_run_progress — the Process view rule: started it,
-- their submission started it, they have a task in it, or workflows.view_runs),
-- in their member workspaces (p_tenant_id NULL = every one). Without
-- p_include_closed: open tasks of runs still in progress only. Newest first,
-- at most 500. A signed-in caller can only ask about themselves.
--
-- Additive and idempotent. Until it is applied the Following tab lists the
-- directly followed tasks only (the service falls back quietly).
-- ============================================================================

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.list_followed_run_tasks(p_user_id uuid, p_tenant_id uuid DEFAULT NULL, p_include_closed boolean DEFAULT false)
  RETURNS TABLE (task_id uuid, tenant_id uuid, run_id uuid, status text, run_status text, workflow_id uuid, followed_at timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF p_user_id IS NULL OR (v_caller IS NOT NULL AND v_caller <> p_user_id) THEN RETURN; END IF;
  RETURN QUERY
    SELECT t.id, t.tenant_id, r.id, t.status::text, r.status::text, r.workflow_id, f.created_at
      FROM public.run_followers f
      JOIN public.workflow_runs r ON r.id = f.run_id AND r.tenant_id = f.tenant_id
      JOIN public.tasks t ON t.workflow_run_id = r.id AND t.tenant_id = r.tenant_id AND t.deleted_at IS NULL
     WHERE f.user_id = p_user_id
       AND (p_tenant_id IS NULL OR f.tenant_id = p_tenant_id)
       AND (p_include_closed OR (
             t.status::text NOT IN ('completed', 'cancelled')
             AND r.status::text IN ('running', 'waiting_for_event', 'paused', 'pending', 'queued')))
       AND public.can_view_run_progress(r.id, p_user_id)
     ORDER BY t.created_at DESC
     LIMIT 500;
END;
$$;

COMMENT ON FUNCTION public.list_followed_run_tasks(uuid, uuid, boolean) IS
  'Task tracker → Following: tasks of the runs p_user_id follows and may still see (can_view_run_progress); open tasks of live runs unless p_include_closed. End users can only ask about themselves.';

REVOKE ALL ON FUNCTION public.list_followed_run_tasks(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_followed_run_tasks(uuid, uuid, boolean) TO authenticated, service_role;

RESET lock_timeout;
