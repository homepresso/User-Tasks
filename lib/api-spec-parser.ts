/**
 * Parses OpenAPI 2.0 (Swagger), OpenAPI 3.0/3.1, and Postman Collection v2.x
 * into a normalized integration + references structure.
 * Supports both JSON and YAML input.
 */

import YAML from 'yaml'
import { schemaFromJsonSchema, trimSample, type ResponseSchema } from './response-schema'

export interface ParsedIntegration {
  name: string
  description: string
  baseUrl: string
  authType: 'none' | 'api_key' | 'bearer' | 'basic' | 'oauth2'
  authConfig: Record<string, any>
  references: ParsedReference[]
}

export interface ParsedReference {
  name: string
  description: string
  method: string
  pathTemplate: string
  bodyTemplate: string
  inputs: { name: string; type: string; required: boolean; default_value: string; location: string }[]
  outputs: { name: string; path: string; type: string }[]
  /** The 2xx response model ($refs resolved) — what the workflow data picker browses. */
  responseSchema?: ResponseSchema
  headers: Record<string, string>
  tags: string[]
}

// ─── Detect format ───

export function detectFormat(content: string): 'openapi2' | 'openapi3' | 'postman' | 'unknown' {
  try {
    const data = parseContent(content)
    if (data.swagger && String(data.swagger).startsWith('2.')) return 'openapi2'
    if (data.openapi && (String(data.openapi).startsWith('3.0') || String(data.openapi).startsWith('3.1'))) return 'openapi3'
    if (data.info?.schema?.includes('postman') || data.collection) return 'postman'
    if (data.item && data.info) return 'postman'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

function parseContent(content: string): any {
  // Try JSON first, then YAML
  try {
    return JSON.parse(content)
  } catch {
    return YAML.parse(content)
  }
}

export function parseApiSpec(content: string): ParsedIntegration {
  const format = detectFormat(content)
  const data = parseContent(content)

  switch (format) {
    case 'openapi2': return parseSwagger2(data)
    case 'openapi3': return parseOpenApi3(data)
    case 'postman': return parsePostman(data)
    default: throw new Error('Unsupported format. Please provide OpenAPI 2.0/3.0 or Postman Collection v2.x in JSON or YAML.')
  }
}

// ─── OpenAPI 2.0 (Swagger) ───

function parseSwagger2(spec: any): ParsedIntegration {
  const scheme = spec.schemes?.[0] ?? 'https'
  const host = spec.host ?? 'localhost'
  const basePath = spec.basePath ?? ''
  const baseUrl = `${scheme}://${host}${basePath}`

  const auth = parseSwagger2Auth(spec.securityDefinitions ?? {})

  const references: ParsedReference[] = []
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods as Record<string, any>)) {
      if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
        references.push(parseSwagger2Operation(path, method.toUpperCase(), op, spec.definitions))
      }
    }
  }

  return {
    name: spec.info?.title ?? 'Imported API',
    description: spec.info?.description ?? '',
    baseUrl,
    ...auth,
    references,
  }
}

function parseSwagger2Auth(securityDefs: Record<string, any>): { authType: ParsedIntegration['authType']; authConfig: Record<string, any> } {
  const authHeaderKey = (Object.values(securityDefs) as any[])
    .find((d) => d.type === 'apiKey' && String(d.name ?? '').toLowerCase() === 'authorization')
  if (authHeaderKey) return { authType: 'bearer', authConfig: { token: '' } }
  for (const [, def] of Object.entries(securityDefs)) {
    const d = def as any
    if (d.type === 'apiKey') return { authType: 'api_key', authConfig: { key_name: d.name ?? 'X-API-Key', key_value: '' } }
    if (d.type === 'basic') return { authType: 'basic', authConfig: { username: '', password: '' } }
    if (d.type === 'oauth2') return { authType: 'oauth2', authConfig: { flow: d.flow, tokenUrl: d.tokenUrl, scopes: d.scopes } }
  }
  return { authType: 'none', authConfig: {} }
}

