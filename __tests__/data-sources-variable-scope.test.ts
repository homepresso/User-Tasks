import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The API picker (components/data-sources) draws VariableInputs outside
 * components/forms, so the form-variable-catalog regression doesn't scan it:
 * every place that renders it must give it a designer scope — the Data
 * table's query scope, or a column binding's lookup scope.
 */
const ROOT = path.resolve(__dirname, '..')
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8')

describe('regression: the API picker reads the designer scope, never the workflow lists', () => {
  it('the picker itself sets no scope of its own (it reads its parent’s)', () => {
    const picker = read('components/data-sources/api-source-picker.tsx')
    expect(picker).toMatch(/<VariableInput\b/)
    expect(picker).not.toMatch(/scope=\{null\}/)
  })
  it('the form Data table renders it inside its table_query scope', () => {
    const text = read('components/forms/designer/data-table-properties.tsx')
    expect(text).toContain("<DesignerVariableScope state={state} context={{ kind: 'table_query', exclude: field.key }}>")
    expect(text.indexOf('<ApiSourcePicker')).toBeGreaterThan(text.indexOf("kind: 'table_query'"))
  })
  it('a column binding renders it inside a lookup_query scope with the row’s columns', () => {
    const text = read('components/data-sources/column-binding-editor.tsx')
    expect(text).toContain("context={{ kind: 'lookup_query', exclude: fieldKey }}")
    expect(text.indexOf('<ApiSourcePicker')).toBeGreaterThan(text.indexOf("kind: 'lookup_query'"))
  })
  it('only those two render the picker', () => {
    for (const f of ['components/data/grid-view-settings.tsx', 'components/forms/designer/lookup-properties.tsx']) expect(read(f)).not.toContain('<ApiSourcePicker')
  })
})
