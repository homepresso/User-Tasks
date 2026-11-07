/**
 * Organization page charts (components/org): the pure tree layout
 * (chart-layout.ts — tree vs grid placement, only expanded nodes, culling,
 * zoom / fit maths), the chart trees built from the reads (tree-data.ts) and
 * a static render of the people chart and the phone list with a small org.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  centreOn, clampZoom, defaultExpanded, edgePath, expandPathTo, fitView, GRID_MIN, layoutChart, NODE_H, NODE_W, visibleNodes, zoomAt,
  type ChartTree,
} from '@/components/org/chart-layout'
import { flattenTree, parentTree, peopleTree } from '@/components/org/tree-data'
import { PeopleChart } from '@/components/org/people-chart'

/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */

function tree(edges: Record<string, string[]>, roots: string[]): ChartTree {
  return { roots, childrenOf: new Map(Object.entries(edges)) }
}

const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x < b.x + NODE_W && b.x < a.x + NODE_W && a.y < b.y + NODE_H && b.y < a.y + NODE_H

describe('chart layout', () => {
  const t = tree({ ceo: ['cto', 'cfo'], cto: ['d1', 'd2'], cfo: ['a1'] }, ['ceo'])

  it('lays out only expanded subtrees', () => {
    const collapsed = layoutChart(t, new Set())
    expect(collapsed.nodes.map((n) => n.id)).toEqual(['ceo'])
    const one = layoutChart(t, new Set(['ceo']))
    expect(one.nodes.map((n) => n.id).sort()).toEqual(['ceo', 'cfo', 'cto'])
    expect(one.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(['ceo>cfo', 'ceo>cto'])
  })

  it('tree style: children on the next row, parent centred above them, no overlaps', () => {
    const l = layoutChart(t, new Set(['ceo', 'cto', 'cfo']))
    const at = (id: string) => l.byId.get(id)!
    expect(at('cto').y).toBe(at('cfo').y)
    expect(at('cto').y).toBeGreaterThan(at('ceo').y + NODE_H)
    expect(at('d1').depth).toBe(2)
    expect(at('d1').parentId).toBe('cto')
    const ceoCentre = at('ceo').x + NODE_W / 2
    expect(ceoCentre).toBeGreaterThan(at('cto').x)
    expect(ceoCentre).toBeLessThan(at('cfo').x + NODE_W)
    for (const a of l.nodes) for (const b of l.nodes) if (a !== b) expect(overlaps(a, b)).toBe(false)
    expect(l.width).toBeGreaterThanOrEqual(3 * NODE_W)
  })

  it('stacks a large group of individual contributors in a grid instead of one wide row', () => {
    const reports = Array.from({ length: 40 }, (_, i) => `r${i}`)
    const wide = layoutChart(tree({ m: reports }, ['m']), new Set(['m']))
    expect(reports.length).toBeGreaterThanOrEqual(GRID_MIN)
    expect(wide.width).toBeLessThan(5 * (NODE_W + 40))
    const rows = new Set(reports.map((r) => wide.byId.get(r)!.y))
    expect(rows.size).toBe(10) // 4 columns
    for (const a of wide.nodes) for (const b of wide.nodes) if (a !== b) expect(overlaps(a, b)).toBe(false)
  })

  it('places a forest side by side and survives a loop in the data', () => {
    const forest = layoutChart(tree({ a: ['b'], b: ['a'], x: [] }, ['a', 'x']), new Set(['a', 'b']))
    expect(forest.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'x'])
    expect(forest.byId.get('x')!.x).toBeGreaterThan(forest.byId.get('a')!.x)
  })

  it('handles a 2,000-person org quickly, and starts small', () => {
    const edges: Record<string, string[]> = {}
    let n = 1
    const frontier = ['p0']
    while (n < 2000) {
      const parent = frontier.shift()!
      const kids = Array.from({ length: 7 }, () => `p${n++}`).filter((id) => Number(id.slice(1)) < 2000)
      edges[parent] = kids
      frontier.push(...kids)
    }
    const big = tree(edges, ['p0'])
    const start = defaultExpanded(big)
    const initial = layoutChart(big, start)
    expect(initial.nodes.length).toBeLessThanOrEqual(150)
    expect(initial.nodes.length).toBeGreaterThan(7)
    const t0 = performance.now()
    const all = layoutChart(big, new Set(Object.keys(edges)))
    expect(all.nodes).toHaveLength(2000)
    expect(performance.now() - t0).toBeLessThan(500)
    // Culling: a 1200×800 viewport at 100% shows a small slice.
    expect(visibleNodes(all, { x: 0, y: 0, k: 1 }, { width: 1200, height: 800 }).length).toBeLessThan(60)
    // No container size (SSR / tests): everything.
    expect(visibleNodes(all, { x: 0, y: 0, k: 1 }, { width: 0, height: 0 })).toHaveLength(2000)
  })

  it('expands the path to a person', () => {
    const parentOf = new Map([['d1', 'cto'], ['cto', 'ceo']])
    expect([...expandPathTo(new Set(), parentOf, 'd1')].sort()).toEqual(['ceo', 'cto'])
  })

  it('zoom, fit and centre maths', () => {
    expect(clampZoom(10)).toBe(2)
    expect(clampZoom(0.01)).toBe(0.15)
    const z = zoomAt({ x: 0, y: 0, k: 1 }, 2, 100, 100)
    expect(z).toEqual({ k: 2, x: -100, y: -100 })
    const l = layoutChart(t, new Set(['ceo', 'cto', 'cfo']))
    const fit = fitView(l, { width: 400, height: 300 })
    expect(fit.k).toBeLessThan(1)
    expect(l.width * fit.k).toBeLessThanOrEqual(400)
    const c = centreOn(l, 'd2', { width: 1000, height: 600 }, 1)!
    const node = l.byId.get('d2')!
    expect(c.x + (node.x + NODE_W / 2)).toBe(500)
    expect(edgePath([[0, 0], [0, 10.4], [5, 10.4]])).toBe('M0,0 L0,10 L5,10')
  })
})

