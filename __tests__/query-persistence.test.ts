import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { shouldPersistQuery } from '@/components/providers/query-provider'

/** Which React Query entries the sessionStorage persister may write. */

function queryWith(queryKey: unknown[], data: unknown, meta?: Record<string, unknown>) {
  const client = new QueryClient()
  client.setQueryData(queryKey, data)
  const query = client.getQueryCache().find({ queryKey })!
  if (meta) query.options.meta = meta
  return query
}

describe('shouldPersistQuery', () => {
  it('persists small successful queries', () => {
    expect(shouldPersistQuery(queryWith(['tasks', { status: ['todo'] }], [{ id: 't1' }]))).toBe(true)
  })

  it('skips report, run and trace queries', () => {
    expect(shouldPersistQuery(queryWith(['reports', 'workflows', 'hub'], { daily: [] }))).toBe(false)
    expect(shouldPersistQuery(queryWith(['workflow-runs-list', 'wf-1'], []))).toBe(false)
    expect(shouldPersistQuery(queryWith(['trace', 'tr-1'], []))).toBe(false)
  })

  it('skips oversized results and explicit opt-outs', () => {
    expect(shouldPersistQuery(queryWith(['workflow', 'wf-1'], { blob: 'x'.repeat(250_000) }))).toBe(false)
    expect(shouldPersistQuery(queryWith(['workflow', 'wf-2'], { ok: true }, { persist: false }))).toBe(false)
  })
})
