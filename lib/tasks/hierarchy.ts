/**
 * The reporting-line tree of team tasks (lib/services/team-hierarchy.ts and
 * components/tasks/team-hierarchy.tsx): types, roll-ups, the path to a
 * search match and the remembered expansion. Pure and client-safe.
 */

import { MAX_REPORTING_DEPTH, type ReportingIndex } from '@/lib/reporting-lines'

export interface TaskCounts { open: number; overdue: number; queued: number }

export interface HierarchyNode {
  id: string
  name: string
  email: string | null
  avatar_url: string | null
  job_title: string | null
  manager_user_id: string | null
  /** 1 = the root's direct report. */
  depth: number
  /** Direct reports, by name. */
  reports: string[]
  own: TaskCounts
  /** Own + everyone below. */
  rollup: TaskCounts
  /** The search matched this person (name, title) or one of their open task titles. */
  match: boolean
}

export interface TeamHierarchy {
  root: { id: string; name: string }
  /** The root's direct reports (level 1), by name. */
  top: string[]
  nodes: Record<string, HierarchyNode>
  /** People with reports the caller may pick as the root (tasks.view_all only). */
  rootOptions: Array<{ id: string; name: string }> | null
  truncated: boolean
}

export const HIERARCHY_TASK_LIMIT = 10_000

const zero = (): TaskCounts => ({ open: 0, overdue: 0, queued: 0 })

/** Own + rolled-up counts over the tree (pure: the service and the tests). */
export function rollupCounts(index: Pick<ReportingIndex, 'reportsOf'>, ids: readonly string[], own: ReadonlyMap<string, TaskCounts>): Map<string, TaskCounts> {
  const memo = new Map<string, TaskCounts>()
  const inTree = new Set(ids)
  const visit = (id: string, depth: number): TaskCounts => {
    const cached = memo.get(id)
    if (cached) return cached
    const total = { ...(own.get(id) ?? zero()) }
    memo.set(id, total) // cycle guard
    if (depth < MAX_REPORTING_DEPTH) {
      for (const child of index.reportsOf.get(id) ?? []) {
        if (!inTree.has(child)) continue
        const sub = visit(child, depth + 1)
        total.open += sub.open
        total.overdue += sub.overdue
        total.queued += sub.queued
      }
    }
    return total
  }
  for (const id of ids) visit(id, 0)
  return memo
}

/** The ids on the way from a level-1 person down to `id` (to open the path to a search match). */
export function pathTo(nodes: Record<string, Pick<HierarchyNode, 'manager_user_id'>>, id: string): string[] {
  const path: string[] = []
  const seen = new Set<string>()
  let current: string | null = id
  while (current && nodes[current] && !seen.has(current)) {
    seen.add(current)
    path.unshift(current)
    current = nodes[current].manager_user_id
  }
  return path
}

/* ── Remembered expansion (per user, per list, this browser) ── */

export function expansionStorageKey(list: string, userId: string | null | undefined): string {
  return `usertasks:team-tree:${list}:${userId || 'anon'}`
}

export function readExpanded(list: string, userId: string | null | undefined): string[] {
  try {
    const raw = window.localStorage.getItem(expansionStorageKey(list, userId))
    const value = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 500) : []
  } catch {
    return []
  }
}

export function storeExpanded(list: string, userId: string | null | undefined, ids: Iterable<string>): void {
  try {
    window.localStorage.setItem(expansionStorageKey(list, userId), JSON.stringify([...ids].slice(0, 500)))
  } catch {
    // Storage off: the tree just opens collapsed next time.
  }
}
