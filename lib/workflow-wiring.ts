/**
 * Workflow "wiring" checks: references (`{{…}}`) to variables that do not
 * exist where they are used, and config keys the engine never reads.
 *
 * A workflow built by an AI builder, the API or by hand can be structurally
 * valid and still miswired — `{{full_name}}` after a Form submitted trigger
 * (the field is `{{form.full_name}}`), `output_var` on a Data insert (the
 * engine reads `output_row_id_var`), `{{comment}}` after a User Task (its
 * values are `{{task_data.comment}}`). Those run, and resolve to blanks.
 *
 * Everything here is a WARNING: expressions can be dynamic (webhook payloads,
 * sub-workflow return values, a run started with extra variables), so an
 * unknown reference never blocks saving. Where the workflow's run variables
 * are open-ended (webhook / middleware / task triggers, no trigger, a step
 * with unknown outputs upstream), only references with a confident
 * correction are reported.
 *
 * What each step and trigger sets comes from the data picker
 * (lib/workflow-data-picker.ts) plus lib/workflow-system-variables.ts.
 * Expressions are parsed with the engine's own parsers
 * (lib/expression-resolver.ts, lib/expression-functions.ts).
 *
 * Pure and isomorphic: the designer, MCP, REST and the gallery checker share it.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

import { extractFunctionExpressions, normalizeIndexPath } from './expression-resolver'
import { parseFunctionCall, tokenizeFormula } from './expression-functions'
import {
  buildDataTree,
  loopBodyNodeIds,
  nodeFormFields,
  nodeOutputPrefix,
  rootsForNode,
  type LinkedFormLike,
  type PickerEdgeLike,
  type PickerNodeLike,
  type PickerWorkflowVariable,
} from './workflow-data-picker'
import {
  ALWAYS_RUN_VARIABLES,
  STEP_DEFAULT_OUTPUTS,
  STEP_GENERIC_VARIABLES,
  USER_TASK_PER_STEP_VARIABLES,
} from './workflow-system-variables'
import { DATA_FILTER_OPERATORS, canonicalDataFilterOperator } from './workflow-node-handlers'
import { layoutFormRules } from './forms/form-rules'
import { allActions } from './forms/field-buttons'

export interface WiringWarning {
  node_id: string
  node_label: string
  /**
   * `reference`: a `{{…}}` that will be blank; `config_key`: a setting the
   * engine ignores; `syntax`: an expression the engine cannot read;
   * `prefill`: a User Task's read-only form fields that nothing fills;
   * `unassigned`: a User Task with no assignee (the task sits in the queue
   * with nobody assigned); `assigned_for_testing`: an info note — the task
   * is assigned to the workflow's creator for testing (the Agent's default).
   */
  kind: 'reference' | 'config_key' | 'syntax' | 'prefill' | 'unassigned' | 'assigned_for_testing'
  /** `info` for notes that need no fix (assigned_for_testing); warnings otherwise. */
  severity?: 'warning' | 'info'
  message: string
  /** What to write instead: an expression (`{{form.full_name}}`) or a config key (`output_row_id_var`). */
  suggestion?: string
  /** The reference as written (`{{full_name}}`). */
  reference?: string
  /** Where in the node's config (`column_values.name`, `output_var`). */
  key?: string
}

export interface WiringInput {
  nodes: unknown[]
  edges: unknown[]
  workflowVariables?: PickerWorkflowVariable[] | null
  /** Latest versions of linked reusable forms by id (fills nodes without a cached `fields` copy). */
  linkedForms?: Record<string, LinkedFormLike> | null
  /** Only check these steps (the designer's selected node); default every step. */
  onlyNodeIds?: string[] | null
}

const TRIGGER_TYPES = new Set([
  'task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected',
  'workflow_error', 'workflow_sla', 'retention_policy_review', 'retention_policy_executed', 'data_table_event', 'form_submitted',
  'middleware_received', 'schedule', 'webhook_received', 'esign_event', 'manual',
])

/** Triggers whose run variables are fully known (everything else may carry extra, dynamic names). */
const CLOSED_TRIGGERS = new Set(['form_submitted', 'schedule', 'workflow_error', 'esign_event'])

/** Variables a trigger sets beyond what the data picker lists. */
const TRIGGER_VARIABLES: Record<string, readonly string[]> = {
  form_submitted: ['task_id'],
  schedule: ['scheduled_at'],
  workflow_error: ['error_workflow_id', 'error_workflow_name', 'error_run_id', 'error_message', 'error_node', 'error_node_id', 'error_node_type', 'error_timestamp'],
  esign_event: ['esign_event', 'esign_provider', 'esign_integration_id', 'esign_envelope_id', 'esign_status', 'esign_recipient', 'esign_envelope'],
  data_table_event: ['data_event', 'data_event_type', 'data_table_id', 'data_table_name', 'data_row_id', 'data_row', 'row', 'row_id', 'previous_row', 'changed_fields'],
  webhook_received: ['_raw'],
  middleware_received: ['_raw'],
}

/** Top-level config keys that hold form designs, not workflow expressions (User Task / form nodes). */
const FORM_DESIGN_KEYS = new Set(['fields', 'form_layout', 'layout', 'start_form', 'form_theme', 'buttons', 'custom_rule_expression'])
/** Keys (at any depth) whose text is literal: document placeholders to find, sample payloads. */
const LITERAL_KEYS = new Set(['find', 'response_schema', 'sample', 'example'])

const KEYWORDS = new Set(['true', 'false', 'null', 'row', 'and', 'or', 'not'])

// ─── Expression references ─────────────────────────────────────────────

