/**
 * The Agent's workflow self-check (server side): before a workflow write is
 * shown for confirmation, the draft goes through the workflow validator
 * (lib/workflow-validation validateWorkflow — whatever checks it has, plus
 * any `warnings` it returns) and a few wiring checks for the mistakes models
 * make most (seen in production):
 *
 *  - a form-submitted workflow reading a form field bare (`{{full_name}}`
 *    instead of `{{form.full_name}}`);
 *  - a User Task's form values read bare after the task (`{{approver_comment}}`
 *    instead of `{{task_data.approver_comment}}`);
 *  - update_data_table keeping the new row id in `output_var` (the engine
 *    reads `output_row_id_var`), or `row_id` pointing at a variable nothing sets.
 *
 * Since release-dec27b the main check is the workflow wiring validator
 * (lib/workflow-wiring validateWorkflowWiring: references, config keys,
 * syntax, unfilled task-form prefills — the same warnings MCP
 * workflows_create / workflows_update / workflows_validate return); the
 * local checks below only run when it reports nothing for a step.
 *
 * The designer tools give the model ONE automatic correction round with these
 * warnings; what remains is shown on the confirmation card. This adapter is
 * the only place the Agent calls the validator, so new validator checks flow
 * in without changes here.
 */
import { validateWorkflow } from '@/lib/workflow-validation'
import { formatWiringWarning, validateWorkflowWiring } from '@/lib/workflow-wiring'
import type { LinkedFormLike } from '@/lib/workflow-data-picker'
import type { WorkflowNode } from '@/lib/workflow-schema'

/* eslint-disable @typescript-eslint/no-explicit-any -- tool arguments are JSON */

const parse = (v: unknown): any => {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return undefined }
}

/** Run variables every workflow has (never "unset"). */
const BUILTIN = new Set([
  'form', 'submission', 'task_data', 'outcome', 'outcome_notes', 'actioned_by', 'actioned_by_name', 'completed_by', 'completed_by_name', 'completed_by_email', 'completed_at',
  'form_id', 'form_name', 'form_version', 'form_submission_id', 'form_button', 'form_outcome', 'form_source', 'submitted_by', 'submitted_by_name', 'submitted_by_email', 'submitted_at',
  'task_id', 'workflow_id', 'workflow_name', 'run_id', 'tenant_id', 'item', 'index', 'row', 'rows', 'row_id', 'row_count', 'user_task_id', 'user_task_title', 'now', 'today', 'param', 'trigger', 'input', 'env',
  'actioned_on_behalf_of', 'actioned_on_behalf_of_name', 'on_behalf_note', 'response_count', 'attachments', 'agent_response', 'submitted_by_manager_id', 'new_date',
])

/** `{{name…}}` references in a value (plain references only — not `{{=FUNCTION()}}` expressions). */
function references(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    for (const m of value.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)(?:[.[][^}]*)?\s*\}\}/g)) out.add(m[1])
  } else if (Array.isArray(value)) value.forEach((v) => references(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => references(v, out))
  return out
}

/** Variables a node sets (output names in its config). */
function setsVariables(node: any): string[] {
  const c = node?.config ?? {}
  const out: string[] = []
  for (const k of ['output_var', 'output_row_id_var', 'output_row_var', 'output_rows_var', 'output_count_var', 'output_variable', 'name', 'variable', 'result_var']) if (typeof c[k] === 'string' && c[k]) out.push(c[k])
  if (Array.isArray(c.assignments)) for (const a of c.assignments) if (a?.name) out.push(String(a.name))
  return out
}

/** A step's variable prefix: its label in snake_case, at most 30 characters. */
export function stepPrefix(label: string): string {
  return String(label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30).replace(/_+$/, '')
}

export interface DraftWorkflow {
  nodes: WorkflowNode[]
  triggerType: string | null
  userVariables: string[]
  edges?: unknown[]
  /** Linked reusable forms by id (so {{form.<key>}} / task fields can be checked without cached copies). */
  linkedForms?: Record<string, LinkedFormLike> | null
  rawUserVariables?: unknown[]
}

/** The workflow a workflows_create / workflows_update call would save (null when it sends no nodes). */
export function draftFromArgs(args: Record<string, any>): DraftWorkflow | null {
  const def = parse(args.definition) ?? {}
  const nodes = parse(args.nodes) ?? def.nodes
  if (!Array.isArray(nodes) || !nodes.length) return null
  const vars = parse(args.user_variables) ?? def.user_variables ?? def.userVariables
  const edges = parse(args.edges) ?? def.edges
  return {
    nodes: nodes as WorkflowNode[],
    edges: Array.isArray(edges) ? edges : [],
    rawUserVariables: Array.isArray(vars) ? vars : [],
    triggerType: String(args.trigger_type ?? def.trigger_type ?? nodes.find((n: any) => n?.type === 'form_submitted' || n?.type === 'start')?.type ?? '') || null,
    userVariables: Array.isArray(vars) ? vars.map((v: any) => String(v?.name ?? v ?? '')).filter(Boolean) : [],
  }
}

