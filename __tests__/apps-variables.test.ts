import { describe, expect, it } from 'vitest'
import {
  bindingKeys, bindingValues, coerceValue, dateInZone, evaluateExpression, initialVariables, paramsFromQuery, resolveParamValues, resolveTemplate, systemVariables,
  templateHtml, templateRefs, templateText, urlVariablesFromQuery, zonedDates, normaliseParams, normaliseVariables, type AppScope,
} from '@/lib/apps/variables'
import { resolveParams, resolveValue, valueSourceSchema } from '@/lib/apps/params'
import { normalisePageLayout, pageLayoutSchema, appCreateSchema } from '@/lib/apps/schema'

const sys = systemVariables({
  user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', teams: [{ id: 't1', name: 'Sales' }], roles: [{ id: 'r1', name: 'Manager' }], timezone: 'Pacific/Auckland', manager: { id: 'm1', name: 'Boss', email: 'boss@example.com' } },
  workspace: { id: 'w1', name: 'Acme' }, app: { id: 'a1', slug: 'crm', name: 'CRM' }, page: { id: 'p1', slug: 'home', name: 'Home' },
  query: { ref: 'abc' }, mobile: true, app_role: 'contributor', now: new Date('2026-11-21T20:00:00Z'),
})
const scope = (extra: Partial<AppScope> = {}): AppScope => ({ param: { customer: 'C-1', qty: 3 }, var: { rowId: 'r-9', items: ['a', 'b'] }, sys, filter: { status: 'open' }, ...extra })

describe('typing', () => {
  it('coerces each type, rejecting what does not fit', () => {
    expect(coerceValue('number', '12.5')).toBe(12.5)
    expect(coerceValue('number', 'x')).toBeUndefined()
    expect(coerceValue('boolean', 'yes')).toBe(true)
    expect(coerceValue('boolean', 'maybe')).toBeUndefined()
    expect(coerceValue('date', '2026-02-30')).toBe('2026-02-30'.replace('30', '30')) // parse accepts; month overflow is the date engine's concern
    expect(coerceValue('date', 'tomorrow')).toBeUndefined()
    expect(coerceValue('list', 'a, b,c')).toEqual(['a', 'b', 'c'])
    expect(coerceValue('list', '[1,2]')).toEqual([1, 2])
    expect(coerceValue('record', '{"a":1}')).toEqual({ a: 1 })
    expect(coerceValue('record', '[1]')).toBeUndefined()
    expect(coerceValue('text', '')).toBeNull()
  })

  it('resolves parameters: given values typed, defaults (templates) and required problems', () => {
    const decls = normaliseParams([
      { name: 'customer', type: 'text', required: true },
      { name: 'qty', type: 'number', default: 1 },
      { name: 'owner', type: 'text', default: '{{sys.user.id}}' },
      { name: 'flag', type: 'boolean' },
    ])
    const r = resolveParamValues(decls, { qty: 'lots', flag: 'true' }, scope())
    expect(r.values).toEqual({ customer: null, qty: 1, owner: 'u1', flag: true })
    expect(r.problems.map((p) => p.name).sort()).toEqual(['customer', 'qty'])
  })

  it('reads parameters and URL variables from the query, declared names only', () => {
    const q = new URLSearchParams('p.customer=C-7&p.other=x&v.tab=2&v.secret=1')
    expect(paramsFromQuery(normaliseParams([{ name: 'customer' }]), (k) => q.get(k))).toEqual({ customer: 'C-7' })
    const vars = normaliseVariables([{ name: 'tab', type: 'number', url: true }, { name: 'secret', type: 'number' }])
    expect(urlVariablesFromQuery(vars, (k) => q.get(k))).toEqual({ tab: 2 })
    expect(initialVariables(normaliseVariables([{ name: 'who', default: '{{sys.user.name}}' }]), scope())).toEqual({ who: 'Ada Lovelace' })
  })

  it('drops invalid / duplicate declarations', () => {
    expect(normaliseVariables([{ name: '1bad' }, { name: 'ok' }, { name: 'ok' }]).map((v) => v.name)).toEqual(['ok'])
  })
})

