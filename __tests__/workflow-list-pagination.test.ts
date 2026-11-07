import { describe, expect, it } from 'vitest'
import {
  applyWorkflowListQuery, defaultWorkflowListState, lastPage, nextWorkflowListState, pageRange, pageSizeForView,
  parseWorkflowListParams, serializeWorkflowListParams, triggersMatching, workflowSearchFilter, type ListQueryBuilder,
} from '@/lib/automations/workflow-list-page'
import { pageNumbers } from '@/lib/page-numbers'
import { reads } from '@/lib/services/ui-reads/automations'

/** A PostgREST builder stand-in that records the calls. */
class Recorder implements ListQueryBuilder<Recorder> {
  calls: Array<[string, ...unknown[]]> = []
  or(filter: string) { this.calls.push(['or', filter]); return this }
  eq(column: string, value: unknown) { this.calls.push(['eq', column, value]); return this }
  not(column: string, operator: string, value: unknown) { this.calls.push(['not', column, operator, value]); return this }
  contains(column: string, value: unknown) { this.calls.push(['contains', column, value]); return this }
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }) { this.calls.push(['order', column, options]); return this }
  range(from: number, to: number) { this.calls.push(['range', from, to]); return this }
}

describe('workflow list query', () => {
  it('ranges the page with search, filters and sort together', () => {
    const q = applyWorkflowListQuery(new Recorder(), { q: 'order', status: 'active', trigger: 'form_submitted', tag: 'finance', sort: 'name', dir: 'asc', page: 3, size: 24 })
    expect(q.calls).toEqual([
      ['or', 'name.ilike.%order%,tags.cs.{"order"}'],
      ['eq', 'is_active', true],
      ['eq', 'trigger_type', 'form_submitted'],
      ['contains', 'tags', ['finance']],
      ['order', 'name', { ascending: true, nullsFirst: false }],
      ['order', 'id', { ascending: true }],
      ['range', 48, 71],
    ])
  })

  it('defaults to newest first, page 1, and treats a null is_active as inactive', () => {
    const q = applyWorkflowListQuery(new Recorder(), { status: 'inactive', page: 1, size: 25 })
    expect(q.calls).toEqual([
      ['not', 'is_active', 'is', true],
      ['order', 'updated_at', { ascending: false, nullsFirst: false }],
      ['order', 'id', { ascending: true }],
      ['range', 0, 24],
    ])
  })

  it('maps the sort fields to columns', () => {
    const order = (sort: Parameters<typeof applyWorkflowListQuery>[1]['sort']) => applyWorkflowListQuery(new Recorder(), { sort, page: 1, size: 25 }).calls.find((c) => c[0] === 'order')?.[1]
    expect(order('status')).toBe('is_active')
    expect(order('nodes')).toBe('node_count')
    expect(order('run_count')).toBe('run_count')
  })

  it('search matches trigger labels and escapes the pattern', () => {
    expect(triggersMatching('webhook')).toEqual(['webhook_received'])
    expect(workflowSearchFilter('Form')).toBe('name.ilike.%Form%,tags.cs.{"form"},trigger_type.in.(form_submitted)')
    // Structural characters never reach the .or() string; a non-tag term skips the tag clause.
    expect(workflowSearchFilter('50%,(x)')).toBe('name.ilike.%50\\%  x %')
    expect(workflowSearchFilter('   ')).toBeNull()
  })

  it('page ranges are clamped', () => {
    expect(pageRange(0, 24)).toEqual({ from: 0, to: 23 })
    expect(pageRange(2, 1000)).toEqual({ from: 100, to: 199 })
    expect(lastPage(0, 24)).toBe(1)
    expect(lastPage(49, 24)).toBe(3)
  })
})

