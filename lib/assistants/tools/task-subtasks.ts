/**
 * The Agent's subtask tool (server side): break a task into subtasks — title
 * plus optional subtitle, description, estimate, due date, priority and tags
 * each. A WRITE tool: the engine shows a confirmation card listing what will
 * be added under which task and adds them only after the person confirms.
 * It calls the same service as the task page (lib/services/tasks
 * addSubtask) with the person's own ServiceContext, so the same rule
 * applies: anyone who can work on the open task (workflow tasks included —
 * subtasks never complete or resume the workflow).
 */
import type { AssistantToolDef } from '../engine'
import type { ServiceContext } from '@/lib/services/context'
import { addSubtask, listSubtasks } from '@/lib/services/tasks'
import { SUBTASK_PRIORITY_VALUES_LIST, validateSubtaskInput, type SubtaskInput } from '@/lib/tasks/subtask-input'

/* eslint-disable @typescript-eslint/no-explicit-any -- tool arguments are JSON */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const TASK_SUBTASK_TOOLS = ['task_add_subtasks'] as const
const MAX_PER_CALL = 10

function hours(minutes: number): string {
  const h = minutes / 60
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
}

function inputsOf(args: Record<string, any>): SubtaskInput[] {
  const list = Array.isArray(args.subtasks) ? args.subtasks : []
  if (!list.length) throw new Error('Give at least one subtask (subtasks: [{ title, … }])')
  if (list.length > MAX_PER_CALL) throw new Error(`At most ${MAX_PER_CALL} subtasks at a time`)
  return list.map((item: any, index: number) => {
    const input: SubtaskInput = {
      title: item?.title, subtitle: item?.subtitle, description: item?.description,
      estimated_effort_minutes: item?.estimated_effort_minutes, due_date: item?.due_date, priority: item?.priority, tags: item?.tags,
    }
    const checked = validateSubtaskInput(input)
    if (!checked.ok) throw new Error(`Subtask ${index + 1}: ${Object.values(checked.errors).join('; ')}`)
    return input
  })
}

export function taskSubtaskTools({ ctx, taskId = null }: { ctx: ServiceContext; taskId?: string | null }): AssistantToolDef[] {
  const agentCtx: ServiceContext = { ...ctx, via: 'agent' }
  const taskIdOf = (args: Record<string, any>): string => {
    const id = typeof args.task_id === 'string' && args.task_id.trim() ? args.task_id.trim() : taskId
    if (!id || !UUID.test(id)) throw new Error(taskId ? 'Unknown task id' : 'Give task_id (find it with find_active_tasks)')
    return id
  }
  return [{
    name: 'task_add_subtasks',
    description: `Add subtasks under a task (the task on screen by default) — e.g. "break this into steps". Each: title, and optionally subtitle (short summary), description, estimated_effort_minutes, due_date (ISO), priority (default: the task's) and tags. Up to ${MAX_PER_CALL} at a time. Anyone who can work on the open task may add them, workflow tasks included (subtasks never complete or move the workflow). Shown as a confirmation card first.`,
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: taskId ? 'The parent task (default: the task on screen)' : 'The parent task id' },
        subtasks: {
          type: 'array',
          maxItems: MAX_PER_CALL,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              subtitle: { type: 'string' },
              description: { type: 'string', description: 'Plain text or simple HTML' },
              estimated_effort_minutes: { type: 'integer', description: 'Whole minutes (90 = 1.5h)' },
              due_date: { type: 'string', description: 'yyyy-mm-dd' },
              priority: { type: 'string', enum: [...SUBTASK_PRIORITY_VALUES_LIST] },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['title'],
          },
        },
      },
      required: ['subtasks'],
    },
    mode: 'write',
    label: () => 'Adding subtasks',
    confirm: async (args) => {
      const id = taskIdOf(args)
      const inputs = inputsOf(args)
      // Reach + permission checked here too, so a refusal comes back before the card.
      const list = await listSubtasks(ctx, id).catch(() => { throw new Error('Task not found') })
      if (!list.can_add) throw new Error('You can\'t add subtasks to this task (it is closed, too deeply nested, or you can only view it)')
      const db = ctx.supabase as any
      const { data: parent } = await db.from('tasks').select('title').eq('id', id).maybeSingle()
      return {
        title: `Add ${inputs.length === 1 ? 'a subtask' : `${inputs.length} subtasks`} to “${String(parent?.title ?? 'the task')}”`,
        lines: inputs.map((input) => [
          String(input.title).trim(),
          input.subtitle ? `— ${input.subtitle}` : '',
          input.estimated_effort_minutes ? `· ${hours(Number(input.estimated_effort_minutes))}` : '',
          input.due_date ? `· due ${String(input.due_date).slice(0, 10)}` : '',
        ].filter(Boolean).join(' ')),
        warnings: ['They go to the task\'s assignee and count toward its progress.'],
        confirm_label: inputs.length === 1 ? 'Add subtask' : `Add ${inputs.length} subtasks`,
      }
    },
    run: async (args, env) => {
      const id = taskIdOf(args)
      const inputs = inputsOf(args)
      const added = []
      for (const input of inputs) added.push(await addSubtask(agentCtx, id, input))
      env.emit({ type: 'changed', kind: 'task', id, title: `${added.length} subtask${added.length === 1 ? '' : 's'} added`, href: `/tasks/${id}`, action: 'updated' })
      return { result: { added: added.map((s) => ({ id: s.id, title: s.title })), note: 'Done: the subtasks are on the task.' } }
    },
  }]
}
