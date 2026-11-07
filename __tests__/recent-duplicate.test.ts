import { describe, expect, it } from 'vitest'
import { DUPLICATE_WINDOW_MS, findRecentDuplicate } from '@/lib/recent-duplicate'

type Call = [string, ...unknown[]]

/** Records the query chain and resolves maybeSingle() with `result`. */
function fakeClient(result: { data: unknown; error: unknown } | (() => never)) {
  const calls: Call[] = []
  const chain: Record<string, (...args: unknown[]) => unknown> = {}
  for (const method of ['select', 'eq', 'is', 'gte', 'order', 'limit']) {
    chain[method] = (...args: unknown[]) => { calls.push([method, ...args]); return chain }
  }
  chain.maybeSingle = async () => {
    calls.push(['maybeSingle'])
    if (typeof result === 'function') return result()
    return result
  }
  return {
    calls,
    client: { from: (table: string) => { calls.push(['from', table]); return chain } },
  }
}

describe('findRecentDuplicate', () => {
  it('matches every column within the window, newest first', async () => {
    const { client, calls } = fakeClient({ data: { id: 'r1' }, error: null })
    const now = Date.parse('2026-10-30T12:00:30.000Z')
    const found = await findRecentDuplicate(client, 'reports', { tenant_id: 't1', created_by: 'u1', name: 'Q3' }, { now })
    expect(found).toEqual({ id: 'r1' })
    expect(calls).toEqual([
      ['from', 'reports'],
      ['select', 'id'],
      ['eq', 'tenant_id', 't1'],
      ['eq', 'created_by', 'u1'],
      ['eq', 'name', 'Q3'],
      ['gte', 'created_at', new Date(now - DUPLICATE_WINDOW_MS).toISOString()],
      ['order', 'created_at', { ascending: false }],
      ['limit', 1],
      ['maybeSingle'],
    ])
    expect(DUPLICATE_WINDOW_MS).toBe(30_000)
  })

  it('uses IS NULL for null values and skips undefined ones', async () => {
    const { client, calls } = fakeClient({ data: null, error: null })
    await findRecentDuplicate(client, 'tasks', { tenant_id: 't1', parent_task_id: null, skipped: undefined }, { select: 'id, title', windowMs: 5_000, now: 0 })
    expect(calls).toContainEqual(['select', 'id, title'])
    expect(calls).toContainEqual(['is', 'parent_task_id', null])
    expect(calls.some(([, col]) => col === 'skipped')).toBe(false)
    expect(calls).toContainEqual(['gte', 'created_at', new Date(-5_000).toISOString()])
  })

  it('returns null when nothing matches', async () => {
    const { client } = fakeClient({ data: null, error: null })
    await expect(findRecentDuplicate(client, 'teams', { tenant_id: 't1', name: 'Eng' })).resolves.toBeNull()
  })

  it('is best effort: a lookup error or a throwing client returns null (create proceeds)', async () => {
    const errored = fakeClient({ data: { id: 'x' }, error: { message: 'permission denied' } })
    await expect(findRecentDuplicate(errored.client, 'teams', { name: 'Eng' })).resolves.toBeNull()

    const throwing = fakeClient(() => { throw new Error('network') })
    await expect(findRecentDuplicate(throwing.client, 'teams', { name: 'Eng' })).resolves.toBeNull()

    await expect(findRecentDuplicate({ from: () => ({}) }, 'teams', { name: 'Eng' })).resolves.toBeNull()
  })
})
