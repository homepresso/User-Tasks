import { describe, it, expect } from 'vitest'
import {
  handleMath, handleModifyString, handleTextTemplate, handleFormatDate,
  handleDateMath, handleRegex, handleCollectionCount, handleCollectionGet,
  handleCollectionFilter, handleCollectionSort, handleCollectionUnique,
  handleCollectionJoin, handleCondition, handleSwitchCase, calculateDelay,
  TIME_MS,
} from '@/lib/workflow-node-handlers'

function makeCtx(vars: Record<string, any> = {}) {
  return { variables: { ...vars }, task: {} }
}

function simpleEvaluateRule(field: string, operator: string, value: string, ctx: any): boolean {
  const fv = String(ctx.variables[field] ?? field)
  const cv = String(value)
  switch (operator) {
    case 'equals': return fv === cv
    case 'not_equals': return fv !== cv
    case 'contains': return fv.includes(cv)
    case 'greater_than': return Number(fv) > Number(cv)
    case 'less_than': return Number(fv) < Number(cv)
    default: return false
  }
}

// ─── Math ───
describe('handleMath', () => {
  it('evaluates simple addition', () => {
    const ctx = makeCtx()
    const result = handleMath({ expression: '2 + 3' }, ctx)
    expect(result.result).toBe(5)
    expect(ctx.variables.result).toBe(5)
  })

  it('evaluates multiplication', () => {
    const ctx = makeCtx()
    const result = handleMath({ expression: '4 * 5', output_var: 'product' }, ctx)
    expect(result.result).toBe(20)
    expect(result.variable).toBe('product')
    expect(ctx.variables.product).toBe(20)
  })

  it('handles expressions with non-numeric characters', () => {
    const ctx = makeCtx()
    const result = handleMath({ expression: 'abc123' }, ctx)
    // safeEval strips non-numeric chars internally and evaluates
    expect(result.result).toBe(123)
  })

  it('returns 0 for invalid expression', () => {
    const ctx = makeCtx()
    const result = handleMath({ expression: '()' }, ctx)
    expect(result.result).toBe(0)
  })

  it('returns 0 for Infinity', () => {
    const ctx = makeCtx()
    const result = handleMath({ expression: '1/0' }, ctx)
    expect(result.result).toBe(0)
  })
})

// ─── Modify String ───
describe('handleModifyString', () => {
  it('converts to uppercase', () => {
    const ctx = makeCtx()
    const result = handleModifyString({ input: 'hello', operation: 'uppercase' }, ctx)
    expect(result.result).toBe('HELLO')
  })

  it('converts to lowercase', () => {
    const ctx = makeCtx()
    expect(handleModifyString({ input: 'HELLO', operation: 'lowercase' }, ctx).result).toBe('hello')
  })

  it('trims whitespace', () => {
    const ctx = makeCtx()
    expect(handleModifyString({ input: '  hi  ', operation: 'trim' }, ctx).result).toBe('hi')
  })

  it('replaces text', () => {
    const ctx = makeCtx()
    expect(handleModifyString({ input: 'hello world', operation: 'replace', search: 'world', replace_with: 'earth' }, ctx).result).toBe('hello earth')
  })

  it('replaces all occurrences', () => {
    const ctx = makeCtx()
    expect(handleModifyString({ input: 'aaa', operation: 'replace', search: 'a', replace_with: 'b', replace_all: true }, ctx).result).toBe('bbb')
  })

  it('extracts substring', () => {
    const ctx = makeCtx()
    expect(handleModifyString({ input: 'hello', operation: 'substring', start: 1, end: 3 }, ctx).result).toBe('el')
  })

  it('reverses string', () => {
    const ctx = makeCtx()
    expect(handleModifyString({ input: 'abc', operation: 'reverse' }, ctx).result).toBe('cba')
  })

  it('creates slug', () => {
    const ctx = makeCtx()
    expect(handleModifyString({ input: 'Hello World!', operation: 'slug' }, ctx).result).toBe('hello-world')
  })

  it('pads start', () => {
    const ctx = makeCtx()
    expect(handleModifyString({ input: '5', operation: 'pad_start', length: 3, pad_char: '0' }, ctx).result).toBe('005')
  })

  it('stores result in output variable', () => {
    const ctx = makeCtx()
    handleModifyString({ input: 'test', operation: 'uppercase', output_var: 'upper' }, ctx)
    expect(ctx.variables.upper).toBe('TEST')
  })
})

