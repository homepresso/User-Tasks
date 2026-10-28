import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeTableColumns, type TableColumn } from '@/lib/data-table-columns'
import { kickQueueProcessor } from '@/lib/process-queue'
import { isObjectLike } from '@/lib/utils/guards'
import { withQueuedInitiator, type RunInitiator } from '@/lib/workflow-initiator'

export { normalizeTableColumns }

export type DataTableEventType = 'created' | 'updated' | 'deleted'

export type TableLike = {
  id: string
  name: string
  slug?: string | null
  columns?: unknown
}

type WorkflowTriggerNode = {
  type?: string
  config?: Record<string, unknown>
}

type WorkflowRow = {
  id: string
  nodes?: unknown
  published_version_id?: string | null
}

function slugifyVariableKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function buildColumnVariables(columns: TableColumn[], rowData: Record<string, unknown>) {
  const extras: Record<string, unknown> = {}

  for (const column of columns) {
    const value = rowData[column.key]
    extras[column.key] = value

    const safeKey = slugifyVariableKey(column.key)
    if (safeKey && !(safeKey in extras)) extras[safeKey] = value

    const labelKey = slugifyVariableKey(column.label)
    if (labelKey && !(labelKey in extras)) extras[labelKey] = value
  }

  for (const [key, value] of Object.entries(rowData)) {
    if (!(key in extras)) extras[key] = value
    const safeKey = slugifyVariableKey(key)
    if (safeKey && !(safeKey in extras)) extras[safeKey] = value
  }

  return extras
}

// Row-context vars exposed by data_table_event triggers, so workflow authors can
// use {{row_id}}, {{row.column_key}} and {{<column_slug>}}.
export type RowContextVariables = Record<string, unknown> & {
  data_table_id: string
  data_table_name: string
  data_table_slug: string | null
  data_table_columns: TableColumn[]
  data_row_id: string
  data_row: Record<string, unknown>
  row: Record<string, unknown>
  row_id: string
  table_row_id: string
}

export function buildRowContextVariables(params: {
  table: TableLike
  rowId: string
  rowData: Record<string, unknown>
}): { vars: RowContextVariables; columns: TableColumn[] } {
  const columns = normalizeTableColumns(params.table.columns)
  const vars: RowContextVariables = {
    data_table_id: params.table.id,
    data_table_name: params.table.name,
    data_table_slug: params.table.slug ?? null,
    data_table_columns: columns,
    data_row_id: params.rowId,
    data_row: params.rowData,
    row: params.rowData,
    row_id: params.rowId,
    table_row_id: params.rowId,
    ...buildColumnVariables(columns, params.rowData),
  }
  return { vars, columns }
}

export type DataTableTriggerPayload = RowContextVariables & {
  data_event: DataTableEventType
  data_event_type: DataTableEventType
}

export function buildDataTableTriggerPayload(params: {
  eventType: DataTableEventType
  table: TableLike
  rowId: string
  rowData: Record<string, unknown>
}): { payload: DataTableTriggerPayload; columns: TableColumn[] } {
  const { vars, columns } = buildRowContextVariables({
    table: params.table,
    rowId: params.rowId,
    rowData: params.rowData,
  })
  const payload: DataTableTriggerPayload = {
    data_event: params.eventType,
    data_event_type: params.eventType,
    ...vars,
  }
  return { payload, columns }
}

// ─── Trigger set cache ───
// The active data_table_event workflows of a tenant, read once per TTL instead
// of per row write. Workflow publish/activate/deactivate/delete paths call
// invalidateDataTableTriggerCache(); other instances see changes within the
// TTL.

export const DATA_TABLE_TRIGGER_CACHE_TTL_MS = 30_000

type TriggerDefinition = {
  workflowId: string
  versionId: string | null
  /** Only rows of this table (any table when absent). */
  tableId?: string
  /** Only these events (all when empty). */
  eventTypes: string[]
}

const triggerCache = new Map<string, { expiresAt: number; triggers: Promise<TriggerDefinition[]> }>()

