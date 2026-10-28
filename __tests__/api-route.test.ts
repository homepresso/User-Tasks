import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { apiRoute } from '@/lib/api/route'
import { defineEndpoint } from '@/lib/api-schemas/registry'
import { ServiceError, type ServiceContext } from '@/lib/services/context'
import { GET as getMe } from '@/app/api/v1/me/route'

const mockedValidate = vi.mocked(validateApiKey)

/** Chainable Supabase stub: `rows[table]` is what maybeSingle resolves with. */
function mockSupabase(rows: Record<string, unknown>): ApiKeySuccessResult['supabase'] {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      }
      return builder
    },
  } as unknown as ApiKeySuccessResult['supabase']
}

function authResult(overrides: Partial<ApiKeySuccessResult> = {}): ApiKeySuccessResult {
  return {
    success: true,
    tenantId: 'tenant-1',
    keyId: 'key-1',
    keyType: 'tenant',
    createdBy: 'creator-1',
    actingUserId: null,
    scopes: { workflow_ids: [], table_ids: [] },
    permissions: ['workflows.view'],
    supabase: mockSupabase({}),
    authKind: 'api_key',
    expiresAt: null,
    ...overrides,
  }
}

function request(url: string, init?: { method?: string; body?: string }) {
  return new NextRequest(`https://app.test${url}`, {
    method: init?.method ?? 'GET',
    headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
    body: init?.body,
  })
}

const routeContext = (params: Record<string, string>) => ({ params: Promise.resolve(params) })

const widgetEndpoint = defineEndpoint({
  method: 'POST', path: '/widgets/{id}', operationId: 'updateWidget', tags: ['Test'],
  summary: 'Test endpoint', permission: 'workflows.view',
  params: z.object({ id: z.string().uuid() }),
  query: z.object({ verbose: z.enum(['true', 'false']).optional() }),
  body: z.object({ name: z.string().min(1), count: z.number().int().default(1) }),
})

const WIDGET_ID = '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f'

beforeEach(() => {
  mockedValidate.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('apiRoute', () => {
  it('passes through the auth failure response (401)', async () => {
    mockedValidate.mockResolvedValue({ success: false, response: NextResponse.json({ success: false, error: 'Invalid API key' }, { status: 401 }) })
    const handler = vi.fn()
    const response = await apiRoute(widgetEndpoint, handler)(request(`/api/v1/widgets/${WIDGET_ID}`, { method: 'POST', body: '{}' }), routeContext({ id: WIDGET_ID }))
    expect(response.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 403 with code forbidden when the permission is missing', async () => {
    mockedValidate.mockResolvedValue(authResult({ permissions: ['tasks.view_all'] }))
    const handler = vi.fn()
    const response = await apiRoute(widgetEndpoint, handler)(request(`/api/v1/widgets/${WIDGET_ID}`, { method: 'POST', body: '{"name":"a"}' }), routeContext({ id: WIDGET_ID }))
    expect(response.status).toBe(403)
    const json = await response.json()
    expect(json).toMatchObject({ success: false, code: 'forbidden' })
    expect(json.error).toContain("'workflows.view'")
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 400 with zod details for invalid body, params and query', async () => {
    mockedValidate.mockResolvedValue(authResult())
    const handler = vi.fn()
    const route = apiRoute(widgetEndpoint, handler)

    const badBody = await route(request(`/api/v1/widgets/${WIDGET_ID}`, { method: 'POST', body: '{"name":""}' }), routeContext({ id: WIDGET_ID }))
    expect(badBody.status).toBe(400)
    const bodyJson = await badBody.json()
    expect(bodyJson.success).toBe(false)
    expect(bodyJson.code).toBe('validation_error')
    expect(bodyJson.error).toMatch(/^Validation failed: name:/)
    expect(bodyJson.details).toEqual([expect.objectContaining({ path: 'body.name' })])

    const badParams = await route(request('/api/v1/widgets/nope', { method: 'POST', body: '{"name":"a"}' }), routeContext({ id: 'nope' }))
    expect((await badParams.json()).details[0].path).toBe('params.id')

    const badQuery = await route(request(`/api/v1/widgets/${WIDGET_ID}?verbose=maybe`, { method: 'POST', body: '{"name":"a"}' }), routeContext({ id: WIDGET_ID }))
    expect((await badQuery.json()).details[0].path).toBe('query.verbose')

    const badJson = await route(request(`/api/v1/widgets/${WIDGET_ID}`, { method: 'POST', body: '{not json' }), routeContext({ id: WIDGET_ID }))
    expect(badJson.status).toBe(400)
    expect((await badJson.json()).code).toBe('invalid_json')

    expect(handler).not.toHaveBeenCalled()
  })

  it('maps ServiceError to its status and code', async () => {
    mockedValidate.mockResolvedValue(authResult())
    const route = apiRoute(widgetEndpoint, async () => { throw ServiceError.notFound('Widget not found') })
    const response = await route(request(`/api/v1/widgets/${WIDGET_ID}`, { method: 'POST', body: '{"name":"a"}' }), routeContext({ id: WIDGET_ID }))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ success: false, error: 'Widget not found', code: 'not_found' })
  })

  it('hides unexpected errors behind a generic 500', async () => {
    mockedValidate.mockResolvedValue(authResult())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const route = apiRoute(widgetEndpoint, async () => { throw new Error('db password is hunter2') })
    const response = await route(request(`/api/v1/widgets/${WIDGET_ID}`, { method: 'POST', body: '{"name":"a"}' }), routeContext({ id: WIDGET_ID }))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ success: false, error: 'Internal server error', code: 'internal' })
  })

  it('runs the handler with parsed input and a service context, then wraps the envelope', async () => {
    mockedValidate.mockResolvedValue(authResult({ actingUserId: 'user-9' }))
    const handler = vi.fn(async ({ params, query, body, ctx }: { params: { id: string }; query: { verbose?: string }; body: unknown; ctx: ServiceContext }) => ({ id: params.id, verbose: query.verbose, body, tenant: ctx.tenantId, actor: ctx.actorId, source: ctx.source }))
    const response = await apiRoute({ ...widgetEndpoint, successStatus: 201 }, handler)(
      request(`/api/v1/widgets/${WIDGET_ID}?verbose=true`, { method: 'POST', body: '{"name":"Gadget"}' }),
      routeContext({ id: WIDGET_ID }),
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      success: true,
      data: { id: WIDGET_ID, verbose: 'true', body: { name: 'Gadget', count: 1 }, tenant: 'tenant-1', actor: 'user-9', source: 'api' },
    })
  })
})

