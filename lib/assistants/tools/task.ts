/**
 * The Agent's task help tools (server side). The task and its history are read as
 * the signed-in person (session client: RLS decides what they can see) and
 * passed to the model as untrusted data. Drafts and suggestions are events
 * the browser shows; there is deliberately no tool that completes, approves,
 * rejects or escalates a task, or posts a comment. Taking ownership,
 * reassigning and claiming (confirmed writes) live in ./task-assign.ts.
 */
import type { AssistantToolDef } from '../engine'
import type { FormSnapshot } from '../types'
import { formTools } from './form'

export interface TaskContext {
  id: string
  title: string
  description: string | null
  status: string
  priority: string | null
  due_date: string | null
  outcomes: string[]
  assignee: string | null
  assigner: string | null
  /** How the person may act (lib/task-authz describeTaskAccess). */
  mode: 'assignee' | 'on_behalf' | 'break_glass' | 'none'
  closed: boolean
  on_behalf_of: string | null
  workflow_task: boolean
}

export type TaskEvent = { type: string; by: string | null; at: string; message?: string | null; outcome?: string | null }

/** Whether the person can act on the task right now (fill its fields, choose an outcome). */
export function taskCanAct(task: TaskContext): boolean {
  return !task.closed && task.mode !== 'none'
}

/** The task as the model sees it (inside the untrusted context block). */
export function taskForModel(task: TaskContext): Record<string, unknown> {
  return {
    title: task.title,
    description: task.description ? task.description.slice(0, 8_000) : null,
    status: task.status,
    priority: task.priority,
    due_date: task.due_date,
    outcome_options: task.outcomes,
    assignee: task.assignee,
    assigned_by: task.assigner,
    person_can_act: taskCanAct(task),
    acting_on_behalf_of: task.mode === 'on_behalf' || task.mode === 'break_glass' ? task.on_behalf_of ?? 'the assignee' : null,
    closed: task.closed,
  }
}

export function taskTools(task: TaskContext, snapshot: FormSnapshot | null, loadHistory: () => Promise<TaskEvent[]>, options: { canPropose?: boolean } = {}): AssistantToolDef[] {
  const canAct = taskCanAct(task)
  const tools: AssistantToolDef[] = [
    {
      name: 'get_task_history',
      description: 'Read the task\'s comments and activity (newest first): who did what and when, with comment text.',
      parameters: { type: 'object', properties: {}, required: [] },
      mode: 'read',
      label: () => 'Reading the comments and activity',
      run: async () => ({ result: { events: (await loadHistory()).slice(0, 40) } }),
    },
    {
      name: 'draft_comment',
      description: 'Show the person a draft comment (or an outcome note) they can copy or post themselves. You cannot post it.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The draft text' },
          kind: { type: 'string', enum: ['comment', 'outcome_note'], description: 'A comment for the task thread, or a note to go with the outcome' },
        },
        required: ['text'],
      },
      mode: 'read',
      label: () => 'Drafting',
      run: async (args, env) => {
        const text = String(args.text ?? '').trim().slice(0, 5_000)
        if (!text) return { result: { error: 'The draft is empty' }, ok: false }
        env.emit({ type: 'draft', id: env.toolCallId, kind: args.kind === 'outcome_note' ? 'outcome_note' : 'comment', text })
        return { result: { shown_to_person: true, note: 'The person sees the draft and decides whether to use it.' } }
      },
    },
  ]
  if (canAct && task.outcomes.length) {
    tools.push({
      name: 'suggest_outcome',
      description: `Suggest which outcome the person might choose, with your reasoning. They decide and choose it themselves — this never completes the task. Options: ${task.outcomes.join(', ')}.`,
      parameters: {
        type: 'object',
        properties: {
          outcome: { type: 'string', enum: task.outcomes, description: 'One of the task\'s outcome options' },
          reason: { type: 'string', description: 'Why, in one or two sentences' },
        },
        required: ['outcome', 'reason'],
      },
      mode: 'read',
      label: () => 'Suggesting an outcome',
      run: async (args, env) => {
        const outcome = task.outcomes.find((o) => o.toLowerCase() === String(args.outcome ?? '').trim().toLowerCase())
        if (!outcome) return { result: { error: `Not an outcome of this task. Options: ${task.outcomes.join(', ')}` }, ok: false }
        env.emit({ type: 'outcome_suggestion', id: env.toolCallId, outcome, reason: String(args.reason ?? '').slice(0, 1_000) })
        return { result: { shown_to_person: true, note: 'The person decides; the task is not completed.' } }
      },
    })
  }
  // The task's form: read always (what the person sees), propose only when they can act (and may fill forms).
  if (snapshot) tools.push(...formTools(snapshot, { canEdit: canAct && options.canPropose !== false }))
  return tools
}
