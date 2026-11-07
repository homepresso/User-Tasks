import { describe, expect, it } from 'vitest'
import {
  COMPACT_ROWS, GAP_PX, HOME_WIDGETS, HOME_WIDGET_IDS, MAX_ROWS, ROW_PX, applyLayoutKey, availableItems, colsForWidth, defaultHomeLayout,
  desktopWidth, displayItems, hideWidget, homeLayoutInputSchema, isCompactWidget, isDefaultHomeLayout, moveWidget, normaliseHomeLayout,
  parseExpandedWidgets, replaceVisible, resizeWidget, rowsForHeight, sameHomeLayout, showWidget, spanFor, toggleExpandedWidget, widgetDef,
  type HomeLayout, type HomeWidgetId,
} from '@/lib/home/layout'

const ids = (l: HomeLayout) => l.items.map((i) => i.id)
const item = (l: HomeLayout, id: HomeWidgetId) => l.items.find((i) => i.id === id)!

describe('default order', () => {
  it('is the four top cards, the task list, the other charts, then drafts', () => {
    expect(ids(defaultHomeLayout())).toEqual([
      'metric.tasks', 'chart.decisions', 'metric.submissions', 'metric.following',
      'tasks',
      'chart.completed', 'chart.duration', 'chart.top_processes',
      'drafts',
    ])
    expect(defaultHomeLayout().hidden).toEqual([])
  })

  it('has no Favourite forms widget (it is a tab of the task list now)', () => {
    expect(HOME_WIDGET_IDS).not.toContain('favorites')
    expect(widgetDef('favorites')).toBeUndefined()
  })

  it('has no On time / My submissions chart widgets (they merged into the top cards)', () => {
    for (const id of ['chart.on_time', 'chart.submissions']) {
      expect(HOME_WIDGET_IDS).not.toContain(id)
      expect(widgetDef(id)).toBeUndefined()
    }
  })

  it('puts the four top cards in one row of quarters, collapsed and expandable', () => {
    const l = defaultHomeLayout()
    for (const id of ['metric.tasks', 'chart.decisions', 'metric.submissions', 'metric.following'] as const) {
      expect(item(l, id)).toEqual({ id, w: 3, h: COMPACT_ROWS })
      expect(widgetDef(id)!.group).toBe('metric')
      expect(isCompactWidget(id)).toBe(true)
      expect(widgetDef(id)!.minH).toBe(COMPACT_ROWS) // in edit mode the collapsed size is the minimum
    }
    expect(isCompactWidget('chart.completed')).toBe(false)
    expect(isCompactWidget('tasks')).toBe(false)
    // The rest of the charts: two halves, then a full-width row.
    expect([item(l, 'chart.completed').w, item(l, 'chart.duration').w, item(l, 'chart.top_processes').w]).toEqual([6, 6, 12])
  })

  it('puts the cards on one row and the task list full width', () => {
    const l = defaultHomeLayout()
    expect(l.items.slice(0, 4).reduce((n, i) => n + i.w, 0)).toBe(12)
    expect(item(l, 'tasks').w).toBe(12)
  })

  it('spreads the cards the person can see across the row', () => {
    const noForms = (p: string) => p !== 'forms.submit'
    expect(availableItems(defaultHomeLayout(noForms), noForms).filter((i) => widgetDef(i.id)!.group === 'metric').map((i) => i.w)).toEqual([4, 4, 4])
    const formsOnly = (p: string) => p === 'forms.submit'
    expect(availableItems(defaultHomeLayout(formsOnly), formsOnly).filter((i) => widgetDef(i.id)!.group === 'metric').map((i) => i.w)).toEqual([6, 6])
  })

  it('every default size is within its widget bounds', () => {
    for (const d of HOME_WIDGETS) {
      expect(d.w).toBeGreaterThanOrEqual(d.minW)
      expect(d.w).toBeLessThanOrEqual(d.maxW)
      expect(d.h).toBeGreaterThanOrEqual(d.minH)
      expect(d.h).toBeLessThanOrEqual(d.maxH)
    }
    expect(isDefaultHomeLayout(defaultHomeLayout())).toBe(true)
  })
})

