-- ============================================================================
-- Governance audit (2026-11) — docs/governance/audit-2026-11.md
--
-- 1. System role defaults (least privilege, matching lib/tenant-provisioning.ts):
--    - Viewer loses workflows.view and forms.view (they opened the Build menu,
--      workflow definitions and the form library to every read-only user).
--    - Member loses workflows.view and forms.view, gains workflows.view_queue
--      (the queue / run lists, scoped to the runs they are involved in).
--    - Owner, Admin and Manager gain workflows.view_queue (they already hold
--      workflows.view_runs, which implies it in the app).
--    Only SYSTEM roles (is_system = true, slug owner/admin/manager/member/
--    viewer) are touched; custom roles are never edited. seed_tenant_roles()
--    seeds new workspaces with the same sets.
--
-- 2. RLS defence in depth: writes on governance, credential and build tables
--    now need the matching permission in the row's workspace (until now any
--    member — a Viewer included — could write them straight through PostgREST
--    with their session token: give themselves a role, mint an API key,
--    invite an Owner, grant themselves objects, edit workflows/integrations).
--    The service-role client (server code, workers) bypasses RLS as before.
--    Each gate is the permission the app's service layer already requires
--    before the same write, so legitimate session-client writes keep working.
--    Secrets: api_keys and invitations are readable only by the people who
--    manage them; OAuth tokens / codes / consent states are service-only.
--
-- 3. Audit trails are append-only for end users (object_audit_log,
--    integration_call_logs: no UPDATE / DELETE through PostgREST).
--
-- 4. get_user_permissions() is no longer executable by anon.
--
-- Additive and idempotent: safe to run more than once. Live: each table's
-- policies change under a short lock (catalog only, no rewrite).
-- ============================================================================

SET lock_timeout = '5s';

-- ── Helper ──────────────────────────────────────────────────────────────────

-- Workspaces where the caller is a member (get_user_tenant_ids: active
-- membership, home or current tenant) AND one of their roles there grants
-- ANY of p_perms. Evaluated once per statement when wrapped in (SELECT …).
CREATE OR REPLACE FUNCTION public.rls_perm_tenant_ids(p_perms text[])
  RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
    SELECT coalesce(array_agg(DISTINCT ur.tenant_id), '{}'::uuid[])
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id
     WHERE ur.user_id = auth.uid()
       AND r.permissions && p_perms
       AND ur.tenant_id IN (SELECT public.get_user_tenant_ids())
  $$;
REVOKE ALL ON FUNCTION public.rls_perm_tenant_ids(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rls_perm_tenant_ids(text[]) TO authenticated, service_role;
COMMENT ON FUNCTION public.rls_perm_tenant_ids(text[]) IS
  'RLS helper: member workspaces where the caller holds any of p_perms; use as tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY[''perm'']))::uuid[])';

-- Session-scoped helper (gone at the end of the migration): <prefix>_insert /
-- _update / _delete policies gated on any of p_perms in the row's workspace.
-- Separate per command (not FOR ALL) so SELECT keeps its own, narrower rule.
CREATE OR REPLACE FUNCTION pg_temp.gate_writes(p_table text, p_prefix text, p_perms text[]) RETURNS void
  LANGUAGE plpgsql AS $fn$
DECLARE
  g text := format('tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(%L::text[]))::uuid[])', p_perms);
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_prefix || '_write', p_table);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_prefix || '_insert', p_table);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_prefix || '_update', p_table);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_prefix || '_delete', p_table);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (%s)', p_prefix || '_insert', p_table, g);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (%s) WITH CHECK (%s)', p_prefix || '_update', p_table, g, g);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (%s)', p_prefix || '_delete', p_table, g);
END
$fn$;

