/**
 * Who the Agent's User Tasks go to (server side).
 *
 * A workflow the Agent builds must not leave its human steps with nobody
 * assigned by accident (the task would sit in the queue). The Agent asks
 * the person with ask_user buttons when it isn't clear (Assign to me for
 * testing / The submitter's manager / A team… / A specific person… / Leave
 * unassigned); when they just say "build it", it assigns the tasks to the
 * person building, so they can test straight away.
 *
 * The model never needs anyone's id for "me": it writes assignee_id "@me"
 * and withAssignmentHelp swaps in the signed-in person's id — the same way
 * on the confirmation card and when the confirmed write runs (both read the
 * same arguments). Those steps are marked `_assigned_for_testing: true`
 * (ignored by the engine — config keys starting with "_" are never read —
 * and shown by the wiring validator as an info note), the card says
 * "Assigned to you for testing — change before publishing", and the
 * result tells the model to say so in its summary.
 *
 * Every workflow write card (workflows_create / workflows_update /
 * build_plan) also lists each User Task's assignee by name.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AssistantToolDef } from './engine'
import { userTaskIsUnassigned } from '@/lib/workflow-wiring'

/* eslint-disable @typescript-eslint/no-explicit-any -- tool arguments and rows are JSON */

export const ME_ASSIGNEE = '@me'
const ME_FORMS = new Set(['@me', '{{me}}', 'me', '@current_user'])
export const ASSIGNMENT_TOOLS = new Set(['workflows_create', 'workflows_update', 'build_plan', 'build_plan_continue'])
export const ASSIGNED_FOR_TESTING_NOTE = 'Assigned to you for testing — change before publishing'

const parse = (v: unknown): any => {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return v }
}
const isMe = (v: unknown) => typeof v === 'string' && ME_FORMS.has(v.trim().toLowerCase())

type NodeFn = (node: any, workflowName: string | null) => any

/** A node list mapped, kept in the form it came in (MCP takes nodes as JSON text). */
function mapNodeList(raw: unknown, fn: (n: any) => any): unknown {
  const nodes = parse(raw)
  if (!Array.isArray(nodes)) return raw
  const mapped = nodes.map(fn)
  return typeof raw === 'string' ? JSON.stringify(mapped) : mapped
}

/** The nodes of one workflow's create / update arguments, mapped. */
function mapWorkflowArgs(args: Record<string, any>, fn: NodeFn): Record<string, any> {
  const out = { ...args }
  const name = typeof args.name === 'string' ? args.name : null
  if (args.nodes !== undefined) out.nodes = mapNodeList(args.nodes, (n) => fn(n, name))
  const def = parse(args.definition)
  if (def && typeof def === 'object' && !Array.isArray(def) && def.nodes !== undefined) {
    const mappedDef = { ...def, nodes: mapNodeList(def.nodes, (n) => fn(n, name)) }
    out.definition = typeof args.definition === 'string' ? JSON.stringify(mappedDef) : mappedDef
  }
  return out
}

/** Every workflow node of a workflow write or a build plan, mapped. */
export function mapWorkflowNodes(tool: string, args: Record<string, any>, fn: NodeFn): Record<string, any> {
  if (tool === 'workflows_create' || tool === 'workflows_update') return mapWorkflowArgs(args, fn)
  if (tool === 'build_plan' || tool === 'build_plan_continue') {
    const items = parse(args.items)
    if (!Array.isArray(items)) return args
    return { ...args, items: items.map((it: any) => (it?.kind === 'workflow' && it.args && typeof it.args === 'object' ? { ...it, args: mapWorkflowArgs({ name: it.name, ...it.args }, fn) } : it)) }
  }
  return args
}

export interface UserTaskRef { label: string; workflow: string | null; config: Record<string, any> }

/** The User Tasks a write would save. */
export function userTasksOf(tool: string, args: Record<string, any>): UserTaskRef[] {
  const out: UserTaskRef[] = []
  mapWorkflowNodes(tool, args, (n, workflow) => {
    if (n?.type === 'user_task') out.push({ label: String(n.label ?? n.config?.task_title ?? n.id ?? 'User Task'), workflow, config: n.config && typeof n.config === 'object' ? n.config : {} })
    return n
  })
  return out
}

/** "@me" → the person's id on every User Task (marked as assigned for testing). */
export function resolveMeAssignee(tool: string, args: Record<string, any>, meId: string): Record<string, any> {
  if (!ASSIGNMENT_TOOLS.has(tool)) return args
  return mapWorkflowNodes(tool, args, (n) => {
    if (n?.type !== 'user_task' || !n.config || typeof n.config !== 'object') return n
    const c = { ...n.config }
    if (!isMe(c.assignee_id) && !isMe(c.assignee_variable)) return n
    c.assignee_id = meId
    c.assignment_type = 'individual'
    delete c.assignee_variable // "me" was chosen: a variable would override assignee_id
    c._assigned_for_testing = true
    return { ...n, config: c }
  })
}

