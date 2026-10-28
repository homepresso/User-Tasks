/**
 * Builds the OpenAPI 3.1 document for /api/v1 from the endpoint registry.
 *
 * Served at GET /api/v1/openapi.json and written to packages/sdk/openapi.json
 * by `npm run openapi:gen` (checked in; `npm run openapi:check` fails on drift).
 * Vendor extensions consumed by the SDK/CLI:
 *   - x-permission:     permission key the endpoint requires (null = any caller)
 *   - x-usertasks-cli:  { resource, verb, positional, listKey } command metadata
 *   - x-usertasks-envelope: false when the route returns a bare JSON body
 *   - x-usertasks-stream: true for Server-Sent Events endpoints
 *   - x-usertasks-async: true when `?async=true` / `Prefer: respond-async`
 *     returns 202 with a background job (GET /jobs/{id}, /jobs/{id}/result)
 *   - x-usertasks-download: true when the success response is a file
 */

import { z } from 'zod'
import { API_ENDPOINTS } from './index'
import { eventSchema } from './events'
import { acceptedJobResponse } from './jobs'
import type { EndpointDef } from './registry'

export const API_VERSION = '1.0.0'

type JsonSchema = Record<string, unknown>

function toSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const json = z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'draft-2020-12' }) as JsonSchema
  delete json.$schema
  return json
}

function toParameters(schema: z.ZodType | undefined, location: 'path' | 'query') {
  if (!schema) return []
  const json = toSchema(schema, 'input')
  const required = new Set((json.required as string[] | undefined) ?? [])
  return Object.entries((json.properties ?? {}) as Record<string, JsonSchema>).map(([name, propSchema]) => {
    const { description, ...rest } = propSchema
    return {
      name,
      in: location,
      required: location === 'path' ? true : required.has(name),
      ...(description ? { description } : {}),
      schema: rest,
    }
  })
}

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
})

function buildOperation(endpoint: EndpointDef) {
  const envelope = endpoint.envelope !== false
  const status = String(endpoint.successStatus ?? 200)
  const dataSchema = endpoint.response ? toSchema(endpoint.response, 'output') : {}
  const successSchema = envelope
    ? {
        type: 'object',
        required: ['success', 'data'],
        properties: { success: { type: 'boolean', const: true }, data: dataSchema },
      }
    : dataSchema

  const isPublic = endpoint.auth === 'none'
  const responses: Record<string, unknown> = {
    [status]: endpoint.stream
      ? { description: 'Event stream', content: { 'text/event-stream': { schema: { type: 'string' } } } }
      : endpoint.download
        ? { description: 'The file', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } }
        : { description: 'Success', content: { 'application/json': { schema: successSchema } } },
  }
  if (endpoint.async) {
    responses['202'] = {
      description: 'Accepted (async=true or Prefer: respond-async): a background job. Poll GET /jobs/{id}; the result is GET /jobs/{id}/result.',
      headers: { Location: { description: 'The job: /api/v1/jobs/{id}', schema: { type: 'string' } } },
      content: { 'application/json': { schema: { type: 'object', required: ['success', 'data'], properties: { success: { type: 'boolean', const: true }, data: toSchema(acceptedJobResponse, 'output') } } } },
    }
  }
  if (endpoint.body || endpoint.query || endpoint.params) responses['400'] = errorResponse('Validation failed')
  if (!isPublic) {
    responses['401'] = errorResponse('Missing, invalid or expired credential')
    responses['403'] = errorResponse('Credential lacks the required permission or resource scope')
  }
  if (endpoint.params) responses['404'] = errorResponse('Not found')

  const parameters: Array<Record<string, unknown>> = [...toParameters(endpoint.params, 'path'), ...toParameters(endpoint.query, 'query')]
  if (endpoint.async) {
    parameters.push(
      { name: 'async', in: 'query', required: false, description: 'true: run as a background job and return 202 with it (same as Prefer: respond-async)', schema: { type: 'string', enum: ['true', 'false'] } },
      { name: 'Prefer', in: 'header', required: false, description: 'respond-async: run as a background job (202)', schema: { type: 'string' } },
    )
  }

  return {
    operationId: endpoint.operationId,
    summary: endpoint.summary,
    ...(describe(endpoint) ? { description: describe(endpoint) } : {}),
    tags: endpoint.tags,
    ...(isPublic ? { security: [] } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(endpoint.body
      ? { requestBody: { required: true, content: requestContent(endpoint) } }
      : {}),
    responses,
    'x-permission': endpoint.permission,
    ...(envelope && !endpoint.stream && !endpoint.download ? {} : { 'x-usertasks-envelope': false }),
    ...(endpoint.stream ? { 'x-usertasks-stream': true } : {}),
    ...(endpoint.async ? { 'x-usertasks-async': true } : {}),
    ...(endpoint.download ? { 'x-usertasks-download': true } : {}),
    ...(endpoint.cli
      ? { 'x-usertasks-cli': { ...endpoint.cli, ...(endpoint.listKey ? { listKey: endpoint.listKey } : {}) } }
      : {}),
  }
}

