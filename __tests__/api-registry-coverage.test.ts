import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { toRouteSegmentPath } from '@/lib/api-schemas/registry'
import { buildOpenApiDocument, serializeOpenApiDocument } from '@/lib/api-schemas/openapi'

const ROOT = join(__dirname, '..')
const V1_DIR = join(ROOT, 'app', 'api', 'v1')
const METHOD_EXPORT = /export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g

function findRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return findRouteFiles(full)
    return name === 'route.ts' ? [full] : []
  })
}

/** "METHOD /segment/[id]" for every exported handler under app/api/v1. */
function implementedOperations(): string[] {
  const ops: string[] = []
  for (const file of findRouteFiles(V1_DIR)) {
    const routeDir = relative(V1_DIR, join(file, '..')).split(sep).join('/')
    const routePath = `/${routeDir}`
    for (const match of readFileSync(file, 'utf8').matchAll(METHOD_EXPORT)) {
      ops.push(`${match[1]} ${routePath}`)
    }
  }
  return ops.sort()
}

describe('api endpoint registry', () => {
  it('registers every /api/v1 route handler and nothing else', () => {
    const registered = API_ENDPOINTS.map((endpoint) => `${endpoint.method} ${toRouteSegmentPath(endpoint.path)}`).sort()
    expect(registered).toEqual(implementedOperations())
  })

  it('has unique operation ids and method+path pairs', () => {
    const ids = API_ENDPOINTS.map((endpoint) => endpoint.operationId)
    expect(new Set(ids).size).toBe(ids.length)
    const keys = API_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('declares path params for every templated path segment', () => {
    for (const endpoint of API_ENDPOINTS) {
      const names = [...endpoint.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])
      const declared = endpoint.params ? Object.keys((endpoint.params as unknown as { shape?: object }).shape ?? {}) : []
      expect(declared.sort(), `${endpoint.method} ${endpoint.path}`).toEqual(names.sort())
    }
  })

  it('gives every list endpoint a listKey and unique CLI commands', () => {
    const commands = new Set<string>()
    for (const endpoint of API_ENDPOINTS) {
      if (endpoint.operationId.startsWith('list')) expect(endpoint.listKey, endpoint.operationId).toBeTruthy()
      if (!endpoint.cli) continue
      const command = `${endpoint.cli.resource} ${endpoint.cli.verb}`
      expect(commands.has(command), command).toBe(false)
      commands.add(command)
    }
  })
})

describe('openapi document', () => {
  it('builds a 3.1 document with the vendor extensions and bearer auth', () => {
    const doc = JSON.parse(JSON.stringify(buildOpenApiDocument()))
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' })

    const listWorkflows = doc.paths['/workflows'].get
    expect(listWorkflows['x-permission']).toBe('workflows.view')
    expect(listWorkflows['x-usertasks-cli']).toEqual({ resource: 'workflows', verb: 'list', listKey: 'workflows' })
    expect(listWorkflows.parameters.map((p: { name: string }) => p.name)).toEqual(expect.arrayContaining(['limit', 'offset', 'active']))

    const getWorkflow = doc.paths['/workflows/{id}'].get
    expect(getWorkflow.parameters.find((p: { name: string }) => p.name === 'id')).toMatchObject({ in: 'path', required: true })

    const start = doc.paths['/workflows/start'].post
    expect(start.requestBody.content['application/json'].schema.required).toEqual(['workflow_id'])

    expect(doc.paths['/openapi.json'].get.security).toEqual([])
    expect(doc.paths['/tasks/ingest'].post['x-usertasks-envelope']).toBe(false)
  })

  it('matches the checked-in packages/sdk/openapi.json (run `npm run openapi:gen`)', () => {
    expect(readFileSync(join(ROOT, 'packages', 'sdk', 'openapi.json'), 'utf8')).toBe(serializeOpenApiDocument())
  })
})
