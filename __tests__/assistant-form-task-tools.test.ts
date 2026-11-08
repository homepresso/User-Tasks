/**
 * Form and task assistant tools: there is no submit / complete / approve
 * tool; proposals only for visible, editable, non-secret fields with valid
 * values; hidden fields never reach the model and secret values are masked.
 */
import { describe, expect, it } from 'vitest'
import { formTools } from '@/lib/assistants/tools/form'
import { taskTools, type TaskContext } from '@/lib/assistants/tools/task'
import { coerceProposedValue, formForModel, sanitizeSnapshot, unsettableReason } from '@/lib/assistants/form-values'
import type { AssistantEvent, FormSnapshot, FormSnapshotField } from '@/lib/assistants/types'

const f = (key: string, type: string, extra: Partial<FormSnapshotField> = {}): FormSnapshotField => ({ key, label: key, type, visible: true, read_only: false, secret: false, value: null, ...extra })

const snapshot: FormSnapshot = {
  title: 'Expense claim',
  fields: [
    f('name', 'text'),
    f('email', 'email'),
    f('amount', 'number', { min: 1, max: 1000 }),
    f('category', 'choice', { options: [{ value: 'travel', label: 'Travel' }, { value: 'meals', label: 'Meals' }] }),
    f('internal_notes', 'textarea', { visible: false, value: 'HIDDEN-VALUE' }),
    f('approved_by', 'text', { read_only: true, value: 'Boss' }),
    f('api_key', 'text', { value: 'SECRET-VALUE' }),
    f('manager', 'user'),
    f('docs', 'attachments'),
    f('lookup_customer', 'lookup'),
  ],
}

const FORBIDDEN = /submit|complete|approve|reject|redirect|reassign|escalate|post|send|delete/i

async function propose(values: Array<{ key: string; value: unknown }>, snap: FormSnapshot = snapshot) {
  const events: AssistantEvent[] = []
  const tool = formTools(snap, { canEdit: true }).find((t) => t.name === 'propose_field_values')!
  const out = await tool.run({ values }, { emit: (e) => events.push(e), toolCallId: 'call_1' })
  return { events, out: out.result as any }
}

describe('form assistant tools', () => {
  it('offer no submit tool, and no propose tool when the form is not editable', () => {
    const names = formTools(snapshot, { canEdit: true }).map((t) => t.name)
    expect(names).toEqual(['get_form', 'get_validation_problems', 'propose_field_values'])
    expect(names.filter((n) => FORBIDDEN.test(n))).toEqual([])
    expect(formTools(snapshot, { canEdit: false }).map((t) => t.name)).not.toContain('propose_field_values')
  })

  it('propose only valid values for visible, editable, non-secret, supported fields', async () => {
    const { events, out } = await propose([
      { key: 'name', value: 'Ada' },
      { key: 'amount', value: '250' },
      { key: 'category', value: 'Travel' },
      { key: 'internal_notes', value: 'x' },
      { key: 'approved_by', value: 'Me' },
      { key: 'api_key', value: 'sk-123' },
      { key: 'manager', value: 'u1' },
      { key: 'docs', value: 'a.pdf' },
      { key: 'lookup_customer', value: 'ALFKI' },
      { key: 'email', value: 'not-an-email' },
      { key: 'nope', value: 1 },
    ])
    expect(events).toHaveLength(1)
    const proposal = events[0] as Extract<AssistantEvent, { type: 'proposal' }>
    expect(proposal.type).toBe('proposal')
    expect(proposal.values.map((v) => [v.key, v.proposed])).toEqual([['name', 'Ada'], ['amount', 250], ['category', 'travel']])
    const skipped = Object.fromEntries(out.skipped.map((s: any) => [s.key, s.reason]))
    expect(skipped.internal_notes).toMatch(/hidden/)
    expect(skipped.approved_by).toMatch(/read-only/)
    expect(skipped.api_key).toMatch(/secret/)
    for (const k of ['manager', 'docs', 'lookup_customer']) expect(skipped[k]).toMatch(/can't fill/)
    expect(skipped.email).toMatch(/email/)
    expect(skipped.nope).toMatch(/no such field/)
  })

  it('a value out of range or not an option is refused; nothing valid → no proposal event', async () => {
    const { events, out } = await propose([{ key: 'amount', value: 5000 }, { key: 'category', value: 'Hotels' }])
    expect(events).toEqual([])
    expect(out.skipped).toHaveLength(2)
  })

  it('a read-only form refuses every field', async () => {
    expect(unsettableReason(snapshot.fields[0], true)).toMatch(/read-only/)
  })

  it('coerces types (dates, booleans, multi choice)', () => {
    expect(coerceProposedValue(f('d', 'date'), '2026-02-30')).toMatchObject({ ok: false })
    expect(coerceProposedValue(f('d', 'date'), '2026-03-01')).toMatchObject({ ok: true, value: '2026-03-01' })
    expect(coerceProposedValue(f('b', 'boolean'), 'yes')).toMatchObject({ ok: true, value: true })
    const m = f('m', 'multi_choice', { options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] })
    expect(coerceProposedValue(m, 'A, b')).toMatchObject({ ok: true, value: ['a', 'b'] })
    expect(coerceProposedValue(m, ['c'])).toMatchObject({ ok: false })
  })

  it('the model never sees hidden fields, and secret values are masked', () => {
    const model = formForModel(snapshot)!
    const json = JSON.stringify(model)
    expect(json).not.toContain('internal_notes')
    expect(json).not.toContain('HIDDEN-VALUE')
    expect(json).not.toContain('SECRET-VALUE')
    const key = (model.fields as any[]).find((x) => x.key === 'api_key')
    expect(key.secret).toBe(true)
    expect(key.value).toMatch(/hidden/)
  })

  it('the browser snapshot is sanitised: secret-looking fields are flagged by key or label', () => {
    const s = sanitizeSnapshot({ fields: [{ key: 'pw', label: 'Your password', type: 'text', value: 'x' }, { key: 'client_secret', label: 'Client', type: 'text' }, { key: '', type: 'text' }] })!
    expect(s.fields.map((x) => [x.key, x.secret])).toEqual([['pw', true], ['client_secret', true]])
    expect(sanitizeSnapshot('nope')).toBeNull()
  })
})

