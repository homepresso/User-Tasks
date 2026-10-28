import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { formatCell, pickColumns, render } from '../src/output'

describe('render', () => {
  const data = {
    workflows: [
      { id: 'w1', description: 'x', name: 'Onboarding', is_active: true, nodes: [{}], created_at: '2026-01-01' },
      { id: 'w2', description: null, name: 'Offboarding', is_active: false, nodes: [], created_at: '2026-02-01' },
    ],
    total: 2,
  }

  it('json and yaml print the full data', () => {
    expect(JSON.parse(render(data, 'json'))).toEqual(data)
    expect(YAML.parse(render(data, 'yaml'))).toEqual(data)
  })

  it('table renders the listKey items with preferred columns first', () => {
    const lines = render(data, 'table', { listKey: 'workflows' }).split('\n')
    expect(lines[0].split(/\s{2,}/)).toEqual(['ID', 'NAME', 'IS_ACTIVE', 'CREATED_AT', 'DESCRIPTION'])
    expect(lines[1]).toMatch(/^w1\s+Onboarding\s+true\s+2026-01-01\s+x$/)
    expect(lines).toHaveLength(3)
  })

  it('table renders objects as key/value pairs and empty lists as "No results."', () => {
    expect(render({ id: 'r1', status: 'done', tags: ['a', 'b'] }, 'table')).toBe('id      r1\nstatus  done\ntags    a, b')
    expect(render({ runs: [], total: 0 }, 'table', { listKey: 'runs' })).toBe('No results.')
  })

  it('caps columns and truncates long cells', () => {
    const row = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]))
    expect(pickColumns([row])).toHaveLength(6)
    expect(formatCell('x'.repeat(100))).toHaveLength(60)
    expect(formatCell({ a: 1 })).toBe('{"a":1}')
    expect(formatCell(null)).toBe('')
  })
})
