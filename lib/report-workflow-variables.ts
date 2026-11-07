/**
 * Workflow variables as report columns.
 *
 * "Workflow runs" with a workflow picked (`source_inputs.workflow_id`) gains
 * one column per workflow variable, `vars.<path>`, read from the run's
 * reportable variables (workflow_runs.variables, lib/workflow-run-variables):
 *  - the workflow's inputs (user variables / start form fields),
 *  - task form fields of its User Tasks (`vars.task_data.<key>`, lookups'
 *    `<key>_item` fields, attachments' `<key>_count`),
 *  - Form submitted values (`vars.form.<key>`) and submission details,
 *  - outputs of steps (Set Variable, Math, ... — scalar outputs only),
 *  - anything else stored on recent runs (older definitions, dynamic names).
 * Types come from the definition (draft + recent published versions), and
 * from the values stored on recent runs where the definition cannot tell.
 *
 * "Tasks" with a workflow picked gains `fields.<key>` columns: the form
 * values of the tasks that workflow created (tasks.metadata.template_values).
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow definitions are free-form JSON */

import { buildDataTree, type DataRoot, type PickerNodeLike, type PickerEdgeLike, type LinkedFormLike, type PickerWorkflowVariable } from '@/lib/workflow-data-picker'
import type { SchemaNode } from '@/lib/response-schema'
import type { ReportColumn, ReportSource } from '@/lib/report-sources'
import {
  inferRunVariableType,
  isReportableSegment,
  isReportableVariableKey,
  RUN_VARIABLE_COLUMN_PREFIX,
  RUN_VARIABLES_LIMITS,
  runVariableLeaves,
  SYSTEM_RUN_VARIABLE_KEYS,
  type RunVariableType,
} from '@/lib/workflow-run-variables'
import { isPlainObject } from '@/lib/utils/guards'

export const TASK_FIELD_COLUMN_PREFIX = 'fields.'
/** Sources that accept a workflow (`source_inputs.workflow_id`). */
export const WORKFLOW_SCOPED_REPORT_SOURCES = new Set(['workflow_runs', 'tasks'])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Published versions read for variables (newest first) besides the draft. */
const MAX_VERSIONS = 10
/** Recent runs / tasks sampled for stored variables and their types. */
const SAMPLE_SIZE = 200
/** Columns a workflow adds at most (definition first, then stored ones). */
const MAX_COLUMNS = 250

export function workflowIdOfSourceInputs(sourceInputs: unknown): string | null {
  if (!isPlainObject(sourceInputs)) return null
  const id = typeof sourceInputs.workflow_id === 'string' ? sourceInputs.workflow_id.trim() : ''
  return UUID.test(id) ? id : null
}

/** `fields.<key>` — a task form field column of the Tasks source. */
export function isTaskFieldColumnKey(key: unknown): key is string {
  if (typeof key !== 'string' || !key.startsWith(TASK_FIELD_COLUMN_PREFIX)) return false
  const parts = key.slice(TASK_FIELD_COLUMN_PREFIX.length).split('.')
  return parts.length >= 1 && parts.length <= 2 && parts.every(isReportableSegment)
}

interface VariableColumn extends ReportColumn {
  /** Where the column comes from (shown as the group in pickers). */
  group: string
  /** True when the type came from the definition (not inferred from values). */
  typed: boolean
}

function schemaType(schema: SchemaNode | null | undefined, declared?: string): RunVariableType | 'object' | 'array' | 'any' {
  const d = String(declared ?? '').toLowerCase()
  if (d === 'date' || d === 'datetime') return 'date'
  if (!schema) return 'any'
  switch (schema.type) {
    case 'number': case 'integer': return 'number'
    case 'boolean': return 'boolean'
    case 'object': return 'object'
    case 'array': return 'array'
    case 'string': {
      const description = String(schema.description ?? '')
      if (/^date\b/i.test(description) || /ISO 8601/.test(description) || schema.format === 'date' || schema.format === 'date-time') return 'date'
      return 'text'
    }
    default: return 'any'
  }
}

