/**
 * Global fetch wrapper for in-process benchmarks: counts Supabase round trips
 * (by method + table/RPC), rows written, time spent waiting on the database,
 * external calls and queue kicks. supabase-js resolves the global fetch when a
 * client is created, so install this before the engine creates its clients.
 */

export interface FetchStats {
  /** All requests to the Supabase URL (REST, RPC, auth, storage). */
  dbRoundTrips: number
  /** Sum of request durations for Supabase calls (overlapping calls double count). */
  dbTimeMs: number
  /** e.g. "GET workflows", "POST workflow_logs", "RPC enqueue_workflow". */
  byOp: Record<string, number>
  /** Rows sent in POST/PATCH bodies to REST tables. */
  rowsWritten: number
  /** Requests to anything else (echo server, integrations). */
  externalCalls: number
  /** Requests to the app URL (kickQueueProcessor) — intercepted, never sent. */
  queueKicks: number
}

const emptyStats = (): FetchStats => ({ dbRoundTrips: 0, dbTimeMs: 0, byOp: {}, rowsWritten: 0, externalCalls: 0, queueKicks: 0 })

export class FetchCounter {
  private stats = emptyStats()
  private inflight = 0
  private readonly original: typeof fetch

  constructor(private readonly supabaseUrl: string, private readonly sinkOrigin: string) {
    this.original = globalThis.fetch
  }

  install(): void {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
      if (url.startsWith(this.sinkOrigin)) {
        this.stats.queueKicks++
        return new Response('{"processed":0}', { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const isDb = url.startsWith(this.supabaseUrl)
      if (!isDb) this.stats.externalCalls++
      else {
        this.stats.dbRoundTrips++
        const op = describeOp(url, method)
        this.stats.byOp[op] = (this.stats.byOp[op] ?? 0) + 1
        if ((method === 'POST' || method === 'PATCH') && url.includes('/rest/v1/') && !url.includes('/rest/v1/rpc/')) {
          this.stats.rowsWritten += countRows(init?.body)
        }
      }
      this.inflight++
      const started = performance.now()
      try {
        return await this.original(input, init)
      } finally {
        if (isDb) this.stats.dbTimeMs += performance.now() - started
        this.inflight--
      }
    }
  }

  uninstall(): void {
    globalThis.fetch = this.original
  }

  reset(): void {
    this.stats = emptyStats()
  }

  snapshot(): FetchStats {
    return { ...this.stats, byOp: { ...this.stats.byOp }, dbTimeMs: Math.round(this.stats.dbTimeMs) }
  }

  /** Resolve once no request has been in flight for `quietMs` (fire-and-forget writes settle). */
  async idle(quietMs = 150, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let quietSince = Date.now()
    while (Date.now() < deadline) {
      if (this.inflight > 0) quietSince = Date.now()
      else if (Date.now() - quietSince >= quietMs) return
      await new Promise((r) => setTimeout(r, 20))
    }
  }
}

function describeOp(url: string, method: string): string {
  const path = new URL(url).pathname
  const rpc = path.match(/\/rest\/v1\/rpc\/([^/?]+)/)
  if (rpc) return `RPC ${rpc[1]}`
  const table = path.match(/\/rest\/v1\/([^/?]+)/)
  if (table) return `${method} ${table[1]}`
  return `${method} ${path.split('/').slice(0, 3).join('/')}`
}

function countRows(body: unknown): number {
  if (typeof body !== 'string') return 1
  try {
    const parsed: unknown = JSON.parse(body)
    return Array.isArray(parsed) ? parsed.length : 1
  } catch {
    return 1
  }
}