describe('GET /api/v1/me', () => {
  it('requires a credential', async () => {
    mockedValidate.mockResolvedValue({ success: false, response: NextResponse.json({ success: false, error: 'Missing Bearer token' }, { status: 401 }) })
    const response = await getMe(request('/api/v1/me'))
    expect(response.status).toBe(401)
  })

  it('describes a tenant API key', async () => {
    mockedValidate.mockResolvedValue(authResult({
      permissions: ['workflows.view', 'data.view'],
      scopes: { workflow_ids: ['wf-1'], table_ids: [] },
      expiresAt: '2027-01-01T00:00:00.000Z',
      supabase: mockSupabase({ tenants: { id: 'tenant-1', name: 'Acme', slug: 'acme' } }),
    }))
    const response = await getMe(request('/api/v1/me'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      data: {
        tenant: { id: 'tenant-1', name: 'Acme', slug: 'acme' },
        user: null,
        auth: { kind: 'api_key', key_type: 'tenant', oauth_scopes: null, expires_at: '2027-01-01T00:00:00.000Z' },
        permissions: ['data.view', 'workflows.view'],
        resource_scopes: { workflow_ids: ['wf-1'], table_ids: [] },
      },
    })
  })

  it('describes a user-bound OAuth token with scopes and expiry', async () => {
    mockedValidate.mockResolvedValue(authResult({
      keyType: 'user',
      actingUserId: 'user-1',
      authKind: 'oauth',
      oauthScopes: ['workflows:read'],
      expiresAt: '2026-10-23T10:00:00.000Z',
      supabase: mockSupabase({
        tenants: { id: 'tenant-1', name: 'Acme', slug: 'acme' },
        users: { id: 'user-1', email: 'ada@example.com' },
      }),
    }))
    const json = await (await getMe(request('/api/v1/me'))).json()
    expect(json.data.user).toEqual({ id: 'user-1', email: 'ada@example.com' })
    expect(json.data.auth).toEqual({ kind: 'oauth', key_type: 'user', oauth_scopes: ['workflows:read'], expires_at: '2026-10-23T10:00:00.000Z' })
  })
})

describe('service context', () => {
  it('gates MCP contexts only when a permission array is present (matches MCP authz)', async () => {
    const { fromMcpContext, hasPerm, requirePerm } = await import('@/lib/services/context')
    const ungated = fromMcpContext({ tenantId: 't', supabase: {} })
    expect(hasPerm(ungated, 'workflows.delete')).toBe(true)

    const gated = fromMcpContext({ tenantId: 't', supabase: {}, permissions: ['workflows.view'] })
    expect(hasPerm(gated, 'workflows.view')).toBe(true)
    expect(() => requirePerm(gated, 'workflows.delete')).toThrow(ServiceError)
  })

  it('attributes tenant API keys to no actor and user keys to their user', async () => {
    const { fromApiAuth } = await import('@/lib/services/context')
    expect(fromApiAuth(authResult()).actorId).toBeNull()
    expect(fromApiAuth(authResult({ keyType: 'user', actingUserId: 'u-1' })).actorId).toBe('u-1')
    expect(fromApiAuth(authResult({ authKind: 'oauth' })).authKind).toBe('oauth')
  })
})
