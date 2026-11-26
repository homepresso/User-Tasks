-- Security fixes from the 2026-11-24 QA pass. Idempotent; replaces three
-- function bodies and tightens EXECUTE grants. No table changes.
--
-- 1. A deactivated member kept tenant-wide RLS access to their HOME workspace:
--    get_user_tenant_ids() returned users.tenant_id / current_tenant_id even
--    when the membership for that tenant was inactive, and
--    get_current_tenant_id() returned it too (it backs every
--    `tenant_id = get_current_tenant_id()` policy). Users provisioned straight
--    into an organisation (SSO / directory: provision_auth_user_in) have that
--    organisation as their home, so directory deprovisioning (is_active =
--    false, roles deleted) left them reading and writing its tasks etc.
--    Legacy accounts without any membership row for their home tenant are
--    unchanged; only an explicit inactive membership excludes the tenant.
--
-- 2. add_task_dependency compared `v_tenant <> get_current_tenant_id()`; for
--    anon (and any caller without a users row) the right side is NULL, the
--    comparison is NULL and the guard was skipped — an unauthenticated caller
--    with the public anon key could add dependency edges between any
--    workspace's tasks. Now IS DISTINCT FROM, and anon loses EXECUTE.
--
-- 3. SECURITY DEFINER RPCs that only make sense for a signed-in user are no
--    longer executable by anon (none is used in an RLS policy). RLS helper
--    functions keep their grants: policies evaluated for anon call them.

CREATE OR REPLACE FUNCTION public.get_user_tenant_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
      SELECT tenant_id FROM public.user_memberships
        WHERE user_id = auth.uid() AND is_active
      UNION
      SELECT u.tenant_id FROM public.users u
        WHERE u.id = auth.uid() AND u.tenant_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.user_memberships m
                           WHERE m.user_id = u.id AND m.tenant_id = u.tenant_id AND NOT m.is_active)
      UNION
      SELECT u.current_tenant_id FROM public.users u
        WHERE u.id = auth.uid() AND u.current_tenant_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.user_memberships m
                           WHERE m.user_id = u.id AND m.tenant_id = u.current_tenant_id AND NOT m.is_active)
    $function$;

CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
      SELECT c.id
        FROM (SELECT COALESCE(u.current_tenant_id, u.tenant_id)::uuid AS id, u.id AS user_id
                FROM public.users u WHERE u.id = auth.uid()) c
       WHERE NOT EXISTS (SELECT 1 FROM public.user_memberships m
                          WHERE m.user_id = c.user_id AND m.tenant_id = c.id AND NOT m.is_active)
    $function$;

CREATE OR REPLACE FUNCTION public.add_task_dependency(p_task uuid, p_depends_on uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_cycle boolean;
  v_id uuid;
BEGIN
  IF p_task = p_depends_on THEN
    RAISE EXCEPTION 'dependency_cycle';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.tasks WHERE id = p_task;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'task_not_found';
  END IF;
  -- IS DISTINCT FROM: a caller without a workspace (anon, no users row) gets
  -- NULL here and must be refused, not waved through.
  IF NOT public.is_trusted_db_caller() AND v_tenant IS DISTINCT FROM public.get_current_tenant_id() THEN
    RAISE EXCEPTION 'task_not_found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks WHERE id = p_depends_on AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'task_not_found';
  END IF;

  -- Serialize concurrent edge inserts per tenant so two simultaneous adds
  -- can't each pass the cycle check and jointly create a loop.
  PERFORM pg_advisory_xact_lock(hashtext('task_deps:' || v_tenant::text));

  WITH RECURSIVE walk(task_id, depth) AS (
    SELECT p_depends_on, 0
    UNION ALL
    SELECT d.depends_on_task_id, w.depth + 1
    FROM public.task_dependencies d
    JOIN walk w ON d.task_id = w.task_id
    WHERE w.depth < 100
  )
  SELECT EXISTS (SELECT 1 FROM walk WHERE task_id = p_task) INTO v_cycle;

  IF v_cycle THEN
    RAISE EXCEPTION 'dependency_cycle';
  END IF;

  INSERT INTO public.task_dependencies (tenant_id, task_id, depends_on_task_id, created_by)
  VALUES (v_tenant, p_task, p_depends_on, auth.uid())
  ON CONFLICT (task_id, depends_on_task_id) DO UPDATE SET task_id = EXCLUDED.task_id
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.add_task_dependency(uuid, uuid)',
    'public.create_task_with_subtasks(text, text, task_priority, timestamp with time zone, uuid, integer, jsonb)',
    'public.get_task_tree(uuid)',
    'public.check_object_permission(text, uuid, text)',
    'public.get_user_role_in_tenant(uuid)',
    'public.mark_notifications_read(uuid[])',
    'public.mark_all_notifications_read()',
    'public.switch_tenant(uuid)'
  ] LOOP
    IF to_regprocedure(f) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', f);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END IF;
  END LOOP;
END $$;
