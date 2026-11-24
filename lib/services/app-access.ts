/**
 * Apps and permissions (server side of lib/apps/governance.ts):
 *
 *  - `objectFactsFor`: what one person may do with the objects an app
 *    points at — their role permissions, their form grants (the person, a
 *    team of theirs, a role they hold), which objects exist in the workspace
 *    and which reports they may read. Used to show a page to its viewer and
 *    for every audience member in the access analysis.
 *  - `analyseAppAccess`: for each audience entry × bound object, does every
 *    member have what their app role needs (viewers: see; contributors:
 *    see + submit / start)? Each gap says what is missing and how to fix it:
 *    a form grant the designer can give (they hold Manage roles —
 *    team.change_roles, as for every object grant) or whom to ask.
 *  - `grantAppAccess`: applies the form grants for the chosen gaps through
 *    lib/services/object-permissions (minimal: View + Submit; audited there
 *    as `grant` on the form). Recomputed server-side — the browser only
 *    names gaps.
 *
 * Service-role reads with explicit tenant filters; callers check app access.
 */

import { expandPermissions } from '@/lib/permissions'
import { unmappedRequired } from '@/lib/apps/params'
import { ruleProblems, type AppRule } from '@/lib/apps/rules'
import type { ParamDecl, VariableDecl } from '@/lib/apps/variables'
import { layoutFormParams } from '@/lib/forms/form-params'
import {
  NEED_LABELS, OBJECT_KINDS, PERMISSION_LABELS, appBindings, formParamUses, objectAllowed, sourceAllowed,
  type BoundObject, type Denial, type ObjectFacts, type ObjectKind, type Need, type Source,
} from '@/lib/apps/governance'
import type { AppRole, AudienceEntry, PageLayout, AppMenuItem, PrincipalType } from '@/lib/apps/schema'
import { hasPerm, type AnySupabaseClient, type ServiceContext } from './context'
import { dbError } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped tables */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MEMBER_CAP = 500
const TABLE: Record<ObjectKind, string> = { form: 'forms', workflow: 'workflows', data_table: 'custom_tables', report: 'reports', agent: 'agents', reference: 'integration_references' }
const KIND_LABEL: Record<ObjectKind, string> = { form: 'form', workflow: 'workflow', data_table: 'data table', report: 'report', agent: 'agent', reference: 'API reference' }

export interface ObjectInfo { id: string; name: string; created_by: string | null; is_shared?: boolean }

/** The objects (of these ids) that exist in the workspace, with names and owners. */
export async function loadObjects(db: AnySupabaseClient, tenantId: string, ids: Record<ObjectKind, string[]>): Promise<Record<ObjectKind, Map<string, ObjectInfo>>> {
  const out = Object.fromEntries(OBJECT_KINDS.map((k) => [k, new Map()])) as Record<ObjectKind, Map<string, ObjectInfo>>
  await Promise.all((Object.keys(TABLE) as ObjectKind[]).map(async (kind) => {
    const list = (ids[kind] ?? []).filter((id) => UUID_RE.test(id))
    if (!list.length) return
    const columns = kind === 'report' ? 'id, name, created_by, is_shared' : kind === 'reference' ? 'id, name' : 'id, name, created_by'
    const { data, error } = await (db as any).from(TABLE[kind]).select(columns).eq('tenant_id', tenantId).in('id', list)
    if (error) throw dbError(error)
    for (const r of (data ?? []) as any[]) out[kind].set(String(r.id), { id: String(r.id), name: String(r.name ?? KIND_LABEL[kind]), created_by: r.created_by ?? null, is_shared: Boolean(r.is_shared) })
  }))
  return out
}

interface FormGrant { form: string; user_id: string | null; team_id: string | null; role_id: string | null }

