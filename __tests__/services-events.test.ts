import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { GET as listEventsRoute } from '@/app/api/v1/events/route'
import { GET as streamEventsRoute } from '@/app/api/v1/events/stream/route'
import { createEventStream, formatSseMessage } from '@/lib/log-export/sse'
import { createMcpServer } from '@/lib/mcp/server'
import type { ServiceContext } from '@/lib/services/context'
import {
  EVENT_COLUMNS,
  latestEventId,
  listEvents,
  resolveTimestamp,
  severitiesFrom,
  typeGlobToLike,
  typeMatchesGlob,
  type ListEventsResult,
} from '@/lib/services/events'
import { createMemorySupabase } from './fixtures/supabase-memory'

const T1 = 'tenant-1'
const T2 = 'tenant-2'
const WF = '11111111-1111-4111-8111-111111111111'
const RUN = '22222222-2222-4222-8222-222222222222'

let nextId = 1
function event(overrides: Record<string, unknown> = {}) {
  const id = nextId++
  return {
    id,
    tenant_id: T1,
    occurred_at: new Date(Date.UTC(2026, 9, 24, 12, 0, id)).toISOString(),
    type: 'workflow.run.completed',
    category: 'workflow',
    severity: 'info',
    message: `event ${id}`,
    source_table: 'workflow_runs',
    source_id: `src-${id}`,
    trace_id: null,
    run_id: null,
    workflow_id: null,
    task_id: null,
    actor_id: null,
    attributes: {},
    ...overrides,
  }
}

function seedEvents() {
  nextId = 1
  return [
    event({ workflow_id: WF, run_id: RUN }), // 1
    event({ type: 'workflow.step.log', severity: 'debug', workflow_id: WF, run_id: RUN }), // 2
    event({ type: 'integration.call', category: 'integration', severity: 'error' }), // 3
    event({ type: 'audit.workflow.update', category: 'audit' }), // 4
    event({ type: 'security.api_key.auth_failed', category: 'security', severity: 'warn' }), // 5
    event({ tenant_id: T2, type: 'workflow.run.failed', severity: 'error' }), // 6 (other tenant)
    event({ type: 'task.completed', category: 'task' }), // 7
    event({ type: 'workflow.run.sla_breached', severity: 'warn', workflow_id: WF }), // 8
  ]
}

function ctxWith(permissions: string[], supabase = createMemorySupabase({ event_stream: seedEvents() })): ServiceContext {
  return { supabase: supabase as unknown as ServiceContext['supabase'], tenantId: T1, actorId: null, permissions: new Set(permissions), authKind: 'api_key', source: 'api' }
}

const FULL = ['observability.view', 'settings.view']
const ids = (result: ListEventsResult) => result.events.map((e) => e.id)

// ─── Service ───

