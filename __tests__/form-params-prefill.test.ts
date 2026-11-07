import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'
import { FORM_PARAMS_KEY, FORM_VARS_KEY, formContextNameProblem, freeFormContextName, layoutFormParams, normalizeFormParams, paramsFromQuery, withFormContext } from '@/lib/forms/form-params'
import { normalizeFormRules, ruleConditionMet, ruleConditionsMet, rulesForEvent, resolveRuleTemplate, formRuleProblem, type RuleKnown } from '@/lib/forms/form-rules'
import { normalizeFieldButtonAction, runFieldButton, type FieldButtonHost } from '@/lib/forms/field-buttons'
import {
  callReferenceFailure, isResultPath, mapReferenceResults, normalizeResultPath, readResultPath, resultMappingProblems, resultPathOptions, resultTypeNote, suggestResultMappings,
} from '@/lib/forms/reference-results'
import { inferSchema } from '@/lib/response-schema'
import type { TaskFieldDef } from '@/lib/task-field-schema'

/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */

/**
 * The user-testing scenario end to end: a form opened with
 * `?customer_id=ALFKI` has a "Form loads" rule — If param.customer_id is not
 * empty, Then call an API reference with {{param.customer_id}} and map the
 * response into fields. The browser runs the rule (runFieldButton); the call
 * and the mapping run on the server (runRuleAction) from the SAVED rule.
 */

const TENANT = 'dddddddd-0000-4000-8000-000000000001'
const FORM = 'dddddddd-0000-4000-8000-000000000002'
const REF = 'dddddddd-0000-4000-8000-000000000003'

const FIELDS: TaskFieldDef[] = [
  { key: 'customer_name', label: 'Customer name', type: 'text' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'city', label: 'City', type: 'text' },
  { key: 'credit_limit', label: 'Credit limit', type: 'number' },
  { key: 'customer_since', label: 'Customer since', type: 'date' },
  { key: 'vip', label: 'VIP', type: 'boolean' },
  { key: 'account_manager', label: 'Account manager', type: 'text', read_only: true },
  { key: 'notes', label: 'Notes', type: 'textarea' },
] as TaskFieldDef[]

const PREFILL = {
  id: 'r_prefill', name: 'Prefill customer from the URL', event: 'form_load',
  if: { match: 'all', conditions: [{ column: 'param.customer_id', operator: 'is_set' }] },
  then: [{
    type: 'call_reference', reference_id: REF, inputs: { customer_id: '{{param.customer_id}}' },
    results: {
      'data.name': 'customer_name', 'data.email': 'email', 'data.address.city': 'city', 'data.credit_limit': 'credit_limit',
      'data.since': 'customer_since', 'data.vip': 'vip', 'data.manager': 'account_manager', 'data.missing': 'notes', 'data.segment': 'var.segment',
    },
    error_text: 'We could not find customer {{param.customer_id}}',
  }],
}
const LAYOUT = {
  rows: FIELDS.map((f) => ({ columns: 1, cells: [{ field_key: f.key, span: 1 }] })),
  params: [{ name: 'customer_id', type: 'text', source: 'url', pattern: '[A-Za-z0-9./"\\-]{1,40}' }],
  variables: [{ name: 'segment', type: 'text' }],
  rules: [PREFILL],
}

let forms: Record<string, any>
let refCalls: any[]
let response: { status: number; data: unknown }

function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const api: any = {
        select() { return api }, eq(f: string, v: unknown) { filters.push([f, v]); return api }, maybeSingle() { return api },
        then(resolve: (v: unknown) => unknown) {
          const get = (f: string) => filters.find(([k]) => k === f)?.[1]
          if (table === 'forms') return Promise.resolve({ data: get('tenant_id') === TENANT ? forms[String(get('id'))] ?? null : null, error: null }).then(resolve)
          return Promise.resolve({ data: null, error: null }).then(resolve)
        },
      }
      return api
    },
  }
}

const db = fakeDb()
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => db, audit: async () => {} }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }))
vi.mock('@/lib/providers/cache', () => ({ getCacheStore: async () => null }))

const { runRuleAction, ruleActionDeps } = await import('@/lib/services/form-rule-actions')
const SUBMIT: ServiceContext = { supabase: db as any, tenantId: TENANT, actorId: null, permissions: new Set(['forms.submit']), authKind: 'api_key', source: 'api' }

