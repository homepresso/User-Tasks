/**
 * Form header title / subtitle: the designer's Buttons & header text reaches
 * the stored form and the drawn header; a title / subtitle typed in the
 * theme's own header (Form theme tab → Header) is no longer dropped behind a
 * form header with none (new forms start with one on). Regression for
 * "the form header text and subtitle is not displaying".
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FormHeaderBlock } from '@/components/forms/form-shell'
import { WorkflowStartFormView } from '@/components/forms/workflow-start-form-view'
import { definitionFrom, designerStateFrom } from '@/lib/forms/designer-state'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { normalizeFormHeader, withThemeHeaderText, type FormHeader } from '@/lib/forms/header'
import { checkFormAccessibility } from '@/lib/forms/accessibility'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { normalizeFormButtons } from '@/lib/forms/buttons'
import type { FormThemeOverrides } from '@/lib/forms/form-theme'

const drawn = (header: FormHeader | null | undefined, overrides?: FormThemeOverrides | null) =>
  renderToStaticMarkup(createElement(FormHeaderBlock, { header, values: {}, overrides }))

// What the "Simple Expense Claim" form stored: the default form header (on, no text)
// and the title / subtitle in the custom theme's header.
const LIVE_HEADER: FormHeader = { align: 'left', image: 'default', enabled: true }
const LIVE_THEME: FormThemeOverrides = { header: { enabled: true, title: 'Expense Claims', subtitle: 'News' }, form_width: 'wide' } as FormThemeOverrides

describe('withThemeHeaderText', () => {
  it('fills an empty title / subtitle from an enabled theme header', () => {
    expect(withThemeHeaderText(LIVE_HEADER, LIVE_THEME.header)).toEqual({ ...LIVE_HEADER, title: 'Expense Claims', subtitle: 'News' })
  })
  it("keeps the form header's own text, each part on its own", () => {
    expect(withThemeHeaderText({ ...LIVE_HEADER, title: 'Mine' }, LIVE_THEME.header)).toEqual({ ...LIVE_HEADER, title: 'Mine', subtitle: 'News' })
    expect(withThemeHeaderText({ ...LIVE_HEADER, title: 'Mine', subtitle: 'Sub' }, LIVE_THEME.header)).toEqual({ ...LIVE_HEADER, title: 'Mine', subtitle: 'Sub' })
    expect(withThemeHeaderText({ ...LIVE_HEADER, title: '  ' }, LIVE_THEME.header)?.title).toBe('Expense Claims')
  })
  it('nothing to fill: the same header back', () => {
    expect(withThemeHeaderText(LIVE_HEADER, { ...LIVE_THEME.header!, enabled: false })).toBe(LIVE_HEADER)
    expect(withThemeHeaderText(LIVE_HEADER, null)).toBe(LIVE_HEADER)
    const off = { ...LIVE_HEADER, enabled: false }
    expect(withThemeHeaderText(off, LIVE_THEME.header)).toBe(off)
    expect(withThemeHeaderText(null, LIVE_THEME.header)).toBeNull()
  })
})

describe('form header title and subtitle', () => {
  it('designer state → saved definition → normalised header → drawn header', () => {
    const state = designerStateFrom(normalizeFormDefinition({ fields: [] }))
    expect(state.header.enabled).toBe(true)
    // HeaderEditor: set({ title }) then set({ subtitle }), each spreading the current header.
    const typed = { ...state, header: { ...{ ...state.header, title: 'Expense claim — {{task_data.who}}' }, subtitle: 'Fill in every line' } }
    const def = definitionFrom({ ...typed, fields: designerStateFrom(normalizeFormDefinition({ fields: normalizeTaskFields([{ key: 'who', label: 'Who', type: 'text' }]) })).fields })
    expect(def.header).toMatchObject({ enabled: true, title: 'Expense claim — {{task_data.who}}', subtitle: 'Fill in every line' })
    // The save payload (header: def.header ?? null) as the service normalises it, then as the form page reads it.
    const stored = normalizeFormDefinition({ fields: def.fields, layout: def.layout, theme: def.theme, buttons: def.buttons, header: JSON.parse(JSON.stringify(def.header ?? null)) })
    const header = normalizeFormHeader(stored.header)
    expect(header).toMatchObject({ title: 'Expense claim — {{task_data.who}}', subtitle: 'Fill in every line' })
    const html = renderToStaticMarkup(createElement(FormHeaderBlock, { header, values: { who: 'Ana' } }))
    expect(html).toContain('data-form-header')
    expect(html).toContain('Expense claim — Ana')
    expect(html).toContain('Fill in every line')
  })

  it("the theme header's title / subtitle show behind a form header with none (the reported form)", () => {
    const html = drawn(LIVE_HEADER, LIVE_THEME)
    expect(html).toContain('Expense Claims')
    expect(html).toContain('News')
    // Before: only the image.
    expect(drawn(LIVE_HEADER, null)).not.toContain('Expense Claims')
  })

  it("the form's own text wins over the theme's", () => {
    const html = drawn({ ...LIVE_HEADER, title: 'Claim your expenses' }, LIVE_THEME)
    expect(html).toContain('Claim your expenses')
    expect(html).not.toContain('Expense Claims')
    expect(html).toContain('News')
  })

  it('a form page draws the text once (the theme header itself stays hidden)', () => {
    const spec = {
      kind: 'form', button_ids: [],
      form: { id: 'f1', name: 'Simple Expense Claim', description: null, version: 4, layout: null, theme_overrides: LIVE_THEME, header: LIVE_HEADER, fields: normalizeTaskFields([{ key: 'amount', label: 'Amount', type: 'number' }]), buttons: normalizeFormButtons([{ id: 'submit', label: 'Submit', kind: 'submit' }]) },
    } as any
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(WorkflowStartFormView, { spec, values: {}, errors: {}, onChange: () => {}, onPress: () => {} } as any)))
    expect(html.split('Expense Claims').length - 1).toBe(1)
    expect(html.split('>News<').length - 1).toBe(1)
  })

  it('the accessibility check counts the theme header title as the heading', () => {
    const fields = normalizeTaskFields([{ key: 'amount', label: 'Amount', type: 'number' }])
    const untitled = checkFormAccessibility({ fields, layout: null, theme: { source: 'custom', overrides: {} }, header: LIVE_HEADER } as any)
    expect(untitled.findings.some((f) => f.id === 'headings:title')).toBe(true)
    const viaTheme = checkFormAccessibility({ fields, layout: null, theme: { source: 'custom', overrides: LIVE_THEME }, header: LIVE_HEADER } as any)
    expect(viaTheme.findings.some((f) => f.id === 'headings:title')).toBe(false)
  })
})
