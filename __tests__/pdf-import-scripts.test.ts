import { describe, expect, it } from 'vitest'
import { maskToPattern, safePattern, translateActions } from '@/lib/importers/pdf/js-actions'
import { findRouting, questionNumberOf, questionOrder, linkRouting } from '@/lib/importers/pdf/routing'
import type { PdfFormModel, PdfItem } from '@/lib/importers/pdf/model'

describe('Acrobat script patterns (matched, never run)', () => {
  it('reads date, currency, number, percent and range formats', () => {
    expect(translateActions({ Format: ['AFDate_FormatEx("dd/mm/yyyy");'] })).toMatchObject({ type: 'date', format: 'dd/mm/yyyy' })
    expect(translateActions({ Format: ['AFNumber_Format(2, 0, 0, 0, "£", true);'] })).toMatchObject({ type: 'currency', currency: 'GBP', decimals: 2 })
    expect(translateActions({ Format: ['AFNumber_Format(0, 1, 0, 0, "", false);'] }).type).toBe('number')
    expect(translateActions({ Keystroke: ['AFPercent_Keystroke(2, 0);'] })).toMatchObject({ type: 'number', percent: true })
    expect(translateActions({ Validate: ['AFRange_Validate(true, 1, true, 99);'] })).toMatchObject({ min: 1, max: 99 })
  })

  it('maps AFSpecial codes and keystroke masks to patterns', () => {
    const phone = translateActions({ Keystroke: ['AFSpecial_Keystroke(2);'] })
    expect(phone.type).toBe('phone')
    expect(new RegExp(phone.pattern!).test('(555) 123-4567')).toBe(true)
    const zip = translateActions({ Format: ['AFSpecial_Format(0);'] })
    expect(new RegExp(zip.pattern!).test('12345')).toBe(true)
    expect(maskToPattern('999-99-9999')).toBe('^\\d\\d\\d\\-\\d\\d\\-\\d\\d\\d\\d$')
    expect(new RegExp(translateActions({ Keystroke: ['AFSpecial_KeystrokeEx("AA 9999");'] }).pattern!).test('AB 1234')).toBe(true)
  })

  it('takes a regex literal from a validation script, refusing unsafe ones', () => {
    expect(translateActions({ Validate: ['var re = /^[A-Z]{2}\\d{6}[A-D]$/; if (!re.test(event.value)) event.rc = false;'] })).toMatchObject({ pattern: '^[A-Z]{2}\\d{6}[A-D]$', patternConfidence: 'medium' })
    expect(safePattern('^(a+)+$')).toBeNull()
    expect(translateActions({ Validate: ['var re = /^(a+)+$/; re.test(event.value)'] }).pattern).toBeUndefined()
  })

  it('reads show / hide statements with a simple if / else, flipping the else branch', () => {
    const t = translateActions({ MouseUp: ['if (event.target.value == "Yes") { this.getField("a").display = display.visible; } else { this.getField("a").display = display.hidden; }'] })
    expect(t.visibility).toEqual([
      expect.objectContaining({ target: 'a', mode: 'show', when: { field: null, op: 'equals', value: 'Yes' }, confidence: 'high' }),
      expect.objectContaining({ target: 'a', mode: 'hide', when: { field: null, op: 'not_equals', value: 'Yes' }, confidence: 'high' }),
    ])
    const other = translateActions({ Keystroke: ['if (this.getField("q1").value != "Off") this.getField("b").display = display.hidden;'] })
    expect(other.visibility[0]).toMatchObject({ target: 'b', mode: 'hide', when: { field: 'q1', op: 'not_equals', value: 'Off' } })
    const unconditional = translateActions({ MouseUp: ['this.getField("c").display = display.visible;'] })
    expect(unconditional.visibility[0]).toMatchObject({ target: 'c', when: null, confidence: 'high' })
    const complex = translateActions({ MouseUp: ['for (var i = 0; i < 3; i++) { if (x) this.getField("d").display = display.hidden; }'] })
    expect(complex.visibility[0].confidence).toBe('low')
  })

  it('notes calculations, required toggles and mutual exclusion; keeps the rest untranslated', () => {
    const t = translateActions({ Calculate: ['AFSimple_Calculate("SUM", new Array ("a", "b"));'], MouseUp: ['this.getField("x").required = true;'], Format: ['app.alert("hi"); event.value = util.printx("999", event.value);'] })
    expect(t.calc).toEqual({ op: 'SUM', fields: ['a', 'b'] })
    expect(t.required).toEqual([expect.objectContaining({ target: 'x', value: true })])
    expect(t.untranslated).toEqual([expect.objectContaining({ event: 'Format' })])
    expect(translateActions({ MouseUp: ['if (event.target.value != "Off") { this.getField("cb2").value = "Off"; this.getField("cb3").value = "Off"; }'] }).exclusiveWith).toEqual(['cb2', 'cb3'])
  })

  it('never executes a script: hostile code is only text', () => {
    const marker = '__pdfImportPwned'
    const t = translateActions({ Format: [`globalThis.${marker} = true; (function(){ throw new Error('ran') })();`], Calculate: [`eval("globalThis.${marker} = 1")`] })
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined()
    expect(t.untranslated).toHaveLength(2)
  })
})