const task = (over: Partial<TaskContext> = {}): TaskContext => ({
  id: 't1', title: 'Approve trip', description: 'Please review', status: 'in_progress', priority: 'medium', due_date: null,
  outcomes: ['Approved', 'Rejected'], assignee: 'Ada', assigner: 'Bob', mode: 'assignee', closed: false, on_behalf_of: null, workflow_task: true, ...over,
})

describe('task assistant tools', () => {
  const history = async () => []

  it('never include a tool that completes, approves, redirects, escalates or posts', () => {
    const names = taskTools(task(), snapshot, history).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['get_task_history', 'draft_comment', 'suggest_outcome', 'propose_field_values']))
    expect(names.filter((n) => FORBIDDEN.test(n))).toEqual([])
  })

  it('suggest_outcome accepts only the task\'s outcomes and never completes', async () => {
    const tool = taskTools(task(), null, history).find((t) => t.name === 'suggest_outcome')!
    const events: AssistantEvent[] = []
    const env = { emit: (e: AssistantEvent) => events.push(e), toolCallId: 'c' }
    expect((await tool.run({ outcome: 'Escalated', reason: 'x' }, env)).ok).toBe(false)
    const ok = await tool.run({ outcome: 'approved', reason: 'Looks fine' }, env)
    expect(ok.result).toMatchObject({ shown_to_person: true })
    expect(events).toEqual([{ type: 'outcome_suggestion', id: 'c', outcome: 'Approved', reason: 'Looks fine' }])
  })

  it('a closed task or one the person can\'t act on: no outcome suggestion, no proposals', () => {
    for (const t of [task({ closed: true }), task({ mode: 'none' })]) {
      const names = taskTools(t, snapshot, history).map((x) => x.name)
      expect(names).not.toContain('suggest_outcome')
      expect(names).not.toContain('propose_field_values')
      expect(names).toContain('get_form')
    }
  })

  it('draft_comment only shows a draft', async () => {
    const tool = taskTools(task(), null, history).find((t) => t.name === 'draft_comment')!
    const events: AssistantEvent[] = []
    await tool.run({ text: 'Thanks!', kind: 'comment' }, { emit: (e) => events.push(e), toolCallId: 'd' })
    expect(events).toEqual([{ type: 'draft', id: 'd', kind: 'comment', text: 'Thanks!' }])
  })
})