describe('normalise', () => {
  it('drops unknown (removed) widgets and duplicates', () => {
    const l = normaliseHomeLayout({ items: [{ id: 'tasks', w: 12, h: 10 }, { id: 'chart.retired', w: 4, h: 4 }, { id: 'tasks', w: 3, h: 3 }], hidden: ['old.widget'] })
    expect(ids(l)).not.toContain('chart.retired')
    expect(ids(l).filter((i) => i === 'tasks')).toHaveLength(1)
    expect(item(l, 'tasks')).toEqual({ id: 'tasks', w: 12, h: 10 })
    expect(l.hidden).toEqual([])
  })

  it('clamps sizes to each widget’s bounds and rounds them', () => {
    const l = normaliseHomeLayout({ items: [
      { id: 'metric.tasks', w: 99, h: -4 }, { id: 'tasks', w: 1, h: 1000 }, { id: 'chart.decisions', w: 5.6, h: 'x' },
    ] })
    const m = widgetDef('metric.tasks')!
    expect(item(l, 'metric.tasks')).toEqual({ id: 'metric.tasks', w: m.maxW, h: m.minH })
    const t = widgetDef('tasks')!
    expect(item(l, 'tasks')).toEqual({ id: 'tasks', w: t.minW, h: t.maxH })
    expect(item(l, 'chart.decisions')).toEqual({ id: 'chart.decisions', w: 6, h: widgetDef('chart.decisions')!.h })
  })

  it('places widgets it doesn’t mention (new in a later release) in their default spot', () => {
    // Saved before the charts existed: cards reordered, task list last.
    const l = normaliseHomeLayout({ items: [
      { id: 'metric.following', w: 4, h: 3 }, { id: 'metric.tasks', w: 4, h: 3 }, { id: 'tasks', w: 12, h: 12 },
    ], hidden: ['drafts', 'metric.submissions'] })
    // Each goes in right after its nearest default predecessor on the page.
    expect(ids(l)).toEqual([
      'metric.following', 'metric.tasks', 'chart.decisions', 'tasks',
      'chart.completed', 'chart.duration', 'chart.top_processes',
    ])
    expect(l.hidden).toEqual(['drafts', 'metric.submissions'])
    expect(item(l, 'chart.completed')).toEqual({ id: 'chart.completed', w: 6, h: 8 })
  })

  it('drops the retired Favourite forms widget from a saved layout and keeps the rest as saved', () => {
    const saved = {
      items: [
        { id: 'metric.tasks', w: 4, h: 3 }, { id: 'metric.submissions', w: 4, h: 3 }, { id: 'metric.following', w: 4, h: 3 },
        { id: 'tasks', w: 12, h: 13 },
        { id: 'chart.completed', w: 8, h: 8 }, { id: 'chart.decisions', w: 4, h: 8 }, { id: 'chart.duration', w: 8, h: 8 },
        { id: 'chart.on_time', w: 4, h: 8 }, { id: 'chart.top_processes', w: 8, h: 8 }, { id: 'chart.submissions', w: 4, h: 8 },
        { id: 'favorites', w: 12, h: 4 }, { id: 'drafts', w: 12, h: 3 },
      ],
      hidden: [],
    }
    const l = normaliseHomeLayout(saved)
    const kept = saved.items.filter((i) => !['favorites', 'chart.on_time', 'chart.submissions'].includes(i.id))
    // My decisions joins the top cards right after My tasks; cards at the old default third become quarters.
    expect(ids(l)).toEqual(['metric.tasks', 'chart.decisions', 'metric.submissions', 'metric.following', 'tasks', 'chart.completed', 'chart.duration', 'chart.top_processes', 'drafts'])
    expect(item(l, 'metric.tasks')).toEqual({ id: 'metric.tasks', w: 3, h: COMPACT_ROWS })
    expect(item(l, 'chart.decisions')).toEqual({ id: 'chart.decisions', w: 3, h: 8 })
    expect(item(l, 'chart.completed')).toEqual(kept.find((i) => i.id === 'chart.completed'))
    // Hidden, too.
    expect(normaliseHomeLayout({ ...saved, items: saved.items.filter((i) => i.id !== 'favorites'), hidden: ['favorites'] }).hidden).toEqual([])
    // Older clients may still send it: accepted, then dropped.
    expect(homeLayoutInputSchema.safeParse(saved).success).toBe(true)
    expect(homeLayoutInputSchema.safeParse({ items: [], hidden: ['favorites'] }).success).toBe(true)
    expect(isDefaultHomeLayout(l)).toBe(false)
  })

  it('maps a pre-merge layout (the compact row) onto the four top cards, keeping widths the person chose', () => {
    const saved = { items: [
      { id: 'metric.tasks', w: 6, h: 3 }, { id: 'metric.submissions', w: 4, h: 3 }, { id: 'metric.following', w: 2, h: 3 },
      { id: 'chart.decisions', w: 4, h: 3 }, { id: 'chart.on_time', w: 4, h: 3 }, { id: 'chart.submissions', w: 4, h: 3 },
      { id: 'tasks', w: 12, h: 13 },
    ], hidden: ['drafts'] }
    const l = normaliseHomeLayout(saved)
    expect(ids(l).slice(0, 5)).toEqual(['metric.tasks', 'chart.decisions', 'metric.submissions', 'metric.following', 'tasks'])
    expect(l.items.slice(0, 4).map((i) => [i.w, i.h])).toEqual([[6, 4], [3, 4], [3, 4], [3, 4]])
    expect(l.hidden).toEqual(['drafts'])
    expect(normaliseHomeLayout({ items: [{ id: 'tasks', w: 12, h: 13 }], hidden: ['chart.on_time'] }).hidden).toEqual([])
    // Older clients may still send the retired ids: accepted, then dropped.
    expect(homeLayoutInputSchema.safeParse(saved).success).toBe(true)
    // A layout saved after the merge is left as saved.
    const after = normaliseHomeLayout({ items: [{ id: 'metric.tasks', w: 4, h: 4 }, { id: 'tasks', w: 12, h: 13 }, { id: 'chart.decisions', w: 4, h: 4 }] })
    expect(ids(after).indexOf('chart.decisions')).toBeGreaterThan(ids(after).indexOf('tasks'))
    expect(item(after, 'metric.tasks').w).toBe(4)
  })

  it('a widget listed as visible is never also hidden', () => {
    const l = normaliseHomeLayout({ items: [{ id: 'tasks', w: 12, h: 12 }], hidden: ['tasks', 'drafts', 'drafts'] })
    expect(l.hidden).toEqual(['drafts'])
    expect(ids(l)).toContain('tasks')
  })

  it('anything unreadable is the default', () => {
    for (const raw of [null, undefined, 'x', 42, [], {}, { items: 'no' }]) expect(normaliseHomeLayout(raw)).toEqual(defaultHomeLayout())
  })

  it('keeps every widget exactly once across items and hidden', () => {
    const l = normaliseHomeLayout({ items: [{ id: 'drafts', w: 3, h: 2 }], hidden: ['tasks'] })
    expect([...ids(l), ...l.hidden].sort()).toEqual([...HOME_WIDGET_IDS].sort())
  })
})

