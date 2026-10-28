import { configuredAppUrl } from '@/lib/config/bootstrap'
import { getServiceDb } from '@/lib/providers/db'
import { isScimError, ScimError } from './errors'
import { getProp } from './filter'
import { parsePatchRequest } from './patch'
import { resourceTypes, schemas, serviceProviderConfig } from './schemas'
import * as store from './store'
import { authenticateScim, requireScimScope, type ScimAuth } from './tokens'

/* eslint-disable @typescript-eslint/no-explicit-any -- SCIM bodies are free-form JSON */

/**
 * The /scim/v2 endpoint (RFC 7644): one workspace per bearer token.
 *
 *   GET  /ServiceProviderConfig, /ResourceTypes[/id], /Schemas[/id]
 *   GET  /Users?filter=&startIndex=&count=&attributes=&excludedAttributes=
 *   POST /Users            GET|PUT|PATCH|DELETE /Users/{id}
 *   (the same for /Groups), POST /Users/.search, /Groups/.search, /.search
 *
 * Responses are application/scim+json; failures use the SCIM Error schema.
 * Single resources carry a weak ETag (meta.version) and PUT / PATCH / DELETE
 * honour If-Match. Bodies over 1 MB are refused.
 */

const CONTENT_TYPE = 'application/scim+json; charset=utf-8'
const MAX_BODY_BYTES = 1_000_000

function respond(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  if (body === undefined || status === 204) return new Response(null, { status, headers })
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': CONTENT_TYPE, 'Cache-Control': 'no-store', ...headers } })
}

function fromResult(result: store.ScimResult): Response {
  const headers: Record<string, string> = {}
  if (result.etag) headers.ETag = result.etag
  if (result.location) headers.Location = result.location
  return respond(result.status, result.body, headers)
}

export function scimBaseUrl(request: Request): string {
  const origin = (configuredAppUrl()?.trim() || new URL(request.url).origin).replace(/\/+$/, '')
  return `${origin}/scim/v2`
}

async function readJson(request: Request): Promise<Record<string, any>> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) throw new ScimError(413, 'Request body is too large', 'tooMany')
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) throw new ScimError(413, 'Request body is too large', 'tooMany')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw ScimError.badRequest('Request body is not valid JSON', 'invalidSyntax')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw ScimError.badRequest('Request body must be a JSON object', 'invalidSyntax')
  return body as Record<string, any>
}

function intParam(value: string | null | undefined, name: string): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) throw ScimError.badRequest(`${name} must be a number`)
  return n
}

function listParams(source: { get(name: string): string | null | undefined }): store.ListParams {
  const list = (value: string | null | undefined) => (value ? value.split(',').map((v) => v.trim()).filter(Boolean) : undefined)
  return {
    filter: source.get('filter') ?? null,
    startIndex: intParam(source.get('startIndex'), 'startIndex'),
    count: intParam(source.get('count'), 'count'),
    attributes: list(source.get('attributes')),
    excludedAttributes: list(source.get('excludedAttributes')),
  }
}

function searchParams(body: Record<string, any>): store.ListParams {
  const join = (value: unknown) => (Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : null)
  return listParams({
    get: (name) => {
      const value = getProp(body, name)
      if (name === 'attributes' || name === 'excludedAttributes') return join(value)
      return value === undefined || value === null ? null : String(value)
    },
  })
}

function methodNotAllowed(): never {
  throw new ScimError(405, 'Method not allowed')
}

type Kind = 'Users' | 'Groups'