describe('listEvents', () => {
  it('requires observability.view', async () => {
    await expect(listEvents(ctxWith(['settings.view']))).rejects.toMatchObject({ status: 403, message: expect.stringContaining('observability.view') })
  })

  it('returns only the caller tenant, oldest first, without tenant_id', async () => {
    const result = await listEvents(ctxWith(FULL))
    expect(ids(result)).toEqual([1, 2, 3, 4, 5, 7, 8])
    expect(EVENT_COLUMNS).not.toContain('tenant_id')
    expect(result).toMatchObject({ has_more: false, next_cursor: '8' })
  })

  it('hides audit and security events without settings.view, and refuses them when asked for', async () => {
    const result = await listEvents(ctxWith(['observability.view']))
    expect(result.events.map((e) => e.category)).not.toContain('audit')
    expect(result.events.map((e) => e.category)).not.toContain('security')
    expect(ids(result)).toEqual([1, 2, 3, 7, 8])
    await expect(listEvents(ctxWith(['observability.view']), { categories: ['security'] })).rejects.toMatchObject({ status: 403, message: expect.stringContaining('settings.view') })
    await expect(listEvents(ctxWith(['observability.view']), { categories: ['workflow', 'audit'] })).rejects.toMatchObject({ status: 403 })
    expect(ids(await listEvents(ctxWith(FULL), { categories: ['audit', 'security'] }))).toEqual([4, 5])
  })

  it('pages by cursor with has_more and next_cursor', async () => {
    const ctx = ctxWith(FULL)
    const first = await listEvents(ctx, { limit: 3 })
    expect(ids(first)).toEqual([1, 2, 3])
    expect(first).toMatchObject({ has_more: true, next_cursor: '3' })
    const second = await listEvents(ctx, { after: first.next_cursor, limit: 3 })
    expect(ids(second)).toEqual([4, 5, 7])
    const third = await listEvents(ctx, { after: second.next_cursor, limit: 3 })
    expect(ids(third)).toEqual([8])
    expect(third.has_more).toBe(false)
    // Caught up: the cursor stays put so pollers can keep asking.
    expect(await listEvents(ctx, { after: '8' })).toEqual({ events: [], next_cursor: '8', has_more: false })
  })

  it('caps limit at 1000 and rejects a malformed cursor', async () => {
    const supabase = createMemorySupabase({ event_stream: seedEvents() })
    const limitSpy = vi.fn()
    const from = supabase.from
    supabase.from = ((table: string) => {
      const builder = from(table)
      const limit = builder.limit
      builder.limit = (n: number) => { limitSpy(n); return limit(n) }
      return builder
    }) as typeof supabase.from
    await listEvents(ctxWith(FULL, supabase), { limit: 5000 })
    expect(limitSpy).toHaveBeenCalledWith(1001)
    await expect(listEvents(ctxWith(FULL), { after: '1; drop table' })).rejects.toMatchObject({ status: 400 })
  })

  it('filters by category, type glob, minimum severity and ids', async () => {
    const ctx = ctxWith(FULL)
    expect(ids(await listEvents(ctx, { categories: ['integration', 'task'] }))).toEqual([3, 7])
    expect(ids(await listEvents(ctx, { types: ['workflow.*'] }))).toEqual([1, 2, 8])
    expect(ids(await listEvents(ctx, { types: ['workflow.run.sla_breached'] }))).toEqual([8])
    expect(ids(await listEvents(ctx, { min_severity: 'warn' }))).toEqual([3, 5, 8])
    expect(ids(await listEvents(ctx, { min_severity: 'error' }))).toEqual([3])
    expect(ids(await listEvents(ctx, { workflow_id: WF }))).toEqual([1, 2, 8])
    expect(ids(await listEvents(ctx, { run_id: RUN, min_severity: 'info' }))).toEqual([1])
    expect(ids(await listEvents(ctx, { since: '2026-10-24T12:00:05Z', until: '2026-10-24T12:00:07Z' }))).toEqual([5, 7])
  })

  it('validates filters', async () => {
    const ctx = ctxWith(FULL)
    await expect(listEvents(ctx, { categories: ['nope'] })).rejects.toMatchObject({ status: 400 })
    await expect(listEvents(ctx, { types: ['Workflow,run'] })).rejects.toMatchObject({ status: 400 })
    await expect(listEvents(ctx, { min_severity: 'fatal' })).rejects.toMatchObject({ status: 400 })
    await expect(listEvents(ctx, { workflow_id: 'not-a-uuid' })).rejects.toMatchObject({ status: 400 })
    await expect(listEvents(ctx, { since: 'yesterday-ish' })).rejects.toMatchObject({ status: 400 })
  })

  it('latestEventId is per tenant', async () => {
    expect(await latestEventId(ctxWith(FULL))).toBe(8)
    expect(await latestEventId({ ...ctxWith(FULL), tenantId: T2 })).toBe(6)
    expect(await latestEventId({ ...ctxWith(FULL), tenantId: 'empty' })).toBe(0)
  })
})

describe('event filter helpers', () => {
  it('translates globs to LIKE and matches like SQL would', () => {
    expect(typeGlobToLike('workflow.*')).toBe('workflow.%')
    expect(typeGlobToLike('*.sla_breached')).toBe('%.sla\\_breached')
    expect(typeMatchesGlob('workflow.run.failed', 'workflow.*')).toBe(true)
    expect(typeMatchesGlob('workflow.run.failed', '*.failed')).toBe(true)
    expect(typeMatchesGlob('workflowXrun', 'workflow.run')).toBe(false)
  })

  it('resolves durations and severities', () => {
    const now = Date.parse('2026-10-24T12:00:00Z')
    expect(resolveTimestamp('15m', 'since', now)).toBe('2026-10-24T11:45:00.000Z')
    expect(resolveTimestamp('2d', 'since', now)).toBe('2026-10-22T12:00:00.000Z')
    expect(resolveTimestamp('2026-10-01T00:00:00Z', 'since', now)).toBe('2026-10-01T00:00:00.000Z')
    expect(severitiesFrom('warn')).toEqual(['warn', 'error'])
    expect(severitiesFrom(undefined)).toHaveLength(4)
  })
})

