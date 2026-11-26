/**
 * Children of every task in a subtask list, sorted by sequence, built once.
 * The task tree used to filter + sort the whole list for each node it
 * rendered (O(N²) per render: every node asks for its children).
 */
export function childrenIndex<T extends { id: string; parent_task_id?: string | null; sequence?: number | null }>(tasks: readonly T[]): Map<string, T[]> {
  const index = new Map<string, T[]>()
  for (const t of tasks) {
    if (!t.parent_task_id) continue
    const list = index.get(t.parent_task_id)
    if (list) list.push(t)
    else index.set(t.parent_task_id, [t])
  }
  // Stable sort by sequence, like Array.prototype.sort on the filtered list.
  for (const list of index.values()) list.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
  return index
}
