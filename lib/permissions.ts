import { extensionPermissionGroups, extensionPermissionsImpliedBy, hasExtensionImplications, isExtensionPermission, looksLikeExtensionPermission } from './extensions/permissions'

/* ── Permission keys ── */

export const PERMISSION_PAYLOAD_VERSION = 20

export const PERMISSION_KEYS = [
  'tasks.create', 'tasks.view_own', 'tasks.view_all', 'tasks.assign', 'tasks.complete',
  'tasks.redirect', 'tasks.escalate', 'tasks.delete', 'tasks.manage_queue', 'tasks.complete_any',
  'workflows.view', 'workflows.create', 'workflows.edit', 'workflows.activate',
  'workflows.delete', 'workflows.view_runs', 'workflows.view_queue', 'workflows.manage_runs',
  'forms.view', 'forms.edit', 'forms.delete', 'forms.submit', 'forms.wizard',
  'agents.view', 'agents.create', 'agents.edit', 'agents.test', 'agents.delete',
  'integrations.view', 'integrations.create', 'integrations.edit', 'integrations.test',
  'integrations.delete', 'integrations.manage_references',
  'extensibility.view', 'extensibility.create', 'extensibility.edit', 'extensibility.delete',
  'data.view', 'data.create', 'data.edit_schema', 'data.manage_rows', 'data.delete',
  'reports.view', 'reports.create', 'reports.edit_own', 'reports.share', 'reports.delete',
  'team.view_members', 'team.invite', 'team.remove', 'team.change_roles',
  'org.view', 'org.manage', 'projects.view', 'projects.manage',
  'settings.view', 'settings.edit', 'settings.manage_api_keys',
  'settings.manage_webhooks', 'assistants.manage',
  'sync.view', 'sync.manage', 'sync.deploy',
  'observability.view',
  'packages.view', 'packages.manage', 'packages.install',
] as const

export type Permission = (typeof PERMISSION_KEYS)[number]

/* ── Permission catalog for UI ── */

export interface PermissionDef {
  key: Permission
  label: string
  description: string
}