describe('MCP events_list', () => {
  it('wraps the service with the same gating', async () => {
    const supabase = createMemorySupabase({ event_stream: seedEvents() })
    const call = async (permissions: string[], args: Record<string, unknown>) => {
      const server = createMcpServer({ tenantId: T1, supabase, permissions } as never)
      const result = await server.callTool('events_list', args)
      return { isError: Boolean((result as { isError?: boolean }).isError), text: (result as { content: Array<{ text: string }> }).content[0].text }
    }
    const ok = await call(['observability.view'], { type: 'workflow.*', limit: 2 })
    expect(ok.isError).toBe(false)
    expect(JSON.parse(ok.text)).toMatchObject({ has_more: true, next_cursor: '2' })
    expect((await call(['workflows.view'], {})).text).toContain('observability.view')
    expect((await call(['observability.view'], { category: 'audit' })).text).toContain('settings.view')
  })
})

// ─── SSE body ───

describe('createEventStream', () => {
  afterEach(() => vi.useRealTimers())

  async function readAll(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let text = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return text
      text += decoder.decode(value)
    }
  }

  const page = (events: Array<{ id: number; type: string }>, hasMore = false, after: string | null = null): ListEventsResult => ({
    events: events as unknown as ListEventsResult['events'],
    next_cursor: events.length ? String(events[events.length - 1].id) : after,
    has_more: hasMore,
  })

  it('frames events with id/event/data, follows has_more, then ends with a reconnect hint', async () => {
    vi.useFakeTimers()
    let clock = 0
    const calls: Array<string | null> = []
    const pages = [
      page([{ id: 11, type: 'workflow.run.started' }], true),
      page([{ id: 12, type: 'task.completed' }]),
    ]
    const stream = createEventStream({
      after: '10',
      maxMs: 3_000,
      pollMs: 1_000,
      now: () => clock,
      fetchPage: async (after) => {
        calls.push(after)
        return pages.shift() ?? page([], false, after)
      },
    })
    const done = readAll(stream)
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1_000)
      clock += 1_000
    }
    const text = await done
    expect(text.startsWith('retry: 2000\n: connected\n\n')).toBe(true)
    expect(text).toContain('id: 11\nevent: workflow.run.started\ndata: {"id":11,"type":"workflow.run.started"}\n\n')
    expect(text).toContain('id: 12\nevent: task.completed\n')
    expect(calls.slice(0, 3)).toEqual(['10', '11', '12'])
    expect(text.trimEnd().endsWith('id: 12\nevent: reconnect\ndata: {"after":"12"}')).toBe(true)
  })

  it('sends a heartbeat comment after 15s without output', async () => {
    vi.useFakeTimers()
    let clock = 0
    const controller = new AbortController()
    const stream = createEventStream({
      after: '5',
      maxMs: 60_000,
      now: () => clock,
      signal: controller.signal,
      fetchPage: async (after) => page([], false, after),
    })
    const done = readAll(stream)
    for (let i = 0; i < 16; i++) {
      clock += 1_000
      await vi.advanceTimersByTimeAsync(1_000)
    }
    controller.abort()
    await vi.advanceTimersByTimeAsync(1_000)
    const text = await done
    expect(text.match(/: heartbeat\n\n/g)).toHaveLength(1)
    expect(text).not.toContain('event: reconnect')
  })

  it('stops polling when the client disconnects', async () => {
    const controller = new AbortController()
    const fetchPage = vi.fn(async (after: string | null) => page([], false, after))
    const stream = createEventStream({ after: '1', maxMs: 60_000, pollMs: 5, signal: controller.signal, fetchPage })
    const done = readAll(stream)
    await new Promise((resolve) => setTimeout(resolve, 30))
    controller.abort()
    await done
    const callsAtAbort = fetchPage.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fetchPage.mock.calls.length).toBe(callsAtAbort)
  })

  it('splits multi-line data', () => {
    expect(formatSseMessage({ event: 'x', data: 'a\nb' })).toBe('event: x\ndata: a\ndata: b\n\n')
  })
})

// ─── Routes ───

const mockedValidate = vi.mocked(validateApiKey)

