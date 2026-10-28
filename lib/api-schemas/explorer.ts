/**
 * Pure mapper from the endpoint registry to the API explorer's endpoint
 * groups (components/api-keys/api-explorer.tsx ENDPOINT_GROUPS, also used by
 * the public explorer at /docs/api-explorer and the Postman export).
 *
 * One group per endpoint tag (registry order); each endpoint's path, query
 * and top-level body fields become explorer params with a description and a
 * placeholder taken from the schema (example, default, first enum value, or
 * a type hint). Keep this module free of React and server-only imports.
 */

import { z } from 'zod'
import type { EndpointDef, HttpMethod } from './registry'

export interface ExplorerParam {
  name: string
  type: 'query' | 'path' | 'body'
  required?: boolean
  placeholder?: string
  description?: string
  options?: string[]
}

export interface ExplorerEndpoint {
  method: HttpMethod
  /** Full request path, e.g. `/api/v1/workflows/{id}`. */
  path: string
  label: string
  description: string
  params: ExplorerParam[]
  /** Permission key the endpoint requires (null = any authenticated caller). */
  permission?: string | null
}

export interface ExplorerGroup {
  label: string
  endpoints: ExplorerEndpoint[]
}

type JsonSchema = Record<string, unknown>

function toJson(schema: z.ZodType): JsonSchema {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema
  } catch {
    return {}
  }
}

/** Unwrap `anyOf: [X, null]` (nullable) to X. */
function nonNull(schema: JsonSchema): JsonSchema {
  const options = schema.anyOf as JsonSchema[] | undefined
  if (Array.isArray(options)) {
    const real = options.filter((option) => option.type !== 'null')
    if (real.length === 1) return { ...real[0], description: schema.description ?? real[0].description }
  }
  return schema
}

function placeholderFor(schema: JsonSchema): string | undefined {
  const examples = schema.examples as unknown[] | undefined
  const sample = Array.isArray(examples) && examples.length ? examples[0] : schema.default
  if (sample !== undefined) return typeof sample === 'string' ? sample : JSON.stringify(sample)
  const options = schema.enum as unknown[] | undefined
  if (Array.isArray(options) && options.length) return String(options[0])
  switch (schema.type) {
    case 'boolean': return 'false'
    case 'integer':
    case 'number': return typeof schema.minimum === 'number' && schema.minimum > 0 ? String(schema.minimum) : '0'
    case 'array': return '[]'
    case 'object': return '{}'
    default: return undefined
  }
}

function paramsOf(schema: z.ZodType | undefined, type: ExplorerParam['type']): ExplorerParam[] {
  if (!schema) return []
  const json = toJson(schema)
  const required = new Set((json.required as string[] | undefined) ?? [])
  return Object.entries((json.properties ?? {}) as Record<string, JsonSchema>).map(([name, raw]) => {
    const prop = nonNull(raw)
    const options = Array.isArray(prop.enum) ? (prop.enum as unknown[]).map(String) : undefined
    const description = typeof prop.description === 'string' ? prop.description : undefined
    const placeholder = type === 'path' ? undefined : placeholderFor(prop)
    return {
      name,
      type,
      ...(type === 'path' || required.has(name) ? { required: true } : {}),
      ...(placeholder !== undefined ? { placeholder } : {}),
      ...(description ? { description } : {}),
      ...(options ? { options } : {}),
    }
  })
}

export function toExplorerEndpoint(endpoint: EndpointDef): ExplorerEndpoint {
  const permissionNote = endpoint.permission ? ` Requires ${endpoint.permission}.` : ''
  return {
    method: endpoint.method,
    path: `/api/v1${endpoint.path}`,
    label: endpoint.summary,
    description: `${endpoint.description ?? endpoint.summary}${permissionNote}`,
    params: [
      ...paramsOf(endpoint.params, 'path'),
      ...paramsOf(endpoint.query, 'query'),
      ...paramsOf(endpoint.body, 'body'),
    ],
    permission: endpoint.permission,
  }
}

/** Group bearer-authenticated endpoints by their first tag, keeping registry order. */
export function buildExplorerGroups(endpoints: readonly EndpointDef[]): ExplorerGroup[] {
  const groups = new Map<string, ExplorerEndpoint[]>()
  for (const endpoint of endpoints) {
    if (endpoint.auth === 'none') continue // the explorer always sends a bearer token
    if (endpoint.stream) continue // long-lived SSE responses never finish; use `usertasks logs tail`
    const label = endpoint.tags[0] ?? 'Other'
    groups.set(label, [...(groups.get(label) ?? []), toExplorerEndpoint(endpoint)])
  }
  return [...groups].map(([label, list]) => ({ label, endpoints: list }))
}