async function handleResource(request: Request, auth: ScimAuth, ctx: store.ScimRequestContext, kind: Kind, id: string | undefined, extra: string[]): Promise<Response> {
  const type: store.ResourceType = kind === 'Users' ? 'User' : 'Group'
  const read = kind === 'Users' ? 'users:read' : 'groups:read'
  const write = kind === 'Users' ? 'users:write' : 'groups:write'
  const method = request.method.toUpperCase()
  const url = new URL(request.url)
  if (extra.length > 0) throw ScimError.notFound()

  if (id === '.search') {
    if (method !== 'POST') methodNotAllowed()
    requireScimScope(auth, read)
    return fromResult(await store.listResources(ctx, type, searchParams(await readJson(request))))
  }

  if (!id) {
    if (method === 'GET') {
      requireScimScope(auth, read)
      return fromResult(await store.listResources(ctx, type, listParams(url.searchParams)))
    }
    if (method === 'POST') {
      requireScimScope(auth, write)
      const body = await readJson(request)
      return fromResult(type === 'User' ? await store.createUser(ctx, body) : await store.createGroup(ctx, body))
    }
    methodNotAllowed()
  }

  const ifMatch = request.headers.get('if-match')
  switch (method) {
    case 'GET': {
      requireScimScope(auth, read)
      const result = await store.getResource(ctx, type, id, listParams(url.searchParams))
      const ifNoneMatch = request.headers.get('if-none-match')
      if (ifNoneMatch && result.etag && ifNoneMatch.split(',').map((t) => t.trim()).includes(result.etag)) return respond(304, undefined, { ETag: result.etag })
      return fromResult(result)
    }
    case 'PUT': {
      requireScimScope(auth, write)
      const body = await readJson(request)
      return fromResult(type === 'User' ? await store.replaceUser(ctx, id, body, ifMatch) : await store.replaceGroup(ctx, id, body, ifMatch))
    }
    case 'PATCH': {
      requireScimScope(auth, write)
      const operations = parsePatchRequest(await readJson(request))
      return fromResult(type === 'User'
        ? await store.patchUser(ctx, id, operations, ifMatch)
        : await store.patchGroup(ctx, id, operations, ifMatch, listParams(url.searchParams)))
    }
    case 'DELETE':
      requireScimScope(auth, write)
      return fromResult(type === 'User' ? await store.deleteUser(ctx, id, ifMatch) : await store.deleteGroup(ctx, id, ifMatch))
    default:
      methodNotAllowed()
  }
}

/** Handle one /scim/v2/<segments> request. */
export async function handleScimRequest(request: Request, segments: string[], deps: { db?: any } = {}): Promise<Response> {
  try {
    const db = deps.db ?? getServiceDb()
    const auth = await authenticateScim(db, request)
    const baseUrl = scimBaseUrl(request)
    const ctx: store.ScimRequestContext = {
      db,
      tenantId: auth.tenantId,
      tokenId: auth.tokenId,
      baseUrl,
      autoProvision: auth.autoProvision,
      syncGroups: auth.syncGroups,
    }
    const [head, id, ...extra] = segments.map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        throw ScimError.notFound()
      }
    })
    const method = request.method.toUpperCase()
    const docsUrl = `${baseUrl.replace(/\/scim\/v2$/, '')}/docs/governance/scim`

    switch ((head ?? '').toLowerCase()) {
      case 'serviceproviderconfig':
        if (method !== 'GET') methodNotAllowed()
        if (id) throw ScimError.notFound()
        return respond(200, serviceProviderConfig(baseUrl, docsUrl))
      case 'resourcetypes': {
        if (method !== 'GET') methodNotAllowed()
        const all = resourceTypes(baseUrl)
        if (!id) return respond(200, { schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: all.length, startIndex: 1, itemsPerPage: all.length, Resources: all })
        const found = all.find((r) => r.id.toLowerCase() === id.toLowerCase())
        if (!found) throw ScimError.notFound()
        return respond(200, found)
      }
      case 'schemas': {
        if (method !== 'GET') methodNotAllowed()
        const all = schemas(baseUrl)
        if (!id) return respond(200, { schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: all.length, startIndex: 1, itemsPerPage: all.length, Resources: all })
        const found = all.find((s) => s.id.toLowerCase() === id.toLowerCase())
        if (!found) throw ScimError.notFound()
        return respond(200, found)
      }
      case 'users':
        return await handleResource(request, auth, ctx, 'Users', id, extra)
      case 'groups':
        return await handleResource(request, auth, ctx, 'Groups', id, extra)
      case '.search': {
        if (method !== 'POST') methodNotAllowed()
        // Root search across both types is not supported; ask for one.
        throw ScimError.badRequest('Search /Users/.search or /Groups/.search', 'invalidPath')
      }
      default:
        throw ScimError.notFound('Unknown SCIM endpoint')
    }
  } catch (error) {
    if (isScimError(error)) return respond(error.status, error.toJSON(), error.headers)
    console.error('[scim] request failed:', (error as Error)?.message ?? error)
    return respond(500, new ScimError(500, 'Internal error').toJSON())
  }
}