const ALFKI = { data: { id: 'ALFKI', name: 'Alfreds Futterkiste', email: 'maria@alfreds.example', address: { city: 'Berlin' }, credit_limit: '5000', since: '2019-03-14T10:00:00Z', vip: 'yes', manager: 'Mallory', segment: 'Retail' } }

beforeEach(() => {
  forms = { [FORM]: { id: FORM, name: 'Customer details', fields: FIELDS, layout: LAYOUT } }
  refCalls = []
  response = { status: 200, data: ALFKI }
  ruleActionDeps.executeReference = async (opts: any) => { refCalls.push(opts); return response as any }
})

/** The browser side: the page's values (URL parameters parsed), the Form loads rules that hold, run through runFieldButton with a host whose server step is the real service. */
async function openForm(query: string) {
  const layout = forms[FORM].layout
  const params = layoutFormParams(layout)
  const values: Record<string, unknown> = withFormContext(layout, { [FORM_PARAMS_KEY]: paramsFromQuery(params, new URLSearchParams(query)) })
  const messages: string[] = []
  const rules = rulesForEvent(normalizeFormRules(layout.rules), { type: 'form_load' }).filter((r) => ruleConditionsMet(r.if, { values }))
  for (const rule of rules) {
    const host: FieldButtonHost = {
      values: () => values, state: () => ({ hidden: [], disabled: [], flags: {} } as any), setValues: (patch) => Object.assign(values, patch), setState: () => {},
      flush: async () => {}, goTo: () => false, next: () => false, back: () => false, validate: () => true, submit: () => false, saveDraft: () => false, print: () => {},
      openLink: () => false, message: (text) => { messages.push(text) },
      runExtra: async (index, action, current) => {
        try {
          const res = await runRuleAction(SUBMIT, { form_id: FORM }, { rule_id: rule.id, action_index: index, values: current, event: {}, idempotency_key: `k-${Math.random().toString(36).slice(2, 12)}` })
          return { values: { ...(res.values ?? {}), ...(res.vars ? { [FORM_VARS_KEY]: res.vars } : {}) } }
        } catch (error) {
          const outcome = callReferenceFailure(action, error, (text) => resolveRuleTemplate(text, { values: current }))
          if ('ignore' in outcome) return
          throw new Error(outcome.message)
        }
      },
      editableKeys: new Set(FIELDS.map((f) => f.key)), blank: () => null,
    }
    await runFieldButton({ actions: rule.then }, host, {})
  }
  return { values, messages, ran: rules.length }
}

