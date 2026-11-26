/**
 * Customer feedback (DanCo, Nov 2026): "Rules engine, need comparison values
 * to accept input values. Need to be able to validate against dynamic values
 * being entered."
 *
 *  - Business rules (decision tables, /automations/rules/<id>): a condition
 *    could only compare an input with a fixed value. It may now compare with
 *    another input (`valueInputKey`): amount ≤ budget, end date > start date.
 *  - Form rules: the engine already resolved {{field}} on the right side
 *    (client and server); the designer now offers "Compare with: Value |
 *    Field" and lists the form's fields in the data picker. These tests pin
 *    the stored shape (a single placeholder) and both evaluations.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateDecisionCondition, evaluateDecisionTable, decisionConditionRight, type DecisionTableField } from '@/lib/decision-table-engine'
import { conditionFieldValue, conditionValueMode, conditionValueRef } from '@/lib/forms/condition-value'
import { ruleConditionMet, ruleConditionsMet, ruleValidationErrors, type FormRule } from '@/lib/forms/form-rules'
import { normalizeFormLayout } from '@/lib/forms/layout'
import { normalizeTaskFields, validateTaskFieldValues } from '@/lib/task-field-schema'
import { decisionTableConditionSchema } from '@/lib/api-schemas/decision-tables'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('business rules: compare an input with another input', () => {
  const inputs: DecisionTableField[] = [
    { id: 'a', key: 'amount', label: 'Amount', type: 'number' },
    { id: 'b', key: 'budget', label: 'Budget', type: 'number' },
    { id: 's', key: 'start', label: 'Start', type: 'date' },
    { id: 'e', key: 'end', label: 'End', type: 'date' },
    { id: 't', key: 'code', label: 'Code', type: 'text' },
    { id: 'u', key: 'confirm', label: 'Confirm', type: 'text' },
  ]
  const field = (key: string) => inputs.find((f) => f.key === key)

  it('the right side is the other input’s value, typed like the left input', () => {
    const cond = { id: 'c', inputKey: 'amount', operator: 'less_than_or_equal', value: '', valueInputKey: 'budget' }
    expect(evaluateDecisionCondition(cond, field('amount'), { amount: 900, budget: '1000' })).toBe(true)
    expect(evaluateDecisionCondition(cond, field('amount'), { amount: '1200', budget: 1000 })).toBe(false)
    // Numbers, not text: "900" vs "1000" as text would be the other way round.
    expect(evaluateDecisionCondition({ ...cond, operator: 'greater_than' }, field('amount'), { amount: '900', budget: '1000' })).toBe(false)
  })

  it('dates and text compare with other inputs too', () => {
    const after = { id: 'c', inputKey: 'end', operator: 'greater_than', value: '', valueInputKey: 'start' }
    expect(evaluateDecisionCondition(after, field('end'), { start: '2026-11-01', end: '2026-11-20' })).toBe(true)
    expect(evaluateDecisionCondition(after, field('end'), { start: '2026-11-20', end: '2026-11-01' })).toBe(false)
    const same = { id: 'c', inputKey: 'code', operator: 'equals', value: '', valueInputKey: 'confirm' }
    expect(evaluateDecisionCondition(same, field('code'), { code: 'X1', confirm: 'X1' })).toBe(true)
    expect(evaluateDecisionCondition(same, field('code'), { code: 'X1', confirm: 'X2' })).toBe(false)
  })

  it('the fixed value is ignored when another input is chosen; an empty other input never matches a comparison', () => {
    const cond = { id: 'c', inputKey: 'amount', operator: 'less_than', value: '999999', valueInputKey: 'budget' }
    expect(decisionConditionRight(cond, { budget: 5 })).toBe(5)
    expect(evaluateDecisionCondition(cond, field('amount'), { amount: 10, budget: 5 })).toBe(false)
    expect(evaluateDecisionCondition(cond, field('amount'), { amount: 10, budget: '' })).toBe(false)
    expect(evaluateDecisionCondition({ ...cond, operator: 'equals' }, field('amount'), { amount: 10 })).toBe(false)
    // "*" is a wildcard only as a fixed value.
    expect(evaluateDecisionCondition({ id: 'c', inputKey: 'code', operator: 'equals', value: '*', valueInputKey: 'confirm' }, field('code'), { code: 'A', confirm: 'B' })).toBe(false)
    // Without valueInputKey (or blank) the fixed value is used, as before.
    expect(evaluateDecisionCondition({ id: 'c', inputKey: 'amount', operator: 'less_than', value: '20', valueInputKey: '' }, field('amount'), { amount: 10, budget: 5 })).toBe(true)
  })

  it('a table evaluates the first matching rule with an input-to-input condition', () => {
    const rules = [
      { id: 'over', label: 'Over budget', conditions: [{ id: 'c', inputKey: 'amount', operator: 'greater_than', value: '', valueInputKey: 'budget' }], outputs: { decision: 'escalate' } },
      { id: 'ok', label: 'Within', conditions: [], outputs: { decision: 'approve' } },
    ]
    expect(evaluateDecisionTable(inputs, rules, { amount: 1500, budget: 1000 }).outputs).toEqual({ decision: 'escalate' })
    expect(evaluateDecisionTable(inputs, rules, { amount: 500, budget: 1000 }).outputs).toEqual({ decision: 'approve' })
  })

  it('the API / MCP condition shapes and every normaliser keep valueInputKey', () => {
    expect(decisionTableConditionSchema.parse({ inputKey: 'amount', operator: 'less_than', valueInputKey: 'budget' }).valueInputKey).toBe('budget')
    expect(read('lib/mcp/tools/decision-tables.ts')).toMatch(/valueInputKey: z\.string\(\)\.optional\(\)/)
    for (const file of ['lib/services/decision-tables.ts', 'app/actions/business-rules.ts', 'lib/portability/normalize.ts', 'components/business-rules/decision-table-editor.tsx']) {
      expect(read(file), file).toMatch(/valueInputKey/)
    }
    expect(read('lib/gallery/validate.ts')).toMatch(/compares with unknown input/)
  })

  it('the editor offers Compare with: Value | Input', () => {
    const src = read('components/business-rules/decision-table-editor.tsx')
    expect(src).toMatch(/aria-label="Compare with"/)
    expect(src).toMatch(/<option value="input">Input<\/option>/)
    expect(src).toMatch(/aria-label="Comparison input"/)
  })
})

describe('form rules: compare a field with another field', () => {
  it('a field reference is stored as one placeholder and recognised by the designer', () => {
    expect(conditionFieldValue('budget')).toBe('{{budget}}')
    expect(conditionValueRef(' {{ budget }} ')).toBe('budget')
    expect(conditionValueRef('{{budget}} USD')).toBeNull()
    expect(conditionValueRef('100')).toBeNull()
    expect(conditionValueMode('{{budget}}', ['amount', 'budget'])).toBe('field')
    expect(conditionValueMode('{{form.budget}}', ['amount', 'budget'])).toBe('field')
    expect(conditionValueMode('{{today-30d}}', ['amount', 'budget'])).toBe('value')
    expect(conditionValueMode('500', ['amount', 'budget'])).toBe('value')
  })

  it('client side: the condition reads the other field’s live value (numbers and dates)', () => {
    const values = { amount: '1200', budget: 1000, start_date: '2026-11-10', end_date: '2026-11-01' }
    expect(ruleConditionMet({ column: 'amount', operator: 'gt', value: conditionFieldValue('budget') }, { values })).toBe(true)
    expect(ruleConditionMet({ column: 'amount', operator: 'lte', value: '{{form.budget}}' }, { values })).toBe(false)
    expect(ruleConditionMet({ column: 'end_date', operator: 'lt', value: '{{start_date}}' }, { values })).toBe(true)
    // Changing the other field changes the outcome: it is dynamic, not a copy taken at design time.
    expect(ruleConditionMet({ column: 'amount', operator: 'gt', value: '{{budget}}' }, { values: { ...values, budget: 5000 } })).toBe(false)
    // An empty other field never satisfies an ordering comparison.
    expect(ruleConditionMet({ column: 'amount', operator: 'gt', value: '{{budget}}' }, { values: { amount: 10 } })).toBe(false)
    expect(ruleConditionsMet({ match: 'all', conditions: [{ column: 'amount', operator: 'is_set' }, { column: 'amount', operator: 'gt', value: '{{budget}}' }] }, { values })).toBe(true)
  })

  it('server side: the submit is checked again with the submitted values', () => {
    const fields = normalizeTaskFields([
      { key: 'amount', label: 'Amount', type: 'number' },
      { key: 'budget', label: 'Budget', type: 'number' },
    ])
    const rule: FormRule = {
      id: 'r_budget', name: 'Within budget', event: 'before_submit',
      if: { match: 'all', conditions: [{ column: 'amount', operator: 'gt', value: '{{budget}}' }] },
      then: [{ type: 'field_error', field: 'amount', text: 'Amount is over the budget ({{budget}})' }],
    }
    const layout = normalizeFormLayout({ rows: [{ columns: 2, cells: [{ field_key: 'amount', span: 1 }, { field_key: 'budget', span: 1 }] }], rules: [rule] }, ['amount', 'budget'])!
    expect(ruleValidationErrors(layout, { amount: 1200, budget: 1000 })).toEqual({ amount: 'Amount is over the budget (1000)' })
    expect(validateTaskFieldValues(fields, { amount: 1200, budget: 1000 }, { layout }).amount).toBe('Amount is over the budget (1000)')
    expect(validateTaskFieldValues(fields, { amount: 800, budget: 1000 }, { layout })).toEqual({})
  })

  it('the rules designer offers Compare with: Value | Field, and lists fields in the condition data picker', () => {
    const editor = read('components/forms/designer/data-table-properties.tsx')
    expect(editor).toMatch(/options=\{\[\['value', 'Value'\], \['field', 'Field'\]\]\}/)
    expect(editor).toMatch(/conditionFieldValue\(v\)/)
    const panel = read('components/forms/designer/rules-panel.tsx')
    expect(panel).toMatch(/placeholders=\{conditionPlaceholders\} valueFields=\{subjects\}/)
    expect(panel).toMatch(/s\.hint === 'field'\)\.map\(\(s\) => \(\{ name: s\.value, group: 'This form'/)
    expect(read('components/forms/designer/list-properties.tsx')).toMatch(/valueFields=\{subjects\}/)
  })
})
