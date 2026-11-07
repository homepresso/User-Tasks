/**
 * The unified task list (My tasks + what used to be the Task queue): which
 * of a person's tasks show as **Queued** and what they can do with them.
 *
 * A task is Queued for someone while it waits for their response:
 *  - assigned to them and awaiting acceptance (tasks.acceptance_status 'pending') → Accept / Decline;
 *  - a collaborative task with their task_assignees row pending → Accept / Decline;
 *  - unassigned and given to one of their teams → Claim;
 *  - unassigned with them as a claim candidate (task_assignees role
 *    'candidate': an AAD group task, lib/tasks/aad-group-runtime.ts) → Claim.
 * Only open tasks (to do / in progress / blocked) can be Queued. Queued is a
 * display status: it is never stored in tasks.status.
 *
 * Pure and client-safe (the list reads, the pages and the tests use it).
 */

export const QUEUED_STATUS = 'queued'
export const OPEN_TASK_STATUSES_FOR_QUEUE = ['todo', 'in_progress', 'blocked'] as const

export type QueueAction = 'accept' | 'claim'

export interface QueueScope {
  userId: string
  teamIds: ReadonlySet<string>
  /** Collaborative tasks whose task_assignees row for this person is pending. */
  collabPendingIds: ReadonlySet<string>
  /** Unassigned tasks this person may claim (their task_assignees row has role 'candidate'). */
  claimCandidateIds?: ReadonlySet<string>
}

/** task_assignees.role of someone who may claim an unassigned (AAD group) task. */
export const CLAIM_CANDIDATE_ROLE = 'candidate'

export interface QueueableTask {
  id: string
  status?: string | null
  assignee_id?: string | null
  assigned_team_id?: string | null
  acceptance_status?: string | null
}

/** What the person can do with a queued task, or null when it isn't queued for them. */
export function queueActionFor(task: QueueableTask, scope: QueueScope): QueueAction | null {
  if (!(OPEN_TASK_STATUSES_FOR_QUEUE as readonly string[]).includes(String(task.status ?? ''))) return null
  if (task.assignee_id === scope.userId && task.acceptance_status === 'pending') return 'accept'
  if (!task.assignee_id && scope.claimCandidateIds?.has(task.id)) return 'claim'
  if (scope.collabPendingIds.has(task.id)) return 'accept'
  if (!task.assignee_id && task.assigned_team_id && scope.teamIds.has(task.assigned_team_id)) return 'claim'
  return null
}

/** The status the list shows: Queued while it waits for a response, else the task's own. */
export function displayStatus(task: { status?: string | null }, action: QueueAction | null): string {
  return action ? QUEUED_STATUS : String(task.status ?? '')
}

/**
 * Status filter over display statuses: an empty filter keeps everything; a
 * queued task matches only "queued", any other task its own status.
 */
export function matchesStatusFilter(display: string, statuses: readonly string[] | null | undefined): boolean {
  if (!statuses?.length) return true
  return statuses.includes(display)
}

/** The task statuses a DB query must fetch so the display-status filter can be applied after. */
export function storedStatusesFor(statuses: readonly string[] | null | undefined): string[] | null {
  if (!statuses?.length) return null
  const stored = new Set(statuses.filter((s) => s !== QUEUED_STATUS))
  if (statuses.includes(QUEUED_STATUS)) for (const s of OPEN_TASK_STATUSES_FOR_QUEUE) stored.add(s)
  return [...stored]
}

/** Sort weight for the calm default: queued first, then the existing order. */
export function queuedFirst<T extends { display_status?: string }>(rows: T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const qa = a.row.display_status === QUEUED_STATUS ? 0 : 1
      const qb = b.row.display_status === QUEUED_STATUS ? 0 : 1
      return qa - qb || a.index - b.index
    })
    .map(({ row }) => row)
}

/** The retired Task queue page's URL lands on the task list filtered to Queued (next.config redirects). */
export const TASK_QUEUE_REDIRECT = { source: '/tasks/queue', destination: '/tasks?status=queued', permanent: false } as const
