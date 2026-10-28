-- Log export phase 5a: tenant checks in exposed SECURITY DEFINER functions.
--
-- * enqueue_workflow(workflow, tenant, task, ...) is SECURITY DEFINER and was
--   executable by anon and authenticated with an arbitrary p_tenant_id, so
--   anyone holding the public anon key could queue any tenant's workflow
--   (which the service-role queue processor then runs) or attach another
--   tenant's task to a run. Now:
--     - the workflow must belong to p_tenant_id, and p_task_id (when given)
--       must be a task of p_tenant_id — for every caller;
--     - an end-user caller (PostgREST as anon/authenticated) must be a member
--       of p_tenant_id (get_user_tenant_ids(), the same set the tasks and
--       workflows RLS policies use, so the unified view keeps working);
--     - trusted callers skip the membership check: service_role, direct
--       database sessions without an end-user JWT (is_trusted_db_caller),
--       and triggers
--       (fn_enqueue_task_workflows passes NEW.tenant_id of a row that already
--       passed RLS, or that a SECURITY DEFINER function wrote across tenants);
--     - EXECUTE revoked from PUBLIC/anon. authenticated keeps it: the
--       data-table event trigger path (app/actions/data-store.ts,
--       lib/services/data-tables.ts) calls it with the session client, and
--       fn_enqueue_task_workflows is SECURITY INVOKER, so task writes by
--       signed-in users call it as authenticated.
-- * reassign_task / escalate_task (SECURITY DEFINER, no app callers) updated
--   or logged against any task id without a tenant check: same membership
--   rule, anon revoked.
-- * get_task_tree (SECURITY DEFINER, used by the task detail page) returned
--   any task tree by id: now only for members of the task's tenant, its
--   assignee/assigner, or trusted callers.
-- * check_object_permission interpolated p_permission into dynamic SQL
--   (format('... can_%s ...')) inside a SECURITY DEFINER function executable
--   by anon: now only view/edit/delete/execute are accepted.
--
-- Idempotent: safe to run more than once.

-- ── Trusted caller helper ───────────────────────────────────────────────────
-- True for service_role requests and for direct database sessions (pg_cron,
-- psql, migrations) that carry no anon/authenticated JWT; false for any
-- end-user request through PostgREST (session_user authenticator, or JWT role
-- anon/authenticated). Only the JWT and the login role are consulted, and
-- neither can be changed by an anon/authenticated caller.