export interface ExpressionReference {
  /** The variable path (`form.full_name`, `items[0].name`). */
  path: string
  /** A bare identifier inside a `{{= … }}` formula (unknown ones are literal text, not variables). */
  bare: boolean
  /** As written (`{{full_name}}`, or the identifier itself). */
  text: string
}

export interface ExpressionScan {
  references: ExpressionReference[]
  /** `{{ name }}` — the engine only reads `{{name}}` (no spaces). */
  spaced: { text: string; path: string }[]
}

const BRACED_IN_FORMULA = /\{\{\s*([\w.\-[\]]+)\s*\}\}/g

/** Bare identifiers of a formula body (function names, quoted text and literals left out). */
function formulaIdentifiers(body: string, out: string[], depth = 0): void {
  if (depth > 8 || !body.trim()) return
  const tokens = tokenizeFormula(body)
  if (!tokens) {
    // Text the operator tokenizer cannot read (array literals…): one call, args one by one.
    const call = parseFunctionCall(body.trim())
    if (call) for (const arg of call.args) formulaIdentifiers(arg, out, depth + 1)
    return
  }
  for (const token of tokens) {
    if (token.t === 'id') out.push(token.v)
    else if (token.t === 'call') {
      const call = parseFunctionCall(token.v)
      if (call) for (const arg of call.args) formulaIdentifiers(arg, out, depth + 1)
    }
  }
}

/** Every variable reference in one config string, using the engine's own parsing rules. */
export function scanExpression(text: string): ExpressionScan {
  const scan: ExpressionScan = { references: [], spaced: [] }
  if (typeof text !== 'string' || !text.includes('{{')) return scan
  const formulas = extractFunctionExpressions(text)
  for (const formula of formulas) {
    const braced: string[] = []
    const body = formula.expr.replace(BRACED_IN_FORMULA, (_m, path: string) => { braced.push(path); return path })
    for (const path of braced) scan.references.push({ path, bare: false, text: `{{${path}}}` })
    const ids: string[] = []
    formulaIdentifiers(body, ids)
    for (const id of ids) {
      if (KEYWORDS.has(id) || braced.includes(id)) continue
      scan.references.push({ path: id, bare: true, text: id })
    }
  }
  // Outside the formulas: `{{path}}` (exactly the engine's pattern), and `{{ path }}` it will not read.
  let rest = text
  for (let i = formulas.length - 1; i >= 0; i--) rest = rest.slice(0, formulas[i].start) + ' ' + rest.slice(formulas[i].end)
  const re = /\{\{([^{}]*)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(rest)) !== null) {
    const inner = m[1]
    if (/^[\w.\-[\]]+$/.test(inner)) scan.references.push({ path: inner, bare: false, text: m[0] })
    else if (/^\s*[\w.\-[\]]+\s*$/.test(inner)) scan.spaced.push({ text: m[0], path: inner.trim() })
  }
  return scan
}

/** Config strings with `{{`, with their key path (snapshots `_…`, form designs and literal text skipped). */
function configStrings(value: unknown, path: string, out: { key: string; text: string }[], depth = 0, skipTop?: Set<string>): void {
  if (depth > 12 || out.length > 5000) return
  if (typeof value === 'string') {
    if (value.includes('{{')) out.push({ key: path, text: value })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => configStrings(item, `${path}[${index}]`, out, depth + 1))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('_') || LITERAL_KEYS.has(key) || (depth === 0 && skipTop?.has(key))) continue
      configStrings(child, path ? `${path}.${key}` : key, out, depth + 1)
    }
  }
}

// ─── Suggestions ───────────────────────────────────────────────────────

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** The closest candidate (case-insensitive), when it is close enough to be a typo. */
export function closestMatch(word: string, candidates: Iterable<string>): string | null {
  const target = word.toLowerCase()
  const max = Math.min(3, Math.max(1, Math.floor(target.length / 4)))
  let best: { value: string; distance: number } | null = null
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase()
    if (lower === target) return candidate
    const distance = editDistance(target, lower, max)
    if (distance <= max && (!best || distance < best.distance)) best = { value: candidate, distance }
  }
  return best?.value ?? null
}

// ─── The variables each step / trigger makes ──────────────────────────

interface NodeInfo {
  node: PickerNodeLike
  prefix: string
  /** Root paths it sets (original case). */
  outputs: string[]
  /** Its outputs can't be listed (sub-workflow returns, an un-snapshotted business rule…). */
  dynamic: boolean
  /** User Task / task form field keys (null = a linked form we could not read). */
  formKeys: string[] | null
}

const OUTPUT_KEY = /(^output$|^output_|_var$|_variable$|^binding_name$)/
const IDENTIFIER = /^[A-Za-z_][\w.]*$/

