/**
 * Admin help: the Agent's admin tools (server only).
 *
 * Every tool is bound to the signed-in person, like the building tools
 * (lib/assistants/tools/designer.ts): writes go through the MCP tool
 * implementations (or, for deactivating a member, lib/services/members), so
 * the same permission checks, service guards and audit apply — the audit rows
 * carry `agent: true` (personMcpContext sets `via: 'agent'`).
 *
 * Least privilege, enforced here and not only in the prompt:
 *  - Only the tools in ADMIN_TOOL_PERMISSIONS exist, each offered only to
 *    people holding its permission (the permission of the MCP tool it calls).
 *  - ADMIN_HARD_EXCLUDED are never offered to anyone, the Owner included:
 *    secrets (API keys, SCIM tokens, webhook secrets, log-destination and
 *    directory credentials, OCR keys, action secrets), the generic role tool,
 *    object grants, the workspace address, provider / price settings. There
 *    is no tool at all for the Agent's own settings or model rules, SSO,
 *    billing, deleting the workspace, transferring ownership or instance
 *    settings — the Agent explains the steps and links to the page instead.
 *  - Guards before any card is shown (a refused change never reaches a card):
 *    never your own roles, teams, manager or deactivation; never grant a
 *    permission you don't hold (roles you create / edit / assign / invite as);
 *    never edit the Owner role or a role you hold yourself; never assign the
 *    Owner role (ownership is changed on the Team page by an owner); never
 *    remove the last owner; never act on someone who holds permissions you
 *    don't.
 *  - Every write shows a confirmation card with before → after; deactivating
 *    a member, deleting a retention policy and legal-hold changes are red
 *    (destructive) cards, deactivation and policy deletion need typed text.
 *  - Read results are passed through redactSecrets.
 */
import { getMcpToolCatalog, type McpToolServer } from '@/lib/mcp/server'
import { requiredToolPermission } from '@/lib/mcp/authz'
import { expandPermissions, holdsPermission, PERMISSION_GROUPS, PERMISSION_KEYS } from '@/lib/permissions'
import { NAV_GROUPS, NAV_PRIMARY, NAV_READ_ONLY_PLACEMENT, NAV_SETTINGS, resolveNavGroups, type NavEntry } from '@/lib/constants'
import { redactSecrets } from '@/lib/agents/safety'
import type { ServiceContext } from '@/lib/services/context'
import type { AssistantToolDef } from '../engine'
import type { ConfirmCard } from '../types'
import { mcpPayload } from './designer'
import { themeCheckError, themeReferenceTool } from './theme-reference'
import { ADMIN_MCP_READ_TOOLS, allowedAdminToolNames } from '../admin-policy'

/* eslint-disable @typescript-eslint/no-explicit-any -- MCP payloads and untyped rows */

export {
  ADMIN_HARD_EXCLUDED, ADMIN_MCP_READ_TOOLS, ADMIN_TOOL_PERMISSIONS, ADMIN_READ_TOOLS, ADMIN_WRITE_TOOLS, allowedAdminToolNames,
} from '../admin-policy'

/* ── Pure guards (tested directly) ── */

/** Permissions in `requested` the person does not hold (implied ones count as held). */
export function permissionsNotHeld(own: ReadonlySet<string>, requested: Iterable<string>): string[] {
  const held = new Set(expandPermissions(own))
  return [...new Set(requested)].filter((p) => !held.has(p)).sort()
}

const PERMISSION_LABEL = new Map<string, string>(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p.key, `${p.label} (${p.key})`] as [string, string])))
export const permissionLabel = (key: string) => PERMISSION_LABEL.get(key) ?? key
const KNOWN = new Set<string>(PERMISSION_KEYS)

export function isOwnerRole(role: { slug?: string | null; is_system?: boolean | null; name?: string | null } | null | undefined): boolean {
  return Boolean(role && role.is_system && role.slug === 'owner')
}

/** "a, b, c and 3 more" */
const quote = (xs: string[], max = 8) => xs.slice(0, max).map((x) => `“${x}”`).join(', ') + (xs.length > max ? ` and ${xs.length - max} more` : '')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const str = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80))

/** Changed leaf values between two objects (dotted paths), at most `max`. */
export function leafDiff(before: unknown, after: unknown, max = 40): Array<{ path: string; before: unknown; after: unknown }> {
  const out: Array<{ path: string; before: unknown; after: unknown }> = []
  const walk = (a: any, b: any, path: string) => {
    if (out.length >= max) return
    const isObj = (v: any) => v && typeof v === 'object' && !Array.isArray(v)
    if (isObj(a) || isObj(b)) {
      const keys = new Set([...Object.keys(isObj(a) ? a : {}), ...Object.keys(isObj(b) ? b : {})])
      for (const k of keys) walk(isObj(a) ? a[k] : undefined, isObj(b) ? b[k] : undefined, path ? `${path}.${k}` : k)
      return
    }
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push({ path, before: a, after: b })
  }
  walk(before, after, '')
  return out
}

function diffPreview(changes: Array<{ path: string; before: unknown; after: unknown }>, caption = 'Before → after'): ConfirmCard['preview'] {
  return { columns: ['Setting', 'Before', 'After'], rows: changes.slice(0, 12).map((c) => [c.path, str(c.before), str(c.after)]), total: changes.length, caption }
}

const reqOf = (item: NavEntry): string | null => ('requiredPermission' in item ? String(item.requiredPermission) : null)

/** The nav menus / items a permission set opens (the side menu's own rule). */
export function navFor(has: (p: string) => boolean) {
  const visible = (item: NavEntry) => item.enabled && (reqOf(item) === null || has(reqOf(item)!))
  const groups = resolveNavGroups((p) => has(p), visible)
  return {
    primary: NAV_PRIMARY.filter(visible).map((i) => i.label),
    groups: groups.map((g) => ({ menu: g.label, items: g.items.map((i) => i.label) })),
    settings: visible(NAV_SETTINGS),
  }
}

/** What opening a menu / page needs: the menu's items and their permissions, or one item. */
export function navRequirement(area: string): { area: string; kind: 'menu' | 'page'; needs_any_of: Array<{ page: string; permission: string }> } | null {
  const q = area.trim().toLowerCase().replace(/\s+menu$/, '')
  if (!q) return null
  const group = NAV_GROUPS.find((g) => g.label.toLowerCase() === q)
  if (group) return { area: group.label, kind: 'menu', needs_any_of: group.items.flatMap((i) => (reqOf(i) ? [{ page: i.label, permission: reqOf(i)! }] : [])) }
  const all: NavEntry[] = [...NAV_PRIMARY, ...NAV_GROUPS.flatMap((g) => g.items), NAV_SETTINGS]
  const item = all.find((i) => i.label.toLowerCase() === q) ?? all.find((i) => i.label.toLowerCase().includes(q) || q.includes(i.label.toLowerCase()))
  if (item) return { area: item.label, kind: 'page', needs_any_of: reqOf(item) ? [{ page: item.label, permission: reqOf(item)! }] : [] }
  return null
}

/* ── The tools ── */

export interface AdminToolsParams {
  /** The person's MCP-bound tool server (createMcpServer with personMcpContext). */
  server: McpToolServer
  permissions: ReadonlySet<string>
  /** The person's service context (service-role client, their permissions, via 'agent'). */
  svc: ServiceContext
  /** Test seam: deactivate a member (lib/services/members deactivateMember). */
  deactivate?: (svc: ServiceContext, userId: string) => Promise<unknown>
}

interface Person { id: string; name: string; email: string | null }
interface RoleRef { id: string; name: string; slug: string | null; is_system: boolean; permissions: string[] }

const ADMIN_HREF: Record<string, string> = {
  invitation: '/settings/invitations', member: '/team', team: '/team', role: '/settings/governance', org: '/org/manage',
  theme: '/settings/theme', sign_in_page: '/settings?tab=forms', task_completion: '/settings?tab=task-completion',
  retention_policy: '/settings/governance?tab=retention', form: '/automations/forms',
}