describe('input schema (PUT)', () => {
  it('accepts a valid layout', () => {
    expect(homeLayoutInputSchema.safeParse(defaultHomeLayout()).success).toBe(true)
  })
  it('rejects unknown ids, out-of-grid sizes, extra keys and duplicates', () => {
    expect(homeLayoutInputSchema.safeParse({ items: [{ id: 'nope', w: 4, h: 4 }] }).success).toBe(false)
    expect(homeLayoutInputSchema.safeParse({ items: [{ id: 'tasks', w: 13, h: 4 }] }).success).toBe(false)
    expect(homeLayoutInputSchema.safeParse({ items: [{ id: 'tasks', w: 4, h: 0 }] }).success).toBe(false)
    expect(homeLayoutInputSchema.safeParse({ items: [{ id: 'tasks', w: 4.5, h: 4 }] }).success).toBe(false)
    expect(homeLayoutInputSchema.safeParse({ items: [{ id: 'tasks', w: 4, h: 4, x: 1 }] }).success).toBe(false)
    expect(homeLayoutInputSchema.safeParse({ items: [], extra: true }).success).toBe(false)
    expect(homeLayoutInputSchema.safeParse({ items: [{ id: 'tasks', w: 4, h: 6 }], hidden: ['tasks'] }).success).toBe(false)
    expect(homeLayoutInputSchema.safeParse({ items: Array.from({ length: 40 }, () => ({ id: 'tasks', w: 4, h: 6 })) }).success).toBe(false)
  })
})

describe('breakpoints', () => {
  it('12 columns from 900px, 6 from 560px, else 1', () => {
    expect(colsForWidth(1400)).toBe(12)
    expect(colsForWidth(900)).toBe(12)
    expect(colsForWidth(899)).toBe(6)
    expect(colsForWidth(560)).toBe(6)
    expect(colsForWidth(559)).toBe(1)
  })
  it('tablet halves desktop widths with a per-widget floor; mobile is one column', () => {
    expect(spanFor({ id: 'metric.tasks', w: 3, h: 4 }, 6)).toBe(3)
    expect(spanFor({ id: 'metric.tasks', w: 6, h: 4 }, 6)).toBe(3)
    expect(spanFor({ id: 'chart.decisions', w: 4, h: 8 }, 6)).toBe(3)
    expect(spanFor({ id: 'chart.completed', w: 8, h: 8 }, 6)).toBe(4)
    expect(spanFor({ id: 'tasks', w: 6, h: 12 }, 6)).toBe(6)
    expect(spanFor({ id: 'tasks', w: 12, h: 12 }, 1)).toBe(1)
    expect(spanFor({ id: 'tasks', w: 7, h: 12 }, 12)).toBe(7)
    expect(desktopWidth('chart.completed', 3, 6)).toBe(6)
    expect(desktopWidth('metric.tasks', 6, 6)).toBe(6)
  })
})