async function loadFormGrants(db: AnySupabaseClient, tenantId: string, formIds: string[]): Promise<FormGrant[]> {
  const list = formIds.filter((id) => UUID_RE.test(id))
  if (!list.length) return []
  const { data, error } = await (db as any).from('object_permissions').select('object_id, user_id, team_id, role_id, can_view, can_execute')
    .eq('tenant_id', tenantId).eq('object_type', 'form').in('object_id', list)
  if (error) throw dbError(error)
  return ((data ?? []) as any[]).filter((g) => g.can_view || g.can_execute).map((g) => ({ form: String(g.object_id), user_id: g.user_id, team_id: g.team_id, role_id: g.role_id }))
}

/** One person's roles, permissions and teams in the workspace. */
interface Person { id: string; roleIds: string[]; teamIds: string[]; permissions: Set<string> }

async function loadPeople(db: AnySupabaseClient, tenantId: string, userIds: string[]): Promise<Map<string, Person>> {
  const ids = [...new Set(userIds.filter((id) => UUID_RE.test(id)))]
  const out = new Map<string, Person>()
  if (!ids.length) return out
  const [ur, ut, legacy] = await Promise.all([
    (db as any).from('user_roles').select('user_id, role_id, role:roles!inner(permissions, tenant_id)').eq('tenant_id', tenantId).in('user_id', ids),
    (db as any).from('user_teams').select('user_id, team_id, team:teams!inner(tenant_id)').in('user_id', ids).eq('team.tenant_id', tenantId),
    (db as any).from('users').select('id, team_id').in('id', ids),
  ])
  for (const r of [ur, ut, legacy]) if (r.error) throw dbError(r.error)
  for (const id of ids) out.set(id, { id, roleIds: [], teamIds: [], permissions: new Set() })
  for (const r of (ur.data ?? []) as any[]) {
    const p = out.get(String(r.user_id))
    if (!p) continue
    p.roleIds.push(String(r.role_id))
    for (const perm of (r.role?.permissions ?? []) as string[]) p.permissions.add(perm)
  }
  for (const r of (ut.data ?? []) as any[]) out.get(String(r.user_id))?.teamIds.push(String(r.team_id))
  const legacyTeams = ((legacy.data ?? []) as any[]).filter((u) => u.team_id)
  if (legacyTeams.length) {
    const { data } = await (db as any).from('teams').select('id').eq('tenant_id', tenantId).in('id', legacyTeams.map((u) => u.team_id))
    const inTenant = new Set(((data ?? []) as any[]).map((t) => String(t.id)))
    for (const u of legacyTeams) if (inTenant.has(String(u.team_id))) out.get(String(u.id))?.teamIds.push(String(u.team_id))
  }
  for (const p of out.values()) p.permissions = new Set(expandPermissions(p.permissions))
  return out
}

function factsFor(person: Pick<Person, 'id' | 'roleIds' | 'teamIds'>, can: (p: string) => boolean, objects: Record<ObjectKind, Map<string, ObjectInfo>>, grants: FormGrant[]): ObjectFacts {
  const teams = new Set(person.teamIds)
  const roles = new Set(person.roleIds)
  const formGrants = new Set(grants.filter((g) => g.user_id === person.id || (g.team_id && teams.has(g.team_id)) || (g.role_id && roles.has(g.role_id))).map((g) => g.form))
  const visibleReports = new Set([...objects.report.values()].filter((r) => r.is_shared || r.created_by === person.id).map((r) => r.id))
  return {
    can,
    formGrants,
    exists: Object.fromEntries(OBJECT_KINDS.map((k) => [k, new Set(objects[k].keys())])) as unknown as ObjectFacts['exists'],
    visibleReports,
    names: new Map(OBJECT_KINDS.flatMap((k) => [...objects[k].values()].map((o) => [`${k}:${o.id}`, o.name] as [string, string]))),
  }
}

/**
 * The context's own facts for these objects (the viewer of an app page).
 * Permissions are the context's (hasPerm); grants are the person's.
 */