describe('system variables', () => {
  it('computes dates in the viewer timezone', () => {
    // 20:00 UTC on Nov 21 is Nov 22 in Auckland (UTC+13).
    expect(sys.today).toBe('2026-11-22')
    expect(dateInZone(new Date('2026-11-21T20:00:00Z'), 'America/Los_Angeles')).toBe('2026-11-21')
    expect(dateInZone(new Date('2026-11-21T20:00:00Z'), 'Not/AZone')).toBe('2026-11-21')
    const d = zonedDates(new Date('2026-11-21T20:00:00Z'), 'Pacific/Auckland')
    expect(d).toEqual({ today: '2026-11-22', start_of_week: '2026-11-16', start_of_month: '2026-11-01', end_of_month: '2026-11-30' })
    expect(zonedDates(new Date('2026-02-10T12:00:00Z'), 'UTC', 0).start_of_week).toBe('2026-02-08')
    expect(zonedDates(new Date('2028-02-10T12:00:00Z'), 'UTC').end_of_month).toBe('2028-02-29')
  })

  it('exposes user, workspace, app, page, url, device and role', () => {
    expect(sys.user).toMatchObject({ id: 'u1', teams: ['Sales'], team_ids: ['t1'], roles: ['Manager'], manager: { id: 'm1' }, timezone: 'Pacific/Auckland' })
    expect(sys.workspace.name).toBe('Acme')
    expect(sys.url.ref).toBe('abc')
    expect(sys.device.mobile).toBe(true)
    expect(sys.app_role).toBe('contributor')
  })
})

describe('templates and expressions', () => {
  it('resolves single placeholders to raw values and mixed text to text', () => {
    expect(resolveTemplate('{{param.qty}}', scope())).toBe(3)
    expect(resolveTemplate('{{var.items}}', scope())).toEqual(['a', 'b'])
    expect(resolveTemplate('Order {{param.customer}} for {{sys.user.name}}', scope())).toBe('Order C-1 for Ada Lovelace')
    expect(resolveTemplate('{{event.row.id}}', scope({ event: { row: { id: 'x1' } } }))).toBe('x1')
    expect(resolveTemplate('{{result.name}}', scope({ result: { name: 'Acme Ltd' } }))).toBe('Acme Ltd')
    expect(templateText('{{var.items}}', scope())).toBe('a, b')
  })

  it('evaluates expressions with the label expression engine', () => {
    expect(resolveTemplate('{{= param.qty * 2 }}', scope())).toBe(6)
    expect(evaluateExpression('CONCAT(sys.user.name, " - ", filter.status)', scope()).value).toBe('Ada Lovelace - open')
    expect(evaluateExpression('nosuchthing(', scope()).error).toBeTruthy()
  })

  it('mixes {{= expressions}} with {{placeholders}} in one text', () => {
    expect(resolveTemplate('Hello {{sys.user.name}}, you have {{= param.qty * 2 }} items', scope())).toBe('Hello Ada Lovelace, you have 6 items')
    expect(resolveTemplate('{{= param.qty + 1 }} of {{param.customer}}', scope())).toBe('4 of C-1')
    expect(resolveTemplate('{{= param.qty }} and {{= param.qty * 10 }}', scope())).toBe('3 and 30')
    expect(templateText('Pipeline for {{sys.workspace.name}}: {{= CONCAT("FY", "27") }}', scope())).toBe('Pipeline for Acme: FY27')
    // A placeholder nested in an expression, and braces inside quotes.
    expect(resolveTemplate('Total: {{= {{param.qty}} * 3 }} ({{filter.status}})', scope())).toBe('Total: 9 (open)')
    expect(resolveTemplate('Say {{= CONCAT("}}", param.customer) }}!', scope())).toBe('Say }}C-1!')
    // A whole-text expression still returns the raw value.
    expect(resolveTemplate('  {{= param.qty * 2 }}  ', scope())).toBe(6)
    const esc = (t: string) => t.replace(/</g, '&lt;')
    expect(templateHtml('<p>{{sys.user.name}}: {{= {{param.qty}} * 2 }} <b>{{= CONCAT("<", "x") }}</b></p>', scope(), esc)).toBe('<p>Ada Lovelace: 6 <b>&lt;x</b></p>')
    expect(templateRefs('Hi {{sys.user.name}} {{= var.qty * param.price }}')).toMatchObject({ vars: ['qty'], params: ['price'] })
  })

  it('evaluates the standard date functions, NOW() included', () => {
    const now = evaluateExpression('NOW()', scope()).value
    expect(typeof now).toBe('string')
    expect(Number.isNaN(Date.parse(String(now)))).toBe(false)
    expect(evaluateExpression('NOW()', scope()).error).toBeUndefined()
    expect(resolveTemplate('{{= YEAR(NOW()) }}', scope())).toBe(new Date().getUTCFullYear())
    expect(resolveTemplate('{{= DATE_DIFF(sys.start_of_month, sys.end_of_month) }}', scope())).toBe(29)
    expect(typeof resolveTemplate('{{= FORMAT_DATE(NOW(), "YYYY") }}', scope())).toBe('string')
    expect(resolveTemplate('Updated {{= FORMAT_DATE(TODAY(), "YYYY") }}', scope())).toMatch(/^Updated \d{4}$/)
  })

  it('lists the params and variables a template reads', () => {
    expect(templateRefs('{{var.rowId}} {{param.customer}} {{sys.today}}')).toMatchObject({ vars: ['rowId'], params: ['customer'] })
    expect(templateRefs('{{= var.qty * param.price }}')).toMatchObject({ vars: ['qty'], params: ['price'] })
  })
})

