import { describe, expect, it } from 'vitest'
import {
  FORM_PARAMS_KEY, FORM_VARS_KEY, contextReferences, contextVariableOptions, formContextPath, formContextProblems, formParamsMessage, formUrlWithParams,
  includedContextSchema, includedFormContext, layoutFormParams, layoutFormVariables, normalizeFormParams, normalizeFormVariables, paramsFromQuery,
  parseFormParams, parseFormVariables, requiredParamsWithoutDefault, resolveContextParams, serverFormContext, stripFormContext, substituteParams,
  variableInitial, withFormContext, type FormParam,
} from '@/lib/forms/form-params'
import { compactLayoutForSave, normalizeFormLayout } from '@/lib/forms/layout'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { setPageMode } from '@/lib/forms/pages'
import { normalizeFieldButtonAction, runFieldButton, type FieldButtonHost } from '@/lib/forms/field-buttons'
import { formRuleProblem, normalizeFormRules, resolveRuleTemplate, ruleConditionsMet } from '@/lib/forms/form-rules'
import { interpolateButtonText, resolveInputTemplate } from '@/lib/forms/buttons'
import { resolveLookupTemplate } from '@/lib/forms/lookup'
import { resolveHeaderText } from '@/lib/forms/header'
import { buildFormSubmittedPayload } from '@/lib/forms/submitted-trigger'
import { mergeTaskFieldValues, RESERVED_FIELD_KEYS } from '@/lib/task-field-schema'

const PARAMS = [
  { name: 'customer', label: 'Customer', type: 'text', source: 'url', required: true, pattern: '[A-Z]{5}' },
  { name: 'region', type: 'text', source: 'url', query_name: 'r', default: 'EU', allowed: ['EU', 'US', 'APAC'] },
  { name: 'limit', type: 'number', source: 'url', min: 1, max: 50, default: '10' },
  { name: 'urgent', type: 'boolean', source: 'url' },
  { name: 'since', type: 'date', source: 'url', min: '2020-01-01' },
  { name: 'tags', type: 'text_list', source: 'url', max: 3 },
  { name: 'origin', type: 'text', source: 'context', include: true },
]
const VARIABLES = [
  { name: 'selected_order', type: 'number' },
  { name: 'note', type: 'text', initial: { kind: 'expression', value: 'For {{param.customer}}' }, include: true },
  { name: 'who', type: 'text', initial: { kind: 'param', value: 'customer' } },
  { name: 'row', type: 'object' },
  { name: 'flag', type: 'boolean', initial: { kind: 'constant', value: 'yes' } },
]
const LAYOUT = { rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }] }], params: PARAMS, variables: VARIABLES }
const params = normalizeFormParams(PARAMS)

describe('declarations', () => {
  it('normalizes names, types, sources and validation; drops unknown props, duplicates and reserved names', () => {
    const out = normalizeFormParams([
      ...PARAMS,
      { name: 'customer', type: 'number', source: 'url' },
      { name: 'Bad Name', type: 'text' },
      { name: 'param', type: 'text' },
      { name: '__proto__', type: 'text' },
      { name: 'weird', type: 'html', source: 'cookie', evil: '<script>', pattern: '(', label: '<b>x</b>' },
    ])
    expect(out.map((p) => p.name)).toEqual(['customer', 'region', 'limit', 'urgent', 'since', 'tags', 'origin', 'weird'])
    expect(out.find((p) => p.name === 'weird')).toEqual({ name: 'weird', type: 'text', source: 'url', label: 'bx/b' })
    expect(out.find((p) => p.name === 'region')).toMatchObject({ query_name: 'r', default: 'EU', allowed: ['EU', 'US', 'APAC'] })
    expect(out.find((p) => p.name === 'origin')).toMatchObject({ source: 'context', include: true })
  })

  it('variables cannot reuse a parameter name; initial values are kept by kind', () => {
    const out = normalizeFormVariables([...VARIABLES, { name: 'customer', type: 'text' }, { name: 'x', type: 'text', initial: { kind: 'param', value: 'Not A Name' } }], ['customer'])
    expect(out.map((v) => v.name)).toEqual(['selected_order', 'note', 'who', 'row', 'flag', 'x'])
    expect(out.find((v) => v.name === 'x')!.initial).toBeUndefined()
  })

  it('designer problems: bad defaults, crossed bounds, unknown parameter, include over a field key', () => {
    const problems = formContextProblems({
      rows: [],
      params: [{ name: 'n', type: 'number', source: 'url', default: 'abc' }, { name: 'name', type: 'text', source: 'url', include: true }, { name: 'b', type: 'number', source: 'url', min: 5, max: 1 }],
      variables: [{ name: 'v', type: 'text', initial: { kind: 'param', value: 'missing' } }],
    }, ['name'])
    expect(problems.join('\n')).toMatch(/"n": the default expected a number/)
    expect(problems.join('\n')).toMatch(/"name" has the same name as a field/)
    expect(problems.join('\n')).toMatch(/minimum is greater than maximum/)
    expect(problems.join('\n')).toMatch(/names a parameter "missing"/)
  })
})