export async function objectFactsFor(ctx: ServiceContext, db: AnySupabaseClient, viewer: { userId: string | null; teamIds: readonly string[]; roleIds: readonly string[] }, ids: Record<ObjectKind, string[]>): Promise<ObjectFacts> {
  const [objects, grants] = await Promise.all([loadObjects(db, ctx.tenantId, ids), loadFormGrants(db, ctx.tenantId, ids.form)])
  return factsFor({ id: viewer.userId ?? '', roleIds: [...viewer.roleIds], teamIds: [...viewer.teamIds] }, (p) => hasPerm(ctx, p), objects, grants)
}

/* ── Access analysis ─────────────────────────────────────────────────── */

export interface AccessGap {
  /** Stable key: `<principal type>:<principal id>:<object kind>:<object id>:<need>:<missing>`. */
  key: string
  principal: { type: PrincipalType; id: string; name: string; role: AppRole }
  object: { kind: ObjectKind | 'source'; id: string; name: string; owner: string | null }
  need: Need
  /** Where the app uses it (page › widget: button, or Menu: entry). */
  where: string[]
  /** Members of the audience entry lacking it, of how many. */
  affected: number
  total: number
  missing: 'permission' | 'grant' | 'shared' | 'object' | 'viewers'
  permission?: string
  /** One sentence: who can't do what, and why. */
  message: string
  fix:
    | { kind: 'grant'; can_grant: boolean; grant: { object_type: 'form'; object_id: string; principal_type: PrincipalType; principal_id: string; can_view: true; can_execute: true } }
    | { kind: 'ask'; who: string }
}

export interface AccessAnalysis {
  gaps: AccessGap[]
  /** Configuration to check (not access): e.g. a form's required parameter that nothing passes. */
  warnings?: string[]
  /** Gaps the caller can fix here (form grants, with Manage roles). */
  grantable: number
  checked: { entries: number; objects: number }
}

async function membersOf(db: AnySupabaseClient, tenantId: string, entry: Pick<AudienceEntry, 'type' | 'id'>): Promise<string[]> {
  if (entry.type === 'user') return [entry.id]
  if (entry.type === 'team') {
    const [{ data: ut }, { data: legacy }] = await Promise.all([
      (db as any).from('user_teams').select('user_id, team:teams!inner(tenant_id)').eq('team_id', entry.id).eq('team.tenant_id', tenantId).limit(MEMBER_CAP),
      (db as any).from('users').select('id').eq('team_id', entry.id).limit(MEMBER_CAP),
    ])
    const ids = new Set<string>([...((ut ?? []) as any[]).map((r) => String(r.user_id)), ...((legacy ?? []) as any[]).map((r) => String(r.id))])
    // Only active members of the workspace.
    if (!ids.size) return []
    const { data: active } = await (db as any).from('user_memberships').select('user_id').eq('tenant_id', tenantId).eq('is_active', true).in('user_id', [...ids])
    return ((active ?? []) as any[]).map((r) => String(r.user_id)).slice(0, MEMBER_CAP)
  }
  const { data } = await (db as any).from('user_roles').select('user_id').eq('tenant_id', tenantId).eq('role_id', entry.id).limit(MEMBER_CAP)
  return [...new Set(((data ?? []) as any[]).map((r) => String(r.user_id)))]
}