/**
 * OData (/api/odata) is not part of the /api/v1 registry, so its explorer
 * entries are maintained here. Reads need data.view (reports.view for the
 * report sets), writes need data.manage_rows.
 */
const entitySet = (placeholder: string): ExplorerParam => ({ name: 'entity_set', type: 'path', required: true, placeholder })
const rowId: ExplorerParam = { name: 'row_id', type: 'path', required: true, placeholder: 'Row UUID' }
const paging: ExplorerParam[] = [
  { name: '$top', type: 'query', placeholder: '25', description: 'Maximum rows to return' },
  { name: '$skip', type: 'query', placeholder: '0', description: 'Rows to skip' },
  { name: '$count', type: 'query', placeholder: 'true', description: 'Include total row count' },
]

export const ODATA_EXPLORER_GROUP: ExplorerGroup = {
  label: 'OData',
  endpoints: [
    { method: 'GET', path: '/api/odata', label: 'Service Document', description: 'List all available data-table entity sets exposed through the OData service. Requires data.view.', params: [] },
    { method: 'GET', path: '/api/odata/$metadata', label: 'Service Metadata', description: 'Return OData metadata describing all table entity sets and their fields. Requires data.view.', params: [] },
    {
      method: 'GET', path: '/api/odata/{entity_set}', label: 'List Rows',
      description: 'Query rows from a data table or report-oriented OData entity set using OData query options. Requires data.view (reports.view for report sets).',
      params: [
        entitySet('employee_expense_claims or SavedReportResults'),
        ...paging,
        { name: '$select', type: 'query', placeholder: 'RowId,employee_name,amount', description: 'Comma-separated fields to return' },
        { name: '$orderby', type: 'query', placeholder: 'amount desc', description: 'Sort expression' },
        { name: '$filter', type: 'query', placeholder: 'amount gt 1000', description: 'Basic OData filter expression' },
      ],
    },
    { method: 'GET', path: '/api/odata/SavedReports', label: 'List Saved Reports', description: 'Discover saved reports and their OData results path. Requires reports.view.', params: paging },
    {
      method: 'GET', path: '/api/odata/SavedReportResults', label: 'List Saved Report Results',
      description: "Query saved report output rows. Filter by ReportId to pull a single report's result data and metrics payloads. Requires reports.view.",
      params: [
        { name: '$filter', type: 'query', placeholder: "ReportId eq 'report-uuid'", description: 'Recommended filter to target one saved report' },
        ...paging,
        { name: '$select', type: 'query', placeholder: 'ResultId,ReportId,ReportName,RowIndex,MetricsJson' },
        { name: '$orderby', type: 'query', placeholder: 'RowIndex asc' },
      ],
    },
    { method: 'GET', path: "/api/odata/{entity_set}('{row_id}')", label: 'Get Row', description: 'Fetch a single row by OData row key. Requires data.view.', params: [entitySet('employee_expense_claims'), rowId] },
    {
      method: 'POST', path: '/api/odata/{entity_set}', label: 'Create Row', description: 'Create a new row in the selected entity set. Requires data.manage_rows.',
      params: [
        entitySet('employee_expense_claims'),
        { name: 'employee_name', type: 'body', placeholder: 'Alex Morgan' },
        { name: 'amount', type: 'body', placeholder: '1250' },
        { name: 'department', type: 'body', placeholder: 'Finance' },
      ],
    },
    {
      method: 'PUT', path: "/api/odata/{entity_set}('{row_id}')", label: 'Replace Row', description: 'Replace a row using its OData row key. Requires data.manage_rows.',
      params: [
        entitySet('employee_expense_claims'), rowId,
        { name: 'employee_name', type: 'body', placeholder: 'Updated name' },
        { name: 'amount', type: 'body', placeholder: '900' },
        { name: 'department', type: 'body', placeholder: 'Operations' },
      ],
    },
    { method: 'DELETE', path: "/api/odata/{entity_set}('{row_id}')", label: 'Delete Row', description: 'Delete a row using its OData row key. Requires data.manage_rows.', params: [entitySet('employee_expense_claims'), rowId] },
  ],
}