export interface PermissionGroup {
  key: string
  label: string
  permissions: PermissionDef[]
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  { key: 'tasks', label: 'Tasks', permissions: [
    { key: 'tasks.create', label: 'Create tasks', description: 'Create new tasks and subtasks' },
    { key: 'tasks.view_own', label: 'View own tasks', description: 'View tasks assigned to them' },
    { key: 'tasks.view_all', label: 'View all tasks', description: 'View all tasks in the organisation' },
    { key: 'tasks.assign', label: 'Assign tasks', description: 'Assign tasks to other users' },
    { key: 'tasks.complete', label: 'Complete tasks', description: 'Mark tasks as completed' },
    { key: 'tasks.redirect', label: 'Redirect tasks', description: 'Redirect tasks to other users' },
    { key: 'tasks.escalate', label: 'Escalate tasks', description: 'Escalate tasks to managers' },
    { key: 'tasks.delete', label: 'Delete tasks', description: 'Soft-delete tasks' },
    { key: 'tasks.manage_queue', label: 'Manage queue', description: 'Manage the task queue' },
    { key: 'tasks.complete_any', label: 'Complete any task (break-glass)', description: 'Act on any workflow task on behalf of its assignee, with a note; audited. Owner and Admin by default' },
  ]},
  { key: 'workflows', label: 'Workflows', permissions: [
    { key: 'workflows.view', label: 'View workflows', description: 'View workflow definitions' },
    { key: 'workflows.create', label: 'Create workflows', description: 'Create new workflows' },
    { key: 'workflows.edit', label: 'Edit workflows', description: 'Edit workflow nodes and edges' },
    { key: 'workflows.activate', label: 'Activate workflows', description: 'Activate and deactivate workflows' },
    { key: 'workflows.delete', label: 'Delete workflows', description: 'Delete workflows' },
    { key: 'workflows.view_runs', label: 'View all runs', description: 'See every run and queue item in the workspace, with its history and logs (includes View queue)' },
    { key: 'workflows.view_queue', label: 'View queue', description: 'Open the workflow queue and run lists: the runs you are involved in (you started it, your form submission started it, or you have a task in it) plus every run of a workflow you hold an explicit View grant on' },
    { key: 'workflows.manage_runs', label: 'Migrate live runs', description: 'Move live (waiting or paused) workflow runs to another version' },
  ]},
  { key: 'forms', label: 'Forms', permissions: [
    { key: 'forms.view', label: 'View forms', description: 'See reusable task forms and form themes, where they are used, and their retention policy and legal hold' },
    { key: 'forms.submit', label: 'Submit forms', description: 'Open reusable forms on their own page (/f/…) and submit them; see their own submissions. Forms in Available forms show in the Forms menu of people given a View or Submit grant on them' },
    { key: 'forms.edit', label: 'Edit forms', description: 'Create and edit reusable task forms and form themes (new versions); see every submission' },
    { key: 'forms.delete', label: 'Delete forms', description: 'Delete reusable forms (with their versions, submissions, uploaded files and grants) and form themes that no workflow uses; forms on legal hold cannot be deleted' },
    { key: 'forms.wizard', label: 'Create forms with the wizard', description: 'Build forms, surveys and questionnaires step by step: the wizard creates the form, a data table for the responses, an optional review / approval workflow and a results page, all owned by them, and updates them later. Only what the wizard makes is created (no other build access). Owner, Admin, Manager and Member by default' },
  ]},
  { key: 'agents', label: 'AI Agents', permissions: [
    { key: 'agents.view', label: 'View agents', description: 'View agent definitions' },
    { key: 'agents.create', label: 'Create agents', description: 'Create new agents' },
    { key: 'agents.edit', label: 'Edit agents', description: 'Edit agent configuration' },
    { key: 'agents.test', label: 'Test agents', description: 'Run agent tests in playground' },
    { key: 'agents.delete', label: 'Delete agents', description: 'Delete agents' },
  ]},
  { key: 'integrations', label: 'Integrations', permissions: [
    { key: 'integrations.view', label: 'View integrations', description: 'View integrations and connectors' },
    { key: 'integrations.create', label: 'Create integrations', description: 'Create new integrations' },
    { key: 'integrations.edit', label: 'Edit integrations', description: 'Edit integration configuration' },
    { key: 'integrations.test', label: 'Test integrations', description: 'Test integration connections' },
    { key: 'integrations.delete', label: 'Delete integrations', description: 'Delete integrations' },
    { key: 'integrations.manage_references', label: 'Manage references', description: 'Create and edit integration references' },
  ]},
  { key: 'extensibility', label: 'Extensibility', permissions: [
    { key: 'extensibility.view', label: 'View extensibility assets', description: 'View custom workflow activities' },
    { key: 'extensibility.create', label: 'Create extensibility assets', description: 'Create custom workflow activities' },
    { key: 'extensibility.edit', label: 'Edit extensibility assets', description: 'Edit custom workflow activity metadata and code' },
    { key: 'extensibility.delete', label: 'Delete extensibility assets', description: 'Delete custom workflow activities' },
  ]},
  { key: 'data', label: 'Data Tables', permissions: [
    { key: 'data.view', label: 'View data', description: 'View custom tables and rows' },
    { key: 'data.create', label: 'Create tables', description: 'Create new custom tables' },
    { key: 'data.edit_schema', label: 'Edit schema', description: 'Edit table columns' },
    { key: 'data.manage_rows', label: 'Manage rows', description: 'Add, edit, and delete rows' },
    { key: 'data.delete', label: 'Delete tables', description: 'Delete custom tables' },
  ]},
  { key: 'reports', label: 'Reports', permissions: [
    { key: 'reports.view', label: 'View reports', description: 'View pre-built and shared reports' },
    { key: 'reports.create', label: 'Create reports', description: 'Create custom reports' },
    { key: 'reports.edit_own', label: 'Edit own reports', description: 'Edit reports you created' },
    { key: 'reports.share', label: 'Share reports', description: 'Share reports with the team' },
    { key: 'reports.delete', label: 'Delete reports', description: 'Delete reports' },
  ]},
  { key: 'team', label: 'Team', permissions: [
    { key: 'team.view_members', label: 'View members', description: 'View team members' },
    { key: 'team.invite', label: 'Invite members', description: 'Invite new members to the organisation' },
    { key: 'team.remove', label: 'Remove members', description: 'Remove members from the organisation' },
    { key: 'team.change_roles', label: 'Manage roles', description: 'Change user roles and permissions; manage grants on workflows, forms, data tables and other objects, retention assignments and legal holds' },
  ]},
  { key: 'org', label: 'Organization', permissions: [
    { key: 'org.view', label: 'View organization', description: 'See the org chart, org units, teams and people attributes (job title, department, location)' },
    { key: 'org.manage', label: 'Manage organization', description: 'Create and edit org units, set people attributes and reporting lines in bulk, import and export the org structure' },
    { key: 'projects.view', label: 'View projects', description: 'See projects, their members and attached teams' },
    { key: 'projects.manage', label: 'Manage projects', description: 'Create, edit and archive projects; add members and attach teams' },
  ]},
  { key: 'settings', label: 'Settings', permissions: [
    { key: 'settings.view', label: 'View settings', description: 'View organisation settings' },
    { key: 'settings.edit', label: 'Edit settings', description: 'Edit branding, name, and configuration' },
    { key: 'settings.manage_api_keys', label: 'Manage API keys', description: 'Create and revoke API keys' },
    { key: 'settings.manage_webhooks', label: 'Manage webhooks', description: 'Configure webhook endpoints' },
    { key: 'assistants.manage', label: 'Manage the Agent', description: 'Set the AI provider key and model for the Agent (the AI assistant on every screen), turn it on or off, choose who may use it and set its limits' },
    { key: 'sync.view', label: 'View GitHub sync', description: 'See sync status, pending changes, and deployment history' },
    { key: 'sync.manage', label: 'Manage GitHub sync', description: 'Connect repositories, change sync mode, and commit queued changes' },
    { key: 'sync.deploy', label: 'Deploy from GitHub', description: 'Run deployments that import repository configuration into this workspace' },
  ]},
  { key: 'observability', label: 'Observability', permissions: [
    { key: 'observability.view', label: 'View event stream', description: 'Read and stream workflow, integration, agent and task events (audit and security events also need View settings) and see log export destinations' },
  ]},
  { key: 'packages', label: 'Packages', permissions: [
    { key: 'packages.view', label: 'View packages', description: 'See authored packages, their versions and the installed package library' },
    { key: 'packages.manage', label: 'Author packages', description: 'Create and edit packages, build and sign versions and download .utpkg files' },
    { key: 'packages.install', label: 'Install packages', description: 'Install, upgrade, complete setup and uninstall packages (each asset also needs its own create / edit permission)' },
  ]},
]

