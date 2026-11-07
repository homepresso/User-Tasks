import { describe, expect, it } from 'vitest'
import { draftBytes, draftPrompt, formActions, FORM_DRAFT_MAX_BYTES, normalizeFormActions, withFormAction } from '@/lib/forms/form-actions'
import { compactLayoutForSave, normalizeFormLayout } from '@/lib/forms/layout'
import { setPageMode } from '@/lib/forms/pages'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { designerStateFrom, definitionFrom } from '@/lib/forms/designer-state'
import { normalizeFormAssetLikeImport } from '@/lib/portability/forms'
import { formatNavBadge, navBadgeCount, navBadgeLabel } from '@/lib/nav-badges'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures */

const fields = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'email', label: 'Email', type: 'email' },
]
const keys = fields.map((f) => f.key)
const rows = keys.map((k) => ({ columns: 1, cells: [{ field_key: k, span: 1 }] }))

describe('form icons (layout.form_actions)', () => {
  it('both are on by default — old forms (no layout, no key) included', () => {
    expect(formActions(null)).toEqual({ favorite: true, draft: true })
    expect(formActions(undefined)).toEqual({ favorite: true, draft: true })
    expect(formActions({ rows })).toEqual({ favorite: true, draft: true })
    expect(formActions(normalizeFormDefinition({ fields }).layout)).toEqual({ favorite: true, draft: true })
  })

  it('only what is off is stored; junk is dropped', () => {
    expect(normalizeFormActions({ favorite: false })).toEqual({ favorite: false })
    expect(normalizeFormActions({ favorite: true, draft: true })).toBeNull()
    expect(normalizeFormActions({ favorite: 'no', draft: 0, extra: false })).toBeNull()
    expect(normalizeFormActions('off')).toBeNull()
    expect(formActions({ rows, form_actions: { draft: false } })).toEqual({ favorite: true, draft: false })
  })

  it('withFormAction turns one off and back on (the key goes when both are on)', () => {
    const off = withFormAction({ rows } as any, 'favorite', false)
    expect(off.form_actions).toEqual({ favorite: false })
    const both = withFormAction(off, 'draft', false)
    expect(both.form_actions).toEqual({ favorite: false, draft: false })
    const back = withFormAction(withFormAction(both, 'draft', true), 'favorite', true)
    expect('form_actions' in back).toBe(false)
  })

  it('the layout keeps it: normalise, compact for save (a trivial grid is kept for it), page mode switch, designer round trip', () => {
    const layout = normalizeFormLayout({ rows, form_actions: { favorite: false } }, keys)!
    expect(layout.form_actions).toEqual({ favorite: false })
    expect(compactLayoutForSave(normalizeFormLayout({ rows }, keys)!, keys)).toBeNull()
    expect(compactLayoutForSave(layout, keys)!.form_actions).toEqual({ favorite: false })
    expect(setPageMode(layout, 'steps').form_actions).toEqual({ favorite: false })
    expect(setPageMode(setPageMode(layout, 'steps'), 'single').form_actions).toEqual({ favorite: false })
    const paged = normalizeFormLayout({ rows: [], mode: 'tabs', pages: [{ id: 'p1', title: 'One', rows }], form_actions: { draft: false } }, keys)!
    expect(compactLayoutForSave(paged, keys)!.form_actions).toEqual({ draft: false })
    const def = normalizeFormDefinition({ fields, layout: { rows, form_actions: { draft: false } } })
    expect(definitionFrom(designerStateFrom(def)).layout?.form_actions).toEqual({ draft: false })
  })

  it('portability: export / import (config as code, packages) carries the setting', () => {
    const local = { id: 'f1', name: 'Register', fields, layout: { rows, form_actions: { favorite: false, draft: false } } }
    const a = normalizeFormAssetLikeImport(local)
    expect(a.layout.form_actions).toEqual({ favorite: false, draft: false })
    expect(normalizeFormAssetLikeImport(JSON.parse(JSON.stringify(a))).layout).toEqual(a.layout)
    // Defaults stay implicit: no key is invented for an old form.
    expect(normalizeFormAssetLikeImport({ id: 'f2', name: 'x', fields, layout: { rows } }).layout).toBeNull()
  })
})

describe('drafts (pure)', () => {
  it('measures and bounds a draft', () => {
    expect(draftBytes({ a: 'é' })).toBe(JSON.stringify({ a: 'é' }).length + 1)
    expect(draftBytes({ big: 'x'.repeat(FORM_DRAFT_MAX_BYTES) }) > FORM_DRAFT_MAX_BYTES).toBe(true)
    expect(draftBytes({}, { customer: 'ALFKI' })).toBe(2 + JSON.stringify({ customer: 'ALFKI' }).length)
  })

  it('asks to resume with the date', () => {
    expect(draftPrompt('2026-11-03T14:05:00Z', 'en-GB')).toMatch(/^Resume your draft from 3 Nov.*\?$/)
    expect(draftPrompt('not a date')).toBe('Resume your draft from earlier?')
  })
})

describe('nav badges', () => {
  const counts = { my_tasks: 4, queue: 0, tracker: 250 }
  it('maps menu items to counts', () => {
    expect(navBadgeCount(counts, '/tasks')).toBe(4)
    // My tasks is the unified list: its badge adds the queued count.
    expect(navBadgeCount({ my_tasks: 4, queue: 3, tracker: 0 }, '/tasks')).toBe(7)
    expect(navBadgeCount({ my_tasks: 4, queue: 3, tracker: 0 }, '/tasks/queue')).toBe(0) // the Task queue item is gone
    expect(navBadgeCount(counts, '/tasks/assigned')).toBe(250)
    expect(navBadgeCount(counts, '/home')).toBe(0)
    expect(navBadgeCount(null, '/tasks')).toBe(0)
  })
  it('hidden at 0, 99+ when large', () => {
    expect(formatNavBadge(0)).toBeNull()
    expect(formatNavBadge(-1)).toBeNull()
    expect(formatNavBadge(undefined)).toBeNull()
    expect(formatNavBadge(Number.NaN)).toBeNull()
    expect(formatNavBadge(1)).toBe('1')
    expect(formatNavBadge(99)).toBe('99')
    expect(formatNavBadge(100)).toBe('99+')
  })
  it('accessible names', () => {
    expect(navBadgeLabel('My Tasks', 4)).toBe('My Tasks, 4 pending')
    expect(navBadgeLabel('Task Queue', 0)).toBe('Task Queue')
    expect(navBadgeLabel('Task Tracker', 250)).toBe('Task Tracker, 99+ pending')
  })
})
