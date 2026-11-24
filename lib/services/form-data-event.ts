/**
 * "Map to data event" (lib/forms/data-event.ts): what the designer's wizard
 * needs from the server, and creating the "Send to a workflow" result.
 *
 *  - getDataEventOptions: what the person may do (permissions), the data
 *    tables (columns, required, lookups, child relations) and API references
 *    (declared inputs, whether they write) they can pick, and the workflows a
 *    form's "Form submitted" trigger already starts (a data event).
 *  - planDataEventWorkflow: the workflow a plan makes — definition, outline,
 *    plan problems, validation errors and wiring warnings — nothing stored.
 *  - createDataEventWorkflow: optionally creates new data tables from the
 *    form structure (data.create), then the workflow as a DRAFT
 *    (workflows.create, or workflows.edit like the API; never published or
 *    activated here — that needs workflows.activate in the workflow
 *    designer). It is refused unless the plan is free of errors, the
 *    workflow validates and the wiring check is clean. Anything created
 *    before a failure is removed again.
 *
 * "Write directly" needs no server call of its own: the wizard adds the rule
 * to the designer's form and the form's save checks it (lib/services/forms:
 * data.manage_rows to write tables, integrations.test to call references).
 *
 * The form is the editor's view of it: the working draft when there is one,
 * else the published version (forms.edit).
 */

import { getForm } from './forms'
import { createDataTable } from './data-tables'
import { createWorkflow } from './workflows'
import { audit, dbError, serviceRoleClient } from './_shared'
import { getDb, hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { columnKey } from '@/lib/data-table-cells'
import { isWriteReference } from '@/lib/custom-references/types'
import { normalizeTaskFields, type TaskFieldDef } from '@/lib/task-field-schema'
import {
  autoOrder, compileDirectRule, dataEventSources, formDataEvents, hasErrors, normalizeDataEventPlan, planProblems, proposeTable, proposedTarget, columnTypeFor,
  type DataEventPlan, type DataEventProblem, type DataEventSource, type DataEventTarget, type DirectRuleResult, type FormDataEvent, type ProposedTable, type BoundWorkflow,
} from '@/lib/forms/data-event'
import { normalizeFormRules } from '@/lib/forms/form-rules'
import { layoutFormVariables } from '@/lib/forms/form-params'
import { buildDataEventWorkflow, type DataEventWorkflow } from '@/lib/forms/data-event-workflow'
import { validateWorkflow } from '@/lib/workflow-validation'
import { formatWiringWarning, validateWorkflowWiring } from '@/lib/workflow-wiring'
import { isPlainObject } from '@/lib/utils/guards'

/* eslint-disable @typescript-eslint/no-explicit-any -- tables, references and workflows are free-form JSON rows */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUMN_TYPES = new Set(['text', 'number', 'date', 'boolean', 'select', 'file', 'longtext'])

export interface DataEventPermissions {
  /** forms.edit: change the form (add the rule). */
  edit_form: boolean
  /** data.view: pick data tables. */
  view_tables: boolean
  /** data.manage_rows: a rule that writes tables (checked again when the form is saved). */
  write_tables: boolean
  /** data.create: new tables from the form structure. */
  create_tables: boolean
  /** integrations.view: pick API references. */
  view_references: boolean
  /** integrations.test: a rule that calls references (checked again when the form is saved). */
  call_references: boolean
  /** workflows.create (or workflows.edit): Send to a workflow. */
  create_workflows: boolean
}

export function dataEventPermissions(ctx: ServiceContext): DataEventPermissions {
  return {
    edit_form: hasPerm(ctx, 'forms.edit'),
    view_tables: hasPerm(ctx, 'data.view'),
    write_tables: hasPerm(ctx, 'data.manage_rows'),
    create_tables: hasPerm(ctx, 'data.create'),
    view_references: hasPerm(ctx, 'integrations.view'),
    call_references: hasPerm(ctx, 'integrations.test'),
    create_workflows: hasPerm(ctx, 'workflows.create') || hasPerm(ctx, 'workflows.edit'),
  }
}

/** The options each destination offers (hidden when the person cannot use them). */
export function dataEventDestinations(p: DataEventPermissions): { direct: boolean; workflow: boolean } {
  return {
    direct: p.edit_form && ((p.view_tables && p.write_tables) || (p.view_references && p.call_references)),
    workflow: p.edit_form && p.create_workflows && (p.view_tables || p.create_tables || p.view_references),
  }
}

export interface DataEventOptions {
  permissions: DataEventPermissions
  destinations: { direct: boolean; workflow: boolean }
  tables: DataEventTarget[]
  references: DataEventTarget[]
  /** Workflows whose Form submitted trigger names this form. */
  bound_workflows: BoundWorkflow[]
}

function tableTarget(row: any): DataEventTarget {
  const columns = (Array.isArray(row.columns) ? row.columns : []).map((c: any) => {
    const key = c?.key ? String(c.key) : c?.name ? columnKey({ name: String(c.name) }) : ''
    return {
      key, label: String(c?.label ?? c?.name ?? key), type: String(c?.type ?? 'text'),
      ...(c?.required === true ? { required: true } : {}),
      ...(Array.isArray(c?.options) ? { options: c.options.map(String).slice(0, 200) } : {}),
      ...(isPlainObject(c?.lookup) ? { lookup: { sourceTableId: String(c.lookup.sourceTableId ?? ''), sourceColumn: String(c.lookup.sourceColumn ?? '') } } : {}),
    }
  }).filter((c: { key: string }) => c.key)
  const relations = (Array.isArray(row.child_relations) ? row.child_relations : []).filter((r: any) => typeof r?.table_id === 'string' && typeof r?.lookup_column === 'string').map((r: any) => ({ table_id: r.table_id, lookup_column: r.lookup_column }))
  return { kind: 'table', id: String(row.id), name: String(row.name ?? 'Data table'), columns, ...(relations.length ? { child_relations: relations } : {}) }
}

function referenceTarget(row: any): DataEventTarget {
  const inputs = Array.isArray(row.inputs) ? row.inputs : []
  const method = String(row.method ?? row.request_config?.method ?? '').toUpperCase()
  return {
    kind: 'reference', id: String(row.id), name: String(row.name ?? 'API reference'),
    ...(row.integration?.id ? { integration_id: String(row.integration.id) } : {}),
    writes: isWriteReference(row) || ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method),
    columns: inputs.filter((i: any) => typeof i?.name === 'string' && i.name).map((i: any) => ({ key: String(i.name), label: String(i.label ?? i.name), type: String(i.type ?? 'string'), ...(i.required === true ? { required: true } : {}) })),
  }
}