-- ── 1. Role defaults ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.seed_tenant_roles(p_tenant_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_all text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'workflows.view_queue', 'workflows.manage_runs', 'forms.view', 'forms.edit',
    'forms.delete', 'forms.submit', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'team.view_members', 'team.invite', 'team.remove', 'team.change_roles',
    'org.view', 'org.manage', 'projects.view', 'projects.manage',
    'settings.view', 'settings.edit', 'settings.manage_api_keys',
    'settings.manage_webhooks', 'sync.view', 'sync.manage', 'sync.deploy',
    'observability.view', 'packages.view', 'packages.manage', 'packages.install'
  ];
  -- Break-glass completion of anyone's workflow task: Owner only.
  v_owner text[] := v_all || array['tasks.complete_any'];
  -- ALL minus settings.manage_*, settings.edit, team.change_roles, team.remove,
  -- org.manage, observability.view
  v_manager text[] := array[
    'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign',
    'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete',
    'tasks.manage_queue', 'workflows.view', 'workflows.create',
    'workflows.edit', 'workflows.activate', 'workflows.delete',
    'workflows.view_runs', 'workflows.view_queue', 'workflows.manage_runs', 'forms.view', 'forms.edit',
    'forms.delete', 'forms.submit', 'agents.view', 'agents.create', 'agents.edit',
    'agents.test', 'agents.delete', 'integrations.view',
    'integrations.create', 'integrations.edit', 'integrations.test',
    'integrations.delete', 'integrations.manage_references',
    'extensibility.view', 'extensibility.create', 'extensibility.edit',
    'extensibility.delete', 'data.view', 'data.create', 'data.edit_schema',
    'data.manage_rows', 'data.delete', 'reports.view', 'reports.create',
    'reports.edit_own', 'reports.share', 'reports.delete',
    'team.view_members', 'team.invite', 'org.view', 'projects.view',
    'projects.manage', 'settings.view', 'sync.view',
    'sync.manage', 'sync.deploy', 'packages.view', 'packages.manage',
    'packages.install'
  ];
  -- Read-only consumer: own tasks, forms they are given, data, reports, people.
  v_viewer text[] := array[
    'tasks.view_own', 'tasks.complete', 'forms.submit', 'data.view',
    'reports.view', 'team.view_members', 'org.view', 'projects.view'
  ];
  v_member text[] := v_viewer || array[
    'tasks.create', 'tasks.assign', 'data.manage_rows', 'reports.create',
    'reports.edit_own', 'workflows.view_queue'
  ];
begin
  insert into roles (tenant_id, name, slug, description, permissions, is_system, base_role) values
    (p_tenant_id, 'Owner',   'owner',   'Full access to everything, including billing and API keys', v_owner,   true, 'owner'),
    (p_tenant_id, 'Admin',   'admin',   'Full administrative access',                                v_all,     true, 'admin'),
    (p_tenant_id, 'Manager', 'manager', 'Builds and manages work; no org administration',            v_manager, true, 'manager'),
    (p_tenant_id, 'Member',  'member',  'Works tasks, data, and reports',                            v_member,  true, 'member'),
    (p_tenant_id, 'Viewer',  'viewer',  'Read-only access',                                          v_viewer,  true, 'viewer');
end;
$$;

-- Existing workspaces: system roles only. array_remove / append keep any other
-- change an owner made to a system role; re-running is a no-op.
UPDATE public.roles
   SET permissions = array_remove(array_remove(permissions, 'workflows.view'), 'forms.view')
 WHERE is_system AND slug = 'viewer'
   AND permissions && ARRAY['workflows.view', 'forms.view'];

UPDATE public.roles
   SET permissions = array_remove(array_remove(permissions, 'workflows.view'), 'forms.view')
 WHERE is_system AND slug = 'member'
   AND permissions && ARRAY['workflows.view', 'forms.view'];

UPDATE public.roles
   SET permissions = permissions || ARRAY['workflows.view_queue']
 WHERE is_system AND slug IN ('owner', 'admin', 'manager', 'member')
   AND NOT ('workflows.view_queue' = ANY (permissions));

-- ── 2. Governance / credential tables ───────────────────────────────────────

-- roles, user_roles: read in the current workspace; change with Manage roles.
DROP POLICY IF EXISTS roles_manage ON public.roles;
DROP POLICY IF EXISTS roles_select ON public.roles;
DROP POLICY IF EXISTS roles_write ON public.roles;
CREATE POLICY roles_select ON public.roles FOR SELECT
  USING (tenant_id = (SELECT public.get_current_tenant_id()));
SELECT pg_temp.gate_writes('roles', 'roles', ARRAY['team.change_roles']);

DROP POLICY IF EXISTS user_roles_manage ON public.user_roles;
DROP POLICY IF EXISTS user_roles_select ON public.user_roles;
DROP POLICY IF EXISTS user_roles_write ON public.user_roles;
CREATE POLICY user_roles_select ON public.user_roles FOR SELECT
  USING (tenant_id = (SELECT public.get_current_tenant_id()));
SELECT pg_temp.gate_writes('user_roles', 'user_roles', ARRAY['team.change_roles']);

-- api_keys: hashes and permission lists — the key managers, plus your own keys (read).
DROP POLICY IF EXISTS api_keys_select ON public.api_keys;
DROP POLICY IF EXISTS api_keys_insert ON public.api_keys;
DROP POLICY IF EXISTS api_keys_update ON public.api_keys;
DROP POLICY IF EXISTS api_keys_delete ON public.api_keys;
CREATE POLICY api_keys_select ON public.api_keys FOR SELECT
  USING (
    tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['settings.manage_api_keys']))::uuid[])
    OR (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[])
        AND (user_id = (SELECT auth.uid()) OR created_by = (SELECT auth.uid())))
  );
