/**
 * The shared multi-agent context (lib/agents/shared-context.ts), the run
 * blackboard (lib/agents/blackboard.ts) and the shared-fact tools
 * (read_shared_facts / write_shared_fact / wait_for_shared_fact).
 */
import { describe, expect, it } from 'vitest'
import { MAX_SHARED_MESSAGES, mergeAgentContexts, normalizeAgentContext } from '@/lib/agents/shared-context'
import { dbBlackboard, memoryBlackboard, readRunFacts } from '@/lib/agents/blackboard'
import { FACT_WAIT, runPureBuiltin, type BuiltinContext } from '@/lib/agents/tools'
import { createFakeSupabase } from './helpers/fake-supabase'

const TENANT = '0e000000-0000-4000-8000-00000000000a'
const OTHER = '0e000000-0000-4000-8000-00000000000b'
const RUN = '0e000000-0000-4000-8000-0000000000e1'

const msg = (id: string, content: string, timestamp: string, extra: Record<string, unknown> = {}) =>
  ({ id, role: 'assistant' as const, content, timestamp, ...extra })

describe('mergeAgentContexts', () => {
  it('keeps every agent\'s messages (union by id), ordered by time', () => {
    const shared = msg('m0', 'earlier step', '2026-11-14T10:00:00Z')
    const a = { messages: [shared, msg('a1', 'alpha', '2026-11-14T10:00:03Z', { branch: 'A' })], facts: {} }
    const b = { messages: [shared, msg('b1', 'beta', '2026-11-14T10:00:02Z', { branch: 'B' })], facts: {} }
    const merged = mergeAgentContexts(a, b)
    expect(merged.messages.map((m) => m.content)).toEqual(['earlier step', 'beta', 'alpha'])
    // Order does not depend on which copy is applied last.
    expect(mergeAgentContexts(b, a).messages.map((m) => m.content)).toEqual(['earlier step', 'beta', 'alpha'])
  })

  it('dedupes older messages without ids by content, author and time', () => {
    const old = { role: 'assistant' as const, content: 'hi', agent: 'X', timestamp: '2026-11-14T10:00:00Z' }
    const merged = mergeAgentContexts({ messages: [old], facts: {} }, { messages: [{ ...old }], facts: {} })
    expect(merged.messages).toHaveLength(1)
  })

  it('facts: last writer wins per key, with the writer recorded; other keys are all kept', () => {
    const a = { messages: [], facts: { x: 'from A', only_a: 1 }, fact_writers: { x: { agent: 'A', at: '2026-11-14T10:00:05Z' } } }
    const b = { messages: [], facts: { x: 'from B', only_b: 2 }, fact_writers: { x: { agent: 'B', at: '2026-11-14T10:00:01Z' } } }
    for (const merged of [mergeAgentContexts(a, b), mergeAgentContexts(b, a)]) {
      expect(merged.facts).toEqual({ x: 'from A', only_a: 1, only_b: 2 })
      expect(merged.fact_writers?.x.agent).toBe('A')
    }
  })

  it('facts without a write time: the incoming copy wins over them, but not over a timed write', () => {
    expect(mergeAgentContexts({ messages: [], facts: { x: 'set' } }, { messages: [], facts: { x: 'agent' }, fact_writers: { x: { at: '2026-11-14T10:00:00Z' } } }).facts.x).toBe('agent')
    expect(mergeAgentContexts({ messages: [], facts: { x: 'agent' }, fact_writers: { x: { at: '2026-11-14T10:00:00Z' } } }, { messages: [], facts: { x: 'set' } }).facts.x).toBe('agent')
    expect(mergeAgentContexts({ messages: [], facts: { x: 1 } }, { messages: [], facts: { x: 2 } }).facts.x).toBe(2)
  })

  it('tolerates malformed input and keeps at most MAX_SHARED_MESSAGES (the newest)', () => {
    expect(normalizeAgentContext('nope')).toEqual({ messages: [], facts: {} })
    const many = Array.from({ length: MAX_SHARED_MESSAGES + 5 }, (_, i) => msg(`m${i}`, `n${i}`, new Date(Date.UTC(2026, 10, 14, 10, 0, i)).toISOString()))
    const merged = mergeAgentContexts(null, { messages: many, facts: {} })
    expect(merged.messages).toHaveLength(MAX_SHARED_MESSAGES)
    expect(merged.messages.at(-1)?.content).toBe(`n${MAX_SHARED_MESSAGES + 4}`)
  })

  it('does not change its inputs', () => {
    const a = { messages: [msg('a', 'a', '2026-11-14T10:00:00Z')], facts: { k: 1 } }
    const copy = structuredClone(a)
    mergeAgentContexts(a, { messages: [msg('b', 'b', '2026-11-14T10:00:01Z')], facts: { k: 2 } })
    expect(a).toEqual(copy)
  })
})