describe('workflow list read', () => {
  it('accepts the page arguments and refuses a page size over 100', () => {
    const args = reads['automations.listPage'].args
    expect(args.safeParse({ q: 'x', status: 'active', trigger: 'schedule', tag: 'ops', sort: 'name', dir: 'asc', page: 2, size: 48 }).success).toBe(true)
    expect(args.safeParse({ page: 1, size: 500 }).success).toBe(false)
    expect(args.safeParse({ page: 0, size: 24 }).success).toBe(false)
    expect(args.safeParse({ page: 1, size: 24, trigger: 'x),or(' }).success).toBe(false)
  })

  it('runs the query with an exact count and returns rows + total', async () => {
    const selects: unknown[] = []
    const rec = new Recorder() as Recorder & PromiseLike<unknown>
    ;(rec as any).then = (resolve: (v: unknown) => void) => resolve({ data: [{ id: 'a', name: 'A', tags: null }], count: 61, error: null })
    const db = { from: (table: string) => ({ select: (cols: string, opts: unknown) => { selects.push([table, cols, opts]); return rec } }) }
    const out = await reads['automations.listPage'].run({ db, supabase: db } as any, { q: 'a', page: 3, size: 24 })
    expect(out).toEqual({ rows: [{ id: 'a', name: 'A', tags: null }], total: 61, page: 3, size: 24 })
    expect((selects[0] as unknown[])[2]).toEqual({ count: 'exact' })
    expect(rec.calls.at(-1)).toEqual(['range', 48, 71])
  })
})

describe('workflow list URL state', () => {
  it('round-trips through the query string, leaving defaults out', () => {
    const state = { ...defaultWorkflowListState('cards'), q: 'invoice', status: 'active' as const, trigger: 'schedule', tag: 'ops', sort: 'name' as const, dir: 'asc' as const, page: 4, size: 48 }
    const qs = serializeWorkflowListParams(state, 'cards')
    expect(qs).toBe('q=invoice&status=active&trigger=schedule&tag=ops&sort=name&dir=asc&page=4&size=48')
    expect(parseWorkflowListParams(new URLSearchParams(qs), 'cards')).toEqual(state)
    expect(serializeWorkflowListParams(defaultWorkflowListState('list'), 'list')).toBe('')
  })

  it('keeps unrelated params and ignores invalid values', () => {
    expect(serializeWorkflowListParams({ ...defaultWorkflowListState('list'), page: 2 }, 'list', new URLSearchParams('foo=1&page=9'))).toBe('foo=1&page=2')
    const parsed = parseWorkflowListParams(new URLSearchParams('page=-3&size=7&sort=evil&status=x&trigger=a,b'), 'list')
    expect(parsed).toEqual(defaultWorkflowListState('list'))
  })

  it('page sizes follow the view (cards 24/48/96, list 25/50/100)', () => {
    expect(parseWorkflowListParams(new URLSearchParams('size=48'), 'list').size).toBe(50)
    expect(pageSizeForView('cards', 100)).toBe(96)
    expect(pageSizeForView('cards', 33)).toBe(24)
  })

  it('a filter, sort or size change goes back to page 1; a page change does not', () => {
    const at3 = { ...defaultWorkflowListState('cards'), page: 3 }
    expect(nextWorkflowListState(at3, { tag: 'ops' }).page).toBe(1)
    expect(nextWorkflowListState(at3, { size: 48 }).page).toBe(1)
    expect(nextWorkflowListState(at3, { q: 'x' }).page).toBe(1)
    expect(nextWorkflowListState(at3, { page: 4 }).page).toBe(4)
    expect(nextWorkflowListState(at3, { tag: null }).page).toBe(3)
  })
})

describe('page numbers', () => {
  it('shows first, last and the neighbours with gaps', () => {
    expect(pageNumbers(1, 1)).toEqual([1])
    expect(pageNumbers(5, 10)).toEqual([1, null, 4, 5, 6, null, 10])
    expect(pageNumbers(2, 4)).toEqual([1, 2, 3, 4])
  })
})