CREATE POLICY api_keys_insert ON public.api_keys FOR INSERT
  WITH CHECK (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['settings.manage_api_keys']))::uuid[]));
CREATE POLICY api_keys_update ON public.api_keys FOR UPDATE
  USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['settings.manage_api_keys']))::uuid[]))
  WITH CHECK (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['settings.manage_api_keys']))::uuid[]));
CREATE POLICY api_keys_delete ON public.api_keys FOR DELETE
  USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['settings.manage_api_keys']))::uuid[]));

-- invitations: tokens and the role an invite grants — Invite members only.
-- (Accepting an invitation runs with the service role.)
DROP POLICY IF EXISTS invitations_select ON public.invitations;
DROP POLICY IF EXISTS invitations_insert ON public.invitations;
DROP POLICY IF EXISTS invitations_update ON public.invitations;
DROP POLICY IF EXISTS invitations_delete ON public.invitations;
CREATE POLICY invitations_select ON public.invitations FOR SELECT
  USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['team.invite']))::uuid[]));
CREATE POLICY invitations_insert ON public.invitations FOR INSERT
  WITH CHECK (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['team.invite']))::uuid[]));
CREATE POLICY invitations_update ON public.invitations FOR UPDATE
  USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['team.invite']))::uuid[]))
  WITH CHECK (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['team.invite']))::uuid[]));
CREATE POLICY invitations_delete ON public.invitations FOR DELETE
  USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['team.invite']))::uuid[]));

-- OAuth server tables. Clients: Manage API keys (the app writes them with the
-- service role). Tokens, codes and consent states: service role only.
DROP POLICY IF EXISTS tenant_isolation ON public.oauth_clients;
DROP POLICY IF EXISTS oauth_clients_manage ON public.oauth_clients;
CREATE POLICY oauth_clients_manage ON public.oauth_clients FOR ALL
  USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['settings.manage_api_keys']))::uuid[]))
  WITH CHECK (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['settings.manage_api_keys']))::uuid[]));
DROP POLICY IF EXISTS tenant_isolation ON public.oauth_tokens;
DROP POLICY IF EXISTS tenant_isolation ON public.oauth_authorization_codes;
DROP POLICY IF EXISTS tenant_isolation ON public.oauth_connect_states;
REVOKE ALL ON TABLE public.oauth_tokens, public.oauth_authorization_codes, public.oauth_connect_states FROM anon, authenticated;

-- object_permissions: grants are read by the workspace (they decide what each
-- person sees); changed with Manage roles.
DROP POLICY IF EXISTS tenant_isolation ON public.object_permissions;
DROP POLICY IF EXISTS object_permissions_select ON public.object_permissions;
DROP POLICY IF EXISTS object_permissions_write ON public.object_permissions;
CREATE POLICY object_permissions_select ON public.object_permissions FOR SELECT
  USING (tenant_id = (SELECT public.get_current_tenant_id()));
SELECT pg_temp.gate_writes('object_permissions', 'object_permissions', ARRAY['team.change_roles']);

-- tenant_connectors (GitHub sync, directory sync, OAuth connectors, OCR):
-- read by members (sync bookkeeping reads it on every asset change); written
-- by integration / settings / sync managers.
DROP POLICY IF EXISTS connectors_insert ON public.tenant_connectors;
DROP POLICY IF EXISTS connectors_update ON public.tenant_connectors;
DROP POLICY IF EXISTS connectors_delete ON public.tenant_connectors;
DROP POLICY IF EXISTS tenant_connectors_insert ON public.tenant_connectors;
DROP POLICY IF EXISTS tenant_connectors_update ON public.tenant_connectors;
DROP POLICY IF EXISTS tenant_connectors_delete ON public.tenant_connectors;
SELECT pg_temp.gate_writes('tenant_connectors', 'tenant_connectors', ARRAY['integrations.create', 'integrations.edit', 'integrations.delete', 'settings.edit', 'sync.manage']);

-- deletion_queue: queued by people who may delete something.
DROP POLICY IF EXISTS deletion_queue_tenant_isolation ON public.deletion_queue;
DROP POLICY IF EXISTS deletion_queue_select ON public.deletion_queue;
DROP POLICY IF EXISTS deletion_queue_write ON public.deletion_queue;
CREATE POLICY deletion_queue_select ON public.deletion_queue FOR SELECT TO authenticated
  USING (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]));
