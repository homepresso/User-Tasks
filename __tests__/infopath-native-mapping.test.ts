import { describe, expect, it, vi } from 'vitest'
import { analyzeInfoPath } from '@/lib/infopath/analyze'
import { generateForms, styleFromCss } from '@/lib/infopath/generate'
import { validateFormContent } from '@/lib/services/forms'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import type { FormRule } from '@/lib/forms/form-rules'
import { fixtureXsn } from './helpers/infopath-fixtures'

const site = (opts = {}) => generateForms(analyzeInfoPath(fixtureXsn('site-inspection'), { fileName: 'Site Inspection.xsn' }), { now: '2026-11-11T00:00:00.000Z', ...opts })
const field = (fields: TaskFieldDef[], key: string): any => fields.find((f) => f.key === key)
const rule = (rules: FormRule[] | undefined, name: string) => rules!.find((r) => r.name === name)!

describe('InfoPath → native controls (site inspection fixture)', () => {
  const { forms, report } = site()
  const form = forms[0]
  const fields = form.input.fields

  it('is a valid form', () => {
    expect(() => validateFormContent({ fields: form.input.fields, layout: form.input.layout })).not.toThrow()
    expect(report.summary).toMatchObject({ validations: { total: 3, converted: 3 }, calculations: { total: 2, converted: 2 }, formatting: { total: 4, converted: 4 }, rules: { total: 1, converted: 1 } })
  })

  it('maps rich text, multi-select list box, people picker, bulleted list and hyperlink to native controls', () => {
    expect(field(fields, 'notes')).toMatchObject({ type: 'rich_text' })
    expect(field(fields, 'region')).toMatchObject({ type: 'multi_choice', display: 'listbox', options: ['North', 'South', 'West'] })
    expect(field(fields, 'owner')).toMatchObject({ type: 'user', user_config: { multiple: true } })
    expect(field(fields, 'action')).toMatchObject({ type: 'text_list', text_list: { style: 'bulleted' } })
    expect(field(fields, 'reference_url')).toMatchObject({ type: 'url', url_config: { new_tab: true } })
  })

  it('maps pictures: a picture control with its template default, and a static picture as a display image', () => {
    const photo = field(fields, 'site_photo')
    expect(photo.type).toBe('image')
    expect(photo.image.default_file).toMatchObject({ mime_type: 'image/png', url: expect.stringMatching(/^data:image\/png;base64,iVBOR/) })
    const logo = fields.find((f) => (f.type as string) === 'display_image') as TaskFieldDef & Record<string, any>
    expect(logo.display_image).toMatchObject({ alt: 'Acme Facilities', src: expect.stringMatching(/^data:image\/png;base64,/) })
  })

  it('maps ink pictures and digital signature blocks to electronic signatures', () => {
    expect(field(fields, 'sketch')).toMatchObject({ type: 'signature', signature: { mode: 'draw' } })
    expect(report.items.find((i) => i.id === 'sig:Inspector sign-off')).toMatchObject({ status: 'partial', detail: expect.stringContaining('Certificates aren\'t carried over') })
  })

  it('maps a nested repeating table to a nested List, with column validations and cell styles', () => {
    const checks = field(fields, 'checks')
    expect(checks.type).toBe('list')
    const cols = checks.list.columns
    expect(cols.map((c: any) => [c.key, c.type])).toEqual([['area', 'text'], ['result', 'choice'], ['score', 'number'], ['finding', 'list']])
    expect(cols[3].list.columns.map((c: any) => c.key)).toEqual(['description', 'severity'])
    expect(cols[0].validations).toEqual([{ if: { match: 'all', conditions: [{ column: 'row.area', operator: 'is_not_set' }, { column: 'row.result', operator: 'eq', value: 'Fail' }] }, message: 'Name the area that failed' }])
    expect(cols[2].max).toBe(10)
    expect(checks.list.row_styles).toEqual([{ if: { match: 'all', conditions: [{ column: 'row.result', operator: 'eq', value: 'Fail' }] }, style: { tone: 'danger', text: true, bold: true, icon: true }, column: 'result' }])
    // count() with a predicate → COUNTIF over the List.
    expect(field(fields, 'failed_checks').label_config.expression).toBe('COUNTIF({{form.checks}}, "result", "Fail")')
  })

  it('maps repeating sections to Repeating sections (nested), with per-item rules and validation', () => {
    const hazards = field(fields, 'hazards')
    expect(hazards.type).toBe('repeating_section')
    const rs = hazards.repeating_section
    expect(rs.fields.map((f: any) => [f.key, f.type])).toEqual([['hazard_title', 'text'], ['level', 'choice'], ['hazard_photo', 'image'], ['control_measure', 'repeating_section']])
    expect(rs.layout.rows[0].cells.map((c: any) => c.field_key)).toEqual(['hazard_title', 'level'])
    expect(rs.fields[3].repeating_section.fields.map((f: any) => f.key)).toEqual(['measure'])
    expect(rs.layout.rules.find((r: any) => r.name === 'Validate: Describe every high hazard')).toMatchObject({ event: 'always', if: { conditions: [{ column: 'item.hazard_title', operator: 'is_not_set' }, { column: 'item.level', operator: 'eq', value: 'High' }] }, then: [{ type: 'field_error', field: 'hazard_title' }] })
    expect(rs.layout.rules.find((r: any) => r.name.startsWith('Style: Level'))).toMatchObject({ then: [{ type: 'set_style', targets: ['field:level'], style: { tone: 'danger', background: true } }] })
    expect(rs.item_title).toBe('Hazard {{index}}: {{item.hazard_title}}')
  })

  it('maps conditional colours to set_style rules (theme tones; the original colour in the report)', () => {
    expect(rule(form.input.layout.rules, 'Style: Status (Failed in red)')).toMatchObject({ event: 'always', then: [{ type: 'set_style', targets: ['field:status'], style: { tone: 'danger', text: true, bold: true, icon: true } }] })
    expect(rule(form.input.layout.rules, 'Style: Status (Pending shaded)').then[0]).toMatchObject({ style: { tone: 'warning', background: true } })
    expect(report.items.find((i) => i.name === 'Status (Failed in red)')?.detail).toContain('#ff0000 → danger')
  })

  it('maps choice sections to a choice group, and roles / user names to rule conditions and templates', () => {
    expect((form.input.layout as any).choice_groups).toEqual([{ key: expect.any(String), label: 'Choose one', sections: ['by_phone', 'by_email'], display: 'radio' }])
    // …and the saved layout keeps it (compactLayoutForSave).
    expect((validateFormContent({ fields: form.input.fields, layout: form.input.layout }).stored.layout as any).choice_groups).toEqual([{ key: expect.any(String), label: 'Choose one', sections: ['by_phone', 'by_email'] }])
    expect(rule(form.input.layout.rules, 'Supervisor review')).toMatchObject({ event: 'form_load', if: { conditions: [{ column: 'user.roles', operator: 'contains', value: 'Supervisor' }] }, then: [{ type: 'set_values', assign: { reviewed_by: '{{user.name}}' } }] })
  })

  it('combines views as tabs when asked', () => {
    const { forms: f } = generateForms(analyzeInfoPath(fixtureXsn('leave-request')), { mode: 'combined', pages: 'tabs' })
    expect(f[0].input.layout.mode).toBe('tabs')
  })
})