async function names(db: AnySupabaseClient, tenantId: string, entries: ReadonlyArray<Pick<AudienceEntry, 'type' | 'id'>>, userIds: string[]): Promise<{ principal: Map<string, string>; user: Map<string, string> }> {
  const by = (t: PrincipalType) => [...new Set(entries.filter((e) => e.type === t).map((e) => e.id))]
  const users = [...new Set([...by('user'), ...userIds].filter((id) => UUID_RE.test(id)))]
  const [u, t, r] = await Promise.all([
    users.length ? (db as any).from('users').select('id, display_name, email').in('id', users) : { data: [] },
    by('team').length ? (db as any).from('teams').select('id, name').eq('tenant_id', tenantId).in('id', by('team')) : { data: [] },
    by('role').length ? (db as any).from('roles').select('id, name').eq('tenant_id', tenantId).in('id', by('role')) : { data: [] },
  ])
  const user = new Map<string, string>(((u.data ?? []) as any[]).map((x) => [String(x.id), String(x.display_name || x.email || 'Someone')]))
  const principal = new Map<string, string>()
  for (const id of by('user')) principal.set(`user:${id}`, user.get(id) ?? 'A person')
  for (const x of (t.data ?? []) as any[]) principal.set(`team:${x.id}`, `Team ${x.name}`)
  for (const x of (r.data ?? []) as any[]) principal.set(`role:${x.id}`, `Role ${x.name}`)
  return { principal, user }
}

const roleNeedsIt = (role: AppRole, action: boolean) => !action || role === 'contributor'

/**
 * Who in the audience can't use what the app shows them. `pages` and `menu`
 * are the app as saved, or the builder's unsaved draft.
 */