describe('parsing and coercion', () => {
  it('reads URL parameters by their query name, coerces to the type, applies defaults', () => {
    const query = new URLSearchParams('customer=ALFKI&r=US&limit=25&urgent=yes&since=2024-02-29&tags=a,b&tags=c')
    const parsed = parseFormParams(params, paramsFromQuery(params, query))
    expect(parsed.values).toEqual({ customer: 'ALFKI', region: 'US', limit: 25, urgent: true, since: '2024-02-29', tags: ['a', 'b', 'c'], origin: null })
    expect(parsed.missing).toEqual([])
    expect(parsed.errors).toEqual({})
  })

  it('ignores unknown query parameters and never reads a context parameter from the URL', () => {
    const raw = paramsFromQuery(params, { customer: 'ALFKI', origin: 'evil', __proto__: 'x', region: 'US', table_id: 'other', base_filter: 'none' } as Record<string, string>)
    expect(raw).toEqual({ customer: 'ALFKI' })
    const parsed = parseFormParams(params, { ...raw, unknown: 'x', constructor: 'y' })
    expect(Object.keys(parsed.values).sort()).toEqual(params.map((p) => p.name).sort())
    expect(parsed.values.region).toBe('EU')
    expect(parsed.values.origin).toBeNull()
  })

  it('required parameters without a value are missing; defaults count as a value', () => {
    expect(parseFormParams(params, {}).missing).toEqual(['customer'])
    expect(parseFormParams(params, {}).values).toMatchObject({ region: 'EU', limit: 10 })
    expect(requiredParamsWithoutDefault(LAYOUT).map((p) => p.name)).toEqual(['customer'])
    expect(requiredParamsWithoutDefault({ rows: [], params: [{ name: 'a', type: 'text', source: 'url', required: true, default: 'x' }] })).toEqual([])
    expect(formParamsMessage(params, parseFormParams(params, {}))).toBe('This form needs the parameter "Customer".')
  })

  it('refuses values that do not fit the type or the validation (and falls back to the default)', () => {
    const parsed = parseFormParams(params, { customer: 'alfki', region: 'MARS', limit: '500', urgent: 'maybe', since: '2019-12-31', tags: 'a,b,c,d' })
    expect(Object.keys(parsed.errors).sort()).toEqual(['customer', 'limit', 'region', 'since', 'tags', 'urgent'])
    expect(parsed.values).toMatchObject({ customer: null, region: 'EU', limit: 10, urgent: null, since: null, tags: null })
    expect(parseFormParams(params, { since: '2023-02-30' }).errors.since).toMatch(/date/)
    expect(parseFormParams(params, { limit: '1e400' }).values.limit).toBe(10)
    expect(parseFormParams(params, { customer: 'A'.repeat(600) }).errors.customer).toMatch(/at most 500/)
    expect(parseFormParams(params, { customer: { $ne: 1 } }).errors.customer).toMatch(/expected text/)
  })

  it('variables: declared names only, typed, bounded', () => {
    const vars = layoutFormVariables(LAYOUT)
    expect(parseFormVariables(vars, { selected_order: '10248', flag: 'no', row: { id: 1 }, unknown: 'x', note: { a: 1 } })).toEqual({ selected_order: 10248, flag: false, row: { id: 1 }, note: null })
    expect(parseFormVariables(vars, { row: { blob: 'x'.repeat(30_000) } }).row).toBeNull()
  })
})

