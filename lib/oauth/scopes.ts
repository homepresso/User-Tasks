import { PERMISSION_KEYS } from '@/lib/permissions'

/**
 * OAuth scopes are coarse, human-consentable grants that EXPAND to the
 * platform's fine-grained PERMISSION_KEYS (lib/permissions.ts). The expanded
 * set becomes the token's permission ceiling — the same array
 * requireApiPermission checks for API keys.
 *
 * Naming note: these are OAuth `scope` strings. They are unrelated to the
 * API-key `ApiKeyScopes` resource allowlists (workflow_ids/table_ids) — that
 * concept is a per-resource filter, not a permission grant.
 */

const READ_WRITE_MAP: Record<string, { read: string[]; write: string[] }> = {
  tasks: {
    read: ['tasks.view_own', 'tasks.view_all'],
    // Submitting a reusable form is doing work, like completing a task.
    write: ['tasks.create', 'tasks.assign', 'tasks.complete', 'tasks.redirect', 'tasks.escalate', 'tasks.delete', 'tasks.manage_queue', 'forms.submit'],
  },
  workflows: {
    // Reusable forms are workflow building blocks.
    read: ['workflows.view', 'workflows.view_runs', 'forms.view'],
    write: ['workflows.create', 'workflows.edit', 'workflows.activate', 'workflows.delete', 'workflows.manage_runs', 'forms.edit', 'forms.delete'],
  },
  data: {
    read: ['data.view'],
    write: ['data.create', 'data.edit_schema', 'data.manage_rows', 'data.delete'],
  },
  reports: {
    read: ['reports.view'],
    write: ['reports.create', 'reports.edit_own', 'reports.share', 'reports.delete'],
  },
  agents: {
    read: ['agents.view'],
    write: ['agents.create', 'agents.edit', 'agents.test', 'agents.delete'],
  },
  integrations: {
    read: ['integrations.view'],
    write: ['integrations.create', 'integrations.edit', 'integrations.test', 'integrations.delete', 'integrations.manage_references'],
  },
  extensibility: {
    read: ['extensibility.view'],
    write: ['extensibility.create', 'extensibility.edit', 'extensibility.delete'],
  },
  settings: {
    read: ['settings.view'],
    // API-key management is deliberately NOT here — see `keys:write`.
    write: ['settings.edit', 'settings.manage_webhooks'],
  },
  team: {
    read: ['team.view_members'],
    write: ['team.invite', 'team.remove', 'team.change_roles'],
  },
  sync: {
    read: ['sync.view'],
    write: ['sync.manage', 'sync.deploy'],
  },
  packages: {
    read: ['packages.view'],
    write: ['packages.manage', 'packages.install'],
  },
}

/**
 * `config:read` / `config:write` cover everything config-as-code exports and
 * applies (workflows, decision tables, data-table schemas, integrations,
 * activities, agents, reports, retention settings) and packages (config:read
 * views packages; config:write also authors and installs them). Roles stay
 * under `team`.
 */
const CONFIG_FAMILIES = ['workflows', 'data', 'integrations', 'extensibility', 'agents', 'reports', 'packages']
/** Retention policies are settings; webhooks and API keys are not config. */
const CONFIG_SETTINGS = { read: ['settings.view'], write: ['settings.edit'] }

/**
 * Scopes only first-party clients (`oauth_clients.is_first_party`, i.e. the
 * UserTasks CLI) may request. Dynamic or tenant-registered apps can never
 * obtain them — /register drops/rejects them and /authorize refuses them.
 */
export const FIRST_PARTY_ONLY_SCOPES: string[] = ['keys:write']
const FIRST_PARTY_ONLY_MAP: Record<string, string[]> = {
  'keys:write': ['settings.view', 'settings.manage_api_keys'],
}

/**
 * Read-only families with no `:write` counterpart. `events:read` is the event
 * stream (/events, /events/stream, `usertasks logs`); audit and security
 * events additionally need settings.view, i.e. `settings:read` as well.
 */
const READ_ONLY_MAP: Record<string, string[]> = {
  events: ['observability.view'],
}

/** `workflows:run` is an alias clients understand better than `workflows:write`. */
const SCOPE_ALIASES: Record<string, string> = { 'workflows:run': 'workflows:write' }