function columnFromRoot(path: string, label: string, schema: SchemaNode | null, group: string, declared?: string): VariableColumn[] {
  const parts = path.split('.')
  if (parts.length > RUN_VARIABLES_LIMITS.maxDepth || !parts.every(isReportableSegment)) return []
  if (!isReportableVariableKey(parts[0])) return []
  const type = schemaType(schema, declared)
  if (type === 'object') {
    // A lookup's selected item: its scalar fields (one level).
    return (schema?.fields ?? []).flatMap((field) => {
      const fieldType = schemaType(field)
      if (fieldType === 'object' || fieldType === 'array') return []
      return columnFromRoot(`${path}.${field.name}`, `${label} › ${field.name}`, field, group)
    })
  }
  if (type === 'array') {
    // Lists of scalars (multi-selects) are stored; lists of objects (files) are not.
    const itemType = schema?.items?.type
    if (itemType && !['string', 'number', 'integer', 'boolean', 'any'].includes(itemType)) return []
    return [{ key: `${RUN_VARIABLE_COLUMN_PREFIX}${path}`, label, type: 'text', group, typed: true }]
  }
  return [{ key: `${RUN_VARIABLE_COLUMN_PREFIX}${path}`, label, type: type === 'any' ? 'text' : type, group, typed: type !== 'any' }]
}

const SKIP_ROOT_PATHS = new Set(['form', 'task_data'])

/** Columns a workflow definition declares (inputs, task forms, form submitted, step outputs). */
export function definitionVariableColumns(definition: {
  nodes: unknown
  edges: unknown
  user_variables?: unknown
  linkedForms?: Record<string, LinkedFormLike> | null
}): VariableColumn[] {
  const nodes = (Array.isArray(definition.nodes) ? definition.nodes : []).filter((node: any) => node && typeof node.id === 'string') as PickerNodeLike[]
  const edges = (Array.isArray(definition.edges) ? definition.edges : []) as PickerEdgeLike[]
  const userVariables = (Array.isArray(definition.user_variables) ? definition.user_variables : []).filter((v: any) => v && typeof v.name === 'string') as PickerWorkflowVariable[]
  const declaredType = new Map(userVariables.map((v) => [v.name, v.type]))
  const groups = buildDataTree({ nodes, edges, currentNodeId: null, workflowVariables: userVariables, linkedForms: definition.linkedForms ?? null })
  const out: VariableColumn[] = []
  for (const group of groups) {
    if (group.kind === 'loop' || group.kind === 'recent') continue
    const groupLabel = group.kind === 'workflow' ? 'Workflow inputs'
      : group.kind === 'form' ? group.label
      : group.kind === 'trigger' ? 'Trigger'
      : `Step › ${group.label}`
    for (const root of group.roots as DataRoot[]) {
      if (root.path.startsWith('task.') || root.path.startsWith('live.') || SKIP_ROOT_PATHS.has(root.path)) continue
      // Step outputs: scalar values only (responses / row lists are not reportable columns).
      if (group.kind === 'step' || group.kind === 'trigger') {
        const type = schemaType(root.schema)
        if (type === 'object' || type === 'array') continue
        // Untyped outputs are responses / items (skipped), except Set Variable's.
        if (type === 'any' && group.nodeType !== 'set_variable') continue
      }
      const label = group.kind === 'step' ? root.path : root.label || root.path
      out.push(...columnFromRoot(root.path, label, root.schema, groupLabel, group.kind === 'workflow' ? declaredType.get(root.path) : undefined))
    }
  }
  return out
}

/** Columns seen in stored run variables, typed from the values. */
export function storedVariableColumns(storedRows: unknown[]): { columns: VariableColumn[]; observed: Map<string, unknown[]> } {
  const observed = new Map<string, unknown[]>()
  for (const variables of storedRows) {
    for (const [path, value] of runVariableLeaves(variables)) {
      const key = `${RUN_VARIABLE_COLUMN_PREFIX}${path}`
      const list = observed.get(key) ?? []
      if (list.length < SAMPLE_SIZE) list.push(Array.isArray(value) ? null : value)
      observed.set(key, list)
    }
  }
  const columns: VariableColumn[] = []
  for (const [key, values] of observed) {
    const path = key.slice(RUN_VARIABLE_COLUMN_PREFIX.length)
    if (SYSTEM_RUN_VARIABLE_KEYS.has(path.split('.')[0])) continue
    columns.push({ key, label: path, type: inferRunVariableType(values), group: 'Stored on runs', typed: false })
  }
  return { columns, observed }
}

