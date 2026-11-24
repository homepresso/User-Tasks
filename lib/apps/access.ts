import type { AppAccess, AppRole, AudienceEntry } from './schema'

type Principal = Pick<AudienceEntry, 'type' | 'id'> & { role?: AppRole }

/**
 * Who may open and edit an app (pure; mirrors public.app_access in
 * supabase/migrations/20270120090000_apps.sql, which RLS uses for the
 * session client — the service applies this for service-role callers:
 * API keys, OAuth, MCP).
 *
 *  - edit: apps.manage in the workspace, or a named editor of the app.
 *  - view: apps.view and the audience names the person, a team they are in
 *    or a role they hold.
 *  - otherwise none (the app is "not found" to them).
 * A credential with no user (a workspace API key) is nobody: with
 * apps.manage it may manage every app; with apps.view alone it sees none.
 */

export interface AppViewer {
  userId: string | null
  teamIds: readonly string[]
  roleIds: readonly string[]
  can: (permission: string) => boolean
}

export interface AppAccessFacts {
  audience: readonly Principal[]
  editors: readonly string[]
}

export function appAccessLevel(viewer: AppViewer, facts: AppAccessFacts): AppAccess | null {
  if (viewer.can('apps.manage')) return 'edit'
  if (!viewer.userId) return null
  if (facts.editors.includes(viewer.userId)) return 'edit'
  if (!viewer.can('apps.view')) return null
  return inAudience(viewer, facts.audience) ? 'view' : null
}

export function inAudience(viewer: Pick<AppViewer, 'userId' | 'teamIds' | 'roleIds'>, audience: readonly Principal[]): boolean {
  return audienceMatches(viewer, audience).length > 0
}

/** The audience entries naming the viewer (directly, a team of theirs or a role they hold). */
export function audienceMatches<P extends Principal>(viewer: Pick<AppViewer, 'userId' | 'teamIds' | 'roleIds'>, audience: readonly P[]): P[] {
  if (!viewer.userId) return []
  const teams = new Set(viewer.teamIds)
  const roles = new Set(viewer.roleIds)
  return audience.filter((a) =>
    (a.type === 'user' && a.id === viewer.userId)
    || (a.type === 'team' && teams.has(a.id))
    || (a.type === 'role' && roles.has(a.id)))
}

/**
 * What the viewer may do in an app: editor (edit access — they act as a
 * contributor), contributor (any audience entry naming them is a contributor
 * entry: the widest one wins) or viewer (read-only). null: no access. The app
 * role only narrows what their own object permissions allow.
 */
export function appRoleFor(viewer: AppViewer, facts: AppAccessFacts): 'editor' | AppRole | null {
  const access = appAccessLevel(viewer, facts)
  if (!access) return null
  if (access === 'edit') return 'editor'
  return audienceMatches(viewer, facts.audience).some((a) => (a.role ?? 'viewer') === 'contributor') ? 'contributor' : 'viewer'
}

/** May this app role use action buttons (submit a form, start a workflow, claim a task)? */
export function canAct(role: 'editor' | AppRole | null): boolean {
  return role === 'editor' || role === 'contributor'
}

/**
 * Does the viewer see the Apps item in the main navigation? Designers always
 * do (apps.manage, or an editor of any app — even with no app shared with
 * them); everyone else only when at least one app is shared with them.
 */
export function showsAppsMenu(input: { appCount: number; canManage: boolean; editsAny?: boolean }): boolean {
  return input.canManage || !!input.editsAny || input.appCount > 0
}

/** Is the viewer an app designer (sees the "Apps I design" section)? */
export function isAppDesigner(apps: readonly { access: string }[], canManage: boolean): boolean {
  return canManage || apps.some((a) => a.access === 'edit')
}

/**
 * The Apps page tabs: "My apps" — the apps shared with the viewer (its
 * audience names them, a team or a role of theirs), one card each with Edit
 * as well when they also design it — and, for designers, "Apps I design":
 * every app they can edit (apps.manage: all of them). An app is never listed
 * twice in the same tab.
 */
export function appsPageSections<T extends { id: string; access: string; name: string; in_audience: boolean }>(apps: readonly T[], canManage: boolean): { use: T[]; design: T[]; designer: boolean } {
  const byName = [...apps].sort((a, b) => a.name.localeCompare(b.name))
  const designer = isAppDesigner(apps, canManage)
  return { use: byName.filter((a) => a.in_audience), design: designer ? byName.filter((a) => a.access === 'edit') : [], designer }
}

/** Apps matching a search (name or description, case- and accent-insensitive), in their order. */
export function searchApps<T extends { name: string; subtitle?: string | null; description: string | null; tags?: readonly string[] | null }>(apps: readonly T[], query: string): T[] {
  const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  const terms = fold(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return [...apps]
  return apps.filter((a) => {
    const hay = fold(`${a.name} ${a.subtitle ?? ''} ${a.description ?? ''} ${(a.tags ?? []).join(' ')}`)
    return terms.every((t) => hay.includes(t))
  })
}

/** Recent apps first (ids most-recent-first), then the rest in their order; at most `limit` recents. */
export function withRecentFirst<T extends { id: string }>(apps: readonly T[], recentIds: readonly string[], limit = 3): { recent: T[]; rest: T[] } {
  const byId = new Map(apps.map((a) => [a.id, a]))
  const recent = recentIds.map((id) => byId.get(id)).filter((a): a is T => !!a).slice(0, limit)
  const shown = new Set(recent.map((a) => a.id))
  return { recent, rest: apps.filter((a) => !shown.has(a.id)) }
}

/** Remember an app as just opened (most recent first, deduplicated, capped). */
export function pushRecent(recentIds: readonly string[], id: string, cap = 8): string[] {
  return [id, ...recentIds.filter((x) => x !== id)].slice(0, cap)
}
