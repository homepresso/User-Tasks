/**
 * Page titles and route breadcrumbs for the app shell (docs/design/ui-polish-spec.md §4.2, §4.5).
 *
 * - Tab titles read "Invoice approval · Workflows · UserTasks"; unread
 *   notifications prefix "(3) ".
 * - The dashboard layout sets the title template ('%s · UserTasks'), so a
 *   server page exports `metadata = pageMetadata('Workflows')`, or
 *   `generateMetadata` returning `pageMetadata(name, 'Workflows')`.
 * - Most dashboard pages are client components, so the shell also derives
 *   the title and the top-bar breadcrumbs from the route (ROUTES below); a
 *   page refines them with PageHeader `breadcrumbs` / `title`, or with
 *   `usePageBreadcrumbs` from lib/breadcrumbs-context.
 *
 * Client-safe (no server imports).
 */
import type { Metadata } from 'next'

export const APP_NAME = 'UserTasks'
export const TITLE_SEPARATOR = ' · '
export const TITLE_TEMPLATE = `%s${TITLE_SEPARATOR}${APP_NAME}`

export interface Crumb {
  label: string
  href?: string
}

type Part = string | null | undefined | false

/** "Invoice approval · Workflows" (most specific first), without the product name. */
export function pageTitle(...parts: Part[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim()).join(TITLE_SEPARATOR)
}

/** Route `metadata` under the dashboard / auth title template. */
export function pageMetadata(...parts: Part[]): Metadata {
  const title = pageTitle(...parts)
  return title ? { title } : {}
}

