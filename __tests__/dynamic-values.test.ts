import { describe, expect, it } from 'vitest'
import {
  applyDynamicValues, bindingDependencies, bindingInputs, bindingQueryConfig, bindingRowLimit, coerceDynamicValue, dynamicBindingProblems, expectedType, fieldPropType,
  isBindableProp, normalizeDynamicBinding, normalizeDynamicBindings, resolveExpression, restrictsToList, shapeRows, DYNAMIC_LIMITS,
  type DynamicBindings, type TableBinding,
} from '@/lib/forms/dynamic-values'
import { fieldDefinitionProblems, normalizeTaskFields, validateTaskFieldValues, type TaskFieldDef } from '@/lib/task-field-schema'
import { parseFormControlManifest } from '@/lib/forms/custom-controls/manifest'
import { anonymousReadiness, anonymousWarnings } from '@/lib/forms/anonymous'
import { FORM_PARAMS_KEY, FORM_VARS_KEY } from '@/lib/forms/form-params'
import { hostMessage } from '@/lib/forms/custom-controls/bridge'

const TABLE = 'cccccccc-0000-4000-8000-000000000001'

const countries: TableBinding = {
  kind: 'table', table_id: TABLE, value: 'code', label: 'name',
  base_filter: { match: 'all', conditions: [{ column: 'region', operator: 'eq', value: '{{param.region}}' }] },
  sort: [{ column: 'name', direction: 'asc' }], limit: 300,
}