function nodeInfo(node: PickerNodeLike, linkedForms: Record<string, LinkedFormLike> | null | undefined): NodeInfo {
  const c = node.config ?? {}
  const prefix = nodeOutputPrefix(node)
  const outputs = new Set<string>()
  let dynamic = false
  for (const root of rootsForNode(node, [], linkedForms)) outputs.add(root.path)
  for (const name of STEP_GENERIC_VARIABLES[node.type] ?? []) { outputs.add(name); outputs.add(`${prefix}_${name}`) }
  for (const name of STEP_DEFAULT_OUTPUTS[node.type] ?? []) outputs.add(name)
  for (const [key, value] of Object.entries(c)) {
    if (OUTPUT_KEY.test(key) && typeof value === 'string' && IDENTIFIER.test(value.trim())) outputs.add(value.trim())
  }
  let formKeys: string[] | null = null
  switch (node.type) {
    case 'loop_n_times': {
      const indexVar = String(c.index_var ?? '').trim() || 'i'
      outputs.add(indexVar); outputs.add(`${indexVar}_total`)
      break
    }
    case 'user_task': {
      for (const name of USER_TASK_PER_STEP_VARIABLES) outputs.add(`${prefix}_${name}`)
      const fields = nodeFormFields(node, linkedForms)
      const unreadable = !fields.length && typeof c.form_id === 'string' && c.form_id && !linkedForms?.[c.form_id]
      formKeys = unreadable ? null : formEntryKeys(node, linkedForms)
      break
    }
    case 'decision_table': {
      const declared = Array.isArray(c._decision_outputs) ? c._decision_outputs : null
      if (!declared) dynamic = true
      for (const output of declared ?? []) {
        const key = String(output?.key ?? '').trim()
        if (key) { outputs.add(key); outputs.add(`${prefix}_${key}`) }
      }
      break
    }
    case 'update_data_table': {
      if ((c.operation ?? 'insert') === 'get') {
        // A get also sets each column as a variable (and `<prefix>_<column>`).
        const cols = Array.isArray(c._table_columns) ? c._table_columns : null
        if (!cols) dynamic = true
        for (const col of cols ?? []) {
          const key = String(col?.key ?? '').trim()
          if (key) { outputs.add(key); outputs.add(`${prefix}_${key}`) }
        }
      }
      break
    }
    case 'custom_activity':
      if (!Array.isArray(c._action_outputs) && !Array.isArray(c.manifest?.outputs)) dynamic = true
      break
    case 'run_agent':
      if (!Array.isArray(c._agent_outputs)) dynamic = true
      break
    case 'call_reference':
      // Response fields can be mapped to variables by name.
      if (!c._ref_outputs && !c.output_mappings) dynamic = true
      break
    case 'call_sub_workflow':
    case 'server_event':
      // Return / event variables are named by the other side.
      dynamic = true
      break
  }
  return { node, prefix, outputs: [...outputs], dynamic, formKeys }
}

/** Keys of a form node's fields as the run carries them (lookups' `_item` / `_label`, attachments' `_count`, …). */
function formEntryKeys(node: PickerNodeLike, linkedForms: Record<string, LinkedFormLike> | null | undefined): string[] {
  const group = buildDataTree({ nodes: [node], edges: [], linkedForms })
    .find((g) => g.kind === 'form')
  if (!group) return []
  const keys: string[] = []
  for (const root of group.roots) {
    const m = /^(?:form|task_data|task\.data)\.(.+)$/.exec(root.path)
    if (m) keys.push(m[1])
  }
  return keys
}

// ─── The validator ─────────────────────────────────────────────────────

interface TriggerScope {
  /** Root paths every step can read (original case). */
  roots: Set<string>
  /** Trigger form field keys (`form.<key>`), null when there is no readable trigger form. */
  formKeys: string[] | null
  formName: string
  /** Task trigger form field keys (`task.data.<key>`). */
  taskTriggerKeys: string[]
  /** Every trigger's variables are known. */
  closed: boolean
  hasTaskTrigger: boolean
}

function triggerScope(triggers: PickerNodeLike[], input: WiringInput): TriggerScope {
  const roots = new Set<string>(ALWAYS_RUN_VARIABLES)
  for (const variable of input.workflowVariables ?? []) {
    const name = String(variable?.name ?? '').trim()
    if (name) roots.add(name)
  }
  let formKeys: string[] | null = null
  let formName = 'form'
  const taskTriggerKeys: string[] = []
  let closed = triggers.length > 0
  let hasTaskTrigger = false
  for (const trigger of triggers) {
    for (const group of buildDataTree({ nodes: [trigger], edges: [], linkedForms: input.linkedForms })) {
      for (const root of group.roots) roots.add(root.path)
    }
    for (const name of TRIGGER_VARIABLES[trigger.type] ?? []) roots.add(name)
    if (trigger.type === 'form_submitted') {
      const fields = nodeFormFields(trigger, input.linkedForms)
      const formId = typeof trigger.config?.form_id === 'string' ? trigger.config.form_id : ''
      const readable = fields.length > 0 || (!!formId && !!input.linkedForms?.[formId])
      if (readable) formKeys = [...(formKeys ?? []), ...formEntryKeys(trigger, input.linkedForms)]
      else closed = false
      formName = String(trigger.config?.form_name ?? input.linkedForms?.[formId]?.name ?? 'form')
    } else if (trigger.type.startsWith('task_')) {
      hasTaskTrigger = true
      taskTriggerKeys.push(...formEntryKeys(trigger, input.linkedForms))
      roots.add('task'); roots.add('task_data')
    }
    const columnsKnown = trigger.type === 'data_table_event' && Array.isArray(trigger.config?._table_columns)
    if (columnsKnown) for (const col of trigger.config._table_columns) if (col?.key) roots.add(String(col.key))
    if (!CLOSED_TRIGGERS.has(trigger.type) && !columnsKnown) closed = false
  }
  return { roots, formKeys, formName, taskTriggerKeys, closed, hasTaskTrigger }
}

function asNode(raw: unknown): PickerNodeLike | null {
  if (!raw || typeof raw !== 'object') return null
  const n = raw as Record<string, any>
  if (typeof n.id !== 'string' || !n.id || typeof n.type !== 'string') return null
  return { id: n.id, type: n.type, label: String(n.label ?? n.type), config: n.config && typeof n.config === 'object' && !Array.isArray(n.config) ? n.config : {} }
}

function asEdge(raw: unknown): PickerEdgeLike | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, any>
  if (typeof e.source !== 'string' || typeof e.target !== 'string') return null
  return { source: e.source, target: e.target, label: typeof e.label === 'string' ? e.label : undefined }
}

