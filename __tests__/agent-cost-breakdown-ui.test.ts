import { describe, expect, it, vi } from 'vitest'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/dynamic', () => ({ default: () => () => h('div', { 'data-testid': 'chart' }) }))

import { breakdownArgs, CostBreakdownView, toggleRowFilter, type BreakdownData } from '@/components/agents/cost-breakdown'
import { resolvePeriod, rollupBreakdown, type CubeRow } from '@/lib/agents/cost-breakdown'

const period = resolvePeriod({ preset: '7d' }, new Date('2026-11-22T12:00:00Z'))
const row = (over: Partial<CubeRow>): CubeRow => ({
  day: '2026-11-20', source: 'assistant', provider: 'openai', model: 'gpt-test', agent_id: null, profile: null, capability: 'task', user_id: 'u1',
  cost_status: 'priced', cost_currency: 'USD', calls: 1, input_tokens: 1000, output_tokens: 100, cached_tokens: 50, cache_write_tokens: 0, total_tokens: 1100, cost_amount: 0.02,
  ...over,
})
const breakdown = rollupBreakdown({
  cube: [row({}), row({ source: 'agent', agent_id: 'a1', provider: 'ollama', model: 'llama', cost_status: 'unknown', cost_currency: null, cost_amount: null, user_id: null })],
  period, currency: 'USD', layers: { workspace: [], instance: [], defaults: [] }, names: { agents: { a1: { name: 'Triage' } } },
  groupBy: ['day', 'model', 'profile', 'agent', 'source', 'user'],
})
const render = (data: BreakdownData, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(h(CostBreakdownView, { data, state: { period: '7d', filters: {} }, onChange: () => undefined, ...extra }))

describe('CostBreakdownView', () => {
  it('renders totals, the charts and the by-model table with the unknown-price link', () => {
    const html = render({ ...breakdown, can_see_people: false })
    expect(html).toContain('data-testid="cost-breakdown"')
    expect(html).toContain('data-testid="breakdown-table-model"')
    expect(html.match(/data-testid="chart"/g)).toHaveLength(2)
    expect(html).toContain('gpt-test')
    expect(html).toContain('1 call cost unknown')
    expect(html).toContain('href="#model-prices"')
    expect(html).toContain('Export CSV')
    expect(html).not.toContain('By person')
  })

  it('offers "add a price" to editors and the person table to admins of the Agent', () => {
    const html = render({ ...breakdown, can_see_people: true }, { canEditPrices: true, onAddPrice: () => undefined })
    expect(html).toContain('>add a price</button>')
    expect(html).toContain('By person')
  })

  it('shows active filters as removable chips', () => {
    const html = render({ ...breakdown }, { state: { period: '7d', filters: { provider: 'openai', model: 'gpt-test', source: 'assistant' } } })
    expect(html).toContain('Remove filter Model: gpt-test (openai)')
    expect(html).toContain('Remove filter Source: In-product Agent')
    expect(html).toContain('Clear all')
  })
})

describe('cross-filter and request args', () => {
  it('a row click toggles its filter', () => {
    const model = breakdown.groups.model!.find((r) => r.key === 'openai:gpt-test')!
    const on = toggleRowFilter('model', model, { source: 'assistant' })
    expect(on).toEqual({ source: 'assistant', provider: 'openai', model: 'gpt-test' })
    expect(toggleRowFilter('model', model, on)).toEqual({ source: 'assistant' })
    const agent = breakdown.groups.agent![0]
    expect(toggleRowFilter('agent', agent, {})).toEqual({ agent: 'a1' })
  })

  it('period and filters become the read\'s arguments; person rows only when allowed', () => {
    expect(breakdownArgs({ period: 'last_month', filters: { model: 'x', agent: '' } }, false)).toEqual({ period: 'last_month', model: 'x', group_by: 'day,model,profile,agent,source' })
    expect(breakdownArgs({ period: 'custom', from: '2026-01-01', to: '2026-01-31', filters: {} }, true)).toMatchObject({ from: '2026-01-01', to: '2026-01-31', group_by: 'day,model,profile,agent,source,user' })
    expect(breakdownArgs({ period: 'custom', filters: {} }, false)).toMatchObject({ period: '30d' })
  })
})