// ─── Text Template ───
describe('handleTextTemplate', () => {
  it('resolves template with variables', () => {
    const ctx = makeCtx({ name: 'Alice' })
    const result = handleTextTemplate({ template: 'Hello {{name}}!' }, ctx)
    expect(result.result).toBe('Hello Alice!')
  })

  it('stores result in output variable', () => {
    const ctx = makeCtx()
    handleTextTemplate({ template: 'static text', output_var: 'msg' }, ctx)
    expect(ctx.variables.msg).toBe('static text')
  })
})

// ─── Format Date ───
describe('handleFormatDate', () => {
  it('formats as ISO', () => {
    const ctx = makeCtx()
    const result = handleFormatDate({ date: '2024-03-15T12:00:00Z', format: 'iso' }, ctx)
    expect(result.result).toContain('2024-03-15')
  })

  it('formats as custom', () => {
    const ctx = makeCtx()
    const result = handleFormatDate({ date: '2024-03-15T14:30:00', format: 'custom', custom_format: 'YYYY-MM-DD' }, ctx)
    expect(result.result).toBe('2024-03-15')
  })

  it('formats relative date', () => {
    const ctx = makeCtx()
    const today = new Date().toISOString()
    const result = handleFormatDate({ date: today, format: 'relative' }, ctx)
    expect(result.result).toBe('today')
  })

  it('stores result in variable', () => {
    const ctx = makeCtx()
    handleFormatDate({ date: '2024-01-01', format: 'iso', output_var: 'fmt_date' }, ctx)
    expect(ctx.variables.fmt_date).toBeDefined()
  })

  it('accepts the `input` key alias used by imported workflows', () => {
    const ctx = makeCtx()
    const result = handleFormatDate({ input: '2024-03-15T12:00:00Z', format: 'datetime' }, ctx)
    expect(result.result).not.toBe('Invalid Date')
    expect(result.result).toContain('2024')
  })

  it('defaults to now when no date is configured', () => {
    const ctx = makeCtx()
    const result = handleFormatDate({ format: 'iso' }, ctx)
    expect(result.result).not.toBe('Invalid Date')
    expect(result.result).toContain(String(new Date().getFullYear()))
  })
})

// ─── Date Math ───
describe('handleDateMath', () => {
  it('adds days to date', () => {
    const ctx = makeCtx()
    const result = handleDateMath({ date: '2024-01-01T00:00:00Z', operation: 'add', amount: '7', unit: 'days' }, ctx)
    expect(result.result).toContain('2024-01-08')
  })

  it('subtracts days from date', () => {
    const ctx = makeCtx()
    const result = handleDateMath({ date: '2024-01-08T00:00:00Z', operation: 'subtract', amount: '7', unit: 'days' }, ctx)
    expect(result.result).toContain('2024-01-01')
  })

  it('calculates interval between dates', () => {
    const ctx = makeCtx()
    const result = handleDateMath({ date: '2024-01-01T00:00:00Z', operation: 'interval', date2: '2024-01-08T00:00:00Z' }, ctx)
    expect(result.result.days).toBe(7)
  })

  it('returns skipped for unknown operation', () => {
    const ctx = makeCtx()
    const result = handleDateMath({ date: '2024-01-01', operation: 'unknown' }, ctx)
    expect(result.skipped).toBe(true)
  })
})

// ─── Regex ───
describe('handleRegex', () => {
  it('matches pattern', () => {
    const ctx = makeCtx()
    const result = handleRegex({ input: 'abc123', pattern: '\\d+', operation: 'match' }, ctx)
    expect(result.result).toContain('123')
  })

  it('tests pattern', () => {
    const ctx = makeCtx()
    const result = handleRegex({ input: 'abc123', pattern: '\\d+', operation: 'test' }, ctx)
    expect(result.result).toBe(true)
  })

  it('replaces pattern', () => {
    const ctx = makeCtx()
    const result = handleRegex({ input: 'a1b2', pattern: '\\d', operation: 'replace', replace_with: 'X' }, ctx)
    expect(result.result).toBe('aXbX')
  })

  it('splits by pattern', () => {
    const ctx = makeCtx()
    const result = handleRegex({ input: 'a,b;c', pattern: '[,;]', operation: 'split' }, ctx)
    expect(result.result).toEqual(['a', 'b', 'c'])
  })
})