export async function analyseAppAccess(ctx: ServiceContext, db: AnySupabaseClient, input: {
  audience: readonly AudienceEntry[]
  pages: ReadonlyArray<{ title: string; slug?: string; layout: PageLayout; filters?: ReadonlyArray<{ id: string }> }>
  menu: readonly AppMenuItem[]
  /** App-level parameters, variables and rules. */
  app?: { params: readonly ParamDecl[]; variables: readonly VariableDecl[]; rules: readonly AppRule[] }
}): Promise<AccessAnalysis> {
  const { objects: bound, sources } = appBindings(input.pages, input.menu, input.app?.rules ?? [])
  // One check per object + need + action-ness; remember every place it is used.
  const uses = new Map<string, BoundObject & { places: string[] }>()
  for (const o of bound) {
    const k = `${o.kind}:${o.id}:${o.need}:${o.action}:${o.viewersAllowed ? 'open' : ''}`
    const seen = uses.get(k)
    if (seen) seen.places.push(o.where); else uses.set(k, { ...o, places: [o.where] })
  }
  const sourceUses = new Map<Source, string[]>()
  for (const s of sources) sourceUses.set(s.source, [...(sourceUses.get(s.source) ?? []), s.where])

  const ids = Object.fromEntries(OBJECT_KINDS.map((k) => [k, [] as string[]])) as Record<ObjectKind, string[]>
  for (const o of uses.values()) ids[o.kind].push(o.id)
  const memberLists = await Promise.all(input.audience.map((e) => membersOf(db, ctx.tenantId, e)))
  const allMembers = [...new Set(memberLists.flat())]
  const [objects, grants, people] = await Promise.all([
    loadObjects(db, ctx.tenantId, ids), loadFormGrants(db, ctx.tenantId, ids.form), loadPeople(db, ctx.tenantId, allMembers),
  ])
  const owners = [...new Set((Object.values(objects) as Array<Map<string, ObjectInfo>>).flatMap((m) => [...m.values()].map((o) => o.created_by ?? '')).filter(Boolean))]
  const label = await names(db, ctx.tenantId, input.audience, owners)
  const canGrant = hasPerm(ctx, 'team.change_roles')
  const gaps: AccessGap[] = []

  input.audience.forEach((entry, i) => {
    const members = memberLists[i].map((id) => people.get(id)).filter((p): p is Person => !!p)
    if (!members.length) return
    const principalName = label.principal.get(`${entry.type}:${entry.id}`) ?? entry.type
    const principal = { type: entry.type, id: entry.id, name: principalName, role: entry.role }
    const who = (n: number) => (entry.type === 'user' ? principalName : n === members.length ? `${principalName} (${entry.role}s)` : `${n} of ${members.length} in ${principalName} (${entry.role}s)`)
    const factsOf = (p: Person) => factsFor(p, (perm) => p.permissions.has(perm), objects, grants)

    for (const use of uses.values()) {
      if (!roleNeedsIt(entry.role, use.action)) continue
      const denials = new Map<string, { denial: Exclude<Denial, { allowed: true }>; count: number }>()
      for (const p of members) {
        const d = objectAllowed(factsOf(p), use.kind, use.id, use.need, { viewersAllowed: use.viewersAllowed })
        if (d.allowed) continue
        const k = d.missing === 'permission' ? `permission:${d.permission}` : d.missing
        const prev = denials.get(k)
        if (prev) prev.count++; else denials.set(k, { denial: d, count: 1 })
      }
      const info = objects[use.kind].get(use.id)
      const objName = info?.name ?? `a deleted ${KIND_LABEL[use.kind]}`
      const owner = info?.created_by ? label.user.get(info.created_by) ?? null : null
      for (const [k, { denial, count }] of denials) {
        const subject = who(count)
        const verb = `can’t ${NEED_LABELS[use.need]} ${KIND_LABEL[use.kind]} “${objName}”`
        let message = `${subject} ${verb}`
        let fix: AccessGap['fix']
        if (denial.missing === 'grant') {
          message += ': no View or Submit grant on it.'
          fix = { kind: 'grant', can_grant: canGrant, grant: { object_type: 'form', object_id: use.id, principal_type: entry.type, principal_id: entry.id, can_view: true, can_execute: true } }
        } else if (denial.missing === 'permission') {
          message += `: their role lacks ${PERMISSION_LABELS[denial.permission] ?? denial.permission} (${denial.permission}).`
          fix = { kind: 'ask', who: 'An admin who can manage roles (Settings → Roles)' }
        } else if (denial.missing === 'viewers') {
          message += ': it calls an API with the workspace’s connection, and only people with View integrations see it unless a designer allows app viewers.'
          fix = { kind: 'ask', who: 'A designer with Manage references: turn on “Allow app viewers” in the Card view settings or the rule’s API reference action' }
        } else if (denial.missing === 'shared') {
          message += ': the report isn’t shared with the workspace.'
          fix = { kind: 'ask', who: owner ? `${owner}, who owns the report` : 'The report’s owner' }
        } else {
          message = `${KIND_LABEL[use.kind][0].toUpperCase()}${KIND_LABEL[use.kind].slice(1)} used by the app no longer exists: remove it from the page.`
          fix = { kind: 'ask', who: 'An editor of this app' }
        }
        gaps.push({
          key: `${entry.type}:${entry.id}:${use.kind}:${use.id}:${use.need}:${k}`,
          principal, object: { kind: use.kind, id: use.id, name: objName, owner }, need: use.need, where: use.places,
          affected: count, total: members.length, missing: denial.missing, ...(denial.missing === 'permission' ? { permission: denial.permission } : {}), message, fix,
        })
      }
    }
    for (const [source, places] of sourceUses) {
      const lacking = members.filter((p) => !sourceAllowed({ can: (perm) => p.permissions.has(perm) }, source).allowed)
      if (!lacking.length) continue
      const permission = source === 'tasks' ? 'tasks.view_own' : source === 'org' ? 'org.view' : 'forms.submit'
      const noun = source === 'tasks' ? 'tasks' : source === 'org' ? 'the org chart' : 'form submissions'
      gaps.push({
        key: `${entry.type}:${entry.id}:source:${source}:view:permission:${permission}`,
        principal, object: { kind: 'source', id: source, name: source === 'tasks' ? 'Tasks' : source === 'org' ? 'Org chart' : 'Form submissions', owner: null }, need: 'view', where: places,
        affected: lacking.length, total: members.length, missing: 'permission', permission,
        message: `${who(lacking.length)} can’t see ${noun}: their role lacks ${PERMISSION_LABELS[permission]} (${permission}). Those widgets stay hidden for them.`,
        fix: { kind: 'ask', who: 'An admin who can manage roles (Settings → Roles)' },
      })
    }
  })
  const warnings = [...await paramWarnings(db, ctx.tenantId, input.pages, input.menu, input.app?.rules ?? []), ...rulesWarnings(input.pages, input.app)].slice(0, 100)
  return {
    gaps,
    warnings,
    grantable: gaps.filter((g) => g.fix.kind === 'grant' && g.fix.can_grant).length,
    checked: { entries: input.audience.length, objects: uses.size + sourceUses.size },
  }
}

