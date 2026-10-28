import { describe, expect, it, vi } from 'vitest'
import { formatEventLine, pinTime } from '../src/commands/logs'
import { COMMAND_SPECS } from '../src/generated/commands'
import { harness, ok } from './helpers'

const env = { USERTASKS_URL: 'https://tasks.test', USERTASKS_API_KEY: 'ut_key' }
const encoder = new TextEncoder()

const ev = (id: number, type = 'workflow.run.completed', severity = 'info', message = `run ${id} done`) =>
  ({ id, type, severity, category: 'workflow', message, occurred_at: `2026-10-24T12:00:0${id}.000Z`, attributes: {} })

const frame = (e: ReturnType<typeof ev>) => `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`

/** Harness whose fetch serves SSE bodies; the last responder may abort the run. */
function tailHarness(bodies: Array<(controller: AbortController) => string[] | Response>, extraEnv: Record<string, string> = {}) {
  const h = harness({ env: { ...env, ...extraEnv } })
  const controller = new AbortController()
  const calls: Array<{ url: URL; headers: Record<string, string> }> = []
  h.io.signal = controller.signal
  h.io.fetch = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: new URL(String(input)), headers: (init.headers ?? {}) as Record<string, string> })
    const make = bodies[Math.min(calls.length - 1, bodies.length - 1)]
    const result = make(controller)
    if (result instanceof Response) return result
    return new Response(new ReadableStream({
      start(stream) {
        for (const chunk of result) stream.enqueue(encoder.encode(chunk))
        stream.close()
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }) as unknown as typeof fetch
  return { ...h, calls }
}

describe('usertasks logs tail', () => {
  it('prints `time severity type message` lines and reconnects with Last-Event-ID', async () => {
    const h = tailHarness([
      () => ['retry: 0\n\n', frame(ev(1)), frame(ev(2, 'workflow.step.log', 'warn', 'line one\nline two')), 'id: 2\nevent: reconnect\ndata: {"after":"2"}\n\n'],
      (controller) => {
        queueMicrotask(() => setTimeout(() => controller.abort(), 5))
        return [frame(ev(3, 'task.completed'))]
      },
    ])
    expect(await h.run('logs', 'tail', '--category', 'workflow,task', '--type', 'workflow.*', '--severity', 'info', '--workflow', 'wf-1')).toBe(0)
    expect(h.stdout().split('\n').filter(Boolean)).toEqual([
      '2026-10-24T12:00:01.000Z INFO  workflow.run.completed run 1 done',
      '2026-10-24T12:00:02.000Z WARN  workflow.step.log line one line two',
      '2026-10-24T12:00:03.000Z INFO  task.completed run 3 done',
    ])
    const first = h.calls[0]
    expect(first.url.pathname).toBe('/api/v1/events/stream')
    expect(Object.fromEntries(first.url.searchParams)).toEqual({ category: 'workflow,task', type: 'workflow.*', severity: 'info', workflow_id: 'wf-1' })
    expect(first.headers.Authorization).toBe('Bearer ut_key')
    expect(h.calls[1].headers['Last-Event-ID']).toBe('2')
  })

  it('writes NDJSON with -o json', async () => {
    const h = tailHarness([
      (controller) => {
        setTimeout(() => controller.abort(), 5)
        return [frame(ev(1)), frame(ev(2))]
      },
    ])
    expect(await h.run('logs', 'tail', '-o', 'json', '--since', '15m')).toBe(0)
    const lines = h.stdout().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    expect(lines.map((e) => e.id)).toEqual([1, 2])
    expect(h.calls[0].url.searchParams.get('since')).toBe('15m')
  })

  it('accepts -o text and exits 4 on a permission error', async () => {
    const h = tailHarness([() => new Response(JSON.stringify({ success: false, error: "Forbidden: this API key lacks the 'observability.view' permission", code: 'forbidden' }), { status: 403 })])
    expect(await h.run('logs', 'tail', '-o', 'text')).toBe(4)
    expect(h.stderr()).toContain('observability.view')
    expect(h.calls).toHaveLength(1)
  })
})

describe('usertasks logs export', () => {
  it('pages GET /events by cursor and writes NDJSON', async () => {
    const pages = [
      { events: [ev(1), ev(2)], next_cursor: '2', has_more: true },
      { events: [ev(3)], next_cursor: '3', has_more: false },
    ]
    let page = 0
    const h = harness({ env, responder: () => ok(pages[page++]) })
    expect(await h.run('logs', 'export', '--since', '2026-10-24T00:00:00Z', '--until', '2026-10-24T23:00:00Z', '--category', 'workflow')).toBe(0)
    expect(h.stdout().split('\n').filter(Boolean).map((line) => JSON.parse(line).id)).toEqual([1, 2, 3])
    expect(h.stderr()).toContain('Exported 3 events.')
    const [first, second] = h.requests
    expect(first.url.pathname).toBe('/api/v1/events')
    expect(Object.fromEntries(first.url.searchParams)).toEqual({ category: 'workflow', since: '2026-10-24T00:00:00Z', until: '2026-10-24T23:00:00Z', limit: '1000' })
    expect(second.url.searchParams.get('after')).toBe('2')
  })

  it('pins relative times once and requires --since or --after', async () => {
    const h = harness({ env, responder: () => ok({ events: [], next_cursor: null, has_more: false }) })
    expect(await h.run('logs', 'export', '--since', '1h')).toBe(0)
    const since = h.requests[0].url.searchParams.get('since')!
    expect(Math.abs(Date.parse(since) - (Date.now() - 3_600_000))).toBeLessThan(5_000)
    expect(await h.run('logs', 'export')).toBe(2)
  })
})

describe('events commands', () => {
  it('generates `events list` with --limit mapped to the cursor page size and no stream command', async () => {
    const list = COMMAND_SPECS.find((s) => s.operationId === 'listEvents')!
    expect(list).toMatchObject({ resource: 'events', verb: 'list', cursor: true, paginated: false })
    expect(list.query.map((q) => q.flag)).toContain('after')
    expect(list.query.map((q) => q.flag)).not.toContain('limit')
    expect(COMMAND_SPECS.find((s) => s.operationId === 'streamEvents')).toBeUndefined()

    const h = harness({ env, responder: () => ok({ events: [ev(5)], next_cursor: '5', has_more: false }) })
    expect(await h.run('events', 'list', '--type', 'workflow.*', '--after', '4', '--limit', '10', '-o', 'json')).toBe(0)
    expect(Object.fromEntries(h.requests[0].url.searchParams)).toEqual({ type: 'workflow.*', after: '4', limit: '10' })
  })

  it('formats helpers', () => {
    expect(pinTime('2026-01-01T00:00:00Z')).toBe('2026-01-01T00:00:00Z')
    expect(formatEventLine(ev(1, 'x.y', 'error', 'boom') as never)).toBe('2026-10-24T12:00:01.000Z ERROR x.y boom')
  })
})
