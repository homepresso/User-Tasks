/**
 * "What happens next?" (pure, server-built): a workflow definition walked as a
 * graph into a plain description of the process — where the person is now,
 * what happens after each outcome of the current step (the steps until the
 * next human step or the end: conditions with their rules in plain words,
 * decision tables, who the next human step goes to, emails, data writes,
 * waits, parallel branches, sub-workflows) and the history so far.
 *
 * Deterministic — not model-guessed. Workflow internals are summarised in
 * plain words: no raw config, expressions turned into names ("{{form.amount}}"
 * → "the form's amount"), secrets never included (only whitelisted fields are
 * read). Size-capped: depth / step limits, loops reported once.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- definitions are JSON */

import { redactString } from '@/lib/agents/safety'
import { extractFunctionExpressions, resolveExpression } from '@/lib/expression-resolver'
import { isSensitiveFieldName } from '@/lib/response-schema'
import { isSensitiveKey } from '@/lib/secret-keys'
import { isMaskedSecret } from '@/lib/secret-format'

export interface ProcessNode { id: string; type: string; label?: string; config?: Record<string, any> }
export interface ProcessEdge { source: string; target: string; label?: string | null; sourceHandle?: string | null }

export interface ProcessNames {
  users?: Map<string, string>
  teams?: Map<string, string>
  tables?: Map<string, string>
  forms?: Map<string, string>
  workflows?: Map<string, string>
  decisionTables?: Map<string, { name: string; rules: string[] }>
}

export interface ProcessHistoryEntry { step: string; by?: string | null; at?: string | null; outcome?: string | null; comment?: string | null }

export interface ProcessInput {
  workflow: { name: string; description?: string | null; version?: number | null }
  nodes: ProcessNode[]
  edges: ProcessEdge[]
  /** The current step (the task's step); null with `fromStart`: what happens after the start form is submitted. */
  currentNodeId?: string | null
  fromStart?: boolean
  /** Run variables (to resolve assignee variables and conditions' values). */
  variables?: Record<string, unknown> | null
  names?: ProcessNames
  history?: ProcessHistoryEntry[]
}

export interface ProcessDescription {
  workflow: string
  now: string
  next: Array<{ outcome: string; steps: string[] }>
  history: string[]
  note?: string
}

export const MAX_STEPS_PER_PATH = 25
export const MAX_DEPTH = 6

const HUMAN = new Set(['user_task', 'approval', 'form_task'])
const TRIGGERS = new Set(['manual', 'form_submitted', 'start', 'schedule', 'webhook', 'email_received', 'data_table_event', 'api_trigger', 'middleware_received', 'workflow_sla'])