/** Forms opened by the app whose required parameters nothing passes. */
async function paramWarnings(db: AnySupabaseClient, tenantId: string, pages: ReadonlyArray<{ title: string; layout: PageLayout }>, menu: readonly AppMenuItem[], appRules: readonly AppRule[] = []): Promise<string[]> {
  const uses = formParamUses(pages, menu, appRules).filter((u) => UUID_RE.test(u.form))
  if (!uses.length) return []
  const { data } = await (db as any).from('forms').select('id, name, layout').eq('tenant_id', tenantId).in('id', [...new Set(uses.map((u) => u.form))])
  const forms = new Map(((data ?? []) as any[]).map((f) => [String(f.id), f]))
  const out: string[] = []
  for (const u of uses) {
    const f = forms.get(u.form)
    if (!f) continue
    const missing = unmappedRequired(layoutFormParams(f.layout), u.params)
    if (missing.length) out.push(`${u.where}: form “${f.name}” needs ${missing.join(', ')} — nothing passes ${missing.length === 1 ? 'it' : 'them'}.`)
  }
  return out.slice(0, 50)
}

/**
 * App and page rules that reference what doesn't exist: unknown variables /
 * parameters, widgets or filters not on the page, pages not in the app,
 * required page parameters a rule doesn't pass (lib/apps/rules.ts ruleProblems).
 */
export function rulesWarnings(pages: ReadonlyArray<{ title: string; slug?: string; layout: PageLayout; filters?: ReadonlyArray<{ id: string }> }>, app?: { params: readonly ParamDecl[]; variables: readonly VariableDecl[]; rules: readonly AppRule[] }): string[] {
  const out: string[] = []
  const slugs = pages.map((p) => p.slug).filter((s): s is string => !!s)
  const pageParams = new Map(pages.filter((p) => p.slug).map((p) => [p.slug!, (p.layout.params ?? []).map((d) => ({ name: d.name, required: d.required, hasDefault: d.default !== null && d.default !== undefined && d.default !== '' }))]))
  const appParams = (app?.params ?? []).map((p) => p.name)
  const appVars = (app?.variables ?? []).map((v) => v.name)
  for (const page of pages) {
    const widgets = new Map(page.layout.widgets.map((w) => [w.id, { type: w.type }]))
    const known = {
      params: [...appParams, ...(page.layout.params ?? []).map((p) => p.name)], vars: [...appVars, ...(page.layout.variables ?? []).map((v) => v.name)],
      filters: (page.filters ?? []).map((f) => f.id), widgets, pages: slugs, pageParams,
    }
    for (const p of ruleProblems(page.layout.rules ?? [], known)) out.push(`${page.title} › rule ${p.rule}${p.path ? ` (${p.path})` : ''}: ${p.message}`)
  }
  if (app?.rules.length) {
    // App rules run on every page: only app-level names count; widgets / filters are page-specific (not checked).
    const known = { params: appParams, vars: appVars, filters: [], widgets: new Map<string, { type: string }>(), pages: slugs, pageParams }
    for (const p of ruleProblems(app.rules, known)) {
      if (/is not on this page/.test(p.message)) continue
      out.push(`App rule ${p.rule}${p.path ? ` (${p.path})` : ''}: ${p.message}`)
    }
  }
  return out
}