export function adminTools({ server, permissions, svc, deactivate }: AdminToolsParams): AssistantToolDef[] {
  const catalog = getMcpToolCatalog()
  const byName = new Map(catalog.tools.map((t) => [t.name, t]))
  const actorId = svc.actorId
  const db = svc.supabase as any
  const tenantId = svc.tenantId
  const has = (p: string) => holdsPermission(permissions, p)

  const call = async (name: string, rawArgs: Record<string, any>) => {
    const handler = server.getHandler(name)
    const validator = catalog.inputSchemas.get(name)
    if (!handler || !validator) return { error: `Tool ${name} is not available` }
    const parsed = await (validator as any).safeParseAsync(rawArgs)
    if (!parsed.success) return { error: `Invalid arguments for ${name}: ${String(parsed.error?.message ?? parsed.error).slice(0, 500)}` }
    try { return mcpPayload(await handler(parsed.data)) } catch (error) { return { error: (error as Error)?.message || 'The tool failed' } }
  }
  const must = async (name: string, args: Record<string, any>) => {
    const r = await call(name, args)
    if (r?.error) throw new Error(String(r.error))
    return r
  }

  /* lookups (people need the directory permission) */
  const people = async (): Promise<Array<Person & { display_name: string | null }>> => {
    if (!has('team.view_members') && !has('org.view')) throw new Error('Looking people up needs View members')
    const { data: memberships } = await db.from('user_memberships').select('user_id, is_active').eq('tenant_id', tenantId)
    const ids = ((memberships ?? []) as any[]).filter((m) => m.is_active !== false).map((m) => String(m.user_id))
    if (!ids.length) return []
    const { data: users } = await db.from('users').select('id, display_name, email').in('id', ids)
    return ((users ?? []) as any[]).map((u) => ({ id: String(u.id), display_name: u.display_name ?? null, name: String(u.display_name || u.email || u.id), email: u.email ?? null }))
  }
  const person = async (ref: unknown, what = 'person'): Promise<Person> => {
    const q = String(ref ?? '').trim()
    if (!q) throw new Error(`Say which ${what} (name, email or id)`)
    if (q === 'me' && actorId) { const all = await people(); const me = all.find((p) => p.id === actorId); if (me) return me }
    const all = await people()
    const lower = q.toLowerCase()
    const exact = all.filter((p) => p.id === q || p.email?.toLowerCase() === lower || p.name.toLowerCase() === lower)
    const found = exact.length ? exact : all.filter((p) => p.name.toLowerCase().split(/\s+/).includes(lower) || p.name.toLowerCase().includes(lower) || p.email?.toLowerCase().startsWith(`${lower}@`))
    if (!found.length) throw new Error(`No active member matches “${q}”`)
    if (found.length > 1) throw new Error(`“${q}” matches ${found.length} people (${found.slice(0, 5).map((p) => `${p.name}${p.email ? ` <${p.email}>` : ''}`).join(', ')}) — use their email`)
    return found[0]
  }
  const roles = async (): Promise<RoleRef[]> => {
    const r = await must('roles_list', {})
    return ((r?.roles ?? []) as any[]).map((x) => ({ id: String(x.id), name: String(x.name), slug: x.slug ?? null, is_system: x.is_system === true, permissions: Array.isArray(x.permissions) ? x.permissions.map(String) : [] }))
  }
  const role = async (ref: unknown): Promise<RoleRef> => {
    const q = String(ref ?? '').trim().toLowerCase()
    if (!q) throw new Error('Say which role')
    const all = await roles()
    const found = all.find((r) => r.id === ref || r.slug?.toLowerCase() === q || r.name.toLowerCase() === q) ?? all.find((r) => r.name.toLowerCase().includes(q))
    if (!found) throw new Error(`No role matches “${String(ref)}” (roles: ${all.map((r) => r.name).join(', ')})`)
    return found
  }
  const teamsOf = async (): Promise<Array<{ id: string; name: string }>> => {
    const r = await must('teams_list', {})
    return ((r?.teams ?? []) as any[]).map((t) => ({ id: String(t.id), name: String(t.name) }))
  }
  const team = async (ref: unknown) => {
    const q = String(ref ?? '').trim().toLowerCase()
    if (!q) throw new Error('Say which team')
    const all = await teamsOf()
    const found = all.find((t) => t.id === ref || t.name.toLowerCase() === q) ?? all.find((t) => t.name.toLowerCase().includes(q))
    if (!found) throw new Error(`No team matches “${String(ref)}”${all.length ? ` (teams: ${all.slice(0, 12).map((t) => t.name).join(', ')})` : ''}`)
    return found
  }
  const rolesOfUser = async (userId: string): Promise<RoleRef[]> => {
    const all = await roles()
    const { data } = await db.from('user_roles').select('role_id').eq('tenant_id', tenantId).eq('user_id', userId)
    const ids = new Set(((data ?? []) as any[]).map((r) => String(r.role_id)))
    return all.filter((r) => ids.has(r.id))
  }
  const teamIdsOfUser = async (userId: string): Promise<string[]> => {
    const all = await teamsOf().catch(() => [])
    if (!all.length) return []
    const { data } = await db.from('user_teams').select('team_id').eq('user_id', userId).in('team_id', all.map((t) => t.id))
    return ((data ?? []) as any[]).map((r) => String(r.team_id))
  }
  const unionOf = (rs: RoleRef[]) => new Set(expandPermissions(rs.flatMap((r) => r.permissions)))
  const ownerIds = async (): Promise<string[]> => {
    const { activeOwnerIds } = await import('@/lib/services/members')
    return activeOwnerIds(svc)
  }
  const notSelf = (userId: string, what: string) => { if (actorId && userId === actorId) throw new Error(`You can't change your own ${what} with the Agent — ask another admin`) }
  const notOutranked = async (p: Person) => {
    const beyond = permissionsNotHeld(permissions, unionOf(await rolesOfUser(p.id)))
    if (beyond.length) throw new Error(`${p.name} holds permissions you don't (${beyond.slice(0, 5).join(', ')}${beyond.length > 5 ? '…' : ''}) — only someone with at least their access can change their access`)
  }
  /** Object grants to a team / role / person, counted per object type ("3 workflows, 1 form"). */
  const grantsVia = async (column: 'team_id' | 'role_id' | 'user_id', ids: string[]): Promise<string | null> => {
    if (!ids.length) return null
    const { data } = await db.from('object_permissions').select('object_type, object_id').eq('tenant_id', tenantId).in(column, ids)
    const counts = new Map<string, number>()
    for (const g of (data ?? []) as any[]) counts.set(String(g.object_type), (counts.get(String(g.object_type)) ?? 0) + 1)
    if (!counts.size) return null
    return [...counts].map(([t, n]) => plural(n, t.replace(/_/g, ' '))).join(', ')
  }

  const out: AssistantToolDef[] = []
  const allowed = new Set(allowedAdminToolNames(permissions))
  const add = (def: AssistantToolDef) => { if (allowed.has(def.name)) out.push(def) }
  const changed = (env: Parameters<AssistantToolDef['run']>[1], kind: string, id: string | null, title: string, action: 'created' | 'updated' | 'deleted') => {
    env.emit({ type: 'changed', kind, id, title, href: ADMIN_HREF[kind] ?? null, action })
  }
  const schemaOf = (name: string, drop: string[] = []): Record<string, unknown> => {
    const schema = JSON.parse(JSON.stringify(byName.get(name)?.inputSchema ?? { type: 'object', properties: {} }))
    delete schema.$schema
    for (const k of drop) { if (schema.properties) delete schema.properties[k]; if (Array.isArray(schema.required)) schema.required = schema.required.filter((r: string) => r !== k) }
    schema.type = 'object'
    schema.properties ??= {}
    return schema
  }
  const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required })
  const S = (description: string) => ({ type: 'string', description })

  /* ── MCP reads (each with its own view permission) ── */
  for (const name of ADMIN_MCP_READ_TOOLS) {
    const def = byName.get(name)
    if (!def) continue
    add({
      name,
      description: String(def.description ?? name),
      parameters: schemaOf(name),
      mode: 'read',
      label: () => (name.startsWith('org_') ? 'Reading the org structure' : name.startsWith('retention') ? 'Reading retention policies' : name.includes('audit') || name === 'events_list' ? 'Reading the audit log' : name.startsWith('log_destinations') || name.startsWith('directory_sync') ? 'Checking integrations' : name.includes('usage') ? 'Reading usage' : name.startsWith('workspace_theme') || name.startsWith('form_sign_in') || name.startsWith('task_completion') ? 'Reading settings' : 'Looking up people and access'),
      run: async (args) => {
        const payload = await call(name, args)
        return { result: redactSecrets(payload), ok: !payload?.error }
      },
    })
  }

  /* ── explain_access ── */
  add({
    name: 'explain_access',
    description: 'Explain one person\'s effective access, read-only: their roles (with permissions), teams, the menus and pages they can open, and — with area (a menu such as "Build" or a page such as "Reports") or permission — whether they have it, what is missing and which roles would give it. Object grants to them, their teams or roles are counted when you can see grants. Use for "why can\'t Tom see the Build menu?" or "what can Chloe do?".',
    parameters: obj({ person: S('Name, email or user id'), area: S('A menu (Build, Operate, People, Govern) or page (Reports, Data, Settings…)'), permission: S('A permission key, e.g. reports.view') }, ['person']),
    mode: 'read',
    label: () => 'Explaining access',
    run: async (args) => {
      const p = await person(args.person)
      const [rs, teamIds, allRoles] = await Promise.all([rolesOfUser(p.id), teamIdsOfUser(p.id), roles()])
      const perms = unionOf(rs)
      const hasP = (x: string) => holdsPermission(perms, x)
      const teams = (await teamsOf().catch(() => [])).filter((t) => teamIds.includes(t.id)).map((t) => t.name)
      const result: Record<string, unknown> = {
        person: { id: p.id, name: p.name, email: p.email },
        roles: rs.map((r) => ({ name: r.name, system: r.is_system, permissions: r.permissions.length })),
        teams,
        permissions: [...perms].sort(),
        can_open: navFor(hasP),
        note: 'Permissions come from roles (the union of every role the person holds). Teams do not add permissions; they receive object grants (view / edit / submit on specific workflows, forms, tables). Changes take effect on the person\'s next page load.',
      }
      const rolesGiving = (perm: string) => allRoles.filter((r) => expandPermissions(r.permissions).includes(perm)).map((r) => r.name)
      if (args.area) {
        const req = navRequirement(String(args.area))
        if (!req) result.area = { asked: args.area, note: 'Not a menu or page name I know — ask the person which menu or page they mean.' }
        else {
          const nav = navFor(hasP)
          const menu = req.kind === 'menu' ? nav.groups.find((g) => g.menu === req.area) : null
          const holding = req.needs_any_of.filter((n) => hasP(n.permission))
          const canSee = req.kind === 'menu' ? Boolean(menu) : !req.needs_any_of.length || holding.length > 0
          const placement = (page: string) => {
            const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.label === page)
            const rule = item ? NAV_READ_ONLY_PLACEMENT[item.href] : undefined
            return rule ? { shows_under_another_menu_without_any_of: [...rule.authorPerms] } : {}
          }
          result.area = {
            ...req,
            can_see: canSee,
            ...(menu ? { items_they_see: menu.items } : {}),
            missing: canSee ? [] : req.needs_any_of.map((n) => ({ page: n.page, permission: n.permission, label: permissionLabel(n.permission), held: hasP(n.permission), roles_that_give_it: rolesGiving(n.permission), ...placement(n.page) })),
            ...(!canSee && req.kind === 'menu' && holding.length ? { note: `They can open ${holding.map((h) => h.page).join(', ')}, but read-only pages move to another menu (Operate / People) for people who can't change them.` } : {}),
          }
        }
      }
      if (args.permission) {
        const key = String(args.permission).trim()
        result.permission = { key, label: permissionLabel(key), holds: hasP(key), via_roles: rs.filter((r) => expandPermissions(r.permissions).includes(key)).map((r) => r.name), roles_that_give_it: rolesGiving(key) }
      }
      if (has('team.change_roles')) {
        result.object_grants = {
          to_person: await grantsVia('user_id', [p.id]),
          via_teams: await grantsVia('team_id', teamIds),
          via_roles: await grantsVia('role_id', rs.map((r) => r.id)),
        }
      }
      return { result }
    },
  })

  /* ── who_has_access ── */
  add({
    name: 'who_has_access',
    description: 'Who has access, read-only: to a permission (key) or a menu / page (area) — the roles that give it and the active members holding them; or to one object (object_type + object_id: workflow, form, data_table…) — its explicit grants (role / team / person; needs Manage roles) plus the roles whose permission covers it. For "who can approve purchase requests?" first find the workflow and its approval step (workflows_get) — the assignee there is who approves; this tool answers who can open / edit it.',
    parameters: obj({ permission: S('A permission key, e.g. workflows.edit'), area: S('A menu or page, e.g. Reports'), object_type: S('workflow, form, data_table, report, decision_table…'), object_id: S('The object id') }),
    mode: 'read',
    label: () => 'Finding who has access',
    run: async (args) => {
      const allRoles = await roles()
      const members = await people()
      const { data: assignments } = await db.from('user_roles').select('user_id, role_id').eq('tenant_id', tenantId)
      const holdersOf = (roleIds: string[]) => {
        const ids = new Set(((assignments ?? []) as any[]).filter((a) => roleIds.includes(String(a.role_id))).map((a) => String(a.user_id)))
        return members.filter((m) => ids.has(m.id)).map((m) => `${m.name}${m.email ? ` <${m.email}>` : ''}`)
      }
      const forPermission = (perm: string) => {
        const giving = allRoles.filter((r) => expandPermissions(r.permissions).includes(perm))
        const holders = holdersOf(giving.map((r) => r.id))
        return { permission: perm, label: permissionLabel(perm), roles: giving.map((r) => r.name), people: holders.slice(0, 100), people_count: holders.length }
      }
      const result: Record<string, unknown> = {}
      if (args.permission) result.permission = forPermission(String(args.permission).trim())
      if (args.area) {
        const req = navRequirement(String(args.area))
        result.area = req ? { ...req, by_permission: req.needs_any_of.map((n) => forPermission(n.permission)) } : { asked: args.area, note: 'Unknown menu or page' }
      }
      if (args.object_type && args.object_id) {
        const base: Record<string, string> = { workflow: 'workflows.view', form: 'forms.view', data_table: 'data.view', report: 'reports.view', decision_table: 'workflows.view', agent: 'agents.view', integration: 'integrations.view' }
        const perm = base[String(args.object_type)]
        result.object = {
          object_type: args.object_type, object_id: args.object_id,
          ...(perm ? { everyone_with_permission: forPermission(perm) } : {}),
          grants: has('team.change_roles') ? redactSecrets(await call('object_permissions_list', { object_type: args.object_type, object_id: args.object_id })) : 'Explicit grants need Manage roles (team.change_roles) to read',
        }
      }
      if (!Object.keys(result).length) throw new Error('Give a permission, an area or an object (object_type + object_id)')
      return { result }
    },
  })

  /* ── workspace_health ── */
  add({
    name: 'workspace_health',
    description: 'Workspace health, read-only: failed workflow runs (count and the latest), dead queue jobs (gave up after retries), runs past their SLA, webhook dead letters (with Manage webhooks) — over the last `days` (default 7).',
    parameters: obj({ days: { type: 'number', description: 'Look back this many days (1–90, default 7)' } }),
    mode: 'read',
    label: () => 'Checking workspace health',
    run: async (args) => {
      const days = Math.min(90, Math.max(1, Math.floor(Number(args.days) || 7)))
      const since = new Date(Date.now() - days * 86_400_000).toISOString()
      const count = async (q: any) => { const { count: n } = await q; return Number(n ?? 0) }
      const [failed, failedLatest, dead, deadLatest, breached] = await Promise.all([
        count(db.from('workflow_runs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'failed').gte('started_at', since)),
        db.from('workflow_runs').select('id, status, started_at, error, title, workflow:workflows(id, name)').eq('tenant_id', tenantId).eq('status', 'failed').gte('started_at', since).order('started_at', { ascending: false }).limit(5),
        count(db.from('workflow_queue').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'dead').gte('created_at', since)),
        db.from('workflow_queue').select('id, created_at, error, attempts, workflow:workflows!workflow_queue_workflow_id_fkey(id, name)').eq('tenant_id', tenantId).eq('status', 'dead').gte('created_at', since).order('created_at', { ascending: false }).limit(5),
        db.from('workflow_runs').select('id, title, sla_label, sla_due_at, status, workflow:workflows(id, name)').eq('tenant_id', tenantId).eq('sla_status', 'breached').in('status', ['running', 'waiting', 'paused']).order('sla_due_at', { ascending: true }).limit(10),
      ])
      const one = (w: any) => (Array.isArray(w) ? w[0] : w)
      const result: Record<string, unknown> = {
        period_days: days,
        failed_runs: { count: failed, latest: ((failedLatest.data ?? []) as any[]).map((r) => ({ id: r.id, workflow: one(r.workflow)?.name ?? null, title: r.title ?? null, at: r.started_at, error: String(r.error ?? '').slice(0, 200), href: `/automations/runs/${r.id}` })) },
        dead_jobs: { count: dead, latest: ((deadLatest.data ?? []) as any[]).map((j) => ({ id: j.id, workflow: one(j.workflow)?.name ?? null, at: j.created_at, attempts: j.attempts, error: String(j.error ?? '').slice(0, 200) })), href: '/automations/queue' },
        sla_breaches_open: ((breached.data ?? []) as any[]).map((r) => ({ id: r.id, workflow: one(r.workflow)?.name ?? null, title: r.title ?? null, sla: r.sla_label ?? null, due: r.sla_due_at, status: r.status })),
      }
      if (has('settings.manage_webhooks')) {
        result.webhook_dead_letters = await count(db.from('dead_letter_events').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('created_at', since))
      }
      return { result: redactSecrets(result) }
    },
  })

  /* ── agent_usage ── */
  add({
    name: 'agent_usage',
    description: 'The Agent\'s (this assistant\'s) usage and cost, read-only: messages, tokens and cost per currency over `days` (default 30), this calendar month, per help group and the top people. For AI agents used in workflows call agents_workspace_usage_get.',
    parameters: obj({ days: { type: 'number', description: '1–90, default 30' } }),
    mode: 'read',
    label: () => 'Reading Agent usage',
    run: async (args) => {
      const days = Math.min(90, Math.max(1, Math.floor(Number(args.days) || 30)))
      const since = new Date(Date.now() - days * 86_400_000).toISOString()
      const { data } = await db.from('assistant_usage').select('user_id, capability, status, total_tokens, cost_amount, cost_currency, cost_status, created_at').eq('tenant_id', tenantId).gte('created_at', since).limit(50_000)
      const rows = (data ?? []) as any[]
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
      const cost = (rs: any[]) => {
        const m = new Map<string, number>()
        for (const r of rs) if (r.cost_amount !== null && r.cost_amount !== undefined) m.set(String(r.cost_currency ?? 'USD'), (m.get(String(r.cost_currency ?? 'USD')) ?? 0) + Number(r.cost_amount))
        return Object.fromEntries([...m].map(([c, v]) => [c, Math.round(v * 100) / 100]))
      }
      const byUser = new Map<string, number>()
      for (const r of rows) if (r.user_id) byUser.set(String(r.user_id), (byUser.get(String(r.user_id)) ?? 0) + 1)
      const top = [...byUser].sort((a, b) => b[1] - a[1]).slice(0, 5)
      const names = new Map<string, string>()
      if (top.length) {
        const { data: us } = await db.from('users').select('id, display_name, email').in('id', top.map(([id]) => id))
        for (const u of (us ?? []) as any[]) names.set(String(u.id), String(u.display_name || u.email))
      }
      const byGroup: Record<string, number> = {}
      for (const r of rows) byGroup[String(r.capability)] = (byGroup[String(r.capability)] ?? 0) + 1
      return { result: {
        period_days: days,
        messages: rows.length,
        tokens: rows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0),
        cost: cost(rows),
        unpriced_messages: rows.filter((r) => r.cost_status !== 'priced').length,
        this_month: { messages: rows.filter((r) => r.created_at >= monthStart).length, cost: cost(rows.filter((r) => r.created_at >= monthStart)) },
        by_help_group: byGroup,
        note: 'Admin help turns are counted under "designer" (building help).',
        top_people: top.map(([id, n]) => ({ name: names.get(id) ?? id, messages: n })),
        settings_page: '/settings/assistants',
      } }
    },
  })

  /* ── settings_overview ── */
  const SETTINGS_PAGES: Record<string, { tools: string[]; href: string; about: string }> = {
    general: { tools: [], href: '/settings?tab=general', about: 'Workspace name, address and logo.' },
    theme: { tools: ['workspace_theme_get'], href: '/settings/theme', about: 'The workspace theme every member sees: colours (light / dark), fonts, shape, density, sidebar and top bar style, logos.' },
    sign_in_page: { tools: ['form_sign_in_page_get'], href: '/settings?tab=forms', about: 'The page visitors see when a form link needs them to sign in.' },
    task_completion: { tools: ['task_completion_settings_get'], href: '/settings?tab=task-completion', about: 'The Task completed screen: whether it shows, its texts and buttons.' },
    retention: { tools: ['retention_policies_list'], href: '/settings/governance?tab=retention', about: 'Retention policies: how long tables, rows, roles and form submissions are kept, and legal holds.' },
    log_export: { tools: ['log_destinations_list'], href: '/settings/log-export', about: 'Where the event stream is shipped (Splunk, Datadog, OTLP, webhook…), with delivery status. Credentials are never shown.' },
    directory_sync: { tools: ['directory_sync_list'], href: '/settings/sso', about: 'Directory connections (Entra ID, Okta, LDAP, Google, SCIM) and their last sync. SSO and credentials are changed only on the page.' },
    governance: { tools: ['roles_list'], href: '/settings/governance', about: 'Roles and their permissions, user role assignments, retention and the permission audit log.' },
  }
  add({
    name: 'settings_overview',
    description: `The current values of a settings page, read-only, to explain what each setting does and how it is set now. page: ${Object.keys(SETTINGS_PAGES).join(', ')}. Secrets are never included.`,
    parameters: obj({ page: { type: 'string', enum: Object.keys(SETTINGS_PAGES) } }, ['page']),
    mode: 'read',
    label: () => 'Reading the settings',
    run: async (args) => {
      const page = SETTINGS_PAGES[String(args.page)]
      if (!page) throw new Error(`Unknown page — one of ${Object.keys(SETTINGS_PAGES).join(', ')}`)
      const values: Record<string, unknown> = {}
      for (const t of page.tools) values[t] = has(requiredToolPermission(t) ?? 'settings.view') ? await call(t, {}) : 'You can\'t view this'
      if (args.page === 'general') {
        const { data } = await db.from('tenants').select('name, slug, custom_domain, created_at').eq('id', tenantId).maybeSingle()
        values.workspace = data ? { name: data.name, address: data.slug, custom_domain: data.custom_domain ?? null, created_at: data.created_at } : null
      }
      return { result: redactSecrets({ page: args.page, about: page.about, href: page.href, values }) }
    },
  })

  /* ── Team and members ── */
  add({
    name: 'invite_member',
    description: 'Invite someone by email with a workspace role (admin, manager, member or viewer). The invitation link is emailed (valid 7 days). People can be added to teams once they have accepted. Never Owner, and never a role with permissions you don\'t hold.',
    parameters: obj({ email: S('Email address'), role: S('admin, manager, member or viewer (default member)') }, ['email']),
    mode: 'write',
    label: (a) => `Inviting ${String(a.email ?? '')}`,
    confirm: async (a) => {
      const email = String(a.email ?? '').trim().toLowerCase()
      const slug = String(a.role ?? 'member').trim().toLowerCase()
      if (slug === 'owner') throw new Error('The Agent can\'t invite owners — invite them as Admin, then an owner can make them an owner on the Team page')
      if (!['admin', 'manager', 'member', 'viewer'].includes(slug)) throw new Error('Role must be admin, manager, member or viewer')
      const r = (await roles()).find((x) => x.is_system && x.slug === slug)
      if (r) {
        const beyond = permissionsNotHeld(permissions, r.permissions)
        if (beyond.length) throw new Error(`The ${r.name} role has permissions you don't hold (${beyond.slice(0, 5).join(', ')}) — you can only invite people with at most your own access`)
      }
      return {
        title: `Invite ${email} as ${r?.name ?? slug}`,
        lines: [`Role: ${r?.name ?? slug}${r ? ` — ${plural(r.permissions.length, 'permission')}` : ''}`, 'An invitation email is sent; the link is valid for 7 days', 'Team memberships can be added once they accept'],
        warnings: slug === 'admin' ? ['Admins can manage members, roles and settings'] : [],
      }
    },
    run: async (a, env) => {
      const r = await call('invitations_send', { email: String(a.email ?? '').trim(), role: String(a.role ?? 'member').trim().toLowerCase() })
      if (r?.error) return { result: r, ok: false }
      changed(env, 'invitation', r?.invitation?.id ?? null, `Invitation for ${String(a.email)}`, 'created')
      return { result: r }
    },
  })

  add({
    name: 'add_team_member',
    description: 'Add an active member to a team (teams route tasks and receive object grants). Not yourself.',
    parameters: obj({ team: S('Team name or id'), person: S('Name, email or user id') }, ['team', 'person']),
    mode: 'write',
    label: () => 'Adding to the team',
    confirm: async (a) => {
      const [t, p] = await Promise.all([team(a.team), person(a.person)])
      notSelf(p.id, 'teams')
      const grants = await grantsVia('team_id', [t.id])
      return { title: `Add ${p.name} to ${t.name}`, lines: [`${p.name}${p.email ? ` <${p.email}>` : ''} joins “${t.name}”`, ...(grants ? [`Gains what is shared with the team: ${grants}`] : [])], warnings: [] }
    },
    run: async (a, env) => {
      const [t, p] = await Promise.all([team(a.team), person(a.person)])
      notSelf(p.id, 'teams')
      const r = await call('teams_add_member', { team_id: t.id, user_id: p.id })
      if (r?.error) return { result: r, ok: false }
      changed(env, 'team', t.id, `${p.name} in ${t.name}`, 'updated')
      return { result: r }
    },
  })

  add({
    name: 'create_team',
    description: 'Create a team (for task routing and grants), optionally under a parent team with a lead.',
    parameters: obj({ name: S('Team name'), description: S('Optional'), parent: S('Parent team name or id'), lead: S('Team lead (name, email or id)') }, ['name']),
    mode: 'write',
    label: (a) => `Creating team “${String(a.name ?? '')}”`,
    confirm: async (a) => {
      const parent = a.parent ? await team(a.parent) : null
      const lead = a.lead ? await person(a.lead) : null
      return { title: `Create team “${String(a.name)}”`, lines: [...(parent ? [`Under “${parent.name}”`] : []), ...(lead ? [`Lead: ${lead.name}`] : []), ...(a.description ? [`Description: ${String(a.description).slice(0, 120)}`] : [])], warnings: [] }
    },
    run: async (a, env) => {
      const parent = a.parent ? await team(a.parent) : null
      const lead = a.lead ? await person(a.lead) : null
      const r = await call('teams_create', { name: String(a.name), ...(a.description ? { description: String(a.description) } : {}), ...(parent ? { parent_id: parent.id } : {}), ...(lead ? { lead_user_id: lead.id } : {}) })
      if (r?.error) return { result: r, ok: false }
      changed(env, 'team', r?.team?.id ?? null, String(a.name), 'created')
      return { result: r }
    },
  })

  add({
    name: 'remove_team_member',
    description: 'Remove a member from a team. They lose what is shared with the team (the card lists it). Not yourself.',
    parameters: obj({ team: S('Team name or id'), person: S('Name, email or user id') }, ['team', 'person']),
    mode: 'write',
    label: () => 'Removing from the team',
    confirm: async (a) => {
      const [t, p] = await Promise.all([team(a.team), person(a.person)])
      notSelf(p.id, 'teams')
      const grants = await grantsVia('team_id', [t.id])
      return { title: `Remove ${p.name} from ${t.name}`, lines: [`${p.name} leaves “${t.name}”`], warnings: [grants ? `This removes their access to what is shared with the team: ${grants}` : 'Nothing is shared with this team, so no object access changes', 'Tasks routed to the team no longer reach them'] }
    },
    run: async (a, env) => {
      const [t, p] = await Promise.all([team(a.team), person(a.person)])
      notSelf(p.id, 'teams')
      const r = await call('teams_remove_member', { team_id: t.id, user_id: p.id })
      if (r?.error) return { result: r, ok: false }
      changed(env, 'team', t.id, `${p.name} left ${t.name}`, 'updated')
      return { result: r }
    },
  })

  add({
    name: 'deactivate_member',
    description: 'Deactivate a member: they lose access to this workspace at once (their roles here are removed; API keys and OAuth tokens stop working). Their account and work are kept; invite them again to restore access. Destructive — the person must type the confirmation. Never yourself, never the last owner, never someone with permissions you don\'t hold.',
    parameters: obj({ person: S('Name, email or user id') }, ['person']),
    mode: 'write',
    label: () => 'Deactivating the member',
    confirm: async (a) => {
      const p = await person(a.person)
      notSelf(p.id, 'membership')
      const rs = await rolesOfUser(p.id)
      const owners = await ownerIds()
      if (owners.includes(p.id) && owners.length <= 1) throw new Error(`${p.name} is the workspace's last owner — make someone else an owner first`)
      await notOutranked(p)
      const teamIds = await teamIdsOfUser(p.id)
      const grants = [await grantsVia('user_id', [p.id]), await grantsVia('team_id', teamIds)].filter(Boolean).join('; ')
      const typed = `deactivate ${p.email ?? p.name}`
      return {
        title: `Deactivate ${p.name}`,
        lines: [`${p.name}${p.email ? ` <${p.email}>` : ''} loses access to this workspace now`, `Roles removed: ${rs.length ? quote(rs.map((r) => r.name)) : 'none'}`, 'Their account, tasks and history are kept; inviting them again restores access'],
        warnings: [`Loses ${plural(unionOf(rs).size, 'permission')}${grants ? ` and access shared with them or their teams (${grants})` : ''}`, 'Their API keys and OAuth tokens stop working', 'Open tasks assigned to them stay with them until reassigned'],
        danger: true,
        confirm_label: `Deactivate ${p.name}`,
        typed_confirm: typed,
      }
    },
    run: async (a, env) => {
      const p = await person(a.person)
      notSelf(p.id, 'membership')
      const fn = deactivate ?? (async (s: ServiceContext, id: string) => (await import('@/lib/services/members')).deactivateMember(s, id))
      try {
        const r = await fn(svc, p.id)
        changed(env, 'member', p.id, p.name, 'updated')
        return { result: r }
      } catch (error) {
        return { result: { error: (error as Error)?.message ?? 'Could not deactivate' }, ok: false }
      }
    },
  })

  /* ── Roles ── */
  const permList = (keys: string[]) => quote(keys.map(permissionLabel), 12)
  add({
    name: 'assign_role',
    description: 'Give a member a role (roles add up: a person has the union of their roles\' permissions). Never yourself, never the Owner role, never a role with permissions you don\'t hold.',
    parameters: obj({ person: S('Name, email or user id'), role: S('Role name, slug or id') }, ['person', 'role']),
    mode: 'write',
    label: () => 'Assigning the role',
    confirm: async (a) => {
      const [p, r] = await Promise.all([person(a.person), role(a.role)])
      notSelf(p.id, 'roles')
      if (isOwnerRole(r)) throw new Error('The Agent never assigns the Owner role (that is a change of ownership) — an owner does it on the Team / Governance page')
      const beyond = permissionsNotHeld(permissions, r.permissions)
      if (beyond.length) throw new Error(`“${r.name}” has permissions you don't hold (${beyond.slice(0, 5).join(', ')}) — you can't grant more than your own access`)
      const before = await rolesOfUser(p.id)
      if (before.some((x) => x.id === r.id)) throw new Error(`${p.name} already has “${r.name}”`)
      const gained = [...unionOf([...before, r])].filter((x) => !unionOf(before).has(x)).sort()
      return { title: `Give ${p.name} the ${r.name} role`, lines: [`Roles: ${before.map((x) => x.name).join(', ') || 'none'} → ${[...before.map((x) => x.name), r.name].join(', ')}`, gained.length ? `New permissions: ${permList(gained)}` : 'No new permissions (their roles already cover it)'], warnings: [] }
    },
    run: async (a, env) => {
      const [p, r] = await Promise.all([person(a.person), role(a.role)])
      notSelf(p.id, 'roles')
      if (isOwnerRole(r) || permissionsNotHeld(permissions, r.permissions).length) return { result: { error: 'Not allowed' }, ok: false }
      const res = await call('roles_manage', { action: 'assign_role', user_id: p.id, role_id: r.id })
      if (res?.error) return { result: res, ok: false }
      changed(env, 'role', r.id, `${p.name}: ${r.name}`, 'updated')
      return { result: res }
    },
  })

  add({
    name: 'remove_role',
    description: 'Take a role away from a member (the card lists the permissions they lose). Never yourself, never the last owner, never someone with permissions you don\'t hold; only owners change owners.',
    parameters: obj({ person: S('Name, email or user id'), role: S('Role name, slug or id') }, ['person', 'role']),
    mode: 'write',
    label: () => 'Removing the role',
    confirm: async (a) => {
      const [p, r] = await Promise.all([person(a.person), role(a.role)])
      notSelf(p.id, 'roles')
      const before = await rolesOfUser(p.id)
      if (!before.some((x) => x.id === r.id)) throw new Error(`${p.name} doesn't have “${r.name}”`)
      if (isOwnerRole(r)) {
        const owners = await ownerIds()
        if (owners.length <= 1) throw new Error(`${p.name} is the workspace's last owner — the Owner role can't be removed`)
        if (!actorId || !owners.includes(actorId)) throw new Error('Only an owner can remove the Owner role')
      }
      await notOutranked(p)
      const after = before.filter((x) => x.id !== r.id)
      const lost = [...unionOf(before)].filter((x) => !unionOf(after).has(x)).sort()
      const grants = await grantsVia('role_id', [r.id])
      return {
        title: `Remove the ${r.name} role from ${p.name}`,
        lines: [`Roles: ${before.map((x) => x.name).join(', ')} → ${after.map((x) => x.name).join(', ') || 'none'}`],
        warnings: [lost.length ? `Loses ${plural(lost.length, 'permission')}: ${permList(lost)}` : 'No permissions are lost (their other roles cover them)', ...(grants ? [`Also loses what is shared with the ${r.name} role: ${grants}`] : []), ...(after.length ? [] : ['They will have no role: they can sign in but see almost nothing'])],
      }
    },
    run: async (a, env) => {
      const [p, r] = await Promise.all([person(a.person), role(a.role)])
      notSelf(p.id, 'roles')
      if (isOwnerRole(r)) { const owners = await ownerIds(); if (owners.length <= 1 || !actorId || !owners.includes(actorId)) return { result: { error: 'The last owner can\'t lose the Owner role' }, ok: false } }
      const res = await call('roles_manage', { action: 'remove_role', user_id: p.id, role_id: r.id })
      if (res?.error) return { result: res, ok: false }
      changed(env, 'role', r.id, `${p.name}: without ${r.name}`, 'updated')
      return { result: res }
    },
  })

  const cleanPerms = (v: unknown): { known: string[]; unknown: string[] } => {
    const list = Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []
    return { known: [...new Set(list.filter((p) => KNOWN.has(p)))], unknown: list.filter((p) => !KNOWN.has(p)) }
  }
  add({
    name: 'create_role',
    description: 'Create a custom role with permission keys (see roles_list for existing roles and keys). You can only include permissions you hold yourself.',
    parameters: obj({ name: S('Role name'), description: S('Optional'), permissions: { type: 'array', items: { type: 'string' }, description: 'Permission keys, e.g. reports.view' } }, ['name', 'permissions']),
    mode: 'write',
    label: (a) => `Creating role “${String(a.name ?? '')}”`,
    confirm: async (a) => {
      const { known, unknown } = cleanPerms(a.permissions)
      const beyond = permissionsNotHeld(permissions, known)
      if (beyond.length) throw new Error(`You can't create a role with permissions you don't hold: ${beyond.join(', ')}`)
      if ((await roles()).some((r) => r.name.toLowerCase() === String(a.name).trim().toLowerCase())) throw new Error(`A role named “${a.name}” already exists — edit it with update_role`)
      return { title: `Create role “${String(a.name)}”`, lines: [`${plural(known.length, 'permission')}: ${permList(known)}`, ...(a.description ? [`Description: ${String(a.description).slice(0, 140)}`] : []), 'Nobody has the role until you assign it'], warnings: unknown.length ? [`Unknown permission keys are ignored: ${unknown.join(', ')}`] : [] }
    },
    run: async (a, env) => {
      const { known } = cleanPerms(a.permissions)
      if (permissionsNotHeld(permissions, known).length) return { result: { error: 'Not allowed' }, ok: false }
      const res = await call('roles_manage', { action: 'create_role', role_name: String(a.name).trim(), ...(a.description ? { description: String(a.description) } : {}), permissions: known })
      if (res?.error) return { result: res, ok: false }
      changed(env, 'role', res?.role?.id ?? null, String(a.name), 'created')
      return { result: res }
    },
  })

  const nextPermissions = (r: RoleRef, a: Record<string, any>): { next: string[]; unknown: string[] } => {
    if (Array.isArray(a.permissions)) { const c = cleanPerms(a.permissions); return { next: c.known, unknown: c.unknown } }
    const addP = cleanPerms(a.add_permissions)
    const rem = cleanPerms(a.remove_permissions)
    const next = [...new Set([...r.permissions, ...addP.known])].filter((p) => !rem.known.includes(p))
    return { next, unknown: [...addP.unknown, ...rem.unknown] }
  }
  add({
    name: 'update_role',
    description: 'Edit a role: rename (custom roles), describe, or change permissions (permissions = the full new list, or add_permissions / remove_permissions). The card shows the permission diff and who is affected. Never the Owner role, never a role you hold yourself, never adding permissions you don\'t hold.',
    parameters: obj({ role: S('Role name, slug or id'), name: S('New name (custom roles only)'), description: S('New description'), permissions: { type: 'array', items: { type: 'string' } }, add_permissions: { type: 'array', items: { type: 'string' } }, remove_permissions: { type: 'array', items: { type: 'string' } } }, ['role']),
    mode: 'write',
    label: () => 'Updating the role',
    confirm: async (a) => {
      const r = await role(a.role)
      if (isOwnerRole(r)) throw new Error('The Owner role can\'t be edited')
      const holders = await (async () => { const { data } = await db.from('user_roles').select('user_id').eq('tenant_id', tenantId).eq('role_id', r.id); return ((data ?? []) as any[]).map((x) => String(x.user_id)) })()
      if (actorId && holders.includes(actorId)) throw new Error(`You hold “${r.name}” yourself — the Agent never changes your own permissions; ask another admin`)
      const { next, unknown } = nextPermissions(r, a)
      const added = next.filter((p) => !r.permissions.includes(p)).sort()
      const removed = r.permissions.filter((p) => !next.includes(p)).sort()
      const beyond = permissionsNotHeld(permissions, added)
      if (beyond.length) throw new Error(`You can't add permissions you don't hold: ${beyond.join(', ')}`)
      if (a.name && r.is_system && String(a.name).trim() !== r.name) throw new Error('System roles keep their name')
      const lines: string[] = []
      if (a.name && String(a.name).trim() !== r.name) lines.push(`Name: “${r.name}” → “${String(a.name).trim()}”`)
      if (a.description !== undefined) lines.push('New description')
      if (added.length) lines.push(`Add permissions: ${permList(added)}`)
      if (removed.length) lines.push(`Remove permissions: ${permList(removed)}`)
      if (!lines.length) throw new Error('Nothing would change')
      const names = (await people().catch(() => [])).filter((m) => holders.includes(m.id)).map((m) => m.name)
      return {
        title: `Update role “${r.name}”`,
        lines,
        warnings: [`${plural(holders.length, 'person')} ${holders.length === 1 ? 'has' : 'have'} this role${names.length ? `: ${quote(names, 6)}` : ''} — the change applies to them on their next page load`, ...(removed.length ? [`They lose ${permList(removed)} unless another role gives it`] : []), ...(unknown.length ? [`Unknown permission keys are ignored: ${unknown.join(', ')}`] : [])],
        preview: (added.length || removed.length) ? { columns: ['Permission', 'Before', 'After'], rows: [...added.map((p) => [permissionLabel(p), '—', '✓']), ...removed.map((p) => [permissionLabel(p), '✓', '—'])].slice(0, 12), total: added.length + removed.length, caption: 'Permission diff' } : null,
      }
    },
    run: async (a, env) => {
      const r = await role(a.role)
      if (isOwnerRole(r)) return { result: { error: 'The Owner role can\'t be edited' }, ok: false }
      const { data } = await db.from('user_roles').select('user_id').eq('tenant_id', tenantId).eq('role_id', r.id).eq('user_id', actorId ?? '')
      if ((data ?? []).length) return { result: { error: 'You hold this role yourself' }, ok: false }
      const { next } = nextPermissions(r, a)
      if (permissionsNotHeld(permissions, next.filter((p) => !r.permissions.includes(p))).length) return { result: { error: 'Not allowed' }, ok: false }
      const res = await call('roles_manage', { action: 'update_role', role_id: r.id, ...(a.name ? { role_name: String(a.name).trim() } : {}), ...(a.description !== undefined ? { description: String(a.description) } : {}), ...(Array.isArray(a.permissions) || a.add_permissions || a.remove_permissions ? { permissions: next } : {}) })
      if (res?.error) return { result: res, ok: false }
      changed(env, 'role', r.id, r.name, 'updated')
      return { result: res }
    },
  })

  add({
    name: 'set_manager',
    description: 'Set (or clear with manager null) who a member reports to. Reporting lines drive the manager view and acting on behalf of reports. Not for your own line, and you can\'t make yourself someone\'s manager.',
    parameters: obj({ person: S('The member (name, email or id)'), manager: { type: ['string', 'null'], description: 'Their manager (name, email or id), or null to clear' } }, ['person', 'manager']),
    mode: 'write',
    label: () => 'Setting the manager',
    confirm: async (a) => {
      const p = await person(a.person)
      notSelf(p.id, 'reporting line')
      const m = a.manager ? await person(a.manager, 'manager') : null
      if (m && actorId && m.id === actorId) throw new Error('The Agent can\'t make you someone\'s manager (it would let you act on their behalf) — ask another admin')
      const line = await must('users_manager_get', { user_id: p.id })
      const before = line?.manager?.display_name ?? line?.manager?.email ?? null
      return { title: m ? `Set ${m.name} as ${p.name}'s manager` : `Clear ${p.name}'s manager`, lines: [`Manager: ${before ?? 'none'} → ${m?.name ?? 'none'}`], warnings: m ? [`${m.name} sees ${p.name}'s tasks in My team and can act on their workflow tasks on their behalf`] : [] }
    },
    run: async (a, env) => {
      const p = await person(a.person)
      notSelf(p.id, 'reporting line')
      const m = a.manager ? await person(a.manager, 'manager') : null
      if (m && actorId && m.id === actorId) return { result: { error: 'Not allowed' }, ok: false }
      const res = await call('users_manager_set', { user_id: p.id, manager_user_id: m?.id ?? null })
      if (res?.error) return { result: res, ok: false }
      changed(env, 'org', p.id, `${p.name}'s manager`, 'updated')
      return { result: res }
    },
  })

  add({
    name: 'forms_legal_hold',
    description: 'Place or release a legal hold on a form. While held, none of its submissions or files are purged and the form can\'t be deleted. A destructive-style confirmation is shown.',
    parameters: obj({ form_id: S('Form id (forms_list)'), hold: { type: 'boolean' }, reason: S('Case or matter reference') }, ['form_id', 'hold']),
    mode: 'write',
    label: (a) => (a.hold ? 'Placing a legal hold' : 'Releasing the legal hold'),
    confirm: async (a) => {
      const gov = await call('forms_governance_get', { form_id: a.form_id })
      const form = await call('forms_get', { form_id: a.form_id })
      const name = String(form?.form?.name ?? form?.name ?? a.form_id)
      const held = Boolean(gov?.legal_hold ?? gov?.governance?.legal_hold ?? gov?.form?.legal_hold)
      return {
        title: `${a.hold ? 'Place a legal hold on' : 'Release the legal hold on'} “${name}”`,
        lines: [`Legal hold: ${held ? 'on' : 'off'} → ${a.hold ? 'on' : 'off'}`, ...(a.reason ? [`Reason: ${String(a.reason).slice(0, 200)}`] : [])],
        warnings: a.hold ? ['Retention purges skip this form\'s submissions and files; the form can\'t be deleted while held'] : ['Retention policies resume: submissions past their retention may be purged on the next run'],
        danger: true,
        confirm_label: a.hold ? 'Place legal hold' : 'Release legal hold',
        ...(a.hold ? {} : { typed_confirm: `release ${name}` }),
      }
    },
    run: async (a, env) => {
      const res = await call('forms_legal_hold', { form_id: a.form_id, hold: a.hold === true, ...(a.reason ? { reason: String(a.reason) } : {}) })
      if (res?.error) return { result: res, ok: false }
      changed(env, 'form', String(a.form_id), a.hold ? 'Legal hold placed' : 'Legal hold released', 'updated')
      return { result: res }
    },
  })

  /* ── Organization ── */
  const orgPersonFields = ['job_title', 'department', 'location', 'employee_id', 'cost_center']
  add({
    name: 'org_person_update',
    description: 'Edit a member\'s org attributes (job_title, department, location, employee_id, cost_center) and/or their manager (manager: name / email / id, or null to clear). Not your own manager, and never yourself as someone\'s manager.',
    parameters: obj({ person: S('Name, email or id'), job_title: S(''), department: S(''), location: S(''), employee_id: S(''), cost_center: S(''), manager: { type: ['string', 'null'] } }, ['person']),
    mode: 'write',
    label: () => 'Updating the person',
    confirm: async (a) => {
      const p = await person(a.person)
      const m = a.manager === undefined ? undefined : a.manager ? await person(a.manager, 'manager') : null
      if (m !== undefined) { notSelf(p.id, 'reporting line'); if (m && actorId && m.id === actorId) throw new Error('The Agent can\'t make you someone\'s manager') }
      const cur = await must('org_person_get', { user_id: p.id })
      const attrs = cur?.person ?? cur?.attributes ?? cur ?? {}
      const changes = orgPersonFields.filter((k) => a[k] !== undefined).map((k) => ({ path: k, before: attrs?.[k] ?? attrs?.attributes?.[k] ?? null, after: a[k] }))
      if (m !== undefined) changes.push({ path: 'manager', before: cur?.manager?.display_name ?? cur?.manager_chain?.[0]?.display_name ?? null, after: m?.name ?? null })
      if (!changes.length) throw new Error('Nothing would change')
      return { title: `Update ${p.name}`, lines: changes.map((c) => `${c.path.replace('_', ' ')}: ${str(c.before)} → ${str(c.after)}`), warnings: ['Directory sync may overwrite attributes it manages'] }
    },
    run: async (a, env) => {
      const p = await person(a.person)
      const m = a.manager === undefined ? undefined : a.manager ? await person(a.manager, 'manager') : null
      if (m !== undefined && ((actorId && p.id === actorId) || (m && actorId && m.id === actorId))) return { result: { error: 'Not allowed' }, ok: false }
      const res = await call('org_person_update', { user_id: p.id, ...Object.fromEntries(orgPersonFields.filter((k) => a[k] !== undefined).map((k) => [k, a[k]])), ...(m !== undefined ? { manager_user_id: m?.id ?? null } : {}) })
      if (res?.error) return { result: res, ok: false }
      changed(env, 'org', p.id, p.name, 'updated')
      return { result: res }
    },
  })

  const orgUnit = async (ref: unknown) => {
    const q = String(ref ?? '').trim().toLowerCase()
    const r = await must('org_units_list', {})
    const units = ((r?.units ?? r?.org_units ?? []) as any[]).map((u) => ({ id: String(u.id), name: String(u.name), kind: u.kind ?? null, parent_id: u.parent_id ?? null, head_user_id: u.head_user_id ?? null }))
    const found = units.find((u) => u.id === ref || u.name.toLowerCase() === q) ?? units.find((u) => u.name.toLowerCase().includes(q))
    if (!found) throw new Error(`No org unit matches “${String(ref)}”`)
    return found
  }
  add({
    name: 'org_unit_create',
    description: 'Create an org unit (company, division, department, unit or a custom kind), optionally under a parent with a head.',
    parameters: obj({ name: S('Unit name'), kind: S('company, division, department, unit (default) or custom'), parent: S('Parent unit name or id'), head: S('Head (name, email or id)') }, ['name']),
    mode: 'write',
    label: (a) => `Creating “${String(a.name ?? '')}”`,
    confirm: async (a) => {
      const parent = a.parent ? await orgUnit(a.parent) : null
      const head = a.head ? await person(a.head, 'head') : null
      return { title: `Create ${String(a.kind ?? 'unit')} “${String(a.name)}”`, lines: [parent ? `Under “${parent.name}”` : 'At the top level', ...(head ? [`Head: ${head.name}`] : [])], warnings: [] }
    },
    run: async (a, env) => {
      const parent = a.parent ? await orgUnit(a.parent) : null
      const head = a.head ? await person(a.head, 'head') : null
      const res = await call('org_unit_create', { name: String(a.name), ...(a.kind ? { kind: String(a.kind) } : {}), ...(parent ? { parent_id: parent.id } : {}), ...(head ? { head_user_id: head.id } : {}) })
      if (res?.error) return { result: res, ok: false }
      changed(env, 'org', res?.unit?.id ?? res?.org_unit?.id ?? null, String(a.name), 'created')
      return { result: res }
    },
  })

  add({
    name: 'org_unit_update',
    description: 'Rename, re-kind, move (parent) or set the head of an org unit.',
    parameters: obj({ org_unit: S('Unit name or id'), name: S(''), kind: S(''), parent: { type: ['string', 'null'], description: 'New parent (name or id), or null for top level' }, head: { type: ['string', 'null'] } }, ['org_unit']),
    mode: 'write',
    label: () => 'Updating the org unit',
    confirm: async (a) => {
      const u = await orgUnit(a.org_unit)
      const parent = a.parent === undefined ? undefined : a.parent ? await orgUnit(a.parent) : null
      const head = a.head === undefined ? undefined : a.head ? await person(a.head, 'head') : null
      const lines: string[] = []
      if (a.name && a.name !== u.name) lines.push(`Name: “${u.name}” → “${a.name}”`)
      if (a.kind && a.kind !== u.kind) lines.push(`Kind: ${u.kind ?? '—'} → ${a.kind}`)
      if (parent !== undefined) lines.push(`Parent → ${parent?.name ?? 'top level'}`)
      if (head !== undefined) lines.push(`Head → ${head?.name ?? 'none'}`)
      if (!lines.length) throw new Error('Nothing would change')
      return { title: `Update “${u.name}”`, lines, warnings: [] }
    },
    run: async (a, env) => {
      const u = await orgUnit(a.org_unit)
      const parent = a.parent === undefined ? undefined : a.parent ? await orgUnit(a.parent) : null
      const head = a.head === undefined ? undefined : a.head ? await person(a.head, 'head') : null
      const res = await call('org_unit_update', { org_unit_id: u.id, ...(a.name ? { name: String(a.name) } : {}), ...(a.kind ? { kind: String(a.kind) } : {}), ...(parent !== undefined ? { parent_id: parent?.id ?? null } : {}), ...(head !== undefined ? { head_user_id: head?.id ?? null } : {}) })
      if (res?.error) return { result: res, ok: false }
      changed(env, 'org', u.id, String(a.name ?? u.name), 'updated')
      return { result: res }
    },
  })

  for (const [name, verb] of [['org_unit_member_add', 'Add'], ['org_unit_member_remove', 'Remove']] as const) {
    add({
      name,
      description: `${verb} a member ${verb === 'Add' ? 'to' : 'from'} an org unit${verb === 'Add' ? ' (is_primary: their primary unit)' : ''}.`,
      parameters: obj({ org_unit: S('Unit name or id'), person: S('Name, email or id'), ...(verb === 'Add' ? { is_primary: { type: 'boolean' }, role: S('Their role in the unit') } : {}) }, ['org_unit', 'person']),
      mode: 'write',
      label: () => `${verb === 'Add' ? 'Adding to' : 'Removing from'} the org unit`,
      confirm: async (a) => {
        const [u, p] = await Promise.all([orgUnit(a.org_unit), person(a.person)])
        return { title: `${verb} ${p.name} ${verb === 'Add' ? 'to' : 'from'} “${u.name}”`, lines: [verb === 'Add' ? `${p.name} becomes a member${a.is_primary ? ' (primary unit)' : ''}` : `${p.name} leaves “${u.name}”`], warnings: [] }
      },
      run: async (a, env) => {
        const [u, p] = await Promise.all([orgUnit(a.org_unit), person(a.person)])
        const res = await call(name, { org_unit_id: u.id, user_id: p.id, ...(verb === 'Add' && a.is_primary !== undefined ? { is_primary: a.is_primary === true } : {}), ...(verb === 'Add' && a.role ? { role: String(a.role) } : {}) })
        if (res?.error) return { result: res, ok: false }
        changed(env, 'org', u.id, `${p.name} · ${u.name}`, 'updated')
        return { result: res }
      },
    })
  }

  /** The import's plan, refused when it would change the person's own reporting line or make them a manager. */
  const importPlan = async (a: Record<string, any>) => {
    const csv = String(a.csv ?? '')
    if (!csv.trim()) throw new Error('Pass the CSV text (from the attached file) as csv')
    if (csv.length > 500_000) throw new Error('The CSV is too large for the Agent (500 KB) — use Organization → Manage → Import')
    const plan = await must('org_import', { csv, ...(a.mapping ? { mapping: a.mapping } : {}), dry_run: true })
    const me = actorId ? (await people()).find((x) => x.id === actorId) : null
    const touchesMe = (plan?.rows ?? []).filter((r: any) => (me && (r.user_id === me.id) && Object.keys(r.changes ?? {}).some((k) => /manager/.test(k)))
      || (me && Object.entries(r.changes ?? {}).some(([k, v]: [string, any]) => /manager/.test(k) && (v?.after === me.id || String(v?.after ?? '').toLowerCase() === String(me.email ?? '').toLowerCase()))))
    if (touchesMe.length) throw new Error(`Rows ${touchesMe.map((r: any) => r.row).join(', ')} change your own reporting line or make you a manager — the Agent never changes your own access; remove those rows or ask another admin`)
    return plan
  }
  add({
    name: 'org_import_csv',
    description: 'Import people attributes, managers, departments (org units) and teams from CSV text (an attached CSV: pass its text). Headers: email, display_name, manager_email, job_title, department, division, location, employee_id, cost_center, team. ALWAYS previews first: the card shows the per-row plan (create / update / unchanged / errors) and nothing is written until the person confirms. People are matched by email and must already be members.',
    parameters: obj({ csv: S('The CSV text, header row first'), mapping: { type: 'object', description: 'Optional field → CSV header', additionalProperties: { type: ['string', 'null'] } } }, ['csv']),
    mode: 'write',
    label: () => 'Importing the org structure',
    confirm: async (a) => {
      const plan = await importPlan(a)
      const s = plan?.summary ?? {}
      const rows = ((plan?.rows ?? []) as any[]).filter((r) => r.action !== 'unchanged')
      return {
        title: `Import the org structure (${plural(Number(s.total ?? 0), 'row')})`,
        lines: [`${s.update ?? 0} to update, ${s.create ?? 0} to create, ${s.unchanged ?? 0} unchanged, ${s.errors ?? 0} with errors (skipped)`, ...(plan?.org_units?.create?.length ? [`New org units: ${quote(plan.org_units.create)}`] : []), ...(plan?.teams?.create?.length ? [`New teams: ${quote(plan.teams.create)}`] : [])],
        warnings: [...(plan?.cycles?.length ? [`${plural(plan.cycles.length, 'manager loop')} found — those lines are skipped`] : []), 'An import never removes anyone from a team'],
        preview: { columns: ['Row', 'Email', 'Action', 'Changes'], rows: rows.slice(0, 10).map((r) => [String(r.row), String(r.email ?? ''), String(r.action), r.errors?.length ? `Error: ${r.errors.join('; ')}`.slice(0, 80) : Object.entries(r.changes ?? {}).map(([k, v]: [string, any]) => `${k}: ${str(v?.before)} → ${str(v?.after)}`).join('; ').slice(0, 120)]), total: rows.length, caption: 'Preview — nothing is written until you confirm' },
      }
    },
    run: async (a, env) => {
      await importPlan(a)
      const res = await call('org_import', { csv: String(a.csv), ...(a.mapping ? { mapping: a.mapping } : {}), dry_run: false })
      if (res?.error) return { result: res, ok: false }
      changed(env, 'org', null, `${res?.people_updated ?? 0} people updated`, 'updated')
      return { result: { applied: true, people_updated: res?.people_updated, managers_changed: res?.managers_changed, units_created: res?.units_created, teams_created: res?.teams_created, team_memberships_added: res?.team_memberships_added, summary: res?.summary } }
    },
  })

  /* ── Branding and settings ── */
  // Theme writes are checked against the schema before their card (theme-reference.ts); the reference lists every setting.
  const themeFails = new Map<string, number>()
  const checkTheme = (name: string, a: Record<string, any>) => {
    const error = themeCheckError(name, a, (themeFails.get(name) ?? 0) + 1)
    if (error) { themeFails.set(name, (themeFails.get(name) ?? 0) + 1); throw new Error(error) }
  }
  if (['workspace_theme_update', 'workspace_theme_apply_preset', 'form_sign_in_page_update'].some((n) => allowed.has(n))) out.push(themeReferenceTool())
  add({
    name: 'workspace_theme_apply_preset',
    description: 'Replace the workspace theme with a built-in template (workspace_theme_presets_list). Applies to every member immediately; logos and uploaded fonts are not kept.',
    parameters: obj({ preset_id: S('Template id') }, ['preset_id']),
    mode: 'write',
    label: () => 'Applying the theme',
    confirm: async (a) => {
      const [cur, presets] = await Promise.all([call('workspace_theme_get', {}), call('workspace_theme_presets_list', {})])
      const list = (presets?.presets ?? presets ?? []) as any[]
      const p = Array.isArray(list) ? list.find((x) => x.id === a.preset_id) : null
      if (!p) throw new Error(`No theme template “${a.preset_id}”`)
      const before = cur?.workspace_theme?.meta?.name ?? cur?.theme?.meta?.name ?? 'Current theme'
      return { title: `Apply the “${p.name}” theme`, lines: [`Theme: ${before} → ${p.name}`, ...(p.description ? [String(p.description).slice(0, 140)] : [])], warnings: ['Applies to every member immediately', 'Logos and uploaded fonts are not kept'] }
    },
    run: async (a, env) => {
      const res = await call('workspace_theme_apply_preset', { preset_id: String(a.preset_id) })
      if (res?.error) return { result: res, ok: false }
      changed(env, 'theme', null, 'Workspace theme', 'updated')
      return { result: { applied: true, preset_id: a.preset_id, warnings: res?.warnings ?? res?.contrast_warnings ?? [] } }
    },
  })

  add({
    name: 'workspace_theme_update',
    description: 'Replace the workspace theme (send the whole theme: edit the workspace_theme_get result). Applies to every member immediately. The card shows each changed setting before → after.',
    parameters: schemaOf('workspace_theme_update', ['expected_version']),
    mode: 'write',
    label: () => 'Updating the theme',
    confirm: async (a) => {
      checkTheme('workspace_theme_update', a)
      const cur = await must('workspace_theme_get', {})
      const before = cur?.workspace_theme ?? cur?.theme ?? {}
      const changes = leafDiff(before, a.theme ?? {})
      if (!changes.length) throw new Error('Nothing would change')
      return { title: 'Update the workspace theme', lines: [`${plural(changes.length, 'setting')} change`], warnings: ['Applies to every member immediately'], preview: diffPreview(changes) }
    },
    run: async (a, env) => {
      const res = await call('workspace_theme_update', { theme: a.theme })
      if (res?.error) return { result: res, ok: false }
      changed(env, 'theme', null, 'Workspace theme', 'updated')
      return { result: { updated: true, warnings: res?.warnings ?? res?.contrast_warnings ?? [] } }
    },
  })

  for (const [name, getter, kind, title] of [
    ['form_sign_in_page_update', 'form_sign_in_page_get', 'sign_in_page', 'the form sign-in page'],
    ['task_completion_settings_update', 'task_completion_settings_get', 'task_completion', 'the Task completed screen'],
  ] as const) {
    add({
      name,
      description: `${String(byName.get(name)?.description ?? name)} The card shows each change before → after.`,
      parameters: schemaOf(name),
      mode: 'write',
      label: () => `Updating ${title}`,
      confirm: async (a) => {
        if (name === 'form_sign_in_page_update') checkTheme(name, a)
        const cur = await must(getter, {})
        const before = cur?.settings ?? cur ?? {}
        const changes = Object.keys(a).map((k) => ({ path: k, before: before?.[k], after: a[k] })).filter((c) => JSON.stringify(c.before ?? null) !== JSON.stringify(c.after ?? null))
        if (!changes.length) throw new Error('Nothing would change')
        return { title: `Update ${title}`, lines: changes.slice(0, 6).map((c) => `${c.path.replace(/_/g, ' ')}: ${str(c.before)} → ${str(c.after)}`), warnings: [], preview: changes.length > 6 ? diffPreview(changes) : null }
      },
      run: async (a, env) => {
        const res = await call(name, a)
        if (res?.error) return { result: res, ok: false }
        changed(env, kind, null, title.replace(/^the /, ''), 'updated')
        return { result: res }
      },
    })
  }

  const describePolicy = (p: any) => {
    if (!p) return '—'
    const mode = String(p.policy_mode ?? '').replace(/_/g, ' ')
    return p.duration_value ? `${mode} after ${p.duration_value} ${p.duration_unit ?? ''}`.trim() : p.exact_date ? `${mode} on ${p.exact_date}` : mode
  }
  add({
    name: 'retention_policies_create',
    description: String(byName.get('retention_policies_create')?.description ?? 'Create a retention policy.'),
    parameters: schemaOf('retention_policies_create'),
    mode: 'write',
    label: (a) => `Creating retention policy “${String(a.name ?? '')}”`,
    confirm: async (a) => ({ title: `Create retention policy “${String(a.name)}”`, lines: [`Rule: ${describePolicy(a)}`, `Applies to: ${Array.isArray(a.applies_to) && a.applies_to.length ? a.applies_to.join(', ') : 'every supported scope'}`, 'Nothing is governed until the policy is assigned to a table, row, role or form'], warnings: /purge/.test(String(a.policy_mode)) ? ['Purge policies delete data when they come due'] : [] }),
    run: async (a, env) => {
      const res = await call('retention_policies_create', a)
      if (res?.error) return { result: res, ok: false }
      changed(env, 'retention_policy', res?.retention_policy?.id ?? null, String(a.name), 'created')
      return { result: res }
    },
  })
  add({
    name: 'retention_policies_update',
    description: `${String(byName.get('retention_policies_update')?.description ?? 'Update a retention policy.')} The card shows before → after and where the policy is used.`,
    parameters: schemaOf('retention_policies_update'),
    mode: 'write',
    label: () => 'Updating the retention policy',
    confirm: async (a) => {
      const cur = await must('retention_policies_get', { retention_policy_id: a.retention_policy_id })
      const p = cur?.retention_policy ?? cur?.policy ?? cur
      const next = { ...p, ...Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'retention_policy_id')) }
      const usage = await call('retention_policies_list_assets', { retention_policy_id: a.retention_policy_id })
      const used = JSON.stringify(usage?.summary ?? usage?.usage ?? {}).slice(0, 160)
      const changes = ['name', 'description', 'policy_mode', 'duration_value', 'duration_unit', 'exact_date', 'applies_to'].filter((k) => a[k] !== undefined).map((k) => ({ path: k, before: p?.[k], after: a[k] }))
      return { title: `Update retention policy “${String(p?.name ?? '')}”`, lines: [`Rule: ${describePolicy(p)} → ${describePolicy(next)}`, ...changes.filter((c) => !['policy_mode', 'duration_value', 'duration_unit', 'exact_date'].includes(c.path)).map((c) => `${c.path.replace('_', ' ')}: ${str(c.before)} → ${str(c.after)}`)], warnings: [`Everything this policy is assigned to follows the new rule${used && used !== '{}' ? ` (${used})` : ''}`, ...(/purge/.test(String(next.policy_mode)) ? ['Purge policies delete data when they come due'] : [])] }
    },
    run: async (a, env) => {
      const res = await call('retention_policies_update', a)
      if (res?.error) return { result: res, ok: false }
      changed(env, 'retention_policy', String(a.retention_policy_id), String(res?.retention_policy?.name ?? 'Retention policy'), 'updated')
      return { result: res }
    },
  })
  add({
    name: 'retention_policies_delete',
    description: 'Delete a retention policy (only when nothing is assigned to it). Destructive — the person types the confirmation.',
    parameters: obj({ retention_policy_id: S('Retention policy id') }, ['retention_policy_id']),
    mode: 'write',
    label: () => 'Deleting the retention policy',
    confirm: async (a) => {
      const cur = await must('retention_policies_get', { retention_policy_id: a.retention_policy_id })
      const p = cur?.retention_policy ?? cur?.policy ?? cur
      const name = String(p?.name ?? a.retention_policy_id)
      return { title: `Delete retention policy “${name}”`, lines: [`Rule: ${describePolicy(p)}`], warnings: ['Deleting fails if anything is still assigned to the policy', 'Deleted policies cannot be restored from here'], danger: true, confirm_label: 'Delete policy', typed_confirm: `delete ${name}` }
    },
    run: async (a, env) => {
      const res = await call('retention_policies_delete', { retention_policy_id: a.retention_policy_id })
      if (res?.error) return { result: res, ok: false }
      changed(env, 'retention_policy', String(a.retention_policy_id), String(res?.retention_policy_name ?? 'Retention policy'), 'deleted')
      return { result: res }
    },
  })

  return out
}