CREATE OR REPLACE FUNCTION public.is_trusted_db_caller() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT coalesce(auth.role(), '') = 'service_role'
      OR (session_user::text <> 'authenticator'
          AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated'))
$$;

REVOKE ALL ON FUNCTION public.is_trusted_db_caller() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_trusted_db_caller() TO authenticated, service_role;

-- ── enqueue_workflow ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enqueue_workflow(
  p_workflow_id uuid,
  p_tenant_id uuid,
  p_task_id uuid DEFAULT NULL::uuid,
  p_trigger_type text DEFAULT 'manual'::text,
  p_trigger_data jsonb DEFAULT '{}'::jsonb,
  p_priority integer DEFAULT 0,
  p_delay_seconds integer DEFAULT 0
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_job_id uuid;
  v_trusted boolean;
BEGIN
  IF p_workflow_id IS NULL OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_trusted := pg_trigger_depth() > 0
    OR public.is_trusted_db_caller();

  IF NOT v_trusted AND NOT EXISTS (
    SELECT 1 FROM public.get_user_tenant_ids() AS t(id) WHERE t.id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'not a member of this tenant' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workflows WHERE id = p_workflow_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_task_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tasks WHERE id = p_task_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO workflow_queue (
    workflow_id, tenant_id, task_id, trigger_type, trigger_data, priority, scheduled_for
  ) VALUES (
    p_workflow_id, p_tenant_id, p_task_id, p_trigger_type, p_trigger_data, p_priority,
    now() + (p_delay_seconds || ' seconds')::interval
  ) RETURNING id INTO v_job_id;

  -- Notify listeners that a new job is available
  PERFORM pg_notify('workflow_queue', json_build_object(
    'job_id', v_job_id,
    'workflow_id', p_workflow_id,
    'trigger_type', p_trigger_type
  )::text);

  RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_workflow(uuid, uuid, uuid, text, jsonb, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_workflow(uuid, uuid, uuid, text, jsonb, integer, integer) TO authenticated, service_role;

-- ── reassign_task / escalate_task ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reassign_task(p_task_id uuid, p_new_assignee_id uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.is_trusted_db_caller()
     AND NOT EXISTS (
       SELECT 1 FROM public.tasks
       WHERE id = p_task_id AND tenant_id IN (SELECT public.get_user_tenant_ids())
     ) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE tasks SET assignee_id = p_new_assignee_id WHERE id = p_task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.escalate_task(p_task_id uuid, p_target_user_id uuid, p_notes text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM tasks WHERE id = p_task_id;

  IF v_tenant_id IS NULL OR (
       NOT public.is_trusted_db_caller()
       AND v_tenant_id NOT IN (SELECT public.get_user_tenant_ids())
     ) THEN
    RAISE EXCEPTION 'task_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO lifecycle_events (tenant_id, task_id, event_type, actor_id, metadata)
  VALUES (
    v_tenant_id, p_task_id, 'escalated', auth.uid(),
    jsonb_build_object('target_user', p_target_user_id, 'notes', p_notes)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reassign_task(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_task(uuid, uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.escalate_task(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.escalate_task(uuid, uuid, text) TO authenticated, service_role;

-- ── get_task_tree ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_task_tree(p_task_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH RECURSIVE task_tree AS (
    SELECT t.*, 0 as depth
    FROM tasks t
    WHERE t.id = p_task_id AND t.deleted_at IS NULL
      AND (
        public.is_trusted_db_caller()
        OR t.tenant_id IN (SELECT public.get_user_tenant_ids())
        OR t.assignee_id = auth.uid()
        OR t.assigner_id = auth.uid()
      )
    UNION ALL
    SELECT t.*, tt.depth + 1
    FROM tasks t
    JOIN task_tree tt ON t.parent_task_id = tt.id
    WHERE t.deleted_at IS NULL
  )
  SELECT jsonb_build_object(
    'task', (SELECT row_to_json(t)::jsonb FROM task_tree t WHERE depth = 0),
    'subtasks', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.sequence, t.created_at), '[]'::jsonb)
      FROM task_tree t WHERE depth > 0
    ),
    'total_count', (SELECT COUNT(*) FROM task_tree),
    'completed_count', (SELECT COUNT(*) FROM task_tree WHERE status = 'completed')
  );
$$;

-- ── check_object_permission ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_object_permission(p_object_type text, p_object_id uuid, p_permission text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_has_any_grants boolean;
  v_has_permission boolean;
BEGIN
  -- p_permission picks a can_<permission> column in dynamic SQL below.
  IF p_permission IS NULL OR p_permission NOT IN ('view', 'edit', 'delete', 'execute') THEN
    RAISE EXCEPTION 'invalid permission: %', p_permission USING ERRCODE = '22023';
  END IF;

  v_user_id := auth.uid();
  SELECT COALESCE(current_tenant_id, tenant_id) INTO v_tenant_id FROM users WHERE id = v_user_id;

  SELECT EXISTS(
    SELECT 1 FROM object_permissions
    WHERE tenant_id = v_tenant_id AND object_type = p_object_type AND object_id = p_object_id
  ) INTO v_has_any_grants;

  IF NOT v_has_any_grants THEN
    RETURN true;
  END IF;

  EXECUTE format(
    'SELECT EXISTS(SELECT 1 FROM object_permissions WHERE tenant_id = $1 AND object_type = $2 AND object_id = $3 AND user_id = $4 AND %I = true)',
    'can_' || p_permission
  ) INTO v_has_permission USING v_tenant_id, p_object_type, p_object_id, v_user_id;

  IF v_has_permission THEN RETURN true; END IF;

  EXECUTE format(
    'SELECT EXISTS(
      SELECT 1 FROM object_permissions op
      JOIN user_roles ur ON ur.role_id = op.role_id AND ur.tenant_id = op.tenant_id
      WHERE op.tenant_id = $1 AND op.object_type = $2 AND op.object_id = $3 AND ur.user_id = $4 AND op.%I = true
    )',
    'can_' || p_permission
  ) INTO v_has_permission USING v_tenant_id, p_object_type, p_object_id, v_user_id;

  RETURN v_has_permission;
END;
$_$;
