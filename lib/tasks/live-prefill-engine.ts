/**
 * The engine's side of prefilling a task from the trigger's record
 * (lib/forms/live-prefill.ts): people given as `{ email }` (a list item's
 * person column) become workspace members, and the fields that follow the
 * record are noted on the task (`metadata.live_prefill`). Server-only.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow nodes and variables are free-form JSON */

import { isEmailPerson } from '@/lib/forms/data-target'
import { livePrefillFields, scalars, type LivePrefill, type LivePrefillSource } from '@/lib/forms/live-prefill'
import { triggerRecordFor } from '@/lib/forms/workflow-data'
import { coerceTaskFieldValues, type TaskFieldDef } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'

/**
 * Person fields whose prefill resolves to `{ email }` people (or a list of
 * them): mapped to workspace members (people who are not members are left
 * out), coerced to the field's value shape. Only those fields are returned.
 */
export async function prefilledPeople(db: any, tenantId: string, fields: TaskFieldDef[], stepValues: unknown, resolve: (template: string) => unknown): Promise<Record<string, unknown>> {
  const step = isPlainObject(stepValues) ? stepValues : {}
  const raw: Record<string, unknown> = {}
  const people: TaskFieldDef[] = []
  for (const field of fields) {
    if (field.type !== 'user') continue
    const own = step[field.key]
    const template = typeof own === 'string' && own.trim() ? own : field.default
    if (typeof template !== 'string' || !template.includes('{{')) continue
    const value = resolve(template)
    const list = Array.isArray(value) ? value : [value]
    if (!list.length || !list.every((v) => isEmailPerson(v) || (typeof v === 'string' && v))) continue
    if (!list.some((v) => isEmailPerson(v))) continue
    raw[field.key] = value
    people.push(field)
  }
  if (!people.length) return {}
  const { mapPeopleValues } = await import('@/lib/services/form-targets')
  const mapped = await mapPeopleValues(db, tenantId, people, raw)
  return coerceTaskFieldValues(people, mapped.values)
}

/** What the task notes about its record-prefilled fields (null: none, or the record can't be found again). */
export function planTaskLivePrefill(nodes: any[], variables: Record<string, any>, fields: TaskFieldDef[], stepValues: unknown, values: Record<string, unknown>): LivePrefill | null {
  const record = triggerRecordFor(nodes, [], null)
  if (!record) return null
  const map = livePrefillFields(fields, stepValues, record.variable)
  if (!Object.keys(map).length) return null
  let source: LivePrefillSource
  if (record.kind === 'table') {
    const tableId = variables?.data_table_id
    const rowId = variables?.row_id
    if (typeof tableId !== 'string' || typeof rowId !== 'string' || !tableId || !rowId) return null
    source = { kind: 'table', table_id: tableId, row_id: rowId }
  } else {
    const ids = scalars(Object.fromEntries((record.idFrom ?? []).map((name) => [name, variables?.[name]])))
    if (!Object.keys(ids).length) return null
    source = { kind: 'extension', trigger: record.nodeType, ids: ids as Record<string, string | number>, config: scalars(record.config) }
  }
  return { source, fields: map, values: Object.fromEntries(Object.keys(map).map((k) => [k, values[k] ?? null])) }
}