describe('edits', () => {
  it('move, resize (clamped), hide and show (default spot)', () => {
    let l = defaultHomeLayout()
    l = moveWidget(l, ids(l).indexOf('chart.decisions'), 2)
    expect(ids(l).slice(0, 4)).toEqual(['metric.tasks', 'metric.submissions', 'chart.decisions', 'metric.following'])
    l = resizeWidget(l, 'tasks', 2, 99)
    expect(item(l, 'tasks')).toEqual({ id: 'tasks', w: 4, h: 30 })
    l = hideWidget(l, 'metric.following')
    expect(ids(l)).not.toContain('metric.following')
    expect(l.hidden).toEqual(['metric.following'])
    l = showWidget(l, 'metric.following')
    // Back after My submissions, its default predecessor.
    expect(ids(l).indexOf('metric.following')).toBe(2)
    expect(l.hidden).toEqual([])
  })

  it('replaceVisible keeps widgets the person can’t see in place', () => {
    const l = defaultHomeLayout()
    const visible = new Set<string>(ids(l).filter((i) => i !== 'metric.submissions'))
    const shown = l.items.filter((i) => visible.has(i.id))
    const swapped = [shown[1], shown[0], ...shown.slice(2)]
    const out = replaceVisible(l, visible, swapped)
    expect(ids(out).slice(0, 3)).toEqual(['chart.decisions', 'metric.tasks', 'metric.submissions'])
    expect(out.items).toHaveLength(l.items.length)
  })

  it('reset: the default compares equal, a changed one does not', () => {
    const changed = resizeWidget(defaultHomeLayout(), 'tasks', 6, 10)
    expect(sameHomeLayout(changed, defaultHomeLayout())).toBe(false)
    expect(sameHomeLayout(defaultHomeLayout(), defaultHomeLayout())).toBe(true)
    expect(isDefaultHomeLayout(changed)).toBe(false)
  })
})

describe('keyboard reducer', () => {
  const base = defaultHomeLayout()
  it('arrows move one place; Home / End to the ends; announced with the position', () => {
    const r = applyLayoutKey(base, 'tasks', { key: 'ArrowLeft' }, 12)!
    expect(ids(r.layout).indexOf('tasks')).toBe(3)
    expect(r.message).toBe('Task list moved to position 4 of 9.')
    expect(ids(applyLayoutKey(base, 'tasks', { key: 'ArrowDown' }, 12)!.layout).indexOf('tasks')).toBe(5)
    expect(ids(applyLayoutKey(base, 'tasks', { key: 'ArrowUp' }, 12)!.layout).indexOf('tasks')).toBe(3)
    expect(ids(applyLayoutKey(base, 'drafts', { key: 'Home' }, 12)!.layout)[0]).toBe('drafts')
    expect(ids(applyLayoutKey(base, 'metric.tasks', { key: 'End' }, 12)!.layout).at(-1)).toBe('metric.tasks')
  })

  it('says so at either end and leaves the layout alone', () => {
    const first = applyLayoutKey(base, 'metric.tasks', { key: 'ArrowLeft' }, 12)!
    expect(first.layout).toBe(base)
    expect(first.message).toBe('My tasks is already first.')
    expect(applyLayoutKey(base, 'drafts', { key: 'ArrowRight' }, 12)!.message).toBe('Drafts is already last.')
  })

  it('Shift + arrows resize by one column / row, within bounds', () => {
    const narrower = applyLayoutKey(base, 'tasks', { key: 'ArrowLeft', shiftKey: true }, 12)!
    expect(item(narrower.layout, 'tasks').w).toBe(11)
    expect(narrower.message).toBe('Task list: 11 of 12 columns wide, 13 rows tall.')
    expect(item(applyLayoutKey(base, 'tasks', { key: 'ArrowDown', shiftKey: true }, 12)!.layout, 'tasks').h).toBe(14)
    expect(item(applyLayoutKey(base, 'tasks', { key: 'ArrowUp', shiftKey: true }, 12)!.layout, 'tasks').h).toBe(12)
    const wider = applyLayoutKey(base, 'tasks', { key: 'ArrowRight', shiftKey: true }, 12)!
    expect(item(wider.layout, 'tasks').w).toBe(12)
    expect(wider.message).toMatch(/can’t go any further/)
  })

  it('on a tablet a step is one of 6 columns (two desktop columns)', () => {
    const r = applyLayoutKey(base, 'chart.top_processes', { key: 'ArrowLeft', shiftKey: true }, 6)!
    expect(item(r.layout, 'chart.top_processes').w).toBe(10)
    expect(r.message).toBe('Processes I work in most: 5 of 6 columns wide, 5 rows tall.')
  })

  it('on a phone it reorders but does not resize', () => {
    const r = applyLayoutKey(base, 'tasks', { key: 'ArrowRight', shiftKey: true }, 1)!
    expect(r.layout).toBe(base)
    expect(r.message).toMatch(/narrow screen/)
    expect(ids(applyLayoutKey(base, 'tasks', { key: 'ArrowRight' }, 1)!.layout).indexOf('tasks')).toBe(5)
  })

  it('ignores other keys and unknown widgets', () => {
    expect(applyLayoutKey(base, 'tasks', { key: 'a' }, 12)).toBeNull()
    expect(applyLayoutKey({ items: [], hidden: [] }, 'tasks', { key: 'ArrowLeft' }, 12)).toBeNull()
  })
})