/**
 * Warnings for references that will resolve to nothing and config keys the
 * engine ignores. Linear in the graph per step (ancestors by BFS); form
 * fields are read once per form node.
 */
export function validateWorkflowWiring(input: WiringInput): WiringWarning[] {
  const nodes = (Array.isArray(input.nodes) ? input.nodes : []).map(asNode).filter((n): n is PickerNodeLike => !!n)
  const edges = (Array.isArray(input.edges) ? input.edges : []).map(asEdge).filter((e): e is PickerEdgeLike => !!e)
  const warnings: WiringWarning[] = []
  if (!nodes.length) return warnings

  // Go To Activity jumps are edges for scoping.
  const graphEdges = [...edges]
  for (const node of nodes) {
    const target = node.type === 'goto_activity' ? String(node.config?.target_node_id ?? '') : ''
    if (target) graphEdges.push({ source: node.id, target })
  }
  const incoming = new Map<string, string[]>()
  for (const edge of graphEdges) {
    const list = incoming.get(edge.target) ?? []
    list.push(edge.source)
    incoming.set(edge.target, list)
  }

  const triggers = nodes.filter((n) => TRIGGER_TYPES.has(n.type))
  const scope = triggerScope(triggers, input)
  const infos = new Map<string, NodeInfo>()
  for (const node of nodes) if (!TRIGGER_TYPES.has(node.type)) infos.set(node.id, nodeInfo(node, input.linkedForms))

  // Root path (lower case) → producing step ids; '*' = everywhere.
  const producers = new Map<string, Set<string>>()
  // Proper prefixes of root paths (`form` of `form.name`), so `{{form}}` reads as known.
  const parents = new Map<string, Set<string>>()
  const originalCase = new Map<string, string>()
  const addRoot = (path: string, producer: string) => {
    const lower = path.toLowerCase()
    if (!originalCase.has(lower)) originalCase.set(lower, path)
    let set = producers.get(lower)
    if (!set) producers.set(lower, (set = new Set()))
    set.add(producer)
    const parts = lower.split('.')
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('.')
      let pset = parents.get(parent)
      if (!pset) parents.set(parent, (pset = new Set()))
      pset.add(producer)
    }
  }
  for (const root of scope.roots) addRoot(root, '*')
  for (const info of infos.values()) for (const out of info.outputs) addRoot(out, info.node.id)

  // Loop bodies (a loop's item / index variables are its outputs; inside the body they also come from it).
  const loopBodies = nodes.filter((n) => n.type === 'loop').map((loop) => ({ loop, body: loopBodyNodeIds(loop.id, edges) }))

  const ancestorsOf = (nodeId: string): Set<string> => {
    const seen = new Set<string>()
    const queue = [...(incoming.get(nodeId) ?? [])]
    while (queue.length) {
      const id = queue.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      for (const source of incoming.get(id) ?? []) if (!seen.has(source)) queue.push(source)
    }
    seen.add(nodeId) // a step may read what it set on an earlier pass (loops), and its own outputs
    for (const { loop, body } of loopBodies) if (body.has(nodeId)) seen.add(loop.id)
    return seen
  }

  const producedHere = (set: Set<string> | undefined, ancestors: Set<string>) => {
    if (!set) return false
    if (set.has('*')) return true
    for (const id of set) if (ancestors.has(id)) return true
    return false
  }

  const only = input.onlyNodeIds?.length ? new Set(input.onlyNodeIds) : null
  for (const node of nodes) {
    if (TRIGGER_TYPES.has(node.type) || (only && !only.has(node.id))) continue
    const strings: { key: string; text: string }[] = []
    configStrings(node.config, '', strings, 0, node.type === 'user_task' ? FORM_DESIGN_KEYS : undefined)
    const base = { node_id: node.id, node_label: node.label }
    warnings.push(...configKeyWarnings(node).map((w) => ({ ...base, ...w })))
    if (node.type === 'user_task') warnings.push(...prefillWarnings(node, input.linkedForms, scope.formKeys).map((w) => ({ ...base, ...w })))
    if (node.type === 'user_task') warnings.push(...assignmentWarnings(node, triggers).map((w) => ({ ...base, ...w })))
    if (!strings.length) continue

    const ancestors = ancestorsOf(node.id)
    const upstreamTasks: NodeInfo[] = []
    // Open: the run may hold names we cannot list (trigger payloads, steps with unknown outputs).
    let dynamicUpstream = false
    for (const id of ancestors) {
      const up = infos.get(id)
      if (!up) continue
      if (up.dynamic && id !== node.id) dynamicUpstream = true
      if (up.node.type === 'user_task' && id !== node.id) upstreamTasks.push(up)
    }
    const open = !scope.closed || dynamicUpstream
    // task_data.<key>: the latest User Task's values (or a task trigger's) — closed when every upstream task's form is readable.
    const taskDataKnown = !scope.hasTaskTrigger && (upstreamTasks.length ? upstreamTasks.every((t) => t.formKeys !== null) : scope.closed)
    const taskDataKeys = new Set(upstreamTasks.flatMap((t) => t.formKeys ?? []))
    const seen = new Set<string>()

    const isKnown = (path: string): boolean => {
      const lower = path.toLowerCase()
      if (producedHere(parents.get(lower), ancestors)) return true
      const parts = lower.split('.')
      for (let i = parts.length; i >= 1; i--) {
        if (producedHere(producers.get(parts.slice(0, i).join('.')), ancestors)) return true
      }
      return false
    }

    /** A bare name that is a form field somewhere: the path it should be. */
    const fieldCorrection = (path: string): { suggestion: string; message: string } | null => {
      const [head, ...tail] = path.split('.')
      const rest = tail.length ? `.${tail.join('.')}` : ''
      const formKey = scope.formKeys?.find((k) => k === head) ?? scope.formKeys?.find((k) => k.toLowerCase() === head.toLowerCase())
      if (formKey) {
        return { suggestion: `{{form.${formKey}${rest}}}`, message: `form fields are under form. after a Form submitted trigger — "${head}" is a field of ${quoteName(scope.formName)}` }
      }
      const tasks = upstreamTasks.filter((t) => t.formKeys?.some((k) => k.toLowerCase() === head.toLowerCase()))
      if (tasks.length) {
        const task = tasks[0]
        const key = task.formKeys!.find((k) => k.toLowerCase() === head.toLowerCase())!
        const single = upstreamTasks.length === 1
        return {
          suggestion: single ? `{{task_data.${key}${rest}}}` : `{{${task.prefix}_task_data.${key}${rest}}}`,
          message: single
            ? `a User Task's form values are under task_data. — "${key}" is a field of "${task.node.label}" ({{${task.prefix}_task_data.${key}}} also works)`
            : `a User Task's form values are under task_data. (the latest task's) or <step>_task_data. — "${key}" is a field of "${task.node.label}"`,
        }
      }
      const triggerKey = scope.taskTriggerKeys.find((k) => k.toLowerCase() === head.toLowerCase())
      if (triggerKey) return { suggestion: `{{task.data.${triggerKey}${rest}}}`, message: `the triggering task's form values are under task.data.` }
      return null
    }

    const candidates = (): string[] => {
      const out: string[] = []
      for (const [path, set] of producers) if (producedHere(set, ancestors)) out.push(originalCase.get(path) ?? path)
      for (const key of scope.formKeys ?? []) out.push(`form.${key}`)
      for (const key of taskDataKeys) out.push(`task_data.${key}`)
      return out
    }

    const check = (ref: ExpressionReference, key: string): WiringWarning | null => {
      const path = normalizeIndexPath(ref.path)
      if (!path || /^\d/.test(path)) return null
      const [head, field] = path.split('.')
      const headLower = head.toLowerCase()
      const shown = ref.bare ? ref.text : `{{${ref.path}}}`

      // Closed namespaces: the trigger form's fields and User Task form values.
      if (headLower === 'form' && field !== undefined && scope.formKeys) {
        if (scope.formKeys.includes(field)) return null
        const viaTask = upstreamTasks.find((t) => t.formKeys?.includes(field))
        const close = closestMatch(field, scope.formKeys)
        return {
          ...base, kind: 'reference', reference: shown, key,
          message: `${shown}: ${quoteName(scope.formName)} has no field "${field}"${viaTask ? ` ("${field}" is a field of the User Task "${viaTask.node.label}")` : ''}`,
          ...(viaTask ? { suggestion: `{{task_data.${path.slice(5)}}}` } : close ? { suggestion: `{{form.${close}${path.slice(5 + field.length)}}}` } : {}),
        }
      }
      if (headLower === 'task_data' && field !== undefined && taskDataKnown) {
        if (taskDataKeys.has(field)) return null
        const rest = path.slice(10 + field.length)
        if (scope.formKeys?.includes(field)) {
          return { ...base, kind: 'reference', reference: shown, key, message: `${shown}: "${field}" is a field of the trigger form, not a User Task's`, suggestion: `{{form.${field}${rest}}}` }
        }
        if (!upstreamTasks.length) {
          return { ...base, kind: 'reference', reference: shown, key, message: `${shown}: no User Task runs before this step, so task_data is empty` }
        }
        const close = closestMatch(field, taskDataKeys)
        return {
          ...base, kind: 'reference', reference: shown, key,
          message: `${shown}: no User Task form before this step has a field "${field}"`,
          ...(close ? { suggestion: `{{task_data.${close}${rest}}}` } : {}),
        }
      }
      const perTask = upstreamTasks.find((t) => headLower === `${t.prefix}_task_data`.toLowerCase())
      if (perTask && field !== undefined && perTask.formKeys) {
        if (perTask.formKeys.includes(field)) return null
        const close = closestMatch(field, perTask.formKeys)
        return {
          ...base, kind: 'reference', reference: shown, key,
          message: `${shown}: the form of "${perTask.node.label}" has no field "${field}"`,
          ...(close ? { suggestion: `{{${perTask.prefix}_task_data.${close}${path.slice(head.length + 1 + field.length)}}}` } : {}),
        }
      }

      if (isKnown(path)) return null

      // A step upstream may set this very name (a business rule output, a sub-workflow return).
      const correction = dynamicUpstream ? null : fieldCorrection(path)
      if (correction) {
        return { ...base, kind: 'reference', reference: shown, key, message: `${shown} is not a variable here: ${correction.message}`, suggestion: correction.suggestion }
      }
      // Bare formula identifiers that are not variables are literal text — never reported otherwise.
      if (ref.bare || open) return null
      const pool = candidates()
      let close = closestMatch(path, pool)
      if (!close && path.includes('.')) {
        // `persn.name` → `person.name`: a typo in the variable, then the same path inside it.
        const root = closestMatch(head, pool.filter((c) => !c.includes('.')))
        if (root) close = `${root}${path.slice(head.length)}`
      }
      return {
        ...base, kind: 'reference', reference: shown, key,
        message: `${shown} is not set by the trigger, a workflow variable or any step before "${node.label}" — it will be blank`,
        ...(close ? { suggestion: `{{${close}}}` } : {}),
      }
    }

    for (const { key, text } of strings) {
      const scan = scanExpression(text)
      for (const spaced of scan.spaced) {
        const id = `s:${spaced.text}`
        if (seen.has(id)) continue
        seen.add(id)
        warnings.push({ ...base, kind: 'syntax', key, reference: spaced.text, message: `${spaced.text}: the engine does not read spaces inside {{ }} — it stays as literal text`, suggestion: `{{${spaced.path}}}` })
      }
      for (const ref of scan.references) {
        const id = `${ref.bare ? 'b' : 'r'}:${ref.path}`
        if (seen.has(id)) continue
        seen.add(id)
        const warning = check(ref, key)
        if (warning) warnings.push(warning)
      }
    }
  }
  return warnings
}

