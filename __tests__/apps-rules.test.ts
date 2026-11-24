import { describe, expect, it, vi } from 'vitest'
import {
  APP_RULE_LIMITS, actionAt, appRuleSchema, listens, normaliseRules, resolveSlots, ruleMatches, ruleProblems, runRules, serverSlots, timerRules,
  type AppRule, type EngineEnv, type RuleEvent,
} from '@/lib/apps/rules'
import { systemVariables, type AppScope } from '@/lib/apps/variables'
import { collectAppReferences } from '@/lib/apps/references'

const T = '33333333-3333-4333-8333-333333333333'
const REF = '55555555-5555-4555-8555-555555555555'
const FORM = '11111111-1111-4111-8111-111111111111'

const rule = (r: { id: string } & Record<string, unknown>): AppRule => appRuleSchema.parse({ when: { type: 'row_click' }, then: [], ...r })

/** A test env: variables in a map, client / server actions recorded. */
function env(over: Partial<EngineEnv> = {}, declared = ['rowId', 'customer', 'credit', 'count', 'a', 'b']) {
  const vars: Record<string, unknown> = {}
  const calls: string[] = []
  const log: Array<{ kind: string; text: string }> = []
  const sys = systemVariables({ user: { id: 'u1', name: 'Ada' }, now: new Date('2026-11-21T10:00:00Z') })
  const e: EngineEnv = {
    scope: (): AppScope => ({ param: { region: 'west' }, var: { ...vars }, sys, filter: {} }),
    setVariable: (name, value) => {
      if (!declared.includes(name)) return { changed: false, error: `Unknown variable ${name}` }
      const previous = vars[name]
      if (JSON.stringify(previous ?? null) === JSON.stringify(value ?? null)) return { changed: false, previous }
      vars[name] = value
      return { changed: true, previous }
    },
    runClient: async (a) => { calls.push(`client:${a.type}`); return a.type === 'confirm' ? true : null },
    runServer: async (r, path, slots) => { calls.push(`server:${path}:${JSON.stringify(slots)}`); return { name: 'Acme', score: 720 } },
    log: (x) => log.push(x),
    ...over,
  }
  return { e, vars, calls, log }
}

const rowEvent = (id = 'row-1'): RuleEvent => ({ type: 'row_click', widget: 'grid', payload: { widget: 'grid', value: id, row: { id, name: 'Acme' } } })

describe('schema', () => {
  it('validates triggers and actions strictly', () => {
    expect(appRuleSchema.safeParse({ id: 'r', when: { type: 'timer', interval_s: 10 }, then: [] }).success).toBe(false)
    expect(appRuleSchema.safeParse({ id: 'r', when: { type: 'timer', interval_s: 30 }, then: [] }).success).toBe(true)
    expect(appRuleSchema.safeParse({ id: 'r', when: { type: 'row_click' }, then: [{ type: 'call_reference', reference_id: 'nope' }] }).success).toBe(false)
    expect(appRuleSchema.safeParse({ id: 'r', when: { type: 'row_click' }, then: [{ type: 'set_variable', values: [{ name: 'x', value: '{{event.row.id}}' }], extra: 1 }] }).success).toBe(false)
    expect(normaliseRules([{ id: 'a', when: { type: 'page_loaded' } }, { id: 'a', when: { type: 'page_loaded' } }, 'junk']).length).toBe(1)
  })

  it('addresses actions by path, including confirm branches and on-error actions', () => {
    const r = rule({ id: 'r', then: [{ type: 'message', text: 'hi' }, { type: 'confirm', title: 'Sure?', then: [{ type: 'table_create', table_id: T, values: {} }], else: [] }], on_error_actions: [{ type: 'message', text: 'oops' }] })
    expect(actionAt(r, 'then.1.then.0')?.type).toBe('table_create')
    expect(actionAt(r, 'on_error.0')?.type).toBe('message')
    expect(actionAt(r, 'then.0.then.0')).toBeNull()
    expect(actionAt(r, 'then.9')).toBeNull()
    expect(actionAt(r, '__proto__')).toBeNull()
  })

  it('lists server slots and resolves them from the scope', () => {
    const a = appRuleSchema.parse({ id: 'r', when: { type: 'row_click' }, then: [{ type: 'table_lookup', table_id: T, row_id: '{{event.row.id}}', filter: { match: 'all', conditions: [{ column: 'status', operator: 'eq', value: '{{param.region}}' }, { match: 'any', conditions: [{ column: 'x', operator: 'eq', value: 'lit' }] }] } }] }).then[0]
    expect(serverSlots(a).map((s) => s.slot)).toEqual(['row_id', 'filter.0', 'filter.1.0'])
    const { e } = env()
    expect(resolveSlots(a, { ...e.scope(), event: { row: { id: 'R1' } } })).toEqual({ row_id: 'R1', 'filter.0': 'west', 'filter.1.0': 'lit' })
  })

  it('the reference walker sees ids in rule actions', () => {
    const r = rule({ id: 'r', then: [{ type: 'call_reference', reference_id: REF, inputs: {} }, { type: 'open_target', target: { kind: 'form', form_id: FORM } }, { type: 'navigate', page_slug: 'details' }], when: { type: 'form_submitted', form_id: FORM } })
    const kinds = collectAppReferences({ settings: { rules: [r] } }).map((x) => `${x.kind}:${x.id}`)
    expect(kinds).toEqual(expect.arrayContaining([`reference:${REF}`, `form:${FORM}`, 'page:details']))
  })
})

