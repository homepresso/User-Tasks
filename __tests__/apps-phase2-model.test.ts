/**
 * App builder Phase 2 model (pure): every widget type has a catalogue entry
 * and a config schema whose defaults parse; open modes, navigation styles,
 * menu groups, page options; templates; duplicate / copy / paste; panel
 * stack behaviour; embeds and custom SVG icons.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  WIDGET_CONFIG_SCHEMAS, WIDGET_TYPES, appNavSchema, menuItemSchema, normaliseMenu, normaliseNav, normalisePageLayout, openModeSchema, pageAllowed,
  pageLayoutSchema, actionButtonSchema,
} from '@/lib/apps/schema'
import { WIDGET_CATALOG, appGridDefs, catalogEntry, containedIds, dockedBars, isBleed, newWidget } from '@/lib/apps/widgets'
import { widgetBindings } from '@/lib/apps/governance'
import { PAGE_TEMPLATES, clipboardPayload, cloneWidgets, duplicateWidget, gridWidgets, pasteWidgets } from '@/lib/apps/templates'
import { MAX_PANELS, closePanel, decodePanels, encodePanels, markDirty, motionFor, openModeFor, popPanel, pushPanel, targetOf, type Panel } from '@/lib/apps/panels'
import { embedAllowed, originOf, videoSource } from '@/lib/apps/embed-origins'
import { APP_ICON_MAX_BYTES, cleanAppIconSvg, customIconId, customIconToken } from '@/lib/apps/icon-svg'

const UUID = '0f000000-0000-4000-8000-0000000000f1'

describe('widget catalogue', () => {
  it('every type has one catalogue entry and defaults that parse; sizes are sane', () => {
    expect(new Set(WIDGET_CATALOG.map((e) => e.type)).size).toBe(WIDGET_CATALOG.length)
    expect(WIDGET_CATALOG.map((e) => e.type).sort()).toEqual([...WIDGET_TYPES].sort())
    for (const type of WIDGET_TYPES) {
      const e = catalogEntry(type)
      expect(e.title.length).toBeGreaterThan(0)
      expect(e.minW).toBeLessThanOrEqual(e.w)
      expect(e.w).toBeLessThanOrEqual(e.maxW)
      expect(e.minH).toBeLessThanOrEqual(e.h)
      expect(e.h).toBeLessThanOrEqual(e.maxH)
      expect(WIDGET_CONFIG_SCHEMAS[type].safeParse({}).success).toBe(true)
    }
    expect(WIDGET_TYPES.length).toBeGreaterThanOrEqual(50)
  })

  it('new widgets start with their type defaults; form embed and embeds are chromeless (bleed) by default', () => {
    const w = newWidget('form_embed', [])
    expect(w.bleed).toBe(true)
    expect(isBleed(w)).toBe(true)
    expect(isBleed(newWidget('kanban', []))).toBe(false)
    expect(isBleed({ type: 'chart', bleed: true })).toBe(true)
    // Bleed widgets draw no card on the grid.
    expect(appGridDefs([{ id: 'a', type: 'chart', bleed: true, title: null }])('a')).toMatchObject({ group: 'metric', bleed: true })
  })

  it('container children and docked nav bars come off the grid; one nav bar per edge', () => {
    const tabs = { id: 'tabs-1', type: 'tabs' as const, w: 12, h: 8, config: { tabs: [{ label: 'A', widgets: ['k', 'tabs-1'] }] } }
    const k = newWidget('kanban', [])
    k.id = 'k'
    const bar1 = { ...newWidget('nav_bar', []), id: 'bar1' }
    const bar2 = { ...newWidget('nav_bar', []), id: 'bar2' }
    const layout = normalisePageLayout({ widgets: [tabs, k, bar1, bar2] })
    expect([...containedIds(layout.widgets)]).toEqual(['k'])
    expect(gridWidgets(layout.widgets).map((w) => w.id)).toEqual(['tabs-1', 'bar1', 'bar2'])
    expect(dockedBars(layout.widgets).left?.id).toBe('bar1')
  })

  it('rejects unsafe values: http embeds, bad shortcuts, unknown chart kinds', () => {
    expect(WIDGET_CONFIG_SCHEMAS.embed.safeParse({ url: 'http://x.example' }).success).toBe(false)
    expect(WIDGET_CONFIG_SCHEMAS.chart.safeParse({ chart: 'radar3d' }).success).toBe(false)
    expect(actionButtonSchema.safeParse({ label: 'X', shortcut: 'ctrl+alt+delete', action: { kind: 'copy_link' } }).success).toBe(false)
    const ok = actionButtonSchema.parse({ label: 'X', action: { kind: 'copy_link' } })
    expect(ok).toMatchObject({ style: 'primary', color: 'theme', size: 'md', shape: 'rounded', icon_position: 'left', full_width: false })
    expect(WIDGET_CONFIG_SCHEMAS.card_view.safeParse({ reference_inputs: { 'bad name': 'x' } }).success).toBe(false)
    expect(WIDGET_CONFIG_SCHEMAS.card_view.safeParse({ results_path: 'a; drop' }).success).toBe(false)
  })
})

describe('open modes, navigation, menus, page options', () => {
  it('open mode defaults and validation', () => {
    expect(openModeSchema.parse({})).toEqual({ mode: 'modal', width: 'md', motion: 'auto', resizable: true })
    expect(openModeSchema.safeParse({ mode: 'popup' }).success).toBe(false)
  })

  it('app navigation: defaults (tabs, full shell), invalid stored values fall back', () => {
    expect(normaliseNav(undefined)).toMatchObject({ style: 'tabs', shell: 'full', header_style: 'plain' })
    expect(normaliseNav({ style: 'carousel' }).style).toBe('tabs')
    expect(appNavSchema.parse({ style: 'sidebar', sidebar_collapsed: true }).sidebar_collapsed).toBe(true)
    expect(appNavSchema.safeParse({ banner_url: 'javascript:alert(1)' }).success).toBe(false)
  })

  it('menu: groups with one level of sub-groups, dividers and headings; deeper nesting is refused', () => {
    const group = { kind: 'group', label: 'Admin', items: [{ kind: 'heading', label: 'Config' }, { kind: 'group', label: 'Pricing', items: [{ kind: 'page', label: 'Plans', page_slug: 'plans' }] }, { kind: 'divider', label: '' }] }
    expect(menuItemSchema.safeParse(group).success).toBe(true)
    const tooDeep = { kind: 'group', label: 'A', items: [{ kind: 'group', label: 'B', items: [{ kind: 'group', label: 'C', items: [] }] }] }
    expect(menuItemSchema.safeParse(tooDeep).success).toBe(false)
    expect(normaliseMenu([group, { kind: 'nope' }]).length).toBe(1)
  })

  it('page options: hidden pages and the lowest app role', () => {
    const layout = normalisePageLayout({ widgets: [], options: { hidden: true, min_role: 'contributor' } })
    expect(layout.options).toEqual({ hidden: true, min_role: 'contributor' })
    expect(normalisePageLayout({ widgets: [] }).options).toBeUndefined()
    expect(pageAllowed(layout.options, 'viewer')).toBe(false)
    expect(pageAllowed(layout.options, 'contributor')).toBe(true)
    expect(pageAllowed({ hidden: false, min_role: 'editor' }, 'contributor')).toBe(false)
    expect(pageAllowed(undefined, 'viewer')).toBe(true)
    expect(pageLayoutSchema.safeParse({ widgets: [], options: { min_role: 'admin' } }).success).toBe(false)
  })
})

describe('templates, duplicate, copy and paste', () => {
  it('every template is a valid layout that binds no fixed objects (designers pick them)', () => {
    expect(PAGE_TEMPLATES.map((t) => t.id)).toEqual(['team_dashboard', 'requester_portal', 'manager_approvals', 'operations_sla'])
    for (const t of PAGE_TEMPLATES) {
      expect(pageLayoutSchema.safeParse(t.layout).success).toBe(true)
      expect(t.layout.widgets.length).toBeGreaterThan(3)
      for (const w of t.layout.widgets) expect(widgetBindings(w).objects).toEqual([])
      // Every bound filter exists on the template.
      const ids = new Set(t.filters.map((f) => f.id))
      for (const w of t.layout.widgets) for (const v of Object.values(w.config as Record<string, unknown>)) {
        if (v && typeof v === 'object' && 'filter' in (v as object) && Object.keys(v as object).length === 1) expect(ids.has((v as { filter: string }).filter)).toBe(true)
      }
    }
  })

  it('duplicate gives a new id right after; a container brings its children, re-pointed', () => {
    const a = { ...newWidget('kpi', []), id: 'kpi-1' }
    const s = { id: 'section-1', type: 'section' as const, w: 12, h: 6, config: WIDGET_CONFIG_SCHEMAS.section.parse({ widgets: ['kpi-1'] }) }
    const widgets = normalisePageLayout({ widgets: [s, a] }).widgets
    const r = duplicateWidget(widgets, 'section-1')
    expect(r.widgets.map((w) => w.id)).toEqual(['section-1', 'section-2', 'kpi-2', 'kpi-1'])
    expect((r.widgets[1].config as { widgets: string[] }).widgets).toEqual(['kpi-2'])
  })

  it('paste accepts only our payload, drops invalid widgets and never reuses ids', () => {
    const w = normalisePageLayout({ widgets: [{ ...newWidget('goal', []), id: 'goal-1' }] }).widgets
    const payload = clipboardPayload(w, ['goal-1'])
    expect(pasteWidgets(payload, w)?.map((x) => x.id)).toEqual(['goal-2'])
    expect(pasteWidgets('{"kind":"other","widgets":[]}', w)).toBeNull()
    expect(pasteWidgets('not json', w)).toBeNull()
    expect(pasteWidgets(JSON.stringify({ kind: 'usertasks/app-widgets@1', widgets: [{ id: 'x', type: 'nope', w: 1, h: 1, config: {} }] }), w)).toEqual([])
    expect(cloneWidgets(w, ['goal-1', 'goal-2'])[0].id).toBe('goal-3')
  })
})

describe('panel stack', () => {
  const panel = (id: string, extra: Partial<Panel> = {}) => ({ target: { t: 'page' as const, slug: id }, mode: 'panel_right' as const, width: 'md' as const, motion: 'auto' as const, ...extra })
  it('caps the stack (overflow → the caller navigates); the same target moves to the top', () => {
    let stack: Panel[] = []
    for (let i = 0; i < MAX_PANELS; i++) stack = pushPanel(stack, panel(`p${i}`)).stack
    expect(stack).toHaveLength(MAX_PANELS)
    expect(pushPanel(stack, panel('extra')).overflow).toBe(true)
    const again = pushPanel(stack, panel('p1'))
    expect(again.stack.map((p) => (p.target as { slug: string }).slug)).toEqual(['p0', 'p2', 'p3', 'p4', 'p1'])
  })
  it('closes top first; an unsent form asks first unless forced; closing one closes those above it', () => {
    let stack = pushPanel([], panel('settings')).stack
    stack = pushPanel(stack, panel('pricing')).stack
    stack = pushPanel(stack, { ...panel('x'), target: { t: 'form', id: UUID } }).stack
    stack = markDirty(stack, stack[2].key, true)
    expect(popPanel(stack)).toMatchObject({ confirm: true })
    expect(popPanel(stack, { force: true }).stack).toHaveLength(2)
    expect(closePanel(stack, stack[1].key).confirm).toBe(true)
    expect(closePanel(markDirty(stack, stack[2].key, false), stack[1].key).stack).toHaveLength(1)
  })
  it('phones always get full screen; reduced motion means no motion', () => {
    const s = pushPanel([], panel('a'), { mobile: true }).stack[0]
    expect(s).toMatchObject({ mode: 'fullscreen', width: 'full', resizable: false })
    expect(motionFor('panel_right', 'auto', false)).toBe('slide-right')
    expect(motionFor('modal', 'auto', false)).toBe('scale')
    expect(motionFor('sheet', 'slide', true)).toBe('none')
  })
  it('URL round trip (?panel=…); unsafe parts are dropped', () => {
    let stack = pushPanel([], { ...panel('pricing'), target: { t: 'page', slug: 'pricing', filters: { region: 'emea west' } } }).stack
    stack = pushPanel(stack, { target: { t: 'form', id: UUID }, mode: 'modal', width: 'lg', motion: 'auto' }).stack
    const decoded = decodePanels(encodePanels(stack))
    expect(decoded.map((p) => [p.mode, p.width, p.target])).toEqual([['panel_right', 'md', { t: 'page', slug: 'pricing', filters: { region: 'emea west' } }], ['modal', 'lg', { t: 'form', id: UUID }]])
    expect(decodePanels('r1:page:../../etc~z9:form:x~m1:evil:abc')).toEqual([])
    expect(encodePanels([])).toBeNull()
  })
  it('targets and default open modes per action', () => {
    expect(targetOf({ kind: 'open_report', report_id: UUID })).toEqual({ t: 'report', id: UUID })
    expect(targetOf({ kind: 'copy_link', target: 'this_page' })).toBeNull()
    expect(openModeFor({ kind: 'new_submission', form_id: UUID, open: 'page' }, null).mode).toBe('navigate')
    expect(openModeFor({ kind: 'new_submission', form_id: UUID, open: 'drawer' }, null).mode).toBe('panel_right')
    expect(openModeFor({ kind: 'open_page', page_slug: 'x' }, { mode: 'sheet', width: 'md', motion: 'none' }).mode).toBe('sheet')
  })
})

describe('embeds and custom icons', () => {
  it('embeds: only listed https origins (wildcards for subdomains)', () => {
    expect(embedAllowed('https://maps.example.com/x', ['https://maps.example.com'])).toBe(true)
    expect(embedAllowed('https://a.b.example.com/x', ['https://*.example.com'])).toBe(true)
    expect(embedAllowed('https://example.com', ['https://*.example.com'])).toBe(false)
    expect(embedAllowed('http://maps.example.com', ['https://maps.example.com'])).toBe(false)
    expect(embedAllowed('https://evil.com/?https://maps.example.com', ['https://maps.example.com'])).toBe(false)
    expect(originOf('javascript:alert(1)')).toBeNull()
  })
  it('videos: YouTube (privacy host), Vimeo, or a file', () => {
    expect(videoSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ kind: 'frame', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' })
    expect(videoSource('https://youtu.be/dQw4w9WgXcQ')?.src).toContain('youtube-nocookie.com')
    expect(videoSource('https://vimeo.com/123456789')).toEqual({ kind: 'frame', src: 'https://player.vimeo.com/video/123456789' })
    expect(videoSource('https://cdn.example.com/a.mp4')?.kind).toBe('file')
    expect(videoSource('https://example.com/page')).toBeNull()
  })
  it('SVG icons are sanitised: scripts, handlers, foreignObject, external refs and css url() removed; size limited', () => {
    const dirty = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><div/></foreignObject><image href="https://evil.example/x.png"/><rect style="fill:url(https://evil.example/a)" fill="url(#g)"/><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>`
    const clean = cleanAppIconSvg(dirty)!
    expect(clean).toMatch(/^<svg/)
    for (const bad of ['script', 'onload', 'foreignObject', 'evil.example', 'javascript:']) expect(clean).not.toContain(bad)
    expect(clean).toContain('url(#g)')
    expect(cleanAppIconSvg('<html><svg></svg></html>')).toBeNull()
    expect(cleanAppIconSvg(`<svg>${' '.repeat(APP_ICON_MAX_BYTES)}</svg>`)).toBeNull()
  })
  it('icon tokens; the renderer never inlines uploaded SVG markup', () => {
    expect(customIconId(customIconToken(UUID))).toBe(UUID)
    expect(customIconId('Briefcase')).toBeNull()
    const src = readFileSync('components/apps/app-icon.tsx', 'utf8') + readFileSync('components/apps/icon-picker.tsx', 'utf8')
    expect(src).not.toContain('dangerouslySetInnerHTML')
    expect(src).toContain('maskImage')
  })
})
