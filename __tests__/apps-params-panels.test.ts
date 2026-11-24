/**
 * App parameter values (lib/apps/params.ts), designer panel sizes and
 * remembered sizes (lib/apps/panels.ts), form titles without raw page ids
 * (lib/forms/display-title.ts), chart axis helpers and the app palette.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/actions/apps', () => ({}))
vi.mock('@/app/actions/home', () => ({}))

import { needsUser, paramMapSchema, resolveParams, resolveValue, unmappedRequired } from '@/lib/apps/params'
import { PANEL_MIN, decodePanels, designSize, encodePanels, parseSavedSize, sizeKey, sizePx } from '@/lib/apps/panels'
import { displayFormTitle, humaniseIdentifier } from '@/lib/forms/display-title'
import { formParamUses } from '@/lib/apps/governance'
import { groupColors, statusColor, statusTone } from '@/lib/apps/colors'
import { axisLayout, shortLabel } from '@/components/apps/widgets/chart-view'
import { normalisePageLayout, openModeSchema, WIDGET_CONFIG_SCHEMAS } from '@/lib/apps/schema'

const FORM = '0f000000-0000-4000-8000-0000000000f1'

describe('parameter values', () => {
  const ctx = { filters: { region: 'emea', none: null }, user: { id: 'u1', name: 'Sam', email: 's@example.com', team: 't1' }, app: 'desk', page: 'home', query: { ref: 'abc' }, event: { name: 'Northwind' }, now: new Date('2026-11-21T10:00:00Z') }
  it('resolves every source; Phase 3 variables resolve to nothing yet', () => {
    expect(resolveValue({ from: 'static', value: 'x' }, ctx)).toBe('x')
    expect(resolveValue({ from: 'filter', filter: 'region' }, ctx)).toBe('emea')
    expect(resolveValue({ from: 'filter', filter: 'none' }, ctx)).toBeNull()
    expect(resolveValue({ from: 'system', key: 'user_email' }, ctx)).toBe('s@example.com')
    expect(resolveValue({ from: 'system', key: 'today' }, ctx)).toBe('2026-11-21')
    expect(resolveValue({ from: 'system', key: 'url_param', param: 'ref' }, ctx)).toBe('abc')
    expect(resolveValue({ from: 'event', key: 'name' }, ctx)).toBe('Northwind')
    expect(resolveValue({ from: 'variable', name: 'rowId' }, ctx)).toBeNull()
    expect(resolveParams({ a: { from: 'static', value: 'x' }, b: { from: 'variable', name: 'v' } }, ctx)).toEqual({ a: 'x' })
  })
  it('required parameters left unmapped; schema limits', () => {
    expect(unmappedRequired([{ name: 'id', required: true }, { name: 'opt' }, { name: 'def', required: true, default: '1' }], { opt: { from: 'static', value: '' } })).toEqual(['id'])
    expect(needsUser({ a: { from: 'system', key: 'user_name' } })).toBe(true)
    expect(paramMapSchema.safeParse({ 'bad name': { from: 'static', value: '' } }).success).toBe(false)
    expect(paramMapSchema.safeParse({ x: { from: 'system', key: 'password' } }).success).toBe(false)
  })
  it('every place an app passes parameters to a form is found (warnings)', () => {
    const layout = normalisePageLayout({ widgets: [
      { id: 'f', type: 'form_embed', w: 6, h: 6, config: WIDGET_CONFIG_SCHEMAS.form_embed.parse({ form_id: FORM, params: { a: { from: 'static', value: '1' } } }) },
      { id: 'b', type: 'actions', w: 6, h: 2, config: WIDGET_CONFIG_SCHEMAS.actions.parse({ buttons: [{ label: 'New', action: { kind: 'new_submission', form_id: FORM } }] }) },
      { id: 't', type: 'tabs', w: 6, h: 6, config: WIDGET_CONFIG_SCHEMAS.tabs.parse({ tabs: [{ label: 'F', target: { kind: 'form', form_id: FORM } }] }) },
    ] })
    const uses = formParamUses([{ title: 'Home', layout }], [{ kind: 'form', label: 'Menu form', form_id: FORM, open: 'modal' }])
    expect(uses.map((u) => u.where)).toEqual(['Menu: Menu form', 'Home › form embed', 'Home › actions: New', 'Home › tabs: F'])
    expect(uses[1].params).toEqual({ a: { from: 'static', value: '1' } })
  })
  it('form panels keep their parameters in the URL', () => {
    const stack = decodePanels(encodePanels([{ key: 'k', target: { t: 'form', id: FORM, params: { region: 'emea' } }, mode: 'modal', width: 'md', motion: 'auto' }]))
    expect(stack[0].target).toEqual({ t: 'form', id: FORM, params: { region: 'emea' } })
  })
})

describe('panel sizes', () => {
  it('presets and percentages; Phase 1 widths still map', () => {
    expect(designSize(openModeSchema.parse({ preset: 'xl' }))).toEqual({ w: 84, h: 90 })
    expect(designSize(openModeSchema.parse({ width_pct: 60, height_pct: 80 }))).toEqual({ w: 60, h: 80 })
    expect(designSize(openModeSchema.parse({ width: 'lg' }))).toEqual({ w: 68, h: 82 })
    expect(openModeSchema.safeParse({ width_pct: 5 }).success).toBe(false)
    expect(openModeSchema.parse({}).resizable).toBe(true)
  })
  it('pixels clamp to the minimum and leave a margin unless full', () => {
    expect(sizePx({ w: 10, h: 10 }, { w: 1400, h: 900 })).toEqual({ w: PANEL_MIN.w, h: PANEL_MIN.h })
    expect(sizePx({ w: 99, h: 99 }, { w: 1000, h: 800 })).toEqual({ w: 984, h: 784 })
    expect(sizePx({ w: 100, h: 100 }, { w: 1000, h: 800 })).toEqual({ w: 1000, h: 800 })
  })
  it('a person’s size is remembered per target; bad stored values are ignored', () => {
    expect(sizeKey({ t: 'form', id: FORM })).toBe(`ut:apps:panel-size:form:${FORM}`)
    expect(parseSavedSize('{"w":70,"h":60}')).toEqual({ w: 70, h: 60 })
    expect(parseSavedSize('{"w":700}')).toBeNull()
    expect(parseSavedSize('nope')).toBeNull()
  })
})

describe('titles, axes, colours', () => {
  it('form titles never show raw page ids', () => {
    expect(displayFormTitle('Updated BB Form 20240708 — NEW_SUBMISSION_PAGE')).toBe('Updated BB Form 20240708')
    expect(displayFormTitle('NEW_SUBMISSION_PAGE')).toBe('New submission')
    expect(displayFormTitle('Expense claim - Step two')).toBe('Expense claim - Step two')
    expect(humaniseIdentifier('EDIT_VIEW')).toBe('Edit')
  })
  it('short axis labels; crowded axes rotate and thin', () => {
    expect(shortLabel('2026-11-01')).toBe('Nov 1')
    expect(shortLabel('2026-11')).toBe('Nov 26')
    expect(axisLayout(5, 600, 6)).toEqual({ angle: 0, height: 24, interval: 0 })
    const crowded = axisLayout(60, 300, 6)
    expect(crowded.angle).toBeLessThan(0)
    expect(crowded.interval).toBeGreaterThan(0)
  })
  it('status colours are consistent; other groups take the palette in order', () => {
    expect(statusTone('completed')).toBe('done')
    expect(statusTone('In progress')).toBe('active')
    expect(statusTone('waiting_for_event')).toBe('waiting')
    expect(statusTone('failed')).toBe('bad')
    expect(statusColor('todo')).toBe('var(--app-status-idle)')
    expect(groupColors(['a', 'b'], false)).toEqual(['var(--app-chart-1)', 'var(--app-chart-2)'])
    expect(groupColors(['completed', 'x'], true)).toEqual(['var(--app-status-done)', 'var(--app-chart-1)'])
  })
})
