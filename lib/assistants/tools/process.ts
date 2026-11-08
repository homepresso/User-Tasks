/**
 * get_process_context (server side): "what happens next?" answered from the
 * workflow itself. Loads the definition actually running (the run's version,
 * else the published version, else — for a builder — the draft), the current
 * step, names (people, teams, tables, decision tables with their rules
 * summarised) and the history so far, then describes it with the
 * deterministic walker (lib/assistants/process.ts).
 *
 * Permissions: a task's run only when the person can see that run's progress
 * (can_view_run_progress, as the process view / Home progress do); a form's
 * workflow and a builder's workflow only with workflows.view. Nothing else is
 * returned than plain descriptions (no raw config or secrets).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AssistantToolDef } from '../engine'
import { describeProcess, plainExpression, type ProcessHistoryEntry, type ProcessInput, type ProcessNames } from '../process'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

export type ProcessTarget =
  | { kind: 'task'; taskId: string }
  | { kind: 'form'; formId: string }
  | { kind: 'workflow'; workflowId: string }
  | { kind: 'run'; runId: string }

export interface ProcessDeps {
  db: SupabaseClient
  tenantId: string
  userId: string
  permissions: ReadonlySet<string>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function canViewRun(deps: ProcessDeps, runId: string): Promise<boolean> {
  const { data, error } = await (deps.db as any).rpc('can_view_run_progress', { p_run_id: runId, p_user_id: deps.userId })
  return !error && data === true
}

async function definitionFor(deps: ProcessDeps, workflowId: string, versionId: string | null, draft = false) {
  const db = deps.db as any
  const { data: wf } = await db.from('workflows').select('id, name, description, nodes, edges, published_version_id').eq('id', workflowId).eq('tenant_id', deps.tenantId).maybeSingle()
  if (!wf) return null
  const vid = versionId ?? (draft ? null : wf.published_version_id)
  if (vid) {
    const { data: v } = await db.from('workflow_versions').select('version_number, nodes, edges').eq('id', vid).maybeSingle()
    if (v) return { name: String(wf.name), description: wf.description ?? null, version: v.version_number ?? null, nodes: v.nodes ?? [], edges: v.edges ?? [] }
  }
  return { name: String(wf.name), description: wf.description ?? null, version: null, nodes: wf.nodes ?? [], edges: wf.edges ?? [] }
}

/** Names for the people, teams, tables, decision tables and workflows a definition mentions (this workspace only). */
async function namesFor(deps: ProcessDeps, nodes: any[], extraUserIds: string[]): Promise<ProcessNames> {
  const db = deps.db as any
  const ids = (key: string) => [...new Set(nodes.map((n) => n?.config?.[key]).filter((v) => typeof v === 'string' && UUID.test(v)))]
  const userIds = [...new Set([...ids('assignee_id'), ...extraUserIds.filter((v) => UUID.test(v))])]
  const [users, teams, tables, dts, wfs] = await Promise.all([
    userIds.length ? db.from('users').select('id, display_name, email').in('id', userIds) : { data: [] },
    ids('team_id').length ? db.from('teams').select('id, name').eq('tenant_id', deps.tenantId).in('id', ids('team_id')) : { data: [] },
    ids('table_id').length ? db.from('custom_tables').select('id, name').eq('tenant_id', deps.tenantId).in('id', ids('table_id')) : { data: [] },
    ids('decision_table_id').length ? db.from('decision_tables').select('id, name, rules').eq('tenant_id', deps.tenantId).in('id', ids('decision_table_id')) : { data: [] },
    ids('workflow_id').length ? db.from('workflows').select('id, name').eq('tenant_id', deps.tenantId).in('id', ids('workflow_id')) : { data: [] },
  ])
  const ruleText = (r: any) => {
    const conds = (Array.isArray(r?.conditions) ? r.conditions : []).map((c: any) => `${c.inputKey} ${c.operator === 'equals' ? 'is' : String(c.operator ?? 'is').replace(/_/g, ' ')} ${plainExpression(c.value)}`).join(' and ')
    const outs = Object.entries(r?.outputs ?? {}).slice(0, 3).map(([k, v]) => `${k} = ${String(v).slice(0, 40)}`).join(', ')
    return `${conds || 'otherwise'} → ${outs || r?.label || 'a result'}`
  }
  return {
    users: new Map(((users.data ?? []) as any[]).map((u) => [String(u.id), String(u.display_name || u.email)])),
    teams: new Map(((teams.data ?? []) as any[]).map((t) => [String(t.id), String(t.name)])),
    tables: new Map(((tables.data ?? []) as any[]).map((t) => [String(t.id), String(t.name)])),
    workflows: new Map(((wfs.data ?? []) as any[]).map((t) => [String(t.id), String(t.name)])),
    decisionTables: new Map(((dts.data ?? []) as any[]).map((t) => [String(t.id), { name: String(t.name), rules: (Array.isArray(t.rules) ? t.rules : []).filter((r: any) => r?.enabled !== false).slice(0, 10).map(ruleText) }])),
  }
}