// ─── Collection Count ───
describe('handleCollectionCount', () => {
  it('counts array items', () => {
    const ctx = makeCtx({ items: [1, 2, 3] })
    const result = handleCollectionCount({ collection: '{{items}}' }, ctx)
    expect(result.count).toBe(3)
  })

  it('returns 0 for non-array', () => {
    const ctx = makeCtx({ items: 'not array' })
    expect(handleCollectionCount({ collection: '{{items}}' }, ctx).count).toBe(0)
  })
})

// ─── Collection Get ───
describe('handleCollectionGet', () => {
  it('gets item by index', () => {
    const ctx = makeCtx({ items: ['a', 'b', 'c'] })
    const result = handleCollectionGet({ collection: '{{items}}', index: '1' }, ctx)
    expect(result.result).toBe('b')
  })

  it('gets last item', () => {
    const ctx = makeCtx({ items: ['a', 'b', 'c'] })
    const result = handleCollectionGet({ collection: '{{items}}', by: 'last' }, ctx)
    expect(result.result).toBe('c')
  })

  it('gets item by key', () => {
    const ctx = makeCtx({ items: [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }] })
    const result = handleCollectionGet({ collection: '{{items}}', by: 'key', key_field: 'id', key: 'b' }, ctx)
    expect(result.result).toEqual({ id: 'b', name: 'Bob' })
  })
})

// ─── Collection Filter ───
describe('handleCollectionFilter', () => {
  it('filters items by field equality', () => {
    const ctx = makeCtx({ items: [{ status: 'open' }, { status: 'closed' }, { status: 'open' }] })
    const result = handleCollectionFilter(
      { collection: '{{items}}', field: 'status', operator: 'equals', value: 'open' },
      ctx, simpleEvaluateRule,
    )
    expect(result.count).toBe(2)
  })
})

// ─── Collection Sort ───
describe('handleCollectionSort', () => {
  it('sorts ascending', () => {
    const ctx = makeCtx({ items: [3, 1, 2] })
    handleCollectionSort({ collection: '{{items}}', direction: 'asc' }, ctx)
    expect(ctx.variables.sorted).toEqual([1, 2, 3])
  })

  it('sorts descending', () => {
    const ctx = makeCtx({ items: [3, 1, 2] })
    handleCollectionSort({ collection: '{{items}}', direction: 'desc' }, ctx)
    expect(ctx.variables.sorted).toEqual([3, 2, 1])
  })

  it('sorts by field', () => {
    const ctx = makeCtx({ items: [{ name: 'C' }, { name: 'A' }, { name: 'B' }] })
    handleCollectionSort({ collection: '{{items}}', field: 'name', direction: 'asc' }, ctx)
    expect(ctx.variables.sorted.map((i: any) => i.name)).toEqual(['A', 'B', 'C'])
  })
})

// ─── Collection Unique ───
describe('handleCollectionUnique', () => {
  it('removes duplicates', () => {
    const ctx = makeCtx({ items: [1, 2, 2, 3, 3, 3] })
    const result = handleCollectionUnique({ collection: '{{items}}' }, ctx)
    expect(result.unique).toBe(3)
    expect(ctx.variables.unique).toEqual([1, 2, 3])
  })

  it('deduplicates by field', () => {
    const ctx = makeCtx({ items: [{ id: 1 }, { id: 2 }, { id: 1 }] })
    const result = handleCollectionUnique({ collection: '{{items}}', field: 'id' }, ctx)
    expect(result.unique).toBe(2)
  })
})

// ─── Collection Join ───
describe('handleCollectionJoin', () => {
  it('joins with default separator', () => {
    const ctx = makeCtx({ items: ['a', 'b', 'c'] })
    const result = handleCollectionJoin({ collection: '{{items}}' }, ctx)
    expect(result.result).toBe('a, b, c')
  })

  it('joins with custom separator', () => {
    const ctx = makeCtx({ items: ['a', 'b', 'c'] })
    expect(handleCollectionJoin({ collection: '{{items}}', separator: ' | ' }, ctx).result).toBe('a | b | c')
  })

  it('joins by field', () => {
    const ctx = makeCtx({ items: [{ name: 'Alice' }, { name: 'Bob' }] })
    expect(handleCollectionJoin({ collection: '{{items}}', field: 'name' }, ctx).result).toBe('Alice, Bob')
  })
})