describe('run blackboard', () => {
  it('upserts one row per (run, key), reads only its tenant\'s rows', async () => {
    const fake = createFakeSupabase({
      workflow_run_facts: [{ run_id: RUN, tenant_id: OTHER, key: 'leak', value: 'other tenant', written_by: {}, written_at: '2026-11-14T10:00:00Z' }],
    })
    const board = dbBlackboard(fake.client, TENANT, RUN)
    await board.write('x', 'one', { agent: 'A', node_id: 'a', branch: 'A', at: '2026-11-14T10:00:01Z' })
    await board.write('x', 'two', { agent: 'B', node_id: 'b', branch: 'B', at: '2026-11-14T10:00:02Z' })
    await board.write('y', 'why', { agent: 'B', at: '2026-11-14T10:00:03Z' })
    const rows = fake.tables.workflow_run_facts.filter((r) => r.tenant_id === TENANT)
    expect(rows).toHaveLength(2)
    const snap = await board.read()
    expect(snap.facts).toEqual({ x: 'two', y: 'why' })
    expect(snap.writers.x).toMatchObject({ agent: 'B', branch: 'B', at: '2026-11-14T10:00:02Z' })
    expect(board.shared).toBe(true)
  })

  it('falls back to memory (never fails the run) while the migration is not applied', async () => {
    const client = {
      from: () => {
        const q: any = {
          select: () => q, eq: () => q, limit: () => Promise.resolve({ data: null, error: { code: '42P01', message: 'relation "public.workflow_run_facts" does not exist' } }),
          upsert: () => Promise.resolve({ error: { code: '42P01', message: 'relation "public.workflow_run_facts" does not exist' } }),
        }
        return q
      },
    }
    const board = dbBlackboard(client as any, TENANT, RUN)
    await board.write('x', 1, { at: '2026-11-14T10:00:00Z' })
    expect((await board.read()).facts).toEqual({ x: 1 })
    expect(board.shared).toBe(false)
    expect(await readRunFacts(client as any, TENANT, RUN)).toEqual({ facts: {}, writers: {} })
  })
})

describe('shared-fact tools', () => {
  const context = (board = memoryBlackboard({}, {}, true)): BuiltinContext => ({ facts: {}, attachments: [], blackboard: board, writer: { agent: 'Agent a', node_id: 'a', branch: 'A' } })

  it('write_shared_fact writes through to the blackboard with its writer; read_shared_facts sees other agents\' writes', async () => {
    const fake = createFakeSupabase()
    const mine = context(dbBlackboard(fake.client, TENANT, RUN))
    const theirs: BuiltinContext = { facts: {}, attachments: [], blackboard: dbBlackboard(fake.client, TENANT, RUN), writer: { agent: 'Agent b', node_id: 'b', branch: 'B' } }
    expect(await runPureBuiltin('write_shared_fact', { key: 'a_says', value: 'hello' }, mine)).toMatchObject({ success: true, shared_live: true })
    const read = await runPureBuiltin('read_shared_facts', {}, theirs)
    expect(read).toEqual({ facts: { a_says: 'hello' }, written_by: { a_says: 'Agent a' } })
    expect(fake.tables.workflow_run_facts[0]).toMatchObject({ tenant_id: TENANT, run_id: RUN, key: 'a_says', written_by: { agent: 'Agent a', node_id: 'a', branch: 'A' } })
  })

  it('wait_for_shared_fact returns once another agent writes the key', async () => {
    const board = memoryBlackboard({}, {}, true)
    const waiter = context(board)
    const writer = context(board)
    setTimeout(() => { void runPureBuiltin('write_shared_fact', { key: 'ready', value: 'yes' }, writer) }, 50)
    const started = Date.now()
    const out = await runPureBuiltin('wait_for_shared_fact', { key: 'ready', timeout_seconds: 5 }, waiter)
    expect(out).toMatchObject({ found: true, value: 'yes' })
    expect(Date.now() - started).toBeLessThan(FACT_WAIT.pollMs + 400)
  })

  it('wait_for_shared_fact is bounded: by its timeout and by the agent\'s deadline', async () => {
    const started = Date.now()
    const out = await runPureBuiltin('wait_for_shared_fact', { key: 'never', timeout_seconds: 1 }, context())
    expect(out).toMatchObject({ found: false, key: 'never' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(950)
    expect(Date.now() - started).toBeLessThan(2_000)
    // Deadline already (nearly) reached: returns at once.
    const late = { ...context(), deadline: Date.now() + 1_000 }
    const t = Date.now()
    expect(await runPureBuiltin('wait_for_shared_fact', { key: 'never', timeout_seconds: 120 }, late)).toMatchObject({ found: false })
    expect(Date.now() - t).toBeLessThan(200)
    // No live blackboard (REST execute with shared_context): answers at once.
    const alone: BuiltinContext = { facts: {}, attachments: [] }
    const t2 = Date.now()
    expect(await runPureBuiltin('wait_for_shared_fact', { key: 'never', timeout_seconds: 60 }, alone)).toMatchObject({ found: false, waited_ms: 0 })
    expect(Date.now() - t2).toBeLessThan(100)
  })
})
