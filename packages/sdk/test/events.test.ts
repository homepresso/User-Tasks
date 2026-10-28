import { describe, expect, it, vi } from 'vitest'
import { UsertasksApiError, apiKeyAuth, createClient, parseSse, type UsertasksEvent } from '../src'

const encoder = new TextEncoder()

/** A body that delivers `chunks` one by one (optionally never closing). */
function sseBody(chunks: string[], options: { keepOpen?: boolean } = {}): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      if (!options.keepOpen) controller.close()
    },
  })
}

async function collect<T>(iterable: AsyncIterable<T>, max = Infinity): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) {
    out.push(item)
    if (out.length >= max) break
  }
  return out
}

const ev = (id: number, type = 'workflow.run.completed') =>
  ({ id, type, occurred_at: '2026-10-24T12:00:00.000Z', severity: 'info', category: 'workflow', message: `m${id}` }) as unknown as UsertasksEvent

const frame = (e: UsertasksEvent) => `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`

describe('parseSse', () => {
  it('handles split chunks, CRLF, comments, multi-line data and retry', async () => {
    const body = sseBody([
      'retry: 1500\n: connected\n\n',
      'id: 7\nevent: workflow.run.started\nda',
      'ta: {"a":1}\r\n\r\n',
      ': heartbeat\n\n',
      'event: note\ndata: line 1\ndata: line 2\n\n',
      'data:no-space\n\n',
    ])
    const messages = await collect(parseSse(body))
    expect(messages).toEqual([
      { data: '', retry: 1500 },
      { id: '7', event: 'workflow.run.started', data: '{"a":1}' },
      { event: 'note', data: 'line 1\nline 2' },
      { data: 'no-space' },
    ])
  })

  it('drops an unterminated trailing block', async () => {
    expect(await collect(parseSse(sseBody(['data: complete\n\n', 'data: partial'])))).toEqual([{ data: 'complete' }])
  })
})

type Call = { url: URL; headers: Record<string, string> }

function streamingClient(responders: Array<(call: Call) => Response>) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: new URL(String(input)), headers: (init.headers ?? {}) as Record<string, string> }
    calls.push(call)
    const responder = responders[Math.min(calls.length - 1, responders.length - 1)]
    return responder(call)
  })
  const client = createClient({ baseUrl: 'https://tasks.example.com', auth: apiKeyAuth('ut_x'), fetch: fetchImpl as unknown as typeof fetch })
  return { client, calls }
}

const sse = (chunks: string[], keepOpen = false) =>
  new Response(sseBody(chunks, { keepOpen }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })

describe('client.events.stream', () => {
  it('yields events and reconnects with Last-Event-ID after the server hint, skipping replays', async () => {
    const { client, calls } = streamingClient([
      () => sse(['retry: 0\n\n', frame(ev(11)), frame(ev(12)), 'id: 12\nevent: reconnect\ndata: {"after":"12"}\n\n']),
      () => sse([frame(ev(12)), frame(ev(13, 'task.completed'))], true),
    ])
    const reasons: string[] = []
    const events = await collect(client.events.stream({ category: 'workflow', onReconnect: (info) => reasons.push(info.reason) }), 3)
    expect(events.map((e) => e.id)).toEqual([11, 12, 13])
    expect(reasons).toEqual(['server'])
    expect(calls[0].url.pathname).toBe('/api/v1/events/stream')
    expect(calls[0].url.searchParams.get('category')).toBe('workflow')
    expect(calls[0].headers.Accept).toBe('text/event-stream')
    expect(calls[0].headers['Last-Event-ID']).toBeUndefined()
    expect(calls[1].headers['Last-Event-ID']).toBe('12')
    expect(calls[1].url.searchParams.get('after')).toBe('12')
  })

  it('backs off and resumes after a dropped connection or 5xx', async () => {
    const { client, calls } = streamingClient([
      () => sse([frame(ev(1))]), // ends without a hint
      () => new Response('{"success":false,"error":"down"}', { status: 503 }),
      () => sse([frame(ev(2))], true),
    ])
    const delays: Array<[string, number]> = []
    const events = await collect(client.events.stream({
      since: '15m',
      reconnectDelayMs: 1,
      onReconnect: (info) => delays.push([info.reason, info.delayMs]),
    }), 2)
    expect(events.map((e) => e.id)).toEqual([1, 2])
    expect(delays.map(([reason]) => reason)).toEqual(['ended', 'error'])
    expect(calls[0].url.searchParams.get('since')).toBe('15m')
    expect(calls[1].url.searchParams.get('since')).toBeNull()
    expect(calls[2].headers['Last-Event-ID']).toBe('1')
  })

  it('does not retry 4xx (auth, permission, validation)', async () => {
    const { client, calls } = streamingClient([
      () => new Response(JSON.stringify({ success: false, error: 'Forbidden', code: 'forbidden' }), { status: 403 }),
    ])
    await expect(collect(client.events.stream())).rejects.toBeInstanceOf(UsertasksApiError)
    expect(calls).toHaveLength(1)
  })

  it('stops when the signal aborts', async () => {
    const controller = new AbortController()
    const { client } = streamingClient([() => sse([frame(ev(1))], true)])
    const seen: number[] = []
    for await (const event of client.events.stream({ signal: controller.signal })) {
      seen.push(event.id)
      controller.abort()
    }
    expect(seen).toEqual([1])
  })
})

describe('client.events.list / iterate', () => {
  it('follows next_cursor until has_more is false', async () => {
    const pages = [
      { events: [ev(1), ev(2)], next_cursor: '2', has_more: true },
      { events: [ev(3)], next_cursor: '3', has_more: false },
    ]
    const { client, calls } = streamingClient([
      () => Response.json({ success: true, data: pages[0] }),
      () => Response.json({ success: true, data: pages[1] }),
    ])
    const events = await collect(client.events.iterate({ since: '1h', limit: 2 }))
    expect(events.map((e) => e.id)).toEqual([1, 2, 3])
    expect(calls[0].url.searchParams.get('after')).toBeNull()
    expect(calls[1].url.searchParams.get('after')).toBe('2')
    expect(calls[1].url.searchParams.get('since')).toBe('1h')
  })

  it('paginate() follows cursors too', async () => {
    const { client, calls } = streamingClient([
      () => Response.json({ success: true, data: { events: [ev(1)], next_cursor: '1', has_more: true } }),
      () => Response.json({ success: true, data: { events: [ev(2)], next_cursor: '2', has_more: false } }),
    ])
    const events = await collect(client.paginate('/events'))
    expect((events as UsertasksEvent[]).map((e) => e.id)).toEqual([1, 2])
    expect(calls[1].url.searchParams.get('after')).toBe('1')
    expect(calls[1].url.searchParams.get('offset')).toBeNull()
  })
})
