import { describe, expect, it } from 'vitest'
import { FORM_WIDTHS, clampFormWidthPct, formCardWidth, formCardWidthClass, formWidthClass, formWidthStyle, normalizeFormWidth, resolveFormWidth } from '@/lib/forms/form-width'
import { FormThemeOverridesSchema, parseFormThemeOverrides, parseFormThemeRef } from '@/lib/forms/form-theme'
import { normalizeDataTableConfig } from '@/lib/forms/data-table'
import { normalizeTaskFields } from '@/lib/task-field-schema'

const table = (extra: Record<string, unknown> = {}) => ({
  key: 'orders', label: 'Orders', type: 'data_table',
  data_table: { source: 'table', table_id: 't1', mode: 'display', columns: [{ key: 'a', label: 'A' }], ...extra },
})

describe('form width setting (theme form_width)', () => {
  it('accepts the four widths and refuses anything else', () => {
    for (const w of FORM_WIDTHS) expect(parseFormThemeOverrides({ form_width: w })?.form_width).toBe(w)
    expect(FormThemeOverridesSchema.safeParse({ form_width: 'huge' }).success).toBe(false)
    expect(parseFormThemeOverrides({ form_width: 'huge' })).toBeNull()
  })

  it('round-trips through a custom theme reference', () => {
    const ref = parseFormThemeRef({ source: 'custom', overrides: { form_width: 'wide', density: 'compact' } })
    expect(ref).toEqual({ source: 'custom', overrides: { form_width: 'wide', density: 'compact' } })
    expect(JSON.parse(JSON.stringify(ref))).toEqual(ref)
  })

  it('normalizes unknown / missing to normal', () => {
    expect(normalizeFormWidth(undefined)).toBe('normal')
    expect(normalizeFormWidth('x')).toBe('normal')
    expect(normalizeFormWidth('narrow')).toBe('narrow')
  })
})

describe('data table full_width', () => {
  it('survives normalizeDataTableConfig and normalizeTaskFields (save / export / import / API)', () => {
    expect(normalizeDataTableConfig({ ...table({ full_width: true }).data_table }).full_width).toBe(true)
    expect(normalizeDataTableConfig({ ...table({ full_width: 'yes' }).data_table }).full_width).toBeUndefined()
    const [field] = normalizeTaskFields([table({ full_width: true })])
    expect(field.data_table?.full_width).toBe(true)
    const [again] = normalizeTaskFields(JSON.parse(JSON.stringify([field])))
    expect(again.data_table?.full_width).toBe(true)
    const [plain] = normalizeTaskFields([table()])
    expect('full_width' in (plain.data_table ?? {})).toBe(false)
  })
})

describe('width resolution', () => {
  const fields = normalizeTaskFields([table({ full_width: true })])
  it('normal keeps each surface’s own width (existing forms unchanged)', () => {
    expect(formCardWidthClass(null, [])).toBe('max-w-3xl')
    expect(formCardWidthClass({ form_width: 'normal' }, [], 'max-w-4xl')).toBe('max-w-4xl')
    expect(formWidthClass('normal', 'max-w-4xl')).toBe('max-w-4xl')
  })
  it('maps narrow / wide / full', () => {
    expect(formCardWidthClass({ form_width: 'narrow' }, [])).toBe('max-w-xl')
    expect(formCardWidthClass({ form_width: 'wide' }, [])).toBe('max-w-6xl')
    expect(formCardWidthClass({ form_width: 'full' }, [])).toBe('max-w-none')
  })
  it('a full-width Data table raises the form to at least wide', () => {
    expect(resolveFormWidth(null, fields)).toBe('wide')
    expect(resolveFormWidth({ form_width: 'narrow' }, fields)).toBe('wide')
    expect(resolveFormWidth({ form_width: 'full' }, fields)).toBe('full')
    expect(resolveFormWidth(null, normalizeTaskFields([table()]))).toBe('normal')
  })
})

describe('custom % width', () => {
  it('clamps and rounds the percentage (40-100; unreadable -> 90)', () => {
    expect(clampFormWidthPct(90)).toBe(90)
    expect(clampFormWidthPct(10)).toBe(40)
    expect(clampFormWidthPct(250)).toBe(100)
    expect(clampFormWidthPct(72.6)).toBe(73)
    expect(clampFormWidthPct('55')).toBe(55)
    expect(clampFormWidthPct('abc')).toBe(90)
    expect(clampFormWidthPct(undefined)).toBe(90)
    expect(clampFormWidthPct(Number.NaN)).toBe(90)
  })

  it('the theme schema keeps custom + a clamped form_width_pct (survives versions / export / API)', () => {
    expect(parseFormThemeOverrides({ form_width: 'custom', form_width_pct: 12 })).toEqual({ form_width: 'custom', form_width_pct: 40 })
    expect(parseFormThemeOverrides({ form_width: 'custom', form_width_pct: 101.4 })).toEqual({ form_width: 'custom', form_width_pct: 100 })
    const ref = parseFormThemeRef({ source: 'custom', overrides: { form_width: 'custom', form_width_pct: 80 } })
    expect(parseFormThemeRef(JSON.parse(JSON.stringify(ref)))).toEqual({ source: 'custom', overrides: { form_width: 'custom', form_width_pct: 80 } })
    expect(parseFormThemeOverrides({ form_width: 'custom', form_width_pct: 'wide' })).toBeNull()
  })

  it('resolves to a class (100 % on phones, at least 320px) plus the percentage variable', () => {
    const o = { form_width: 'custom', form_width_pct: 75 }
    const cls = formCardWidthClass(o, [])
    expect(cls).toContain('w-full')
    expect(cls).toContain('sm:w-[min(100%,max(320px,var(--form-width-pct)))]')
    expect(formWidthStyle(o)).toEqual({ '--form-width-pct': '75%' })
    expect(formWidthStyle({ form_width: 'custom' })).toEqual({ '--form-width-pct': '90%' })
    expect(formWidthStyle({ form_width: 'wide', form_width_pct: 50 })).toEqual({})
    expect(formWidthStyle(null)).toEqual({})
  })

  it('a custom % is kept even with a full-width Data table; normal adds nothing on surfaces with no own width', () => {
    const fields = normalizeTaskFields([table({ full_width: true })])
    expect(resolveFormWidth({ form_width: 'custom', form_width_pct: 50 }, fields)).toBe('custom')
    expect(formCardWidth(null, [], '')).toEqual({ className: '', style: {}, width: 'normal' })
    expect(formCardWidth({ form_width: 'custom', form_width_pct: 60 }, [], 'max-w-4xl').style).toEqual({ '--form-width-pct': '60%' })
  })

  it('offers custom among the widths', () => {
    expect(FORM_WIDTHS).toContain('custom')
    expect(normalizeFormWidth('custom')).toBe('custom')
  })
})
