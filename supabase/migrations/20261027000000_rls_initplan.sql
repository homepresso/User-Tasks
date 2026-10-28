-- Perf phase 3: RLS policies evaluated once per statement, not once per row.
--
-- Every public policy is recreated with identical semantics (checked by
-- __tests__/rls-semantics-db.test.ts, a caller × table × command snapshot
-- recorded before this migration), except where noted:
--
-- * Function calls are wrapped as initplans — (SELECT public.get_current_tenant_id()),
--   (SELECT auth.uid()) — so Postgres evaluates them once per statement. The
--   per-row calls cost ~2 function calls per scanned row (tasks list as a
--   member: 1.5 s on 70k rows).
-- * `tenant_id IN (SELECT get_user_tenant_ids())` becomes
--   `tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])` and the
--   tasks/teams/users/… `CASE WHEN get_current_tenant_id() IS NOT NULL THEN …
--   ELSE … END` becomes `tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[])`:
--   the same sets, but as an index-usable array comparison. (The ::uuid[]
--   cast is what makes ANY take the initplan's array: `ANY ((SELECT …))`
--   alone parses as ANY (subquery).)
-- * `tenant_id IN (SELECT COALESCE(current_tenant_id, tenant_id) FROM users
--   WHERE id = auth.uid())` is `tenant_id = (SELECT get_current_tenant_id())`:
--   users.id is the primary key and users_select always shows the caller's
--   own row, so the subquery yields exactly get_current_tenant_id().
-- * Redundant permissive policies (OR-ed with a policy that already allows
--   every row they allow, for every command they cover) are dropped:
--     agents, api_keys, custom_table_rows, integrations, tenant_connectors:
--       tenant_isolation (ALL, tenant = current tenant) — each command has its
--       own policy over a superset (all member tenants, or {home, current}).
--     mcp_servers.mcp_servers_select, roles.roles_select,
--     user_roles.user_roles_select: same USING as the table's ALL policy.
--   agent_queue / agent_runs keep tenant_isolation only for the commands no
--   other policy covers (agent_queue: UPDATE, DELETE; agent_runs: DELETE).
--   integration_call_logs has a single policy (nothing to drop).
-- * Intended changes:
--     workflow_logs.wl_insert was WITH CHECK (true) — any caller, anon
--       included, could insert logs into any tenant. Now member tenants only;
--       the engine writes with the service role (bypasses RLS).
--     user_memberships.membership_select_org read user_memberships inside its
--       own policy, so every end-user read of user_memberships failed with
--       42P17 (infinite recursion) — the org switcher's useMemberships
--       included. It now uses the member-tenant set (active memberships plus
--       home and current tenant) through the SECURITY DEFINER helper.
--
-- Also: SET search_path on the SECURITY DEFINER functions that lacked it, and
-- create_task_with_subtasks only assigns users of the caller's tenant.
--
-- Live: each table's policies change under a short ACCESS EXCLUSIVE lock held
-- until the migration commits (catalog-only, no table rewrite). lock_timeout
-- makes it fail fast behind a long-running query; re-run it if it times out.
-- Idempotent: safe to run more than once.

SET lock_timeout = '5s';

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- get_user_tenant_ids() as an array: the caller's active memberships plus
-- home and current tenant.
CREATE OR REPLACE FUNCTION public.rls_member_tenant_ids()
  RETURNS uuid[]
  LANGUAGE sql STABLE
  SET search_path TO ''
  AS $$ SELECT ARRAY(SELECT public.get_user_tenant_ids()) $$;

-- Tenants visible in lists: the current tenant, or every member tenant when
-- there is none (the unified view) — the old CASE policies' set.
CREATE OR REPLACE FUNCTION public.rls_visible_tenant_ids()
  RETURNS uuid[]
  LANGUAGE sql STABLE
  SET search_path TO ''
  AS $$
    SELECT CASE WHEN c.id IS NOT NULL THEN ARRAY[c.id] ELSE ARRAY(SELECT public.get_user_tenant_ids()) END
      FROM (SELECT public.get_current_tenant_id() AS id) c
  $$;

COMMENT ON FUNCTION public.rls_member_tenant_ids() IS 'RLS helper: get_user_tenant_ids() as uuid[]; use as tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]).';
COMMENT ON FUNCTION public.rls_visible_tenant_ids() IS 'RLS helper: {current tenant}, or all member tenants in the unified view; use as tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[]).';

