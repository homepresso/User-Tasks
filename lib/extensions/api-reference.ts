/**
 * Generated API references for extensions: a small, serialisable model of
 * an API (groups of operations, typed parameters and schemas) that an
 * extension builds at runtime — e.g. one reference per connected external
 * resource, typed from that resource's schema — and core renders as a
 * browsable reference page (`ApiReference` in @user-tasks/extension-sdk/ui)
 * or exports as an OpenAPI 3.0 document (toOpenApiDocument), so the same
 * reference feeds the page, API clients and SDK generators.
 *
 * Client-safe and dependency-free.
 */

export type ApiReferenceType = 'string' | 'text' | 'number' | 'integer' | 'boolean' | 'date' | 'datetime' | 'object' | 'array' | 'file' | 'json'

export interface ApiReferenceField {
  name: string
  type: ApiReferenceType
  /** Shown beside the type, e.g. "Choice", "Person or group", "Lookup → Departments". */
  format?: string
  required?: boolean
  readOnly?: boolean
  description?: string
  enum?: string[]
  /** Element type of an array. */
  items?: ApiReferenceType
  example?: unknown
}

export interface ApiReferenceSchema {
  name: string
  description?: string
  fields: ApiReferenceField[]
}

export interface ApiReferenceParam {
  name: string
  in: 'path' | 'query' | 'header' | 'body'
  type: ApiReferenceType
  required?: boolean
  description?: string
  enum?: string[]
  example?: unknown
}

export interface ApiReferenceOperation {
  /** Stable id (OpenAPI operationId). */
  id: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Path relative to the reference's base URL, OpenAPI style: `/items/{id}`. */
  path: string
  summary: string
  description?: string
  params?: ApiReferenceParam[]
  /** Name of a schema in `schemas` describing the JSON body. */
  requestSchema?: string
  requestExample?: unknown
  /** Name of a schema in `schemas` describing the response data. */
  responseSchema?: string
  responseExample?: unknown
  /** Where else the operation is available, e.g. { label: 'Workflow step', value: 'Orders → Get order' }. */
  availableAs?: Array<{ label: string; value: string }>
  notes?: string[]
  deprecated?: boolean
}

export interface ApiReferenceGroup {
  id: string
  title: string
  description?: string
  operations: ApiReferenceOperation[]
}

export interface ApiReferenceDoc {
  title: string
  description?: string
  version?: string
  /** Absolute base URL the operation paths are relative to. */
  baseUrl?: string
  /** Facts shown at the top (label / value). */
  meta?: Array<{ label: string; value: string }>
  /** Shown as warnings at the top (e.g. schema drift). */
  warnings?: string[]
  /** How to authenticate, shown above the operations. */
  auth?: string
  groups: ApiReferenceGroup[]
  schemas?: ApiReferenceSchema[]
}

const OPENAPI_TYPE: Record<ApiReferenceType, Record<string, unknown>> = {
  string: { type: 'string' },
  text: { type: 'string' },
  number: { type: 'number' },
  integer: { type: 'integer' },
  boolean: { type: 'boolean' },
  date: { type: 'string', format: 'date' },
  datetime: { type: 'string', format: 'date-time' },
  object: { type: 'object' },
  array: { type: 'array', items: {} },
  file: { type: 'string', format: 'binary' },
  json: {},
}

function schemaOf(type: ApiReferenceType, extra: { enum?: string[]; items?: ApiReferenceType; description?: string; readOnly?: boolean; example?: unknown } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...OPENAPI_TYPE[type] }
  if (type === 'array') out.items = extra.items ? { ...OPENAPI_TYPE[extra.items] } : {}
  if (extra.enum?.length) {
    if (type === 'array') out.items = { ...(out.items as Record<string, unknown>), enum: extra.enum }
    else out.enum = extra.enum
  }
  if (extra.description) out.description = extra.description
  if (extra.readOnly) out.readOnly = true
  if (extra.example !== undefined) out.example = extra.example
  return out
}

/** OpenAPI component names: letters, digits, `.`, `-`, `_`. */
export function openApiComponentName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'Schema'
}

/** The reference as an OpenAPI 3.0.3 document (for API clients, SDK generators and the explorer). */
export function toOpenApiDocument(doc: ApiReferenceDoc): Record<string, unknown> {
  const schemas: Record<string, unknown> = {}
  for (const schema of doc.schemas ?? []) {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const field of schema.fields) {
      properties[field.name] = schemaOf(field.type, { ...field, description: [field.format, field.description].filter(Boolean).join(' — ') || undefined })
      if (field.required && !field.readOnly) required.push(field.name)
    }
    schemas[openApiComponentName(schema.name)] = { type: 'object', ...(schema.description ? { description: schema.description } : {}), properties, ...(required.length ? { required } : {}) }
  }
  const paths: Record<string, Record<string, unknown>> = {}
  for (const group of doc.groups) {
    for (const op of group.operations) {
      const params = (op.params ?? []).filter((p) => p.in !== 'body').map((p) => ({
        name: p.name,
        in: p.in,
        required: p.in === 'path' ? true : Boolean(p.required),
        ...(p.description ? { description: p.description } : {}),
        schema: schemaOf(p.type, { enum: p.enum, example: p.example }),
      }))
      const bodyParams = (op.params ?? []).filter((p) => p.in === 'body')
      let requestBody: Record<string, unknown> | undefined
      if (op.requestSchema) {
        requestBody = { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${openApiComponentName(op.requestSchema)}` }, ...(op.requestExample !== undefined ? { example: op.requestExample } : {}) } } }
      } else if (bodyParams.length) {
        const properties = Object.fromEntries(bodyParams.map((p) => [p.name, schemaOf(p.type, { enum: p.enum, description: p.description, example: p.example })]))
        const required = bodyParams.filter((p) => p.required).map((p) => p.name)
        requestBody = { required: required.length > 0, content: { 'application/json': { schema: { type: 'object', properties, ...(required.length ? { required } : {}) }, ...(op.requestExample !== undefined ? { example: op.requestExample } : {}) } } }
      }
      const responseSchema = op.responseSchema ? { $ref: `#/components/schemas/${openApiComponentName(op.responseSchema)}` } : {}
      paths[op.path] ??= {}
      paths[op.path][op.method.toLowerCase()] = {
        operationId: op.id,
        summary: op.summary,
        ...(op.description ? { description: op.description } : {}),
        tags: [group.title],
        ...(op.deprecated ? { deprecated: true } : {}),
        ...(params.length ? { parameters: params } : {}),
        ...(requestBody ? { requestBody } : {}),
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: responseSchema, ...(op.responseExample !== undefined ? { example: op.responseExample } : {}) } } },
        },
      }
    }
  }
  return {
    openapi: '3.0.3',
    info: { title: doc.title, version: doc.version ?? '1.0.0', ...(doc.description ? { description: doc.description } : {}) },
    ...(doc.baseUrl ? { servers: [{ url: doc.baseUrl }] } : {}),
    tags: doc.groups.map((g) => ({ name: g.title, ...(g.description ? { description: g.description } : {}) })),
    paths,
    components: { schemas },
  }
}
