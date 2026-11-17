/**
 * Nintex task assignees → UserTasks assignment, resolved against the
 * workspace (as the person importing):
 *
 *   e-mail, UPN, DOMAIN\login, i:0#.w|login  → a member (by e-mail, then by the
 *                                              login's name before the @)
 *   a SharePoint / AD group or team name     → a team (by name; directory-synced
 *                                              teams carry their source)
 *   Initiator ({Common:Initiator})           → {{workflow_started_by}}
 *   Manager ({Common:Manager}, "Manager")    → the initiator's manager (reporting lines)
 *   {ItemProperty:F} / {WorkflowVariable:X}  → an assignee variable (review: it must hold a user id)
 *
 * `map` (the import preview's assignee mapping step) overrides any of them:
 * name → "user:<id>" | "team:<id>" | "initiator" | "manager".
 */
import type { ServiceContext } from '@/lib/services/context'
import { nintexTokens } from './map'

export type AssigneeResolution =
  | { kind: 'user'; id: string; label: string }
  | { kind: 'team'; id: string; label: string; origin?: string | null }
  | { kind: 'initiator'; label: string }
  | { kind: 'manager'; label: string }
  | { kind: 'variable'; expression: string; label: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeRef(ref: string): string {
  // SharePoint claims: i:0#.w|DOMAIN\login, i:0#.f|membership|upn, c:0+.w|group-sid …
  return String(ref ?? '').trim().replace(/^[ic]:0[^|]*\|(membership\||rolemanager\|)?/i, '')
}

/** Resolve every distinct assignee reference (one query per kind). */
export async function resolveAssignees(ctx: ServiceContext, refs: string[], map: Record<string, string> = {}, vars: Map<string, string> = new Map()): Promise<Map<string, AssigneeResolution | null>> {
  const out = new Map<string, AssigneeResolution | null>()
  const db = ctx.supabase as any
  const distinct = [...new Set(refs.map(normalizeRef).filter(Boolean))]
  const { data: memberRows } = await db.from('user_memberships').select('user_id').eq('tenant_id', ctx.tenantId)
  const memberIds = new Set(((memberRows ?? []) as any[]).map((m) => String(m.user_id)))
  const { data: userRows } = memberIds.size ? await db.from('users').select('id, email, display_name').in('id', [...memberIds]) : { data: [] }
  const users = ((userRows ?? []) as any[]).map((u) => ({ id: String(u.id), email: String(u.email ?? '').toLowerCase(), name: String(u.display_name ?? u.email ?? '') }))
  let teamRes = await db.from('teams').select('id, name, origin').eq('tenant_id', ctx.tenantId)
  if (teamRes.error) teamRes = await db.from('teams').select('id, name').eq('tenant_id', ctx.tenantId)
  const teams = ((teamRes.data ?? []) as any[]).map((t) => ({ id: String(t.id), name: String(t.name ?? ''), origin: t.origin ?? null }))
  for (const ref of distinct) {
    const mapped = map[ref] ?? map[ref.toLowerCase()]
    if (mapped) {
      const [kind, id] = mapped.split(':')
      if (kind === 'user' && UUID_RE.test(id)) { const u = users.find((x) => x.id === id); out.set(ref, { kind: 'user', id, label: u?.name ?? id }); continue }
      if (kind === 'team' && UUID_RE.test(id)) { const t = teams.find((x) => x.id === id); out.set(ref, { kind: 'team', id, label: t?.name ?? id, origin: t?.origin }); continue }
      if (mapped === 'initiator') { out.set(ref, { kind: 'initiator', label: 'the person who started the workflow' }); continue }
      if (mapped === 'manager') { out.set(ref, { kind: 'manager', label: "the initiator's manager" }); continue }
    }
    if (/^\{Common:Initiator\}$|^initiator$/i.test(ref)) { out.set(ref, { kind: 'initiator', label: 'the person who started the workflow' }); continue }
    if (/^\{Common:Manager\}$|^(initiator'?s? )?manager$/i.test(ref)) { out.set(ref, { kind: 'manager', label: "the initiator's manager" }); continue }
    if (/^\{(ItemProperty|WorkflowVariable):[^}]+\}$/.test(ref)) { const e = nintexTokens(ref, vars, { standalone: !/ItemProperty/.test(ref) }); out.set(ref, { kind: 'variable', expression: e, label: e }); continue }
    const lower = ref.toLowerCase()
    const login = lower.includes('\\') ? lower.split('\\').pop()! : lower
    const byEmail = users.filter((u) => u.email === lower)
    const byLogin = byEmail.length ? byEmail : users.filter((u) => u.email.split('@')[0] === login.split('@')[0])
    if (byLogin.length === 1) { out.set(ref, { kind: 'user', id: byLogin[0].id, label: byLogin[0].name }); continue }
    const team = teams.filter((t) => t.name.toLowerCase() === lower || t.name.toLowerCase() === login)
    if (team.length === 1) { out.set(ref, { kind: 'team', id: team[0].id, label: team[0].name, origin: team[0].origin }); continue }
    out.set(ref, null)
  }
  return out
}

/** A user task's assignment config from its resolved references (the first that resolved wins). */
export function assignmentConfig(refs: string[], resolved: Map<string, AssigneeResolution | null>): { config: Record<string, unknown>; resolved: AssigneeResolution[]; unresolved: string[] } {
  const done: AssigneeResolution[] = []
  const unresolved: string[] = []
  for (const r of refs.map(normalizeRef).filter(Boolean)) { const x = resolved.get(r); if (x) done.push(x); else unresolved.push(r) }
  const first = done[0]
  const config: Record<string, unknown> = !first ? {}
    : first.kind === 'user' ? { assignment_type: 'individual', assignee_id: first.id, assignee_name: first.label }
    : first.kind === 'team' ? { assignment_type: 'team', team_id: first.id }
    : first.kind === 'initiator' ? { assignment_type: 'individual', assignee_variable: '{{workflow_started_by}}' }
    : first.kind === 'manager' ? { assignment_type: 'individual', assignee_relation: 'initiator_manager' }
    : { assignment_type: 'individual', assignee_variable: first.expression }
  return { config, resolved: done, unresolved }
}