describe('form context in values', () => {
  it('fills defaults and initial values; what rules set wins; reset brings the initial value back', () => {
    const v = withFormContext(LAYOUT, { name: 'x', [FORM_PARAMS_KEY]: { customer: 'ALFKI' } }, new Date('2026-01-02T00:00:00Z'))
    expect(v[FORM_PARAMS_KEY]).toMatchObject({ customer: 'ALFKI', region: 'EU', limit: 10 })
    expect(v[FORM_VARS_KEY]).toEqual({ selected_order: null, note: 'For ALFKI', who: 'ALFKI', row: null, flag: true })
    const set = withFormContext(LAYOUT, { ...v, [FORM_VARS_KEY]: { ...(v[FORM_VARS_KEY] as object), who: 'BONAP', selected_order: '7' } })
    expect(set[FORM_VARS_KEY]).toMatchObject({ who: 'BONAP', selected_order: 7 })
    const { who: _w, ...rest } = set[FORM_VARS_KEY] as Record<string, unknown>
    expect((withFormContext(LAYOUT, { ...set, [FORM_VARS_KEY]: rest })[FORM_VARS_KEY] as Record<string, unknown>).who).toBe('ALFKI')
    expect(variableInitial({ name: 'd', type: 'date', initial: { kind: 'expression', value: '{{today}}' } }, {}, {}, new Date('2026-03-04T10:00:00Z'))).toBe('2026-03-04')
  })

  it('placeholders read {{param.x}} / {{var.x}} in rules, button text, lookups and headers', () => {
    const values = withFormContext(LAYOUT, { [FORM_PARAMS_KEY]: { customer: 'ALFKI' }, [FORM_VARS_KEY]: { selected_order: 10248 } })
    expect(formContextPath('param.customer')).toBe(`${FORM_PARAMS_KEY}.customer`)
    expect(formContextPath('var.x')).toBe(`${FORM_VARS_KEY}.x`)
    expect(formContextPath('form.x')).toBeNull()
    expect(resolveRuleTemplate('{{var.selected_order}}', { values })).toBe(10248)
    expect(ruleConditionsMet({ match: 'all', conditions: [{ column: 'param.customer', operator: 'eq', value: 'alfki' }] }, { values })).toBe(true)
    expect(resolveInputTemplate('{{param.limit}}', { values })).toBe(10)
    expect(interpolateButtonText('Order {{var.selected_order}} for {{param.customer}}', { values })).toBe('Order 10248 for ALFKI')
    expect(resolveLookupTemplate('{{param.customer}}', { search: '', values })).toBe('ALFKI')
    expect(resolveHeaderText('Orders of {{param.customer}}', values)).toBe('Orders of ALFKI')
    expect(contextReferences('{{param.customer}} {{var.row.id}} {{form.x}}')).toEqual([{ kind: 'param', name: 'customer' }, { kind: 'var', name: 'row' }])
  })

  it('placeholder menus list Parameters and Variables, typed', () => {
    const options = contextVariableOptions(LAYOUT)
    expect(options[0]).toEqual({ name: 'param.customer', group: 'Parameters', label: 'Customer · text' })
    expect(options.find((o) => o.name === 'var.row')).toEqual({ name: 'var.row', group: 'Variables', label: 'row · row / object' })
    expect(contextVariableOptions(LAYOUT, { variables: false }).every((o) => o.group === 'Parameters')).toBe(true)
  })
})