-- ── Current-tenant tables (tenant_isolation) ────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'custom_workflow_activities', 'decision_tables', 'directory_links', 'directory_sync_runs',
    'email_templates', 'github_deployments', 'github_sync_asset_map', 'github_sync_queue',
    'github_sync_runs', 'github_sync_templates', 'integration_call_logs', 'integration_objects',
    'oauth_authorization_codes', 'oauth_clients', 'oauth_connect_states', 'oauth_tokens',
    'object_audit_log', 'object_permissions', 'retention_policies', 'task_dependencies'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (tenant_id = (SELECT public.get_current_tenant_id())) '
      'WITH CHECK (tenant_id = (SELECT public.get_current_tenant_id()))', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS tenant_isolation ON public.integration_object_sources;
CREATE POLICY tenant_isolation ON public.integration_object_sources
  USING (object_id IN (SELECT o.id FROM public.integration_objects o WHERE o.tenant_id = (SELECT public.get_current_tenant_id())))
  WITH CHECK (object_id IN (SELECT o.id FROM public.integration_objects o WHERE o.tenant_id = (SELECT public.get_current_tenant_id())));

-- ── Member-tenant tables (one policy per command) ───────────────────────────

-- <prefix>_select/_insert/_update/_delete over all member tenants.
DO $$
DECLARE
  r record;
  m constant text := 'tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('api_keys', 'api_keys', 'SIUD'),
    ('custom_table_rows', 'custom_rows', 'SIUD'),
    ('custom_tables', 'custom_tables', 'SIUD'),
    ('integration_endpoints', 'endpoints', 'SIUD'),
    ('integration_references', 'refs', 'SIUD'),
    ('integrations', 'integrations', 'SIUD'),
    ('invitations', 'invitations', 'SIUD'),
    ('node_favorites', 'node_favorites', 'SID'),
    ('workflow_webhooks', 'wh', 'SIUD'),
    ('workflows', 'workflows', 'SIUD'),
    -- list views read through rls_visible_tenant_ids (below)
    ('tasks', 'tasks', 'IUD'),
    ('teams', 'teams', 'IUD'),
    ('task_assignees', 'ta', 'IUD'),
    ('workflow_sources', 'wf', 'IU'),
    ('effort_records', 'effort', 'I'),
    ('lifecycle_events', 'lifecycle', 'I'),
    ('workflow_logs', 'wl', 'ID')
  ) AS v(tbl, prefix, cmds) LOOP
    IF strpos(r.cmds, 'S') > 0 THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.prefix || '_select', r.tbl);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (%s)', r.prefix || '_select', r.tbl, m);
    END IF;
    IF strpos(r.cmds, 'I') > 0 THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.prefix || '_insert', r.tbl);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (%s)', r.prefix || '_insert', r.tbl, m);
    END IF;
    IF strpos(r.cmds, 'U') > 0 THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.prefix || '_update', r.tbl);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (%s)', r.prefix || '_update', r.tbl, m);
    END IF;
    IF strpos(r.cmds, 'D') > 0 THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.prefix || '_delete', r.tbl);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (%s)', r.prefix || '_delete', r.tbl, m);
    END IF;
  END LOOP;
END $$;

-- Subsumed by the per-command member policies above.
DROP POLICY IF EXISTS tenant_isolation ON public.api_keys;
DROP POLICY IF EXISTS tenant_isolation ON public.custom_table_rows;
DROP POLICY IF EXISTS tenant_isolation ON public.integrations;

DROP POLICY IF EXISTS dead_letter_select ON public.dead_letter_events;
CREATE POLICY dead_letter_select ON public.dead_letter_events FOR SELECT
  USING (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

DROP POLICY IF EXISTS queue_select ON public.workflow_queue;
CREATE POLICY queue_select ON public.workflow_queue FOR SELECT
  USING (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

DROP POLICY IF EXISTS workflow_runs_select ON public.workflow_runs;
CREATE POLICY workflow_runs_select ON public.workflow_runs FOR SELECT
  USING (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

DROP POLICY IF EXISTS deletion_queue_tenant_isolation ON public.deletion_queue;
CREATE POLICY deletion_queue_tenant_isolation ON public.deletion_queue TO authenticated
  USING (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]))
  WITH CHECK (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

DROP POLICY IF EXISTS "Tenant isolation for task_escalations" ON public.task_escalations;
CREATE POLICY "Tenant isolation for task_escalations" ON public.task_escalations
  USING (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));
DROP POLICY IF EXISTS "Tenant isolation for task_reminders" ON public.task_reminders;
CREATE POLICY "Tenant isolation for task_reminders" ON public.task_reminders
  USING (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));