async function listTables(ctx: ServiceContext): Promise<DataEventTarget[]> {
  const db = getDb(ctx) as any
  let { data, error } = await db.from('custom_tables').select('id, name, columns, child_relations').eq('tenant_id', ctx.tenantId).order('name').limit(500)
  // Before the child-records migration custom_tables has no child_relations.
  if (error) ({ data, error } = await db.from('custom_tables').select('id, name, columns').eq('tenant_id', ctx.tenantId).order('name').limit(500))
  if (error) throw dbError(error)
  const allow = ctx.resourceScopes?.table_ids ?? []
  return ((data ?? []) as any[]).filter((t) => !allow.length || allow.includes(t.id)).map(tableTarget)
}

async function listReferences(ctx: ServiceContext): Promise<DataEventTarget[]> {
  const { data, error } = await (getDb(ctx) as any).from('integration_references').select('*, integration:integrations(id, name, type)').eq('tenant_id', ctx.tenantId).order('name').limit(500)
  if (error) throw dbError(error)
  return ((data ?? []) as any[]).map(referenceTarget)
}

/** Workflows (drafts and published) whose Form submitted trigger names the form. */
export async function boundWorkflows(ctx: ServiceContext, formId: string): Promise<BoundWorkflow[]> {
  if (!UUID_RE.test(formId)) return []
  const { data, error } = await (getDb(ctx) as any).from('workflows').select('id, name, nodes').eq('tenant_id', ctx.tenantId).limit(5000)
  if (error) throw dbError(error)
  const out: BoundWorkflow[] = []
  for (const wf of (data ?? []) as any[]) {
    const nodes = Array.isArray(wf.nodes) ? wf.nodes : []
    if (nodes.some((n: any) => n?.type === 'form_submitted' && n?.config?.form_id === formId)) out.push({ workflow_id: String(wf.id), workflow_name: String(wf.name ?? 'Workflow'), node_type: 'form_submitted' })
  }
  return out
}