function parseSwagger2Operation(path: string, method: string, op: any, definitions?: any): ParsedReference {
  const params = (op.parameters ?? []) as any[]
  // Non-body params
  const inputs = params.filter((p: any) => p.in !== 'body').map((p: any) => ({
    name: p.name,
    type: mapSchemaType(p.type ?? p.schema?.type ?? 'string'),
    required: p.required ?? false,
    default_value: p.default != null ? String(p.default) : '',
    location: p.in ?? 'query', // path, query, header
  }))

  // Build path template with {{var}} syntax
  const pathTemplate = path.replace(/\{(\w+)\}/g, '{{$1}}')

  // Build body template and extract body fields as inputs
  let bodyTemplate = ''
  const bodyParam = params.find((p: any) => p.in === 'body')
  if (bodyParam?.schema) {
    const resolved = resolveSchema(bodyParam.schema, definitions)

    // Handle array body (e.g. type: array, items: $ref)
    if (resolved?.type === 'array' && resolved.items) {
      const itemSchema = resolveSchema(resolved.items, definitions)
      const itemProps = itemSchema?.properties ?? {}
      const requiredFields = itemSchema?.required ?? []
      bodyTemplate = buildBodyTemplate(resolved.items, definitions, true)
      for (const [name, prop] of Object.entries(itemProps)) {
        const resolvedProp = resolveSchema(prop, definitions) ?? prop
        inputs.push({
          name,
          type: mapSchemaType((resolvedProp as any).type ?? 'string'),
          required: requiredFields.includes(name),
          default_value: (resolvedProp as any).default != null ? String((resolvedProp as any).default) : '',
          location: 'body',
        })
      }
    } else {
      // Handle object body
      bodyTemplate = buildBodyTemplate(bodyParam.schema, definitions)
      const bodyProps = resolved?.properties ?? {}
      const requiredFields = resolved?.required ?? []
      for (const [name, prop] of Object.entries(bodyProps)) {
        const resolvedProp = resolveSchema(prop, definitions) ?? prop
        inputs.push({
          name,
          type: mapSchemaType((resolvedProp as any).type ?? 'string'),
          required: requiredFields.includes(name),
          default_value: (resolvedProp as any).default != null ? String((resolvedProp as any).default) : '',
          location: 'body',
        })
      }
    }
  }

  // Parse response outputs
  const outputs = parseResponseOutputs(op.responses, definitions)
  const responseSchema = parseResponseSchema(op.responses, definitions)

  const tags = op.tags ?? []
  const summary = op.summary ?? op.operationId ?? `${method} ${path}`

  return {
    name: summary,
    description: op.description ?? '',
    method,
    pathTemplate,
    bodyTemplate,
    inputs,
    outputs,
    ...(responseSchema ? { responseSchema } : {}),
    headers: {},
    tags,
  }
}

// ─── OpenAPI 3.0/3.1 ───

function parseOpenApi3(spec: any): ParsedIntegration {
  const servers = spec.servers ?? [{ url: 'https://api.example.com' }]
  const baseUrl = servers[0].url.replace(/\/$/, '')

  const auth = parseOpenApi3Auth(spec.components?.securitySchemes ?? {})

  const references: ParsedReference[] = []
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods as Record<string, any>)) {
      if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
        references.push(parseOpenApi3Operation(path, method.toUpperCase(), op, spec.components?.schemas))
      }
    }
  }

  return {
    name: spec.info?.title ?? 'Imported API',
    description: spec.info?.description ?? '',
    baseUrl,
    ...auth,
    references,
  }
}

function parseOpenApi3Auth(schemes: Record<string, any>): { authType: ParsedIntegration['authType']; authConfig: Record<string, any> } {
  const all = Object.values(schemes) as any[]
  // Bearer wins when a spec declares multiple schemes — and the common idiom
  // `type: apiKey, in: header, name: Authorization` IS a bearer token (sending
  // it raw produces "malformed Authorization header" 401s).
  const bearer = all.find((s) => s.type === 'http' && s.scheme === 'bearer')
    ?? all.find((s) => s.type === 'apiKey' && String(s.name ?? '').toLowerCase() === 'authorization')
  if (bearer) return { authType: 'bearer', authConfig: { token: '' } }
  for (const s of all) {
    if (s.type === 'apiKey') return { authType: 'api_key', authConfig: { key_name: s.name ?? 'X-API-Key', key_value: '' } }
    if (s.type === 'http' && s.scheme === 'basic') return { authType: 'basic', authConfig: { username: '', password: '' } }
    if (s.type === 'oauth2') return { authType: 'oauth2', authConfig: { flows: s.flows } }
  }
  return { authType: 'none', authConfig: {} }
}

