/**
 * The app panel stack's close / back / Esc / URL behaviour (lib/apps/panels.ts,
 * used by components/apps/panels.tsx). Owner report: "when we are double
 * screened on the apps, we can't close out the slider" — × must close the
 * whole stack, back / Esc one level, and each state is a history entry.
 */
import { readFileSync } from 'node:fs'
import { hasUnsavedEntries } from '@/lib/forms/draft-offer'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  closeAllPanels, closeKeyFor, closePanel, decodePanels, encodePanels, historyPlan, markDirty, panelHref, popPanel, pushPanel, reconcileStack,
  type Panel, type PanelTarget,
} from '@/lib/apps/panels'

const page: PanelTarget = { t: 'page', slug: 'workspace', params: { workspace_id: '6f1c2c0e-1111-4222-8333-444455556666' } }
const form: PanelTarget = { t: 'form', id: 'f027c4415', params: { workspace_id: '6f1c2c0e-1111-4222-8333-444455556666' } }
const report: PanelTarget = { t: 'report', id: 'r1' }

function stackOf(...targets: PanelTarget[]): Panel[] {
  let s: Panel[] = []
  for (const [i, target] of targets.entries()) {
    s = pushPanel(s, { target, mode: i % 2 ? 'modal' : 'panel_right', width: i ? 'md' : 'lg', motion: 'auto' }).stack
    s[s.length - 1] = { ...s[s.length - 1], key: `k${i}` }
  }
  return s
}

describe('close scopes: × closes the stack, back / Esc one level', () => {
  for (const depth of [1, 2, 3]) {
    const s = stackOf(page, form, report).slice(0, depth)
    it(`${depth} level(s): × (all) empties the stack`, () => {
      const key = closeKeyFor(s, 'all')
      expect(key).toBe('k0')
      expect(closePanel(s, key!).stack).toEqual([])
      expect(closeAllPanels(s).stack).toEqual([])
    })
    it(`${depth} level(s): back / Esc (top) removes exactly one`, () => {
      const key = closeKeyFor(s, 'top')
      expect(closePanel(s, key!).stack.map((p) => p.key)).toEqual(s.slice(0, -1).map((p) => p.key))
      expect(popPanel(s).stack).toEqual(closePanel(s, key!).stack)
    })
  }
  it('a breadcrumb closes every panel above it', () => {
    const s = stackOf(page, form, report)
    expect(closePanel(s, closeKeyFor(s, { above: 0 })!).stack.map((p) => p.key)).toEqual(['k0'])
    expect(closePanel(s, closeKeyFor(s, { above: 1 })!).stack.map((p) => p.key)).toEqual(['k0', 'k1'])
    expect(closeKeyFor(s, { above: 2 })).toBeNull()
  })
  it('an empty stack has nothing to close', () => {
    expect(closeKeyFor([], 'all')).toBeNull()
    expect(closeKeyFor([], 'top')).toBeNull()
    expect(closeAllPanels([])).toEqual({ stack: [], confirm: false })
  })
  it('unsaved input anywhere in the stack asks before × closes it; forced, it closes', () => {
    const s = markDirty(stackOf(page, form), 'k1', true)
    expect(closeAllPanels(s)).toEqual({ stack: s, confirm: true })
    expect(closeAllPanels(s, { force: true }).stack).toEqual([])
    // Back closes only the top one: an unsaved panel below doesn't block it.
    const below = markDirty(stackOf(page, form, report), 'k0', true)
    expect(closePanel(below, closeKeyFor(below, 'top')!).confirm).toBe(false)
  })
  it('a clean stack never asks (a form only filled by its own defaults is not unsaved)', () => {
    const s = stackOf(page, form)
    expect(closeAllPanels(s).confirm).toBe(false)
    expect(closePanel(s, closeKeyFor(s, 'top')!).confirm).toBe(false)
  })
})

