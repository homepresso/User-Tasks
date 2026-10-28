import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { evaluateCompletionRule, recordTaskResponse } from '@/lib/task-completion'

const r = (user: string, outcome: string) => ({ user_id: user, outcome })

describe('evaluateCompletionRule', () => {
  describe('first_response', () => {
    it('completes immediately with the latest outcome', () => {
      const result = evaluateCompletionRule({
        rule: 'first_response', responses: [r('u1', 'approve')], assigneeCount: 5, latestOutcome: 'approve', meta: {},
      })
      expect(result.isComplete).toBe(true)
      expect(result.winningOutcome).toBe('approve')
    })
  })

  describe('all_complete', () => {
    it('waits until everyone responds', () => {
      const result = evaluateCompletionRule({
        rule: 'all_complete', responses: [r('u1', 'approve')], assigneeCount: 3, latestOutcome: 'approve', meta: {},
      })
      expect(result.isComplete).toBe(false)
      expect(result.responseCount).toBe(1)
    })

    it('most common outcome wins when everyone responded', () => {
      const result = evaluateCompletionRule({
        rule: 'all_complete',
        responses: [r('u1', 'approve'), r('u2', 'reject'), r('u3', 'approve')],
        assigneeCount: 3, latestOutcome: 'reject', meta: {},
      })
      expect(result.isComplete).toBe(true)
      expect(result.winningOutcome).toBe('approve')
      expect(result.outcomeCounts).toEqual({ approve: 2, reject: 1 })
    })
  })

  describe('consensus', () => {
    it('completes once min_responses reached with a clear winner', () => {
      const result = evaluateCompletionRule({
        rule: 'consensus',
        responses: [r('u1', 'approve'), r('u2', 'approve')],
        assigneeCount: 5, latestOutcome: 'approve', meta: { min_responses: 2 },
      })
      expect(result.isComplete).toBe(true)
      expect(result.winningOutcome).toBe('approve')
    })

    it('keeps waiting on a tie until everyone voted', () => {
      const tied = evaluateCompletionRule({
        rule: 'consensus',
        responses: [r('u1', 'approve'), r('u2', 'reject')],
        assigneeCount: 4, latestOutcome: 'reject', meta: { min_responses: 2 },
      })
      expect(tied.isComplete).toBe(false)

      const allVoted = evaluateCompletionRule({
        rule: 'consensus',
        responses: [r('u1', 'approve'), r('u2', 'reject'), r('u3', 'approve'), r('u4', 'reject')],
        assigneeCount: 4, latestOutcome: 'reject', meta: { min_responses: 2 },
      })
      expect(allVoted.isComplete).toBe(true)
    })

    it('defaults min_responses to majority', () => {
      const result = evaluateCompletionRule({
        rule: 'consensus', responses: [r('u1', 'approve')], assigneeCount: 5, latestOutcome: 'approve', meta: {},
      })
      expect(result.isComplete).toBe(false) // needs ceil(5/2)=3
    })
  })

  describe('unanimous', () => {
    it('completes when everyone agrees', () => {
      const result = evaluateCompletionRule({
        rule: 'unanimous',
        responses: [r('u1', 'approve'), r('u2', 'approve')],
        assigneeCount: 2, latestOutcome: 'approve', meta: {},
      })
      expect(result.isComplete).toBe(true)
      expect(result.unanimousFailed).toBe(false)
    })

    it('flags unanimousFailed on disagreement but still completes with modal outcome', () => {
      const result = evaluateCompletionRule({
        rule: 'unanimous',
        responses: [r('u1', 'approve'), r('u2', 'approve'), r('u3', 'reject')],
        assigneeCount: 3, latestOutcome: 'reject', meta: {},
      })
      expect(result.isComplete).toBe(true)
      expect(result.unanimousFailed).toBe(true)
      expect(result.winningOutcome).toBe('approve')
    })

    it('waits for all responses', () => {
      const result = evaluateCompletionRule({
        rule: 'unanimous', responses: [r('u1', 'approve')], assigneeCount: 2, latestOutcome: 'approve', meta: {},
      })
      expect(result.isComplete).toBe(false)
    })
  })

  describe('custom (real expression evaluation — previously a stub)', () => {
    it('evaluates a threshold expression with response_count', () => {
      const meta = { custom_rule_expression: '{{=AND(response_count >= 2, true)}}' }
      const one = evaluateCompletionRule({
        rule: 'custom', responses: [r('u1', 'approve')], assigneeCount: 5, latestOutcome: 'approve', meta,
      })
      expect(one.isComplete).toBe(false)

      const two = evaluateCompletionRule({
        rule: 'custom', responses: [r('u1', 'approve'), r('u2', 'approve')], assigneeCount: 5, latestOutcome: 'approve', meta,
      })
      expect(two.isComplete).toBe(true)
    })

    it('exposes per-outcome outcome_<slug>_count variables', () => {
      const meta = { custom_rule_expression: '{{=GTE(outcome_approve_count, 2)}}' }
      const result = evaluateCompletionRule({
        rule: 'custom',
        responses: [r('u1', 'approve'), r('u2', 'approve'), r('u3', 'reject')],
        assigneeCount: 5, latestOutcome: 'reject', meta,
      })
      expect(result.isComplete).toBe(true)
    })

    it('resolves a custom outcome expression', () => {
      const meta = {
        custom_rule_expression: '{{=GTE(response_count, 1)}}',
        custom_rule_outcome: '{{=IF(GTE(outcome_approve_count, 1), "approved", "rejected")}}',
      }
      const result = evaluateCompletionRule({
        rule: 'custom', responses: [r('u1', 'approve')], assigneeCount: 3, latestOutcome: 'approve', meta,
      })
      expect(result.isComplete).toBe(true)
      expect(result.winningOutcome).toBe('approved')
    })

    it('empty expression falls back to all_complete semantics', () => {
      const partial = evaluateCompletionRule({
        rule: 'custom', responses: [r('u1', 'ok')], assigneeCount: 2, latestOutcome: 'ok', meta: {},
      })
      expect(partial.isComplete).toBe(false)

      const full = evaluateCompletionRule({
        rule: 'custom', responses: [r('u1', 'ok'), r('u2', 'ok')], assigneeCount: 2, latestOutcome: 'ok', meta: {},
      })
      expect(full.isComplete).toBe(true)
    })
  })

  it('unknown rules default to complete (back-compat)', () => {
    const result = evaluateCompletionRule({
      rule: 'whatever', responses: [], assigneeCount: 3, latestOutcome: 'done', meta: {},
    })
    expect(result.isComplete).toBe(true)
  })
})