describe('matching', () => {
  it('matches by trigger, widget, button, variable, filter and form', () => {
    expect(ruleMatches(rule({ id: 'a', when: { type: 'row_click', widget: 'grid' } }), rowEvent())).toBe(true)
    expect(ruleMatches(rule({ id: 'a', when: { type: 'row_click', widget: 'other' } }), rowEvent())).toBe(false)
    expect(ruleMatches(rule({ id: 'a', enabled: false }), rowEvent())).toBe(false)
    expect(ruleMatches(rule({ id: 'a', when: { type: 'button_click', button: 1 } }), { type: 'button_click', button: 0, payload: {} })).toBe(false)
    expect(ruleMatches(rule({ id: 'a', when: { type: 'variable_changed', variable: 'var.rowId' } }), { type: 'variable_changed', variable: 'var.rowId', payload: {} })).toBe(true)
    expect(ruleMatches(rule({ id: 'a', when: { type: 'form_submitted', form_id: FORM } }), { type: 'form_submitted', form_id: T, payload: {} })).toBe(false)
    expect(listens([rule({ id: 'a', when: { type: 'card_click', widget: 'cards' } })], 'card_click', 'cards')).toBe(true)
    expect(listens([rule({ id: 'a', when: { type: 'card_click', widget: 'cards' } })], 'card_click', 'grid')).toBe(false)
  })

  it('bounds timers', () => {
    const many = Array.from({ length: 8 }, (_, i) => rule({ id: `t${i}`, when: { type: 'timer', interval_s: 30 } }))
    expect(timerRules(many)).toHaveLength(APP_RULE_LIMITS.timers)
    expect(timerRules(many)[0].ms).toBe(30_000)
  })
})

