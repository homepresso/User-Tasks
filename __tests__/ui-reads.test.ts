/**
 * Dashboard reads (providers phase 4): the /api/internal/read route, the
 * read runner (names, args, permissions, errors) and the browser batcher
 * (lib/server-read). Area reads have their own ui-reads-<area> tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const session = vi.hoisted(() => ({ ctx: null as any, error: null as any }))
vi.mock('@/lib/services/context', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/services/context')>()
  return {
    ...real,
    fromSession: async () => {
      if (session.error) throw session.error
      return session.ctx
    },
  }
})

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/internal/read/route'
import { runUiRead, UI_READS } from '@/lib/services/ui-reads'
import { ServiceError, type ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

function ctx(db: any, permissions: string[]): ServiceContext {
  return { db, supabase: db, tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(permissions), authKind: 'session', source: 'ui' }
}

function post(body: unknown, contentType = 'application/json') {
  return POST(new NextRequest('http://localhost/api/internal/read', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
}

const db = () => createMemorySupabase({
  agents: [
    { id: 'ag1', name: 'Helper', model: 'm', updated_at: '2026-10-02' },
    { id: 'ag2', name: 'Other', model: 'm', updated_at: '2026-10-03' },
  ],
  agent_runs: [
    { id: 'r1', agent_id: 'ag1', status: 'completed', total_tokens: 10, duration_ms: 100, created_at: '2026-10-01' },
    { id: 'r2', agent_id: 'ag1', status: 'failed', total_tokens: 5, duration_ms: 300, created_at: '2026-10-02' },
    { id: 'r3', agent_id: 'ag2', status: 'completed', total_tokens: 1, duration_ms: 1, created_at: '2026-10-02' },
  ],
})

describe('read runner', () => {
  it('runs a known read with valid args for a user holding its permission', async () => {
    // (The memory client doesn't project columns.)
    expect(await runUiRead(ctx(db(), ['agents.view']), { name: 'agents.meta', args: { id: 'ag1' } }))
      .toMatchObject({ ok: true, data: { id: 'ag1', name: 'Helper', model: 'm' } })
  })

  it('denies a user without the permission (403) and never runs the query', async () => {
    const memory = db()
    const from = vi.spyOn(memory, 'from')
    expect(await runUiRead(ctx(memory, ['tasks.view_own']), { name: 'agents.list' }))
      .toMatchObject({ ok: false, status: 403 })
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects unknown names (incl. prototype keys) and invalid args', async () => {
    expect(await runUiRead(ctx(db(), ['agents.view']), { name: 'agents.nope' })).toMatchObject({ ok: false, status: 404 })
    expect(await runUiRead(ctx(db(), ['agents.view']), { name: 'constructor' })).toMatchObject({ ok: false, status: 404 })
    expect(await runUiRead(ctx(db(), ['agents.view']), { name: 'agents.meta', args: { id: 5 } })).toMatchObject({ ok: false, status: 400 })
    expect(await runUiRead(ctx(db(), ['agents.view']), { name: 'agents.runs', args: { agentId: 'ag1', page: -1 } })).toMatchObject({ ok: false, status: 400 })
  })

  it('maps service errors to their status and database errors to 500 with the message', async () => {
    const failing: any = { from: () => { throw ServiceError.notFound('Agent not found') } }
    expect(await runUiRead(ctx(failing, ['agents.view']), { name: 'agents.list' })).toEqual({ ok: false, error: 'Agent not found', status: 404 })
    const broken = createMemorySupabase({})
    ;(broken as any).from = () => ({ select: () => ({ order: async () => ({ data: null, error: { message: 'relation missing' } }) }) })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await runUiRead(ctx(broken, ['agents.view']), { name: 'agents.list' })).toEqual({ ok: false, error: 'relation missing', status: 500 })
    spy.mockRestore()
  })

  it('agent run stats are computed server-side for that agent only', async () => {
    expect(await runUiRead(ctx(db(), ['agents.view']), { name: 'agents.runStats', args: { agentId: 'ag1' } }))
      .toEqual({ ok: true, data: { total: 2, completed: 1, failed: 1, totalTokens: 15, avgDuration: 200 } })
  })
})

describe('POST /api/internal/read', () => {
  beforeEach(() => { session.ctx = ctx(db(), ['agents.view']); session.error = null })

  it('answers a batch in request order, each read on its own', async () => {
    const res = await post({ reads: [{ name: 'agents.meta', args: { id: 'ag2' } }, { name: 'agents.nope' }] })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect((await res.json()).results).toMatchObject([
      { ok: true, data: { id: 'ag2', name: 'Other', model: 'm' } },
      { ok: false, error: "Unknown read 'agents.nope'", status: 404 },
    ])
  })

  it('401s without a session and 403s without a workspace', async () => {
    session.error = new ServiceError('unauthorized', 'Not authenticated')
    expect((await post({ reads: [{ name: 'agents.list' }] })).status).toBe(401)
    session.error = ServiceError.forbidden('No workspace selected')
    expect((await post({ reads: [{ name: 'agents.list' }] })).status).toBe(403)
  })

  it('accepts JSON only, and bounded batches', async () => {
    expect((await post('reads=1', 'application/x-www-form-urlencoded')).status).toBe(415)
    expect((await post('{not json')).status).toBe(400)
    expect((await post({ reads: [] })).status).toBe(400)
    expect((await post({ reads: Array.from({ length: 26 }, () => ({ name: 'agents.list' })) })).status).toBe(400)
  })
})

describe('serverRead batching (browser)', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('sends reads issued in the same tick as one request and resolves each', async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const { reads } = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ results: reads.map((r: any) => r.name === 'agents.list' ? { ok: true, data: [r.name] } : { ok: false, error: 'Forbidden', status: 403 }) }), { status: 200 })
    })
    const { serverRead, serverQuery } = await import('@/lib/server-read')
    const [a, b] = await Promise.all([serverRead('agents.list'), serverRead('agents.meta', { id: 'x' })])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/internal/read')
    expect(a).toEqual({ data: ['agents.list'], error: null })
    expect(b).toEqual({ data: null, error: { message: 'Forbidden', status: 403 } })
    await expect(serverQuery('agents.meta', { id: 'x' })).rejects.toThrow('Forbidden')
  })

  it('turns a failed request or network error into per-read errors (never rejects)', async () => {
    const { serverRead } = await import('@/lib/server-read')
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 }))
    expect(await serverRead('agents.list')).toEqual({ data: null, error: { message: 'Not authenticated', status: 401 } })
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await serverRead('agents.list')).toEqual({ data: null, error: { message: 'offline', status: 0 } })
  })
})

describe('read registry', () => {
  it('names are <area>.<read> and every read has an args schema', () => {
    for (const [name, def] of Object.entries(UI_READS)) {
      expect(name).toMatch(/^[a-z]+\.[a-zA-Z]+$/)
      expect(typeof (def as any).args?.safeParse).toBe('function')
    }
  })

  it('reads use the session client only (no service-role client: RLS stays the boundary)', () => {
    const dir = path.resolve(__dirname, '..', 'lib', 'services', 'ui-reads')
    const offenders = readdirSync(dir)
      .filter((f) => /getServiceDb|providers\/db['"]|supabase\/admin|serviceClient|asService/.test(readFileSync(path.join(dir, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})