/** Drop the cached trigger set of one tenant (or of all tenants). */
export function invalidateDataTableTriggerCache(tenantId?: string | null) {
  if (tenantId) triggerCache.delete(tenantId)
  else triggerCache.clear()
}

async function loadTriggerDefinitions(supabase: SupabaseClient, tenantId: string): Promise<TriggerDefinition[]> {
  const { data: workflows, error } = await supabase
    .from('workflows')
    .select('id, nodes, published_version_id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .eq('trigger_type', 'data_table_event')
  if (error) throw new Error(error.message)
  const rows = (workflows ?? []) as WorkflowRow[]
  if (!rows.length) return []

  // Published version nodes for all of them in one read.
  const versionIds = rows.map((w) => w.published_version_id).filter((id): id is string => Boolean(id))
  const versionNodes = new Map<string, unknown>()
  if (versionIds.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: versions, error: versionError } = await (supabase as any)
      .from('workflow_versions')
      .select('id, nodes')
      .in('id', versionIds)
    if (versionError) throw new Error(versionError.message)
    for (const version of (versions ?? []) as Array<{ id: string; nodes?: unknown }>) versionNodes.set(version.id, version.nodes)
  }

  const definitions: TriggerDefinition[] = []
  for (const workflow of rows) {
    const published = workflow.published_version_id ? versionNodes.get(workflow.published_version_id) : undefined
    const nodes = Array.isArray(published) ? published : Array.isArray(workflow.nodes) ? workflow.nodes : []
    const triggerNode = (nodes as unknown[]).find((node): node is WorkflowTriggerNode => isObjectLike(node) && node.type === 'data_table_event')
    if (!triggerNode) continue

    const config = isObjectLike(triggerNode.config) ? triggerNode.config : {}
    definitions.push({
      workflowId: workflow.id,
      versionId: workflow.published_version_id ?? null,
      tableId: typeof config.table_id === 'string' && config.table_id ? config.table_id : undefined,
      eventTypes: Array.isArray(config.event_types)
        ? config.event_types.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : [],
    })
  }
  return definitions
}

function getTriggerDefinitions(supabase: SupabaseClient, tenantId: string): Promise<TriggerDefinition[]> {
  const now = Date.now()
  const cached = triggerCache.get(tenantId)
  if (cached && cached.expiresAt > now) return cached.triggers

  const entry = { expiresAt: now + DATA_TABLE_TRIGGER_CACHE_TTL_MS, triggers: loadTriggerDefinitions(supabase, tenantId) }
  triggerCache.set(tenantId, entry)
  // A failed read is not cached.
  entry.triggers.catch(() => {
    if (triggerCache.get(tenantId) === entry) triggerCache.delete(tenantId)
  })
  return entry.triggers
}

export type DataTableEvent = {
  rowId: string
  rowData: Record<string, unknown>
  eventType: DataTableEventType
}

const ENQUEUE_BATCH_MAX = 1000