DROP POLICY IF EXISTS "Tenant isolation for task_responses" ON public.task_responses;
CREATE POLICY "Tenant isolation for task_responses" ON public.task_responses
  USING (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));
DROP POLICY IF EXISTS "Tenant isolation for workflow_versions" ON public.workflow_versions;
CREATE POLICY "Tenant isolation for workflow_versions" ON public.workflow_versions
  USING (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

-- workflow_logs INSERT was WITH CHECK (true) (see header); wl_insert above now
-- requires a member tenant.

-- ── List views: current tenant, or all member tenants in the unified view ────

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('tasks', 'tasks_select'), ('teams', 'teams_select'), ('task_assignees', 'ta_select'),
    ('workflow_sources', 'wf_select'), ('effort_records', 'effort_select'),
    ('lifecycle_events', 'lifecycle_select'), ('workflow_logs', 'wl_select')
  ) AS v(tbl, pol) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.pol, r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[]))', r.pol, r.tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS tenant_select ON public.tenants;
CREATE POLICY tenant_select ON public.tenants FOR SELECT
  USING (id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[]));
DROP POLICY IF EXISTS tenant_update ON public.tenants;
CREATE POLICY tenant_update ON public.tenants FOR UPDATE
  USING (id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users FOR SELECT
  USING (id = (SELECT auth.uid()) OR tenant_id = ANY ((SELECT public.rls_visible_tenant_ids())::uuid[]));
DROP POLICY IF EXISTS users_update ON public.users;
CREATE POLICY users_update ON public.users FOR UPDATE
  USING (id = (SELECT auth.uid()));

-- ── Teams / memberships ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS user_teams_select ON public.user_teams;
CREATE POLICY user_teams_select ON public.user_teams FOR SELECT
  USING (team_id IN (SELECT t.id FROM public.teams t WHERE t.tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])));
DROP POLICY IF EXISTS user_teams_insert ON public.user_teams;
CREATE POLICY user_teams_insert ON public.user_teams FOR INSERT
  WITH CHECK (team_id IN (SELECT t.id FROM public.teams t WHERE t.tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])));
DROP POLICY IF EXISTS user_teams_delete ON public.user_teams;
CREATE POLICY user_teams_delete ON public.user_teams FOR DELETE
  USING (team_id IN (SELECT t.id FROM public.teams t WHERE t.tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])));

DROP POLICY IF EXISTS membership_select_own ON public.user_memberships;
CREATE POLICY membership_select_own ON public.user_memberships FOR SELECT
  USING (user_id = (SELECT auth.uid()));
-- Was a self-referencing subquery (42P17 on every read; see header).
DROP POLICY IF EXISTS membership_select_org ON public.user_memberships;
CREATE POLICY membership_select_org ON public.user_memberships FOR SELECT
  USING (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));

-- ── Current tenant via the users row ────────────────────────────────────────

DROP POLICY IF EXISTS mcp_servers_manage ON public.mcp_servers;
CREATE POLICY mcp_servers_manage ON public.mcp_servers
  USING (tenant_id = (SELECT public.get_current_tenant_id()));
DROP POLICY IF EXISTS mcp_servers_select ON public.mcp_servers;

DROP POLICY IF EXISTS roles_manage ON public.roles;
CREATE POLICY roles_manage ON public.roles
  USING (tenant_id = (SELECT public.get_current_tenant_id()));
DROP POLICY IF EXISTS roles_select ON public.roles;

DROP POLICY IF EXISTS user_roles_manage ON public.user_roles;
CREATE POLICY user_roles_manage ON public.user_roles
  USING (tenant_id = (SELECT public.get_current_tenant_id()));
DROP POLICY IF EXISTS user_roles_select ON public.user_roles;

DROP POLICY IF EXISTS audit_log_insert ON public.permission_audit_log;
CREATE POLICY audit_log_insert ON public.permission_audit_log FOR INSERT
  WITH CHECK (tenant_id = (SELECT public.get_current_tenant_id()));
DROP POLICY IF EXISTS audit_log_select ON public.permission_audit_log;
CREATE POLICY audit_log_select ON public.permission_audit_log FOR SELECT
  USING (tenant_id = (SELECT public.get_current_tenant_id()));

