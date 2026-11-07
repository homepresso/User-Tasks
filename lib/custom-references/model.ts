/**
 * The output model of a custom reference, generated from its projection:
 * downstream pickers (workflow data picker, Data table columns, lookups,
 * Loops, report columns) see exactly the selected columns with their types —
 * none of the raw response.
 *
 * Pure and client-safe.
 */

import type { ResponseSchema, SchemaField, SchemaNode, SchemaType } from '@/lib/response-schema'
import { schemaAtCollectionPath } from '@/lib/response-collections'
import { columnName, isWriteKind, type CustomColumn, type CustomReferenceConfig } from './types'

const SCHEMA_TYPES = new Set<SchemaType>(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null', 'any'])

/** A database column type → model type. */
export function sqlTypeToSchemaType(sqlType: string | undefined): SchemaType {
  const t = String(sqlType ?? '').toLowerCase()
  if (!t) return 'any'
  if (/^(bit|bool)/.test(t)) return 'boolean'
  if (/(^|\s)(int|integer|bigint|smallint|tinyint|serial|bigserial)\b|^int\d/.test(t)) return 'integer'
  if (/(numeric|decimal|float|double|real|money|number)/.test(t)) return 'number'
  if (/(json|jsonb|object|variant)/.test(t)) return 'object'
  if (/(array|\[\])/.test(t)) return 'array'
  return 'string'
}

function normalizeType(type: string | undefined): SchemaType | null {
  if (!type) return null
  if (type === 'date') return 'string'
  return SCHEMA_TYPES.has(type as SchemaType) ? (type as SchemaType) : null
}

/** Model of one projected column: declared type, else the source model's, else the table column type. */
function columnNode(column: CustomColumn, config: CustomReferenceConfig, itemSchema: SchemaNode | null): SchemaNode {
  const declared = normalizeType(column.type)
  if (declared) return { type: declared, ...(column.type === 'date' ? { format: 'date-time' } : {}) }
  if (config.source.type === 'table') {
    const def = config.source.columns.find((c) => c.name === column.path)
    return { type: sqlTypeToSchemaType(def?.type) }
  }
  const fromSource = itemSchema ? schemaAtCollectionPath(itemSchema, column.path) : null
  if (fromSource) {
    const { type, format, nullable } = fromSource
    return { type, ...(format ? { format } : {}), ...(nullable ? { nullable } : {}), ...(fromSource.fields ? { fields: fromSource.fields } : {}), ...(fromSource.items ? { items: fromSource.items } : {}) }
  }
  return { type: 'any' }
}

/** Item model of the source rows (from a captured source model). */
export function sourceItemSchema(sourceModel: ResponseSchema | null | undefined, rowsPath: string | undefined): SchemaNode | null {
  if (!sourceModel?.root) return null
  const list = schemaAtCollectionPath(sourceModel.root, rowsPath ?? '')
  if (!list) return null
  if (list.type === 'array') return list.items ?? null
  return list.type === 'object' ? list : null
}

export interface CustomOutputModel {
  response_schema: ResponseSchema
  outputs: Array<{ id?: string; name: string; path: string; type: string }>
}

export function customOutputModel(
  config: CustomReferenceConfig,
  itemSchema: SchemaNode | null,
  existingOutputs: Array<{ id?: string; name?: string }> = [],
): CustomOutputModel {
  if (isWriteKind(config.kind)) return writeOutputModel(config, itemSchema, existingOutputs)
  const fields: SchemaField[] = config.columns.map((column) => ({
    name: columnName(column),
    ...columnNode(column, config, itemSchema),
  }))
  // A table source with no explicit columns returns every introspected column.
  if (!fields.length && config.source.type === 'table') {
    for (const c of config.source.columns) fields.push({ name: c.name, type: sqlTypeToSchemaType(c.type) })
  }
  const row: SchemaNode = { type: 'object', fields }
  let root: SchemaNode
  if (config.kind === 'read') root = { ...row, nullable: true }
  else if (config.include_total) {
    root = {
      type: 'object',
      fields: [
        { name: 'rows', type: 'array', items: row, description: 'The rows of this page' },
        { name: 'total', type: 'integer', description: 'Rows matching the filter (before paging)' },
      ],
    }
  } else root = { type: 'array', items: row }

  const ids = new Map(existingOutputs.map((o) => [String(o.name ?? ''), o.id]))
  const outputs = fields.map((field) => ({
    ...(ids.get(field.name) ? { id: ids.get(field.name) } : {}),
    name: field.name,
    path: config.kind === 'read' ? field.name : config.include_total ? `rows[].${field.name}` : `[].${field.name}`,
    type: field.type === 'integer' ? 'number' : field.type === 'any' || field.type === 'null' ? 'string' : field.type,
  }))
  return { response_schema: { version: 1, source: 'manual', root, updated_at: new Date().toISOString() }, outputs }
}

/** Columns of the record a table write returns when no projection is chosen: the columns it writes. */
function writtenColumns(config: CustomReferenceConfig): CustomColumn[] {
  if (config.source.type !== 'table' || config.kind === 'execute') return []
  const names = [...(config.write?.key ?? []), ...(config.write?.set ?? [])].map((c) => c.column)
  return Array.from(new Set(names), (path) => ({ path }))
}

/**
 * Write kinds: `{ status, affected_rows, id, record }` — the record is the
 * written row projected through the columns (RETURNING / OUTPUT / the API's
 * response), or null when nothing came back.
 */
function writeOutputModel(config: CustomReferenceConfig, itemSchema: SchemaNode | null, existingOutputs: Array<{ id?: string; name?: string }>): CustomOutputModel {
  const columns = config.columns.length ? config.columns : writtenColumns(config)
  const recordFields: SchemaField[] = columns.map((column) => ({ name: columnName(column), ...columnNode(column, config, itemSchema) }))
  const record: SchemaNode = recordFields.length ? { type: 'object', fields: recordFields, nullable: true } : { type: 'object', nullable: true }
  const root: SchemaNode = {
    type: 'object',
    fields: [
      { name: 'status', type: 'integer', description: config.source.type === 'table' ? 'Always 200 when the statement ran' : 'The HTTP status of the API' },
      { name: 'affected_rows', type: 'integer', description: 'Rows (records) written' },
      { name: 'id', type: 'any', description: 'Id of the written record' },
      { name: 'record', description: 'The written record (projected)', ...record },
    ],
  }
  const ids = new Map(existingOutputs.map((o) => [String(o.name ?? ''), o.id]))
  const out = (name: string, path: string, type: string) => ({ ...(ids.get(name) ? { id: ids.get(name) } : {}), name, path, type })
  const outputs = [
    out('status', 'status', 'number'),
    out('affected_rows', 'affected_rows', 'number'),
    out('id', 'id', 'string'),
    ...recordFields.map((f) => out(`record.${f.name}`, `record.${f.name}`, f.type === 'integer' ? 'number' : f.type === 'any' || f.type === 'null' ? 'string' : f.type)),
  ]
  return { response_schema: { version: 1, source: 'manual', root, updated_at: new Date().toISOString() }, outputs }
}