describe('Prefill from a URL parameter via an API (param → condition → API → fields)', () => {
  it('?customer_id=ALFKI: Form loads sees the parameter, the server calls the saved reference and maps the response into typed fields', async () => {
    const { values, messages, ran } = await openForm('customer_id=ALFKI')
    expect(ran).toBe(1)
    expect(refCalls).toHaveLength(1)
    expect(refCalls[0].referenceId).toBe(REF)
    expect(refCalls[0].inputValues).toEqual({ customer_id: 'ALFKI' })
    expect(values.customer_name).toBe('Alfreds Futterkiste')
    expect(values.city).toBe('Berlin')
    expect(values.credit_limit).toBe(5000) // "5000" → a number field's number
    expect(values.customer_since).toBe('2019-03-14') // a date field keeps the day
    expect(values.vip).toBe(true)
    expect(values).not.toHaveProperty('account_manager') // read-only: never written by a response
    expect(values).not.toHaveProperty('notes') // the response has no data.missing: the field keeps its value
    expect((values[FORM_VARS_KEY] as any).segment).toBe('Retail')
    expect(messages).toEqual([])
  })

  it('without the parameter the rule does not run, and nothing is called', async () => {
    const { values, ran } = await openForm('')
    expect(ran).toBe(0)
    expect(refCalls).toHaveLength(0)
    expect(values.customer_name).toBeUndefined()
  })

  it('a forged call without the parameter is refused by the server (its condition is checked again)', async () => {
    await expect(runRuleAction(SUBMIT, { form_id: FORM }, { rule_id: 'r_prefill', action_index: 0, values: {}, idempotency_key: 'k-forged-1' })).rejects.toThrow(/conditions do not hold/)
    expect(refCalls).toHaveLength(0)
  })

  it('a crafted parameter stays one mapped input value: it cannot pick the reference, add inputs or write other fields', async () => {
    const crafted = '../admin"/x'
    const res = await runRuleAction(SUBMIT, { form_id: FORM }, {
      rule_id: 'r_prefill', action_index: 0, idempotency_key: 'k-crafted-1',
      values: { [FORM_PARAMS_KEY]: { customer_id: crafted, reference_id: 'other' }, account_manager: 'Eve' },
      event: { reference_id: 'other', results: { 'data.manager': 'account_manager' } },
    } as any)
    expect(refCalls[0].referenceId).toBe(REF)
    expect(refCalls[0].inputValues).toEqual({ customer_id: crafted })
    expect(res.values).not.toHaveProperty('account_manager')
  })

  it('a parameter the declaration refuses (pattern) never reaches the API', async () => {
    const { ran } = await openForm('customer_id=' + encodeURIComponent('<script>'))
    expect(ran).toBe(0)
    await expect(runRuleAction(SUBMIT, { form_id: FORM }, { rule_id: 'r_prefill', action_index: 0, values: { [FORM_PARAMS_KEY]: { customer_id: '<script>' } }, idempotency_key: 'k-bad-12345' })).rejects.toThrow(/conditions do not hold/)
    expect(refCalls).toHaveLength(0)
  })

  it('If the call fails: the author\'s message with the parameter filled in (404 reads as nothing found)', async () => {
    response = { status: 404, data: { error: 'not found' } }
    const { values, messages } = await openForm('customer_id=NOPE')
    expect(messages).toEqual(['We could not find customer NOPE'])
    expect(values.customer_name).toBeUndefined()
    await expect(runRuleAction(SUBMIT, { form_id: FORM }, { rule_id: 'r_prefill', action_index: 0, values: { [FORM_PARAMS_KEY]: { customer_id: 'NOPE' } }, idempotency_key: 'k-404-12345' })).rejects.toThrow(/found nothing/)
  })

  it('If the call fails → Leave the fields unchanged: nothing shown, the rule goes on with its next step', async () => {
    response = { status: 500, data: null }
    forms[FORM].layout = { ...LAYOUT, rules: [{ ...PREFILL, then: [{ ...PREFILL.then[0], on_error: 'ignore' }, { type: 'set_values', assign: { notes: 'checked' } }] }] }
    const layoutRules = normalizeFormRules(forms[FORM].layout.rules)
    expect(layoutRules[0].then[0].on_error).toBe('ignore')
    expect(layoutRules[0].then[0].error_text).toBeUndefined()
    const outcome = callReferenceFailure(layoutRules[0].then[0], new Error('boom'), (t) => t)
    expect(outcome).toEqual({ ignore: true })
    expect(callReferenceFailure({}, new Error('The service is not available right now'), (t) => t)).toEqual({ message: 'The service is not available right now' })
    const { values, messages } = await openForm('customer_id=ALFKI')
    expect(messages).toEqual([])
    expect(values.customer_name).toBeUndefined()
    expect(values.notes).toBe('checked')
  })

  it('an array response maps its first item with [0] paths', async () => {
    response = { status: 200, data: [{ CompanyName: 'Alfreds', City: 'Berlin' }] }
    forms[FORM].layout = { ...LAYOUT, rules: [{ ...PREFILL, then: [{ ...PREFILL.then[0], results: { '[0].CompanyName': 'customer_name', '0.City': 'city' } }] }] }
    const res = await runRuleAction(SUBMIT, { form_id: FORM }, { rule_id: 'r_prefill', action_index: 0, values: { [FORM_PARAMS_KEY]: { customer_id: 'ALFKI' } }, idempotency_key: 'k-array-1234' })
    expect(res.values).toEqual({ customer_name: 'Alfreds', city: 'Berlin' })
  })
})

