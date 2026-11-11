import type { Permission } from './permissions'
import { hasExtensibilityFeatureAccess } from './extensibility-access'

export type RouteRule = {
  prefix: string
  anyOf?: Permission[]
  allOf?: Permission[]
}

/**
 * Page guards, first match wins (so a more specific prefix comes first). The
 * shell renders "Not authorized" for a page the person may not open; the
 * data behind every page is enforced again server-side (ui-reads `perm`,
 * services, RLS). Every app/(dashboard) page must match a rule here or be
 * listed in OPEN_ROUTES (__tests__/route-guards.test.ts).
 */
export const ROUTE_RULES: RouteRule[] = [
  { prefix: '/settings/governance', allOf: ['team.change_roles'] },
  { prefix: '/settings/oauth-apps', allOf: ['settings.manage_api_keys'] },
  { prefix: '/settings/github-sync', anyOf: ['sync.view', 'settings.view'] },
  { prefix: '/settings/sso', allOf: ['settings.view'] },
  { prefix: '/settings/theme', allOf: ['settings.view'] },
  { prefix: '/settings/api-keys', allOf: ['settings.manage_api_keys'] },
  { prefix: '/settings/webhooks', allOf: ['settings.manage_webhooks'] },
  { prefix: '/settings/invitations', allOf: ['team.invite'] },
  { prefix: '/settings/mcp', allOf: ['settings.view'] },
  { prefix: '/settings/logs', allOf: ['settings.view'] },
  { prefix: '/settings/log-export', allOf: ['observability.view'] },
  { prefix: '/settings/document-ocr', allOf: ['settings.view'] },
  { prefix: '/settings/assistants', allOf: ['assistants.manage'] },
  { prefix: '/settings/packages', allOf: ['packages.view'] },
  { prefix: '/packages', allOf: ['packages.view'] },
  { prefix: '/activity', allOf: ['settings.view'] },
  { prefix: '/team', allOf: ['team.view_members'] },
  { prefix: '/org/manage', anyOf: ['org.manage', 'projects.manage'] },
  { prefix: '/org', anyOf: ['org.view', 'projects.view'] },
  { prefix: '/agents', allOf: ['agents.view'] },
  { prefix: '/integrations', allOf: ['integrations.view'] },
  { prefix: '/extensibility', allOf: ['extensibility.view'] },
  // Queue and run pages: involved-only with view_queue, everything with
  // view_runs (which implies view_queue) — scoped server-side (lib/services/run-visibility).
  { prefix: '/automations/queue', allOf: ['workflows.view_queue'] },
  { prefix: '/automations/runs', allOf: ['workflows.view_queue'] },
  { prefix: '/automations/rules', allOf: ['workflows.view'] },
  // A new form is created in the designer page (forms.edit); a saved form's page opens with
  // forms.view (read only without forms.edit, which the services enforce on save).
  { prefix: '/automations/forms/new', allOf: ['forms.view', 'forms.edit'] },
  { prefix: '/automations/forms', allOf: ['forms.view'] },
  // The form wizard (build) and a wizard form's results page (the owner and
  // the people chosen in the wizard — checked server-side, lib/services/form-wizard).
  { prefix: '/forms/wizard', allOf: ['forms.wizard'] },
  { prefix: '/forms/results', allOf: ['forms.submit'] },
  { prefix: '/f', allOf: ['forms.submit'] },
  { prefix: '/fill', allOf: ['forms.submit'] },
  { prefix: '/form', allOf: ['forms.submit'] },
  { prefix: '/automations', allOf: ['workflows.view'] },
  // Workspace-wide analytics need the domain's permission on top of reports.view.
  { prefix: '/reports/tasks', allOf: ['reports.view', 'tasks.view_all'] },
  { prefix: '/reports/workflows', allOf: ['reports.view', 'workflows.view_runs'] },
  { prefix: '/reports/integrations', allOf: ['reports.view', 'integrations.view'] },
  { prefix: '/reports/business-rules', allOf: ['reports.view', 'workflows.view'] },
  { prefix: '/reports/retention', allOf: ['reports.view'], anyOf: ['team.change_roles', 'settings.view'] },
  { prefix: '/reports/builder', allOf: ['reports.view', 'reports.create'] },
  { prefix: '/reports', allOf: ['reports.view'] },
  { prefix: '/data', allOf: ['data.view'] },
  // Task tracker: Following for everyone with task access (followed and shared-with-me tasks); its other tabs read tasks.assigned (tasks.view_all).
  { prefix: '/tasks/assigned', anyOf: ['tasks.view_own', 'tasks.view_all'] },
  { prefix: '/tasks/new', allOf: ['tasks.create'] },
  { prefix: '/tasks', anyOf: ['tasks.view_own', 'tasks.view_all'] },
]

/**
 * Pages every signed-in member may open (no rule), each with the reason. The
 * pages themselves only show the person's own data or gate their controls.
 */
export const OPEN_ROUTES: Readonly<Record<string, string>> = {
  '/home': 'Landing page: own tasks, followed runs, own submissions (services scope to the person)',
  '/home/runs/[id]': "A run's progress: visibleRun / can_view_run_progress (started it, own submission, own task, or workflows.view_runs)",
  '/timeline/[runId]': "A run's timeline: run scope or can_view_run_progress (lib/services/run-timeline) — not found otherwise",
  '/onboarding': 'First-run workspace setup; its writes need settings.edit',
  '/settings': 'Settings home: personal profile and preferences; workspace tabs gate on settings.view / settings.edit',
  '/settings/infrastructure': 'Instance admin only — enforced server-side (viewerCanSeeInfrastructure), not a workspace permission',
  '/settings/workspace-dns': 'Instance admin only — enforced server-side (viewerCanSeeInfrastructure)',
  '/settings/gallery-review': 'Gallery moderators only — enforced server-side (requireModerator)',
  '/dev/ui': 'Style guide; notFound() in production',
  '/agents/[id]/runs/[runId]': 'One agent run: readable with agents.view or by the person it acted for / who started it (RLS on agent_runs)',
}

const AGENT_RUN_PAGE = /^\/agents\/[0-9a-f-]{36}\/runs\/[0-9a-f-]{36}\/?$/i

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function canAccessPath(pathname: string, permissions: Iterable<string>) {
  const permissionSet = permissions instanceof Set ? permissions : new Set(permissions)
  if (matchesPrefix(pathname, '/extensibility')) {
    return hasExtensibilityFeatureAccess(permissionSet)
  }
  // One agent run's page: anyone signed in may open it — the run record is
  // readable with agents.view, or by the person the run acted for / who
  // started it (RLS on agent_runs, migration 20261124000000); others get
  // "not found".
  if (AGENT_RUN_PAGE.test(pathname)) return true
  const rule = ROUTE_RULES.find((candidate) => matchesPrefix(pathname, candidate.prefix))
  if (!rule) return true
  if (rule.allOf && !rule.allOf.every((permission) => permissionSet.has(permission))) return false
  if (rule.anyOf && !rule.anyOf.some((permission) => permissionSet.has(permission))) return false
  return true
}