// ─── Condition ───
describe('handleCondition', () => {
  it('evaluates legacy single condition (true)', () => {
    const ctx = makeCtx({ status: 'open' })
    const result = handleCondition(
      { field: 'status', operator: 'equals', value: 'open' },
      ctx, simpleEvaluateRule,
    )
    expect(result.result).toBe(true)
    expect(result.matched_branch).toBe('true')
  })

  it('evaluates legacy single condition (false)', () => {
    const ctx = makeCtx({ status: 'closed' })
    const result = handleCondition(
      { field: 'status', operator: 'equals', value: 'open' },
      ctx, simpleEvaluateRule,
    )
    expect(result.result).toBe(false)
    expect(result.matched_branch).toBe('false')
  })

  it('evaluates multi-branch conditions', () => {
    const ctx = makeCtx({ priority: '5' })
    const result = handleCondition({
      branches: [
        { label: 'High', logic: 'and', rules: [{ field: 'priority', operator: 'greater_than', value: '3' }] },
        { label: 'Low', logic: 'and', rules: [{ field: 'priority', operator: 'less_than', value: '3' }] },
      ],
    }, ctx, simpleEvaluateRule)
    expect(result.matched_branches).toEqual(['High'])
  })

  it('falls through to Else when no branch matches', () => {
    const ctx = makeCtx({ priority: '3' })
    const result = handleCondition({
      branches: [
        { label: 'High', logic: 'and', rules: [{ field: 'priority', operator: 'greater_than', value: '5' }] },
      ],
    }, ctx, simpleEvaluateRule)
    expect(result.matched_branches).toEqual(['Else'])
  })

  it('skips branches with empty rules', () => {
    const ctx = makeCtx({ x: '1' })
    const result = handleCondition({
      branches: [
        { label: 'Empty', logic: 'and', rules: [{ field: '', operator: 'equals', value: '' }] },
        { label: 'Valid', logic: 'and', rules: [{ field: 'x', operator: 'equals', value: '1' }] },
      ],
    }, ctx, simpleEvaluateRule)
    expect(result.matched_branches).toEqual(['Valid'])
  })

  it('supports OR logic', () => {
    const ctx = makeCtx({ a: '1', b: '5' })
    const result = handleCondition({
      branches: [
        { label: 'Match', logic: 'or', rules: [
          { field: 'a', operator: 'equals', value: '999' },
          { field: 'b', operator: 'equals', value: '5' },
        ]},
      ],
    }, ctx, simpleEvaluateRule)
    expect(result.matched_branches).toEqual(['Match'])
  })

  it('fires every matching branch by default', () => {
    const ctx = makeCtx({ weight: '3' })
    const result = handleCondition({
      branches: [
        { label: 'Heavy', logic: 'and', rules: [{ field: 'weight', operator: 'greater_than', value: '2' }] },
        { label: 'Medium', logic: 'and', rules: [{ field: 'weight', operator: 'greater_than', value: '1' }] },
      ],
    }, ctx, simpleEvaluateRule)
    expect(result.matched_branches).toEqual(['Heavy', 'Medium'])
  })

  it('match_mode "first" stops at the first matching branch (if/else-if)', () => {
    const ctx = makeCtx({ weight: '3' })
    const result = handleCondition({
      match_mode: 'first',
      branches: [
        { label: 'Heavy', logic: 'and', rules: [{ field: 'weight', operator: 'greater_than', value: '2' }] },
        { label: 'Medium', logic: 'and', rules: [{ field: 'weight', operator: 'greater_than', value: '1' }] },
      ],
    }, ctx, simpleEvaluateRule)
    expect(result.matched_branches).toEqual(['Heavy'])
  })
})