// ─── User Task assignment ──────────────────────────────────────────────

const filledText = (v: unknown) => typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null && v !== false

/**
 * Who a User Task goes to, as the engine resolves it (lib/workflow-engine.ts
 * user_task): individual (the default) → assignee_id or assignee_variable;
 * team → team_id; aad_group → aad_group_id. None of them → the task is
 * created with nobody assigned and waits in the queue.
 */
export function userTaskIsUnassigned(config: Record<string, any> | null | undefined): boolean {
  const c = config ?? {}
  const type = String(c.assignment_type ?? 'individual')
  if (type === 'team') return !filledText(c.team_id)
  if (type === 'aad_group') return !filledText(c.aad_group_id)
  return !filledText(c.assignee_id) && !filledText(c.assignee_variable)
}

/** The "who started it" variable for the workflow's trigger. */
function starterVariable(triggers: PickerNodeLike[]): string {
  return triggers.some((t) => t.type === 'form_submitted') ? '{{submitted_by}}' : '{{workflow_started_by}}'
}

function assignmentWarnings(node: PickerNodeLike, triggers: PickerNodeLike[]): Omit<WiringWarning, 'node_id' | 'node_label'>[] {
  const c = node.config ?? {}
  if (userTaskIsUnassigned(c)) {
    const starter = starterVariable(triggers)
    const formTrigger = triggers.some((t) => t.type === 'form_submitted')
    return [{
      kind: 'unassigned',
      key: String(c.assignment_type ?? 'individual') === 'team' ? 'team_id' : 'assignee_id',
      message: `User Task "${node.label}" has no assignee: the task will sit in the queue with nobody assigned. Assign it to a person (assignee_id), a team (assignment_type "team" + team_id)${formTrigger ? ', the submitter\'s manager (assignee_variable: "{{submitted_by_manager_id}}")' : ''} or the person who started it (assignee_variable: "${starter}")`,
      suggestion: `assignee_variable: "${formTrigger ? '{{submitted_by_manager_id}}' : starter}"`,
    }]
  }
  if (c._assigned_for_testing === true && filledText(c.assignee_id)) {
    return [{
      kind: 'assigned_for_testing',
      severity: 'info',
      key: 'assignee_id',
      message: `User Task "${node.label}" is assigned to the workflow's creator for testing — change the assignee before publishing`,
    }]
  }
  return []
}