describe('engine', () => {
  it('runs the owner example: row clicked → set rowId → look up → call API → open form with both prefilled', async () => {
    const r = rule({
      id: 'credit', name: 'Credit check',
      then: [
        { type: 'set_variable', values: [{ name: 'rowId', value: '{{event.row.id}}' }] },
        { type: 'table_lookup', table_id: T, row_id: '{{var.rowId}}', result_var: 'customer' },
        { type: 'call_reference', reference_id: REF, inputs: { name: '{{var.customer.name}}' }, result_var: 'credit' },
        { type: 'open_target', target: { kind: 'form', form_id: FORM, params: { customer: { from: 'variable', name: 'rowId' }, score: { from: 'expression', expr: '{{var.credit.score}}' } } }, open_mode: { mode: 'panel_right' } },
      ],
    })
    let opened: AppScope | null = null
    const { e, vars, calls } = env({ runClient: async (a, s) => { calls.push(`client:${a.type}`); opened = s; return null } })
    await runRules([r], rowEvent('row-42'), e)
    expect(vars.rowId).toBe('row-42')
    expect(calls[0]).toBe('server:then.1:{"row_id":"row-42"}')
    expect(calls[1]).toBe('server:then.2:{"inputs.name":"Acme"}')
    expect(calls[2]).toBe('client:open_target')
    expect((opened as AppScope | null)?.var).toMatchObject({ rowId: 'row-42', credit: { score: 720 } })
  })

  it('checks conditions over event, params, variables and system variables (AND / OR)', async () => {
    const r = rule({ id: 'c', if: { match: 'all', conditions: [{ column: 'event.row.name', operator: 'eq', value: 'Acme' }, { match: 'any', conditions: [{ column: 'param.region', operator: 'eq', value: 'east' }, { column: 'user.name', operator: 'eq', value: 'Ada' }] }] }, then: [{ type: 'message', text: 'ok' }] })
    const { e, calls, log } = env()
    expect(await runRules([r], rowEvent(), e)).toBe(1)
    expect(calls).toEqual(['client:message'])
    const r2 = rule({ id: 'c2', if: { match: 'all', conditions: [{ column: 'var.rowId', operator: 'is_set' }] }, then: [{ type: 'message', text: 'no' }] })
    const t = env()
    expect(await runRules([r2], rowEvent(), t.e)).toBe(0)
    expect(log.some((l) => l.kind === 'condition')).toBe(true)
  })

  it('passes results to later actions ({{result}}, {{results.n}})', async () => {
    const r = rule({ id: 'r', then: [{ type: 'call_reference', reference_id: REF, inputs: {} }, { type: 'set_variable', values: [{ name: 'a', value: '{{result.name}}' }] }] })
    const { e, vars } = env()
    await runRules([r], rowEvent(), e)
    expect(vars.a).toBe('Acme')
  })

  it('variable changes trigger variable_changed rules with old and new values, and API results reference_returned', async () => {
    const set = rule({ id: 'set', then: [{ type: 'set_variable', values: [{ name: 'rowId', value: '{{event.row.id}}' }] }] })
    const watch = rule({ id: 'watch', when: { type: 'variable_changed', variable: 'var.rowId' }, then: [{ type: 'set_variable', values: [{ name: 'b', value: '{{event.previous}}→{{event.value}}' }] }] })
    const { e, vars } = env()
    vars.rowId = 'old'
    await runRules([set, watch], rowEvent('new'), e)
    expect(vars.b).toBe('old→new')
    // Same value again: no change, no event.
    vars.b = null
    await runRules([set, watch], rowEvent('new'), e)
    expect(vars.b).toBeNull()

    const call = rule({ id: 'call', then: [{ type: 'call_reference', reference_id: REF, inputs: {} }] })
    const back = rule({ id: 'back', when: { type: 'reference_returned', reference_id: REF }, then: [{ type: 'set_variable', values: [{ name: 'a', value: '{{event.result.score}}' }] }] })
    const t = env()
    await runRules([call, back], rowEvent(), t.e)
    expect(t.vars.a).toBe(720)
  })

  it('stops cascades at the chain limit', async () => {
    // a → b → a → … : each changes the other's variable.
    const ping = rule({ id: 'ping', when: { type: 'variable_changed', variable: 'var.a' }, then: [{ type: 'set_variable', values: [{ name: 'b', value: '{{= var.a + 1 }}' }] }] })
    const pong = rule({ id: 'pong', when: { type: 'variable_changed', variable: 'var.b' }, then: [{ type: 'set_variable', values: [{ name: 'a', value: '{{= var.b + 1 }}' }] }] })
    const start = rule({ id: 'start', then: [{ type: 'set_variable', values: [{ name: 'a', value: '1' }] }] })
    const { e, vars, log } = env()
    await runRules([start, ping, pong], rowEvent(), e)
    expect(log.some((l) => l.kind === 'skipped' && /levels deep/.test(l.text))).toBe(true)
    expect(Number(vars.a) + Number(vars.b)).toBeLessThan(20)
  })

  it('error modes: stop (default), continue, run on-error actions', async () => {
    const failing = vi.fn(async () => { throw new Error('API down') })
    const mk = (on_error?: 'stop' | 'continue' | 'run') => rule({ id: `e-${on_error}`, then: [{ type: 'call_reference', reference_id: REF, inputs: {}, ...(on_error ? { on_error } : {}) }, { type: 'message', text: 'after' }], on_error_actions: [{ type: 'set_variable', values: [{ name: 'a', value: 'failed: {{event.error.message}}' }] }] })
    for (const [mode, expected] of [[undefined, []], ['continue', ['client:message']]] as const) {
      const { e, calls } = env({ runServer: failing })
      await runRules([mk(mode as 'continue' | undefined)], rowEvent(), e)
      expect(calls).toEqual(expected)
    }
    const { e, calls, vars } = env({ runServer: failing })
    await runRules([mk('run')], rowEvent(), e)
    expect(calls).toEqual([])
    expect(vars.a).toBe('failed: API down')
  })

  it('confirm branches and unknown variables', async () => {
    const r = rule({ id: 'r', then: [{ type: 'confirm', title: 'Go?', then: [{ type: 'set_variable', values: [{ name: 'a', value: 'yes' }] }], else: [{ type: 'set_variable', values: [{ name: 'a', value: 'no' }] }] }] })
    const yes = env()
    await runRules([r], rowEvent(), yes.e)
    expect(yes.vars.a).toBe('yes')
    const no = env({ runClient: async () => false })
    await runRules([r], rowEvent(), no.e)
    expect(no.vars.a).toBe('no')
    const bad = env()
    await runRules([rule({ id: 'x', then: [{ type: 'set_variable', values: [{ name: 'ghost', value: '1' }] }] })], rowEvent(), bad.e)
    expect(bad.log.some((l) => l.kind === 'error' && /Unknown variable/.test(l.text))).toBe(true)
  })
})