describe('routing grammar', () => {
  it('recognises the phrase kinds', () => {
    expect(findRouting('If No, go to question 10')[0]).toMatchObject({ kind: 'conditional', when: 'No', target: '10' })
    expect(findRouting('If you answered "Yes" to question 3, skip to Section C')[0]).toMatchObject({ kind: 'conditional', when: 'Yes', whenQuestion: '3', targetType: 'section', target: 'C' })
    expect(findRouting('Less than 1 acre ➔ SKIP to question 6a')[0]).toMatchObject({ kind: 'option_arrow', when: 'Less than 1 acre', target: '6a' })
    expect(findRouting('Answer questions 4 – 5 only if you ticked Yes at question 3.')[0]).toMatchObject({ kind: 'show_if', from: '4', to: '5', when: 'Yes', whenQuestion: '3' })
    expect(findRouting('Go to question 7')[0]).toMatchObject({ kind: 'goto', target: '7' })
    expect(findRouting('Otherwise, SKIP to question 19').map((h) => h.kind)).toContain('otherwise')
    expect(findRouting('Your name and address')).toEqual([])
  })

  it('reads printed question numbers and orders sub-questions', () => {
    expect(questionNumberOf('6a. How many rooms?')).toEqual({ num: '6a', rest: 'How many rooms?' })
    expect(questionNumberOf('Q12 What is your job')).toMatchObject({ num: '12' })
    expect(questionNumberOf('2024 Form 1040')).toBeNull()
    expect(questionOrder('6') < questionOrder('6a') && questionOrder('6a') < questionOrder('7')).toBe(true)
  })

  const item = (id: string, question: string, extra: Partial<PdfItem> = {}): PdfItem => ({ id, type: 'text', label: id, labelSource: 'tooltip', page: 1, question, sourceFields: [id], origin: 'deterministic', notes: [], ...extra })
  const model = (): PdfFormModel => ({
    title: 't', kind: 'acroform', pages: 1, sections: [], rules: [], notes: [],
    items: [
      item('q3', '3', { type: 'choice', options: [{ value: 'Y', label: 'Yes' }, { value: 'N', label: 'No' }] }),
      item('q3b', '3'), item('q4', '4'), item('q5', '5'), item('q6', '6'),
    ],
  })

  it('links a resolvable jump as a HIGH rule hiding what it skips', () => {
    const m = model()
    let n = 0
    linkRouting({ model: m, texts: [{ itemId: 'q3', optionValue: 'N', text: 'No (If no, go to question 5)', page: 1 }], nextId: () => `r${++n}` })
    expect(m.rules).toEqual([expect.objectContaining({ confidence: 'high', mode: 'hide', when: { item: 'q3', op: 'equals', value: 'N' }, targets: ['q3b', 'q4'] })])
  })

  it('keeps unresolvable instructions as LOW rules with the reason', () => {
    const m = model()
    let n = 0
    linkRouting({ model: m, texts: [
      { itemId: 'q3', text: 'If No, go to question 40', page: 1 },
      { itemId: 'q3', text: 'If Maybe, go to question 5', page: 1 },
      { itemId: 'q4', text: 'If you answered Yes to question 3, go to Part 2', page: 1 },
      { itemId: 'q6', text: 'Answer this question only if you live alone', page: 1 },
    ], nextId: () => `r${++n}` })
    expect(m.rules.every((r) => r.confidence === 'low' && r.reason)).toBe(true)
    expect(m.rules.map((r) => r.reason)).toEqual([
      'question 40 was not found',
      'the answer "Maybe" was not matched to an option',
      'it jumps to part 2: set the targets by hand',
      '"you live alone" does not name a question',
    ])
  })

  it('turns a show_if with a question reference into a HIGH show rule', () => {
    const m = model()
    linkRouting({ model: m, texts: [{ itemId: 'q4', text: 'Answer questions 4 to 5 only if you answered Yes to question 3', page: 1 }], nextId: () => 'r1' })
    expect(m.rules[0]).toMatchObject({ confidence: 'high', mode: 'show', when: { item: 'q3', value: 'Y' }, targets: ['q4', 'q5'] })
  })
})