describe('the address: one history entry per level, Back pops one', () => {
  it('opening pushes, closing one level goes back one', () => {
    expect(historyPlan(0, 1, 0, true)).toEqual({ plan: { op: 'push' }, pushed: 1 })
    expect(historyPlan(1, 2, 1, true)).toEqual({ plan: { op: 'push' }, pushed: 2 })
    expect(historyPlan(2, 1, 2, true)).toEqual({ plan: { op: 'back', n: 1, thenReplace: false }, pushed: 1 })
  })
  it('× on a stack we opened goes back over all its entries (the page again, no panels left in Forward-only)', () => {
    expect(historyPlan(3, 0, 3, true)).toEqual({ plan: { op: 'back', n: 3, thenReplace: false }, pushed: 0 })
  })
  it('a stack from a shared link / refresh: closing replaces (nothing of ours to go back over)', () => {
    expect(historyPlan(2, 0, 0, true)).toEqual({ plan: { op: 'replace' }, pushed: 0 })
    expect(historyPlan(2, 1, 0, true)).toEqual({ plan: { op: 'replace' }, pushed: 0 })
  })
  it('a mix: back over ours, then replace the rest away', () => {
    // Refreshed with one panel, opened a second, then ×: back one, replace to no panels.
    expect(historyPlan(2, 0, 1, true)).toEqual({ plan: { op: 'back', n: 1, thenReplace: true }, pushed: 0 })
  })
  it('same depth (an open target moved to the top) replaces; no change does nothing', () => {
    expect(historyPlan(2, 2, 2, true)).toEqual({ plan: { op: 'replace' }, pushed: 2 })
    expect(historyPlan(2, 2, 2, false)).toEqual({ plan: { op: 'none' }, pushed: 2 })
  })
  it('panelHref sets and clears ?panel= and keeps the rest of the query', () => {
    const s = stackOf(page, form)
    const href = panelHref('/apps/cloud-admin/health', '?as=viewer', s)
    expect(href.startsWith('/apps/cloud-admin/health?as=viewer&panel=')).toBe(true)
    expect(decodePanels(new URL(href, 'http://x').searchParams.get('panel')).map((p) => p.target)).toEqual([page, form])
    expect(panelHref('/apps/cloud-admin/health', `?as=viewer&panel=${encodeURIComponent(encodePanels(s)!)}`, [])).toBe('/apps/cloud-admin/health?as=viewer')
    expect(panelHref('/apps/x', '', [])).toBe('/apps/x')
  })
})

describe('reconcileStack: the stack follows Back / Forward', () => {
  it('Back (the address names a lower part of the stack) keeps the open panels below, with their keys and titles', () => {
    const s = stackOf(page, form, report).map((p, i) => ({ ...p, title: `T${i}` }))
    const url = decodePanels(encodePanels(s.slice(0, 2)))
    const r = reconcileStack(s, url)
    expect(r.prefix).toBe(true)
    expect(r.common).toBe(2)
    expect(r.stack).toEqual(s.slice(0, 2))
    expect(reconcileStack(s, []).stack).toEqual([])
  })
  it('the same address changes nothing', () => {
    const s = stackOf(page, form)
    const r = reconcileStack(s, decodePanels(encodePanels(s)))
    expect(r.same).toBe(true)
    expect(r.stack).toEqual(s)
  })
  it('Forward adds the panels the address names, with fresh keys', () => {
    const s = stackOf(page, form)
    const r = reconcileStack(s.slice(0, 1), decodePanels(encodePanels(s)))
    expect(r.prefix).toBe(false)
    expect(r.common).toBe(1)
    expect(r.stack[0]).toEqual(s[0])
    expect(r.stack[1].target).toEqual(form)
    expect(r.stack[1].key).not.toBe(r.stack[0].key)
  })
  it('a different stack replaces the open one', () => {
    const r = reconcileStack(stackOf(page, form), decodePanels(encodePanels(stackOf(report))))
    expect(r.common).toBe(0)
    expect(r.stack.map((p) => p.target)).toEqual([report])
  })
})

