import { describe, expect, it } from 'vitest'
import { simpleArithmetic, translateActions } from '@/lib/importers/pdf/js-actions'
import { buildForms, calcExpression } from '@/lib/importers/pdf/build'
import { evaluateLabelExpression, labelScope } from '@/lib/forms/label-field'
import type { PdfFormModel, PdfItem } from '@/lib/importers/pdf/model'

/** PDF calculations (AFSimple_Calculate and plain arithmetic scripts) → calculated Label fields that really compute. */

const keyOf = (map: Record<string, string>) => (name: string) => map[name]

function evaluate(expression: string, fields: Array<{ key: string; type: string }>, values: Record<string, unknown>) {
  return evaluateLabelExpression(expression, labelScope(fields as never, values)).value
}

describe('Acrobat calculations', () => {
  it('reads AFSimple_Calculate and plain arithmetic Calculate scripts (never runs them)', () => {
    expect(translateActions({ Calculate: ['AFSimple_Calculate("SUM", new Array ("calc1", "calc2"));'] }).calc).toEqual({ op: 'SUM', fields: ['calc1', 'calc2'] })
    expect(translateActions({ Calculate: ['event.value = this.getField("qty").value * this.getField("price").value;'] }).calc)
      .toEqual({ op: 'EXPR', fields: ['qty', 'price'], expr: '$0 * $1' })
    expect(simpleArithmetic('var a = this.getField("a").value; var b = getField("b").value; event.value = (a - b) / 2;'))
      .toEqual({ expr: '($0 - $1) / 2', fields: ['a', 'b'] })
    expect(simpleArithmetic('event.value = AFMakeNumber(getField("x").value) + 10')).toEqual({ expr: '$0 + 10', fields: ['x'] })
    // Not plain arithmetic: left untranslated.
    expect(simpleArithmetic('if (getField("a").value > 1) event.value = 2;')).toBeNull()
    expect(simpleArithmetic('event.value = getField("a").value + app.alert("x")')).toBeNull()
    expect(simpleArithmetic('event.value = "text"')).toBeNull()
    expect(translateActions({ Calculate: ['for (;;) {}'] }).untranslated).toHaveLength(1)
  })

  it('builds expressions the form engine evaluates', () => {
    const fields = [{ key: 'a', type: 'number' }, { key: 'b', type: 'number' }]
    const map = keyOf({ calc1: 'a', calc2: 'b' })
    const sum = calcExpression({ op: 'SUM', fields: ['calc1', 'calc2'] }, map)!
    expect(evaluate(sum, fields, { a: 5, b: 10 })).toBe(15)
    expect(evaluate(sum, fields, { a: 5 })).toBe(5)
    expect(evaluate(calcExpression({ op: 'AVG', fields: ['calc1', 'calc2'] }, map)!, fields, { a: 4, b: 8 })).toBe(6)
    expect(evaluate(calcExpression({ op: 'MAX', fields: ['calc1', 'calc2'] }, map)!, fields, { a: 4, b: 8 })).toBe(8)
    expect(evaluate(calcExpression({ op: 'PRD', fields: ['calc1', 'calc2'] }, map)!, fields, { a: 3, b: 7 })).toBe(21)
    expect(evaluate(calcExpression({ op: 'EXPR', fields: ['calc1', 'calc2'], expr: '($0 - $1) / 2' }, map)!, fields, { a: 10, b: 4 })).toBe(3)
    expect(evaluate(calcExpression({ op: 'EXPR', fields: ['calc1', 'calc2'], expr: '$0 * $1 + 2' }, map)!, fields, { a: 3, b: 7 })).toBe(23)
    expect(evaluate(calcExpression({ op: 'EXPR', fields: ['calc1', 'calc2'], expr: '$0 + $1' }, map)!, fields, { a: 3 })).toBe(3)
    // An operand that isn't on the form: no expression.
    expect(calcExpression({ op: 'SUM', fields: ['calc1', 'elsewhere'] }, map)).toBeNull()
  })

  it('turns a calculated PDF field into a stored Label and its text operands into numbers', () => {
    const item = (id: string, extra: Partial<PdfItem> = {}): PdfItem => ({ id, label: id, type: 'text', page: 1, sourceFields: [id], origin: 'acroform', notes: [], ...extra } as PdfItem)
    const model = {
      title: 'Sample', pages: 1, kind: 'acroform', sections: [], rules: [],
      items: [item('calc1', { label: 'First' }), item('calc2', { label: 'Second' }), item('calcsum', { label: 'Total', readOnly: true, calc: { op: 'SUM', fields: ['calc1', 'calc2'] } })],
    } as unknown as PdfFormModel
    const [form] = buildForms(model, { fileName: 'form.pdf', hash: 'x' }).forms
    const total = form.fields.find((f) => f.label === 'Total')!
    expect(total.type).toBe('label')
    expect(total.label_config?.include).toBe(true)
    expect(total.read_only).toBeUndefined()
    expect(total.help_text ?? '').not.toMatch(/rebuild/i)
    const first = form.fields.find((f) => f.label === 'First')!
    const second = form.fields.find((f) => f.label === 'Second')!
    expect(first.type).toBe('number')
    expect(second.type).toBe('number')
    expect(evaluate(total.label_config!.expression!, form.fields as never, { [first.key]: '5', [second.key]: '10' })).toBe(15)
  })
})
