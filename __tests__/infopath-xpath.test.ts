import { describe, expect, it } from 'vitest'
import { parseXPath, resolveBinding, toCondition, toExpression, type Ref, type TranslateEnv } from '@/lib/infopath/xpath'
import { serverLabelValues } from '@/lib/forms/label-field'

const FIELDS: Record<string, Ref> = {
  '/r/status': { kind: 'field', key: 'status' },
  '/r/total': { kind: 'field', key: 'total' },
  '/r/email': { kind: 'field', key: 'email' },
  '/r/start': { kind: 'field', key: 'start_date' },
  '/r/end': { kind: 'field', key: 'end_date' },
  '/r/items/item': { kind: 'list', key: 'items' },
  '/r/items/item/qty': { kind: 'column', list: 'items', column: 'qty' },
  '/r/items/item/price': { kind: 'column', list: 'items', column: 'price' },
}
const env = (context = '/r', row: string | null = null): TranslateEnv => ({ context, row, resolve: (p) => FIELDS[p] ?? null })

describe('XPath parsing', () => {
  it('parses paths, functions, operators and predicates', () => {
    expect(parseXPath('../my:a/my:b')).toMatchObject({ t: 'path', abs: false, steps: ['..', 'my:a', 'my:b'] })
    expect(parseXPath('my:a[1]/my:b')).toMatchObject({ t: 'path', filtered: true })
    expect(parseXPath('xdDate:AddDays(., 3)')).toMatchObject({ t: 'fn', name: 'xdDate:AddDays' })
    expect(parseXPath('a = "x" or b != 2 and not(c)')).toMatchObject({ t: 'bin', op: 'or' })
    expect(parseXPath('my:a * my:b div 2')).toMatchObject({ t: 'bin', op: 'div' })
    expect(() => parseXPath('a = "unterminated')).toThrow()
  })

  it('resolves bindings against a context node', () => {
    expect(resolveBinding('/r/items/item', '../../my:status')).toBe('/r/status')
    expect(resolveBinding('/r', 'my:items/my:item/my:qty')).toBe('/r/items/item/qty')
    expect(resolveBinding('/r', '/my:r/my:total')).toBe('/r/total')
  })
})

describe('XPath → rule conditions', () => {
  it('translates comparisons, blanks, and / or and not()', () => {
    expect(toCondition('my:status = "Draft"', env())).toEqual({ ok: true, notes: [], value: { match: 'all', conditions: [{ column: 'status', operator: 'eq', value: 'Draft' }] } })
    expect(toCondition('my:status = ""', env())).toMatchObject({ ok: true, value: { conditions: [{ column: 'status', operator: 'is_not_set' }] } })
    expect(toCondition('string-length(my:email) > 0', env())).toMatchObject({ ok: true, value: { conditions: [{ column: 'email', operator: 'is_set' }] } })
    expect(toCondition('1000 < my:total', env())).toMatchObject({ ok: true, value: { conditions: [{ column: 'total', operator: 'gt', value: '1000' }] } })
    const c = toCondition('not(my:status = "A" or my:total >= 5)', env())
    expect(c).toMatchObject({ ok: true, value: { match: 'all', conditions: [{ column: 'status', operator: 'neq', value: 'A' }, { column: 'total', operator: 'lt', value: '5' }] } })
    expect(toCondition('contains(., "@")', env('/r/email'))).toMatchObject({ ok: true, value: { conditions: [{ column: 'email', operator: 'contains', value: '@' }] } })
  })

  it('compares two fields with a template and reads msxsl:string-compare', () => {
    expect(toCondition('msxsl:string-compare(., ../my:start) < 0', env('/r/end'))).toMatchObject({ ok: true, value: { conditions: [{ column: 'end_date', operator: 'lt', value: '{{form.start_date}}' }] } })
  })

  it('reads a List row inside its row, and refuses outside', () => {
    expect(toCondition('../my:qty > 2', env('/r/items/item/price', 'items'))).toMatchObject({ ok: true, value: { conditions: [{ column: 'row.qty', operator: 'gt', value: '2' }] } })
    expect(toCondition('my:items/my:item/my:qty > 2', env())).toMatchObject({ ok: false })
  })

  it('says why when there is no equivalent', () => {
    expect(toCondition('xdXDocument:get-Role() = "Manager"', env())).toMatchObject({ ok: true, value: { conditions: [{ column: 'user.roles', operator: 'contains', value: 'Manager' }] } })
    expect(toCondition('xdXDocument:get-Role() != "Manager"', env())).toMatchObject({ ok: true, value: { conditions: [{ column: 'user.roles', operator: 'neq', value: 'Manager' }] } })
    expect(toCondition('xdXDocument:get-Role() = my:status', env())).toMatchObject({ ok: false })
    expect(toCondition('count(xdXDocument:GetDOM("Projects")/a) > 0', env())).toMatchObject({ ok: false })
    expect(toCondition('not(contains(my:email, "@"))', env())).toMatchObject({ ok: false, reason: expect.stringMatching(/not/) })
    expect(toCondition('my:unknown = 1', env())).toMatchObject({ ok: false, reason: expect.stringMatching(/not on the form/) })
  })
})