/** "{{form.amount}}" → "the form's amount"; "{{=…}}" → "a calculated value". */
export function plainExpression(value: unknown, variables?: Record<string, unknown> | null): string {
  const s = String(value ?? '').trim()
  if (!s) return '(empty)'
  if (/^\{\{\s*=/.test(s)) return 'a calculated value'
  return s.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, path: string) => {
    const p = path.trim()
    const v = variables ? getPath(variables, p) : undefined
    if (v !== undefined && v !== null && v !== '' && (isSecretPath(p) || (typeof v === 'string' && isSecretValue(v)))) return `${humanPath(p)} (${MASKED_VALUE})`
    if (v !== undefined && v !== null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') && String(v).length <= 60) return `${humanPath(p)} (${String(v)})`
    return humanPath(p)
  }).slice(0, 160)
}

/** How a secret value is shown (same mask as response samples / failure summaries). */
export const MASKED_VALUE = '••••'
const MAX_VALUE_CHARS = 60

/** A path naming a credential anywhere along it (`api_key`, `vendor.client_secret`, `auth.token`). */
function isSecretPath(path: string): boolean {
  return path.split(/[.[\]]+/).filter(Boolean).some((part) => isSensitiveKey(part) || isSensitiveFieldName(part))
}

/** A value that is itself a secret: ciphertext / the '__SECRET__' mask, or a token / API-key shape. */
function isSecretValue(value: string): boolean {
  return isMaskedSecret(value) || redactString(value) !== value
}

/** Run variables with credential-named keys and secret-shaped values replaced by the mask (for calculated values). */
function maskVariables(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return isSecretValue(value) ? MASKED_VALUE : value
  if (!value || typeof value !== 'object' || depth > 8) return value
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => maskVariables(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = (isSensitiveKey(k) || isSensitiveFieldName(k)) && v !== null && v !== '' && typeof v !== 'boolean' ? MASKED_VALUE : maskVariables(v, depth + 1)
  }
  return out
}

/** "form.vendor_name" → "vendor name"; "approval_task_data.comment" → "comment" (the name a person would use). */
function readableName(p: string): string {
  const step = p.match(/^[a-z0-9_]+_task_data\.(.+)$/)
  const rest = step ? step[1] : p.replace(/^(form|task_data|submission|variables|vars)\./, '')
  return words(rest) || words(p)
}

/** One run value as text, or null when it can't be shown inline (missing, empty, an object). */
function shownValue(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return null
  const text = String(v)
  if (typeof v === 'string' && isSecretValue(text)) return MASKED_VALUE
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS - 1)}…` : text
}

/**
 * A user-visible template ("Raise a PO for {{item}}") as the person would see
 * it: with a run, each `{{…}}` resolved against the run's variables through
 * the workflow expression resolver (secrets shown as ••••); without a run —
 * or when a value is missing / can't be resolved — the placeholder reads
 * "‹item›". Never throws.
 */
export function resolveTemplateText(value: unknown, variables?: Record<string, unknown> | null): string {
  const s = String(value ?? '').trim()
  if (!s.includes('{{')) return s.slice(0, 160)
  const vars = variables && typeof variables === 'object' ? variables : null
  let masked: Record<string, unknown> | null = null
  const safeVars = () => (masked ??= maskVariables(vars) as Record<string, unknown>)

  const variable = (path: string): string => {
    const p = path.trim()
    const placeholder = `‹${readableName(p)}›`
    if (!vars) return placeholder
    if (isSecretPath(p)) return MASKED_VALUE
    try {
      return shownValue(resolveExpression(`{{${p}}}`, { variables: vars })) ?? placeholder
    } catch {
      return placeholder
    }
  }
  const calculated = (expr: string): string => {
    if (!vars) return '‹calculated value›'
    try {
      // Evaluated over masked variables: a calculation can't surface a secret.
      return shownValue(resolveExpression(`{{=${expr}}}`, { variables: safeVars() })) ?? '‹calculated value›'
    } catch {
      return '‹calculated value›'
    }
  }
  const text = (piece: string) => piece.replace(/\{\{\s*([^}=][^}]*?)\s*\}\}/g, (_, path: string) => variable(path))

  let fns: Array<{ start: number; end: number; expr: string }> = []
  try { fns = extractFunctionExpressions(s) } catch { fns = [] }
  let out = ''
  let at = 0
  for (const fn of fns) {
    out += text(s.slice(at, fn.start)) + calculated(fn.expr)
    at = fn.end
  }
  out += text(s.slice(at))
  // An unterminated "{{=…" left over: never show raw template syntax.
  return out.replace(/\{\{\s*=[\s\S]*$/, '‹calculated value›').slice(0, 160)
}

function humanPath(p: string): string {
  if (p.startsWith('form.')) return `the form's ${words(p.slice(5))}`
  if (p.startsWith('task_data.')) return `the last task's ${words(p.slice(10))}`
  const step = p.match(/^([a-z0-9_]+)_task_data\.(.+)$/)
  if (step) return `the ${words(step[1])} step's ${words(step[2])}`
  if (p === 'submitted_by_manager_id') return "the submitter's manager"
  if (p === 'submitted_by' || p === 'submitted_by_email' || p === 'submitted_by_name') return 'the person who submitted it'
  if (p.startsWith('submission.')) return `the submission's ${words(p.slice(11))}`
  return words(p)
}

const words = (s: string) => s.replace(/[._]+/g, ' ').trim()

function getPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: any = obj
  for (const part of path.split('.')) { if (cur == null || typeof cur !== 'object') return undefined; cur = cur[part] }
  return cur
}

const OPS: Record<string, string> = {
  equals: 'is', '=': 'is', '==': 'is', not_equals: 'is not', '!=': 'is not', contains: 'contains', not_contains: "doesn't contain", starts_with: 'starts with', ends_with: 'ends with',
  in: 'is one of', matches: 'matches', gt: '>', greater_than: '>', '>': '>', gte: '≥', '>=': '≥', greater_than_or_equal: '≥', lt: '<', less_than: '<', '<': '<', lte: '≤', '<=': '≤', less_than_or_equal: '≤',
  is_empty: 'is empty', is_not_empty: 'is filled in', is_true: 'is yes', is_false: 'is no',
}

function ruleText(r: any, vars?: Record<string, unknown> | null): string {
  const op = OPS[String(r?.operator ?? 'equals')] ?? String(r?.operator ?? 'is')
  const field = plainExpression(r?.field ?? r?.left ?? '', vars)
  return ['is empty', 'is filled in', 'is yes', 'is no'].includes(op) ? `${field} ${op}` : `${field} ${op} ${plainExpression(r?.value ?? r?.right ?? '', vars)}`
}