describe('the binding model round trip', () => {
  const raw = [
    { key: 'country', label: 'Country', type: 'choice', options: ['NZ'], dynamic: { options: countries } },
    { key: 'qty', label: 'Quantity', type: 'number', max: 10, dynamic: { max: { kind: 'expr', expr: '{{var.limit}}' } } },
    { key: 'chart', label: 'Chart', type: 'custom', custom: { tag: 'ut-chart', version: '1.2.0', value_type: 'json', props: { data: [] } },
      dynamic: { 'props.data': { kind: 'reference', reference_id: 'ref-1', input_mappings: { region: '{{param.region}}' }, results_path: 'items', columns: [{ key: 'month', as: 'label' }, { key: 'total', as: 'value' }], expects: 'any' } } },
  ]

  it('survives normalise → JSON → normalise unchanged (versions, exports, packages, API all store the JSON)', () => {
    const once = normalizeTaskFields(raw)
    const twice = normalizeTaskFields(JSON.parse(JSON.stringify(once)))
    expect(twice).toEqual(once)
    expect(once[0].dynamic?.options).toEqual(countries)
    expect(once[1].dynamic?.max).toEqual({ kind: 'expr', expr: '{{var.limit}}' })
    expect(once[2].dynamic?.['props.data']).toMatchObject({ kind: 'reference', results_path: 'items', expects: 'any', columns: [{ key: 'month', as: 'label' }, { key: 'total', as: 'value' }] })
    // The static value stays beside it (the preview and the fallback).
    expect(once[0].options).toEqual(['NZ'])
    expect(once[1].max).toBe(10)
  })

  it('old forms are unaffected: no `dynamic` key appears', () => {
    const fields = normalizeTaskFields([{ key: 'a', label: 'A', type: 'choice', options: ['x', 'y'], options_source: { table_id: TABLE, column: 'name' } }, { key: 'n', label: 'N', type: 'number', max: 3 }])
    expect(fields.every((f) => !('dynamic' in f))).toBe(true)
    expect(fields[0].options_source).toEqual({ table_id: TABLE, column: 'name' })
  })

  it('drops what can not be bound: a property the type lacks, custom props on a built-in field, bad bindings, unsafe paths', () => {
    const [f] = normalizeTaskFields([{ key: 't', label: 'T', type: 'text', dynamic: {
      options: { kind: 'expr', expr: '{{x}}' }, max: { kind: 'expr', expr: '1' }, 'props.data': { kind: 'expr', expr: '1' },
      placeholder: { kind: 'expr', expr: 'Hi {{user.name}}', expects: 'number' }, help_text: { kind: 'nope' }, label: { kind: 'expr', expr: '   ' },
      default: { kind: 'table', table_id: TABLE, value: '__proto__' },
    } }])
    expect(Object.keys(f.dynamic ?? {})).toEqual(['placeholder', 'default'])
    // A built-in property's type is the property's (a stored `expects` never changes it).
    expect(f.dynamic?.placeholder).toEqual({ kind: 'expr', expr: 'Hi {{user.name}}' })
    expect((f.dynamic?.default as TableBinding).value).toBeUndefined()
    expect(normalizeDynamicBinding({ kind: 'table', table_id: TABLE, base_filter: { match: 'all', conditions: [{ column: 'a.b', operator: 'eq', value: '1' }] } })).toEqual({ kind: 'table', table_id: TABLE })
    expect(normalizeDynamicBinding({ kind: 'reference', reference_id: 'r', input_mappings: { __proto__: 'x', ok: '{{param.a}}' } })).toEqual({ kind: 'reference', reference_id: 'r', input_mappings: { ok: '{{param.a}}' } })
    expect(normalizeDynamicBinding({ kind: 'table', table_id: TABLE, limit: 99_999 })).toMatchObject({ limit: DYNAMIC_LIMITS.rows })
  })

  it('which properties are bindable on which fields', () => {
    expect(fieldPropType({ type: 'choice' }, 'options')).toBe('options')
    expect(fieldPropType({ type: 'multi_choice' }, 'default')).toBe('string_list')
    expect(fieldPropType({ type: 'number' }, 'max')).toBe('number')
    expect(fieldPropType({ type: 'date' }, 'min_date')).toBe('date')
    expect(fieldPropType({ type: 'text' }, 'required')).toBe('boolean')
    expect(fieldPropType({ type: 'choice', display: 'radio' }, 'placeholder')).toBeNull()
    expect(fieldPropType({ type: 'heading' }, 'label')).toBeNull()
    // Label fields: the caption, help text and default may be dynamic — never options, bounds or required.
    expect(['label', 'help_text', 'default', 'options', 'min', 'max', 'required', 'placeholder'].map((p) => fieldPropType({ type: 'label' }, p)))
      .toEqual(['string', 'string', 'string', null, null, null, null, null])
    const [label] = normalizeTaskFields([{ key: 'total', label: 'Total', type: 'label', label_config: { expression: '{{form.qty}} * 2' },
      dynamic: { label: { kind: 'expr', expr: 'Total ({{param.region}})' }, options: { kind: 'expr', expr: 'a,b' }, max: { kind: 'expr', expr: '5' } } }])
    expect(label.dynamic).toEqual({ label: { kind: 'expr', expr: 'Total ({{param.region}})' } })
    expect(fieldPropType({ type: 'text' }, 'options')).toBeNull()
    expect(expectedType({ type: 'custom' }, 'props.max', { kind: 'expr', expr: '5', expects: 'number' })).toBe('number')
    expect(expectedType({ type: 'text' }, 'props.max')).toBeNull()
  })

  it('manifest props: `bindable` is kept; without it data-shaped props are bindable, choices / colours are not', () => {
    const m = parseFormControlManifest({
      tag: 'x-c', name: 'X', version: '1.0.0', entry: 'x.js', value: { type: 'json' },
      props: [{ name: 'data', type: 'json', bindable: true }, { name: 'kind', type: 'select', options: ['a'] }, { name: 'n', type: 'number', bindable: false }, { name: 'heading_text', type: 'string' }],
    })
    expect(m.props.map((p) => [p.name, isBindableProp(p)])).toEqual([['data', true], ['kind', false], ['n', false], ['heading_text', true]])
  })

  it('problems the designer flags', () => {
    expect(dynamicBindingProblems({ type: 'choice', dynamic: { options: { kind: 'table', table_id: TABLE } } })).toEqual({ options: 'Choose the column holding the option value' })
    expect(dynamicBindingProblems({ type: 'custom', dynamic: { 'props.rows': { kind: 'table', table_id: TABLE, expects: 'list' } } })).toEqual({ 'props.rows': 'Choose the columns each item keeps' })
    const [f] = normalizeTaskFields([{ key: 'c', label: 'C', type: 'choice', options: [], dynamic: { options: countries } }])
    expect(fieldDefinitionProblems([f])).toEqual({})
  })
})

