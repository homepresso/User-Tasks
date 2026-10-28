/**
 * "Publish as form page" (lib/forms/form-page.ts), pure:
 *  - a start form → the form page: fields / grid / theme copied, every field
 *    mapped to its input as one `{{key}}` placeholder (typed values reach
 *    the workflow), the success screen with the run reference, the link
 *    (start_form_page.key) kept through button normalisation;
 *  - sync status: in sync, start form changed, form edited, both — stable
 *    across jsonb key order and a saved theme's remapped id;
 *  - a sync rewrites only the copied parts (header, labels and the success
 *    screen stay), duplicates drop the link.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form JSON */

import { describe, expect, it } from 'vitest'
import {
  buildFormPage, canPublishFormPage, findFormPageAction, fingerprint, FORM_PAGE_SUCCESS_TITLE, formPageContent, formPageKey, formPageName,
  formPageOf, formPageStatus, stableStringify, startFormTriggerConfig, syncFormPageUpdate, withoutFormPageLinks, type StartFormSource,
} from '@/lib/forms/form-page'
import { normalizeFormButtons, planButtonEffects, resolveInputTemplate } from '@/lib/forms/buttons'
import { validateFormContent } from '@/lib/services/forms'

const WF = { id: '0f0f0000-0000-4000-8000-000000000001', name: 'Expense claim', description: 'Claim an expense' }

const VARIABLES = [
  { id: 'v1', name: 'claim_reference', type: 'string', label: 'Claim reference', required: true },
  { id: 'v2', name: 'expectedAmount', type: 'number', label: 'Expected amount' },
  { id: 'v3', name: 'submitted_on', type: 'string', format: 'date' },
  { id: 'v4', name: 'urgent', type: 'boolean' },
  { id: 'v5', name: 'payload', type: 'object' },
]
const TRIGGER = { start_form: { layout: { rows: [{ columns: 2, cells: [{ field_key: 'claim_reference', span: 1 }, { field_key: 'expectedAmount', span: 1 }] }, { columns: 2, cells: [{ field_key: 'submitted_on', span: 1 }, { field_key: 'urgent', span: 1 }] }] }, theme: { source: 'custom', overrides: { radius: 6 } } } }
const source = (variables: unknown[] = VARIABLES, trigger: any = TRIGGER): StartFormSource => ({ user_variables: variables, trigger_config: trigger })

/** The form as the forms service stores it (validateFormContent), like a row read back. */
function stored(page: ReturnType<typeof buildFormPage>) {
  return validateFormContent(page).stored
}

describe('the form page of a start form', () => {
  it('copies the fields, grid and theme and maps every field to its input', () => {
    const content = formPageContent(source())
    expect(content.fields.map((f) => [f.key, f.type, f.required === true])).toEqual([
      ['claim_reference', 'text', true], ['expectedamount', 'number', false], ['submitted_on', 'date', false], ['urgent', 'boolean', false],
    ])
    // Object inputs have no field; camelCase names keep their name in the mapping.
    expect(content.inputs).toEqual({ claim_reference: '{{claim_reference}}', expectedAmount: '{{expectedamount}}', submitted_on: '{{submitted_on}}', urgent: '{{urgent}}' })
    expect(content.layout?.rows.map((r) => r.cells.map((c) => c.field_key))).toEqual([['claim_reference', 'expectedamount'], ['submitted_on', 'urgent']])
    expect(content.theme).toEqual({ source: 'custom', overrides: { radius: 6 } })
    expect(content.skipped).toEqual([])
    expect(canPublishFormPage(source())).toBe(true)
    expect(canPublishFormPage(source([{ name: 'payload', type: 'object' }]))).toBe(false)
  })

  it('leaves off inputs a button cannot map', () => {
    const content = formPageContent(source([...VARIABLES, { name: 'cost-centre', type: 'string' }]))
    expect(content.skipped).toEqual(['cost-centre'])
    expect(Object.keys(content.inputs)).not.toContain('cost-centre')
  })

  it('builds a valid form: name, header, Submit → Start workflow → success screen, the link kept', () => {
    const content = formPageContent(source())
    const page = buildFormPage(WF, content)
    expect(page.name).toBe('Expense claim — start form')
    expect(page.header).toMatchObject({ enabled: true, title: 'Expense claim', subtitle: 'Claim an expense' })
    const row = stored(page)
    const buttons = normalizeFormButtons(row.buttons)
    const submit = buttons.find((b) => b.kind === 'submit')!
    expect(submit.actions?.map((a) => a.type)).toEqual(['start_workflow', 'success_screen'])
    expect(submit.actions![0]).toEqual({ type: 'start_workflow', workflow_id: WF.id, workflow_name: 'Expense claim', inputs: content.inputs, start_form_page: { key: formPageKey(content) } })
    expect(submit.actions![1]).toMatchObject({ title: FORM_PAGE_SUCCESS_TITLE, text: 'Your reference: {{run_reference}}' })
    expect(buttons.find((b) => b.kind === 'cancel')?.hidden).toBe(true)
    expect(findFormPageAction(row.buttons, WF.id)?.button.id).toBe('submit')
    expect(formPageOf(row.buttons)).toEqual({ workflow_id: WF.id, workflow_name: 'Expense claim' })
    // The success screen shows the run reference.
    expect(planButtonEffects(submit, { values: {}, extras: { run_reference: 'abcd1234' } }).success_screen).toMatchObject({ title: FORM_PAGE_SUCCESS_TITLE, text: 'Your reference: abcd1234' })
  })

  it('maps typed values: a lone placeholder keeps the value\'s type', () => {
    const { inputs } = formPageContent(source())
    const values = { claim_reference: 'EXP-1', expectedamount: 42.5, submitted_on: '2026-10-28', urgent: true }
    const variables = Object.fromEntries(Object.entries(inputs).map(([name, t]) => [name, resolveInputTemplate(t, { values })]))
    expect(variables).toEqual({ claim_reference: 'EXP-1', expectedAmount: 42.5, submitted_on: '2026-10-28', urgent: true })
  })

  it('caps long names', () => {
    const name = formPageName('x'.repeat(200))
    expect(name.length).toBeLessThanOrEqual(120)
    expect(name.endsWith('— start form')).toBe(true)
    expect(formPageName('')).toBe('Workflow — start form')
  })

  it('finds the start form on the trigger node that holds it', () => {
    expect(startFormTriggerConfig([{ id: 'a', type: 'log', config: {} }, { id: 't', type: 'webhook_received', config: TRIGGER }])).toBe(TRIGGER)
    expect(startFormTriggerConfig([{ id: 'a', type: 'log', config: {} }])).toBeNull()
  })
})