export const OAUTH_SCOPES: string[] = [
  ...Object.keys(READ_WRITE_MAP).flatMap((family) => [`${family}:read`, `${family}:write`]),
  ...Object.keys(READ_ONLY_MAP).map((family) => `${family}:read`),
  'workflows:run',
  'config:read',
  'config:write',
  ...FIRST_PARTY_ONLY_SCOPES,
  'mcp',
  'admin',
]

/** Scopes a client that is not first-party may hold. */
export function withoutFirstPartyScopes(scopes: string[]): string[] {
  return scopes.filter((scope) => !FIRST_PARTY_ONLY_SCOPES.includes(scope))
}

export function requestsFirstPartyScope(scopes: string[]): boolean {
  return scopes.some((scope) => FIRST_PARTY_ONLY_SCOPES.includes(scope))
}

export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'tasks:read': 'Read tasks and their status',
  'tasks:write': 'Create, assign, complete, and manage tasks',
  'workflows:read': 'Read workflow definitions and run history',
  'workflows:write': 'Create, edit, activate, and start workflows',
  'workflows:run': 'Start workflows and read run history',
  'data:read': 'Read data tables and rows',
  'data:write': 'Create and modify data tables and rows',
  'reports:read': 'Read reports',
  'reports:write': 'Create, edit, share, and delete reports',
  'agents:read': 'Read AI agent definitions',
  'agents:write': 'Create, edit, test, and delete AI agents',
  'integrations:read': 'Read integrations, connectors, and references',
  'integrations:write': 'Create, edit, test, and delete integrations, connectors, and references',
  'extensibility:read': 'Read custom workflow activities',
  'extensibility:write': 'Create, edit, and delete custom workflow activities',
  'settings:read': 'Read workspace settings',
  'settings:write': 'Edit workspace settings and webhooks',
  'team:read': 'Read workspace members and teams',
  'team:write': 'Invite and remove members, and change their roles',
  'sync:read': 'Read GitHub sync status and history',
  'sync:write': 'Manage GitHub sync and run deployments',
  'packages:read': 'Read packages, their versions and the installed package library',
  'packages:write': 'Author, build, install, upgrade and uninstall packages',
  'events:read': 'Read and stream workflow, integration, agent and task events (audit and security events also need settings:read)',
  'config:read': 'Export workspace configuration (workflows, rules, tables, integrations, agents, reports) and read packages',
  'config:write': 'Import and update workspace configuration (workflows, rules, tables, integrations, agents, reports), and author and install packages',
  'keys:write': 'Create and revoke API keys on your behalf',
  mcp: 'Connect via MCP (Model Context Protocol)',
  admin: 'Full administrative access to the workspace API',
}

/** Expand OAuth scope strings to permission keys. Unknown scopes are dropped. */
export function expandScopes(scopes: string[]): string[] {
  const out = new Set<string>()
  for (const rawScope of scopes) {
    const scope = SCOPE_ALIASES[rawScope] ?? rawScope
    if (scope === 'admin') {
      for (const key of PERMISSION_KEYS) out.add(key)
      continue
    }
    if (scope === 'mcp') continue // transport marker; grants no permissions itself
    if (FIRST_PARTY_ONLY_MAP[scope]) {
      for (const key of FIRST_PARTY_ONLY_MAP[scope]) out.add(key)
      continue
    }
    const [family, mode] = scope.split(':')
    if (family === 'config' && (mode === 'read' || mode === 'write')) {
      for (const member of CONFIG_FAMILIES) {
        for (const key of READ_WRITE_MAP[member].read) out.add(key)
        if (mode === 'write') for (const key of READ_WRITE_MAP[member].write) out.add(key)
      }
      for (const key of CONFIG_SETTINGS.read) out.add(key)
      if (mode === 'write') for (const key of CONFIG_SETTINGS.write) out.add(key)
      continue
    }
    if (READ_ONLY_MAP[family] && mode === 'read') {
      for (const key of READ_ONLY_MAP[family]) out.add(key)
      continue
    }
    const entry = READ_WRITE_MAP[family]
    if (!entry || (mode !== 'read' && mode !== 'write')) continue
    for (const key of entry.read) out.add(key)
    if (mode === 'write') for (const key of entry.write) out.add(key)
  }
  return [...out]
}

/** Parse a space-delimited scope parameter into known scopes. */
export function parseScopeParam(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter((scope) => scope && OAUTH_SCOPES.includes(scope))
}

export function scopesAllowed(requested: string[], allowed: string[]): boolean {
  return requested.every((scope) => allowed.includes(scope))
}