/** JSON body, plus the multipart/form-data form when the endpoint accepts uploads. */
function requestContent(endpoint: EndpointDef): Record<string, unknown> {
  const json = toSchema(endpoint.body!, 'input')
  const content: Record<string, unknown> = { 'application/json': { schema: json } }
  if (endpoint.multipart) {
    const replaced = new Set(Object.values(endpoint.multipart.files).flatMap((f) => [f.name, f.content]))
    const properties: Record<string, unknown> = {}
    for (const [name, prop] of Object.entries((json.properties ?? {}) as Record<string, unknown>)) {
      if (!replaced.has(name)) properties[name] = prop
    }
    for (const field of Object.keys(endpoint.multipart.files)) properties[field] = { type: 'string', format: 'binary' }
    content['multipart/form-data'] = { schema: { type: 'object', properties, required: Object.keys(endpoint.multipart.files) } }
  }
  return content
}

const ROUND_TRIP_NOTE = 'The body may also be the matching GET response, edited: read-only fields are ignored and null for a field that cannot be null means unchanged.'

function describe(endpoint: EndpointDef): string | undefined {
  if (!endpoint.roundTrip) return endpoint.description
  return endpoint.description ? `${endpoint.description} ${ROUND_TRIP_NOTE}` : ROUND_TRIP_NOTE
}

export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const endpoint of API_ENDPOINTS) {
    const item = (paths[endpoint.path] ??= {})
    item[endpoint.method.toLowerCase()] = buildOperation(endpoint)
  }
  const tags = Array.from(new Set(API_ENDPOINTS.flatMap((endpoint) => endpoint.tags))).map((name) => ({ name }))

  return {
    openapi: '3.1.0',
    info: {
      title: 'UserTasks API',
      version: API_VERSION,
      description: 'Public REST API. Successful responses use the `{ success: true, data }` envelope unless marked `x-usertasks-envelope: false`; errors are `{ success: false, error, code?, details? }`. List endpoints accept `limit`/`offset`.',
      license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
    },
    servers: [{ url: '/api/v1' }],
    security: [{ bearerAuth: [] }],
    tags,
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'An API key, or an OAuth access token (uoa_…) issued by /api/oauth/token.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['success', 'error'],
          properties: {
            success: { type: 'boolean', const: false },
            error: { type: 'string' },
            code: { type: 'string', description: 'Machine-readable error code (newer endpoints)' },
            details: { description: 'Structured detail, e.g. validation issues' },
          },
        },
        Event: toSchema(eventSchema, 'output'),
      },
    },
  }
}

/** Canonical serialisation used for both the served and the checked-in file. */
export function serializeOpenApiDocument(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`
}