/** Definition columns first (refined by stored values where untyped), then stored-only ones. */
export function mergeVariableColumns(definitionColumns: VariableColumn[], stored: ReturnType<typeof storedVariableColumns>): VariableColumn[] {
  const byKey = new Map<string, VariableColumn>()
  for (const column of definitionColumns) {
    if (byKey.has(column.key)) continue
    const values = stored.observed.get(column.key)
    byKey.set(column.key, !column.typed && values ? { ...column, type: inferRunVariableType(values) } : column)
  }
  for (const column of stored.columns) if (!byKey.has(column.key)) byKey.set(column.key, column)
  return [...byKey.values()].slice(0, MAX_COLUMNS)
}

/** Disambiguate labels shared by several columns (same field on two task forms). */
function labelled(columns: VariableColumn[]): ReportColumn[] {
  const counts = new Map<string, number>()
  for (const column of columns) counts.set(column.label, (counts.get(column.label) ?? 0) + 1)
  return columns.map((column) => ({
    key: column.key,
    label: (counts.get(column.label) ?? 0) > 1 ? `${column.label} (${column.key.slice(column.key.indexOf('.') + 1)})` : column.label,
    type: column.type,
    group: column.group,
  }) as ReportColumn)
}

async function loadLinkedForms(db: any, tenantId: string, nodeLists: unknown[]): Promise<Record<string, LinkedFormLike>> {
  const ids = new Set<string>()
  for (const nodes of nodeLists) {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      const formId = (node as any)?.config?.form_id
      if (typeof formId === 'string' && UUID.test(formId)) ids.add(formId)
    }
  }
  if (ids.size === 0) return {}
  const { data } = await db.from('forms').select('id, name, version, fields').eq('tenant_id', tenantId).in('id', [...ids].slice(0, 50))
  return Object.fromEntries(((data ?? []) as any[]).map((form) => [form.id, { fields: form.fields, version: form.version, name: form.name }]))
}

export interface WorkflowDefinitionSnapshot {
  workflow: { id: string; name: string; user_variables: unknown; nodes: unknown; edges: unknown }
  versions: Array<{ nodes: unknown; edges: unknown; user_variables: unknown }>
  linkedForms: Record<string, LinkedFormLike>
}

/** The workflow (tenant-checked), its newest published versions and linked forms; null when not found. */
export async function loadWorkflowDefinitions(db: any, tenantId: string, workflowId: string): Promise<WorkflowDefinitionSnapshot | null> {
  const [workflowResult, versionsResult] = await Promise.all([
    db.from('workflows').select('id, name, user_variables, nodes, edges').eq('id', workflowId).eq('tenant_id', tenantId).maybeSingle(),
    db.from('workflow_versions').select('nodes, edges, user_variables').eq('workflow_id', workflowId).eq('tenant_id', tenantId).order('version_number', { ascending: false }).limit(MAX_VERSIONS),
  ])
  const workflow = workflowResult?.data
  if (!workflow) return null
  const versions = (versionsResult?.data ?? []) as WorkflowDefinitionSnapshot['versions']
  const linkedForms = await loadLinkedForms(db, tenantId, [workflow.nodes, ...versions.map((v) => v.nodes)]).catch(() => ({}))
  return { workflow, versions, linkedForms }
}