describe('type checks', () => {
  it('coerces to what the property expects, or says why not', () => {
    expect(coerceDynamicValue('number', '1,250')).toEqual({ ok: true, value: 1250 })
    expect(coerceDynamicValue('number', 'abc')).toMatchObject({ ok: false })
    expect(coerceDynamicValue('boolean', 'yes')).toEqual({ ok: true, value: true })
    expect(coerceDynamicValue('boolean', 'maybe')).toMatchObject({ ok: false })
    expect(coerceDynamicValue('date', '2026-12-01')).toEqual({ ok: true, value: '2026-12-01' })
    expect(coerceDynamicValue('date', 'soon')).toMatchObject({ ok: false })
    expect(coerceDynamicValue('string', { a: 1 })).toMatchObject({ ok: false })
    expect(coerceDynamicValue('options', 'NZ, AU, NZ')).toEqual({ ok: true, value: [{ value: 'NZ', label: 'NZ' }, { value: 'AU', label: 'AU' }] })
    expect(coerceDynamicValue('options', [{ value: 1, label: 'One' }, 'two'])).toEqual({ ok: true, value: [{ value: '1', label: 'One' }, { value: 'two', label: 'two' }] })
    expect(coerceDynamicValue('options', 5)).toMatchObject({ ok: false })
    expect(coerceDynamicValue('string_list', '["a","b"]')).toEqual({ ok: true, value: ['a', 'b'] })
    expect(coerceDynamicValue('list', '[{"label":"Jan","value":3}]')).toEqual({ ok: true, value: [{ label: 'Jan', value: 3 }] })
    expect(coerceDynamicValue('list', { a: 1 })).toMatchObject({ ok: false, error: 'Expected a list' })
    expect(coerceDynamicValue('object', [1])).toMatchObject({ ok: false })
    expect(coerceDynamicValue('any', 'x'.repeat(70_000))).toMatchObject({ ok: false })
    expect(coerceDynamicValue('number', '')).toEqual({ ok: true, value: undefined })
  })

  it('shapes rows into options, lists, objects and scalars (renamed columns, capped)', () => {
    const rows = [{ code: 'NZ', name: 'New Zealand', pop: 5 }, { code: 'AU', name: 'Australia', pop: 26 }, { code: 'NZ', name: 'dup', pop: 0 }]
    expect(shapeRows(countries, rows, 'options')).toEqual({ ok: true, value: [{ value: 'NZ', label: 'New Zealand' }, { value: 'AU', label: 'Australia' }] })
    expect(shapeRows({ kind: 'table', table_id: TABLE, value: 'name' }, rows, 'string_list')).toEqual({ ok: true, value: ['New Zealand', 'Australia', 'dup'] })
    expect(shapeRows({ kind: 'table', table_id: TABLE, columns: [{ key: 'name', as: 'label' }, { key: 'pop', as: 'value' }] }, rows.slice(0, 2), 'list'))
      .toEqual({ ok: true, value: [{ label: 'New Zealand', value: 5 }, { label: 'Australia', value: 26 }] })
    expect(shapeRows({ kind: 'table', table_id: TABLE, value: 'pop' }, rows, 'number')).toEqual({ ok: true, value: 5 })
    expect(shapeRows({ kind: 'table', table_id: TABLE, value: 'name' }, rows, 'number')).toMatchObject({ ok: false })
    expect(bindingRowLimit(countries, 'options')).toBe(300)
    expect(bindingRowLimit({ kind: 'table', table_id: TABLE }, 'options')).toBe(DYNAMIC_LIMITS.options)
    expect(bindingRowLimit({ kind: 'table', table_id: TABLE, limit: 1000 }, 'options')).toBe(DYNAMIC_LIMITS.options)
    expect(bindingRowLimit({ kind: 'table', table_id: TABLE, limit: 5000 }, 'list')).toBe(DYNAMIC_LIMITS.rows)
    expect(bindingRowLimit({ kind: 'table', table_id: TABLE, limit: 50 }, 'number')).toBe(1)
  })

  it('a source binding becomes a read-only Data table config: the declared columns only', () => {
    const config = bindingQueryConfig({ ...countries, open_access: true, anonymous_read: true }, { code: 'text', name: 'text' })
    expect(config).toMatchObject({ source: 'table', mode: 'display', table_id: TABLE, open_access: true, anonymous_read: true, base_filter: countries.base_filter, sort: countries.sort })
    expect(config.columns.map((c) => c.key)).toEqual(['code', 'name'])
  })
})