function branchRule(node: ProcessNode, label: string | null | undefined, vars?: Record<string, unknown> | null): string | null {
  const c = node.config ?? {}
  if (node.type === 'condition') {
    const b = (Array.isArray(c.branches) ? c.branches : []).find((x: any) => String(x?.label ?? '').toLowerCase() === String(label ?? '').toLowerCase())
    if (b) return (Array.isArray(b.rules) ? b.rules : []).map((r: any) => ruleText(r, vars)).join(b.logic === 'or' ? ' or ' : ' and ') || null
    if (/^else|otherwise|default|false|no$/i.test(String(label ?? ''))) return 'otherwise'
    if (Array.isArray(c.rules)) return c.rules.map((r: any) => ruleText(r, vars)).join(' and ') // legacy true / false
  }
  if (node.type === 'switch_case') return label && !/default/i.test(label) ? `${plainExpression(c.field, vars)} is ${label}` : 'any other value'
  return null
}

function assignee(c: Record<string, any>, names: ProcessNames, vars?: Record<string, unknown> | null): string {
  const t = c.assignment_type ?? 'individual'
  if (t === 'team') return names.teams?.get(String(c.team_id)) ? `the ${names.teams.get(String(c.team_id))} team` : 'a team'
  if (t === 'aad_group') return c.aad_group_name ? `the ${c.aad_group_name} group` : 'an Entra ID group'
  if (c.assignee_variable) {
    const path = String(c.assignee_variable).replace(/^\{\{\s*|\s*\}\}$/g, '')
    const v = vars ? getPath(vars, path) : undefined
    const name = typeof v === 'string' ? names.users?.get(v) : undefined
    return name ? `${name} (${humanPath(path)})` : humanPath(path)
  }
  if (c.assignee_id) return names.users?.get(String(c.assignee_id)) ?? 'a specific person'
  return 'someone (not set)'
}

/** One step in plain words (null: a step not worth mentioning). */
export function describeStep(node: ProcessNode, names: ProcessNames = {}, vars?: Record<string, unknown> | null): string | null {
  const c = node.config ?? {}
  const label = node.label || node.type
  switch (node.type) {
    case 'user_task': case 'approval': case 'form_task': {
      const outcomes = Array.isArray(c.outcomes) && c.outcomes.length ? ` — choices: ${c.outcomes.join(', ')}` : ''
      const due = c.due_offset_amount ? `, due in ${c.due_offset_amount} ${c.due_offset_unit ?? 'days'}` : ''
      const title = c.task_title ? resolveTemplateText(c.task_title, vars) : ''
      const task = title && title !== label ? ` (task “${title}”)` : ''
      return `Human step “${label}”${task}: assigned to ${assignee(c, names, vars)}${outcomes}${due}`
    }
    case 'send_email': return `Emails ${plainExpression(c.to, vars)}${c.subject ? `: “${resolveTemplateText(c.subject, vars)}”` : ''}`
    case 'send_notification': case 'notification': case 'send_slack': case 'send_teams': return `Sends a notification${c.to || c.recipients ? ` to ${plainExpression(c.to ?? c.recipients, vars)}` : ''}`
    case 'update_data_table': {
      const table = names.tables?.get(String(c.table_id)) ?? (c.table_name ? resolveTemplateText(c.table_name, vars) : 'a data table')
      const op = c.operation === 'update' ? 'Updates the record in' : c.operation === 'delete' ? 'Deletes a record from' : c.operation === 'get' || c.operation === 'list' ? 'Looks up' : 'Records it in'
      return `${op} “${table}”${c.description ? ` — ${resolveTemplateText(c.description, vars)}` : ''}`
    }
    case 'decision_table': {
      const dt = names.decisionTables?.get(String(c.decision_table_id))
      const name = dt?.name ?? c.decision_table_name ?? 'a decision table'
      return `Checks the rules in “${name}”${dt?.rules.length ? `: ${dt.rules.slice(0, 5).join('; ')}${dt.rules.length > 5 ? '; …' : ''}` : ''}`
    }
    case 'delay': return `Waits ${c.duration ?? c.seconds ?? c.minutes ?? c.hours ?? c.days ?? ''} ${c.unit ?? ''}`.replace(/\s+/g, ' ').trim()
    case 'pause_until': return `Waits until ${plainExpression(c.date ?? c.until, vars)}`
    case 'set_sla': return `Sets an SLA${c.amount ? ` of ${c.amount} ${c.unit ?? 'days'}` : ''}`
    case 'parallel': return `Splits into parallel branches: ${(Array.isArray(c.branches) ? c.branches : []).map((b: any) => b?.label).filter(Boolean).join(', ') || 'several'}`
    case 'call_workflow': case 'sub_workflow': case 'start_workflow': case 'run_workflow': return `Starts the workflow “${names.workflows?.get(String(c.workflow_id)) ?? c.workflow_name ?? 'another workflow'}”`
    case 'end_workflow': return `Ends${c.reason ? `: ${resolveTemplateText(c.reason, vars)}` : ''}`
    case 'goto_activity': return `Goes back to “${c.target_node_label ?? 'an earlier step'}”`
    case 'run_agent': return `An AI agent step: “${label}”`
    case 'condition': case 'switch_case': return null
    case 'set_variable': case 'set_title': case 'log': case 'json_build_object': return null
    default: return TRIGGERS.has(node.type) ? null : `“${label}”`
  }
}