/** The variable columns of a workflow's runs (typed), from its definitions and recent stored runs. */
export async function discoverWorkflowVariableColumns(db: any, tenantId: string, workflowId: string): Promise<{ workflow: { id: string; name: string }; columns: ReportColumn[] } | null> {
  const definitions = await loadWorkflowDefinitions(db, tenantId, workflowId)
  if (!definitions) return null
  const { workflow, versions, linkedForms } = definitions
  const definitionColumns = [workflow, ...versions].flatMap((definition) => definitionVariableColumns({ ...definition, linkedForms }))
  const { data: runs } = await db.from('workflow_runs')
    .select('variables')
    .eq('workflow_id', workflowId)
    .eq('tenant_id', tenantId)
    .not('variables', 'is', null)
    .order('started_at', { ascending: false })
    .limit(SAMPLE_SIZE)
  const stored = storedVariableColumns(((runs ?? []) as any[]).map((run) => run.variables))
  return { workflow: { id: workflow.id, name: workflow.name }, columns: labelled(mergeVariableColumns(definitionColumns, stored)) }
}

/** Task form field columns (`fields.<key>`) of the tasks a workflow's User Tasks create. */
export async function discoverWorkflowTaskFieldColumns(db: any, tenantId: string, workflowId: string): Promise<{ workflow: { id: string; name: string }; columns: ReportColumn[] } | null> {
  const definitions = await loadWorkflowDefinitions(db, tenantId, workflowId)
  if (!definitions) return null
  const { workflow, versions, linkedForms } = definitions
  const fromDefinition: VariableColumn[] = []
  for (const definition of [workflow, ...versions]) {
    for (const column of definitionVariableColumns({ ...definition, user_variables: [], linkedForms })) {
      if (!column.key.startsWith(`${RUN_VARIABLE_COLUMN_PREFIX}task_data.`)) continue
      const path = column.key.slice(`${RUN_VARIABLE_COLUMN_PREFIX}task_data.`.length)
      if (path.split('.').length > 2) continue
      fromDefinition.push({ ...column, key: `${TASK_FIELD_COLUMN_PREFIX}${path}` })
    }
  }
  const { data: tasks } = await db.from('tasks')
    .select('values:metadata->template_values')
    .eq('workflow_id', workflowId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(SAMPLE_SIZE)
  const observed = new Map<string, unknown[]>()
  for (const task of (tasks ?? []) as any[]) {
    for (const [path, value] of runVariableLeaves(task?.values)) {
      if (path.split('.').length > 2 || path.split('.').some((part) => !isReportableVariableKey(part))) continue
      const key = `${TASK_FIELD_COLUMN_PREFIX}${path}`
      const list = observed.get(key) ?? []
      if (list.length < SAMPLE_SIZE) list.push(Array.isArray(value) ? null : value)
      observed.set(key, list)
    }
  }
  const storedColumns: VariableColumn[] = [...observed].map(([key, values]) => ({ key, label: key.slice(TASK_FIELD_COLUMN_PREFIX.length), type: inferRunVariableType(values), group: 'Stored on tasks', typed: false }))
  return { workflow: { id: workflow.id, name: workflow.name }, columns: labelled(mergeVariableColumns(fromDefinition, { columns: storedColumns, observed })) }
}

/**
 * A workflow-scoped copy of a source: the workflow's variable / task field
 * columns appended, a base filter to its rows, and the workflow in the label.
 */
export async function scopeReportSourceToWorkflow(db: any, tenantId: string, source: ReportSource, workflowId: string): Promise<ReportSource | null> {
  if (!WORKFLOW_SCOPED_REPORT_SOURCES.has(source.key)) return source
  const discovered = source.key === 'workflow_runs'
    ? await discoverWorkflowVariableColumns(db, tenantId, workflowId)
    : await discoverWorkflowTaskFieldColumns(db, tenantId, workflowId)
  if (!discovered) return null
  const seen = new Set(source.columns.map((column) => column.key))
  return {
    ...source,
    label: `${source.label}: ${discovered.workflow.name}`,
    columns: [...source.columns, ...discovered.columns.filter((column) => !seen.has(column.key))],
    baseFilters: [...(source.baseFilters ?? []), { field: 'workflow_id', operator: 'eq', value: workflowId }],
    workflow: discovered.workflow,
  }
}