export interface AssigneeNames { users: Map<string, string>; teams: Map<string, string> }

/** One line: who a User Task goes to. */
export function describeAssignee(config: Record<string, any>, names: AssigneeNames, meId: string): string {
  const c = config ?? {}
  const type = String(c.assignment_type ?? 'individual')
  if (userTaskIsUnassigned(c)) return 'nobody — it waits in the queue (unassigned)'
  if (type === 'team') return `the team ${names.teams.get(String(c.team_id)) ?? String(c.team_id)}`
  if (type === 'aad_group') return `the directory group ${String(c.aad_group_name || c.aad_group_id)}`
  const variable = typeof c.assignee_variable === 'string' ? c.assignee_variable.trim() : ''
  if (variable) {
    if (/\{\{\s*submitted_by_manager_id\s*\}\}/.test(variable)) return 'the submitter\'s manager'
    if (/\{\{\s*submitted_by\s*\}\}/.test(variable)) return 'the person who submitted the form'
    if (/\{\{\s*workflow_started_by\s*\}\}/.test(variable)) return 'the person who started the workflow'
    return `the person in ${variable}`
  }
  const id = String(c.assignee_id)
  if (id === meId) return `you (${names.users.get(id) ?? 'the person building this'})${c._assigned_for_testing === true ? ', for testing' : ''}`
  return names.users.get(id) ?? id
}

export interface AssignmentDeps {
  meId: string
  /** Names of people and teams by id (tenant-scoped). */
  names: (ids: { users: string[]; teams: string[] }) => Promise<AssigneeNames>
}

/** Card lines and warnings for the User Tasks of a workflow write. */
export async function assignmentCardParts(tool: string, resolved: Record<string, any>, deps: AssignmentDeps): Promise<{ lines: string[]; warnings: string[]; testing: string[] }> {
  const tasks = userTasksOf(tool, resolved)
  if (!tasks.length) return { lines: [], warnings: [], testing: [] }
  const users = tasks.map((t) => t.config.assignee_id).filter((v) => typeof v === 'string' && v && !v.includes('{{'))
  const teams = tasks.map((t) => t.config.team_id).filter((v) => typeof v === 'string' && v)
  const names = await deps.names({ users: [...new Set([deps.meId, ...users])], teams: [...new Set(teams)] }).catch(() => ({ users: new Map(), teams: new Map() }))
  const multiWorkflow = new Set(tasks.map((t) => t.workflow)).size > 1
  const lines = tasks.slice(0, 12).map((t) => `Assignee of “${t.label}”${multiWorkflow && t.workflow ? ` (${t.workflow})` : ''}: ${describeAssignee(t.config, names, deps.meId)}`)
  if (tasks.length > 12) lines.push(`…and ${tasks.length - 12} more User Tasks`)
  const testing = tasks.filter((t) => t.config._assigned_for_testing === true && t.config.assignee_id === deps.meId).map((t) => t.label)
  const unassigned = tasks.filter((t) => userTaskIsUnassigned(t.config)).map((t) => t.label)
  const warnings = [
    ...(testing.length ? [ASSIGNED_FOR_TESTING_NOTE] : []),
    ...(unassigned.length ? [`No assignee: ${unassigned.map((l) => `“${l}”`).join(', ')} — the task${unassigned.length === 1 ? '' : 's'} will wait in the queue with nobody assigned`] : []),
  ]
  return { lines, warnings, testing }
}

/**
 * A workflow write tool with "@me" resolved and the assignees on its card.
 * Other tools are returned unchanged.
 */
export function withAssignmentHelp(tool: AssistantToolDef, deps: AssignmentDeps): AssistantToolDef {
  if (!ASSIGNMENT_TOOLS.has(tool.name) || tool.mode !== 'write') return tool
  return {
    ...tool,
    confirm: async (args) => {
      const resolved = resolveMeAssignee(tool.name, args, deps.meId)
      const card = tool.confirm ? await tool.confirm(resolved) : { title: tool.label(resolved), lines: [], warnings: [] }
      const parts = await assignmentCardParts(tool.name, resolved, deps)
      return { ...card, lines: [...card.lines, ...parts.lines], warnings: [...parts.warnings, ...card.warnings] }
    },
    run: async (args, env) => {
      const resolved = resolveMeAssignee(tool.name, args, deps.meId)
      const outcome = await tool.run(resolved, env)
      const testing = userTasksOf(tool.name, resolved).filter((t) => t.config._assigned_for_testing === true).map((t) => t.label)
      const r = outcome.result
      if (!testing.length || !r || typeof r !== 'object' || Array.isArray(r) || (r as any).error) return outcome
      return {
        ...outcome,
        result: {
          ...(r as object),
          assigned_for_testing: testing,
          assignment_note: `These User Tasks are assigned to the person building this, for testing: ${testing.join(', ')}. Say so in your summary ("assigned to you for testing — change the assignee before publishing").`,
        },
      }
    },
  }
}

