import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareSemver, parseFormControlManifest, ManifestError } from '@/lib/forms/custom-controls/manifest'
import { customConfigFromManifest, formatCustomValue, normalizeCustomControlConfig, type CustomControlFieldConfig } from '@/lib/forms/custom-controls/field'
import {
  activeOutput, customOutputEntries, customOutputError, nativeCustomValue, parseOutputSpec, OutputSpecError,
} from '@/lib/forms/custom-controls/output'
import { OUTPUT_LIMITS, type FormControlManifest } from '@/lib/forms/custom-controls/contract'
import { mergeTaskFieldValues, validateTaskFieldValues, type TaskFieldDef } from '@/lib/task-field-schema'
import { validateWorkflowInputs } from '@/lib/workflow-inputs'
import { buildFormSubmittedPayload } from '@/lib/forms/submitted-trigger'
import { resolveExpression } from '@/lib/expression-resolver'
import { buildDataTree, fieldSchema } from '@/lib/workflow-data-picker'

const CONTROLS = path.join(__dirname, '..', 'gallery', 'controls')
const official = new Map<string, FormControlManifest>()
for (const slug of readdirSync(CONTROLS)) {
  const p = path.join(CONTROLS, slug, 'manifest.json')
  if (existsSync(p)) official.set(slug, parseFormControlManifest(readFileSync(p, 'utf8')))
}
const config = (slug: string, extra: Partial<CustomControlFieldConfig> = {}): CustomControlFieldConfig => ({ ...customConfigFromManifest(official.get(slug)!), ...extra })
const field = (key: string, slug: string, extra: Partial<CustomControlFieldConfig> = {}): TaskFieldDef => ({ key, label: key, type: 'custom', custom: config(slug, extra) } as TaskFieldDef)

const RICH = { html: '<h2>Leak</h2><p>Water <strong>pools</strong>.</p>', text: 'Leak\nWater pools.' }

describe('manifest output types', () => {
  it('every official control declares an output that the validator accepts', () => {
    expect(official.size).toBe(13)
    for (const [slug, manifest] of official) {
      expect(manifest.output, slug).toBeDefined()
      expect(compareSemver(manifest.version, '1.1.0'), slug).toBeGreaterThanOrEqual(0)
    }
  })

  it('refuses outputs that do not fit the value', () => {
    const bad: Array<[unknown, string, RegExp]> = [
      [{ type: 'text' }, 'string', /output.type must be one of/],
      [{ type: 'string' }, 'json', /needs output.primary or output.template/],
      [{ type: 'number', html: true }, 'number', /html needs output.type "string"/],
      [{ type: 'number', template: '{{value}}' }, 'json', /template gives text/],
      [{ type: 'string' }, 'files', /output.type must be "array"/],
      [{ type: 'string', primary: 'a..b' }, 'json', /dot path/],
      [{ type: 'string', primary: 'a', extras: { raw: '' } }, 'json', /"raw" is reserved/],
      [{ type: 'string', primary: 'a', extras: { Bad: 'a' } }, 'json', /short lowercase name/],
      [{ type: 'string', primary: 'a', template: '{{value.a}}' }, 'json', /not both/],
      [{ type: 'string', choices: [{ value: 'a', primary: 'a' }, { value: 'a', primary: 'b' }] }, 'json', /appears twice/],
      [{ type: 'number', primary: 'x' }, 'number', /only apply to structured values/],
    ]
    for (const [raw, valueType, message] of bad) expect(() => parseOutputSpec(raw, valueType as never), JSON.stringify(raw)).toThrow(message)
    expect(() => parseOutputSpec({ type: 'string' }, 'json')).toThrow(OutputSpecError)
    // …and the manifest parser reports it as a manifest problem.
    const manifest = JSON.parse(readFileSync(path.join(CONTROLS, 'rich-text', 'manifest.json'), 'utf8'))
    expect(() => parseFormControlManifest({ ...manifest, output: { type: 'string' } })).toThrow(ManifestError)
    expect(parseFormControlManifest({ ...manifest, output: undefined }).output).toBeUndefined()
  })

  it('a stored field config keeps a valid output and the author\'s choice, and drops an invalid one', () => {
    const stored = normalizeCustomControlConfig({ ...config('rich-text'), output_choice: 'text' })!
    expect(stored.output?.type).toBe('string')
    expect(stored.output_choice).toBe('text')
    expect(normalizeCustomControlConfig({ ...config('rich-text'), output_choice: 'nope' })!.output_choice).toBeUndefined()
    expect(normalizeCustomControlConfig({ ...config('rich-text'), output: { type: 'string' } })!.output).toBeUndefined()
    // A version switch keeps the choice when the new version still offers it.
    expect(customConfigFromManifest(official.get('rich-text')!, stored).output_choice).toBe('text')
  })
})

