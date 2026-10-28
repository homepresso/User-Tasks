import type { z } from 'zod'
import type { UiReadName, UiReadResult, UiReads } from '@/lib/services/ui-reads'

/**
 * Browser side of the dashboard reads (providers phase 4). Client components
 * read data through these instead of querying the database:
 *
 *   const { data, error } = await serverRead('agents.get', { id })   // never throws
 *   queryFn: () => serverQuery('agents.list')                        // throws (React Query)
 *
 * Reads issued in the same tick are batched into one POST to
 * /api/internal/read (one session check server-side, and they run in
 * parallel there — server actions would run one at a time). Types come from
 * the read registry (lib/services/ui-reads); this module stays client-safe.
 */

export const MAX_READS_PER_BATCH = 25

export type ReadArgs<K extends UiReadName> = z.input<UiReads[K]['args']>
export type ReadData<K extends UiReadName> = Awaited<ReturnType<UiReads[K]['run']>>
type ArgsParam<K extends UiReadName> = undefined extends ReadArgs<K> ? [args?: ReadArgs<K>] : [args: ReadArgs<K>]

export interface ReadError { message: string; status: number }

interface Pending {
  name: string
  args: unknown
  resolve: (result: UiReadResult) => void
}

let queue: Pending[] = []
let scheduled = false

async function flush() {
  scheduled = false
  const batch = queue
  queue = []
  for (let i = 0; i < batch.length; i += MAX_READS_PER_BATCH) {
    void send(batch.slice(i, i + MAX_READS_PER_BATCH))
  }
}

async function send(batch: Pending[]) {
  let results: UiReadResult[]
  try {
    const res = await fetch('/api/internal/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ reads: batch.map(({ name, args }) => ({ name, args })) }),
    })
    const body = await res.json().catch(() => null) as { results?: UiReadResult[]; error?: string } | null
    if (!res.ok || !Array.isArray(body?.results)) {
      const failure: UiReadResult = { ok: false, error: body?.error ?? `Request failed (${res.status})`, status: res.status }
      results = batch.map(() => failure)
    } else {
      results = body.results
    }
  } catch (error) {
    const failure: UiReadResult = { ok: false, error: error instanceof Error ? error.message : 'Network error', status: 0 }
    results = batch.map(() => failure)
  }
  batch.forEach((pending, i) => pending.resolve(results[i] ?? { ok: false, error: 'Missing result', status: 500 }))
}

function enqueue(name: string, args: unknown): Promise<UiReadResult> {
  return new Promise((resolve) => {
    queue.push({ name, args, resolve })
    if (!scheduled) {
      scheduled = true
      setTimeout(flush, 0)
    }
  })
}

/** Run a named server read. Resolves `{ data, error }` like the query it replaces; never rejects. */
export async function serverRead<K extends UiReadName>(name: K, ...args: ArgsParam<K>): Promise<
  { data: ReadData<K>; error: null } | { data: null; error: ReadError }
> {
  const result = await enqueue(name, args[0])
  return result.ok
    ? { data: result.data as ReadData<K>, error: null }
    : { data: null, error: { message: result.error, status: result.status } }
}

/** Run a named server read; throws its error (React Query fetchers). */
export async function serverQuery<K extends UiReadName>(name: K, ...args: ArgsParam<K>): Promise<ReadData<K>> {
  const { data, error } = await serverRead(name, ...args)
  if (error) throw new Error(error.message)
  return data as ReadData<K>
}
