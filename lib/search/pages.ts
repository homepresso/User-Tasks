/**
 * Navigation shortcuts for the header search box ("Pages"): every area and
 * settings page, with the words people type for it. Filtered by the
 * caller's permissions with the same rules the route guard uses
 * (lib/route-permissions) plus each page's own permission where the guard
 * has none, so a shortcut never leads to a page the person can't open.
 * Instance-admin pages (Infrastructure, Gallery review) are left out.
 */

import type { Permission } from '@/lib/permissions'
import { canAccessPath } from '@/lib/route-permissions'
import { matchScore, matchesAllWords } from './rank'

export interface PageShortcut {
  title: string
  href: string
  /** Where it lives ("Settings", "Automations"…), shown as the subtitle. */
  area: string
  keywords?: string
  /** Needed on top of the route guard (all of them). */
  requires?: Permission[]
}

export const PAGE_SHORTCUTS: PageShortcut[] = [
  { title: 'Home', href: '/home', area: 'Home', keywords: 'home dashboard start submissions following favourites favorites' },
  { title: 'My tasks', href: '/tasks', area: 'Tasks', keywords: 'tasks inbox todo' },
  { title: 'New task', href: '/tasks/new', area: 'Tasks', keywords: 'create task add' },
  { title: 'My team', href: '/tasks/team', area: 'Tasks', keywords: 'team workload reports manager' },
  { title: 'Task tracker', href: '/tasks/assigned', area: 'Tasks', keywords: 'assigned tasks all tasks assignments tracker' },
  { title: 'Queued tasks', href: '/tasks?status=queued', area: 'Tasks', keywords: 'task queue queued accept decline unassigned claim' },
  { title: 'Workflows', href: '/automations', area: 'Build', keywords: 'automations processes flows' },
  { title: 'Forms', href: '/automations/forms', area: 'Build', keywords: 'forms form pages form themes submissions' },
  { title: 'My forms', href: '/forms/wizard', area: 'Forms', keywords: 'form wizard my forms surveys questionnaires results responses' },
  { title: 'Build a form', href: '/forms/wizard/new', area: 'Forms', keywords: 'form wizard new survey questionnaire quiz registration feedback approval' },
  { title: 'Business rules', href: '/automations/rules', area: 'Govern', keywords: 'decision tables rules' },
  { title: 'Email templates', href: '/automations/email-templates', area: 'Build', keywords: 'email mail templates' },
  { title: 'Schedules', href: '/automations/schedules', area: 'Operate', keywords: 'schedule cron timer recurring' },
  { title: 'Workflow queue', href: '/automations/queue', area: 'Operate', keywords: 'queue jobs dead letter retries' },
  { title: 'Data tables', href: '/data', area: 'Data', keywords: 'tables data rows records' },
  { title: 'Reports', href: '/reports', area: 'Reports', keywords: 'dashboards analytics charts' },
  { title: 'Report builder', href: '/reports/builder', area: 'Reports', keywords: 'new report create chart', requires: ['reports.create'] },
  { title: 'Task reports', href: '/reports/tasks', area: 'Reports', keywords: 'task analytics sla' },
  { title: 'Workflow reports', href: '/reports/workflows', area: 'Reports', keywords: 'workflow analytics runs performance' },
  { title: 'Integration reports', href: '/reports/integrations', area: 'Reports', keywords: 'integration calls analytics' },
  { title: 'Business rule reports', href: '/reports/business-rules', area: 'Reports', keywords: 'decision table analytics' },
  { title: 'Retention report', href: '/reports/retention', area: 'Reports', keywords: 'retention deletion records' },
  { title: 'Agents', href: '/agents', area: 'AI', keywords: 'ai agents assistants llm' },
  { title: 'Agent costs', href: '/agents/costs', area: 'AI', keywords: 'ai spend tokens budget' },
  { title: 'Integrations', href: '/integrations', area: 'Integrations', keywords: 'apis connections systems' },
  { title: 'Connectors', href: '/integrations?tab=connectors', area: 'Integrations', keywords: 'connectors databases salesforce servicenow' },
  { title: 'API references', href: '/integrations?tab=references', area: 'Integrations', keywords: 'references endpoints operations' },
  { title: 'MCP servers (integrations)', href: '/integrations?tab=mcp', area: 'Integrations', keywords: 'mcp model context protocol tools' },
  { title: 'Custom steps', href: '/extensibility', area: 'Extensibility', keywords: 'custom activities steps code extensibility' },
  { title: 'Packages', href: '/packages', area: 'Packages', keywords: 'packages gallery install export import' },
  { title: 'Organization', href: '/org', area: 'Team', keywords: 'org chart organization reporting lines departments org units hierarchy', requires: ['org.view'] },
  { title: 'Projects', href: '/org?view=projects', area: 'Team', keywords: 'projects project teams members', requires: ['projects.view'] },
  { title: 'Manage organization', href: '/org/manage', area: 'Team', keywords: 'org units import csv export job titles departments', requires: ['org.manage'] },
  { title: 'Team', href: '/team', area: 'Team', keywords: 'people members users teams' },
  { title: 'Activity', href: '/activity', area: 'Observability', keywords: 'activity events traces history' },
  { title: 'Settings', href: '/settings', area: 'Settings', keywords: 'profile preferences organizations account' },
  { title: 'Theme', href: '/settings/theme', area: 'Settings', keywords: 'theme colours colors branding logo appearance' },
  { title: 'Governance', href: '/settings/governance', area: 'Settings', keywords: 'roles permissions access security' },
  { title: 'Roles & permissions', href: '/settings/governance?tab=roles', area: 'Settings', keywords: 'roles permissions rbac' },
  { title: 'Object permissions', href: '/settings/governance?tab=objects', area: 'Settings', keywords: 'object permissions sharing access' },
  { title: 'Retention policies', href: '/settings/governance?tab=retention', area: 'Settings', keywords: 'retention gdpr deletion policies' },
  { title: 'Audit log', href: '/settings/governance?tab=audit', area: 'Settings', keywords: 'audit log history changes' },
  { title: 'Invite users', href: '/settings/invitations', area: 'Settings', keywords: 'invite invitations users members' },
  { title: 'API keys', href: '/settings/api-keys', area: 'Settings', keywords: 'api keys tokens' },
  { title: 'OAuth apps', href: '/settings/oauth-apps', area: 'Settings', keywords: 'oauth clients apps', requires: ['settings.manage_api_keys'] },
  { title: 'Webhooks', href: '/settings/webhooks', area: 'Settings', keywords: 'webhooks callbacks events' },
  { title: 'Package settings', href: '/settings/packages', area: 'Settings', keywords: 'packages signing installs' },
  { title: 'GitHub sync', href: '/settings/github-sync', area: 'Settings', keywords: 'github git sync deploy repository', requires: ['settings.view'] },
  { title: 'SSO & Directory', href: '/settings/sso', area: 'Settings', keywords: 'sso saml oidc scim directory sync login', requires: ['settings.view'] },
  { title: 'MCP access', href: '/settings/mcp', area: 'Settings', keywords: 'mcp model context protocol claude ai access' },
  { title: 'Live logs', href: '/settings/logs', area: 'Settings', keywords: 'logs live tail debug' },
  { title: 'Log export', href: '/settings/log-export', area: 'Settings', keywords: 'log export splunk datadog otlp siem' },
  { title: 'Agent', href: '/settings/assistants', area: 'Settings', keywords: 'agent ai assistant chat openai claude anthropic grok xai gemini llm api key copilot', requires: ['assistants.manage'] },
  { title: 'Document OCR', href: '/settings/document-ocr', area: 'Settings', keywords: 'ocr scanned documents azure document intelligence tesseract key', requires: ['settings.view'] },
]

/** Shortcuts the caller may open (the route guard plus each page's own permissions). */
export function visiblePageShortcuts(permissions: Iterable<string>): PageShortcut[] {
  const permissionSet = permissions instanceof Set ? permissions : new Set(permissions)
  return PAGE_SHORTCUTS.filter((page) => (page.requires ?? []).every((p) => permissionSet.has(p)) && canAccessPath(page.href.split('?')[0], permissionSet))
}

/** Shortcuts the caller may open that match the query, best first. */
export function searchPageShortcuts(query: string, permissions: Iterable<string>, limit = 6): PageShortcut[] {
  const q = query.trim()
  if (q.length < 2) return []
  return visiblePageShortcuts(permissions)
    .filter((page) => matchesAllWords(`${page.title} ${page.area} ${page.keywords ?? ''}`, q))
    .map((page, index) => ({ page, index, score: matchScore(page.title, q) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.page)
}
