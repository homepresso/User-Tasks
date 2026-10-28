import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Canonical "task data object" — everything a task collects, in one shape
 * that designers can bind to from the workflow builder ({{task.*}}) and the
 * form designer (task.* in rules/expressions).
 *
 * It is a strict SUPERSET of the raw tasks row: every column is preserved
 * as-is, so existing {{task.<column>}} references keep resolving unchanged.
 * On top of the columns it adds:
 *   data           — metadata.template_values (the User Task field values
 *                    collected on the task) → {{task.data.<field>}}
 *   actions        — metadata.task_actions (redirect/invite policy)
 *   form_url       — metadata.form_url (external form bound by a workflow)
 *   responses      — task_responses rows (multi-assignee outcomes)
 *   timeline       — recent lifecycle events (newest first)
 *   response_count / outcome_counts — aggregation of responses
 *   is_overdue / age_hours — computed conveniences
 */

export interface TaskResponseSummary {
  user_id: string
  outcome: string
  notes: string | null
  responded_at: string | null
}

export interface TaskTimelineEntry {
  event_type: string
  actor_id: string | null
  created_at: string
  metadata: Record<string, unknown> | null
}

export interface TaskDataObject extends Record<string, any> {
  data: Record<string, any>
  actions: Record<string, any>
  form_url: string | null
  responses: TaskResponseSummary[]
  timeline: TaskTimelineEntry[]
  response_count: number
  outcome_counts: Record<string, number>
  is_overdue: boolean
  age_hours: number
}

const ENRICHED_KEYS = ['data', 'actions', 'form_url', 'responses', 'timeline', 'response_count', 'outcome_counts', 'is_overdue', 'age_hours']

export function buildTaskDataObject(params: {
  task: Record<string, any>
  responses?: Array<Record<string, any>> | null
  events?: Array<Record<string, any>> | null
}): TaskDataObject {
  const { task, responses, events } = params
  const metadata = (task?.metadata ?? {}) as Record<string, any>

  const responseRows: TaskResponseSummary[] = (responses ?? []).map((row) => ({
    user_id: String(row.user_id ?? ''),
    outcome: String(row.outcome ?? ''),
    notes: row.outcome_notes ?? null,
    responded_at: row.responded_at ?? null,
  }))

  const outcomeCounts: Record<string, number> = {}
  for (const row of responseRows) {
    if (!row.outcome) continue
    outcomeCounts[row.outcome] = (outcomeCounts[row.outcome] ?? 0) + 1
  }

  const timeline: TaskTimelineEntry[] = (events ?? [])
    .slice(0, 20)
    .map((row) => ({
      event_type: String(row.event_type ?? ''),
      actor_id: row.actor_id ?? null,
      created_at: String(row.created_at ?? ''),
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    }))

  const now = Date.now()
  const dueDate = task?.due_date ? new Date(task.due_date) : null
  const isOverdue = Boolean(
    dueDate && !Number.isNaN(dueDate.getTime()) && dueDate.getTime() < now
    && task?.status !== 'completed' && task?.status !== 'cancelled',
  )
  const createdAt = task?.created_at ? new Date(task.created_at) : null
  const ageHours = createdAt && !Number.isNaN(createdAt.getTime())
    ? Math.max(0, Math.round((now - createdAt.getTime()) / 36e5))
    : 0

  const enriched: TaskDataObject = {
    ...task,
    data: (metadata.template_values ?? {}) as Record<string, any>,
    actions: (metadata.task_actions ?? {}) as Record<string, any>,
    form_url: (metadata.form_url as string | undefined) ?? null,
    responses: responseRows,
    timeline,
    response_count: Number(metadata.response_count ?? responseRows.length) || responseRows.length,
    outcome_counts: Object.keys(outcomeCounts).length > 0
      ? outcomeCounts
      : ((metadata.outcome_counts ?? {}) as Record<string, number>),
    is_overdue: isOverdue,
    age_hours: ageHours,
  }

  // Defensive: if a raw column ever collides with an enriched key, the raw
  // value must win — designers' references to real columns cannot break.
  for (const key of ENRICHED_KEYS) {
    if (task && Object.prototype.hasOwnProperty.call(task, key) && task[key] !== undefined && task[key] !== null) {
      enriched[key] = task[key]
    }
  }

  return enriched
}

/** Fetch a task plus its responses (and optionally timeline) and build the object. */
export async function loadTaskDataObject(
  supabase: SupabaseClient,
  taskId: string,
  /** tenantId: only a task of this tenant (the engine passes the run's tenant). */
  opts?: { includeTimeline?: boolean; tenantId?: string | null },
): Promise<TaskDataObject | null> {
  let taskQuery = (supabase as any).from('tasks').select('*').eq('id', taskId)
  if (opts?.tenantId) taskQuery = taskQuery.eq('tenant_id', opts.tenantId)
  const [{ data: task }, { data: responses }, eventsResult] = await Promise.all([
    taskQuery.maybeSingle(),
    (supabase as any).from('task_responses').select('user_id, outcome, outcome_notes, responded_at').eq('task_id', taskId).limit(100),
    opts?.includeTimeline
      ? (supabase as any).from('lifecycle_events').select('event_type, actor_id, created_at, metadata').eq('task_id', taskId).order('created_at', { ascending: false }).limit(20)
      : Promise.resolve({ data: null }),
  ])
  if (!task) return null
  return buildTaskDataObject({ task, responses, events: (eventsResult as any)?.data ?? null })
}