describe('bindings', () => {
  it('finds binding keys in widget configs and resolves their values', () => {
    const config = { table_id: { filter: 'var.tableId' }, search: { filter: 'param.customer' }, team: { filter: 'team' }, reference_inputs: { email: '{{filter:sys.user.email}}' } }
    expect(bindingKeys(config).sort()).toEqual(['param.customer', 'sys.user.email', 'var.tableId'])
    expect(bindingValues(['param.customer', 'var.items', 'var.none'], scope())).toEqual({ 'param.customer': 'C-1', 'var.items': 'a,b', 'var.none': null })
  })
})

describe('value sources (form parameter mapping)', () => {
  it('reads params, variables, extended system keys and expressions from the scope', () => {
    const s = scope()
    expect(resolveValue({ from: 'variable', name: 'rowId' }, { filters: {}, scope: s })).toBe('r-9')
    expect(resolveValue({ from: 'param', name: 'qty' }, { filters: {}, scope: s })).toBe('3')
    expect(resolveValue({ from: 'system', key: 'workspace_name' }, { filters: {}, scope: s })).toBe('Acme')
    expect(resolveValue({ from: 'system', key: 'user_roles' }, { filters: {}, scope: s })).toBe('Manager')
    expect(resolveValue({ from: 'system', key: 'url_param', param: 'ref' }, { filters: {}, scope: s })).toBe('abc')
    expect(resolveValue({ from: 'expression', expr: '{{= param.qty + 1 }}' }, { filters: {}, scope: s })).toBe('4')
    expect(resolveValue({ from: 'expression', expr: 'Row {{event.id}}' }, { filters: {}, scope: s, event: { id: 'e1' } })).toBe('Row e1')
    expect(resolveParams({ a: { from: 'variable', name: 'rowId' }, b: { from: 'variable', name: 'nope' } }, { filters: {}, scope: s })).toEqual({ a: 'r-9' })
    // Without a scope the Phase 2 behaviour stands.
    expect(resolveValue({ from: 'param', name: 'qty' }, { filters: {} })).toBeNull()
    expect(valueSourceSchema.safeParse({ from: 'expression', expr: 'x'.repeat(1001) }).success).toBe(false)
  })
})

describe('schema', () => {
  it('keeps params, variables and rules on a page layout and drops invalid entries', () => {
    const layout = normalisePageLayout({ widgets: [], params: [{ name: 'customer' }, { name: '' }], variables: [{ name: 'rowId', url: true }], rules: [{ id: 'r1', when: { type: 'page_loaded' }, then: [] }, { id: 'bad' }] })
    expect(layout.params?.map((p) => p.name)).toEqual(['customer'])
    expect(layout.variables?.[0]).toMatchObject({ name: 'rowId', url: true, type: 'text' })
    expect(layout.rules?.map((r) => r.id)).toEqual(['r1'])
    expect(pageLayoutSchema.safeParse({ widgets: [], variables: [{ name: 'a' }, { name: 'a' }] }).success).toBe(false)
    expect(appCreateSchema.safeParse({ name: 'X', params: [{ name: 'p', type: 'number', default: 2 }], variables: [{ name: 'v', type: 'list' }] }).success).toBe(true)
  })
})