SELECT pg_temp.gate_writes('deletion_queue', 'deletion_queue', ARRAY['workflows.delete', 'forms.delete', 'data.delete', 'agents.delete', 'integrations.delete', 'extensibility.delete', 'reports.delete', 'settings.edit', 'team.change_roles']);

-- Directory sync identity links and runs: read in the workspace; written by
-- the sync (service role) or settings managers.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['directory_links', 'directory_sync_runs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (tenant_id = (SELECT public.get_current_tenant_id()))', t || '_select', t);
    PERFORM pg_temp.gate_writes(t, t, ARRAY['settings.edit']);
  END LOOP;
END $$;

-- GitHub sync configuration and history: sync managers / deployers.
-- (github_sync_queue and github_sync_asset_map stay member-writable: every
-- builder's save records its asset change there.)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['github_sync_templates', 'github_deployments', 'github_sync_runs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (tenant_id = (SELECT public.get_current_tenant_id()))', t || '_select', t);
    PERFORM pg_temp.gate_writes(t, t, ARRAY['sync.manage', 'sync.deploy', 'settings.edit']);
  END LOOP;
END $$;

-- ── 3. Audit trails: append-only ────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['object_audit_log', 'integration_call_logs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (tenant_id = (SELECT public.get_current_tenant_id()))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (tenant_id = (SELECT public.get_current_tenant_id()))', t || '_insert', t);
  END LOOP;
END $$;

-- ── 4. Build tables: writes need the build permission ───────────────────────

-- <prefix>_insert/_update/_delete, gated by a permission list each; SELECT
-- policies are unchanged (membership), see the audit report for why.
DO $$
DECLARE
  r record;
  g text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- table, policy prefix, insert perms, update perms, delete perms
    ('workflows', 'workflows', '{workflows.create}', '{workflows.edit,workflows.activate,workflows.create}', '{workflows.delete}'),
    ('workflow_webhooks', 'wh', '{settings.manage_webhooks,workflows.edit}', '{settings.manage_webhooks,workflows.edit}', '{settings.manage_webhooks,workflows.edit}'),
    ('custom_tables', 'custom_tables', '{data.create}', '{data.edit_schema,data.create}', '{data.delete}'),
    ('custom_table_rows', 'custom_rows', '{data.manage_rows}', '{data.manage_rows}', '{data.manage_rows}'),
    ('integrations', 'integrations', '{integrations.create}', '{integrations.edit,integrations.create,integrations.manage_references}', '{integrations.delete}'),
    ('integration_references', 'refs', '{integrations.manage_references,integrations.create,integrations.edit}', '{integrations.manage_references,integrations.create,integrations.edit}', '{integrations.manage_references,integrations.delete,integrations.edit}')
  ) AS v(tbl, prefix, ins, upd, del) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.prefix || '_insert', r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(%L::text[]))::uuid[]))', r.prefix || '_insert', r.tbl, r.ins);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.prefix || '_update', r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(%L::text[]))::uuid[])) WITH CHECK (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(%L::text[]))::uuid[]))', r.prefix || '_update', r.tbl, r.upd, r.upd);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.prefix || '_delete', r.tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(%L::text[]))::uuid[]))', r.prefix || '_delete', r.tbl, r.del);
  END LOOP;
END $$;

-- workflow_sources (external engines): insert / update with workflow or integration edit.
DROP POLICY IF EXISTS wf_insert ON public.workflow_sources;
DROP POLICY IF EXISTS wf_update ON public.workflow_sources;
CREATE POLICY wf_insert ON public.workflow_sources FOR INSERT
  WITH CHECK (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['workflows.edit', 'integrations.edit']))::uuid[]));
CREATE POLICY wf_update ON public.workflow_sources FOR UPDATE
  USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['workflows.edit', 'integrations.edit']))::uuid[]))
  WITH CHECK (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['workflows.edit', 'integrations.edit']))::uuid[]));

-- Current-tenant ALL policies → read in the workspace, write with the permission.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('workflow_versions', 'Tenant isolation for workflow_versions', 'member', '{workflows.create,workflows.edit,workflows.activate}'),
    ('decision_tables', 'tenant_isolation', 'current', '{workflows.create,workflows.edit,workflows.delete}'),
    ('email_templates', 'tenant_isolation', 'current', '{workflows.create,workflows.edit,workflows.delete}'),
    ('retention_policies', 'tenant_isolation', 'current', '{settings.edit,team.change_roles}'),
    ('integration_objects', 'tenant_isolation', 'current', '{integrations.create,integrations.edit,integrations.manage_references,integrations.delete}'),
    ('mcp_servers', 'mcp_servers_manage', 'current', '{settings.edit}')
  ) AS v(tbl, old_policy, scope, perms) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.old_policy, r.tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_select', r.tbl);
    IF r.scope = 'member' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (tenant_id = ANY ((SELECT public.rls_member_tenant_ids())::uuid[]))', r.tbl || '_select', r.tbl);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (tenant_id = (SELECT public.get_current_tenant_id()))', r.tbl || '_select', r.tbl);
    END IF;
    PERFORM pg_temp.gate_writes(r.tbl, r.tbl, r.perms::text[]);
  END LOOP;