describe('sync status', () => {
  const content = formPageContent(source())
  const row = () => JSON.parse(JSON.stringify(stored(buildFormPage(WF, content))))

  it('is in sync right after publishing, whatever the key order jsonb gives back', () => {
    const form = row()
    expect(formPageStatus(form, WF.id, source())).toBe('in_sync')
    const shuffle = (v: any): any => Array.isArray(v) ? v.map(shuffle) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, shuffle(x)])) : v
    expect(formPageStatus(shuffle(form), WF.id, source())).toBe('in_sync')
    expect(formPageStatus(form, '0f0f0000-0000-4000-8000-0000000000ff', source())).toBeNull()
  })

  it('a saved theme compares by kind (its id is remapped on import)', () => {
    const saved = { ...TRIGGER, start_form: { ...TRIGGER.start_form, theme: { source: 'saved', theme_id: '0f0f0000-0000-4000-8000-00000000aaaa' } } }
    const form = JSON.parse(JSON.stringify(validateFormContent(buildFormPage(WF, formPageContent(source(VARIABLES, saved)))).stored))
    form.theme = { source: 'saved', theme_id: '0f0f0000-0000-4000-8000-00000000bbbb' }
    expect(formPageStatus(form, WF.id, source(VARIABLES, saved))).toBe('in_sync')
  })

  it('start form changed / form edited / both', () => {
    const changedStart = source([...VARIABLES, { name: 'notes', type: 'string' }])
    expect(formPageStatus(row(), WF.id, changedStart)).toBe('start_form_changed')

    const edited = row()
    edited.fields[0].label = 'Your claim reference'
    expect(formPageStatus(edited, WF.id, source())).toBe('form_edited')
    expect(formPageStatus(edited, WF.id, changedStart)).toBe('both_changed')

    // The mapping is a copied part too.
    const remapped = row()
    remapped.buttons[0].actions[0].inputs.urgent = 'yes'
    expect(formPageStatus(remapped, WF.id, source())).toBe('form_edited')

    // Header, labels and the success screen are the owner's: not an edit of the copy.
    const owned = row()
    owned.header.title = 'Claim your expenses'
    owned.buttons[0].label = 'Send claim'
    owned.buttons[0].actions[1].title = 'Got it!'
    expect(formPageStatus(owned, WF.id, source())).toBe('in_sync')
  })

  it('a sync copies the start form and keeps the owner\'s parts', () => {
    const form = row()
    form.header.title = 'Claim your expenses'
    form.buttons[0].label = 'Send claim'
    form.buttons[0].actions[1].title = 'Got it!'
    form.fields[0].label = 'Edited label'
    const next = formPageContent(source([...VARIABLES, { name: 'notes', type: 'string' }]))
    const update = syncFormPageUpdate(form, WF, next)!
    expect(update.fields.map((f) => f.key)).toContain('notes')
    expect(update.fields[0].label).toBe('Claim reference')
    const submit = update.buttons.find((b) => b.id === 'submit')!
    expect(submit.label).toBe('Send claim')
    expect(submit.actions![1]).toMatchObject({ type: 'success_screen', title: 'Got it!' })
    expect(submit.actions![0].inputs).toMatchObject({ notes: '{{notes}}' })
    expect(submit.actions![0].start_form_page).toEqual({ key: formPageKey(next) })
    const after = { ...form, ...JSON.parse(JSON.stringify(validateFormContent({ ...update, header: form.header }).stored)) }
    expect(formPageStatus(after, WF.id, source([...VARIABLES, { name: 'notes', type: 'string' }]))).toBe('in_sync')
    expect(syncFormPageUpdate({ buttons: null }, WF, next)).toBeNull()
  })

  it('a duplicate is an ordinary form', () => {
    const copy = withoutFormPageLinks(row().buttons)
    expect(formPageOf(copy)).toBeNull()
    expect(normalizeFormButtons(copy)[0].actions?.[0]).toMatchObject({ type: 'start_workflow', workflow_id: WF.id })
  })

  it('fingerprints are stable, short and key-order free', () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}')
    expect(fingerprint('abc')).toMatch(/^[0-9a-f]{16}$/)
    expect(fingerprint('abc')).toBe(fingerprint('abc'))
    expect(fingerprint('abc')).not.toBe(fingerprint('abd'))
    // A forged key that isn't one is dropped by normalisation (the form is then no page).
    expect(normalizeFormButtons([{ id: 'submit', kind: 'submit', label: 'Go', actions: [{ type: 'start_workflow', workflow_id: WF.id, start_form_page: { key: '<script>' } }] }])[0].actions![0]).not.toHaveProperty('start_form_page')
  })
})