/** Possible wiring issues of a draft workflow, as short sentences (validator first). */
export function workflowWarnings(draft: DraftWorkflow, validate: typeof validateWorkflow = validateWorkflow, wiring: typeof validateWorkflowWiring | null = validateWorkflowWiring): string[] {
  const warnings: string[] = []
  // The wiring validator (references, config keys, prefills): steps it flags skip the local checks.
  const wiredNodes = new Set<string>()
  if (wiring) {
    try {
      for (const w of wiring({ nodes: draft.nodes, edges: draft.edges ?? [], workflowVariables: (draft.rawUserVariables ?? []) as never, linkedForms: draft.linkedForms ?? null })) {
        // Info notes (assigned to the creator for testing) are not issues to fix.
        if (w.severity === 'info') continue
        // No assignee: never guessed — the Agent asks the person (ask_user) or assigns "@me" when told to just build it.
        warnings.push(w.kind === 'unassigned' ? `${formatWiringWarning(w)}. If the person didn't say who, ask them with ask_user (Assign to me for testing / The submitter's manager / A team… / A specific person… / Leave unassigned) — don't guess` : formatWiringWarning(w))
        wiredNodes.add(w.node_id)
      }
    } catch { /* fall back to the local checks */ }
  }
  try {
    const result = validate(draft.nodes, draft.triggerType ?? undefined) as ReturnType<typeof validateWorkflow> & { warnings?: unknown }
    for (const n of result.nodeErrors ?? []) for (const e of n.errors) warnings.push(`${n.nodeLabel || n.nodeId}: ${e}`)
    if (Array.isArray(result.warnings)) for (const w of result.warnings) warnings.push(typeof w === 'string' ? w : String((w as any)?.message ?? JSON.stringify(w)))
  } catch { /* a malformed draft: the save itself reports it */ }

  const nodes = draft.nodes as any[]
  const trigger = nodes.find((n) => n?.type === 'form_submitted')
  const formKeys = new Set<string>((parse(trigger?.config?.fields) ?? []).map((f: any) => String(f?.key ?? '')).filter(Boolean))
  const taskKeys = new Set<string>()
  for (const n of nodes) if (n?.type === 'user_task') for (const f of parse(n.config?.fields) ?? []) if (f?.key) taskKeys.add(String(f.key))
  const set = new Set<string>([...draft.userVariables, ...nodes.flatMap(setsVariables)])
  // A User Task's per-step outputs: <prefix>_task_data / _outcome / _outcome_notes / _task_id (prefix: label in snake_case, ≤ 30).
  for (const n of nodes) if (n?.type === 'user_task') {
    const prefix = stepPrefix(n.label ?? n.id)
    if (prefix) for (const suffix of ['task_data', 'outcome', 'outcome_notes', 'task_id']) set.add(`${prefix}_${suffix}`)
  }
  if (trigger) {
    if (!trigger.config?.form_id) warnings.push(`${trigger.label || 'Form submitted'}: set config.form_id (and form_name) to the form that starts this workflow`)
  }
  for (const n of nodes) {
    if (wiredNodes.has(n?.id)) continue
    const c = n?.config ?? {}
    const label = n?.label || n?.id
    if (n?.type === 'update_data_table') {
      if (c.operation === 'insert' && c.output_var && !c.output_row_id_var) warnings.push(`${label}: the new row's id goes in output_row_id_var (not output_var) — later steps read it as {{${c.output_var}}}`)
      if (!c.table_id) warnings.push(`${label}: set table_id`)
    }
    if (n?.type === 'user_task') {
      // Read-only (information) fields of a task form need a value, or the person sees them empty.
      const prefill = c.field_values && typeof c.field_values === 'object' ? c.field_values : {}
      const empty = (parse(c.fields) ?? []).filter((f: any) => f?.key && (f.read_only || f.readonly) && (f.default === undefined || f.default === '') && prefill[f.key] === undefined)
      if (empty.length) warnings.push(`${label}: read-only field${empty.length === 1 ? '' : 's'} ${empty.map((f: any) => f.key).join(', ')} ${empty.length === 1 ? 'has' : 'have'} no value — prefill with config.field_values { key: "{{form.key}}" } and the field's default`)
    }
    if (n?.type === 'user_task' && !c.form_id && !(Array.isArray(parse(c.fields)) && parse(c.fields).length) && !(c.outcomes?.length)) warnings.push(`${label}: give the task a form (config.form_id) or fields, and its outcomes`)
    for (const ref of references(c)) {
      if (BUILTIN.has(ref) || set.has(ref)) continue
      if (trigger && (formKeys.has(ref) || formKeys.size === 0)) { warnings.push(`${label}: {{${ref}}} is not set — a form field is {{form.${ref}}}`); continue }
      if (taskKeys.has(ref)) { warnings.push(`${label}: {{${ref}}} is not set — a User Task's field is {{task_data.${ref}}} (right after that task)`); continue }
      warnings.push(`${label}: {{${ref}}} is not set by any step`)
    }
  }
  return [...new Set(warnings)].slice(0, 20)
}
