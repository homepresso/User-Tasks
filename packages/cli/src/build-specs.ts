/**
 * Pure transform: OpenAPI document → CLI command table. Used by
 * scripts/generate.ts and by the tests that check every operation with
 * `x-usertasks-cli` metadata becomes a command.
 */
import type { BodyFieldSpec, CommandSpec, QueryParamSpec } from './spec'

/** Flags owned by the root program; query params may not reuse them. */
export const GLOBAL_FLAGS = new Set(['profile', 'url', 'output', 'file', 'all', 'limit', 'offset', 'yes', 'quiet', 'debug', 'set', 'help', 'version'])
/** Pagination params mapped onto the global --limit / --offset flags. */
const PAGINATION = new Set(['limit', 'offset'])
const DESTRUCTIVE_VERBS = new Set(['delete', 'bulk-delete', 'revoke', 'rm', 'remove'])
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

type JsonSchema = Record<string, unknown>
interface Parameter { name: string; in: string; required?: boolean; description?: string; schema?: JsonSchema }
interface Operation {
  operationId: string
  summary?: string
  parameters?: Parameter[]
  requestBody?: { required?: boolean; content?: Record<string, { schema?: JsonSchema }> }
  'x-permission'?: string | null
  'x-usertasks-envelope'?: boolean
  'x-usertasks-stream'?: boolean
  'x-usertasks-async'?: boolean
  'x-usertasks-download'?: boolean
  'x-usertasks-cli'?: { resource: string; verb: string; positional?: string[]; listKey?: string }
}
export interface OpenApiDoc { paths: Record<string, Partial<Record<(typeof METHODS)[number], Operation>>> }

function typeOf(schema: JsonSchema | undefined): string | undefined {
  if (!schema) return undefined
  if (typeof schema.type === 'string') return schema.type
  if (Array.isArray(schema.type)) return schema.type.filter((t) => t !== 'null').join('|')
  if (Array.isArray(schema.enum)) return 'string'
  return undefined
}

function bodyFields(schema: JsonSchema | undefined): BodyFieldSpec[] {
  const properties = (schema?.properties ?? {}) as Record<string, JsonSchema>
  const required = new Set((schema?.required as string[] | undefined) ?? [])
  return Object.entries(properties).map(([name, prop]) => ({
    name,
    ...(typeOf(prop) ? { type: typeOf(prop) } : {}),
    required: required.has(name),
    ...(typeof prop.description === 'string' ? { description: prop.description } : {}),
  }))
}

export function buildCommandSpecs(doc: OpenApiDoc): CommandSpec[] {
  const specs: CommandSpec[] = []
  const seen = new Map<string, string>()

  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = item[method]
      const cli = op?.['x-usertasks-cli']
      // SSE endpoints and file downloads are hand-written commands
      // (`usertasks logs tail`, `usertasks jobs download`).
      if (!op || !cli || op['x-usertasks-stream'] || op['x-usertasks-download']) continue

      const key = `${cli.resource} ${cli.verb}`
      if (seen.has(key)) throw new Error(`Duplicate CLI command "${key}" (${seen.get(key)} and ${op.operationId})`)
      seen.set(key, op.operationId)

      const params = op.parameters ?? []
      const pathParams = params.filter((p) => p.in === 'path').map((p) => p.name)
      const positional = (cli.positional ?? []).filter((name) => pathParams.includes(name))
      // `async` is driven by --wait / --no-wait on async operations.
      const queryParams = params.filter((p) => p.in === 'query' && !(op['x-usertasks-async'] && p.name === 'async'))
      const paginated = PAGINATION.size === queryParams.filter((p) => PAGINATION.has(p.name)).length
      // Cursor-paged lists (`limit` + `after`, e.g. /events): `limit` is the global --limit.
      const cursor = !paginated && queryParams.some((p) => p.name === 'limit')

      const query: QueryParamSpec[] = queryParams
        .filter((p) => !(paginated && PAGINATION.has(p.name)) && !(cursor && p.name === 'limit'))
        .map((p) => {
          const flag = p.name.replace(/_/g, '-')
          if (GLOBAL_FLAGS.has(flag)) throw new Error(`${op.operationId}: query param "${p.name}" collides with a global CLI flag`)
          const enumValues = Array.isArray(p.schema?.enum) ? (p.schema.enum as unknown[]).map(String) : undefined
          return {
            name: p.name,
            flag,
            ...(p.description ? { description: p.description } : {}),
            required: Boolean(p.required),
            ...(typeOf(p.schema) ? { type: typeOf(p.schema) } : {}),
            ...(enumValues ? { enum: enumValues } : {}),
          }
        })

      const bodySchema = op.requestBody?.content?.['application/json']?.schema
      const fields = bodyFields(bodySchema)
      const bodyPositional = (cli.positional ?? []).filter((name) => !pathParams.includes(name) && fields.some((f) => f.name === name))
      const upper = method.toUpperCase() as CommandSpec['method']
      specs.push({
        operationId: op.operationId,
        method: upper,
        path,
        resource: cli.resource,
        verb: cli.verb,
        summary: op.summary ?? op.operationId,
        permission: op['x-permission'] ?? null,
        positional,
        ...(bodyPositional.length ? { bodyPositional } : {}),
        pathFlags: pathParams.filter((name) => !positional.includes(name)),
        query,
        body: op.requestBody ? { required: Boolean(op.requestBody.required), fields } : null,
        ...(cli.listKey ? { listKey: cli.listKey } : {}),
        paginated,
        ...(cursor ? { cursor: true } : {}),
        envelope: op['x-usertasks-envelope'] !== false,
        ...(op['x-usertasks-async'] ? { async: true } : {}),
        destructive: upper === 'DELETE' || DESTRUCTIVE_VERBS.has(cli.verb),
      })
    }
  }
  return specs
}