describe('output coercion per official control', () => {
  const cases: Array<[string, unknown, Record<string, unknown>]> = [
    ['rich-text', RICH, { f: RICH.html, f_text: RICH.text, f_raw: RICH }],
    ['address', { formatted: '1 Main St, Springfield', street: '1 Main St', city: 'Springfield', region: null, postcode: null, country: 'US' }, { f: '1 Main St, Springfield', f_parts: { formatted: '1 Main St, Springfield', street: '1 Main St', city: 'Springfield', region: null, postcode: null, country: 'US' } }],
    ['map', { lat: -41.29, lng: 174.78 }, { f: '-41.29,174.78', f_lat: -41.29, f_lng: 174.78, f_raw: { lat: -41.29, lng: 174.78 } }],
    ['chart', { label: 'March', value: 42, series: 'NPS' }, { f: 'March', f_value: 42, f_series: 'NPS', f_raw: { label: 'March', value: 42, series: 'NPS' } }],
    ['rating', 4, { f: 4 }],
    ['slider', 7, { f: 7 }],
    ['progress', null, { f: null }],
    ['info-card', null, { f: null }],
    ['likert', { workload: 4, time: 0 }, { f: { workload: 4, time: 0 } }],
    ['table', [{ item: 'Gloves', qty: 2 }], { f: [{ item: 'Gloves', qty: 2 }] }],
    ['saved-report', { id: 7, name: 'Row' }, { f: { id: 7, name: 'Row' } }],
    ['signature', [{ id: 'file_1', name: 'signature.png', size: 10, type: 'image/png' }], { f: [{ id: 'file_1', name: 'signature.png', size: 10, type: 'image/png' }] }],
    ['pdf-viewer', [{ id: 'file_2', name: 'contract.pdf' }], { f: [{ id: 'file_2', name: 'contract.pdf' }] }],
  ]
  for (const [slug, value, expected] of cases) {
    it(`${slug}: ${official.get(slug)?.output?.type}`, () => {
      const entries = customOutputEntries('f', config(slug), value)
      for (const [key, v] of Object.entries(expected)) expect(entries[key], `${slug} ${key}`).toEqual(v)
      if (['rating', 'slider', 'likert', 'table', 'signature', 'pdf-viewer', 'saved-report'].includes(slug)) expect(entries).not.toHaveProperty('f_raw')
    })
  }

  it('rich text: the author can make plain text the main output', () => {
    const entries = customOutputEntries('desc', config('rich-text', { output_choice: 'text' }), RICH)
    expect(entries).toEqual({ desc: RICH.text, desc_raw: RICH, desc_text: RICH.text })
    expect(activeOutput(config('rich-text', { output_choice: 'text' }))?.html).toBeFalsy()
  })

  it('an empty value empties every output (no stale extras)', () => {
    expect(customOutputEntries('desc', config('rich-text'), null)).toEqual({ desc: null, desc_raw: null, desc_text: null })
  })

  it('without an output (older pinned versions) the value is the output, unchanged', () => {
    const legacy = { ...config('rich-text'), output: undefined }
    expect(customOutputEntries('desc', legacy, RICH)).toEqual({ desc: RICH })
  })
})

describe('server sanitising and bounds', () => {
  it('sanitises HTML in the main output and in <key>_raw, whatever the frame sent', () => {
    const dirty = { html: '<p onclick="x()">Hi<script>alert(1)</script><img src="javascript:alert(1)"></p>', text: 'Hi' }
    const entries = customOutputEntries('desc', config('rich-text'), dirty)
    expect(String(entries.desc)).not.toMatch(/script|onclick|javascript:/i)
    expect(String((entries.desc_raw as { html: string }).html)).not.toMatch(/script|onclick|javascript:/i)
    expect(entries.desc).toContain('Hi')
  })

  it('enforces the size bound on text outputs', () => {
    const huge = { html: `<p>${'a'.repeat(OUTPUT_LIMITS.stringChars + 1)}</p>`, text: 'a' }
    expect(customOutputError('Description', config('rich-text'), huge)).toBe('Description is too long')
    expect(customOutputEntries('desc', config('rich-text'), huge).desc).toBeNull()
  })

  it('never trusts the claimed type: values that cannot be the declared output are refused', () => {
    const fields = [field('where', 'map')]
    expect(validateTaskFieldValues(fields, { where: { lat: 'north', lng: 2 } }).where).toBeTruthy()
    expect(validateTaskFieldValues([field('stars', 'rating')], { stars: 'abc' }).stars).toMatch(/number/)
    expect(validateTaskFieldValues(fields, { where: { lat: 1, lng: 2 } }).where).toBeUndefined()
  })
})