async function enqueueJobs(
  _caller: SupabaseClient,
  tenantId: string,
  jobs: Array<{ workflow_id: string; trigger_type: string; trigger_data: Record<string, unknown> }>,
): Promise<number> {
  // enqueue_workflow(_batch) is service-role only (20261118000000). The row
  // write that raised these events already passed the caller's checks, and
  // the trigger set is the tenant's own active workflows.
  const { createServiceClient } = await import('@/lib/cron-auth')
  const supabase = createServiceClient()
  let enqueued = 0
  for (let i = 0; i < jobs.length; i += ENQUEUE_BATCH_MAX) {
    const chunk = jobs.slice(i, i + ENQUEUE_BATCH_MAX)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('enqueue_workflow_batch', { p_tenant_id: tenantId, p_jobs: chunk })
    if (!error) {
      enqueued += Number(data ?? chunk.length)
      continue
    }
    if (error.code !== 'PGRST202') {
      // Same as a failed enqueue_workflow before: the row write still stands.
      console.warn('[data-table-triggers] enqueue failed:', error.message)
      continue
    }
    // enqueue_workflow_batch not migrated yet: one enqueue_workflow per job.
    for (const job of chunk) {
      const { error: oneError } = await supabase.rpc('enqueue_workflow', {
        p_workflow_id: job.workflow_id,
        p_tenant_id: tenantId,
        p_task_id: null,
        p_trigger_type: job.trigger_type,
        p_trigger_data: job.trigger_data,
        p_priority: 0,
        p_delay_seconds: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      if (!oneError) enqueued++
    }
  }
  return enqueued
}

/**
 * Queue the active `data_table_event` workflows matching row writes of one
 * table: the tenant's trigger set comes from the cache, the table is read
 * only when something matches, all jobs go out in one batch, and the queue is
 * kicked once.
 */
export async function enqueueDataTableEvents(params: {
  supabase: SupabaseClient
  tenantId: string
  tableId: string
  events: DataTableEvent[]
  /** Table row already at hand (id, name, slug, columns). */
  table?: TableLike
  /** Caller-owned cache of table reads (e.g. per workflow run). */
  tableCache?: Map<string, Promise<TableLike | null>>
  /** Who wrote the rows (signed into each job: the runs' workflow_started_by). */
  initiator?: RunInitiator
}): Promise<number> {
  const { supabase, tenantId, tableId, events } = params
  if (!events.length) return 0

  let triggers: TriggerDefinition[]
  try {
    triggers = await getTriggerDefinitions(supabase, tenantId)
  } catch {
    return 0
  }
  const matches = events.map((event) =>
    triggers.filter((trigger) =>
      (!trigger.tableId || trigger.tableId === tableId) &&
      (trigger.eventTypes.length === 0 || trigger.eventTypes.includes(event.eventType))))
  if (!matches.some((list) => list.length)) return 0

  const loadTable = async (): Promise<TableLike | null> => {
    const { data } = await supabase
      .from('custom_tables')
      .select('id, name, slug, columns')
      .eq('id', tableId)
      .maybeSingle()
    return (data as TableLike | null) ?? null
  }
  let table: TableLike | null | undefined = params.table
  if (!table && params.tableCache) {
    let entry = params.tableCache.get(tableId)
    if (!entry) {
      entry = loadTable()
      params.tableCache.set(tableId, entry)
    }
    table = await entry
  }
  if (!table && !params.tableCache) table = await loadTable()
  if (!table) return 0

  const jobs: Array<{ workflow_id: string; trigger_type: string; trigger_data: Record<string, unknown> }> = []
  events.forEach((event, index) => {
    if (!matches[index].length) return
    const { payload } = buildDataTableTriggerPayload({
      eventType: event.eventType,
      table: table!,
      rowId: event.rowId,
      rowData: event.rowData,
    })
    for (const trigger of matches[index]) {
      const triggerData = { _version_id: trigger.versionId, ...payload }
      jobs.push({
        workflow_id: trigger.workflowId,
        trigger_type: 'data_table_event',
        trigger_data: params.initiator?.userId
          ? withQueuedInitiator(triggerData, { tenantId, workflowId: trigger.workflowId }, { userId: params.initiator.userId, via: 'data_table' })
          : triggerData,
      })
    }
  })

  const enqueued = await enqueueJobs(supabase, tenantId, jobs)
  if (enqueued > 0) kickQueueProcessor()
  return enqueued
}

/** One row write: see enqueueDataTableEvents. */
export async function enqueueDataTableEventWorkflows(params: {
  supabase: SupabaseClient
  tenantId: string
  tableId: string
  rowId: string
  rowData: Record<string, unknown>
  eventType: DataTableEventType
  table?: TableLike
  tableCache?: Map<string, Promise<TableLike | null>>
  initiator?: RunInitiator
}) {
  const { rowId, rowData, eventType, ...rest } = params
  return enqueueDataTableEvents({ ...rest, events: [{ rowId, rowData, eventType }] })
}