// ─── User Task prefill ─────────────────────────────────────────────────

/** Form fields something fills on the form itself: rule Set / Copy values targets, lookup fills, value bindings. */
function formWrittenKeys(fields: ReturnType<typeof nodeFormFields>, layout: unknown): Set<string> {
  const keys = new Set<string>()
  for (const rule of layoutFormRules(layout)) {
    if (rule.disabled) continue
    for (const action of allActions(rule.then)) {
      if ((action.type === 'set_values' || action.type === 'copy_values') && action.assign) for (const key of Object.keys(action.assign)) keys.add(key)
    }
  }
  for (const field of fields) {
    for (const fill of field.lookup?.fill ?? []) if (fill?.to) keys.add(fill.to)
    if (field.dynamic && Object.keys(field.dynamic).length) keys.add(field.key)
  }
  return keys
}

/**
 * A User Task whose form has read-only fields with no value source (no
 * default, not in the step's field_values, not written by the form's rules):
 * the assignee sees them blank. Also unknown keys in field_values.
 */
function prefillWarnings(node: PickerNodeLike, linkedForms: Record<string, LinkedFormLike> | null | undefined, triggerFormKeys: string[] | null): Omit<WiringWarning, 'node_id' | 'node_label'>[] {
  const c = node.config ?? {}
  const formId = typeof c.form_id === 'string' ? c.form_id : ''
  const fields = nodeFormFields(node, linkedForms)
  if (!fields.length) return []
  const out: Omit<WiringWarning, 'node_id' | 'node_label'>[] = []
  const map: Record<string, unknown> = c.field_values && typeof c.field_values === 'object' && !Array.isArray(c.field_values) ? c.field_values : {}
  const keys = new Set(fields.map((f) => f.key))
  for (const key of Object.keys(map)) {
    if (keys.has(key)) continue
    const close = closestMatch(key, keys)
    out.push({ kind: 'config_key', key: `field_values.${key}`, message: `field_values names "${key}", which is not a field of the task's form — it is ignored`, ...(close ? { suggestion: close } : {}) })
  }
  const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== ''
  const layout = (formId ? linkedForms?.[formId]?.layout : undefined) ?? c.form_layout
  const written = formWrittenKeys(fields, layout)
  const missing = fields.filter((f) => f.read_only && f.type !== 'label' && f.type !== 'button' && !filled(f.default) && !filled(map[f.key]) && !written.has(f.key))
  if (!missing.length) return out
  const formName = String(c.form_name ?? (formId ? linkedForms?.[formId]?.name : '') ?? '').trim()
  const mapping = Object.fromEntries(missing.map((f) => [f.key, triggerFormKeys?.includes(f.key) ? `{{form.${f.key}}}` : '{{…}}']))
  out.push({
    kind: 'prefill',
    key: 'field_values',
    message: `User Task "${node.label}" uses ${formName ? `form "${formName}"` : 'a form'} whose read-only field${missing.length === 1 ? '' : 's'} ${missing.map((f) => f.key).join(', ')} ${missing.length === 1 ? 'has' : 'have'} no value source — the assignee sees ${missing.length === 1 ? 'it' : 'them'} blank. Prefill ${missing.length === 1 ? 'it' : 'them'} on the step with field_values (the form is not changed), or give the field${missing.length === 1 ? '' : 's'} a default`,
    suggestion: `field_values: ${JSON.stringify(mapping)}`,
  })
  return out
}

