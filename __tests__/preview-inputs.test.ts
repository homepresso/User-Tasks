/**
 * Designer Preview test inputs (lib/forms/preview-inputs.ts): the preview
 * seeds parameters and variables exactly as the form page does when opened
 * with a query string, and the "Test inputs" panel renders one typed input
 * per parameter and each variable's live value.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FORM_PARAMS_KEY, FORM_VARS_KEY, paramsFromQuery, parseFormParams, layoutFormParams, withFormContext } from '@/lib/forms/form-params'
import {
  contextValueText, normalizePreviewInputs, openingFieldDefaults, parseVariableInput, previewSeed, previewShownValues,
} from '@/lib/forms/preview-inputs'
import { PreviewTestInputsPanel } from '@/components/forms/designer/preview-test-inputs'
import type { TaskFieldDef } from '@/lib/task-field-schema'

const LAYOUT = {
  rows: [],
  params: [
    { name: 'customer', label: 'Customer', type: 'text', source: 'url', required: true, pattern: '[A-Z]{5}' },
    { name: 'limit', type: 'number', source: 'url', default: '10', min: 1, max: 100 },
    { name: 'vip', type: 'boolean', source: 'url', default: 'no' },
    { name: 'region', type: 'text', source: 'context', allowed: ['north', 'south'] },
  ],
  variables: [
    { name: 'greeting', type: 'text', initial: { kind: 'expression', value: 'Hello {{param.customer}}' } },
    { name: 'max_rows', type: 'number', initial: { kind: 'param', value: 'limit' } },
    { name: 'picked', type: 'object' },
  ],
}
const FIELDS: TaskFieldDef[] = [
  { key: 'who', label: 'Who', type: 'text', default: '{{param.customer}}' },
  { key: 'note', label: 'Note', type: 'text', default: '{{something_else}}' },
] as TaskFieldDef[]

describe('previewSeed', () => {
  it('applies defaults, reports a missing required parameter as the form page would', () => {
    const seed = previewSeed(FIELDS, LAYOUT)
    expect(seed.params?.values).toEqual({ customer: null, limit: 10, vip: false, region: null })
    expect(seed.params?.missing).toEqual(['customer'])
    expect(seed.message).toContain('"Customer"')
    expect(seed.defaults).toMatchObject({ who: null, note: null })
  })

  it('coerces typed text like a URL query and fills {{param.x}} field defaults', () => {
    const seed = previewSeed(FIELDS, LAYOUT, { params: { customer: 'ALFKI', limit: ' 25 ', vip: 'true' }, vars: {} })
    expect(seed.params?.values).toEqual({ customer: 'ALFKI', limit: 25, vip: true, region: null })
    expect(seed.message).toBeNull()
    expect(seed.defaults.who).toBe('ALFKI')
    // Identical to opening /f/<id>?customer=ALFKI&limit=25&vip=true.
    const declared = layoutFormParams(LAYOUT)
    const fromUrl = parseFormParams(declared, paramsFromQuery(declared, new URLSearchParams('customer=ALFKI&limit=25&vip=true')))
    expect(seed.params?.values).toEqual(fromUrl.values)
    expect(seed.defaults).toEqual(openingFieldDefaults(FIELDS, fromUrl.values))
  })

  it('refuses invalid values with the runtime validators (the default applies)', () => {
    const seed = previewSeed(FIELDS, LAYOUT, { params: { customer: 'alfki', limit: '500', vip: 'maybe', region: 'east' }, vars: {} })
    expect(seed.params?.errors).toEqual({
      customer: '"alfki" does not have the expected format',
      limit: 'must be at most 100',
      vip: 'expected yes or no',
      region: '"east" is not one of the allowed values',
    })
    expect(seed.params?.values.limit).toBe(10)
    expect(seed.params?.missing).toEqual([])
  })

  it('treats a blank input as not given', () => {
    expect(previewSeed(FIELDS, LAYOUT, { params: { limit: '  ' }, vars: {} }).params?.values.limit).toBe(10)
  })

  it('derives variables from the parameters through the renderer’s withFormContext', () => {
    const seed = previewSeed(FIELDS, LAYOUT, { params: { customer: 'ALFKI', limit: '42' }, vars: {} })
    const ctx = withFormContext(LAYOUT, previewShownValues(seed, seed.initialValues))
    expect(ctx[FORM_PARAMS_KEY]).toEqual(seed.params?.values)
    expect(ctx[FORM_VARS_KEY]).toEqual({ greeting: 'Hello ALFKI', max_rows: 42, picked: null })
  })

  it('puts valid variable overrides under FORM_VARS_KEY and reports refused ones', () => {
    const seed = previewSeed(FIELDS, LAYOUT, { params: { limit: '42' }, vars: { max_rows: '7', picked: '{"id":', greeting: 'Hi' } })
    expect(seed.vars).toEqual({ max_rows: 7, greeting: 'Hi' })
    expect(seed.varErrors.picked).toMatch(/JSON/)
    expect(seed.initialValues).toEqual({ [FORM_VARS_KEY]: { max_rows: 7, greeting: 'Hi' } })
    const ctx = withFormContext(LAYOUT, previewShownValues(seed, seed.initialValues))
    expect(ctx[FORM_VARS_KEY]).toMatchObject({ max_rows: 7, greeting: 'Hi' })
  })

  it('leaves a form without declarations alone', () => {
    const seed = previewSeed(FIELDS, { rows: [] })
    expect(seed.params).toBeNull()
    expect(previewShownValues(seed, { who: 'x' })).not.toHaveProperty(FORM_PARAMS_KEY)
  })
})

describe('helpers', () => {
  it('parses variable text by type', () => {
    expect(parseVariableInput({ type: 'text_list' }, 'a, b')).toEqual({ value: ['a', 'b'] })
    expect(parseVariableInput({ type: 'object' }, '{"id":1}')).toEqual({ value: { id: 1 } })
    expect(parseVariableInput({ type: 'object' }, '')).toEqual({ value: null })
    expect(parseVariableInput({ type: 'number' }, 'x')).toEqual({ error: 'expected a number' })
    expect(contextValueText(['a', 'b'])).toBe('a, b')
    expect(contextValueText({ id: 1 })).toBe('{"id":1}')
    expect(contextValueText(null)).toBe('')
  })

  it('cleans stored inputs against the declarations', () => {
    expect(normalizePreviewInputs(LAYOUT, { params: { customer: 'ALFKI', gone: 'x', limit: 5 }, vars: { picked: '{}', nope: '1' } }))
      .toEqual({ params: { customer: 'ALFKI' }, vars: { picked: '{}' } })
    expect(normalizePreviewInputs(LAYOUT, 'junk')).toEqual({ params: {}, vars: {} })
  })
})

describe('PreviewTestInputsPanel', () => {
  const render = (inputs = { params: {}, vars: {} } as { params: Record<string, string>; vars: Record<string, string> }, extra: Record<string, unknown> = {}) => {
    const seed = previewSeed(FIELDS, LAYOUT, inputs)
    const ctx = withFormContext(LAYOUT, previewShownValues(seed, seed.initialValues))
    const noop = () => {}
    return renderToStaticMarkup(createElement(PreviewTestInputsPanel, {
      layout: LAYOUT, inputs, seed, liveVars: ctx[FORM_VARS_KEY] as Record<string, unknown>, initialVars: ctx[FORM_VARS_KEY] as Record<string, unknown>,
      onParamChange: noop, onClearParams: noop, onVarChange: noop, onVarReset: noop, onResetAllVars: noop, ...extra,
    }))
  }

  it('renders one input per parameter and variable, with required marker and validation', () => {
    const html = render({ params: { limit: '500' }, vars: {} })
    expect(html).toContain('data-preview-params')
    expect(html).toContain('param.customer')
    expect(html).toContain('param.region')
    expect(html).toContain('var.greeting')
    expect(html).toContain('var.max_rows')
    expect(html).toContain('Required: the form page would not open without it')
    expect(html).toContain('must be at most 100')
    expect(html).toContain('placeholder="10"')
    expect(html).toContain('Default (no)')
    expect(html).toContain('<option value="north">north</option>')
    expect(html).not.toContain('data-copy-param-link')
  })

  it('shows overrides with Reset / Reset all and the copy link when given', () => {
    const html = render({ params: { customer: 'ALFKI' }, vars: { greeting: 'Hi' } }, { copyLink: 'https://app.example/f/1?customer=ALFKI' })
    expect(html).toContain('Overridden')
    expect(html).toContain('data-reset-var="greeting"')
    expect(html).toContain('data-reset-all-vars')
    expect(html).toContain('Copy link with these parameters')
    expect(html).toContain('value="Hi"')
  })

  it('renders nothing for a form without parameters or variables', () => {
    const seed = previewSeed(FIELDS, { rows: [] })
    const noop = () => {}
    expect(renderToStaticMarkup(createElement(PreviewTestInputsPanel, {
      layout: { rows: [] }, inputs: { params: {}, vars: {} }, seed, liveVars: {}, initialVars: {},
      onParamChange: noop, onClearParams: noop, onVarChange: noop, onVarReset: noop, onResetAllVars: noop,
    }))).toBe('')
  })
})