describe('expressions and dependencies', () => {
  const values = { qty: 2, [FORM_PARAMS_KEY]: { region: 'Oceania' }, [FORM_VARS_KEY]: { limit: 7 } }
  it('one whole placeholder keeps its raw value; bare {{field}} reads a field; text interpolates', () => {
    expect(resolveExpression('{{var.limit}}', { values })).toBe(7)
    expect(resolveExpression('{{qty}}', { values })).toBe(2)
    expect(resolveExpression('Ships to {{param.region}}', { values })).toBe('Ships to Oceania')
    expect(resolveExpression('{{today+1d}}', { values, now: new Date('2026-11-04T10:00:00Z') })).toBe('2026-11-05')
    expect(resolveExpression('{{user.email}}', { values, user: { email: 'a@b.co' } })).toBe('a@b.co')
  })
  it('re-query keys: the fields, parameters and variables a binding reads', () => {
    expect(bindingDependencies(countries)).toEqual([FORM_PARAMS_KEY])
    expect(bindingDependencies({ kind: 'expr', expr: '{{var.limit}} {{form.qty}} {{country}} {{today}}' }).sort()).toEqual([FORM_VARS_KEY, 'country', 'qty'].sort())
    expect(bindingDependencies({ kind: 'reference', reference_id: 'r', input_mappings: { q: '{{control.orders.selected_row_id}}' } })).toEqual(['__form_controls'])
  })
})

describe('applying resolved values; validation and back-compat', () => {
  const [choice, qty] = normalizeTaskFields([
    { key: 'country', label: 'Country', type: 'choice', options: ['NZ'], dynamic: { options: countries } },
    { key: 'qty', label: 'Quantity', type: 'number', max: 100, dynamic: { max: { kind: 'expr', expr: '{{var.limit}}' }, required: { kind: 'expr', expr: '{{param.must}}' } } },
  ])

  it('replaces the static values and removes the applied bindings', () => {
    const c = applyDynamicValues(choice, { options: [{ value: 'AU', label: 'Australia' }, { value: 'FJ', label: 'FJ' }] })
    expect(c.options).toEqual(['AU', 'FJ'])
    expect(c.option_labels).toEqual({ AU: 'Australia' })
    expect(c.dynamic).toBeUndefined()
    const q = applyDynamicValues(qty, { max: 7, required: true })
    expect(q).toMatchObject({ max: 7, required: true })
    expect(applyDynamicValues(qty, { max: undefined }).max).toBe(100)
    expect(applyDynamicValues(qty, { max: 7 }).dynamic).toEqual({ required: { kind: 'expr', expr: '{{param.must}}' } })
    // A source that found nothing offers no options (never the static preview list).
    expect(applyDynamicValues(choice, { options: [] }).options).toEqual([])
  })

  it('custom control props are delivered as ordinary prop values', () => {
    const [chart] = normalizeTaskFields([{ key: 'chart', label: 'Chart', type: 'custom', custom: { tag: 'ut-chart', version: '1.2.0', value_type: 'json', props: { chart_type: 'bar', data: [] } }, dynamic: { 'props.data': { kind: 'expr', expr: '{{var.series}}', expects: 'any' } } }])
    const out = applyDynamicValues(chart, { 'props.data': [{ label: 'Jan', value: 3 }] })
    expect(out.custom?.props).toEqual({ chart_type: 'bar', data: [{ label: 'Jan', value: 3 }] })
    expect(out.dynamic).toBeUndefined()
  })

  it('resolved options and bounds are what validation judges', () => {
    const resolved = [applyDynamicValues(choice, { options: [{ value: 'AU', label: 'Australia' }] }), applyDynamicValues(qty, { max: 7 })]
    expect(validateTaskFieldValues(resolved, { country: 'NZ', qty: 8 })).toEqual({ country: expect.stringContaining('must be one of: AU'), qty: 'Quantity must be at most 7' })
    expect(validateTaskFieldValues(resolved, { country: 'AU', qty: 7 })).toEqual({})
  })

  it('unresolved dynamic options are not judged against the static preview list (the server resolves them)', () => {
    expect(validateTaskFieldValues([choice], { country: 'AU' })).toEqual({})
    const [multi] = normalizeTaskFields([{ key: 'm', label: 'M', type: 'multi_choice', options: ['a'], dynamic: { options: countries } }])
    expect(validateTaskFieldValues([multi], { m: ['x', 'y'] })).toEqual({})
  })

  it('back-compat: static options and options_source fields validate exactly as before', () => {
    const fields = normalizeTaskFields([{ key: 'a', label: 'A', type: 'choice', options: ['x'], options_source: { table_id: TABLE, column: 'name' } }, { key: 'b', label: 'B', type: 'choice', options: ['p', 'q'] }])
    expect(validateTaskFieldValues(fields, { a: 'z', b: 'r' })).toEqual({ a: 'A must be one of: x', b: 'B must be one of: p, q' })
    expect(validateTaskFieldValues(fields, { a: 'x', b: 'q' })).toEqual({})
  })

  it('restrict to the list: on by default; off only for a source binding that says so', () => {
    expect(restrictsToList(undefined)).toBe(true)
    expect(restrictsToList(countries)).toBe(true)
    expect(restrictsToList({ ...countries, restrict: false })).toBe(false)
    expect(restrictsToList({ kind: 'expr', expr: 'a,b' })).toBe(true)
  })
})