describe('is empty / is not empty on parameters, variables and fields (typed)', () => {
  const layout = {
    params: [
      { name: 'customer_id', type: 'text', source: 'url' }, { name: 'qty', type: 'number', source: 'url' },
      { name: 'from', type: 'date', source: 'url' }, { name: 'flag', type: 'boolean', source: 'url' }, { name: 'tags', type: 'text_list', source: 'url' },
    ],
    variables: [{ name: 'picked', type: 'number' }, { name: 'note', type: 'text', initial: { kind: 'constant', value: '' } }],
  }
  const scope = (query: string, extra: Record<string, unknown> = {}) => ({ values: withFormContext(layout, { [FORM_PARAMS_KEY]: paramsFromQuery(layoutFormParams(layout), new URLSearchParams(query)), ...extra }) })
  const set = (column: string, s: { values: Record<string, unknown> }) => ruleConditionMet({ column, operator: 'is_set' }, s)
  const empty = (column: string, s: { values: Record<string, unknown> }) => ruleConditionMet({ column, operator: 'is_not_set' }, s)

  it('a missing or blank parameter is empty; a present one is not', () => {
    expect(empty('param.customer_id', scope(''))).toBe(true)
    expect(empty('param.customer_id', scope('customer_id='))).toBe(true)
    expect(empty('param.customer_id', scope('customer_id=%20%20'))).toBe(true)
    expect(set('param.customer_id', scope('customer_id=ALFKI'))).toBe(true)
  })

  it('numbers: 0 is a value, a non-number is refused (so empty); dates and lists by their parsed value', () => {
    expect(set('param.qty', scope('qty=0'))).toBe(true)
    expect(empty('param.qty', scope('qty=abc'))).toBe(true)
    expect(set('param.from', scope('from=2026-11-04'))).toBe(true)
    expect(empty('param.from', scope('from=04%2F11%2F2026'))).toBe(true)
    expect(set('param.flag', scope('flag=false'))).toBe(true) // "no" is an answer, not empty
    expect(empty('param.tags', scope(''))).toBe(true)
    expect(set('param.tags', scope('tags=a,b'))).toBe(true)
  })

  it('variables and fields read the same way', () => {
    expect(empty('var.picked', scope(''))).toBe(true)
    expect(set('var.picked', scope('', { [FORM_VARS_KEY]: { picked: 0 } }))).toBe(true)
    expect(empty('var.note', scope(''))).toBe(true)
    expect(set('amount', scope('', { amount: 0 }))).toBe(true)
    expect(empty('amount', scope('', { amount: null }))).toBe(true)
    expect(empty('when', scope('', { when: '' }))).toBe(true)
  })

  it('the operator reads "is not empty" / "is empty" in the condition builder', async () => {
    const { DATA_TABLE_OPERATOR_LABELS } = await import('@/lib/forms/data-table')
    expect(DATA_TABLE_OPERATOR_LABELS.is_set).toBe('is not empty')
    expect(DATA_TABLE_OPERATOR_LABELS.is_not_set).toBe('is empty')
  })
})