/* ── Implied permissions ── */

/**
 * Holding the key permission implies the listed ones (a broader right
 * includes a narrower one). Applied wherever a permission set is built
 * (expandPermissions): the session (get_user_permissions), API keys, OAuth
 * tokens and MCP. Custom roles and API keys that predate a narrower key keep
 * working without being edited.
 */
export const IMPLIED_PERMISSIONS: Partial<Record<Permission, readonly Permission[]>> = {
  // All runs ⊃ the runs you are involved in.
  'workflows.view_runs': ['workflows.view_queue'],
}

/**
 * The permissions plus every permission they imply (deduplicated, input
 * order first). Extension permissions (`ext.<id>.<key>`) whose manifest says
 * a held core permission implies them are added too (lib/extensions/permissions).
 */
export function expandPermissions(perms: Iterable<string>): string[] {
  const out = new Set<string>(perms)
  for (const p of [...out]) for (const implied of IMPLIED_PERMISSIONS[p as Permission] ?? []) out.add(implied)
  if (hasExtensionImplications()) {
    for (const p of [...out]) for (const implied of extensionPermissionsImpliedBy(p)) out.add(implied)
  }
  return [...out]
}

/** True when the set holds the permission or one that implies it. */
export function holdsPermission(perms: { has(p: string): boolean }, permission: string): boolean {
  if (perms.has(permission)) return true
  for (const [broader, implied] of Object.entries(IMPLIED_PERMISSIONS)) {
    if ((implied as readonly string[]).includes(permission) && perms.has(broader)) return true
  }
  if (permission.startsWith('ext.') && hasExtensionImplications()) {
    for (const def of extensionImpliers(permission)) if (perms.has(def)) return true
  }
  return false
}

function extensionImpliers(permission: string): string[] {
  const out: string[] = []
  for (const core of PERMISSION_KEYS) if (extensionPermissionsImpliedBy(core).includes(permission)) out.push(core)
  return out
}

/**
 * Keys a role or API key may store: core keys, extension permissions in the
 * build, and well-formed `ext.<id>.<key>` keys (an extension removed from the
 * build keeps its grants for when it returns).
 */
export function isStorablePermission(key: string): boolean {
  return (PERMISSION_KEYS as readonly string[]).includes(key) || isExtensionPermission(key) || looksLikeExtensionPermission(key)
}

/** Role editor groups: the core groups, then one group per installed extension. */
export function permissionGroupsWithExtensions(): Array<{ key: string; label: string; permissions: Array<{ key: string; label: string; description: string }> }> {
  const ext = extensionPermissionGroups()
  return ext.length ? [...PERMISSION_GROUPS, ...ext] : PERMISSION_GROUPS
}

/* ── Permission check functions (shared, no server deps) ── */

export function can(permissions: Set<string>, permission: Permission): boolean {
  return permissions.has(permission)
}

export function canAny(permissions: Set<string>, ...perms: Permission[]): boolean {
  return perms.some(p => permissions.has(p))
}