describe('anonymous forms', () => {
  it('the designer warns about a source binding without "Allow anonymous read"', () => {
    const fields = normalizeTaskFields([
      { key: 'country', label: 'Country', type: 'choice', options: [], dynamic: { options: countries } as DynamicBindings },
      { key: 'city', label: 'City', type: 'choice', options: [], dynamic: { options: { ...countries, anonymous_read: true } } as DynamicBindings },
      { key: 'qty', label: 'Qty', type: 'number', dynamic: { max: { kind: 'expr', expr: '{{param.max}}' } } },
    ]) as TaskFieldDef[]
    const r = anonymousReadiness({ fields })
    expect(r.sources).toEqual([
      { key: 'country', label: 'Country', kind: 'dynamic', allowed: false, prop: 'options' },
      { key: 'city', label: 'City', kind: 'dynamic', allowed: true, prop: 'options' },
    ])
    const warnings = anonymousWarnings(r, { uploads: false })
    expect(warnings).toContain('"Country": the source of its dynamic options is not readable by anonymous visitors, so it resolves empty: turn on "Allow anonymous read" on that binding.')
    expect(warnings.some((w) => w.startsWith('"City": the source of its dynamic options is readable by anyone'))).toBe(true)
  })
})

describe('re-query on dependency change', () => {
  const base = { qty: 1, notes: 'x', [FORM_PARAMS_KEY]: { region: 'Oceania' }, [FORM_VARS_KEY]: { limit: 5 } }
  const key = (values: Record<string, unknown>) => JSON.stringify(bindingInputs(countries, values))
  it('the request inputs (the cache key) change with what the binding reads — and only that', () => {
    expect(bindingInputs(countries, base)).toEqual({ [FORM_PARAMS_KEY]: { region: 'Oceania' } })
    expect(key({ ...base, notes: 'typed more', qty: 2 })).toBe(key(base))
    expect(key({ ...base, [FORM_PARAMS_KEY]: { region: 'Europe' } })).not.toBe(key(base))
    const byField: TableBinding = { ...countries, base_filter: { match: 'all', conditions: [{ column: 'region', operator: 'eq', value: '{{form.qty}}' }] } }
    expect(JSON.stringify(bindingInputs(byField, { ...base, qty: 3 }))).not.toBe(JSON.stringify(bindingInputs(byField, base)))
    expect(bindingInputs(byField, { ...base, [FORM_VARS_KEY]: { limit: 9 } })).toEqual(bindingInputs(byField, base))
  })
})

describe('custom control bound props through the bridge', () => {
  it('the host resolves the binding and the frame gets an ordinary prop value (no network capability involved)', () => {
    const [rating] = normalizeTaskFields([{ key: 'score', label: 'Score', type: 'custom', custom: { tag: 'ut-rating', version: '1.2.0', value_type: 'number', props: { max: 5, symbol: 'star' } }, dynamic: { 'props.max': { kind: 'expr', expr: '{{var.scale}}', expects: 'number' } } }])
    const expects = expectedType(rating, 'props.max', rating.dynamic!['props.max'])!
    const value = coerceDynamicValue(expects, resolveExpression('{{var.scale}}', { values: { [FORM_VARS_KEY]: { scale: '10' } } }))
    expect(value).toEqual({ ok: true, value: 10 })
    const shown = applyDynamicValues(rating, { 'props.max': (value as { value: unknown }).value })
    const message = hostMessage('ch-1', { type: 'init', state: { props: shown.custom!.props! } as never })
    expect(JSON.parse(JSON.stringify(message))).toMatchObject({ channel: 'ch-1', type: 'init', state: { props: { max: 10, symbol: 'star' } } })
    expect(shown.custom?.capabilities ?? []).not.toContain('network')
  })
})