describe('the owner’s two-panel stack from the address', () => {
  it('?panel=r2:page:workspace:…~r1:form:… decodes to a page panel under a form panel, and × closes both', () => {
    const raw = 'r2:page:workspace::workspace_id=6f1c2c0e-1111-4222-8333-444455556666~r1:form:f027c4415:workspace_id=6f1c2c0e-1111-4222-8333-444455556666'
    const s = decodePanels(raw)
    expect(s.map((p) => p.target)).toEqual([page, form])
    expect(s.map((p) => p.mode)).toEqual(['panel_right', 'panel_right'])
    expect(encodePanels(s)).toBe(raw)
    expect(closePanel(s, closeKeyFor(s, 'all')!).stack).toEqual([])
    expect(closePanel(s, closeKeyFor(s, 'top')!).stack.map((p) => p.target)).toEqual([page])
  })
  it('mobile panels (full screen) close the same way', () => {
    let s: Panel[] = []
    for (const target of [page, form]) s = pushPanel(s, { target, mode: 'panel_right', width: 'md', motion: 'auto' }, { mobile: true }).stack
    expect(s.every((p) => p.mode === 'fullscreen')).toBe(true)
    expect(closeAllPanels(s).stack).toEqual([])
  })
})

describe('wiring (source): the pieces the browser check relies on', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('a form reports unsaved only for what the person entered, not the defaults it filled itself', () => {
    const src = read('components/forms/standalone-form.tsx')
    expect(src).toMatch(/const unsaved = hasUnsavedEntries\(values, \{ \.\.\.defaults, \.\.\.baseline \}, edited\)/)
    expect(src).toMatch(/setBaseline\(values\); setEdited\(true\)/)
    expect(src).toMatch(/onDirtyChange\?\.\(unsaved\)/)
    expect(src).not.toMatch(/onDirtyChange\?\.\(hasValues\)/)
  })
  it('× and the backdrop close the whole stack; back closes one level; Esc closes the top', () => {
    const src = read('components/apps/panels.tsx')
    expect(src).toMatch(/onClose=\{\(\) => close\("all"\)\}/)
    expect(src).toMatch(/onBack=\{i > 0 \? \(\) => close\(\{ key: panel\.key \}\)/)
    expect(src).toMatch(/e\.key === "Escape"[^\n]*close\("top"\)/)
  })
  it('a dialog opened while panels are up (the discard confirmation) is lifted above them', () => {
    const css = read('components/apps/apps.css')
    expect(css).toMatch(/body\[data-app-panels-open\] \.ds-dialog/)
    expect(css).toMatch(/body\[data-app-panels-open\] \.ds-overlay/)
    expect(read('components/apps/panels.tsx')).toMatch(/setAttribute\("data-app-panels-open"/)
  })
})

describe('wiring (source): a sent form is not unsaved', () => {
  it('a successful submission clears the person-edited flag (the panel closes without asking)', () => {
    const src = readFileSync(join(process.cwd(), 'components/forms/standalone-form.tsx'), 'utf8')
    const i = src.indexOf('onSubmitted?.({ submission_id')
    expect(i).toBeGreaterThan(0)
    expect(src.slice(i, i + 600)).toMatch(/setEdited\(false\)/)
  })
})

describe('hasUnsavedEntries: what a panel asks about before closing', () => {
  const defaults = { workspace_id: '6f1c', workspace: 'conca' }
  it('a form holding only the defaults it filled itself is not unsaved, even after a click into a field', () => {
    expect(hasUnsavedEntries({ workspace_id: '6f1c', workspace: 'conca' }, defaults, false)).toBe(false)
    expect(hasUnsavedEntries({ workspace_id: '6f1c', workspace: 'conca' }, defaults, true)).toBe(false)
    expect(hasUnsavedEntries({ workspace_id: '6f1c', email: '' }, defaults, true)).toBe(false)
  })
  it('something the person typed is unsaved', () => {
    expect(hasUnsavedEntries({ workspace_id: '6f1c', email: 'a@b.example' }, defaults, true)).toBe(true)
    expect(hasUnsavedEntries({ workspace: 'other' }, defaults, true)).toBe(true)
    expect(hasUnsavedEntries({ tags: ['x'] }, {}, true)).toBe(true)
  })
  it('values without a person edit (form-load rules, a restored draft) are not', () => {
    expect(hasUnsavedEntries({ email: 'a@b.example' }, {}, false)).toBe(false)
    expect(hasUnsavedEntries({ __form_params: { a: 1 } }, {}, true)).toBe(false)
  })
})