function quoteName(name: string): string {
  return name === 'form' ? 'the trigger form' : `the form "${name}"`
}

// ─── Config keys ───────────────────────────────────────────────────────

interface KeyAlias {
  /** The key to use (or null when the setting does not exist). */
  to: string | null
  note?: string
}

/**
 * Config keys builders commonly get wrong, by node type ('*' = any type that
 * reads `output_var`). The engine reads the canonical key.
 */
export const CONFIG_KEY_ALIASES: Record<string, Record<string, KeyAlias>> = {
  update_data_table: {
    output_var: { to: 'output_row_id_var', note: 'the row id variable of an insert / update is output_row_id_var (output_var is read as an alias)' },
    row_id_var: { to: 'output_row_id_var' },
    output_id_var: { to: 'output_row_id_var' },
    id_var: { to: 'output_row_id_var' },
    rows_var: { to: 'output_rows_var' },
    output_rows: { to: 'output_rows_var' },
    count_var: { to: 'output_count_var' },
    row_var: { to: 'output_row_var' },
    table: { to: 'table_id' },
    tableId: { to: 'table_id' },
    data_table_id: { to: 'table_id' },
    op: { to: 'operation' },
    action: { to: 'operation' },
    where: { to: 'filters' },
    filter: { to: 'filters' },
    conditions: { to: 'filters' },
    match_field: { to: 'row_match_field' },
    rowId: { to: 'row_id' },
    columns: { to: 'column_values' },
    row: { to: 'column_values' },
  },
  user_task: {
    assignee_mode: { to: 'assignment_type', note: 'assignment_type is individual (assignee_id or assignee_variable), team (team_id), role or aad_group; a person from a variable goes in assignee_variable, e.g. {{submitted_by_manager_id}}' },
    assign_mode: { to: 'assignment_type' },
    assignment_mode: { to: 'assignment_type' },
    assigned_to: { to: 'assignee_id', note: 'a user id goes in assignee_id; a {{variable}} holding a user id goes in assignee_variable' },
    assign_to: { to: 'assignee_id', note: 'a user id goes in assignee_id; a {{variable}} holding a user id goes in assignee_variable' },
    assignee_user_id: { to: 'assignee_id' },
    assignee_email: { to: 'assignee_variable', note: 'tasks are assigned by user id: assignee_id, or assignee_variable with a {{variable}} holding a user id' },
    priority: { to: 'task_priority' },
    due: { to: 'due_date' },
    due_at: { to: 'due_date' },
    form: { to: 'form_id' },
    task_form_id: { to: 'form_id' },
    options: { to: 'outcomes' },
    buttons_outcomes: { to: 'outcomes' },
    prefill: { to: 'field_values' },
    prefill_values: { to: 'field_values' },
    field_defaults: { to: 'field_values' },
    form_values: { to: 'field_values' },
    values: { to: 'field_values', note: 'the task form\'s prefill is field_values: { <field key>: "{{expression}}" }' },
  },
  send_email: {
    recipient: { to: 'to' },
    recipients: { to: 'to' },
    to_email: { to: 'to' },
    email: { to: 'to' },
    html: { to: 'body' },
    html_body: { to: 'body' },
    body_html: { to: 'body' },
    message: { to: 'body' },
    content: { to: 'body' },
    template_id: { to: 'email_template_id' },
    cc: { to: null, note: 'Send Email has no cc — put every recipient in to (comma-separated)' },
    bcc: { to: null, note: 'Send Email has no bcc — put every recipient in to (comma-separated)' },
  },
  set_variable: {
    var: { to: 'name' },
    var_name: { to: 'name' },
    variable_name: { to: 'name' },
  },
  date_math: {
    days: { to: 'amount', note: 'set amount and unit (days, weeks, months…)' },
    value: { to: 'amount' },
    op: { to: 'operation' },
    units: { to: 'unit' },
    output: { to: 'output_var' },
    output_variable: { to: 'output_var' },
    result_var: { to: 'output_var' },
  },
  format_date: { output: { to: 'output_var' }, output_variable: { to: 'output_var' }, result_var: { to: 'output_var' } },
  pause_until: { until: { to: 'date' }, datetime: { to: 'date' }, date_time: { to: 'date' }, resume_at: { to: 'date' }, wait_until: { to: 'date' } },
  set_title: { value: { to: 'title' }, text: { to: 'title' } },
  log: { text: { to: 'message' }, msg: { to: 'message' } },
  text_template: { text: { to: 'template' }, body: { to: 'template' } },
  loop: { collection: { to: 'items' }, list: { to: 'items' }, array: { to: 'items' }, item_variable: { to: 'item_var' }, index_variable: { to: 'index_var' } },
  http_request: { query: { to: 'params' }, header: { to: 'headers' }, output_variable: { to: 'output_var' } },
  run_agent: { output_var: { to: 'output_variable' }, prompt: { to: 'user_message' } },
  condition: { rules: { to: 'branches', note: 'rules go inside branches: [{ label, logic, rules: [...] }]' }, conditions: { to: 'branches', note: 'rules go inside branches: [{ label, logic, rules: [...] }]' } },
}