function parseOpenApi3Operation(path: string, method: string, op: any, schemas?: any): ParsedReference {
  const params = (op.parameters ?? []) as any[]
  const inputs = params.map((p: any) => ({
    name: p.name,
    type: mapSchemaType(p.schema?.type ?? 'string'),
    required: p.required ?? false,
    default_value: p.schema?.default != null ? String(p.schema.default) : '',
    location: p.in ?? 'query',
  }))

  const pathTemplate = path.replace(/\{(\w+)\}/g, '{{$1}}')

  // Body from requestBody
  let bodyTemplate = ''
  const requestBody = op.requestBody
  if (requestBody) {
    const jsonContent = requestBody.content?.['application/json']
    if (jsonContent?.schema) {
      const resolvedBody = resolveSchema(jsonContent.schema, schemas)

      if (resolvedBody?.type === 'array' && resolvedBody.items) {
        // Array body — extract item properties
        const itemSchema = resolveSchema(resolvedBody.items, schemas)
        bodyTemplate = buildBodyTemplate(resolvedBody.items, schemas, true)
        const itemProps = itemSchema?.properties ?? {}
        const requiredFields = itemSchema?.required ?? []
        for (const [name, prop] of Object.entries(itemProps)) {
          const resolvedProp = resolveSchema(prop, schemas) ?? prop
          inputs.push({
            name,
            type: mapSchemaType((resolvedProp as any).type ?? 'string'),
            required: requiredFields.includes(name),
            default_value: (resolvedProp as any).default != null ? String((resolvedProp as any).default) : '',
            location: 'body',
          })
        }
      } else {
        // Object body
        bodyTemplate = buildBodyTemplate(jsonContent.schema, schemas)
        const bodyProps = resolvedBody?.properties ?? {}
        const requiredFields = resolvedBody?.required ?? []
        for (const [name, prop] of Object.entries(bodyProps)) {
          const resolvedProp = resolveSchema(prop, schemas) ?? prop
          inputs.push({
            name,
            type: mapSchemaType((resolvedProp as any).type ?? 'string'),
            required: requiredFields.includes(name),
            default_value: (resolvedProp as any).default != null ? String((resolvedProp as any).default) : '',
            location: 'body',
          })
        }
      }
    }
  }

  const outputs = parseResponseOutputs(op.responses, schemas)
  const responseSchema = parseResponseSchema(op.responses, schemas)
  const tags = op.tags ?? []
  const summary = op.summary ?? op.operationId ?? `${method} ${path}`

  return {
    name: summary,
    description: op.description ?? '',
    method,
    pathTemplate,
    bodyTemplate,
    inputs,
    outputs,
    ...(responseSchema ? { responseSchema } : {}),
    headers: {},
    tags,
  }
}

// ─── Postman Collection v2.x ───

function parsePostman(data: any): ParsedIntegration {
  const collection = data.collection ?? data
  const info = collection.info ?? {}

  // Extract auth from collection-level
  const auth = parsePostmanAuth(collection.auth)

  // Find base URL from first request
  let baseUrl = ''
  const references: ParsedReference[] = []

  function walkItems(items: any[], prefix: string = '') {
    for (const item of items) {
      if (item.item) {
        // Folder
        walkItems(item.item, prefix ? `${prefix}/${item.name}` : item.name)
      } else if (item.request) {
        const ref = parsePostmanRequest(item, prefix)
        if (!baseUrl && ref._baseUrl) baseUrl = ref._baseUrl
        references.push(ref)
      }
    }
  }

  walkItems(collection.item ?? [])

  return {
    name: info.name ?? 'Postman Import',
    description: info.description ?? '',
    baseUrl: baseUrl || 'https://api.example.com',
    ...auth,
    references,
  }
}

function parsePostmanAuth(auth: any): { authType: ParsedIntegration['authType']; authConfig: Record<string, any> } {
  if (!auth) return { authType: 'none', authConfig: {} }
  if (auth.type === 'apikey') {
    const kv = auth.apikey ?? []
    const key = kv.find((k: any) => k.key === 'key')?.value ?? ''
    const keyName = kv.find((k: any) => k.key === 'in')?.value === 'header'
      ? (kv.find((k: any) => k.key === 'key')?.value ?? 'X-API-Key')
      : 'X-API-Key'
    return { authType: 'api_key', authConfig: { key_name: keyName, key_value: key } }
  }
  if (auth.type === 'bearer') {
    const token = auth.bearer?.find((b: any) => b.key === 'token')?.value ?? ''
    return { authType: 'bearer', authConfig: { token } }
  }
  if (auth.type === 'basic') {
    const username = auth.basic?.find((b: any) => b.key === 'username')?.value ?? ''
    const password = auth.basic?.find((b: any) => b.key === 'password')?.value ?? ''
    return { authType: 'basic', authConfig: { username, password } }
  }
  return { authType: 'none', authConfig: {} }
}