describe('the Set variable action', () => {
  function host(initial: Record<string, unknown>) {
    let values = { ...initial }
    const h: FieldButtonHost = {
      values: () => values, state: () => ({ flags: {}, hidden: [] }) as never, setValues: (patch) => { values = { ...values, ...patch } }, setState: () => {},
      flush: async () => {}, goTo: () => true, next: () => true, back: () => true, validate: () => true, submit: () => true, saveDraft: () => true, print: () => {},
      openLink: () => true, message: () => {}, editableKeys: new Set(['name']), blank: () => null,
    }
    return { h, get: () => values }
  }

  it('normalizes: a variable name, set / clear / reset, a template value', () => {
    expect(normalizeFieldButtonAction({ type: 'set_variable', variable: 'selected_order', value: '{{event.row.OrderID}}' }, { rule: true })).toEqual({ type: 'set_variable', variable: 'selected_order', variable_mode: 'set', value: '{{event.row.OrderID}}' })
    expect(normalizeFieldButtonAction({ type: 'set_variable', variable: 'Bad!', variable_mode: 'reset' }, { rule: true })).toEqual({ type: 'set_variable', variable_mode: 'reset' })
    // Buttons don't offer it; rules do.
    expect(normalizeFieldButtonAction({ type: 'set_variable', variable: 'x' })).toBeNull()
    const [rule] = normalizeFormRules([{ id: 'r1', event: 'row_click', target: 'orders', then: [{ type: 'set_variable', variable: 'selected_order', value: '{{event.row.OrderID}}' }] }])
    expect(rule.then[0].type).toBe('set_variable')
  })

  it('sets from the event, clears and resets; other values are untouched', async () => {
    const { h, get } = host({ name: 'n', [FORM_VARS_KEY]: { selected_order: 1, who: 'X' } })
    await runFieldButton({ actions: [
      { type: 'set_variable', variable: 'selected_order', variable_mode: 'set', value: '{{event.row.OrderID}}' },
      { type: 'set_variable', variable: 'note', variable_mode: 'set', value: 'Order {{event.row.OrderID}}' },
      { type: 'set_variable', variable: 'who', variable_mode: 'reset' },
      { type: 'set_variable', variable: 'row', variable_mode: 'set', value: '{{event.row}}' },
    ] }, h, { extras: { event: { row: { OrderID: 10248, ShipCity: 'Reims' } } } })
    expect(get()[FORM_VARS_KEY]).toEqual({ selected_order: 10248, note: 'Order 10248', row: { OrderID: 10248, ShipCity: 'Reims' } })
    expect(get().name).toBe('n')
    await runFieldButton({ actions: [{ type: 'set_variable', variable: 'selected_order', variable_mode: 'clear' }] }, h)
    expect((get()[FORM_VARS_KEY] as Record<string, unknown>).selected_order).toBeNull()
    // Typed when read: the form's view.
    expect((withFormContext(LAYOUT, get())[FORM_VARS_KEY] as Record<string, unknown>).who).toBeNull()
  })

  it('works inside a question\'s response branch (Yes sets a variable from {{param.x}}; No clears it)', async () => {
    const ask = normalizeFieldButtonAction({
      type: 'prompt', text: 'Use {{param.customer}}?',
      prompt: { id: 'use_customer', preset: 'yes_no', buttons: [
        { value: 'yes', label: 'Yes', then: [{ type: 'set_variable', variable: 'who', value: 'Customer {{param.customer}}' }], continue: true },
        { value: 'no', label: 'No', then: [{ type: 'set_variable', variable: 'who', variable_mode: 'clear' }] },
      ] },
    }, { rule: true })!
    expect(ask.prompt!.buttons!.find((b) => b.value === 'yes')!.then![0]).toMatchObject({ type: 'set_variable', variable: 'who' })
    for (const [answer, expected] of [['yes', 'Customer ALFKI'], ['no', null]] as const) {
      const { h, get } = host({ [FORM_PARAMS_KEY]: { customer: 'ALFKI' } })
      const asked: string[] = []
      h.ask = async (req) => { asked.push(String(req.text)); return answer }
      await runFieldButton({ actions: [ask] }, h)
      expect(asked).toEqual(['Use ALFKI?'])
      expect((get()[FORM_VARS_KEY] as Record<string, unknown>).who).toBe(expected)
    }
  })

  it('the designer flags an undeclared variable; API results may write var.<name>', () => {
    const known = { fieldKeys: new Set<string>(), valueKeys: new Set<string>(), fieldTypes: new Map(), pageIds: new Set<string>(), flags: new Set<string>(), variables: new Set(['selected_order']) }
    const rule = (then: unknown[]) => normalizeFormRules([{ id: 'r', event: 'form_load', then }])[0]
    expect(formRuleProblem(rule([{ type: 'set_variable', variable: 'nope' }]), known)).toMatch(/not a variable/)
    expect(formRuleProblem(rule([{ type: 'set_variable', variable: 'selected_order' }]), known)).toBeNull()
    const call = normalizeFieldButtonAction({ type: 'call_reference', reference_id: 'ref', results: { 'data.total': 'var.selected_order', 'data.x': 'var.Bad Name', 'data.y': 'http://evil' } }, { rule: true })!
    expect(call.results).toEqual({ 'data.total': 'var.selected_order' })
    expect(formRuleProblem(rule([call]), known)).toBeNull()
    expect(formRuleProblem(rule([{ ...call, results: { a: 'var.other' } }]), known)).toMatch(/not a variable/)
  })
})

