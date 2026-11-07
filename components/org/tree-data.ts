/**
 * Chart trees from the Organization reads (pure, client-safe): people by
 * manager, org units and teams by parent.
 */

import type { ChartTree } from './chart-layout'

export interface ChartTreeData extends ChartTree {
  parentOf: Map<string, string>
}

const byName = (names: Map<string, string>) => (a: string, b: string) => (names.get(a) ?? '').localeCompare(names.get(b) ?? '')

/**
 * Reporting-line tree. `roots` comes from the server (chart roots, biggest
 * organisation first, loops broken); children are sorted: managers first
 * (by team size), then by name.
 */
export function peopleTree(
  people: ReadonlyArray<{ id: string; display_name: string | null; email: string | null; manager_user_id: string | null; total_reports?: number }>,
  roots: readonly string[],
): ChartTreeData {
  const names = new Map(people.map((p) => [p.id, (p.display_name || p.email || '').toLowerCase()]))
  const totals = new Map(people.map((p) => [p.id, p.total_reports ?? 0]))
  const rootSet = new Set(roots)
  const childrenOf = new Map<string, string[]>()
  const parentOf = new Map<string, string>()
  for (const p of people) {
    if (!p.manager_user_id || rootSet.has(p.id) || !names.has(p.manager_user_id)) continue
    parentOf.set(p.id, p.manager_user_id)
    const list = childrenOf.get(p.manager_user_id)
    if (list) list.push(p.id)
    else childrenOf.set(p.manager_user_id, [p.id])
  }
  const cmp = byName(names)
  for (const list of childrenOf.values()) list.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || cmp(a, b))
  const known = roots.filter((id) => names.has(id))
  return { roots: known, childrenOf, parentOf }
}

/** A parent_id tree (org units, teams) with roots and child order from the server. */
export function parentTree(nodes: ReadonlyArray<{ id: string; child_ids: readonly string[] }>, roots: readonly string[]): ChartTreeData {
  const childrenOf = new Map<string, string[]>()
  const parentOf = new Map<string, string>()
  for (const n of nodes) {
    if (!n.child_ids.length) continue
    childrenOf.set(n.id, [...n.child_ids])
    for (const c of n.child_ids) parentOf.set(c, n.id)
  }
  return { roots: [...roots], childrenOf, parentOf }
}

/** Ids in depth-first order with their depth (indented lists, mobile). Only expanded nodes' children. */
export function flattenTree(tree: ChartTree, expanded: ReadonlySet<string> | 'all'): Array<{ id: string; depth: number }> {
  const out: Array<{ id: string; depth: number }> = []
  const seen = new Set<string>()
  const stack: Array<{ id: string; depth: number }> = [...tree.roots].reverse().map((id) => ({ id, depth: 0 }))
  while (stack.length) {
    const item = stack.pop()!
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
    if (expanded === 'all' || expanded.has(item.id)) {
      const kids = tree.childrenOf.get(item.id) ?? []
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ id: kids[i], depth: item.depth + 1 })
    }
  }
  return out
}