export async function getDataEventOptions(ctx: ServiceContext, input: { form_id?: string | null } = {}): Promise<DataEventOptions> {
  requirePerm(ctx, 'forms.view')
  const permissions = dataEventPermissions(ctx)
  const [tables, references, bound] = await Promise.all([
    permissions.view_tables ? listTables(ctx) : Promise.resolve([]),
    permissions.view_references ? listReferences(ctx) : Promise.resolve([]),
    input.form_id ? boundWorkflows(ctx, input.form_id) : Promise.resolve([]),
  ])
  return { permissions, destinations: dataEventDestinations(permissions), tables, references, bound_workflows: bound }
}

/* ── Send to a workflow ─────────────────────────────────────────────── */

export interface DataEventWorkflowInput {
  form_id: string
  plan: unknown
  /** Tables to create first (from the form structure); steps name them `new:<source>` (`new:form` = the form). */
  new_tables?: unknown
}

export interface DataEventWorkflowPlan {
  workflow: DataEventWorkflow
  problems: DataEventProblem[]
  /** Validation errors (lib/workflow-validation.ts), as "Node: message". */
  errors: string[]
  /** Wiring warnings (lib/workflow-wiring.ts). */
  warnings: string[]
}

function cleanNewTables(raw: unknown): ProposedTable[] {
  const out: ProposedTable[] = []
  for (const t of Array.isArray(raw) ? raw.slice(0, 10) : []) {
    if (!isPlainObject(t)) continue
    const source = typeof t.source === 'string' && /^[a-z0-9_]{0,64}$/i.test(t.source) ? t.source : null
    const name = typeof t.name === 'string' ? t.name.trim().slice(0, 120) : ''
    if (source === null || !name || out.some((x) => x.source === source)) continue
    const columns = (Array.isArray(t.columns) ? t.columns : []).slice(0, 100).flatMap((c: unknown) => {
      if (!isPlainObject(c) || typeof c.key !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(c.key) || ['id', 'date_created'].includes(c.key)) return []
      const type = typeof c.type === 'string' && COLUMN_TYPES.has(c.type) ? c.type : 'text'
      const colName = typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 90) : c.key
      return [{ key: c.key, name: colName, type, ...(type === 'select' && Array.isArray(c.options) ? { options: c.options.map(String).slice(0, 200) } : {}) }]
    })
    out.push({ source, name, columns })
  }
  return out
}

async function loadEditorForm(ctx: ServiceContext, formId: string) {
  requirePerm(ctx, 'forms.edit')
  if (!UUID_RE.test(formId)) throw ServiceError.validation('form_id must be a form id')
  const form = await getForm(ctx, formId, { version: 'draft' }) as any
  return {
    id: String(form.id), name: String(form.name ?? 'Form'), version: Number.isInteger(form.version) ? form.version as number : null,
    fields: normalizeTaskFields(form.fields) as TaskFieldDef[], layout: form.layout ?? null, buttons: form.buttons ?? null,
  }
}

export interface DataEventStatus {
  /** The form's data events (empty: none — "Map to data event" is offered). */
  events: FormDataEvent[]
  has_data_event: boolean
  /** The form and its repeating sections / Lists, with their fields (what a plan's steps map). */
  sources: DataEventSource[]
}

/** The editor's form: its data events and sources (forms.edit). */
export async function getDataEventStatus(ctx: ServiceContext, formId: string): Promise<DataEventStatus> {
  const form = await loadEditorForm(ctx, formId)
  const events = formDataEvents({ fields: form.fields, layout: form.layout, buttons: form.buttons }, { boundWorkflows: await boundWorkflows(ctx, form.id) })
  return { events, has_data_event: events.length > 0, sources: dataEventSources(form.fields, form.name) }
}

/**
 * Write directly: the Before submit rule (and the variables carrying parent
 * ids) a plan compiles to, with its problems — to add to the form's
 * layout.rules / layout.variables with a draft save (nothing is stored here;
 * the form's save checks data.manage_rows / integrations.test).
 */