describe('conditional formatting CSS → theme tokens', () => {
  it('snaps colours to tones and keeps type styles', () => {
    expect(styleFromCss('COLOR: #008000; FONT-STYLE: italic')).toMatchObject({ style: { tone: 'success', text: true, italic: true, icon: true } })
    expect(styleFromCss('BACKGROUND-COLOR: rgb(0, 112, 192)')).toMatchObject({ style: { tone: 'info', background: true } })
    expect(styleFromCss('TEXT-DECORATION: line-through underline')).toMatchObject({ style: { strike: true, underline: true } })
    expect(styleFromCss('COLOR: #ffffff')).toMatchObject({ style: { tone: 'neutral', text: true }, note: expect.stringContaining('hidden value') })
    // Font sizes and families now carry over (a size token and a curated web-safe stack).
    expect(styleFromCss('FONT-SIZE: 14pt')).toEqual({ style: { size: '18.5px' } })
    expect(styleFromCss('FONT-FAMILY: Georgia; FONT-WEIGHT: bold')).toEqual({ style: { bold: true, font: 'georgia' } })
    expect(styleFromCss('WIDTH: 100px')).toBeNull()
  })
})

describe('import stores template pictures as form images', () => {
  it('uploads data: images before saving', async () => {
    vi.resetModules()
    const uploads: string[] = []
    vi.doMock('@/lib/services/uploads', () => ({ uploadFormImage: vi.fn(async (_ctx: unknown, f: { type: string }) => { uploads.push(f.type); return { url: `https://files.example/form-images/${uploads.length}.png`, name: 'x', size: 1, path: 'x' } }) }))
    const created: any[] = []
    vi.doMock('@/lib/services/forms', () => ({ createForm: vi.fn(async (_c: unknown, input: any) => { created.push(input); return { id: 'f1', name: input.name } }), deleteForm: vi.fn() }))
    vi.doMock('@/lib/services/_shared', async (orig) => ({ ...(await orig<typeof import('@/lib/services/_shared')>()), audit: vi.fn() }))
    const q: any = { select: () => q, eq: () => q, limit: () => q, then: (r: (v: unknown) => void) => r({ data: [], error: null }) }
    const ctx = { supabase: { from: () => q }, tenantId: 't1', actorId: 'u1', permissions: new Set(['forms.view', 'forms.edit']), authKind: 'session', source: 'ui' } as never
    const { importInfoPathFile } = await import('@/lib/services/infopath-import')
    await importInfoPathFile(ctx, fixtureXsn('site-inspection'), 'Site Inspection.xsn')
    const json = JSON.stringify(created[0].fields)
    expect(json).not.toContain('data:image')
    expect(json).toMatch(/https:\/\/files\.example\/form-images\/|storage:\/\//)
    expect(uploads).toEqual(['image/png', 'image/png'])
    vi.doUnmock('@/lib/services/uploads'); vi.doUnmock('@/lib/services/forms'); vi.doUnmock('@/lib/services/_shared')
  })
})