describe('recordTaskResponse with field values', () => {
  type Row = Record<string, unknown>
  type Result = { data?: unknown; count?: number; error: null }
  interface MockBuilder {
    select: (cols?: string, o?: { head?: boolean }) => MockBuilder
    upsert: (row: Row) => MockBuilder
    insert: (row: Row) => MockBuilder
    update: (row: Row) => MockBuilder
    eq: () => MockBuilder
    in: () => MockBuilder
    maybeSingle: () => Promise<Result>
    then: (resolve: (v: Result) => void) => void
  }

  function makeSupabase(opts: { responses?: Array<{ user_id: string; outcome: string }>; collabCount?: number; members?: string[] } = {}) {
    const updates: Array<{ status?: string; metadata: { template_values: Row; fields?: unknown[] } }> = []
    const inserts: Array<{ table: string; row: Row }> = []
    const from = (table: string) => {
      let op = 'select'
      let head = false
      const builder: MockBuilder = {
        select: (_cols, o) => { if (o?.head) head = true; return builder },
        upsert: (row) => { op = 'upsert'; inserts.push({ table, row }); return builder },
        insert: (row) => { op = 'insert'; inserts.push({ table, row }); return builder },
        update: (row) => { op = 'update'; updates.push(row as (typeof updates)[number]); return builder },
        eq: () => builder,
        in: () => builder,
        maybeSingle: () => Promise.resolve({ data: { display_name: 'Pat' }, error: null }),
        then: (resolve) => {
          if (op !== 'select') return resolve({ data: null, error: null })
          if (table === 'task_responses') return resolve({ data: opts.responses ?? [{ user_id: 'u1', outcome: 'Approved' }], error: null })
          if (table === 'user_memberships') return resolve({ data: (opts.members ?? []).map((user_id) => ({ user_id })), error: null })
          if (head) return resolve({ count: table === 'task_assignees' ? (opts.collabCount ?? 0) : 1, error: null })
          return resolve({ data: [], error: null })
        },
      }
      return builder
    }
    return { supabase: { from } as unknown as SupabaseClient, updates, inserts }
  }

  const task = {
    id: 't1',
    tenant_id: 'ten1',
    metadata: {
      fields: [
        { key: 'amount', label: 'Amount', type: 'number', required: true },
        { key: 'category', label: 'Category', type: 'choice', options: ['A', 'B'] },
      ],
      template_values: { amount: null, category: 'A', legacy: 'x' },
    },
  }

  it('merges coerced values into template_values and exposes task_data', async () => {
    const { supabase, updates } = makeSupabase()
    const result = await recordTaskResponse({
      supabase, task, userId: 'u1', outcome: 'Approved', values: { amount: '250', category: 'B', ignored: 1 }, source: 'ui',
    })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.resume.task_data).toEqual({ amount: 250, category: 'B', legacy: 'x' })
    const completedUpdate = updates.find((u) => u.status === 'completed')
    expect(completedUpdate?.metadata.template_values).toEqual({ amount: 250, category: 'B', legacy: 'x' })
    expect(completedUpdate?.metadata.fields).toHaveLength(2)
  })

  it('rejects invalid values without recording a response', async () => {
    const { supabase, updates, inserts } = makeSupabase()
    const result = await recordTaskResponse({
      supabase, task, userId: 'u1', outcome: 'Approved', values: { category: 'C' }, source: 'api',
    })
    expect(result.status).toBe('invalid')
    if (result.status !== 'invalid') return
    expect(Object.keys(result.errors).sort()).toEqual(['amount', 'category'])
    expect(updates).toHaveLength(0)
    expect(inserts).toHaveLength(0)
  })

  it('stores values while waiting on other assignees (last responder wins)', async () => {
    const { supabase, updates } = makeSupabase({ collabCount: 3 })
    const result = await recordTaskResponse({
      supabase,
      task: { ...task, metadata: { ...task.metadata, completion_rule: 'all_complete' } },
      userId: 'u1', outcome: 'Approved', values: { amount: 10 }, source: 'ui',
    })
    expect(result.status).toBe('waiting')
    expect(updates[0].metadata.template_values.amount).toBe(10)
  })

  const typedTask = {
    id: 't3',
    tenant_id: 'ten1',
    metadata: {
      fields: [
        { key: 'total', label: 'Total', type: 'currency', required: true, max: 1000 },
        { key: 'tags', label: 'Tags', type: 'multi_choice', options: ['a', 'b'] },
        { key: 'when', label: 'When', type: 'datetime' },
        { key: 'owner', label: 'Owner', type: 'user' },
        { key: 'ref', label: 'Ref', type: 'text', read_only: true },
      ],
      template_values: { ref: 'R-1' },
    },
  }
  const OWNER = '7dc90f00-ec7e-4904-8d87-40bd2d8dd6ea'

  it('stores typed values (numbers, arrays, ISO dates) for the new field types', async () => {
    const { supabase } = makeSupabase({ members: [OWNER] })
    const result = await recordTaskResponse({
      supabase, task: typedTask, userId: 'u1', outcome: 'Approved', source: 'api',
      values: { total: '99.5', tags: 'a,b', when: '2026-10-28T09:00:00Z', owner: OWNER, ref: 'tampered' },
    })
    expect(result.status).toBe('completed')
    if (result.status !== 'completed') return
    expect(result.resume.task_data).toEqual({ ref: 'R-1', total: 99.5, tags: ['a', 'b'], when: '2026-10-28T09:00:00.000Z', owner: OWNER })
  })

  it('rejects out-of-range values and people outside the workspace (server-side)', async () => {
    const { supabase, inserts } = makeSupabase({ members: [] })
    const tooBig = await recordTaskResponse({ supabase, task: typedTask, userId: 'u1', outcome: 'Approved', values: { total: 5000 }, source: 'api' })
    expect(tooBig.status === 'invalid' && tooBig.errors.total).toMatch(/at most 1000/)
    const stranger = await recordTaskResponse({ supabase, task: typedTask, userId: 'u1', outcome: 'Approved', values: { total: 5, owner: OWNER }, source: 'api' })
    expect(stranger.status === 'invalid' && stranger.errors.owner).toMatch(/person in this workspace/)
    expect(inserts).toHaveLength(0)
  })

  it('works for tasks without fields', async () => {
    const { supabase } = makeSupabase()
    const result = await recordTaskResponse({
      supabase, task: { id: 't2', tenant_id: 'ten1', metadata: {} }, userId: null, outcome: 'completed', source: 'api',
    })
    expect(result.status).toBe('completed')
    if (result.status === 'completed') expect(result.resume.task_data).toEqual({})
  })
})