describe('validation', () => {
  const known = { params: ['region'], vars: ['rowId'], filters: ['status'], widgets: new Map([['grid', { type: 'data_grid' }], ['btns', { type: 'actions' }]]), pages: ['home', 'details'], pageParams: new Map([['details', [{ name: 'customer', required: true, hasDefault: false }]]]) }
  it('reports unknown variables, widgets, filters, pages and unmapped required page parameters', () => {
    const r = rule({
      id: 'r', when: { type: 'row_click', widget: 'nope' },
      then: [
        { type: 'set_variable', values: [{ name: 'ghost', value: '{{var.other}} {{param.region}}' }] },
        { type: 'navigate', page_slug: 'details' },
        { type: 'set_enabled', widget: 'grid', enabled: false },
        { type: 'refresh', widgets: ['zzz'] },
        { type: 'set_filter', filter: 'missing', value: '' },
        { type: 'open_target', target: { kind: 'url', url: 'javascript:alert(1)' } },
      ],
    })
    const msgs = ruleProblems([r], known).map((p) => p.message)
    expect(msgs).toEqual(expect.arrayContaining([
      'The trigger’s widget “nope” is not on this page', 'Unknown variable “ghost”', 'Unknown variable “other”', 'The page “details” needs the parameter “customer”',
      '“grid” is not a Buttons widget', 'The widget “zzz” is not on this page', 'The filter “missing” is not on this page', 'Use an https:// address, mailto: or a path starting with /',
    ]))
    expect(msgs.some((m) => m.includes('region'))).toBe(false)
    expect(ruleProblems([rule({ id: 'ok', then: [{ type: 'navigate', page_slug: 'details', params: { customer: { from: 'variable', name: 'rowId' } } }] })], known)).toEqual([])
  })
})