DROP POLICY IF EXISTS reports_select ON public.reports;
CREATE POLICY reports_select ON public.reports FOR SELECT
  USING (tenant_id = (SELECT public.get_current_tenant_id()) AND (created_by = (SELECT auth.uid()) OR is_shared = true));
DROP POLICY IF EXISTS reports_insert ON public.reports;
CREATE POLICY reports_insert ON public.reports FOR INSERT
  WITH CHECK (tenant_id = (SELECT public.get_current_tenant_id()) AND created_by = (SELECT auth.uid()));
DROP POLICY IF EXISTS reports_update ON public.reports;
CREATE POLICY reports_update ON public.reports FOR UPDATE
  USING (tenant_id = (SELECT public.get_current_tenant_id()) AND created_by = (SELECT auth.uid()));
DROP POLICY IF EXISTS reports_delete ON public.reports;
CREATE POLICY reports_delete ON public.reports FOR DELETE
  USING (tenant_id = (SELECT public.get_current_tenant_id()) AND created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can create tags" ON public.tag_definitions;
CREATE POLICY "Users can create tags" ON public.tag_definitions FOR INSERT
  WITH CHECK (tenant_id IS NULL OR tenant_id = (SELECT public.get_current_tenant_id()));
DROP POLICY IF EXISTS "Users can read own tenant tags" ON public.tag_definitions;
CREATE POLICY "Users can read own tenant tags" ON public.tag_definitions FOR SELECT
  USING (tenant_id = (SELECT public.get_current_tenant_id()));
DROP POLICY IF EXISTS "Users can update own tenant tags" ON public.tag_definitions;
CREATE POLICY "Users can update own tenant tags" ON public.tag_definitions FOR UPDATE
  USING (tenant_id = (SELECT public.get_current_tenant_id()));
DROP POLICY IF EXISTS "Users can delete own tenant tags" ON public.tag_definitions;
CREATE POLICY "Users can delete own tenant tags" ON public.tag_definitions FOR DELETE
  USING (tenant_id = (SELECT public.get_current_tenant_id()));

DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications FOR INSERT
  WITH CHECK ((SELECT auth.uid()) IS NOT NULL AND tenant_id = (SELECT public.get_current_tenant_id()));
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT
  USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

-- ── Home or current tenant (agents, connectors) ─────────────────────────────
-- Was `tenant_id IN (SELECT tenant_id FROM users …) OR tenant_id IN (SELECT
-- COALESCE(current_tenant_id, tenant_id) FROM users …)` (tenant_connectors:
-- the same as a UNION): the caller's home tenant or current tenant.

DO $$
DECLARE
  r record;
  m constant text := 'tenant_id = ANY ((SELECT ARRAY[u.tenant_id, COALESCE(u.current_tenant_id, u.tenant_id)] '
                     'FROM public.users u WHERE u.id = (SELECT auth.uid()))::uuid[])';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('agent_queue', 'Users can view tenant agent queue', 'SELECT'),
    ('agent_queue', 'Users can insert into agent queue', 'INSERT'),
    ('agent_runs', 'Users can view tenant agent runs', 'SELECT'),
    ('agent_runs', 'Users can insert tenant agent runs', 'INSERT'),
    ('agent_runs', 'Users can update tenant agent runs', 'UPDATE'),
    ('agents', 'Users can view tenant agents', 'SELECT'),
    ('agents', 'Users can insert tenant agents', 'INSERT'),
    ('agents', 'Users can update tenant agents', 'UPDATE'),
    ('agents', 'Users can delete tenant agents', 'DELETE'),
    ('tenant_connectors', 'tenant_connectors_select', 'SELECT'),
    ('tenant_connectors', 'tenant_connectors_insert', 'INSERT'),
    ('tenant_connectors', 'tenant_connectors_update', 'UPDATE'),
    ('tenant_connectors', 'tenant_connectors_delete', 'DELETE')
  ) AS v(tbl, pol, cmd) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.pol, r.tbl);
    IF r.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (%s)', r.pol, r.tbl, m);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR %s USING (%s)', r.pol, r.tbl, r.cmd, m);
    END IF;
  END LOOP;
END $$;

