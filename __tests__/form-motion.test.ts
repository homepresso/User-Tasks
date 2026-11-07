/**
 * Form animations (lib/forms/motion.ts): the stored setting and its
 * back-compat (Subtle for every form without the key), the level after
 * reduced motion, the stagger cap on long forms, the direction of travel,
 * the confetti rule, the layout / designer / portability round trips, and
 * the markers the renderer puts out for the CSS (app/form-motion.css).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  confettiPieces, entranceMs, FORM_MOTION_TIMING, formAnimation, motionLevel, normalizeFormAnimation, showConfetti,
  STAGGER_MAX_FIELDS, staggerIndex, travelDirection, withFormAnimation,
} from '@/lib/forms/motion'
import { compactLayoutForSave, normalizeFormLayout } from '@/lib/forms/layout'
import { setPageMode } from '@/lib/forms/pages'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { designerStateFrom, definitionFrom } from '@/lib/forms/designer-state'
import { normalizeFormAssetLikeImport } from '@/lib/portability/forms'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { FormRenderer } from '@/components/forms/form-renderer'
import { FormThemeScope } from '@/components/forms/form-theme-scope'
import { SubmittedPageView } from '@/components/forms/submitted-page-view'

const fields = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'email', label: 'Email', type: 'email' },
]
const keys = fields.map((f) => f.key)
const rows = keys.map((k) => ({ columns: 1, cells: [{ field_key: k, span: 1 }] }))

describe('the setting (layout.animation)', () => {
  it('Subtle is the default — new forms and old ones (no layout, no key) alike', () => {
    expect(formAnimation(null)).toEqual({ style: 'subtle', confetti: false })
    expect(formAnimation(undefined)).toEqual({ style: 'subtle', confetti: false })
    expect(formAnimation({ rows })).toEqual({ style: 'subtle', confetti: false })
    expect(formAnimation(normalizeFormDefinition({ fields }).layout)).toEqual({ style: 'subtle', confetti: false })
  })

  it('only what differs from the default is stored; junk is dropped', () => {
    expect(normalizeFormAnimation({ style: 'expressive', confetti: true })).toEqual({ style: 'expressive', confetti: true })
    expect(normalizeFormAnimation({ style: 'none' })).toEqual({ style: 'none' })
    expect(normalizeFormAnimation({ style: 'subtle' })).toBeNull()
    expect(normalizeFormAnimation({ style: 'wild', confetti: 'yes', extra: 1 })).toBeNull()
    expect(normalizeFormAnimation('expressive')).toBeNull()
    expect(formAnimation({ rows, animation: { style: 'bogus' } })).toEqual({ style: 'subtle', confetti: false })
  })

  it('withFormAnimation sets and clears (the key goes when back to the default)', () => {
    const exp = withFormAnimation({ rows } as any, { style: 'expressive' })
    expect(exp.animation).toEqual({ style: 'expressive' })
    const party = withFormAnimation(exp, { confetti: true })
    expect(party.animation).toEqual({ style: 'expressive', confetti: true })
    const back = withFormAnimation(withFormAnimation(party, { confetti: false }), { style: 'subtle' })
    expect('animation' in back).toBe(false)
  })

  it('the layout keeps it: normalise, compact for save (a trivial grid is kept for it), page mode switch, designer round trip', () => {
    const layout = normalizeFormLayout({ rows, animation: { style: 'none' } }, keys)!
    expect(layout.animation).toEqual({ style: 'none' })
    expect(compactLayoutForSave(normalizeFormLayout({ rows }, keys)!, keys)).toBeNull()
    expect(compactLayoutForSave(layout, keys)!.animation).toEqual({ style: 'none' })
    expect(setPageMode(layout, 'steps').animation).toEqual({ style: 'none' })
    expect(setPageMode(setPageMode(layout, 'tabs'), 'single').animation).toEqual({ style: 'none' })
    const paged = normalizeFormLayout({ rows: [], mode: 'steps', pages: [{ id: 'p1', title: 'One', rows }], animation: { style: 'expressive', confetti: true } }, keys)!
    expect(compactLayoutForSave(paged, keys)!.animation).toEqual({ style: 'expressive', confetti: true })
    const def = normalizeFormDefinition({ fields, layout: { rows, animation: { style: 'expressive' } } })
    expect(definitionFrom(designerStateFrom(def)).layout?.animation).toEqual({ style: 'expressive' })
  })

  it('portability: export / import (config as code, packages) carries the setting', () => {
    const local = { id: 'f1', name: 'Register', fields, layout: { rows, animation: { style: 'expressive', confetti: true } } }
    const a = normalizeFormAssetLikeImport(local)
    expect(a.layout.animation).toEqual({ style: 'expressive', confetti: true })
    expect(normalizeFormAssetLikeImport(JSON.parse(JSON.stringify(a))).layout).toEqual(a.layout)
    expect(formAnimation(a.layout)).toEqual({ style: 'expressive', confetti: true })
    // Defaults stay implicit: no key is invented for an old form.
    expect(normalizeFormAssetLikeImport({ id: 'f2', name: 'x', fields, layout: { rows } }).layout).toBeNull()
  })
})

describe('reduced motion', () => {
  it('turns any movement into opacity only; None stays None', () => {
    expect(motionLevel('subtle', false)).toBe('subtle')
    expect(motionLevel('expressive', false)).toBe('expressive')
    expect(motionLevel('subtle', true)).toBe('reduced')
    expect(motionLevel('expressive', true)).toBe('reduced')
    expect(motionLevel('none', true)).toBe('none')
    expect(motionLevel('none', false)).toBe('none')
  })

  it('no stagger and no confetti under reduced motion', () => {
    expect(staggerIndex(3, 5, 'reduced')).toBeUndefined()
    const page = { source: 'form', icon: { kind: 'icon', name: 'check_circle', color: 'success' } }
    expect(showConfetti({ style: 'expressive', confetti: true }, 'reduced', page)).toBe(false)
    expect(showConfetti({ style: 'expressive', confetti: true }, 'expressive', page)).toBe(true)
  })
})

describe('stagger', () => {
  it('rows step in order, capped so the entrance stays within the style budget', () => {
    expect([0, 1, 2, 3].map((i) => staggerIndex(i, 6, 'subtle'))).toEqual([0, 1, 2, 3])
    const cap = FORM_MOTION_TIMING.subtle.staggerCap
    expect(staggerIndex(50, 10, 'subtle')).toBe(cap)
    for (const level of ['subtle', 'expressive'] as const) {
      const t = FORM_MOTION_TIMING[level]
      expect(t.staggerCap * t.staggerStep + t.fieldMs).toBeLessThanOrEqual(t.budgetMs)
      expect(entranceMs(level, 10, 40)).toBeLessThanOrEqual(t.budgetMs)
    }
    expect(entranceMs('subtle', 10, 40)).toBeLessThanOrEqual(400)
  })

  it('no stagger at all on long forms (more than 20 fields), or with None', () => {
    expect(staggerIndex(0, STAGGER_MAX_FIELDS, 'subtle')).toBe(0)
    expect(staggerIndex(0, STAGGER_MAX_FIELDS + 1, 'subtle')).toBeUndefined()
    expect(staggerIndex(2, 40, 'expressive')).toBeUndefined()
    expect(staggerIndex(2, 3, 'none')).toBeUndefined()
    expect(entranceMs('none', 3, 3)).toBe(0)
  })
})

describe('steps, confetti', () => {
  it('direction of travel by page order', () => {
    const order = ['a', 'b', 'c', '__review']
    expect(travelDirection(order, 'a', 'b')).toBe('forward')
    expect(travelDirection(order, 'c', 'a')).toBe('back')
    expect(travelDirection(order, 'c', '__review')).toBe('forward')
    expect(travelDirection(order, 'a', 'a')).toBe('none')
    expect(travelDirection(order, null, 'a')).toBe('none')
    expect(travelDirection(order, 'x', 'a')).toBe('none')
  })

  it('confetti: Expressive + opted in + a success-tone Submitted page only', () => {
    const on = { style: 'expressive' as const, confetti: true }
    expect(showConfetti(on, 'expressive', { source: 'form', icon: null })).toBe(true)
    expect(showConfetti(on, 'expressive', { source: 'form', icon: { kind: 'icon', color: 'primary' } })).toBe(false)
    expect(showConfetti(on, 'expressive', { source: 'button' })).toBe(false)
    expect(showConfetti({ ...on, confetti: false }, 'expressive', { source: 'form' })).toBe(false)
    expect(showConfetti(on, 'subtle', { source: 'form' })).toBe(false)
  })

  it('confetti pieces are deterministic (same on server and client) and bounded', () => {
    expect(confettiPieces(18)).toEqual(confettiPieces(18))
    expect(confettiPieces(500)).toHaveLength(40)
    for (const p of confettiPieces()) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(100)
      expect(p.dy).toBeLessThan(0)
    }
  })
})

describe('markers for the CSS', () => {
  const FIELDS = normalizeTaskFields(fields)
  const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))
  const render = (layout: any, extra: any = {}) => wrap(createElement(FormRenderer, { fields: FIELDS, layout, values: {}, onChange: () => {}, ...extra }))

  it('an editable form: the level on the grid, fields enter with their stagger slot', () => {
    const html = render(normalizeFormLayout({ rows }, keys))
    expect(html).toContain('data-form-motion="subtle"')
    expect(html).toContain('data-fm-on=""')
    expect(html).toContain('data-fm="enter"')
    expect(html).toContain('--fm-i:1')
  })

  it('None and read-only views: nothing marked to move', () => {
    const none = render(normalizeFormLayout({ rows, animation: { style: 'none' } }, keys))
    expect(none).not.toContain('data-fm-on')
    expect(none).not.toContain('data-fm="enter"')
    const ro = render(normalizeFormLayout({ rows }, keys), { readOnly: true })
    expect(ro).not.toContain('data-fm="enter"')
  })

  it('a long form enters as one block (no per-field stagger)', () => {
    const many = normalizeTaskFields(Array.from({ length: STAGGER_MAX_FIELDS + 1 }, (_, i) => ({ key: `f${i}`, label: `F${i}`, type: 'text' })))
    const html = wrap(createElement(FormRenderer, { fields: many, layout: null, values: {}, onChange: () => {} }))
    expect(html).toContain('data-fm-on')
    expect(html).not.toContain('data-fm="enter"')
  })

  it('the theme scope marks the card; the Submitted page carries the level (and confetti when asked)', () => {
    const card = wrap(createElement(FormThemeScope as any, { overrides: null, page: true, motion: { style: 'expressive', confetti: true } }, createElement(SubmittedPageView, { screen: { source: 'form', title: 'Thanks', icon: { kind: 'icon', name: 'check_circle' } } as any })))
    expect(card).toContain('data-fm-card=""')
    expect(card).toContain('data-form-motion="expressive"')
    expect(card).toContain('data-fm-confetti')
    const plain = wrap(createElement(FormThemeScope as any, { overrides: null, page: true, motion: { style: 'none', confetti: false } }, createElement(SubmittedPageView, { screen: { source: 'form', title: 'Thanks' } as any })))
    expect(plain).toContain('data-form-motion="none"')
    expect(plain).not.toContain('data-fm-confetti')
  })
})