END $$;

DROP POLICY IF EXISTS tenant_isolation ON public.integration_object_sources;
DROP POLICY IF EXISTS integration_object_sources_select ON public.integration_object_sources;
DROP POLICY IF EXISTS integration_object_sources_write ON public.integration_object_sources;
CREATE POLICY integration_object_sources_select ON public.integration_object_sources FOR SELECT
  USING (object_id IN (SELECT o.id FROM public.integration_objects o WHERE o.tenant_id = (SELECT public.get_current_tenant_id())));
DROP POLICY IF EXISTS integration_object_sources_insert ON public.integration_object_sources;
DROP POLICY IF EXISTS integration_object_sources_update ON public.integration_object_sources;
DROP POLICY IF EXISTS integration_object_sources_delete ON public.integration_object_sources;
CREATE POLICY integration_object_sources_insert ON public.integration_object_sources FOR INSERT
  WITH CHECK (object_id IN (SELECT o.id FROM public.integration_objects o WHERE o.tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['integrations.create', 'integrations.edit', 'integrations.manage_references', 'integrations.delete']))::uuid[])));
CREATE POLICY integration_object_sources_update ON public.integration_object_sources FOR UPDATE
  USING (object_id IN (SELECT o.id FROM public.integration_objects o WHERE o.tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['integrations.create', 'integrations.edit', 'integrations.manage_references', 'integrations.delete']))::uuid[])))
  WITH CHECK (object_id IN (SELECT o.id FROM public.integration_objects o WHERE o.tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['integrations.create', 'integrations.edit', 'integrations.manage_references', 'integrations.delete']))::uuid[])));
CREATE POLICY integration_object_sources_delete ON public.integration_object_sources FOR DELETE
  USING (object_id IN (SELECT o.id FROM public.integration_objects o WHERE o.tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['integrations.create', 'integrations.edit', 'integrations.manage_references', 'integrations.delete']))::uuid[])));

-- Teams and team membership: people managers.
DROP POLICY IF EXISTS teams_insert ON public.teams;
DROP POLICY IF EXISTS teams_update ON public.teams;
DROP POLICY IF EXISTS teams_delete ON public.teams;
CREATE POLICY teams_insert ON public.teams FOR INSERT
  WITH CHECK (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['team.invite', 'team.remove', 'team.change_roles', 'org.manage']))::uuid[]));
CREATE POLICY teams_update ON public.teams FOR UPDATE
  USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['team.invite', 'team.remove', 'team.change_roles', 'org.manage']))::uuid[]))
  WITH CHECK (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['team.invite', 'team.remove', 'team.change_roles', 'org.manage']))::uuid[]));
CREATE POLICY teams_delete ON public.teams FOR DELETE
  USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['team.remove', 'team.change_roles', 'org.manage']))::uuid[]));

DROP POLICY IF EXISTS user_teams_insert ON public.user_teams;
DROP POLICY IF EXISTS user_teams_delete ON public.user_teams;
CREATE POLICY user_teams_insert ON public.user_teams FOR INSERT
  WITH CHECK (team_id IN (SELECT t.id FROM public.teams t WHERE t.tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['team.invite', 'team.remove', 'team.change_roles', 'org.manage']))::uuid[])));
CREATE POLICY user_teams_delete ON public.user_teams FOR DELETE
  USING (team_id IN (SELECT t.id FROM public.teams t WHERE t.tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['team.invite', 'team.remove', 'team.change_roles', 'org.manage']))::uuid[])));

-- workflow_logs: members append (engine-side writes use the service role);
-- clearing logs needs workflow edit.
DROP POLICY IF EXISTS wl_delete ON public.workflow_logs;
CREATE POLICY wl_delete ON public.workflow_logs FOR DELETE
  USING (tenant_id = ANY ((SELECT public.rls_perm_tenant_ids(ARRAY['workflows.edit']))::uuid[]));

-- ── 5. Function grants ──────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.get_user_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_permissions(uuid) TO authenticated, service_role;