describe('storing and reading outputs', () => {
  const fields = [field('desc', 'rich-text')]

  it('mergeTaskFieldValues stores the output, the raw value and the extras', () => {
    const { errors, templateValues } = mergeTaskFieldValues({ fields }, { desc: RICH })
    expect(errors).toEqual({})
    expect(templateValues).toMatchObject({ desc: RICH.html, desc_text: RICH.text, desc_raw: RICH })
  })

  it('a form opened again sends back the output: the value is recovered from <key>_raw and re-validated', () => {
    const stored = mergeTaskFieldValues({ fields }, { desc: RICH }).templateValues
    // The control is given its own value.
    expect(nativeCustomValue(fields[0].custom, 'desc', stored)).toEqual(RICH)
    // Completing without touching it keeps it.
    const again = mergeTaskFieldValues({ fields, template_values: stored }, { desc: stored.desc })
    expect(again.errors).toEqual({})
    expect(again.templateValues).toMatchObject({ desc: RICH.html, desc_raw: RICH, desc_text: RICH.text })
    // A raw value that does not match the output sent is not used: the output wins (rebuilt).
    const changed = mergeTaskFieldValues({ fields, template_values: stored }, { desc: '<p>New text</p>' })
    expect(changed.templateValues).toMatchObject({ desc: '<p>New text</p>', desc_text: 'New text' })
    // Client-sent extras are never stored as sent.
    const forged = mergeTaskFieldValues({ fields }, { desc: RICH, desc_text: 'forged', desc_raw: { html: 'x', text: 'forged' } })
    expect(forged.templateValues.desc_text).toBe(RICH.text)
  })

  it('an API caller may send plain HTML or text: the value is built from it', () => {
    const { errors, templateValues } = mergeTaskFieldValues({ fields }, { desc: 'Line one\nLine two' })
    expect(errors).toEqual({})
    expect(templateValues.desc_raw).toEqual({ html: '<p>Line one</p><p>Line two</p>', text: expect.stringContaining('Line one') })
  })

  it('start-form inputs (validateWorkflowInputs) get the outputs, and sent extras are ignored', () => {
    const custom = config('rich-text')
    const result = validateWorkflowInputs([{ key: 'desc', label: 'Description', type: 'text', required: false, custom } as never], { desc: RICH, desc_raw: { html: '<b>forged</b>', text: 'forged' } })
    expect(result.ok).toBe(true)
    expect(result.values).toMatchObject({ desc: RICH.html, desc_text: RICH.text, desc_raw: RICH })
    expect(result.warnings.join(' ')).not.toContain('desc_raw')
  })

  it('the Form submitted trigger carries the outputs beside the field', () => {
    const values = customOutputEntries('desc', config('rich-text'), RICH)
    const payload = buildFormSubmittedPayload({ form: { id: 'f', name: 'F', version: 1 }, fields, values, submission: { id: 's', created_at: '2026-11-04T00:00:00Z', source: 'standalone' }, submitter: { id: null } })
    expect(payload.form).toMatchObject({ desc: RICH.html, desc_text: RICH.text, desc_raw: RICH })
  })

  it('read-only views show the text of a stored HTML output', () => {
    expect(formatCustomValue(config('rich-text'), RICH.html)).toBe(RICH.text.replace('\n', '\n'))
    expect(formatCustomValue(config('rich-text'), RICH)).toBe(RICH.text)
  })
})

describe('backwards compatibility of object paths', () => {
  const stored = customOutputEntries('desc', config('rich-text'), RICH)
  it('{{form.desc.html}} and {{form.desc.text}} still read the value', () => {
    const ctx = { variables: { form: stored, task_data: stored } }
    expect(resolveExpression('{{form.desc.html}}', ctx)).toBe(RICH.html)
    expect(resolveExpression('{{form.desc.text}}', ctx)).toBe(RICH.text)
    expect(resolveExpression('{{task_data.desc.text}}', ctx)).toBe(RICH.text)
    expect(resolveExpression('{{form.desc}}', ctx)).toBe(RICH.html)
    expect(resolveExpression('{{form.desc_text}}', ctx)).toBe(RICH.text)
  })
  it('works at the root too, and leaves ordinary strings alone', () => {
    expect(resolveExpression('{{desc.text}}', { variables: stored })).toBe(RICH.text)
    expect(resolveExpression('{{name.text}}', { variables: { name: 'Ada' } })).toBe('')
    expect(resolveExpression('{{name.length}}', { variables: { name: 'Ada' } })).toBe(3)
  })
})

describe('data picker', () => {
  it('shows the main output as its declared type, plus <key>_text and <key>_raw', () => {
    expect(fieldSchema(field('desc', 'rich-text'))).toMatchObject({ type: 'string' })
    expect(fieldSchema(field('where', 'map'))).toMatchObject({ type: 'string' })
    expect(fieldSchema(field('stars', 'rating'))).toMatchObject({ type: 'number' })
    expect(fieldSchema(field('scores', 'likert'))).toMatchObject({ type: 'object' })
    const roots = buildDataTree({ nodes: [{ id: 'n1', type: 'user_task', label: 'Review', config: { fields: [field('desc', 'rich-text'), field('where', 'map')] } } as never], edges: [], currentNodeId: null })
    const json = JSON.stringify(roots)
    for (const key of ['desc_text', 'desc_raw', 'where_lat', 'where_lng', 'where_raw']) expect(json, key).toContain(key)
  })
})
