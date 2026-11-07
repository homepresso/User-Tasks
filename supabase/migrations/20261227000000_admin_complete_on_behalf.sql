-- Admins can act on any workflow task on behalf of its assignee (with a
-- required note, audited), like Owners: from the Process view an admin opens
-- the waiting task and approves on behalf. Previously Owner only.
--
-- seed_tenant_roles: the Admin system role now gets tasks.complete_any.
-- Existing workspaces: added to the Admin SYSTEM role only (custom roles are
-- never touched). Idempotent.

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
  -- Completing anyone's workflow task on their behalf: Owner and Admin.
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
    (p_tenant_id, 'Admin',   'admin',   'Full administrative access',                                v_owner,   true, 'admin'),
    (p_tenant_id, 'Manager', 'manager', 'Builds and manages work; no org administration',            v_manager, true, 'manager'),
    (p_tenant_id, 'Member',  'member',  'Works tasks, data, and reports',                            v_member,  true, 'member'),
    (p_tenant_id, 'Viewer',  'viewer',  'Read-only access',                                          v_viewer,  true, 'viewer');
end;
$$;

UPDATE public.roles
   SET permissions = permissions || ARRAY['tasks.complete_any']
 WHERE is_system AND slug = 'admin'
   AND NOT ('tasks.complete_any' = ANY (permissions));