describe('chart trees from the reads', () => {
  const people = [
    { id: 'ceo', display_name: 'Ada', email: null, manager_user_id: null, total_reports: 4 },
    { id: 'm1', display_name: 'Zed', email: null, manager_user_id: 'ceo', total_reports: 1 },
    { id: 'ic', display_name: 'Bob', email: null, manager_user_id: 'ceo', total_reports: 0 },
    { id: 'm2', display_name: 'Cy', email: null, manager_user_id: 'ceo', total_reports: 2 },
    { id: 'x', display_name: 'X', email: null, manager_user_id: 'm1', total_reports: 0 },
  ]

  it('people: managers (by size) before individual contributors', () => {
    const tr = peopleTree(people, ['ceo'])
    expect(tr.childrenOf.get('ceo')).toEqual(['m2', 'm1', 'ic'])
    expect(tr.parentOf.get('x')).toBe('m1')
    expect(flattenTree(tr, 'all').map((r) => `${r.id}:${r.depth}`)).toEqual(['ceo:0', 'm2:1', 'm1:1', 'x:2', 'ic:1'])
    expect(flattenTree(tr, new Set(['ceo'])).map((r) => r.id)).toEqual(['ceo', 'm2', 'm1', 'ic'])
  })

  it('parent trees keep the server order', () => {
    const tr = parentTree([{ id: 'co', child_ids: ['b', 'a'] }, { id: 'a', child_ids: [] }, { id: 'b', child_ids: [] }], ['co'])
    expect(tr.childrenOf.get('co')).toEqual(['b', 'a'])
    expect(tr.parentOf.get('a')).toBe('co')
  })
})

describe('people chart (static render)', () => {
  const person = (id: string, name: string, manager: string | null, extra: Record<string, unknown> = {}) => ({
    id, display_name: name, email: `${id}@x.test`, avatar_url: null, job_title: null, department: null, location: null,
    manager_user_id: manager, manager_source: null, employee_id: null, cost_center: null, profile_source: null,
    direct_reports: 0, total_reports: 0, ...extra,
  })
  const people = [
    person('ceo', 'Ada Lovelace', null, { job_title: 'Chief Executive', direct_reports: 1, total_reports: 3 }),
    person('cto', 'Grace Hopper', 'ceo', { job_title: 'CTO', department: 'Engineering', direct_reports: 1, total_reports: 2 }),
    person('lead', 'Linus T', 'cto', { direct_reports: 1, total_reports: 1 }),
    person('dev', 'Deep Dev', 'lead'),
  ] as any[]

  it('renders the roots and two levels, collapsed below, with accessible toggles', () => {
    const html = renderToStaticMarkup(createElement(PeopleChart, { people, roots: ['ceo'], meId: 'cto', selectedId: null, onSelect: () => {}, mobile: false }))
    expect(html).toContain('aria-label="Org chart"')
    expect(html).toContain('Ada Lovelace')
    expect(html).toContain('Chief Executive')
    expect(html).toContain('Grace Hopper')
    expect(html).toContain('Engineering')
    expect(html).toContain('Linus T')
    expect(html).toContain('>You<')
    // Third level is collapsed: not rendered, its manager's toggle says so.
    expect(html).not.toContain('Deep Dev')
    expect(html).toContain('aria-label="Show 1 direct report of Linus T"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="Hide 1 direct report of Ada Lovelace"')
    expect(html).toContain('Zoom in')
    expect(html).toContain('<path')
  })

  it('on phones it is an indented tree list', () => {
    const html = renderToStaticMarkup(createElement(PeopleChart, { people, roots: ['ceo'], meId: null, selectedId: null, onSelect: () => {}, mobile: true }))
    expect(html).toContain('role="tree"')
    expect(html).toContain('aria-level="3"')
    expect(html).not.toContain('data-chart-canvas')
  })
})
