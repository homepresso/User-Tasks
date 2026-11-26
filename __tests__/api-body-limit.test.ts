/**
 * JSON body cap (lib/api/body-limit.ts) on /api/v1 (lib/api/route.ts) and
 * /api/mcp: API_MAX_BODY_BYTES, default 5 MiB, 413 above it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { apiRoute } from '@/lib/api/route'
import { apiMaxBodyBytes, apiMaxPackageBodyBytes, DEFAULT_API_MAX_BODY_BYTES, DEFAULT_API_MAX_PACKAGE_BODY_BYTES, isMcpPackageCall, readCappedBody } from '@/lib/api/body-limit'
import { API_ENDPOINTS } from '@/lib/api-schemas'
import { defineEndpoint } from '@/lib/api-schemas/registry'
import { POST as mcpPost } from '@/app/api/mcp/route'

const mockedValidate = vi.mocked(validateApiKey)

function authResult(): ApiKeySuccessResult {
  return {
    success: true, tenantId: 'tenant-1', keyId: 'key-1', keyType: 'tenant', createdBy: 'creator-1', actingUserId: null,
    scopes: { workflow_ids: [], table_ids: [] }, permissions: null as unknown as string[],
    supabase: {} as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
  } as ApiKeySuccessResult
}

const endpoint = defineEndpoint({
  method: 'POST', path: '/echo', operationId: 'echoTest', tags: ['Test'], summary: 'Echo', permission: null,
  body: z.object({ items: z.array(z.string()) }),
})

function post(url: string, body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new NextRequest(`https://app.test${url}`, {
    method: 'POST',
    headers: { authorization: 'Bearer test', 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body,
    duplex: 'half',
  } as ConstructorParameters<typeof NextRequest>[1])
}

beforeEach(() => { mockedValidate.mockReset(); mockedValidate.mockResolvedValue(authResult()) })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('apiMaxBodyBytes', () => {
  it('defaults to 5 MiB and reads API_MAX_BODY_BYTES', () => {
    expect(apiMaxBodyBytes({})).toBe(DEFAULT_API_MAX_BODY_BYTES)
    expect(DEFAULT_API_MAX_BODY_BYTES).toBe(5 * 1024 * 1024)
    expect(apiMaxBodyBytes({ API_MAX_BODY_BYTES: '1024' })).toBe(1024)
    for (const bad of ['0', '-5', 'lots', '1.5']) expect(apiMaxBodyBytes({ API_MAX_BODY_BYTES: bad })).toBe(DEFAULT_API_MAX_BODY_BYTES)
  })
})

describe('readCappedBody', () => {
  it('stops reading a stream that passes the cap (no Content-Length)', async () => {
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulled++; controller.enqueue(new Uint8Array(1000)); if (pulled > 1000) controller.close() },
    })
    const result = await readCappedBody(new Request('https://app.test/x', { method: 'POST', body: stream, duplex: 'half' } as RequestInit), 5000)
    expect(result).toEqual({ ok: false, reason: 'too_large' })
    expect(pulled).toBeLessThan(20)
  })

  it('refuses a declared Content-Length over the cap without reading', async () => {
    const req = new Request('https://app.test/x', { method: 'POST', body: 'x', headers: { 'content-length': '999999' } })
    expect(await readCappedBody(req, 10)).toEqual({ ok: false, reason: 'too_large' })
  })

  it('returns the text under the cap', async () => {
    expect(await readCappedBody(new Request('https://app.test/x', { method: 'POST', body: '{"a":"é"}' }), 100)).toMatchObject({ ok: true, text: '{"a":"é"}', size: 10 })
  })
})

describe('/api/v1 routes', () => {
  const handler = vi.fn(async ({ body }: { body: { items: string[] } }) => ({ count: body.items.length }))
  const route = apiRoute(endpoint, handler as never)

  it('answers 413 above API_MAX_BODY_BYTES, before validating', async () => {
    vi.stubEnv('API_MAX_BODY_BYTES', '2048')
    const res = await route(post('/api/v1/echo', JSON.stringify({ items: Array.from({ length: 5000 }, () => 0) })))
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ success: false, code: 'payload_too_large' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('accepts a body under the cap', async () => {
    vi.stubEnv('API_MAX_BODY_BYTES', '2048')
    const res = await route(post('/api/v1/echo', JSON.stringify({ items: ['a', 'b'] })))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, data: { count: 2 } })
  })

  it('still answers 400 for invalid JSON', async () => {
    const res = await route(post('/api/v1/echo', '{nope'))
    expect(res.status).toBe(400)
  })
})

describe('/api/mcp', () => {
  it('answers 413 (JSON-RPC error) above API_MAX_BODY_BYTES', async () => {
    vi.stubEnv('API_MAX_BODY_BYTES', '1024')
    const res = await mcpPost(post('/api/mcp', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(5000) } })))
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32600 } })
  })

  it('answers a JSON-RPC parse error for invalid JSON', async () => {
    const res = await mcpPost(post('/api/mcp', '{nope'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: -32700 } })
  })
})

describe('package-tier cap (API_MAX_PACKAGE_BODY_BYTES)', () => {
  it('defaults to 50 MB and reads the env', () => {
    expect(DEFAULT_API_MAX_PACKAGE_BODY_BYTES).toBe(50 * 1024 * 1024)
    expect(apiMaxPackageBodyBytes({})).toBe(DEFAULT_API_MAX_PACKAGE_BODY_BYTES)
    expect(apiMaxPackageBodyBytes({ API_MAX_PACKAGE_BODY_BYTES: '4096' })).toBe(4096)
    expect(apiMaxPackageBodyBytes({ API_MAX_PACKAGE_BODY_BYTES: 'x' })).toBe(DEFAULT_API_MAX_PACKAGE_BODY_BYTES)
  })

  it('applies to the endpoints that carry base64 packages / large documents (incl. data-table import, base64 from the CLI); uploads keep 5 MiB', () => {
    const tier = (op: string) => {
      const e = API_ENDPOINTS.find((x) => x.operationId === op)
      expect(e, op).toBeDefined()
      return e!.bodyLimit ?? 'default'
    }
    for (const op of ['analyzeImport', 'runImport', 'createFormControl', 'importFormControl', 'uploadWorkflowAction', 'importWorkflowActivity',
      'importOpenApiIntegration', 'inspectPackage', 'planPackageInstall', 'installPackage', 'upgradePackageInstall', 'importDataRows']) expect(tier(op), op).toBe('package')
    for (const op of ['uploadFile', 'addTaskAttachment', 'importInfoPathForm', 'createForm']) expect(tier(op), op).toBe('default')
  })

  const pkgEndpoint = defineEndpoint({
    method: 'POST', path: '/pkg', operationId: 'pkgTest', tags: ['Test'], summary: 'Package', permission: null, bodyLimit: 'package',
    body: z.object({ package_base64: z.string() }),
  })
  const pkgHandler = vi.fn(async () => ({ ok: true }))
  const pkgRoute = apiRoute(pkgEndpoint, pkgHandler as never)

  it('takes a package body over the default cap, up to the package cap', async () => {
    vi.stubEnv('API_MAX_BODY_BYTES', '1024')
    vi.stubEnv('API_MAX_PACKAGE_BODY_BYTES', '65536')
    const res = await pkgRoute(post('/api/v1/pkg', JSON.stringify({ package_base64: 'A'.repeat(10_000) })))
    expect(res.status).toBe(200)
  })

  it('413 above the package cap names API_MAX_PACKAGE_BODY_BYTES', async () => {
    vi.stubEnv('API_MAX_PACKAGE_BODY_BYTES', '4096')
    const res = await pkgRoute(post('/api/v1/pkg', JSON.stringify({ package_base64: 'A'.repeat(10_000) })))
    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json.code).toBe('payload_too_large')
    expect(json.error).toContain('API_MAX_PACKAGE_BODY_BYTES')
    expect(json.error).toContain('4 KB')
  })

  it('a default-cap endpoint with multipart says to use multipart upload for files over the cap', async () => {
    vi.stubEnv('API_MAX_BODY_BYTES', String(5 * 1024 * 1024))
    const upload = defineEndpoint({
      method: 'POST', path: '/up', operationId: 'upTest', tags: ['Test'], summary: 'Upload', permission: null,
      body: z.object({ file_name: z.string(), file_base64: z.string() }),
      multipart: { files: { file: { name: 'file_name', content: 'file_base64' } } },
    })
    const res = await apiRoute(upload, vi.fn() as never)(post('/api/v1/up', JSON.stringify({ file_name: 'a.csv', file_base64: 'A'.repeat(5 * 1024 * 1024 + 10) })))
    expect(res.status).toBe(413)
    expect((await res.json()).error).toMatch(/use multipart upload .* for files over 5 MB/)
  })
})

describe('/api/mcp package tools', () => {
  const call = (name: string, pad: number) => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { package_base64: 'A'.repeat(pad) } } })

  it('recognises package tool calls only', () => {
    expect(isMcpPackageCall(JSON.parse(call('packages_install', 1)))).toBe(true)
    expect(isMcpPackageCall(JSON.parse(call('data_rows_import', 1)))).toBe(true)
    expect(isMcpPackageCall(JSON.parse(call('tasks_list', 1)))).toBe(false)
    expect(isMcpPackageCall([JSON.parse(call('packages_install', 1)), JSON.parse(call('tasks_list', 1))])).toBe(false)
    expect(isMcpPackageCall({ method: 'tools/list' })).toBe(false)
  })

  it('a package tool call may exceed API_MAX_BODY_BYTES; other calls may not', async () => {
    vi.stubEnv('API_MAX_BODY_BYTES', '1024')
    vi.stubEnv('API_MAX_PACKAGE_BODY_BYTES', '65536')
    const other = await mcpPost(post('/api/mcp', call('tasks_list', 5000)))
    expect(other.status).toBe(413)
    const pkg = await mcpPost(post('/api/mcp', call('packages_install', 5000)))
    expect(pkg.status).not.toBe(413)
    const huge = await mcpPost(post('/api/mcp', call('packages_install', 70_000)))
    expect(huge.status).toBe(413)
  })
})