describe('response mapping: paths, types and validation', () => {
  it('paths: names, [0] items, keys with @ / $; no prototype keys; .0. spelled [0]', () => {
    for (const p of ['', 'name', 'data.address.city', '[0].name', 'items[0].id', '@odata.count', 'value[0].children[1].id']) expect(isResultPath(p)).toBe(true)
    for (const p of ['__proto__', 'a.__proto__.b', 'constructor', 'a..b', 'a b', 'a/b', '{{x}}']) expect(isResultPath(p)).toBe(false)
    expect(normalizeResultPath('$.data.0.name')).toBe('data[0].name')
    expect(normalizeResultPath('0.name')).toBe('[0].name')
  })

  it('reads the body at a path; undefined when missing; never the prototype', () => {
    const body = { data: [{ name: 'A' }], '@odata.count': 3 }
    expect(readResultPath(body, 'data[0].name')).toBe('A')
    expect(readResultPath(body, '@odata.count')).toBe(3)
    expect(readResultPath(body, 'data[3].name')).toBeUndefined()
    expect(readResultPath(body, '__proto__')).toBeUndefined()
    expect(readResultPath({ status: 200, data: { name: 'wrapped' } }, 'name')).toBe('wrapped')
  })

  it('maps only declared, editable fields and variables, typed; objects into text fields as JSON', () => {
    const fields = [...FIELDS, { key: 'rows', label: 'Rows', type: 'data_table' }] as TaskFieldDef[]
    const out = mapReferenceResults({ a: { b: 1 }, n: '12.5', d: 'x', list: [1, 2] }, { a: 'notes', n: 'credit_limit', d: 'account_manager', list: 'rows', 'a.b': 'var.segment', zzz: 'var.unknown' }, fields, [{ name: 'segment', type: 'text' }])
    expect(out.values).toEqual({ notes: '{"b":1}', credit_limit: 12.5 })
    expect(out.vars).toEqual({ segment: '1' })
  })

  it('the designer lists the response\'s fields, typed, with [0] for lists of objects', () => {
    const options = resultPathOptions(inferSchema(ALFKI))
    expect(options.map((o) => o.path)).toEqual(expect.arrayContaining(['data', 'data.name', 'data.address', 'data.address.city', 'data.credit_limit']))
    expect(resultPathOptions(inferSchema([{ id: 1, name: 'x' }])).map((o) => o.path)).toEqual(['[0].id', '[0].name'])
    expect(options.find((o) => o.path === 'data.name')?.type).toBe('string')
  })

  it('type notes and suggested mappings', () => {
    expect(resultTypeNote('string', 'number')).toMatch(/converted to a number/)
    expect(resultTypeNote('object', 'text')).toMatch(/JSON text/)
    expect(resultTypeNote('object', 'var:object')).toBeNull()
    expect(resultTypeNote('integer', 'number')).toBeNull()
    const options = resultPathOptions(inferSchema(ALFKI))
    const suggested = suggestResultMappings(options, FIELDS.map((f) => ({ value: f.key, label: f.label })))
    expect(suggested).toMatchObject({ 'data.name': 'customer_name', 'data.email': 'email', 'data.address.city': 'city', 'data.credit_limit': 'credit_limit' })
  })

  it('validation: unknown targets, display / table fields and bad paths are problems; saved actions are cleaned', () => {
    const fields = [...FIELDS, { key: 'rows', label: 'Rows', type: 'data_table' }, { key: 'title', label: 'Title', type: 'heading' }] as TaskFieldDef[]
    expect(resultMappingProblems({ 'data.name': 'customer_name', 'x.y': 'var.segment' }, { fields, variables: ['segment'] })).toEqual([])
    expect(resultMappingProblems({ 'a b': 'nope', b: 'rows', c: 'title', d: 'var.zz' }, { fields, variables: [] })).toHaveLength(5)
    const action = normalizeFieldButtonAction({ type: 'call_reference', reference_id: REF, results: { 'data.0.name': 'customer_name', '__proto__.x': 'email', 'ok': 'Not A Key', '[0].city': 'var.segment' }, on_error: 'message', error_text: '<b>No</b> customer' }, { rule: true })
    expect(action?.results).toEqual({ 'data[0].name': 'customer_name', '[0].city': 'var.segment' })
    expect(action?.error_text).toBe('bNo/b customer')
    const known: RuleKnown = { fieldKeys: new Set(fields.map((f) => f.key)), valueKeys: new Set(['customer_name', 'rows']), fieldTypes: new Map(fields.map((f) => [f.key, f.type])), pageIds: new Set(), flags: new Set(), variables: new Set(['segment']) }
    const rule = normalizeFormRules([{ id: 'r1', event: 'form_load', then: [{ type: 'call_reference', reference_id: REF, results: { a: 'rows' } }] }])[0]
    expect(formRuleProblem(rule, known)).toMatch(/can't take a value/)
  })
})

describe('the Rules tab template', () => {
  it('"Prefill from {{param.x}} via an API" is a valid Form loads rule that only lacks the reference', async () => {
    const { prefillRuleTemplate } = await import('@/lib/forms/reference-results')
    const [rule] = normalizeFormRules([prefillRuleTemplate({ name: 'customer_id' }, 'r_tpl')])
    expect(rule).toMatchObject({ id: 'r_tpl', event: 'form_load', if: { match: 'all', conditions: [{ column: 'param.customer_id', operator: 'is_set' }] } })
    expect(rule.then[0]).toMatchObject({ type: 'call_reference', error_text: "We couldn't find {{param.customer_id}}" })
    const known: RuleKnown = { fieldKeys: new Set(), valueKeys: new Set(), fieldTypes: new Map(), pageIds: new Set(), flags: new Set(), variables: new Set() }
    expect(formRuleProblem(rule, known)).toMatch(/choose the reference/)
  })
})

describe('Data tab names', () => {
  it('a new parameter gets a usable name (the old default "param" is reserved and was dropped)', () => {
    expect(normalizeFormParams([{ name: 'param', type: 'text' }])).toEqual([])
    expect(freeFormContextName('customer_id', [])).toBe('customer_id')
    expect(freeFormContextName('customer_id', ['customer_id'])).toBe('customer_id_2')
    expect(freeFormContextName('param', [])).toBe('param_value')
  })

  it('explains why a name can\'t be used', () => {
    expect(formContextNameProblem('')).toMatch(/name/)
    expect(formContextNameProblem('param')).toMatch(/reserved/)
    expect(formContextNameProblem('9lives')).toMatch(/letter/)
    expect(formContextNameProblem('customer_id', ['customer_id'])).toMatch(/already/)
    expect(formContextNameProblem('customer_id')).toBeNull()
  })
})
