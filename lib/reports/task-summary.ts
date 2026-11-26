/**
 * Task analytics (/reports/tasks) as one small summary instead of every task.
 *
 * The report used to receive all top-level tasks, all completions of the last
 * 12 weeks and all overdue tasks and count them in the browser. PostgREST's
 * max_rows (1,000) silently cut each list, so every number was wrong past
 * 1,000 tasks, and the payload grew with the tenant. The database now
 * computes the summary (report_task_summary, migration
 * 20270131100000_report_task_summary); summarizeTasks is the same arithmetic
 * in memory: the fallback before that migration, and the oracle its test
 * compares against.
 */

export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'completed', 'cancelled'] as const
export const TASK_PRIORITIES = ['critical', 'high', 'medium', 'low', 'none'] as const
export const OVERDUE_BUCKETS = [
  { name: '1-3 days', min: 1, max: 3 },
  { name: '4-7 days', min: 4, max: 7 },
  { name: '8-14 days', min: 8, max: 14 },
  { name: '15+ days', min: 15, max: 9999 },
] as const
const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

export interface TaskSummary {
  /** Top-level tasks created in the range. */
  total: number
  completed: number
  /** Mean created → completed time of the range's completed tasks (ms), null when none. */
  avg_completion_ms: number | null
  status: Record<string, number>
  priority: Record<string, number>
  /** Completed tasks per assignee in the range, top 10. */
  leaderboard: Array<{ assignee_id: string; count: number }>
  /** Open tasks past their due date (any level; not range-bound). */
  overdue: { count: number; buckets: number[] }
  /** Completed tasks (any level) per week, oldest first: week i ends at now − (11 − i) × 7 days. */
  weekly: number[]
}

interface TaskLike { status?: string | null; priority?: string | null; created_at?: string | null; completed_at?: string | null; assignee_id?: string | null; due_date?: string | null }

/** The summary from task lists (fallback / oracle). `topLevel`: non-deleted top-level tasks; `completedRecent`: completions of the last 12 weeks; `overdue`: open tasks due before now. */
export function summarizeTasks(input: { topLevel: TaskLike[]; completedRecent: TaskLike[]; overdue: TaskLike[] }, since: Date | null, now: Date): TaskSummary {
  const tasks = since ? input.topLevel.filter((t) => t.created_at && new Date(t.created_at) >= since) : input.topLevel
  const status: Record<string, number> = {}
  const priority: Record<string, number> = {}
  const byAssignee = new Map<string, number>()
  let completed = 0
  let durTotal = 0
  let durCount = 0
  for (const t of tasks) {
    if (t.status) status[t.status] = (status[t.status] ?? 0) + 1
    const p = t.priority ?? 'none'
    priority[p] = (priority[p] ?? 0) + 1
    if (t.status === 'completed') {
      completed += 1
      if (t.completed_at && t.created_at) {
        durTotal += new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()
        durCount += 1
      }
      if (t.assignee_id) byAssignee.set(t.assignee_id, (byAssignee.get(t.assignee_id) ?? 0) + 1)
    }
  }
  const leaderboard = [...byAssignee.entries()]
    .map(([assignee_id, count]) => ({ assignee_id, count }))
    .sort((a, b) => b.count - a.count || a.assignee_id.localeCompare(b.assignee_id))
    .slice(0, 10)
  const buckets = OVERDUE_BUCKETS.map(() => 0)
  for (const t of input.overdue) {
    const daysLate = Math.floor((now.getTime() - new Date(t.due_date!).getTime()) / DAY_MS)
    const i = OVERDUE_BUCKETS.findIndex((b) => daysLate >= b.min && daysLate <= b.max)
    if (i >= 0) buckets[i] += 1
  }
  const weekly = Array.from({ length: 12 }, () => 0)
  for (const t of input.completedRecent) {
    if (!t.completed_at) continue
    const age = now.getTime() - new Date(t.completed_at).getTime()
    // As the browser counted: completed in [now − (k+1) weeks, now − k weeks) is k weeks back.
    const back = Math.ceil(age / WEEK_MS) - 1
    if (age > 0 && back <= 11) weekly[11 - back] += 1
  }
  return {
    total: tasks.length,
    completed,
    avg_completion_ms: durCount ? durTotal / durCount : null,
    status,
    priority,
    leaderboard,
    overdue: { count: input.overdue.length, buckets },
    weekly,
  }
}

/** A summary from the database's jsonb (numbers may arrive as strings). */
export function normalizeTaskSummary(raw: any): TaskSummary {
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0)
  const counts = (o: any) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).map(([k, v]) => [k, num(v)]))
  return {
    total: num(raw?.total),
    completed: num(raw?.completed),
    avg_completion_ms: raw?.avg_completion_ms === null || raw?.avg_completion_ms === undefined ? null : Number(raw.avg_completion_ms),
    status: counts(raw?.status),
    priority: counts(raw?.priority),
    leaderboard: (Array.isArray(raw?.leaderboard) ? raw.leaderboard : []).map((r: any) => ({ assignee_id: String(r.assignee_id), count: num(r.count) })),
    overdue: { count: num(raw?.overdue?.count), buckets: OVERDUE_BUCKETS.map((_, i) => num(raw?.overdue?.buckets?.[i])) },
    weekly: Array.from({ length: 12 }, (_, i) => num(raw?.weekly?.[i])),
  }
}
