import { describe, expect, it } from 'vitest'
import { actionButtonSchema } from '@/lib/apps/schema'
import { defaultActions } from '@/lib/apps/events'
import { compileAppSpec } from '@/lib/apps/spec'

const TABLE = '0f000000-0000-4000-8000-0000000000d1'

describe('rules-only buttons and parameter bindings in specs', () => {
  it('a run_rules button does nothing of its own (its button_click rules do the work)', () => {
    const b = actionButtonSchema.parse({ label: 'Advance stage', action: { kind: 'run_rules' } })
    expect(b.action).toEqual({ kind: 'run_rules' })
    expect(defaultActions({ type: 'button_click', widget: 'actions', index: 0, label: 'Advance stage', action: b.action, mode: null } as never, { filters: {} })).toEqual([])
  })

  it('accepts widget inputs bound to page parameters, variables and system values (not page filters)', () => {
    const compiled = compileAppSpec({
      app: { name: 'Deals' },
      pages: [{
        title: 'Deal room', params: [{ name: 'deal', type: 'text' }], variables: [{ name: 'deal_rec', type: 'record' }],
        widgets: [
          { id: 'card', type: 'record_card', w: 4, h: 6, config: { table_id: TABLE, row_id: { filter: 'param.deal' } } },
          { id: 'grid', type: 'data_grid', w: 8, h: 6, config: { table_id: TABLE, where: [{ column: 'owner', value: { filter: 'sys.user.name' } }, { column: 'name', value: { filter: 'var.deal_rec.name' } }] } },
        ],
      }],
    }, null)
    expect(compiled.ok ? [] : compiled.errors).toEqual([])
    const missing = compileAppSpec({ app: { name: 'Deals' }, pages: [{ title: 'P', widgets: [{ id: 'g', type: 'data_grid', w: 12, h: 6, config: { table_id: TABLE, where: [{ column: 'a', value: { filter: 'region' } }] } }] }] }, null)
    expect(missing.ok ? [] : missing.errors.join('\n')).toMatch(/page filter "region"/)
  })
})
