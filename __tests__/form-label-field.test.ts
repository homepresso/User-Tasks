import { describe, expect, it } from 'vitest'
import { evaluateFunction } from '@/lib/expression-functions'
import {
  LABEL_LIMITS, LabelCascade, computeLabelValues, evaluateLabelExpression, expressionBody, expressionKnown, expressionPaths, expressionProblems,
  formatLabelValue, isDynamicLabel, labelLoops, labelLoopWarnings, labelOrder, labelScope, normalizeLabelConfig, plainNumber,
  renameExpressionKey, serverLabelValues, workingRows, changeRows,
} from '@/lib/forms/label-field'
import {
  coerceTaskFieldValues, fieldDefinitionProblems, mergeTaskFieldValues, normalizeTaskFields, validateTaskFieldValues, valueFields, type TaskFieldDef,
} from '@/lib/task-field-schema'
import { EVENT_CONTEXT, EVENT_TARGET, FORM_RULE_EVENTS, formRuleProblem, normalizeFormRules, ruleClaimGate, type RuleKnown } from '@/lib/forms/form-rules'
import { controlState, controlVariables, enrichEventContext, eventVariables, reportControl, withControlState } from '@/lib/forms/rule-variables'
import { formVariableScope } from '@/lib/forms/variable-catalog'
import { CONTROLS_KEY, FORM_PARAMS_KEY } from '@/lib/forms/form-params'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { checkFormAccessibility } from '@/lib/forms/accessibility'
import { designerProblems, designerRuleProblems, designerStateFrom, definitionFrom, updateField } from '@/lib/forms/designer-state'
import type { DataTableFieldConfig } from '@/lib/forms/data-table'

/* ── Fixtures ──────────────────────────────────────────────────────── */

const LINES: DataTableFieldConfig = {
  source: 'table', mode: 'edit', table_id: '00000000-0000-0000-0000-000000000001', key_column: 'row_id', allow_add: true, allow_delete: true,
  columns: [
    { key: 'product', label: 'Product', type: 'text' },
    { key: 'qty', label: 'Qty', type: 'number' },
    { key: 'price', label: 'Price', type: 'number' },
    { key: 'status', label: 'Status', type: 'choice', options: ['open', 'closed'] },
  ],
}

const ROWS = [
  { row_id: 'r1', product: 'Chai', qty: 2, price: 18, status: 'open' },
  { row_id: 'r2', product: 'Chang', qty: 1, price: 19, status: 'closed' },
  { row_id: 'r3', product: 'Tofu', qty: '3', price: '23.25', status: 'open' },
]

const FIELDS = normalizeTaskFields([
  { key: 'qty', label: 'Quantity', type: 'number' },
  { key: 'price', label: 'Price', type: 'currency' },
  { key: 'first', label: 'First name', type: 'text' },
  { key: 'last', label: 'Last name', type: 'text' },
  { key: 'lines', label: 'Order lines', type: 'data_table', data_table: LINES },
  { key: 'subtotal', label: 'Subtotal', type: 'label', label_config: { expression: '{{form.qty}} * {{form.price}}', format: { kind: 'currency', currency: 'USD' }, include: true } },
  { key: 'with_tax', label: 'With tax', type: 'label', label_config: { expression: 'ROUND(control.subtotal.value * 1.15, 2)', include: true } },
  { key: 'order_total', label: 'Order total', type: 'label', label_config: { expression: 'SUMPRODUCT(control.lines.rows, "qty", "price")', include: true } },
  { key: 'note', label: 'Note', type: 'label', default: 'Nothing yet' },
  { key: 'api_status', label: 'API status', type: 'label', label_config: { include: true } },
])

const scopeOf = (values: Record<string, unknown>) => labelScope(FIELDS, values)
const evaluate = (body: string, values: Record<string, unknown> = {}) => evaluateLabelExpression(body, scopeOf(values))
const rowsScope = (rows: unknown[]) => ({ [CONTROLS_KEY]: { lines: { rows } } })

/* ── Expressions ───────────────────────────────────────────────────── */