/** The whole document title: "(3) Invoice approval · Workflows · UserTasks". */
export function documentTitle(parts: Part[], unread = 0): string {
  const body = pageTitle(...parts, APP_NAME)
  return unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${body}` : body
}

/**
 * Route registry: one entry per dashboard path pattern (`[id]` matches one
 * segment). `label` names the page; dynamic pages carry a generic noun until
 * the page reports the object's name.
 */
/** `root`: a top-level destination that lives under another one's URL (Forms under /automations): its trail starts at itself. */
/** `hidden`: a path with no page of its own (it only stops `[id]` from matching it). */
interface RouteEntry { pattern: string; label: string; root?: boolean; hidden?: boolean }

export const ROUTES: readonly RouteEntry[] = [
  { pattern: '/home', label: 'Home' },
  { pattern: '/home/runs/[id]', label: 'Run' },
  { pattern: '/timeline', label: 'Timeline', hidden: true },
  { pattern: '/timeline/[id]', label: 'Timeline', root: true },
  { pattern: '/tasks', label: 'My tasks' },
  { pattern: '/tasks/new', label: 'New task' },
  { pattern: '/tasks/team', label: 'My team', root: true },
  { pattern: '/tasks/assigned', label: 'Task tracker', root: true },
  { pattern: '/tasks/[id]', label: 'Task' },
  { pattern: '/f/[id]', label: 'Form' },
  { pattern: '/fill/[id]', label: 'Form' },
  { pattern: '/automations', label: 'Workflows' },
  { pattern: '/automations/[id]', label: 'Workflow' },
  { pattern: '/automations/[id]/runs', label: 'Runs' },
  { pattern: '/automations/runs', label: 'Runs', hidden: true },
  { pattern: '/automations/runs/[id]', label: 'Run' },
  { pattern: '/automations/queue', label: 'Queue', root: true },
  { pattern: '/automations/schedules', label: 'Schedules', root: true },
  { pattern: '/automations/rules', label: 'Business rules', root: true },
  { pattern: '/automations/rules/[id]', label: 'Business rule' },
  { pattern: '/automations/email-templates', label: 'Email templates', root: true },
  { pattern: '/automations/forms', label: 'Forms', root: true },
  { pattern: '/automations/forms/new', label: 'New form' },
  { pattern: '/automations/forms/[id]', label: 'Form' },
  { pattern: '/forms', label: 'My forms', hidden: true },
  { pattern: '/forms/wizard', label: 'My forms', root: true },
  { pattern: '/forms/wizard/new', label: 'Build a form' },
  { pattern: '/forms/wizard/[id]', label: 'Form wizard' },
  { pattern: '/forms/results', label: 'Results', hidden: true },
  { pattern: '/forms/results/[id]', label: 'Results', root: true },
  { pattern: '/data', label: 'Data' },
  { pattern: '/data/[id]', label: 'Table' },
  { pattern: '/reports', label: 'Reports' },
  { pattern: '/reports/builder', label: 'Report builder' },
  { pattern: '/reports/tasks', label: 'Task reports' },
  { pattern: '/reports/workflows', label: 'Workflow reports' },
  { pattern: '/reports/workflows/compare', label: 'Compare' },
  { pattern: '/reports/workflows/[id]', label: 'Workflow report' },
  { pattern: '/reports/integrations', label: 'Integration reports' },
  { pattern: '/reports/business-rules', label: 'Business rule reports' },
  { pattern: '/reports/retention', label: 'Retention report' },
  { pattern: '/reports/[id]', label: 'Report' },
  { pattern: '/integrations', label: 'Integrations' },
  { pattern: '/integrations/[id]', label: 'Integration' },
  { pattern: '/integrations/[id]/calls', label: 'Calls' },
  { pattern: '/integrations/[id]/calls/[id]', label: 'Call' },
  { pattern: '/agents', label: 'Agents' },
  { pattern: '/agents/costs', label: 'Costs' },
  { pattern: '/agents/[id]', label: 'Agent' },
  { pattern: '/agents/[id]/runs', label: 'Runs' },
  { pattern: '/agents/[id]/runs/[id]', label: 'Run' },
  { pattern: '/activity', label: 'Activity' },
  { pattern: '/activity/traces', label: 'Traces', hidden: true },
  { pattern: '/activity/traces/[id]', label: 'Trace' },
  { pattern: '/extensibility', label: 'Extensibility' },
  { pattern: '/packages', label: 'Packages' },
  { pattern: '/team', label: 'Team' },
  { pattern: '/org', label: 'Organization' },
  { pattern: '/org/manage', label: 'Manage' },
  { pattern: '/org/projects', label: 'Projects', hidden: true },
  { pattern: '/org/projects/[id]', label: 'Project' },
  { pattern: '/onboarding', label: 'Get started' },
  { pattern: '/dev', label: 'Dev', hidden: true },
  { pattern: '/dev/ui', label: 'UI primitives' },
  { pattern: '/settings', label: 'Settings' },
  { pattern: '/settings/theme', label: 'Theme' },
  { pattern: '/settings/governance', label: 'Governance' },
  { pattern: '/settings/invitations', label: 'Invitations' },
  { pattern: '/settings/api-keys', label: 'API keys' },
  { pattern: '/settings/oauth-apps', label: 'OAuth apps' },
  { pattern: '/settings/webhooks', label: 'Webhooks' },
  { pattern: '/settings/packages', label: 'Package settings' },
  { pattern: '/settings/github-sync', label: 'GitHub sync' },
  { pattern: '/settings/sso', label: 'SSO & directory' },
  { pattern: '/settings/mcp', label: 'MCP access' },
  { pattern: '/settings/logs', label: 'Live logs' },
  { pattern: '/settings/log-export', label: 'Log export' },
  { pattern: '/settings/document-ocr', label: 'Document OCR' },
  { pattern: '/settings/assistants', label: 'Agent' },
  { pattern: '/settings/infrastructure', label: 'Infrastructure' },
  { pattern: '/settings/licence', label: 'Licence' },
  { pattern: '/settings/gallery-review', label: 'Gallery review' },
  { pattern: '/settings/extensions', label: 'Extensions' },
  { pattern: '/settings/extensions/[id]', label: 'Extension', hidden: true },
  { pattern: '/settings/extensions/[id]/[id]', label: 'Extension settings' },
  // Extension custom pages (/x/<extension>/…): the page names itself in its PageHeader.
  { pattern: '/x', label: 'Extensions', hidden: true },
  { pattern: '/x/[id]', label: 'Extension', root: true },
  { pattern: '/x/[id]/[id]', label: 'Extension page' },
  { pattern: '/x/[id]/[id]/[id]', label: 'Extension page' },
]

/** Query-scoped pages: a tab that is its own destination in the menu. */
const QUERY_LABELS: Record<string, Record<string, Record<string, string>>> = {
  '/settings/governance': { tab: { retention: 'Retention policies', roles: 'Roles & permissions', objects: 'Object permissions', audit: 'Audit log' } },
}

function matches(pattern: string, path: string): boolean {
  const p = pattern.split('/')
  const s = path.split('/')
  if (p.length !== s.length) return false
  return p.every((seg, i) => seg === '[id]' ? s[i] !== '' : seg === s[i])
}

function routeEntry(path: string): RouteEntry | null {
  return ROUTES.find((r) => r.pattern === path) ?? ROUTES.find((r) => r.pattern.includes('[id]') && matches(r.pattern, path)) ?? null
}

/** The registry label of one path (exact, then pattern match), or null. */
export function routeLabel(path: string): string | null {
  const entry = routeEntry(path)
  return entry && !entry.hidden ? entry.label : null
}

function normalise(pathname: string): string {
  const clean = pathname.split(/[?#]/)[0].replace(/\/+$/, '')
  return clean === '' ? '/' : clean
}

/**
 * Breadcrumbs for a route: each known ancestor path, then the page itself
 * (no href on the last). `/automations/abc/runs` → Workflows › Workflow › Runs.
 * Unknown routes give [] (the 404 page).
 */
export function routeBreadcrumbs(pathname: string, search?: URLSearchParams | string | null): Crumb[] {
  const path = normalise(pathname)
  if (path === '/' || !routeLabel(path)) return []
  const segments = path.split('/').filter(Boolean)
  const crumbs: Crumb[] = []
  for (let i = 1; i <= segments.length; i++) {
    const href = '/' + segments.slice(0, i).join('/')
    const entry = routeEntry(href)
    if (!entry || entry.hidden) continue
    if (entry.root) crumbs.length = 0
    crumbs.push({ label: entry.label, href })
  }
  // A query-scoped tab (Settings › Governance › Retention policies).
  const params = typeof search === 'string' ? new URLSearchParams(search) : search
  const scoped = QUERY_LABELS[path]
  if (params && scoped) {
    for (const [key, labels] of Object.entries(scoped)) {
      const value = params.get(key)
      if (value && labels[value]) crumbs.push({ label: labels[value], href: `${path}?${key}=${value}` })
    }
  }
  if (crumbs.length) delete crumbs[crumbs.length - 1].href
  return crumbs
}

/** Title parts from breadcrumbs: most specific first ("Run · Workflows"), at most three. */
export function titlePartsFromCrumbs(crumbs: readonly Crumb[]): string[] {
  return crumbs.map((c) => c.label).reverse().slice(0, 3)
}
