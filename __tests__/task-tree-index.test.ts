import { describe, expect, it } from 'vitest'
import { childrenIndex } from '@/lib/tasks/tree-index'

type T = { id: string; parent_task_id: string | null; sequence: number }

/** The task tree's old per-node lookup: filter + sort the whole list for every node. */
function oldBuildTree(tasks: T[], parentId: string) {
  return tasks.filter((s) => s.parent_task_id === parentId).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
}

function tree(levels: number, fanOut: number): T[] {
  const out: T[] = []
  let frontier = ['root']
  for (let d = 0; d < levels; d++) {
    const next: string[] = []
    for (const p of frontier) for (let k = fanOut; k >= 1; k--) { const id = `${p}.${k}`; out.push({ id, parent_task_id: p, sequence: k }); next.push(id) }
    frontier = next
  }
  return out
}

describe('task tree children index', () => {
  it('gives every node the same children, in the same order, as the per-node filter + sort', () => {
    const tasks = tree(4, 3)
    const index = childrenIndex(tasks)
    for (const id of ['root', ...tasks.map((t) => t.id)]) expect((index.get(id) ?? []).map((t) => t.id)).toEqual(oldBuildTree(tasks, id).map((t) => t.id))
  })

  it('is linear: a 3,906-task tree renders its lookups far faster than the per-node scan', () => {
    const tasks = tree(5, 5) // 5 + 25 + 125 + 625 + 3125 = 3,905 subtasks
    const ids = ['root', ...tasks.map((t) => t.id)]
    let t0 = performance.now()
    for (const id of ids) oldBuildTree(tasks, id)
    const oldMs = performance.now() - t0
    t0 = performance.now()
    const index = childrenIndex(tasks)
    for (const id of ids) index.get(id)
    const newMs = performance.now() - t0
    expect(newMs * 10).toBeLessThan(oldMs)
  })
})