// ─── Switch Case ───
describe('handleSwitchCase', () => {
  it('matches exact case', () => {
    const ctx = makeCtx({ status: 'open' })
    const result = handleSwitchCase({ field: '{{status}}', cases: ['open', 'closed', 'pending'] }, ctx)
    expect(result.matched_case).toBe('open')
  })

  it('matches case-insensitively', () => {
    const ctx = makeCtx({ status: 'OPEN' })
    const result = handleSwitchCase({ field: '{{status}}', cases: ['open', 'closed'] }, ctx)
    expect(result.matched_case).toBe('open')
  })

  it('falls through to default', () => {
    const ctx = makeCtx({ status: 'unknown' })
    const result = handleSwitchCase({ field: '{{status}}', cases: ['open', 'closed'] }, ctx)
    expect(result.matched_case).toBe('default')
  })

  it('returns null when no default', () => {
    const ctx = makeCtx({ status: 'unknown' })
    const result = handleSwitchCase({ field: '{{status}}', cases: ['open'], has_default: false }, ctx)
    expect(result.matched_case).toBeNull()
  })

  it('matches object-format cases with value/label', () => {
    const ctx = makeCtx({ ticket_status: 'escalated' })
    const result = handleSwitchCase({
      field: '{{ticket_status}}',
      cases: [
        { value: 'new', label: 'New' },
        { value: 'open', label: 'Open' },
        { value: 'escalated', label: 'Escalated' },
        { value: 'closed', label: 'Closed' },
      ],
      has_default: true,
    }, ctx)
    expect(result.value).toBe('escalated')
    expect(result.matched_case).toBe('Escalated')
  })

  it('falls through to default with object-format cases', () => {
    const ctx = makeCtx({ ticket_status: 'unknown' })
    const result = handleSwitchCase({
      field: '{{ticket_status}}',
      cases: [
        { value: 'new', label: 'New' },
        { value: 'open', label: 'Open' },
      ],
      has_default: true,
    }, ctx)
    expect(result.matched_case).toBe('default')
  })
})

// ─── Calculate Delay ───
describe('calculateDelay', () => {
  it('calculates seconds', () => {
    expect(calculateDelay(5, 'seconds')).toBe(5000)
  })

  it('calculates minutes', () => {
    expect(calculateDelay(2, 'minutes')).toBe(2 * TIME_MS.MINUTE)
  })

  it('calculates hours', () => {
    expect(calculateDelay(1, 'hours')).toBe(TIME_MS.HOUR)
  })

  it('calculates days', () => {
    expect(calculateDelay(1, 'days')).toBe(TIME_MS.DAY)
  })

  it('defaults to minutes', () => {
    expect(calculateDelay(3)).toBe(3 * TIME_MS.MINUTE)
  })

  it('handles zero', () => {
    expect(calculateDelay(0, 'hours')).toBe(0)
  })
})

const groupsConfig = { groups: [{ logic: 'and', rules: [{ field: '{{row_count}}', operator: 'greater_than', value: '0' }] }] }

describe('rule-group conditions route True / False at runtime', () => {
  const rule = (field: string, operator: string, value: string, ctx: { variables: Record<string, unknown> }) => {
    const v = Number(ctx.variables[field.replace(/[{}]/g, '')])
    return operator === 'greater_than' ? v > Number(value) : operator === 'equals' ? String(ctx.variables[field.replace(/[{}]/g, '')]) === value : false
  }
  const ctx = (vars: Record<string, unknown>) => ({ variables: vars, task: {} }) as never
  it('evaluates the groups (OR of groups, rules by the group logic) instead of falling to Else', () => {
    expect(handleCondition(groupsConfig, ctx({ row_count: 3 }), rule)).toEqual({ result: true, matched_branches: ['True'], matched_branch: 'True' })
    expect(handleCondition(groupsConfig, ctx({ row_count: 0 }), rule)).toEqual({ result: false, matched_branches: ['False'], matched_branch: 'False' })
    const two = { groups: [
      { logic: 'and', rules: [{ field: '{{a}}', operator: 'equals', value: '1' }, { field: '{{b}}', operator: 'equals', value: '1' }] },
      { logic: 'or', rules: [{ field: '{{c}}', operator: 'equals', value: 'x' }, { field: '', operator: 'equals', value: '' }] },
    ] }
    expect(handleCondition(two, ctx({ a: '1', b: '2', c: 'x' }), rule).result).toBe(true) // second group
    expect(handleCondition(two, ctx({ a: '1', b: '2', c: 'y' }), rule).result).toBe(false)
    expect(handleCondition({ groups: [{ logic: 'and', rules: [] }] }, ctx({}), rule).result).toBe(false)
  })
})