describe('label expressions: arithmetic and text', () => {
  it('multiplies fields, reads form.x, bare keys and {{placeholders}} alike', () => {
    expect(evaluate('{{form.qty}} * {{form.price}}', { qty: 3, price: 2.5 }).value).toBe(7.5)
    expect(evaluate('qty * price', { qty: '4', price: '2' }).value).toBe(8)
    expect(evaluate('form.qty + 1', { qty: 1 }).value).toBe(2)
  })
  it('parentheses, division and rounding', () => {
    expect(evaluate('({{form.qty}} + {{form.price}}) / 4', { qty: 6, price: 2 }).value).toBe(2)
    expect(evaluate('ROUND({{form.price}} / 3, 2)', { price: 10 }).value).toBe(3.33)
  })
  it('text: CONCAT, IF and COALESCE for empty values', () => {
    expect(evaluate('CONCAT(form.first, " ", form.last)', { first: 'Ada', last: 'Lovelace' }).value).toBe('Ada Lovelace')
    expect(evaluate('IF(form.qty > 10, "Bulk", "Standard")', { qty: 12 }).value).toBe('Bulk')
    expect(evaluate('COALESCE(form.first, "(no name)")', { first: '' }).value).toBe('(no name)')
    expect(evaluate('"Fixed text"').value).toBe('Fixed text')
  })
  it('reads parameters and variables', () => {
    expect(evaluateLabelExpression('param.rate * 2', labelScope(FIELDS, { [FORM_PARAMS_KEY]: { rate: 1.5 } })).value).toBe(3)
  })
  it('accepts a pasted {{= … }} or a leading =', () => {
    expect(expressionBody('{{= qty * 2 }}')).toBe('qty * 2')
    expect(expressionBody('=qty * 2')).toBe('qty * 2')
    expect(evaluate('{{= qty * 2 }}', { qty: 4 }).value).toBe(8)
  })
  it('number parsing is locale-safe: plain numbers and comma thousands only', () => {
    expect(plainNumber('1,234.5')).toBe(1234.5)
    expect(plainNumber('-3')).toBe(-3)
    expect(plainNumber('1.234,5')).toBeNull()
    expect(plainNumber('12 kg')).toBeNull()
    expect(scopeOf({ qty: '1,200' }).qty).toBe(1200)
    expect(scopeOf({ first: '1,200' }).first).toBe('1,200')
  })
})

describe('label expressions: row aggregates', () => {
  it('SUM / AVG / MIN / MAX of one column (and via PLUCK), COUNT of rows', () => {
    const v = rowsScope(ROWS)
    expect(evaluate('SUM(control.lines.rows, "qty")', v).value).toBe(6)
    expect(evaluate('SUM(PLUCK(control.lines.rows, "price"))', v).value).toBeCloseTo(60.25)
    expect(evaluate('AVG(control.lines.rows, "qty")', v).value).toBe(2)
    expect(evaluate('MIN(control.lines.rows, "price")', v).value).toBe(18)
    expect(evaluate('MAX(control.lines.rows, "price")', v).value).toBe(23.25)
    expect(evaluate('COUNT(control.lines.rows)', v).value).toBe(3)
  })
  it('SUMPRODUCT multiplies columns row by row', () => {
    expect(evaluate('SUMPRODUCT(control.lines.rows, "qty", "price")', rowsScope(ROWS)).value).toBeCloseTo(2 * 18 + 19 + 3 * 23.25)
  })
  it('SUM(MAP(rows, "expr")) works out an expression per row', () => {
    expect(evaluate('SUM(MAP(control.lines.rows, "qty * price"))', rowsScope(ROWS)).value).toBeCloseTo(124.75)
    expect(evaluate('ROUND(SUM(MAP(control.lines.rows, "qty * price * 0.9")), 2)', rowsScope(ROWS)).value).toBe(112.28)
    // The row itself is `row`; the outer scope is still readable.
    expect(evaluateFunction('MAP(rows, "row.qty + bonus")', { rows: [{ qty: 1 }, { qty: 2 }], bonus: 10 })).toEqual([11, 12])
  })
  it('SUMIF / COUNTIF filter on a column', () => {
    const v = rowsScope(ROWS)
    expect(evaluate('SUMIF(control.lines.rows, "status", "open", "qty")', v).value).toBe(5)
    expect(evaluate('COUNTIF(control.lines.rows, "status", "open")', v).value).toBe(2)
  })
  it('no rows (or no table) adds up to 0', () => {
    expect(evaluate('SUMPRODUCT(control.lines.rows, "qty", "price")').value).toBe(0)
    expect(evaluate('SUM(control.lines.rows, "qty")').value).toBe(0)
    expect(evaluate('COUNT(control.lines.rows)').value).toBe(0)
  })
  it('MAP is bounded (nesting, expression length)', () => {
    const nested = evaluateFunction('MAP(rows, "COUNT(MAP(rows, \\"COUNT(MAP(rows, \'1\'))\\"))")', { rows: [{ rows: [{ rows: [{}] }] }] })
    expect(Array.isArray(nested)).toBe(true)
    expect(evaluateFunction(`MAP(rows, "${'x'.repeat(600)}")`, { rows: [{}] })).toEqual([])
  })
})

