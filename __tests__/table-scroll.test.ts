/**
 * Scrolling tables: between phones and the wide desktop a list keeps readable
 * columns and scrolls sideways inside its own region instead of squashing.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TD, TH, TR, Table, TableDetailCell, TableEmpty, TableScroll, Truncate, columnClass } from '@/components/ui/table'

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
const root = path.resolve(__dirname, '..')
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8')

describe('Table scroll region', () => {
  it('is a focusable, labelled region that scrolls sideways', () => {
    const out = html(h(Table, { label: 'Tasks' }, h('tbody', null, h(TR, null, h(TD, null, 'x')))))
    expect(out).toContain('role="region"')
    expect(out).toContain('aria-label="Tasks"')
    expect(out).toContain('tabindex="0"')
    expect(out).toContain('data-table-scroll')
    expect(out).toContain('ds-table-scroll')
    // Edge shadow hints, hidden from assistive tech.
    expect(out.match(/ds-table-edge /g)?.length).toBe(2)
    expect(out).toContain('aria-hidden="true"')
  })

  it('defaults the region name and takes aria-label from the table', () => {
    expect(html(h(Table, null))).toContain('aria-label="Table"')
    expect(html(h(Table, { 'aria-label': 'Forms' }))).toContain('aria-label="Forms"')
  })

  it('applies a table minWidth so it scrolls instead of shrinking', () => {
    const out = html(h(Table, { minWidth: '52rem' }))
    expect(out).toMatch(/<table[^>]*style="min-width:52rem"/)
    expect(html(h(Table, null))).not.toMatch(/<table[^>]*min-width/)
  })

  it('sticky first column is opt-in', () => {
    expect(html(h(Table, { stickyFirstColumn: true }))).toContain('data-sticky-first="1"')
    expect(html(h(Table, null))).not.toContain('data-sticky-first')
    expect(html(h(TableScroll, { stickyFirstColumn: true, label: 'List' }))).toContain('data-sticky-first="1"')
  })

  it('bare drops the frame border; containerClassName lands on the frame', () => {
    expect(html(h(Table, { bare: true }))).not.toContain('rounded-lg border border-border')
    const out = html(h(Table, { containerClassName: 'max-md:hidden' }))
    expect(out).toMatch(/class="ds-table-frame[^"]*max-md:hidden/)
  })
})

describe('column presets', () => {
  it('give each kind of column a readable minimum width', () => {
    expect(columnClass.title).toBe('min-w-64')
    expect(columnClass.status).toContain('min-w-32')
    expect(columnClass.date).toContain('min-w-32')
    expect(columnClass.date).toContain('whitespace-nowrap')
    expect(columnClass.people).toContain('min-w-40')
    expect(columnClass.actions).toContain('whitespace-nowrap')
  })

  it('TH / TD take the preset', () => {
    expect(html(h('table', null, h('thead', null, h('tr', null, h(TH, { col: 'title' }, 'Name')))))).toContain('min-w-64')
    expect(html(h('table', null, h('tbody', null, h('tr', null, h(TD, { col: 'date' }, 'Yesterday')))))).toContain('whitespace-nowrap')
    // Numbers never wrap.
    expect(html(h('table', null, h('tbody', null, h('tr', null, h(TD, { numeric: true }, '1,240')))))).toContain('num text-right whitespace-nowrap')
  })

  it('Truncate shows the whole text in a tooltip', () => {
    const out = html(h(Truncate, { text: 'Purchase request approval' }))
    expect(out).toContain('title="Purchase request approval"')
    expect(out).toContain('truncate')
  })

  it('full-width rows stay in view while the table scrolls', () => {
    expect(html(h('table', null, h('tbody', null, h('tr', null, h(TableDetailCell, { colSpan: 3 }, 'details')))))).toContain('ds-table-detail')
    expect(html(h('table', null, h('tbody', null, h(TableEmpty, { colSpan: 3, title: 'None' }))))).toContain('ds-table-detail')
  })
})

describe('shared table CSS', () => {
  const css = read('app/globals.css')
  it('scrolls with momentum, thin scrollbar, edge shadows', () => {
    expect(css).toMatch(/\.ds-table-scroll \{[^}]*overflow-x: auto/)
    expect(css).toMatch(/\.ds-table-scroll \{[^}]*-webkit-overflow-scrolling: touch/)
    expect(css).toMatch(/\.ds-table-scroll \{[^}]*scrollbar-width: thin/)
    expect(css).toContain('.ds-table-frame[data-scroll-start] > .ds-table-edge-start')
    expect(css).toContain('.ds-table-frame[data-scroll-end] > .ds-table-edge-end')
  })
  it('truncating cells keep 10rem at every width (not only on phones)', () => {
    expect(css).toMatch(/\.ds-table-scroll td\.max-w-0 \{\s*min-width: 10rem/)
    expect(read('components/ui/table.tsx')).not.toContain('max-sm:[&_td.max-w-0]')
  })
  it('sticky first column with a shadow once scrolled', () => {
    expect(css).toMatch(/\[data-sticky-first\] \.ds-table-scroll :is\(th, td\):first-child:not\(\[colspan\]\) \{[^}]*position: sticky/)
    expect(css).toMatch(/\[data-sticky-first\]\[data-scroll-start\]/)
  })
})

describe('list views use the shared scroll behaviour', () => {
  it('main task and process lists keep their name column in view', () => {
    for (const file of ['app/(dashboard)/tasks/page.tsx', 'app/(dashboard)/tasks/assigned/page.tsx']) {
      expect(read(file), file).toContain('stickyFirstColumn')
    }
  })
  it('Home lists scroll sideways with readable columns', () => {
    const src = read('components/home/home-tabs.tsx')
    expect(src).toContain('TableScroll')
    expect(src).not.toMatch(/minmax\(0,/)
  })
  it('Following: Started / Updated / People get real widths; actions stay on one row', () => {
    const src = read('components/home/home-tabs.tsx')
    const follow = src.slice(src.indexOf('export function FollowingTab'), src.indexOf('/* ── My submissions'))
    expect(follow).toContain('flex-nowrap')
    expect(follow).not.toContain('flex flex-wrap gap-1')
  })
})