/** The steps after `fromId` along one outgoing edge, until the next human step or the end. */
function walk(start: string | null, ctx: { byId: Map<string, ProcessNode>; out: Map<string, ProcessEdge[]>; names: ProcessNames; vars?: Record<string, unknown> | null }, depth: number, seen: Set<string>, lines: string[], indent: string) {
  let id = start
  let count = 0
  while (id) {
    if (lines.length >= MAX_STEPS_PER_PATH) { lines.push(`${indent}…`); return }
    const node = ctx.byId.get(id)
    if (!node) return
    if (seen.has(id)) { lines.push(`${indent}Goes back to “${node.label || node.type}”`); return }
    seen.add(id)
    const text = describeStep(node, ctx.names, ctx.vars)
    if (text) lines.push(`${indent}${text}`)
    if (HUMAN.has(node.type) || node.type === 'end_workflow' || node.type === 'goto_activity') return
    const edges = ctx.out.get(id) ?? []
    if (!edges.length) { lines.push(`${indent}The process ends`); return }
    const branching = node.type === 'condition' || node.type === 'switch_case' || node.type === 'parallel' || (edges.length > 1 && node.type !== 'decision_table')
    if (branching) {
      if (depth >= MAX_DEPTH) { lines.push(`${indent}… (more branches)`); return }
      for (const e of edges) {
        const rule = branchRule(node, e.label, ctx.vars)
        lines.push(`${indent}${node.type === 'parallel' ? `At the same time — ${e.label || 'branch'}:` : rule ? `If ${rule}${e.label && rule !== 'otherwise' ? ` (${e.label})` : ''}:` : `Path “${e.label || 'next'}”:`}`)
        walk(e.target, ctx, depth + 1, new Set(seen), lines, `${indent}  `)
      }
      return
    }
    id = edges[0].target
    if (++count > MAX_STEPS_PER_PATH) return
  }
}

export function describeProcess(input: ProcessInput): ProcessDescription {
  const names = input.names ?? {}
  const byId = new Map(input.nodes.map((n) => [n.id, n]))
  const out = new Map<string, ProcessEdge[]>()
  for (const e of input.edges) out.set(e.source, [...(out.get(e.source) ?? []), e])
  const ctx = { byId, out, names, vars: input.variables }
  const wf = `${input.workflow.name}${input.workflow.version ? ` (version ${input.workflow.version})` : ''}${input.workflow.description ? ` — ${String(input.workflow.description).slice(0, 300)}` : ''}`
  const history = (input.history ?? []).slice(-15).map((h) => [h.step, h.outcome ? `→ ${h.outcome}` : '', h.by ? `by ${h.by}` : '', h.at ? `on ${h.at}` : '', h.comment ? `— “${String(h.comment).slice(0, 200)}”` : ''].filter(Boolean).join(' '))
  const current = input.currentNodeId ? byId.get(input.currentNodeId) : undefined
  const next: ProcessDescription['next'] = []
  if (current) {
    const edges = out.get(current.id) ?? []
    const outcomes: string[] = Array.isArray(current.config?.outcomes) && current.config!.outcomes.length ? current.config!.outcomes.map(String) : [...new Set(edges.map((e) => e.label || 'Next'))]
    for (const outcome of outcomes) {
      const matching = edges.filter((e) => (e.label || 'Next').toLowerCase() === outcome.toLowerCase())
      const unlabelled = edges.filter((e) => !e.label)
      const targets = matching.length ? matching : unlabelled
      const lines: string[] = []
      if (!targets.length) lines.push('The process ends')
      for (const e of targets) walk(e.target, ctx, 0, new Set([current.id]), lines, targets.length > 1 ? '  ' : '')
      next.push({ outcome, steps: lines })
    }
    return { workflow: wf, now: describeStep(current, names, input.variables) ?? `“${current.label || current.type}”`, next, history }
  }
  // From the start: what happens after the start form is submitted (or the run starts).
  const trigger = input.nodes.find((n) => TRIGGERS.has(n.type)) ?? input.nodes[0]
  const lines: string[] = []
  if (trigger) for (const e of out.get(trigger.id) ?? []) walk(e.target, ctx, 0, new Set([trigger.id]), lines, '')
  next.push({ outcome: input.fromStart ? 'After the form is submitted' : 'When the process starts', steps: lines.length ? lines : ['Nothing else happens'] })
  return { workflow: wf, now: input.fromStart ? 'Filling in the start form' : 'Not started', next, history }
}