/**
 * The one task-variable catalog. Three UI surfaces used to keep their own
 * divergent hardcoded lists (variable-input CORE_VARIABLES, variables-panel,
 * context-viewer) — all three now consume this.
 */
export const TASK_VARIABLE_CATALOG: Array<{ name: string; description: string; group: 'Task' | 'Task Data' | 'Dates' }> = [
  { name: 'task.id', description: 'Task ID', group: 'Task' },
  { name: 'task.title', description: 'Task title', group: 'Task' },
  { name: 'task.description', description: 'Task description', group: 'Task' },
  { name: 'task.status', description: 'Current status', group: 'Task' },
  { name: 'task.priority', description: 'Priority level', group: 'Task' },
  { name: 'task.assignee_id', description: 'Assignee user ID', group: 'Task' },
  { name: 'task.assigner_id', description: 'Assigner user ID', group: 'Task' },
  { name: 'task.progress_pct', description: 'Progress percentage', group: 'Task' },
  { name: 'task.child_count', description: 'Number of subtasks', group: 'Task' },
  { name: 'task.estimated_effort_assigner', description: 'Estimated effort (assigner)', group: 'Task' },
  { name: 'task.actual_effort', description: 'Actual effort logged', group: 'Task' },
  { name: 'task.tenant_id', description: 'Tenant ID', group: 'Task' },
  { name: 'task.tags', description: 'Task tags', group: 'Task' },
  { name: 'task.acceptance_status', description: 'Queue acceptance state', group: 'Task' },
  { name: 'task.outcome', description: 'Selected outcome', group: 'Task' },
  { name: 'task.outcome_notes', description: 'Outcome notes', group: 'Task' },
  { name: 'task.actioned_by', description: 'User who completed the task (a manager when acted on behalf)', group: 'Task' },
  { name: 'task.actioned_on_behalf_of', description: 'Assignee a manager completed the task for (empty when the assignee did)', group: 'Task' },
  { name: 'task.data', description: 'All values collected via the task form (use task.data.<field>)', group: 'Task Data' },
  { name: 'task.responses', description: 'Individual assignee responses (multi-assignee tasks)', group: 'Task Data' },
  { name: 'task.response_count', description: 'Number of responses so far', group: 'Task Data' },
  { name: 'task.outcome_counts', description: 'Votes per outcome (multi-assignee tasks)', group: 'Task Data' },
  { name: 'task.timeline', description: 'Recent lifecycle events (newest first)', group: 'Task Data' },
  { name: 'task.actions', description: 'Redirect/invite policy configured on the task', group: 'Task Data' },
  { name: 'task.form_url', description: 'External form URL bound by the workflow', group: 'Task Data' },
  { name: 'task.is_overdue', description: 'True when past due and not completed', group: 'Dates' },
  { name: 'task.age_hours', description: 'Hours since the task was created', group: 'Dates' },
  { name: 'task.due_date', description: 'Due date', group: 'Dates' },
  { name: 'task.created_at', description: 'Creation timestamp', group: 'Dates' },
  { name: 'task.updated_at', description: 'Last update timestamp', group: 'Dates' },
  { name: 'task.completed_at', description: 'Completion timestamp', group: 'Dates' },
  { name: 'task.started_at', description: 'Start timestamp', group: 'Dates' },
  { name: 'task.accepted_at', description: 'Queue acceptance timestamp', group: 'Dates' },
  { name: 'task.estimated_completion', description: 'Estimated completion time', group: 'Dates' },
]

/**
 * Flat `task.*` keys for form-rule/expression scopes (which spread taskData
 * into a flat bag). One level of task.data is flattened as task.data.<field>.
 */
export function flattenTaskContext(task: Record<string, any>): Record<string, any> {
  const ctx: Record<string, any> = {}
  for (const key of ['id', 'title', 'description', 'status', 'priority', 'outcome', 'outcome_notes', 'assignee_id', 'assigner_id', 'actioned_by', 'actioned_on_behalf_of', 'due_date', 'progress_pct', 'acceptance_status', 'created_at', 'completed_at', 'is_overdue', 'age_hours', 'response_count', 'form_url']) {
    ctx[`task.${key}`] = task?.[key] ?? ''
  }
  const data = (task?.data ?? {}) as Record<string, any>
  ctx['task.data'] = data
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) continue
    ctx[`task.data.${k}`] = v ?? ''
  }
  ctx['task.responses'] = task?.responses ?? []
  ctx['task.outcome_counts'] = task?.outcome_counts ?? {}
  return ctx
}

/** Slug used for task.data.<field> keys (User Task field keys default to this slug of the label). */
export function taskDataFieldSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