-- tenant_isolation (ALL, current tenant) only adds what the policies above do
-- not cover: agents and tenant_connectors none, agent_runs DELETE, agent_queue
-- UPDATE and DELETE.
DROP POLICY IF EXISTS tenant_isolation ON public.agents;
DROP POLICY IF EXISTS tenant_isolation ON public.tenant_connectors;
DROP POLICY IF EXISTS tenant_isolation ON public.agent_runs;
DROP POLICY IF EXISTS tenant_isolation ON public.agent_queue;
DROP POLICY IF EXISTS tenant_isolation_delete ON public.agent_runs;
CREATE POLICY tenant_isolation_delete ON public.agent_runs FOR DELETE
  USING (tenant_id = (SELECT public.get_current_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_update ON public.agent_queue;
CREATE POLICY tenant_isolation_update ON public.agent_queue FOR UPDATE
  USING (tenant_id = (SELECT public.get_current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT public.get_current_tenant_id()));
DROP POLICY IF EXISTS tenant_isolation_delete ON public.agent_queue;
CREATE POLICY tenant_isolation_delete ON public.agent_queue FOR DELETE
  USING (tenant_id = (SELECT public.get_current_tenant_id()));

-- ── SECURITY DEFINER hygiene ────────────────────────────────────────────────

ALTER FUNCTION public.claim_next_deletion_job(text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.complete_deletion_job(uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.fail_deletion_job(uuid, text) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.fn_log_lifecycle_event() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.fn_update_parent_progress() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.get_user_permissions(uuid) SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.set_tag_tenant_id() SET search_path = public, extensions, pg_temp;

-- create_task_with_subtasks: unchanged except that explicit assignees (the
-- task's and each subtask's) must belong to the caller's current tenant —
-- home tenant or an active membership. The caller themself stays the default.
CREATE OR REPLACE FUNCTION public.create_task_with_subtasks(
  p_title text,
  p_description text DEFAULT NULL::text,
  p_priority public.task_priority DEFAULT 'medium'::public.task_priority,
  p_due_date timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_assignee_id uuid DEFAULT NULL::uuid,
  p_estimated_effort integer DEFAULT NULL::integer,
  p_subtasks jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, extensions, pg_temp
  AS $function$
DECLARE
  v_tenant_id uuid;
  v_task_id uuid;
  v_subtask jsonb;
  v_subtask_assignee uuid;
  v_result jsonb;
BEGIN
  v_tenant_id := get_current_tenant_id();

  IF p_assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = p_assignee_id AND u.tenant_id = v_tenant_id
    UNION ALL
    SELECT 1 FROM user_memberships m WHERE m.user_id = p_assignee_id AND m.tenant_id = v_tenant_id AND m.is_active
  ) THEN
    RAISE EXCEPTION 'assignee_not_in_tenant' USING ERRCODE = '42501';
  END IF;

  FOR v_subtask IN SELECT * FROM jsonb_array_elements(p_subtasks)
  LOOP
    v_subtask_assignee := (v_subtask->>'assignee_id')::uuid;
    IF v_subtask_assignee IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = v_subtask_assignee AND u.tenant_id = v_tenant_id
      UNION ALL
      SELECT 1 FROM user_memberships m WHERE m.user_id = v_subtask_assignee AND m.tenant_id = v_tenant_id AND m.is_active
    ) THEN
      RAISE EXCEPTION 'assignee_not_in_tenant' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  INSERT INTO tasks (
    tenant_id, title, description, priority, due_date,
    assignee_id, assigner_id, estimated_effort_assigner
  ) VALUES (
    v_tenant_id, p_title, p_description, p_priority, p_due_date,
    COALESCE(p_assignee_id, auth.uid()), auth.uid(), p_estimated_effort
  ) RETURNING id INTO v_task_id;

  FOR v_subtask IN SELECT * FROM jsonb_array_elements(p_subtasks)
  LOOP
    INSERT INTO tasks (
      tenant_id, parent_task_id, title, description,
      assignee_id, assigner_id, estimated_effort_assigner,
      sequence, priority
    ) VALUES (
      v_tenant_id, v_task_id,
      v_subtask->>'title',
      v_subtask->>'description',
      COALESCE((v_subtask->>'assignee_id')::uuid, p_assignee_id, auth.uid()),
      auth.uid(),
      (v_subtask->>'estimated_effort')::integer,
      COALESCE((v_subtask->>'sequence')::integer, 0),
      p_priority
    );
  END LOOP;

  INSERT INTO lifecycle_events (tenant_id, task_id, event_type, actor_id)
  VALUES (v_tenant_id, v_task_id, 'created', auth.uid());

  SELECT get_task_tree(v_task_id) INTO v_result;
  RETURN v_result;
END;
$function$;

RESET lock_timeout;