/** Names of people (workspace members) and teams by id, tenant-scoped. */
export function assigneeNameLookup(db: SupabaseClient, tenantId: string): AssignmentDeps['names'] {
  return async ({ users, teams }) => {
    const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v)
    const userIds = users.filter(uuid).slice(0, 50)
    const teamIds = teams.filter(uuid).slice(0, 50)
    const [members, teamRows] = await Promise.all([
      userIds.length ? (db as any).from('user_memberships').select('user_id').eq('tenant_id', tenantId).in('user_id', userIds) : { data: [] },
      teamIds.length ? (db as any).from('teams').select('id, name').eq('tenant_id', tenantId).in('id', teamIds) : { data: [] },
    ])
    const memberIds = ((members.data ?? []) as any[]).map((m) => String(m.user_id))
    const { data: people } = memberIds.length ? await (db as any).from('users').select('id, display_name, email').in('id', memberIds) : { data: [] }
    return {
      users: new Map(((people ?? []) as any[]).map((u) => [String(u.id), String(u.display_name || u.email || 'Someone')])),
      teams: new Map(((teamRows.data ?? []) as any[]).map((t) => [String(t.id), String(t.name ?? 'Team')])),
    }
  }
}

/**
 * assignees_lookup (read): people and teams a User Task can be assigned to,
 * for the "A team…" / "A specific person…" follow-up buttons. Workspace
 * members and teams only (names and ids; emails for telling people apart).
 */
export function assigneesLookupTool(params: { db: SupabaseClient; tenantId: string; meId: string }): AssistantToolDef {
  const { db, tenantId, meId } = params
  return {
    name: 'assignees_lookup',
    description: 'Look up who a User Task can be assigned to: people in the workspace and teams (id, name), optionally filtered by name. Use it to offer team or person buttons with ask_user, and to get the id for assignee_id / team_id. "me" is the person you are helping (assign with assignee_id "@me").',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Only people / teams whose name (or email) contains this text' },
        kind: { type: 'string', enum: ['people', 'teams', 'all'], description: 'Default all' },
      },
      required: [],
    },
    mode: 'read',
    label: (args) => (args.kind === 'teams' ? 'Looking up teams' : args.kind === 'people' ? 'Looking up people' : 'Looking up people and teams'),
    run: async (args) => {
      const q = typeof args.query === 'string' ? args.query.trim().toLowerCase().slice(0, 100) : ''
      const kind = args.kind === 'people' || args.kind === 'teams' ? args.kind : 'all'
      const out: Record<string, unknown> = { me: { id: meId, assign_with: ME_ASSIGNEE } }
      if (kind !== 'teams') {
        const { data: members } = await (db as any).from('user_memberships').select('user_id').eq('tenant_id', tenantId).eq('is_active', true).limit(1000)
        const ids = ((members ?? []) as any[]).map((m) => String(m.user_id))
        const { data: users } = ids.length ? await (db as any).from('users').select('id, display_name, email').in('id', ids.slice(0, 1000)) : { data: [] }
        const list = ((users ?? []) as any[])
          .map((u) => ({ id: String(u.id), name: String(u.display_name || u.email || 'Someone'), email: u.email ? String(u.email) : null, ...(String(u.id) === meId ? { is_me: true } : {}) }))
          .filter((u) => !q || u.name.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q))
          .sort((a, b) => a.name.localeCompare(b.name))
        out.people = list.slice(0, 20)
        if (list.length > 20) out.more_people = list.length - 20
      }
      if (kind !== 'people') {
        const { data: teams } = await (db as any).from('teams').select('id, name').eq('tenant_id', tenantId).order('name').limit(500)
        const list = ((teams ?? []) as any[]).map((t) => ({ id: String(t.id), name: String(t.name ?? 'Team') })).filter((t) => !q || t.name.toLowerCase().includes(q))
        out.teams = list.slice(0, 20)
        if (list.length > 20) out.more_teams = list.length - 20
      }
      return { result: out }
    },
  }
}

/**
 * The chat request's hook (lib/assistants/chat.ts): with building write
 * tools, "@me" is resolved and assignees shown on workflow write cards, and
 * assignees_lookup is offered.
 */
export function withAssignmentTools(tools: AssistantToolDef[], params: { db: SupabaseClient; tenantId: string; meId: string }): AssistantToolDef[] {
  if (!tools.some((t) => t.mode === 'write' && ASSIGNMENT_TOOLS.has(t.name))) return tools
  const deps: AssignmentDeps = { meId: params.meId, names: assigneeNameLookup(params.db, params.tenantId) }
  const out = tools.map((t) => withAssignmentHelp(t, deps))
  if (!out.some((t) => t.name === 'assignees_lookup')) out.push(assigneesLookupTool(params))
  return out
}