describe('server validation', () => {
  it('re-parses what the request claims against the saved declarations', () => {
    const ctx = serverFormContext(LAYOUT, { values: { [FORM_PARAMS_KEY]: { customer: 'ALFKI', region: 'MARS', injected: 'x' }, [FORM_VARS_KEY]: { selected_order: 'abc', who: 'B', evil: 1 } } })
    expect(ctx.params).toMatchObject({ customer: 'ALFKI', region: 'EU' })
    expect(ctx.params).not.toHaveProperty('injected')
    expect(ctx.errors).toHaveProperty('region')
    expect(ctx.vars).toMatchObject({ selected_order: null, who: 'B' })
    expect(ctx.vars).not.toHaveProperty('evil')
    // Explicit params / variables win over the values' copies.
    expect(serverFormContext(LAYOUT, { params: { customer: 'BONAP' }, values: { [FORM_PARAMS_KEY]: { customer: 'ALFKI' } } }).params.customer).toBe('BONAP')
  })

  it('a task form uses the parameters its workflow passed, never the request’s', () => {
    const ctx = serverFormContext(LAYOUT, { params: { customer: 'EVILX' }, values: { [FORM_PARAMS_KEY]: { customer: 'EVILX', origin: 'browser' } } }, { storedParams: { customer: 'ALFKI', origin: 'workflow' } })
    expect(ctx.params).toMatchObject({ customer: 'ALFKI', origin: 'workflow' })
  })

  it('a step mapping resolves workflow templates, typed; defaults use {{param.x}}', () => {
    const resolved = resolveContextParams(LAYOUT, { customer: '{{cust}}', limit: '{{n}}', unknown: '{{x}}' }, (t) => ({ '{{cust}}': 'ALFKI', '{{n}}': '7', '{{x}}': 'y' } as Record<string, unknown>)[t])
    expect(resolved).toMatchObject({ customer: 'ALFKI', limit: 7, region: 'EU' })
    expect(resolved).not.toHaveProperty('unknown')
    expect(substituteParams('Hello {{param.customer}} {{other}}', resolved)).toBe('Hello ALFKI {{other}}')
  })

  it('included parameters / variables are stored under their names; never over a field', () => {
    const ctx = serverFormContext(LAYOUT, { values: { [FORM_PARAMS_KEY]: { customer: 'ALFKI', origin: 'run' } } })
    expect(includedFormContext(LAYOUT, ctx, ['name'])).toEqual({ origin: 'run', note: 'For ALFKI' })
    expect(includedFormContext(LAYOUT, ctx, ['origin'])).toEqual({ note: 'For ALFKI' })
    expect(includedContextSchema(LAYOUT).map((c) => `${c.kind}:${c.key}:${c.type}`)).toEqual(['param:origin:string', 'var:note:string'])
    expect(stripFormContext({ a: 1, [FORM_PARAMS_KEY]: {}, [FORM_VARS_KEY]: {} })).toEqual({ a: 1 })
    expect(RESERVED_FIELD_KEYS.has(FORM_PARAMS_KEY) && RESERVED_FIELD_KEYS.has(FORM_VARS_KEY)).toBe(true)
  })

  it('the Form submitted payload carries included values beside the fields', () => {
    const payload = buildFormSubmittedPayload({
      form: { id: 'f', name: 'F', version: 1 }, fields: [{ key: 'name', label: 'Name', type: 'text' }] as never,
      values: { name: 'x', origin: 'run', note: 'For ALFKI', secret: 'no' },
      submission: { id: 's', created_at: 'now', source: 'standalone' }, submitter: { id: null }, layout: LAYOUT,
    })
    expect(payload.form).toEqual({ name: 'x', origin: 'run', note: 'For ALFKI' })
  })

  it('task values: rules judge server-validated parameters; the reserved keys are never stored', () => {
    const meta = { fields: [{ key: 'name', label: 'Name', type: 'text', required: true }], form_layout: { ...LAYOUT, rules: [{ id: 'r1', event: 'always', if: { match: 'all', conditions: [{ column: 'param.customer', operator: 'eq', value: 'ALFKI' }] }, then: [{ type: 'show_hide', mode: 'hide', targets: ['field:name'] }] }] } }
    // Hidden for ALFKI (not required) — judged on the context the caller validated.
    expect(mergeTaskFieldValues(meta, { [FORM_PARAMS_KEY]: { customer: 'ALFKI' } }).errors).toEqual({})
    expect(mergeTaskFieldValues(meta, { [FORM_PARAMS_KEY]: { customer: 'BONAP' } }).errors).toHaveProperty('name')
    expect(mergeTaskFieldValues(meta, { name: 'x', [FORM_PARAMS_KEY]: { customer: 'BONAP' } }).templateValues).toEqual({ name: 'x' })
  })
})