function parsePostmanRequest(item: any, folder: string): ParsedReference & { _baseUrl?: string } {
  const req = item.request
  const method = (typeof req.method === 'string' ? req.method : 'GET').toUpperCase()
  const url = typeof req.url === 'string' ? req.url : req.url?.raw ?? ''

  // Parse URL to extract base and path
  let baseUrl = ''
  let pathTemplate = ''
  try {
    if (req.url?.host && req.url?.path) {
      baseUrl = `https://${req.url.host.join('.')}`
      pathTemplate = '/' + req.url.path.map((p: string) => p.startsWith(':') ? `{{${p.slice(1)}}}` : p).join('/')
    } else {
      const parsed = new URL(url.replace(/\{\{([^}]+)\}\}/g, '__$1__'))
      baseUrl = `${parsed.protocol}//${parsed.host}`
      pathTemplate = parsed.pathname.replace(/__([^_]+)__/g, '{{$1}}')
    }
  } catch {
    pathTemplate = url
  }

  // Inputs from URL variables, query params, and body
  const inputs: ParsedReference['inputs'] = []

  // Path variables
  if (req.url?.variable) {
    for (const v of req.url.variable) {
      inputs.push({ name: v.key, type: 'string', required: true, default_value: v.value ?? '', location: 'path' })
    }
  }

  // Query params
  if (req.url?.query) {
    for (const q of req.url.query) {
      if (q.disabled) continue
      inputs.push({ name: q.key, type: 'string', required: false, default_value: q.value ?? '', location: 'query' })
    }
  }

  // Body
  let bodyTemplate = ''
  if (req.body?.mode === 'raw' && req.body.raw) {
    bodyTemplate = req.body.raw
    // Try to extract fields from JSON body
    try {
      const bodyJson = JSON.parse(req.body.raw)
      for (const [key, val] of Object.entries(bodyJson)) {
        inputs.push({
          name: key,
          type: typeof val === 'number' ? 'number' : typeof val === 'boolean' ? 'boolean' : 'string',
          required: false,
          default_value: val != null ? String(val) : '',
          location: 'body',
        })
      }
    } catch { /* not JSON */ }
  }

  // Headers
  const headers: Record<string, string> = {}
  if (req.header) {
    for (const h of req.header) {
      if (!h.disabled && h.key && h.value) headers[h.key] = h.value
    }
  }

  const name = item.name ?? `${method} ${pathTemplate}`
  const description = typeof req.description === 'string' ? req.description : req.description?.content ?? ''

  return {
    name,
    description,
    method,
    pathTemplate,
    bodyTemplate,
    inputs,
    outputs: [{ name: 'response', path: '', type: 'object' }],
    headers,
    tags: folder ? [folder] : [],
    _baseUrl: baseUrl,
  }
}

// ─── Shared helpers ───

function resolveSchema(schema: any, definitions?: any, depth: number = 0): any {
  if (!schema || depth > 5) return null
  if (schema.$ref) {
    const refPath = schema.$ref.replace('#/definitions/', '').replace('#/components/schemas/', '')
    const resolved = definitions?.[refPath]
    return resolved ? resolveSchema(resolved, definitions, depth + 1) : null
  }
  // Merge allOf schemas
  if (schema.allOf) {
    const merged: any = { type: 'object', properties: {}, required: [] }
    for (const sub of schema.allOf) {
      const resolved = resolveSchema(sub, definitions, depth + 1)
      if (resolved?.properties) Object.assign(merged.properties, resolved.properties)
      if (resolved?.required) merged.required.push(...resolved.required)
    }
    return merged
  }
  return schema
}

function mapSchemaType(type: string): string {
  switch (type) {
    case 'integer': case 'number': case 'float': case 'double': return 'number'
    case 'boolean': return 'boolean'
    case 'array': return 'array'
    case 'object': return 'object'
    default: return 'string'
  }
}