/** The process description for a target, or { error } when the person can't see it. */
export async function processContext(deps: ProcessDeps, target: ProcessTarget): Promise<Record<string, unknown>> {
  const db = deps.db as any
  if (target.kind === 'task' || target.kind === 'run') {
    let runId: string | null = null
    let stepId: string | null = null
    let workflowId: string | null = null
    if (target.kind === 'task') {
      const { data: task } = await db.from('tasks').select('workflow_id, workflow_step_id, workflow_run_id').eq('id', target.taskId).eq('tenant_id', deps.tenantId).maybeSingle()
      if (!task?.workflow_id) return { error: 'This task is not part of a workflow' }
      runId = task.workflow_run_id ?? null; stepId = task.workflow_step_id ?? null; workflowId = task.workflow_id
    } else runId = target.runId
    if (!runId || !(await canViewRun(deps, runId))) return { error: 'You can\'t see this process' }
    const { data: run } = await db.from('workflow_runs').select('id, workflow_id, version_id, variables, paused_node_id, status').eq('id', runId).eq('tenant_id', deps.tenantId).maybeSingle()
    if (!run) return { error: 'The run was not found' }
    workflowId = run.workflow_id ?? workflowId
    const def = await definitionFor(deps, String(workflowId), run.version_id ?? null)
    if (!def) return { error: 'The workflow was not found' }
    const { data: done } = await db.from('tasks').select('title, workflow_step_id, outcome, outcome_notes, actioned_by, completed_at, status').eq('workflow_run_id', runId).eq('tenant_id', deps.tenantId).not('completed_at', 'is', null).order('completed_at', { ascending: true }).limit(20)
    const vars = run.variables && typeof run.variables === 'object' ? run.variables : {}
    const names = await namesFor(deps, def.nodes, [...((done ?? []) as any[]).map((t) => t.actioned_by), ...Object.values(vars).filter((v): v is string => typeof v === 'string')].filter(Boolean))
    const history: ProcessHistoryEntry[] = ((done ?? []) as any[]).map((t) => ({ step: String(t.title ?? 'A step'), by: names.users?.get(String(t.actioned_by)) ?? null, at: t.completed_at ? String(t.completed_at).slice(0, 10) : null, outcome: t.outcome ?? null, comment: t.outcome_notes ?? null }))
    return { process: describeProcess({ workflow: def, nodes: def.nodes, edges: def.edges, currentNodeId: stepId ?? run.paused_node_id ?? null, variables: vars, names, history }) }
  }
  if (!deps.permissions.has('workflows.view')) return { error: 'You need permission to view workflows to see the process behind this' }
  if (target.kind === 'form') {
    const { data: wfs } = await db.from('workflows').select('id, name, nodes').eq('tenant_id', deps.tenantId).eq('trigger_type', 'form_submitted').limit(200)
    const starts = ((wfs ?? []) as any[]).filter((w) => (Array.isArray(w.nodes) ? w.nodes : []).some((n: any) => n?.type === 'form_submitted' && n?.config?.form_id === target.formId))
    if (!starts.length) return { process: null, note: 'No workflow starts from this form.' }
    const out = []
    for (const w of starts.slice(0, 3)) {
      const def = await definitionFor(deps, String(w.id), null)
      if (def) out.push(describeProcess({ workflow: def, nodes: def.nodes, edges: def.edges, fromStart: true, names: await namesFor(deps, def.nodes, []) } as ProcessInput))
    }
    return { processes: out }
  }
  const def = await definitionFor(deps, target.workflowId, null, true)
  if (!def) return { error: 'The workflow was not found' }
  return { process: describeProcess({ workflow: { ...def, name: `${def.name} (draft)` }, nodes: def.nodes, edges: def.edges, names: await namesFor(deps, def.nodes, []) }) }
}

export function processTool(deps: ProcessDeps, target: ProcessTarget): AssistantToolDef {
  return {
    name: 'get_process_context',
    description: 'Describe the process behind this screen from the workflow itself: where the person is now, what happens after each outcome of the current step (next steps and who they go to, conditions and rules, emails, data writes, waits, parallel branches) and the history so far. Call it for "what happens next", "who approves after me", "what if I decline" questions and answer concretely from it.',
    parameters: { type: 'object', properties: {}, required: [] },
    mode: 'read',
    label: () => 'Reading the process',
    run: async () => ({ result: await processContext(deps, target) }),
  }
}
