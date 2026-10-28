import type { Permission } from './permissions'
import { hasExtensibilityFeatureAccess } from './extensibility-access'

type RouteRule = {
  prefix: string
  anyOf?: Permission[]
  allOf?: Permission[]
}

const ROUTE_RULES: RouteRule[] = [
  { prefix: '/settings/governance', allOf: ['team.change_roles'] },
  { prefix: '/settings/api-keys', allOf: ['settings.manage_api_keys'] },
  { prefix: '/settings/webhooks', allOf: ['settings.manage_webhooks'] },
  { prefix: '/settings/invitations', allOf: ['team.invite'] },
  { prefix: '/settings/mcp', allOf: ['settings.view'] },
  { prefix: '/settings/logs', allOf: ['settings.view'] },
  { prefix: '/settings/log-export', allOf: ['observability.view'] },
  { prefix: '/settings/packages', allOf: ['packages.view'] },
  { prefix: '/packages', allOf: ['packages.view'] },
  { prefix: '/activity', allOf: ['settings.view'] },
  { prefix: '/team', allOf: ['team.view_members'] },
  { prefix: '/agents', allOf: ['agents.view'] },
  { prefix: '/integrations', allOf: ['integrations.view'] },
  { prefix: '/extensibility', allOf: ['extensibility.view'] },
  { prefix: '/automations/queue', allOf: ['workflows.view_runs'] },
  { prefix: '/automations/rules', allOf: ['workflows.view'] },
  { prefix: '/automations/forms', allOf: ['forms.view'] },
  { prefix: '/f', allOf: ['forms.submit'] },
  { prefix: '/automations', allOf: ['workflows.view'] },
  { prefix: '/reports', allOf: ['reports.view'] },
  { prefix: '/data', allOf: ['data.view'] },
  { prefix: '/tasks/queue', allOf: ['tasks.manage_queue'] },
  { prefix: '/tasks/assigned', allOf: ['tasks.view_all'] },
  { prefix: '/tasks/new', allOf: ['tasks.create'] },
  { prefix: '/tasks', anyOf: ['tasks.view_own', 'tasks.view_all'] },
]

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function canAccessPath(pathname: string, permissions: Iterable<string>) {
  const permissionSet = permissions instanceof Set ? permissions : new Set(permissions)
  if (matchesPrefix(pathname, '/extensibility')) {
    return hasExtensibilityFeatureAccess(permissionSet)
  }
  const rule = ROUTE_RULES.find((candidate) => matchesPrefix(pathname, candidate.prefix))
  if (!rule) return true
  if (rule.allOf && !rule.allOf.every((permission) => permissionSet.has(permission))) return false
  if (rule.anyOf && !rule.anyOf.some((permission) => permissionSet.has(permission))) return false
  return true
}
