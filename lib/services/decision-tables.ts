/**
 * Decision tables: CRUD, test, and portable export / import. Shared by
 * /api/v1/decision-tables[/{id}[/test|/export]|/import] and the MCP
 * decision_tables_* tools; mirrors the business-rules UI actions (audit, sync
 * capture, deletion queue).
 *
 * Decision tables are governed by the workflow permissions (view →
 * workflows.view, import → workflows.create, as the MCP tool always was).
 * Imports always create a new table; field, rule and condition ids are kept
 * when present and generated otherwise.
 */

import { hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { evaluateDecisionTable } from '@/lib/decision-table-engine'
import { diffValues } from '@/lib/portability/plan'
import { applyPage, audit, dbError, ilikeTerm, queueDeletion, syncChange, type Page } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped table (jsonb inputs/outputs/rules) */

export const DECISION_TABLE_EXPORT_VERSION = 1

export interface DecisionTableExport {
  version: number
  asset_type: 'decision_table'
  decision_table: {
    name: string
    description: string | null
    inputs: unknown[]
    outputs: unknown[]
    rules: unknown[]
  }
}

function normalizeField(field: any) {
  return {
    id: field?.id ?? crypto.randomUUID(),
    key: field?.key,
    label: field?.label ?? field?.key,
    type: field?.type ?? 'text',
  }
}

function normalizeRule(rule: any) {
  return {
    id: rule?.id ?? crypto.randomUUID(),
    label: rule?.label ?? '',
    enabled: rule?.enabled ?? true,
    conditions: (Array.isArray(rule?.conditions) ? rule.conditions : []).map((condition: any) => ({
      id: condition?.id ?? crypto.randomUUID(),
      inputKey: condition?.inputKey,
      operator: condition?.operator,
      value: condition?.value == null ? '' : String(condition.value),
    })),
    outputs: rule?.outputs ?? {},
  }
}

/** Table row + input/output/rule counts (the shape every decision-table response uses). */
export function summarizeDecisionTable(table: any) {
  return {
    ...table,
    input_count: Array.isArray(table.inputs) ? table.inputs.length : 0,
    output_count: Array.isArray(table.outputs) ? table.outputs.length : 0,
    rule_count: Array.isArray(table.rules) ? table.rules.length : 0,
  }
}

export async function exportDecisionTable(ctx: ServiceContext, tableId: string): Promise<DecisionTableExport> {
  requirePerm(ctx, 'workflows.view')
  const { data, error } = await (ctx.supabase as any).from('decision_tables')
    .select('*').eq('id', tableId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Decision table not found')
  return {
    version: DECISION_TABLE_EXPORT_VERSION,
    asset_type: 'decision_table',
    decision_table: {
      name: data.name,
      description: data.description ?? null,
      inputs: data.inputs ?? [],
      outputs: data.outputs ?? [],
      rules: data.rules ?? [],
    },
  }
}

export interface DecisionTableImportInput {
  /** An export document (`{ decision_table: {...} }`) or the bare table object. */
  payload: unknown
  name_override?: string
  description_override?: string
}

/** Parse a JSON string import (the MCP tool's `import_json`). */
export function parseDecisionTableImportJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw ServiceError.validation('import_json must be valid JSON')
  }
}

export async function importDecisionTable(ctx: ServiceContext, input: DecisionTableImportInput) {
  requirePerm(ctx, 'workflows.create')
  const raw = input.payload as any
  // The decision-table editor's own export file uses camelCase `decisionTable`.
  const payload = raw?.decision_table ?? raw?.decisionTable ?? raw
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw ServiceError.validation('Import must contain a decision table object')
  }
  if (!payload.name || typeof payload.name !== 'string' || !payload.name.trim()) {
    throw ServiceError.validation('Imported decision table must include a name')
  }
  for (const [key, list] of [['inputs', payload.inputs], ['outputs', payload.outputs]] as const) {
    if (list !== undefined && (!Array.isArray(list) || list.some((field: any) => typeof field?.key !== 'string' || !field.key))) {
      throw ServiceError.validation(`${key} must be an array of fields with a key`)
    }
  }
  if (payload.rules !== undefined && !Array.isArray(payload.rules)) throw ServiceError.validation('rules must be an array')

  const description = input.description_override !== undefined
    ? (input.description_override.trim() || null)
    : (typeof payload.description === 'string' ? payload.description.trim() || null : null)
  const { data, error } = await (ctx.supabase as any).from('decision_tables').insert({
    tenant_id: ctx.tenantId,
    name: input.name_override?.trim() || payload.name.trim(),
    description,
    inputs: (payload.inputs ?? []).map(normalizeField),
    outputs: (payload.outputs ?? []).map(normalizeField),
    rules: (payload.rules ?? []).map(normalizeRule),
    created_by: ctx.actorId,
  }).select('*').single()
  if (error || !data) throw dbError(error, 'Failed to import decision table')

  await audit(ctx, {
    objectType: 'decision_table', objectId: data.id, action: 'create',
    summary: `Imported decision table "${data.name}"`,
    metadata: { kind: 'import', rules: Array.isArray(data.rules) ? data.rules.length : 0 },
  })
  await syncChange(ctx, 'decision_table', data)
  return summarizeDecisionTable(data)
}

// ─── CRUD + test ───

const LIST_COLUMNS = 'id, name, description, inputs, outputs, rules, created_by, created_at, updated_at'

export interface DecisionTableInput {
  name?: string
  description?: string | null
  inputs?: unknown[]
  outputs?: unknown[]
  rules?: unknown[]
}