describe('links', () => {
  it('builds a link with URL parameters only (encoded, blanks left out)', () => {
    expect(formUrlWithParams('https://app.example/f/1', params, { customer: 'ALFKI', region: 'US & EU', origin: 'ctx', tags: 'a, b', limit: '' }))
      .toBe('https://app.example/f/1?customer=ALFKI&r=US+%26+EU&tags=a%2C+b')
    expect(formUrlWithParams('https://app.example/f/1', params, {})).toBe('https://app.example/f/1')
  })
})

describe('portability and old forms', () => {
  it('layouts keep parameters and variables through normalize → compact → JSON → normalize, and a page-mode switch', () => {
    const def = normalizeFormDefinition({ fields: [{ key: 'name', label: 'Name', type: 'text' }], layout: LAYOUT })
    const stored = JSON.parse(JSON.stringify(compactLayoutForSave(def.layout!, ['name'])))
    expect(layoutFormParams(stored)).toEqual(params)
    expect(layoutFormVariables(stored)).toEqual(layoutFormVariables(LAYOUT))
    const again = normalizeFormLayout(stored, ['name'])!
    expect(again.params).toEqual(params)
    expect(again.variables?.length).toBe(5)
    const paged = setPageMode(again, 'steps')
    expect(paged.params).toEqual(params)
    expect(setPageMode(paged, 'single').variables?.length).toBe(5)
  })

  it('manifests (config as code, packages, GitHub sync) carry them; an id remap leaves them alone', async () => {
    const { normalizeFormAssetLikeImport } = await import('@/lib/portability/forms')
    const { createEmptyAssetIdMaps, remapKnownIds } = await import('@/lib/portability/id-maps')
    const { scanAssetReferences } = await import('@/lib/portability/dependencies')
    const REF = '22222222-2222-4222-8222-222222222222'
    const layout = { ...LAYOUT, rules: [{ id: 'r1', event: 'row_click', target: 'name', then: [{ type: 'call_reference', reference_id: REF, inputs: { id: '{{var.selected_order}}' }, results: { total: 'var.selected_order' } }] }] }
    const asset = normalizeFormAssetLikeImport({ id: 'f1', name: 'Orders', fields: [{ key: 'name', label: 'Name', type: 'text' }], layout })
    expect(asset.layout.params).toEqual(params)
    expect(asset.layout.variables).toEqual(layoutFormVariables(LAYOUT))
    const def = normalizeFormDefinition({ fields: asset.fields, layout: JSON.parse(JSON.stringify(asset.layout)) })
    expect(scanAssetReferences(def).refs.some((r) => r.type === 'reference' && r.id === REF)).toBe(true)
    const maps = createEmptyAssetIdMaps()
    maps.reference[REF] = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const remapped = normalizeFormDefinition(remapKnownIds(def, maps) as never)
    expect(remapped.layout!.params).toEqual(params)
    expect(remapped.layout!.variables).toEqual(def.layout!.variables)
    expect(remapped.layout!.rules![0].then[0]).toMatchObject({ reference_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', results: { total: 'var.selected_order' } })
  })

  it('a trivial grid with only parameters is still stored', () => {
    expect(compactLayoutForSave({ rows: [{ columns: 1, cells: [{ field_key: 'a', span: 1 }] }], params: params.slice(0, 1) }, ['a'])).toEqual({ rows: [{ columns: 1, cells: [{ field_key: 'a', span: 1 }] }], params: params.slice(0, 1) })
  })

  it('old forms are unaffected: no new keys, values untouched, resolvers as before', () => {
    const old = { rows: [{ columns: 1, cells: [{ field_key: 'a', span: 1 }] }] }
    expect(normalizeFormLayout(old, ['a'])).toEqual(old)
    expect(compactLayoutForSave(normalizeFormLayout(old, ['a'])!, ['a'])).toBeNull()
    const values = { a: 1 }
    expect(withFormContext(old, values)).toBe(values)
    expect(serverFormContext(old, { values: { [FORM_PARAMS_KEY]: { x: 1 } } }).entries).toEqual({})
    expect(resolveRuleTemplate('{{a}} {{param.x}}', { values })).toBe('1 ')
  })
})

export const _types: FormParam | null = null