describe('XPath → formulas', () => {
  it('maps functions and arithmetic', () => {
    expect(toExpression('concat(my:status, " - ", my:total)', env())).toMatchObject({ ok: true, value: 'CONCAT({{form.status}}, " - ", {{form.total}})' })
    expect(toExpression('sum(my:items/my:item/my:price)', env())).toMatchObject({ ok: true, value: 'SUM(PLUCK({{form.items}}, "price"))' })
    expect(toExpression('count(my:items/my:item)', env())).toMatchObject({ ok: true, value: 'COUNT({{form.items}})' })
    expect(toExpression('xdDate:Today()', env())).toMatchObject({ ok: true, value: 'TODAY()' })
    expect(toExpression('xdDate:AddDays(my:start, 14)', env())).toMatchObject({ ok: true, value: 'ADD_DAYS({{form.start_date}}, 14)' })
    expect(toExpression('my:total * 1.1 div 2', env())).toMatchObject({ ok: true, value: '(({{form.total}} * 1.1) / 2)' })
    expect(toExpression('../my:qty * ../my:price', env('/r/items/item/total', 'items'))).toMatchObject({ ok: true, value: '({{row.qty}} * {{row.price}})' })
    expect(toExpression('translate(my:status, "abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ")', env())).toMatchObject({ ok: true, value: 'UPPER({{form.status}})' })
  })

  it('refuses what has no equivalent with a reason', () => {
    expect(toExpression('xdMath:Eval(my:items/my:item, "my:qty")', env())).toMatchObject({ ok: false })
    expect(toExpression('position()', env())).toMatchObject({ ok: false, reason: expect.stringMatching(/row position/) })
    expect(toExpression('xdUser:get-UserName()', env())).toMatchObject({ ok: false, reason: expect.stringMatching(/in rules/) })
  })

  it('translates the extra string, aggregate and InfoPath functions', () => {
    expect(toExpression('substring-before(my:email, "@")', env())).toMatchObject({ ok: true, value: 'SUBSTRING_BEFORE({{form.email}}, "@")' })
    expect(toExpression('substring-after(my:email, "@")', env())).toMatchObject({ ok: true, value: 'SUBSTRING_AFTER({{form.email}}, "@")' })
    expect(toExpression('translate(my:status, "-", "/")', env())).toMatchObject({ ok: true, value: 'TRANSLATE({{form.status}}, "-", "/")' })
    expect(toExpression('normalize-space(my:status)', env())).toMatchObject({ ok: true, value: 'NORMALIZE_SPACE({{form.status}})' })
    expect(toExpression('starts-with(my:status, "A")', env())).toMatchObject({ ok: true, value: 'STARTS_WITH({{form.status}}, "A")' })
    expect(toExpression('substring(my:status, 2, 3)', env())).toMatchObject({ ok: true, value: 'MID({{form.status}}, 2, 3)' })
    expect(toExpression('xdUtil:Concat(my:status, "!")', env())).toMatchObject({ ok: true, value: 'CONCAT({{form.status}}, "!")' })
    expect(toExpression('xdMath:Nz(my:total)', env())).toMatchObject({ ok: true, value: 'COALESCE({{form.total}}, 0)' })
    expect(toExpression('xdMath:Avg(my:items/my:item/my:price)', env())).toMatchObject({ ok: true, value: 'AVG(PLUCK({{form.items}}, "price"))' })
    expect(toExpression('xdDate:AddSeconds(xdDate:Now(), 120)', env())).toMatchObject({ ok: true, value: 'ADD_MINUTES(NOW(), (120) / 60)' })
    expect(toExpression('sum(my:items/my:item[my:qty = 2]/my:price)', env())).toMatchObject({ ok: true, value: 'SUMIF({{form.items}}, "qty", 2, "price")' })
    expect(toExpression('count(my:items/my:item[my:price = "10"])', env())).toMatchObject({ ok: true, value: 'COUNTIF({{form.items}}, "price", "10")' })
    expect(toExpression('sum(my:items/my:item[my:qty > 2]/my:price)', env())).toMatchObject({ ok: false, reason: expect.stringMatching(/filters rows/) })
    expect(toExpression('concat(xdUser:get-DisplayName(), " / ", my:status)', { ...env(), allowUser: true })).toMatchObject({ ok: true, value: 'CONCAT({{user.name}}, " / ", {{form.status}})' })
    // xdMath:Eval → a calculated column, summed.
    const added: string[] = []
    const withEval = { ...env(), evalColumn: (list: string, formula: string) => { added.push(`${list}|${formula}`); return { list: 'items', column: 'line_total' } } }
    expect(toExpression('sum(xdMath:Eval(my:items/my:item, "my:qty * my:price"))', withEval)).toMatchObject({ ok: true, value: 'SUM(PLUCK({{form.items}}, "line_total"))' })
    expect(added).toEqual(['/r/items/item|my:qty * my:price'])
  })

  it('evaluates the new functions in the expression engine', () => {
    const fields = [
      { key: 'email', label: 'Email', type: 'text' }, { key: 'status', label: 'Status', type: 'text' },
      { key: 'items', label: 'Items', type: 'list', list: { columns: [{ key: 'qty', label: 'Qty', type: 'number' }, { key: 'price', label: 'Price', type: 'number' }] } },
      ...[
        ['a', 'SUBSTRING_BEFORE({{form.email}}, "@")'], ['b', 'SUBSTRING_AFTER({{form.email}}, "@")'], ['c', 'TRANSLATE({{form.status}}, "-", "/")'],
        ['d', 'NORMALIZE_SPACE({{form.status}})'], ['e', 'SUMIF({{form.items}}, "qty", 2, "price")'], ['f', 'COUNTIF({{form.items}}, "qty", 2)'], ['g', 'STARTS_WITH({{form.email}}, "ada")'],
      ].map(([key, expression]) => ({ key, label: key, type: 'label', label_config: { expression, include: true } })),
    ]
    const out = serverLabelValues(fields as never, null, { email: 'ada@example.com', status: '  a-b   c ', items: [{ qty: 2, price: 10 }, { qty: 1, price: 99 }, { qty: 2, price: 5.5 }] }, { sent: {} })
    expect(out).toMatchObject({ a: 'ada', b: 'example.com', c: '  a/b   c ', d: 'a/b c'.replace('/', '-'), e: 15.5, f: 2, g: true })
  })

  it('produces formulas the Label engine evaluates', () => {
    const total = toExpression('sum(my:items/my:item/my:price)', env())
    const both = toExpression('concat(my:status, " (", my:total, ")")', env())
    if (!total.ok || !both.ok) throw new Error('not translated')
    const fields = [
      { key: 'items', label: 'Items', type: 'list', list: { columns: [{ key: 'price', label: 'Price', type: 'number' }] } },
      { key: 'sum', label: 'Sum', type: 'label', label_config: { expression: total.value, include: true } },
      { key: 'both', label: 'Both', type: 'label', label_config: { expression: both.value, include: true } },
      { key: 'status', label: 'Status', type: 'text' }, { key: 'total', label: 'Total', type: 'number' },
    ]
    expect(serverLabelValues(fields as never, null, { items: [{ price: 10.5 }, { price: 4 }], status: 'Open', total: 3 }, { sent: {} })).toMatchObject({ sum: 14.5, both: 'Open (3)' })
  })
})