/** Node types whose steps take their result variable in `output_var`. */
const OUTPUT_VAR_TYPES = new Set(['math', 'modify_string', 'text_template', 'format_date', 'date_math', 'regex', 'collection_count', 'collection_get', 'collection_filter', 'collection_sort', 'collection_unique', 'collection_join', 'json_build_object', 'json_build_array', 'json_get_value', 'read_csv', 'read_excel', 'file_to_base64', 'base64_to_file', 'download_file', 'read_file', 'http_request'])

/**
 * Keys the engine reads, for types whose typos are worth catching: an
 * unknown key one or two letters away from one of these is reported.
 */
const KNOWN_CONFIG_KEYS: Record<string, readonly string[]> = {
  update_data_table: ['table_id', 'operation', 'column_values', 'field_mappings', 'data', 'values', 'filters', 'limit', 'offset', 'sort_column', 'sort_direction', 'row_id', 'row_match_field', 'row_match_value', 'match_column', 'match_value', 'output_row_id_var', 'output_row_var', 'output_rows_var', 'output_count_var', 'live_reference', 'auto_create_columns', 'apply_retention_policy', 'retention_policy_id'],
  user_task: ['task_title', 'task_description', 'task_priority', 'outcomes', 'assignment_type', 'assignee_id', 'assignee_variable', 'team_id', 'form_id', 'form_version', 'field_values', 'form_params', 'due_date', 'due_date_mode', 'due_offset_amount', 'due_offset_unit', 'completion_rule', 'min_responses', 'notification_template_id', 'queue_behaviour', 'allow_redirect', 'allow_invite_on_redirect', 'reminders', 'escalation_enabled', 'escalation_type', 'escalation_user_id', 'escalation_team_id', 'escalate_after_minutes'],
  send_email: ['to', 'subject', 'body', 'from', 'reply_to', 'attachments', 'email_template_id', 'content_type', 'output_var'],
  set_variable: ['name', 'expression', 'assignments'],
  date_math: ['date', 'date2', 'amount', 'unit', 'operation', 'output_var'],
  format_date: ['date', 'format', 'custom_format', 'output_var'],
  pause_until: ['date'],
  set_title: ['title'],
  loop: ['items', 'item_var', 'index_var'],
  text_template: ['template', 'output_var'],
  math: ['expression', 'output_var'],
  http_request: ['url', 'method', 'headers', 'params', 'body', 'content_type', 'auth_type', 'output_var'],
}

function configKeyWarnings(node: PickerNodeLike): Omit<WiringWarning, 'node_id' | 'node_label'>[] {
  const c = node.config ?? {}
  const out: Omit<WiringWarning, 'node_id' | 'node_label'>[] = []
  const aliases = CONFIG_KEY_ALIASES[node.type] ?? {}
  const known = KNOWN_CONFIG_KEYS[node.type]
  for (const key of Object.keys(c)) {
    if (key.startsWith('_')) continue
    if (known?.includes(key)) continue
    const alias = aliases[key] ?? (OUTPUT_VAR_TYPES.has(node.type) && (key === 'output_variable' || key === 'result_var' || key === 'output')
      ? { to: 'output_var' } : undefined)
    if (alias) {
      // An alias the canonical key already overrides is harmless.
      if (alias.to && c[alias.to] !== undefined && c[alias.to] !== '' && node.type !== 'update_data_table') continue
      let to = alias.to
      if (node.type === 'update_data_table' && key === 'output_var') {
        const op = String(c.operation ?? 'insert')
        to = op === 'list' ? 'output_rows_var' : op === 'get' ? 'output_row_var' : 'output_row_id_var'
        if (c[to] !== undefined && c[to] !== '') continue
      }
      if (node.type === 'user_task' && key === 'assignee_mode') to = 'assignment_type'
      out.push({
        kind: 'config_key', key,
        message: to
          ? `Unknown setting "${key}" on ${node.type} — the engine reads "${to}"${alias.note ? ` (${alias.note})` : ''}`
          : `Unknown setting "${key}" on ${node.type}${alias.note ? ` — ${alias.note}` : ''}`,
        ...(to ? { suggestion: to } : {}),
      })
      continue
    }
    if (known) {
      const close = closestMatch(key, known)
      if (close && close !== key) {
        out.push({ kind: 'config_key', key, message: `Unknown setting "${key}" on ${node.type} — did you mean "${close}"?`, suggestion: close })
      }
    }
  }
  // Data filters: operators the Data step does not know add no filter.
  if (node.type === 'update_data_table' && Array.isArray(c.filters)) {
    c.filters.forEach((f: any, index: number) => {
      const op = String(f?.operator ?? '').trim()
      if (!op || !f?.column) return
      const canonical = canonicalDataFilterOperator(op)
      if (!(DATA_FILTER_OPERATORS as readonly string[]).includes(canonical)) {
        out.push({ kind: 'config_key', key: `filters[${index}].operator`, message: `Unknown filter operator "${op}" — the filter is ignored. Use one of ${DATA_FILTER_OPERATORS.join(', ')}` })
      } else if (canonical !== op) {
        out.push({ kind: 'config_key', key: `filters[${index}].operator`, message: `Filter operator "${op}" is read as "${canonical}"`, suggestion: canonical })
      }
    })
  }
  // user_task: assignee_id holding a {{variable}} — accepted, but assignee_variable is the documented key.
  return out
}

/** One line per warning (for logs, CLI and plain-text surfaces). */
export function formatWiringWarning(w: WiringWarning): string {
  return `${w.node_label}: ${w.message}${w.suggestion && !w.message.includes(w.suggestion) ? ` — use ${w.suggestion}` : ''}`
}