export async function planDataEventRule(ctx: ServiceContext, input: { form_id: string; plan: unknown }): Promise<DirectRuleResult & { problems: DataEventProblem[] }> {
  const form = await loadEditorForm(ctx, input.form_id)
  const plan = { ...normalizeDataEventPlan(input.plan), destination: 'direct' as const }
  if (plan.steps.some((s) => s.target.kind === 'table')) { requirePerm(ctx, 'data.view'); requirePerm(ctx, 'data.manage_rows') }
  if (plan.steps.some((s) => s.target.kind === 'reference')) { requirePerm(ctx, 'integrations.view'); requirePerm(ctx, 'integrations.test') }
  const sources = dataEventSources(form.fields, form.name)
  const [tables, references] = await Promise.all([
    plan.steps.some((s) => s.target.kind === 'table') ? listTables(ctx) : Promise.resolve([]),
    plan.steps.some((s) => s.target.kind === 'reference') ? listReferences(ctx) : Promise.resolve([]),
  ])
  const ordered = { ...plan, steps: autoOrder(plan.steps, sources) }
  const problems = planProblems(ordered, sources, [...tables, ...references])
  const compiled = compileDirectRule(ordered, sources, {
    ruleIds: normalizeFormRules(isPlainObject(form.layout) ? form.layout.rules : []).map((r) => r.id),
    variables: layoutFormVariables(form.layout).map((v) => v.name),
    formName: form.name,
  })
  return { ...compiled, problems }
}

function checkWorkflow(workflow: DataEventWorkflow): { errors: string[]; warnings: string[] } {
  const result = validateWorkflow(workflow.nodes as any, workflow.trigger_type)
  const errors = result.nodeErrors.flatMap((n) => n.errors.map((e) => `${n.nodeLabel}: ${e}`))
  const warnings = validateWorkflowWiring({ nodes: workflow.nodes, edges: workflow.edges }).filter((w) => w.severity !== 'info').map(formatWiringWarning)
  return { errors, warnings }
}

/** The targets with the proposed (not yet created) tables. */
function withProposed(proposed: ProposedTable[], targets: DataEventTarget[]): DataEventTarget[] {
  return [...targets, ...proposed.map(proposedTarget)]
}

/** The workflow a plan would make (nothing is stored). */
export async function planDataEventWorkflow(ctx: ServiceContext, input: DataEventWorkflowInput): Promise<DataEventWorkflowPlan> {
  const form = await loadEditorForm(ctx, input.form_id)
  const plan = { ...normalizeDataEventPlan(input.plan), destination: 'workflow' as const }
  const sources = dataEventSources(form.fields, form.name)
  const proposed = cleanNewTables(input.new_tables)
  const permissions = dataEventPermissions(ctx)
  const [tables, references] = await Promise.all([
    permissions.view_tables ? listTables(ctx) : Promise.resolve([]),
    permissions.view_references ? listReferences(ctx) : Promise.resolve([]),
  ])
  const targets = withProposed(proposed, [...tables, ...references])
  const ordered = { ...plan, steps: autoOrder(plan.steps, sources) }
  const problems = planProblems(ordered, sources, targets)
  const workflow = buildDataEventWorkflow(ordered, form, sources, targets)
  return { workflow, problems, ...checkWorkflow(workflow) }
}

async function removeTable(ctx: ServiceContext, id: string) {
  const db = await serviceRoleClient(ctx)
  await (db as any).from('custom_table_rows').delete().eq('tenant_id', ctx.tenantId).eq('table_id', id)
  await (db as any).from('custom_tables').delete().eq('tenant_id', ctx.tenantId).eq('id', id)
}

export interface DataEventWorkflowResult {
  workflow: { id: string; name: string; is_active: false }
  tables: Array<{ id: string; name: string; source: string }>
  outline: DataEventWorkflow['outline']
  warnings: string[]
}

/**
 * Create the workflow (a draft) — and first the new tables the plan uses.
 * Refused while the plan has errors, the workflow does not validate or the
 * wiring check warns.
 */