function buildBodyTemplate(schema: any, definitions?: any, wrapInArray: boolean = false): string {
  const resolved = resolveSchema(schema, definitions)
  if (!resolved?.properties) return wrapInArray ? '[{}]' : '{}'
  const obj: Record<string, any> = {}
  for (const [key, prop] of Object.entries(resolved.properties)) {
    const resolvedProp = resolveSchema(prop, definitions) ?? prop
    const p = resolvedProp as any
    if (p.type === 'array') {
      obj[key] = [`{{${key}}}`]
    } else if (p.type === 'object' && p.properties) {
      const nested: Record<string, string> = {}
      for (const [nk] of Object.entries(p.properties)) {
        nested[nk] = `{{${key}.${nk}}}`
      }
      obj[key] = nested
    } else {
      obj[key] = `{{${key}}}`
    }
  }
  return wrapInArray ? JSON.stringify([obj], null, 2) : JSON.stringify(obj, null, 2)
}

function parseResponseOutputs(responses: any, definitions?: any): ParsedReference['outputs'] {
  if (!responses) return [{ name: 'response', path: '', type: 'object' }]

  const successResp = responses['200'] ?? responses['201'] ?? responses['default']
  if (!successResp) return [{ name: 'response', path: '', type: 'object' }]

  // OpenAPI 3.0
  const jsonContent = successResp.content?.['application/json']
  if (jsonContent?.schema) {
    return extractOutputsFromSchema(jsonContent.schema, definitions)
  }

  // Swagger 2.0
  if (successResp.schema) {
    return extractOutputsFromSchema(successResp.schema, definitions)
  }

  return [{ name: 'response', path: '', type: 'object' }]
}

function extractOutputsFromSchema(schema: any, definitions?: any): ParsedReference['outputs'] {
  const resolved = resolveSchema(schema, definitions)
  if (!resolved) return [{ name: 'response', path: '', type: 'object' }]

  // If it's an array, return as list
  if (resolved.type === 'array') {
    const itemSchema = resolveSchema(resolved.items, definitions)
    const outputs: ParsedReference['outputs'] = [
      { name: 'results', path: '', type: 'array' },
    ]
    if (itemSchema?.properties) {
      for (const [key, prop] of Object.entries(itemSchema.properties)) {
        outputs.push({ name: key, path: `[].${key}`, type: mapSchemaType((prop as any).type ?? 'string') })
      }
    }
    return outputs
  }

  // If it's an object with properties
  if (resolved.properties) {
    return Object.entries(resolved.properties).slice(0, 15).map(([key, prop]) => ({
      name: key,
      path: key,
      type: mapSchemaType((prop as any).type ?? 'string'),
    }))
  }

  return [{ name: 'response', path: '', type: 'object' }]
}

/**
 * The success response's model: the first 2xx (200, 201, other 2xx, then
 * default) with a JSON schema — OpenAPI 3 `content[*json*].schema` or
 * Swagger 2 `schema` — converted with every `$ref` resolved. A documented
 * example becomes the trimmed sample.
 */
export function parseResponseSchema(responses: any, definitions?: any): ResponseSchema | undefined {
  if (!responses || typeof responses !== 'object') return undefined
  const codes = Object.keys(responses)
  const ordered = [
    ...['200', '201', '202'].filter((code) => codes.includes(code)),
    ...codes.filter((code) => /^2\d\d$|^2XX$/i.test(code) && !['200', '201', '202'].includes(code)),
    ...(codes.includes('default') ? ['default'] : []),
  ]
  for (const code of ordered) {
    const response = responses[code]
    if (!response || typeof response !== 'object') continue
    let schema: any = null
    let example: unknown
    if (response.content && typeof response.content === 'object') {
      const mediaKey = Object.keys(response.content).find((key) => /json/i.test(key)) ?? Object.keys(response.content)[0]
      const media = mediaKey ? response.content[mediaKey] : null
      schema = media?.schema ?? null
      example = media?.example ?? (media?.examples ? (Object.values(media.examples)[0] as any)?.value : undefined)
    } else if (response.schema) {
      schema = response.schema
      example = response.examples ? Object.values(response.examples)[0] : undefined
    }
    if (!schema) continue
    const root = schemaFromJsonSchema(schema, definitions)
    if (root.type === 'any' && !root.fields) continue
    return {
      version: 1,
      source: 'openapi',
      root,
      ...(example !== undefined ? { sample: trimSample(example) } : {}),
    }
  }
  return undefined
}