function authResult(permissions: string[], supabase = createMemorySupabase({ event_stream: seedEvents() })): ApiKeySuccessResult {
  return {
    success: true, tenantId: T1, keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
    scopes: { workflow_ids: [], table_ids: [] }, permissions,
    supabase: supabase as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
  }
}

const request = (url: string, headers: Record<string, string> = {}, signal?: AbortSignal) =>
  new NextRequest(`https://app.test/api/v1${url}`, { headers: { authorization: 'Bearer t', ...headers }, signal })

describe('GET /api/v1/events', () => {
  beforeEach(() => mockedValidate.mockReset())

  it('401 without a valid credential', async () => {
    mockedValidate.mockResolvedValue({ success: false, response: Response.json({ success: false, error: 'Unauthorized' }, { status: 401 }) } as never)
    expect((await listEventsRoute(request('/events'))).status).toBe(401)
  })

  it('403 without observability.view, and for audit without settings.view', async () => {
    mockedValidate.mockResolvedValue(authResult(['workflows.view']))
    expect((await listEventsRoute(request('/events'))).status).toBe(403)
    mockedValidate.mockResolvedValue(authResult(['observability.view']))
    const res = await listEventsRoute(request('/events?category=audit'))
    expect(res.status).toBe(403)
  })

  it('returns events, next_cursor and has_more', async () => {
    mockedValidate.mockResolvedValue(authResult(FULL))
    const res = await listEventsRoute(request('/events?type=workflow.*&severity=info&limit=2'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.events.map((e: { id: number }) => e.id)).toEqual([1, 8])
    expect(body.data).toMatchObject({ next_cursor: '8', has_more: false })
  })

  it('400 for a bad limit', async () => {
    mockedValidate.mockResolvedValue(authResult(FULL))
    expect((await listEventsRoute(request('/events?limit=5000'))).status).toBe(400)
  })
})

describe('GET /api/v1/events/stream', () => {
  beforeEach(() => mockedValidate.mockReset())

  it('401 / 403 before any stream starts', async () => {
    mockedValidate.mockResolvedValue({ success: false, response: Response.json({ success: false, error: 'Unauthorized' }, { status: 401 }) } as never)
    expect((await streamEventsRoute(request('/events/stream'))).status).toBe(401)
    mockedValidate.mockResolvedValue(authResult(['workflows.view']))
    expect((await streamEventsRoute(request('/events/stream'))).status).toBe(403)
    mockedValidate.mockResolvedValue(authResult(['observability.view']))
    expect((await streamEventsRoute(request('/events/stream?category=security'))).status).toBe(403)
    mockedValidate.mockResolvedValue(authResult(FULL))
    expect((await streamEventsRoute(request('/events/stream', { 'last-event-id': 'abc' }))).status).toBe(400)
  })

  async function firstChunks(res: Response, until: (text: string) => boolean) {
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    while (!until(text)) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value)
    }
    await reader.cancel()
    return text
  }

  it('streams SSE with the proxy-friendly headers and resumes after Last-Event-ID', async () => {
    mockedValidate.mockResolvedValue(authResult(FULL))
    const controller = new AbortController()
    const res = await streamEventsRoute(request('/events/stream', { 'last-event-id': '5' }, controller.signal))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(res.headers.get('cache-control')).toContain('no-cache')
    expect(res.headers.get('x-accel-buffering')).toBe('no')
    const text = await firstChunks(res, (t) => t.includes('id: 8\n'))
    controller.abort()
    expect(text).toContain('id: 7\nevent: task.completed\n')
    expect(text).not.toContain('id: 5\n')
    expect(text).not.toContain('id: 6\n') // other tenant
  })

  it('starts from now when there is no cursor or since', async () => {
    const supabase = createMemorySupabase({ event_stream: seedEvents() })
    mockedValidate.mockResolvedValue(authResult(FULL, supabase))
    const controller = new AbortController()
    const res = await streamEventsRoute(request('/events/stream', {}, controller.signal))
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let text = decoder.decode((await reader.read()).value)
    supabase.tables.event_stream.push(event({ id: 9, type: 'workflow.run.started' }))
    while (!text.includes('id: 9')) text += decoder.decode((await reader.read()).value)
    controller.abort()
    await reader.cancel()
    expect(text).not.toMatch(/id: [1-8]\n/)
    expect(text).toContain('id: 9\nevent: workflow.run.started\n')
  })
})