describe('label expressions: errors never throw', () => {
  it('division by zero: empty, with a warning', () => {
    const r = evaluate('{{form.qty}} / 0', { qty: 5 })
    expect(r.value).toBeNull()
    expect(r.warning).toMatch(/division by zero/i)
  })
  it('an unknown name: an error, no value', () => {
    expect(evaluate('qty * nothing_here', { qty: 1 }).value).toBeNull()
    expect(evaluate('totally unknown words').error).toMatch(/could not be worked out/)
  })
  it('syntax and volatile functions', () => {
    expect(evaluate('SUM(1, 2').error).toMatch(/not closed/)
    expect(evaluate('"open').error).toMatch(/quote/)
    expect(evaluate('NOW()').error).toMatch(/can't be used/)
  })
  it('a whole row or a list of rows is refused with a hint', () => {
    expect(evaluate('control.lines.rows', rowsScope(ROWS)).error).toMatch(/list of rows/)
    expect(evaluate('FIRST(control.lines.rows)', rowsScope(ROWS)).error).toMatch(/whole row/)
  })
  it('too long', () => {
    expect(evaluate('1 + '.repeat(400) + '1').error).toMatch(/longer than/)
  })
  it('designer problems name what is wrong', () => {
    const known = expressionKnown(FIELDS, { params: [{ name: 'rate' }] }, 'subtotal')
    expect(expressionProblems('SUMM(qty)', known)).toContain('Unknown function SUMM()')
    expect(expressionProblems('qty * bogus', known)).toEqual([expect.stringMatching(/Unknown name "bogus"/)])
    expect(expressionProblems('param.nope', known)[0]).toMatch(/No parameter "nope"/)
    expect(expressionProblems('control.nope.rows', known)[0]).toMatch(/No control "nope"/)
    expect(expressionProblems('control.lines.bogus', known)[0]).toMatch(/not part of the table/)
    expect(expressionProblems('subtotal + 1', known)[0]).toMatch(/own value/)
    expect(expressionProblems('RANDOM()', known)[0]).toMatch(/changes every time/)
    expect(expressionProblems('SUMPRODUCT(control.lines.rows, "qty", "price") + param.rate', known)).toEqual([])
    expect(expressionPaths('SUM(control.lines.rows, "qty") + {{form.price}}')).toEqual(['control.lines.rows', 'form.price'])
  })
})

/* ── Rows ──────────────────────────────────────────────────────────── */

describe('a Data table\'s rows for aggregates', () => {
  const changes = {
    added: [{ product: 'Ikura', qty: 1, price: 31 }],
    updated: [{ key: 'r1', before: { qty: 2 }, after: { qty: 5 }, changed_fields: ['qty'] }],
    deleted: [{ key: 'r2', before: { qty: 1, price: 19 } }],
  }
  it('workingRows: new rows first, edits applied, deleted rows out, numbers typed', () => {
    const rows = workingRows(LINES, ROWS, changes)
    expect(rows.map((r) => r.product)).toEqual(['Ikura', 'Chai', 'Tofu'])
    expect(rows[1].qty).toBe(5)
    expect(rows[2].price).toBe(23.25)
  })
  it('changeRows lists the change set', () => {
    const c = changeRows(LINES, changes)
    expect(c.added_rows).toHaveLength(1)
    expect(c.changed_rows[0]).toMatchObject({ row_id: 'r1', qty: 5 })
    expect(c.deleted_rows[0]).toMatchObject({ row_id: 'r2', price: 19 })
  })
  it('control state: rows from the reported loaded rows plus the value; omitted when there are none', () => {
    const values = { lines: changes, [CONTROLS_KEY]: reportControl({}, 'lines', { loaded_rows: ROWS }) }
    const state = controlState(FIELDS, values)
    expect((state.lines.rows as unknown[]).length).toBe(3)
    expect(state.lines.added_rows).toHaveLength(1)
    expect(controlState(FIELDS, { lines: null }).lines.rows).toBeUndefined()
  })
  it('the loaded rows survive the table\'s next report (made from the derived state, e.g. a row click)', () => {
    const derived = withControlState(FIELDS, { lines: null, [CONTROLS_KEY]: reportControl({}, 'lines', { loaded_rows: ROWS, row_count: 3 }) })
    const next = reportControl(derived, 'lines', { last_clicked_row: ROWS[0], last_clicked_row_id: 'r1' })
    expect((controlState(FIELDS, { lines: null, [CONTROLS_KEY]: next }).lines.rows as unknown[]).length).toBe(3)
  })
  it('the Controls group lists rows, change rows and label values', () => {
    const paths = controlVariables(FIELDS).map((v) => v.path)
    expect(paths).toEqual(expect.arrayContaining(['control.lines.rows', 'control.lines.added_rows', 'control.lines.changed_rows', 'control.lines.deleted_rows', 'control.subtotal.value', 'control.note.value']))
  })
})

/* ── Values: expressions, rules, defaults ──────────────────────────── */

describe('label values in the browser', () => {
  it('works labels out in dependency order (a label reading another sees its new value)', () => {
    const out = computeLabelValues(FIELDS, withControlState(FIELDS, { qty: 2, price: 10 }))
    expect(out.subtotal.value).toBe(20)
    expect(out.with_tax.value).toBe(23)
    expect(labelOrder(FIELDS).order.map((f) => f.key).indexOf('subtotal')).toBeLessThan(labelOrder(FIELDS).order.map((f) => f.key).indexOf('with_tax'))
  })
  it('the order total follows the table rows as they change', () => {
    const at = (rows: unknown[]) => computeLabelValues(FIELDS, { [CONTROLS_KEY]: { lines: { rows } } }).order_total.value
    expect(at([])).toBe(0)
    expect(at(ROWS.slice(0, 1))).toBe(36)
    expect(at(ROWS)).toBeCloseTo(124.75)
  })
  it('a circular chain gets no value (and blocks saving)', () => {
    const loop = normalizeTaskFields([
      { key: 'a', label: 'A', type: 'label', label_config: { expression: 'control.b.value + 1' } },
      { key: 'b', label: 'B', type: 'label', label_config: { expression: 'control.a.value + 1' } },
    ])
    expect(labelOrder(loop).cyclic).toEqual(new Set(['a', 'b']))
    expect(computeLabelValues(loop, {}).a.evaluation.error).toMatch(/reads itself/)
    expect(fieldDefinitionProblems(loop).a).toMatch(/reads itself/)
  })
  it('formats with the cell formats, prefix / suffix and an empty text', () => {
    expect(formatLabelValue({ format: { kind: 'currency', currency: 'USD' } }, 1234.5, { locale: 'en-US' }).text).toBe('$1,234.50')
    expect(formatLabelValue({ format: { kind: 'number', decimals: 0 }, suffix: 'items' }, 3, { locale: 'en-US' })).toMatchObject({ text: '3', suffix: 'items' })
    expect(formatLabelValue({ empty_text: 'Add a line' }, null)).toMatchObject({ text: 'Add a line', empty: true })
    expect(formatLabelValue({ format: { kind: 'badge', badges: [{ value: 'over', label: 'Over budget', color: 'red' }] } }, 'over')).toMatchObject({ as: 'badge', text: 'Over budget' })
  })
})

describe('label values on the server (submit)', () => {
  const layout = (rules: unknown[]) => ({ rows: [], rules })
  const SET_STATUS = { id: 'r_api', event: 'button_click', target: 'x', then: [{ type: 'call_reference', reference_id: '00000000-0000-0000-0000-0000000000aa', results: { status: 'api_status' } }] }
  const SET_NOTE = { id: 'r_note', event: 'value_change', target: 'qty', if: { match: 'all', conditions: [{ column: 'qty', operator: 'gt', value: '5' }] }, then: [{ type: 'set_values', assign: { note: 'Bulk order' } }] }

  it('recomputes an expression and ignores a forged value', () => {
    const out = serverLabelValues(FIELDS, layout([]), { qty: 3, price: 4 }, { sent: { subtotal: 999999, with_tax: 1 } })
    expect(out.subtotal).toBe(12)
    expect(out.with_tax).toBe(13.8)
  })
  it('a label without an expression: the default, unless a rule of the saved form could have written the sent value', () => {
    expect(serverLabelValues(FIELDS, layout([SET_NOTE]), { qty: 2 }, { sent: { note: 'forged' } }).note).toBe('Nothing yet')
    // The rule's condition holds and it produces exactly this value.
    expect(serverLabelValues(FIELDS, layout([SET_NOTE]), { qty: 9 }, { sent: { note: 'Bulk order' } }).note).toBe('Bulk order')
    // Condition holds but the value isn't what the rule writes.
    expect(serverLabelValues(FIELDS, layout([SET_NOTE]), { qty: 9 }, { sent: { note: 'Something else' } }).note).toBe('Nothing yet')
  })
  it('an API reference\'s result into a label is accepted within the claim gate (the server cannot replay the call)', () => {
    expect(serverLabelValues(FIELDS, layout([SET_STATUS]), {}, { sent: { api_status: 'In stock' } }).api_status).toBe('In stock')
    expect(serverLabelValues(FIELDS, layout([]), {}, { sent: { api_status: 'In stock' } }).api_status).toBeNull()
  })
  it('rows: the server\'s own source rows with the verified change set — never the browser\'s report', () => {
    const forgedReport = { [CONTROLS_KEY]: { lines: { rows: [{ qty: 1000, price: 1000 }] } } }
    const changes = { added: [{ product: 'Ikura', qty: 1, price: 31 }], updated: [], deleted: [] }
    const out = serverLabelValues(FIELDS, layout([]), { ...forgedReport, lines: changes }, { sent: {}, rows: { lines: ROWS } })
    expect(out.order_total).toBeCloseTo(124.75 + 31)
  })

  it('mergeTaskFieldValues stores included labels (server values) and drops the rest', () => {
    const metadata = { fields: FIELDS, form_layout: { rows: [] } }
    const { errors, templateValues } = mergeTaskFieldValues(metadata, { qty: 2, price: 5, subtotal: 1, order_total: 5, note: 'forged', lines: null }, { labelRows: { lines: ROWS.slice(0, 2) } })
    expect(errors).toEqual({})
    expect(templateValues.subtotal).toBe(10)
    expect(templateValues.with_tax).toBe(11.5)
    expect(templateValues.order_total).toBe(55)
    // Not included: not stored.
    expect('note' in templateValues).toBe(false)
  })
  it('rules judged at submit read the recomputed label (a Before-submit block on the total)', () => {
    const block = { id: 'r_block', event: 'before_submit', if: { match: 'all', conditions: [{ column: 'subtotal', operator: 'gt', value: '10000' }] }, then: [{ type: 'block_submit', text: 'Over 10,000 needs approval' }] }
    const metadata = { fields: FIELDS, form_layout: { rows: [], rules: [block] } }
    expect(mergeTaskFieldValues(metadata, { qty: 1, price: 5, subtotal: 50000 }).errors).toEqual({})
    expect(mergeTaskFieldValues(metadata, { qty: 100, price: 500, subtotal: 1 }).errors.__form).toBe('Over 10,000 needs approval')
  })
  it('labels are never validated as inputs and are coerced to plain values', () => {
    expect(validateTaskFieldValues(FIELDS, { subtotal: { evil: true } })).toEqual({})
    expect(coerceTaskFieldValues(FIELDS, { subtotal: '1,250.50', note: { a: 1 } })).toMatchObject({ subtotal: 1250.5, note: null })
  })
  it('valueFields: an included label is a stored field, others are not', () => {
    const keys = valueFields(FIELDS).map((f) => f.key)
    expect(keys).toContain('subtotal')
    expect(keys).not.toContain('note')
  })
})

/* ── Events ────────────────────────────────────────────────────────── */

describe('"Label changes" rules', () => {
  const known: RuleKnown = {
    fieldKeys: new Set(FIELDS.map((f) => f.key)), valueKeys: new Set(FIELDS.map((f) => f.key)), fieldTypes: new Map(FIELDS.map((f) => [f.key, f.type])),
    pageIds: new Set(), flags: new Set(),
  }
  it('is an event about a Label, with value and previous_value', () => {
    expect(FORM_RULE_EVENTS).toContain('label_change')
    expect(EVENT_TARGET.label_change).toBe('label')
    expect(EVENT_CONTEXT.label_change).toEqual(['event.field', 'event.value', 'event.previous'])
    expect(eventVariables('label_change', 'order_total', FIELDS).map((v) => v.path)).toEqual(['event.field', 'event.value', 'event.previous_value'])
    expect(enrichEventContext('label_change', { field: 'order_total', value: 2, previous: 1 }).previous_value).toBe(1)
  })
  it('targets a Label', () => {
    const [rule] = normalizeFormRules([{ id: 'r1', event: 'label_change', target: 'qty', then: [{ type: 'message', text: 'x' }] }])
    expect(formRuleProblem(rule, known)).toMatch(/not a Label/)
    expect(formRuleProblem({ ...rule, target: undefined }, known)).toMatch(/choose the Label/)
    expect(formRuleProblem({ ...rule, target: 'order_total' }, known)).toBeNull()
  })
  it('the server judges its condition with the label\'s recomputed value', () => {
    const rule = { id: 'r1', event: 'label_change', target: 'subtotal', if: { match: 'all', conditions: [{ column: 'event.value', operator: 'gt', value: '10000' }] }, then: [{ type: 'set_state', flag: 'big', state_value: 'true' }] }
    expect(ruleClaimGate({ subtotal: 20000 })(rule)).toBe(true)
    expect(ruleClaimGate({ subtotal: 5 })(rule)).toBe(false)
  })

  it('LabelCascade: a chain of label rules stops after the cap; a new change starts over', () => {
    let t = 0
    const gate = new LabelCascade(LABEL_LIMITS.chain, 60, () => t)
    // The person changed something: round 1.
    expect(gate.begin(gate.note())).toBe(true)
    let rounds = 1
    // Each round's rule changes another label while it runs (chained).
    for (let i = 0; i < 10; i++) {
      const chained = gate.note()
      gate.end()
      t += 10
      if (!gate.begin(chained)) break
      rounds++
    }
    expect(rounds).toBe(LABEL_LIMITS.chain)
    gate.end()
    // Later, an unrelated change: a new chain.
    t += 1000
    expect(gate.begin(gate.note())).toBe(true)
    expect(gate.rounds).toBe(1)
  })

  it('labelLoops finds rule loops through labels (and their expressions) statically', () => {
    const fields = normalizeTaskFields([
      { key: 'total', label: 'Total', type: 'label', label_config: { expression: 'discount * 10' } },
      { key: 'discount', label: 'Discount', type: 'number' },
      { key: 'shown', label: 'Shown', type: 'label' },
    ])
    const loop = { rows: [], rules: [{ id: 'r1', event: 'label_change', target: 'total', then: [{ type: 'set_values', assign: { discount: '{{event.value}}' } }] }] }
    expect(labelLoops(fields, loop)).toEqual([['total', 'discount', 'total']])
    expect(labelLoopWarnings(fields, loop)[0]).toMatch(/Total → Discount → Total/)
    const fine = { rows: [], rules: [{ id: 'r1', event: 'label_change', target: 'total', then: [{ type: 'set_values', assign: { shown: '{{event.value}}' } }] }] }
    expect(labelLoops(fields, fine)).toEqual([])
    // Two labels setting each other.
    const pingPong = { rows: [], rules: [
      { id: 'r1', event: 'label_change', target: 'shown', then: [{ type: 'set_values', assign: { note: 'x' } }] },
      { id: 'r2', event: 'label_change', target: 'note', then: [{ type: 'set_values', assign: { shown: 'y' } }] },
    ] }
    const withNote = normalizeTaskFields([...fields, { key: 'note', label: 'Note', type: 'label' }])
    expect(labelLoops(withNote, pingPong)).toHaveLength(1)
  })
  it('isDynamicLabel: an expression, or a rule writes it', () => {
    const note = FIELDS.find((f) => f.key === 'note')!
    expect(isDynamicLabel(FIELDS.find((f) => f.key === 'subtotal')!, null)).toBe(true)
    expect(isDynamicLabel(note, null)).toBe(false)
    expect(isDynamicLabel(note, { rules: [{ id: 'r', event: 'form_load', then: [{ type: 'set_values', assign: { note: 'x' } }] }] })).toBe(true)
  })
})

/* ── Designer, catalog, accessibility ──────────────────────────────── */

describe('the designer and the variable picker', () => {
  it('lists labels under Controls, included ones under fields, functions and column names in an expression', () => {
    const source = { fields: FIELDS, layout: { rows: [] } }
    const rule = formVariableScope(source, { kind: 'rule', event: 'value_change', target: 'qty', slot: 'action' })
    const paths = rule.items.map((i) => i.path)
    expect(paths).toContain('control.subtotal.value')
    expect(paths).toContain('subtotal')
    expect(paths).not.toContain('note')
    const expr = formVariableScope(source, { kind: 'expression', exclude: 'order_total' })
    const items = expr.items
    expect(items.some((i) => i.path === 'SUMPRODUCT(' && i.plain && i.group === 'Functions' && /qty/.test(i.hint ?? ''))).toBe(true)
    expect(items.some((i) => i.path === 'NOW(')).toBe(false)
    expect(items.some((i) => i.path === '"qty"' && i.plain)).toBe(true)
    expect(items.some((i) => i.path === 'control.lines.rows')).toBe(true)
    expect(items.some((i) => i.path === 'control.order_total.value')).toBe(false)
    expect(items.some((i) => i.path === 'form.qty')).toBe(true)
  })
  it('a rule may write a label without an expression, not one with', () => {
    const state = designerStateFrom({ fields: FIELDS, layout: { rows: [], rules: [
      { id: 'r1', event: 'value_change', target: 'qty', then: [{ type: 'set_values', assign: { note: 'x' } }] },
      { id: 'r2', event: 'value_change', target: 'qty', then: [{ type: 'set_values', assign: { subtotal: '1' } }] },
    ] } } as never)
    const problems = designerRuleProblems(state)
    expect(problems.r1).toBeUndefined()
    expect(problems.r2).toMatch(/not an input/)
  })
  it('flags a broken expression and carries a key rename into expressions', () => {
    const state = designerStateFrom({ fields: [...FIELDS, { key: 'bad', label: 'Bad', type: 'label', label_config: { expression: 'qty * missing' } }], layout: { rows: [] } } as never)
    const bad = state.fields.find((f) => f.key === 'bad')!
    expect(designerProblems(state)[bad._id]).toMatch(/Unknown name "missing"/)
    const qty = state.fields.find((f) => f.key === 'qty')!
    const renamed = updateField(state, qty._id, { key: 'quantity' })
    expect(renamed.fields.find((f) => f.key === 'subtotal')!.label_config!.expression).toBe('{{form.quantity}} * {{form.price}}')
    expect(renameExpressionKey('SUMIF(control.lines.rows, "qty", 1, "qty") + qty', 'qty', 'n')).toBe('SUMIF(control.lines.rows, "qty", 1, "qty") + n')
  })
  it('the checker warns about a dynamic label without a caption', () => {
    const def = normalizeFormDefinition({ fields: [
      { key: 'total_2', label: '', type: 'label', label_config: { expression: '1 + 1' } },
      { key: 'fixed', label: '', type: 'label', default: 'Static text' },
      { key: 'named', label: 'Order total', type: 'label', label_config: { expression: '1 + 1', hide_caption: true } },
    ] })
    const ids = checkFormAccessibility(def).findings.filter((f) => f.rule === 'label-dynamic-name').map((f) => f.field_key)
    expect(ids).toEqual(['total_2'])
    // Labels are not inputs: no "every field has a label" finding for them.
    expect(checkFormAccessibility(def).findings.some((f) => f.rule === 'label-missing')).toBe(false)
  })
})

/* ── Portability ───────────────────────────────────────────────────── */

describe('portability: Label fields travel with the form', () => {
  it('normalize → JSON → normalize is stable (exports, versions, packages, API, MCP, config-as-code)', () => {
    const once = normalizeFormDefinition({ fields: FIELDS, layout: { rows: [{ columns: 2, cells: [{ field_key: 'subtotal', span: 1 }, { field_key: 'order_total', span: 1 }] }], rules: [
      { id: 'r1', event: 'label_change', target: 'order_total', if: { match: 'all', conditions: [{ column: 'event.value', operator: 'gt', value: '10000' }] }, then: [{ type: 'message', style: 'banner', tone: 'warning', text: 'Over 10,000' }] },
    ] } })
    const twice = normalizeFormDefinition(JSON.parse(JSON.stringify(once)))
    expect(twice).toEqual(once)
    const total = twice.fields.find((f) => f.key === 'order_total')!
    expect(total.label_config).toEqual({ expression: 'SUMPRODUCT(control.lines.rows, "qty", "price")', include: true })
    expect(twice.layout?.rules?.[0].event).toBe('label_change')
    // The designer round trip keeps it too.
    expect(definitionFrom(designerStateFrom(twice)).fields.find((f) => f.key === 'order_total')!.label_config).toEqual(total.label_config)
  })
  it('cleans what is stored: unknown props dropped, bounds applied, no input properties', () => {
    const [f] = normalizeTaskFields([{ key: 'x', label: 'X', type: 'label', required: true, read_only: true, placeholder: 'p', min: 1, label_config: { expression: '{{= 1 + 2 }}', size: 'huge', prefix: 'p'.repeat(100), include: 'yes', evil: 1, format: { kind: 'currency', currency: 'nzd' } } }])
    expect(f).toEqual({ key: 'x', label: 'X', type: 'label', label_config: { expression: '1 + 2', prefix: 'p'.repeat(40), format: { kind: 'currency', currency: 'NZD' } } } satisfies TaskFieldDef)
    expect(normalizeLabelConfig(null)).toEqual({})
  })
  it('old forms are unaffected (no label: values, control state and fields as before)', () => {
    const old = normalizeTaskFields([{ key: 'a', label: 'A', type: 'text' }])
    expect(withControlState(old, { a: 'x' })).toEqual({ a: 'x' })
    expect(mergeTaskFieldValues({ fields: old }, { a: 'x' })).toEqual({ errors: {}, templateValues: { a: 'x' } })
  })
})