async function loadTable(ctx: ServiceContext, tableId: string, columns = '*') {
  const { data, error } = await (ctx.supabase as any).from('decision_tables')
    .select(columns).eq('id', tableId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Decision table not found')
  return data as any
}

function validateFields(key: string, list: unknown) {
  if (list === undefined) return
  if (!Array.isArray(list) || list.some((field: any) => typeof field?.key !== 'string' || !field.key)) {
    throw ServiceError.validation(`${key} must be an array of fields with a key`)
  }
}

export async function listDecisionTables(ctx: ServiceContext, filters: { search?: string }, page: Page) {
  requirePerm(ctx, 'workflows.view')
  let query = (ctx.supabase as any).from('decision_tables')
    .select(LIST_COLUMNS, { count: 'exact' }).eq('tenant_id', ctx.tenantId).order('updated_at', { ascending: false })
  const search = filters.search?.trim()
  if (search) {
    const term = ilikeTerm(search)
    query = query.or(`name.ilike.%${term}%,description.ilike.%${term}%`)
  }
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  return { decision_tables: (data ?? []).map(summarizeDecisionTable), total: (count ?? (data ?? []).length) as number }
}

export async function getDecisionTable(ctx: ServiceContext, tableId: string) {
  requirePerm(ctx, 'workflows.view')
  return summarizeDecisionTable(await loadTable(ctx, tableId))
}

/** Create a table; missing field / rule / condition ids are generated. */
export async function createDecisionTable(ctx: ServiceContext, input: DecisionTableInput & { name: string }) {
  // The UI and MCP gate creation on workflows.create; the REST route has always used workflows.edit.
  if (!hasPerm(ctx, 'workflows.create')) requirePerm(ctx, 'workflows.edit')
  const name = String(input.name ?? '').trim()
  if (!name) throw ServiceError.validation('name is required')
  validateFields('inputs', input.inputs)
  validateFields('outputs', input.outputs)
  if (input.rules !== undefined && !Array.isArray(input.rules)) throw ServiceError.validation('rules must be an array')
  const { data, error } = await (ctx.supabase as any).from('decision_tables').insert({
    tenant_id: ctx.tenantId,
    name,
    description: input.description?.trim() || null,
    inputs: (input.inputs ?? []).map(normalizeField),
    outputs: (input.outputs ?? []).map(normalizeField),
    rules: (input.rules ?? []).map(normalizeRule),
    created_by: ctx.actorId,
  }).select('*').single()
  if (error || !data) throw dbError(error, 'Failed to create decision table')
  await audit(ctx, {
    objectType: 'decision_table', objectId: data.id, action: 'create',
    summary: `Created decision table "${data.name}"`, metadata: { feature: 'decision_table' },
  })
  await syncChange(ctx, 'decision_table', data)
  return summarizeDecisionTable(data)
}

/**
 * Update a table. Inputs, outputs and rules replace the stored arrays when
 * given; values equal to what is stored are not changes, so sending a
 * fetched table back unedited reports `changed: false`.
 */
export async function updateDecisionTable(ctx: ServiceContext, tableId: string, input: DecisionTableInput) {
  requirePerm(ctx, 'workflows.edit')
  const existing = await loadTable(ctx, tableId)
  validateFields('inputs', input.inputs)
  validateFields('outputs', input.outputs)
  if (input.rules !== undefined && !Array.isArray(input.rules)) throw ServiceError.validation('rules must be an array')

  const next: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const name = String(input.name).trim()
    if (!name) throw ServiceError.validation('name cannot be empty')
    next.name = name
  }
  if (input.description !== undefined) next.description = input.description?.trim() || null
  if (input.inputs !== undefined) next.inputs = input.inputs.map(normalizeField)
  if (input.outputs !== undefined) next.outputs = input.outputs.map(normalizeField)
  if (input.rules !== undefined) next.rules = input.rules.map(normalizeRule)

  const changes = Object.fromEntries(Object.entries(next).filter(([key, value]) => diffValues(existing[key], value).length > 0))
  if (!Object.keys(changes).length) return { ...summarizeDecisionTable(existing), changed: false }

  const { data, error } = await (ctx.supabase as any).from('decision_tables')
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', tableId).eq('tenant_id', ctx.tenantId).select('*').single()
  if (error || !data) throw dbError(error, 'Failed to update decision table')
  await audit(ctx, {
    objectType: 'decision_table', objectId: tableId, action: 'update',
    summary: `Updated decision table "${data.name}"`, metadata: { feature: 'decision_table', fields: Object.keys(changes) },
  })
  await syncChange(ctx, 'decision_table', data)
  return { ...summarizeDecisionTable(data), changed: true }
}

/** Queue the table for deletion (as the UI does). */
export async function deleteDecisionTable(ctx: ServiceContext, tableId: string) {
  requirePerm(ctx, 'workflows.delete')
  const existing = await loadTable(ctx, tableId, 'id, name')
  await queueDeletion(ctx, 'decision_table', tableId, { name: existing.name ?? null })
  await audit(ctx, {
    objectType: 'decision_table', objectId: tableId, action: 'delete',
    summary: `Queued deletion for decision table "${existing.name}"`, metadata: { feature: 'decision_table' },
  })
  await syncChange(ctx, 'decision_table', existing, 'delete')
  return { deleted: true as const, id: tableId, queued: true }
}

/** Evaluate the table against input values (first enabled matching rule wins). */
export async function testDecisionTable(ctx: ServiceContext, tableId: string, values: Record<string, unknown>) {
  requirePerm(ctx, 'workflows.view')
  const table = await loadTable(ctx, tableId, 'id, name, inputs, outputs, rules')
  const result = evaluateDecisionTable((table.inputs ?? []) as any[], (table.rules ?? []) as any[], values as any)
  return {
    decision_table_id: table.id as string,
    decision_table_name: table.name as string,
    matched: result.matched,
    rule: result.rule,
    outputs: result.outputs,
  }
}