describe('compact widgets: collapsed / expanded', () => {
  const base = defaultHomeLayout().items

  it('rowsForHeight: the rows of 40 px (12 px gaps) that hold a height', () => {
    expect(rowsForHeight(COMPACT_ROWS * ROW_PX + (COMPACT_ROWS - 1) * GAP_PX)).toBe(COMPACT_ROWS) // 196 px: exactly 4
    expect(rowsForHeight(197)).toBe(5)
    expect(rowsForHeight(40)).toBe(1)
    expect(rowsForHeight(0)).toBe(1)
    expect(rowsForHeight(Number.NaN)).toBe(1)
  })

  it('collapsed: every widget keeps its size', () => {
    expect(displayItems(base, new Set(), { 'chart.decisions': 400 })).toEqual(base)
  })

  it('expanded: grows to the measured content, never below its saved size, at most MAX_ROWS', () => {
    const shown = displayItems(base, new Set(['chart.decisions']), { 'chart.decisions': 400, 'metric.tasks': 400 })
    expect(item({ items: shown, hidden: [] }, 'chart.decisions').h).toBe(rowsForHeight(400)) // 8
    expect(item({ items: shown, hidden: [] }, 'metric.tasks').h).toBe(COMPACT_ROWS) // not expanded
    // Not measured yet, or smaller than the saved size: unchanged.
    expect(displayItems(base, new Set(['chart.decisions']), {})).toEqual(base)
    const tall = base.map((i) => (i.id === 'chart.decisions' ? { ...i, h: 10 } : i))
    expect(displayItems(tall, new Set(['chart.decisions']), { 'chart.decisions': 200 })).toEqual(tall)
    expect(item({ items: displayItems(base, new Set(['chart.decisions']), { 'chart.decisions': 99_999 }), hidden: [] }, 'chart.decisions').h).toBe(MAX_ROWS)
    // Only compact widgets expand.
    expect(displayItems(base, new Set(['tasks']), { tasks: 2000 })).toEqual(base)
  })

  it('remembers the expanded ones as a JSON list of compact widget ids', () => {
    expect(parseExpandedWidgets(null)).toEqual([])
    expect(parseExpandedWidgets('nope')).toEqual([])
    expect(parseExpandedWidgets('{"a":1}')).toEqual([])
    // Retired ids (chart.on_time) are dropped.
    expect(parseExpandedWidgets('["metric.tasks","chart.on_time","tasks","favorites","metric.tasks",3]')).toEqual(['metric.tasks'])
    expect(toggleExpandedWidget([], 'chart.decisions')).toEqual(['chart.decisions'])
    expect(toggleExpandedWidget(['chart.decisions', 'metric.following'], 'chart.decisions')).toEqual(['metric.following'])
    expect(toggleExpandedWidget([], 'tasks')).toEqual([])
    expect(parseExpandedWidgets(JSON.stringify(toggleExpandedWidget([], 'metric.submissions')))).toEqual(['metric.submissions'])
  })
})