export async function createDataEventWorkflow(ctx: ServiceContext, input: DataEventWorkflowInput): Promise<DataEventWorkflowResult> {
  const form = await loadEditorForm(ctx, input.form_id)
  if (!hasPerm(ctx, 'workflows.create')) requirePerm(ctx, 'workflows.edit')
  const plan = { ...normalizeDataEventPlan(input.plan), destination: 'workflow' as const }
  const sources = dataEventSources(form.fields, form.name)
  const used = new Set(plan.steps.filter((s) => s.target.new_table).map((s) => s.target.id))
  const proposed = cleanNewTables(input.new_tables).filter((t) => used.has(`new:${t.source || 'form'}`))
  if (proposed.length) requirePerm(ctx, 'data.create')
  if (plan.steps.some((s) => s.target.kind === 'table' && !s.target.new_table)) requirePerm(ctx, 'data.view')
  if (plan.steps.some((s) => s.target.kind === 'reference')) requirePerm(ctx, 'integrations.view')
  const [tables, references] = await Promise.all([
    plan.steps.some((s) => s.target.kind === 'table' && !s.target.new_table) ? listTables(ctx) : Promise.resolve([]),
    plan.steps.some((s) => s.target.kind === 'reference') ? listReferences(ctx) : Promise.resolve([]),
  ])
  const ordered = { ...plan, steps: autoOrder(plan.steps, sources) }
  const preTargets = withProposed(proposed, [...tables, ...references])
  const problems = planProblems(ordered, sources, preTargets)
  if (hasErrors(problems)) throw ServiceError.validation(problems.filter((p) => p.severity === 'error').map((p) => p.message).join('; '), { problems })
  // A dry build first: nothing is created for a workflow that would not validate.
  const dry = checkWorkflow(buildDataEventWorkflow(ordered, form, sources, preTargets))
  if (dry.errors.length || dry.warnings.length) throw ServiceError.validation(`The workflow would not be clean: ${[...dry.errors, ...dry.warnings].join('; ')}`)

  const undo: Array<() => Promise<unknown>> = []
  const created: DataEventWorkflowResult['tables'] = []
  try {
    const ids = new Map<string, { id: string; name: string }>()
    for (const t of proposed) {
      const row = await createDataTable(ctx, {
        name: t.name,
        description: `Made by "Map to data event" from ${t.source ? `"${sources.find((s) => s.key === t.source)?.label ?? t.source}" of ` : ''}the form "${form.name}".`,
        columns: t.columns.map((c) => ({ key: c.key, name: c.name, type: COLUMN_TYPES.has(c.type) ? c.type : columnTypeFor(c.type), ...(c.options ? { options: c.options } : {}) })),
      }) as any
      undo.push(() => removeTable(ctx, row.id))
      ids.set(`new:${t.source || 'form'}`, { id: String(row.id), name: String(row.name) })
      created.push({ id: String(row.id), name: String(row.name), source: t.source })
    }
    const finalPlan: DataEventPlan = {
      ...ordered,
      steps: ordered.steps.map((s) => {
        const made = s.target.new_table ? ids.get(s.target.id) : undefined
        return made ? { ...s, target: { kind: 'table', id: made.id, name: made.name } } : s
      }),
    }
    const finalTargets = [...tables, ...references, ...proposed.map((t) => ({ ...proposedTarget(t), id: ids.get(`new:${t.source || 'form'}`)!.id, new_table: false }))]
    const workflow = buildDataEventWorkflow(finalPlan, form, sources, finalTargets)
    const check = checkWorkflow(workflow)
    if (check.errors.length || check.warnings.length) throw ServiceError.validation(`The workflow would not be clean: ${[...check.errors, ...check.warnings].join('; ')}`)
    const { outline, ...definition } = workflow
    const wf = await createWorkflow(ctx, { ...definition, is_active: false } as any) as any
    await audit(ctx, {
      objectType: 'form', objectId: form.id, action: 'update',
      summary: `Mapped "${form.name}" to a data event: draft workflow "${workflow.name}"`,
      metadata: { workflow_id: wf.workflow_id ?? wf.id, tables: created.map((t) => t.id) },
    })
    return { workflow: { id: String(wf.workflow_id ?? wf.id), name: workflow.name, is_active: false }, tables: created, outline, warnings: problems.filter((p) => p.severity === 'warning').map((p) => p.message) }
  } catch (error) {
    for (const step of undo.reverse()) { try { await step() } catch { /* best effort */ } }
    throw error
  }
}

/** The proposed tables for a form (one per source the wizard offers to create). */
export async function proposeDataEventTables(ctx: ServiceContext, formId: string): Promise<ProposedTable[]> {
  const form = await loadEditorForm(ctx, formId)
  return dataEventSources(form.fields, form.name).map((s) => proposeTable(s, form.name))
}
