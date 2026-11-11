/**
 * The Agent actions tasks for the person (server side): read a task's form,
 * save its values, complete it with one of its outcomes, accept / hold /
 * decline it from the queue. Offered with task help on every screen (the
 * task on screen is the default; any other task by id — find it with
 * find_active_tasks), and only while Settings → Agent → Advanced "Let the
 * Agent complete tasks (with confirmation)" is on for the person's profile;
 * reading (task_get_form) stays available when it is off.
 *
 *  task_get_form (read)          the form at a glance: every visible field
 *                                (label, type, required, read-only, options,
 *                                help, value as saved / prefilled — secrets
 *                                masked), the header, the outcome buttons
 *                                and the required fields still empty. The
 *                                panel shows it as an info card. Anyone who
 *                                can see the task (invited viewers too).
 *  task_save_form_values (write) draft values, through the task page's Save
 *                                services (validated, partial).
 *  task_complete (write)         an outcome, a comment and values, through
 *                                the same services as the task page's
 *                                outcome / form buttons.
 *  task_respond (write)          accept / hold / decline a queued task.
 *
 * Every write is a confirmation card first (lib/assistants/engine.ts): the
 * engine never runs it in the turn that asks for it, so a task is only
 * actioned when the person presses Confirm. Before a card is shown, the
 * same rules as the app are checked here (and again by the services when
 * the confirmed write runs):
 *  - who: lib/task-authz.ts — the assignee / a collaborator / a team member
 *    acts directly; someone in the assignee's manager chain, a manager of the
 *    workflow or a break-glass tasks.complete_any holder acts ON BEHALF with
 *    a reason (asked for when missing; break-glass is flagged in red);
 *    invited viewers and everyone else are refused with the reason;
 *  - required fields: completing with required fields still empty never
 *    shows a card — the model gets the list (label, type, options, help and
 *    how to ask: buttons, text, or "the person fills it in") and asks;
 *  - a queued task waiting for the person's acceptance: the card's action is
 *    "Accept and complete" (accepted first, then completed);
 *  - form buttons: a task completed with its form's buttons completes through
 *    the matching button (its after-submit actions run), and an outcome its
 *    buttons don't offer is refused; an external form is refused.
 * History and audit record the action as done via the Agent (and on behalf:
 * the assignee is notified, an audit row is written).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { ToolPrecheck, type AssistantToolDef } from '../engine'
import type { ServiceContext } from '@/lib/services/context'
import type { ConfirmCard, InfoCard, TaskActionCard } from '../types'
import { serviceRoleClient } from '@/lib/services/_shared'
import { canViewTask, describeTaskAccess, isWorkflowTask, type TaskAccessSummary } from '@/lib/task-authz'
import { htmlToPlainText } from '@/lib/html-sanitize'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { formForModel } from '../form-values'
import { coerceTaskValues, displayValue, formInfoRows, formProblems, matchOutcome, outcomeTone, taskFormFacts, taskFormSnapshot, type FormProblem } from '../task-form'

/* eslint-disable @typescript-eslint/no-explicit-any -- task rows and tool arguments are JSON */

export const TASK_ACTION_READ_TOOLS = ['task_get_form'] as const
export const TASK_ACTION_WRITE_TOOLS = ['task_save_form_values', 'task_complete', 'task_respond'] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOTE_MAX = 2000

export interface TaskActionDeps {
  /** The signed-in person (their permissions; the services re-check everything). */
  ctx: ServiceContext
  /** The task on screen (the default task_id). */
  taskId?: string | null
  /** Settings → Agent → Advanced "Let the Agent complete tasks": the write tools are offered. */
  canAct: boolean
  /** Service-role client (tenant-filtered reads); default serviceRoleClient(ctx). */
  db?: SupabaseClient
  /** "Next: …" for an outcome (get_process_context); test seam. */
  nextLine?: (taskId: string, outcome: string) => Promise<string | null>
}

/** Everything a task action needs to know, loaded fresh for the card and again for the run. */
interface Loaded {
  task: Record<string, any>
  access: TaskAccessSummary
  workflow: boolean
  assigneeName: string | null
  onBehalfName: string | null
  /** The person's own acceptance is still pending / on hold (queued): accept first. */
  awaitingMe: boolean
  /** The person is a collaborator on a collaborative task (their own task_assignees row). */
  collaborator: boolean
  outcomes: string[]
  names: Map<string, string>
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

async function namesOf(db: any, ids: string[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((v) => typeof v === 'string' && UUID.test(v)))]
  if (!list.length) return new Map()
  const { data } = await db.from('users').select('id, display_name, email').in('id', list.slice(0, 100))
  return new Map(((data ?? []) as any[]).map((u) => [String(u.id), String(u.display_name || u.email || 'Someone')]))
}

function refusal(l: Pick<Loaded, 'access' | 'assigneeName' | 'workflow'>): string {
  const who = l.assigneeName ?? 'the assignee'
  if (l.access.viewer) return `You were invited to view this task (read only): you can read it and comment, but only ${who} — or their manager, or a manager of the workflow, acting on their behalf — can action it.`
  if (l.access.unassigned) return 'Nobody is assigned to this task. Only an admin or a manager of the workflow can take it (or assign it to someone) before it can be actioned.'
  return `You can't action this task: it is assigned to ${who}, and you are not their manager, a manager of the workflow, or a holder of the break-glass permission. Only ${who} (or someone who manages them) can action it.`
}

export function taskActionTools({ ctx, taskId = null, canAct, db: injected, nextLine }: TaskActionDeps): AssistantToolDef[] {
  const agentCtx: ServiceContext = { ...ctx, via: 'agent' }
  const dbOf = async () => (injected ?? await serviceRoleClient(ctx)) as any

  const taskIdOf = (args: Record<string, any>): string => {
    const id = typeof args.task_id === 'string' && args.task_id.trim() ? args.task_id.trim() : taskId
    if (!id || !UUID.test(id)) throw new Error(taskId ? 'Unknown task id' : 'Give task_id (find the task with find_active_tasks by part of its title or the requester\'s name)')
    return id
  }
  const taskIdProp = { type: 'string', description: taskId ? 'The task (default: the task on screen)' : 'The task id (from find_active_tasks)' }

  /** The task, if the person can see it (404 otherwise — ids can't be probed), and how they may act. */
  const load = async (id: string): Promise<Loaded> => {
    const db = await dbOf()
    const { data: task } = await db.from('tasks').select('*').eq('id', id).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
    if (!task || !ctx.actorId) throw new Error('Task not found')
    const params = { tenantId: ctx.tenantId, taskId: id, actorId: ctx.actorId, permissions: ctx.permissions }
    // Break-glass holders (tasks.complete_any) may act on any task in the workspace, as the services allow.
    if (!ctx.permissions?.has('tasks.complete_any') && !(await canViewTask(db, params))) throw new Error('Task not found (or you can\'t see it)')
    const access = await describeTaskAccess(db, params)
    if (!access) throw new Error('Task not found')
    const collaborative = task.assignment_mode === 'collaborative'
    let mine: any = null
    if (collaborative) {
      const { data } = await db.from('task_assignees').select('user_id, acceptance_status').eq('task_id', id).eq('user_id', ctx.actorId).maybeSingle()
      mine = data ?? null
    }
    const acceptance = collaborative ? (mine?.acceptance_status ?? null) : task.assignee_id === ctx.actorId ? task.acceptance_status ?? null : null
    const names = await namesOf(db, [task.assignee_id, access.onBehalfOf].filter(Boolean))
    const outcomesRaw = Array.isArray(task.available_outcomes) ? (task.available_outcomes as unknown[]).map(String).filter(Boolean) : []
    return {
      task,
      access,
      workflow: isWorkflowTask(task),
      assigneeName: task.assignee_id ? names.get(String(task.assignee_id)) ?? null : null,
      onBehalfName: access.onBehalfOf ? names.get(String(access.onBehalfOf)) ?? null : null,
      awaitingMe: access.mode === 'assignee' && (acceptance === 'pending' || acceptance === 'held'),
      collaborator: Boolean(mine),
      outcomes: outcomesRaw.length ? outcomesRaw.slice(0, 20) : ['completed'],
      names,
    }
  }

  /** Throws the reason when the person can't act on it now (closed, read only, nobody's task). */
  const requireActable = (l: Loaded) => {
    if (l.access.closed) throw new Error(`This task is already closed (${l.task.status}${l.task.outcome ? `, outcome ${l.task.outcome}` : ''}) — nothing to action.`)
    if (l.access.mode === 'none') throw new Error(refusal(l))
  }
  const onBehalf = (l: Loaded) => l.access.mode === 'on_behalf' || l.access.mode === 'break_glass'

  /** On behalf: the reason is required — the model asks for it (no card until then). */
  const requireNote = (l: Loaded, args: Record<string, any>): string | null => {
    if (!onBehalf(l)) return null
    const note = text(args.on_behalf_note, NOTE_MAX)
    if (note) return note
    const who = l.onBehalfName ?? 'the assignee'
    const basis = l.access.basis === 'workflow_manager' ? 'as a manager of the workflow' : l.access.basis === 'break_glass' ? 'with the break-glass permission (tasks.complete_any) — recorded as break-glass' : 'as their manager'
    throw new ToolPrecheck(`A reason is required: this task is ${who}'s, so you would act on their behalf (${basis}).`, {
      needs: 'on_behalf_note',
      on_behalf_of: who,
      basis: l.access.basis ?? null,
      next_step: `Ask the person why they are acting for ${who} (one short sentence; it is recorded and ${who} is notified), then call the tool again with on_behalf_note.`,
    })
  }

  const behalfLines = (l: Loaded, note: string | null) => {
    if (!onBehalf(l)) return { lines: [] as string[], warnings: [] as string[] }
    const who = l.onBehalfName ?? 'the assignee'
    const breakGlass = l.access.mode === 'break_glass'
    return {
      lines: [`On behalf of ${who}${l.access.basis === 'workflow_manager' ? ' (as a manager of the workflow)' : breakGlass ? ' (break-glass)' : ' (as their manager)'}`, `Why you are acting for them: ${note ?? '(none)'}`],
      warnings: [
        breakGlass
          ? `Break-glass: you are not in ${who}'s manager chain. Your tasks.complete_any permission allows this; it is recorded as break-glass in the task history and audit log, and ${who} is notified.`
          : `Recorded as done by you on behalf of ${who}, via the Agent; ${who} is notified.`,
      ],
    }
  }

  const changed = (id: string, title: string) => ({ type: 'changed' as const, kind: 'task', id, title, href: `/tasks/${id}`, action: 'updated' as const })

  /** The model's values, checked against the stored form (throws the problems). */
  const valuesOf = (l: Loaded, raw: unknown) => {
    if (raw === undefined || raw === null || (typeof raw === 'object' && !Object.keys(raw as object).length)) return { values: {}, display: {} as Record<string, string> }
    const snapshot = taskFormSnapshot(l.task.metadata)
    const coerced = coerceTaskValues(snapshot, raw)
    if (coerced.skipped.length) {
      throw new ToolPrecheck('Some values can\'t be used', { skipped: coerced.skipped, next_step: 'Fix or drop these values (ask the person when unsure — never make values up); fields the Agent can\'t fill are filled in by the person on the task page.' })
    }
    return { values: coerced.values, display: coerced.display }
  }

  /** The values on the card: label, value, changed (differs from what the task holds). */
  const cardValues = (l: Loaded, values: Record<string, unknown>) => {
    const facts = taskFormFacts(l.task.metadata)
    return facts.fields.filter((f) => Object.prototype.hasOwnProperty.call(values, f.key)).map((f) => ({
      label: f.label || f.key,
      value: displayValue(f, values[f.key], l.names),
      changed: JSON.stringify(values[f.key] ?? null) !== JSON.stringify(facts.values[f.key] ?? null),
    }))
  }

  /** How it completes: a form button (the matching one), the outcome buttons, or not here (external form). */
  const completionPath = async (l: Loaded, outcome: string): Promise<{ buttonId: string | null; button: any | null }> => {
    const meta = (l.task.metadata ?? {}) as Record<string, any>
    if (typeof meta.form_url === 'string' && meta.form_url) throw new Error('This task is completed in an external form — open the task and complete it there.')
    const { submittingButtonKeys } = await import('@/lib/forms/form-state')
    const hasBar = Array.isArray(meta.form_buttons) || submittingButtonKeys(normalizeTaskFields(meta.fields)).length > 0
    if (!hasBar || !l.workflow) return { buttonId: null, button: null }
    const { normalizeFormButtons, isSubmittingButton } = await import('@/lib/forms/buttons')
    const buttons = normalizeFormButtons(meta.form_buttons).filter((b) => isSubmittingButton(b) && !b.hidden)
    const button = buttons.find((b) => b.kind === 'outcome' && (b.outcome ?? b.label).toLowerCase() === outcome.toLowerCase())
      ?? (outcome === l.outcomes[0] ? buttons.find((b) => b.kind === 'submit') : undefined)
    if (!button) throw new Error(`This task completes with its form's buttons, and none of them completes with “${outcome}”. Its buttons: ${buttons.map((b) => b.label).join(', ') || '(none)'}.`)
    return { buttonId: button.id, button }
  }

  const next = async (id: string, outcome: string, workflow: boolean): Promise<string | null> => {
    if (!workflow) return null
    try {
      if (nextLine) return await nextLine(id, outcome)
      const { processContext } = await import('./process')
      const out: any = await processContext({ db: await dbOf(), tenantId: ctx.tenantId, userId: ctx.actorId!, permissions: ctx.permissions ?? new Set() }, { kind: 'task', taskId: id })
      const path = (out?.process?.next ?? []).find((n: any) => String(n.outcome).toLowerCase() === outcome.toLowerCase())
      const line = nextStepLine(Array.isArray(path?.steps) ? path.steps : [], outcome)
      return line ? `Next: ${line}` : null
    } catch {
      return null
    }
  }

  /** Everything task_complete checks before its card (and again before it runs). */
  const prepareCompletion = async (args: Record<string, any>) => {
    const id = taskIdOf(args)
    const l = await load(id)
    requireActable(l)
    const outcome = l.outcomes.length === 1 && !text(args.outcome, 200) ? l.outcomes[0] : matchOutcome(l.outcomes, args.outcome)
    if (!outcome) throw new Error(`Give one of this task's outcomes: ${l.outcomes.join(', ')}. Use the outcome the person asked for — never choose one for them.`)
    const path = await completionPath(l, outcome)
    const { values, display } = valuesOf(l, args.values)
    // The bar buttons this completion counts as (as recordTaskResponse judges it): rules aimed at other buttons don't apply.
    const { submissionButtonIds } = await import('@/lib/forms/buttons')
    const buttonIds = submissionButtonIds((l.task.metadata ?? {}).form_buttons, { buttonId: path.buttonId, outcome, outcomes: l.outcomes })
    const problems = formProblems(l.task.metadata, values, { buttonIds })
    if (problems.length) {
      const required = problems.filter((p) => p.problem === 'required_empty')
      throw new ToolPrecheck(required.length ? `Required fields are still empty: ${required.map((p) => p.label).join(', ')}` : 'Some field values are not valid', {
        missing_required: required.map(problemForModel),
        invalid: problems.filter((p) => p.problem === 'invalid').map(problemForModel),
        next_step: 'No card was shown. Tell the person exactly which fields are needed (label, type, options, help text) and ask for them: ask_user buttons for ask_with "buttons", a plain question for "text"; "person_fills" fields are filled in by the person on the task page. Never invent values. Then propose the values and call task_complete again with them.',
      })
    }
    const note = requireNote(l, args)
    const comment = text(args.comment, 10_000)
    return { id, l, outcome, path, values, display, note, comment }
  }

  const tools: AssistantToolDef[] = [{
    name: 'task_get_form',
    description: 'Read a task\'s form and details: the header and description, every visible field (label, type, required, read-only, options, help text, value as saved or prefilled; secrets masked), the outcome buttons, which required fields are still empty, and whether the person can action it (directly, on behalf, queued). The panel shows it as a compact card. Call it when the person asks what a task or request contains, and always before completing a task.',
    parameters: { type: 'object', properties: { task_id: taskIdProp }, required: [] },
    mode: 'read',
    label: () => 'Reading the task form',
    run: async (args, env) => {
      const id = taskIdOf(args)
      const l = await load(id)
      const meta = (l.task.metadata ?? {}) as Record<string, any>
      const facts = taskFormFacts(meta)
      const userIds = facts.fields.filter((f) => f.type === 'user').map((f) => String(facts.values[f.key] ?? ''))
      const names = new Map([...l.names, ...(await namesOf(await dbOf(), userIds))])
      const rows = formInfoRows(meta, { names })
      const problems = formProblems(meta, {}, { buttonIds: [] })
      const required = problems.filter((p) => p.problem === 'required_empty')
      const header = meta.form_layout?.header && typeof meta.form_layout.header === 'object' ? meta.form_layout.header : null
      const description = l.task.description ? htmlToPlainText(l.task.description).slice(0, 4_000) : null
      const canActNow = !l.access.closed && l.access.mode !== 'none'
      const notes = [
        required.length ? `${required.length} required field${required.length === 1 ? ' is' : 's are'} empty: ${required.map((p) => p.label).join(', ')}` : null,
        l.access.closed ? `Closed${l.task.outcome ? ` — ${l.task.outcome}` : ''}` : null,
        !l.access.closed && l.access.mode === 'none' ? (l.access.viewer ? 'Read only for you (invited viewer)' : 'Read only for you') : null,
        !l.access.closed && onBehalf(l) ? `${l.access.mode === 'break_glass' ? 'Break-glass: you' : 'You'} can act on behalf of ${l.onBehalfName ?? 'the assignee'} (a reason is required)` : null,
        l.awaitingMe ? 'Waiting for you to accept it' : null,
        typeof meta.form_url === 'string' && meta.form_url ? 'Completed in an external form' : null,
      ].filter((n): n is string => Boolean(n))
      const card: InfoCard = {
        id: env.toolCallId,
        title: String(l.task.title ?? 'Task'),
        subtitle: [l.assigneeName ? `With ${l.assigneeName}` : null, l.task.due_date ? `due ${String(l.task.due_date).slice(0, 10)}` : null, meta.form_ref?.name ? String(meta.form_ref.name) : null].filter(Boolean).join(' · ') || null,
        href: `/tasks/${id}`,
        rows: rows.length ? rows : [{ label: 'Form', value: 'No form fields' }],
        outcomes: l.access.closed ? [] : l.outcomes.map((o) => ({ label: o, tone: outcomeTone(o) })),
        notes,
      }
      env.emit({ type: 'info_card', ...card })
      const model = formForModel(taskFormSnapshot(meta, { title: String(l.task.title ?? ''), readOnly: !canActNow }))
      return {
        result: {
          shown_to_person: 'The panel shows the form as a card (label → value). Summarise briefly; do not repeat every row.',
          task: {
            id, title: l.task.title, status: l.task.status, closed: l.access.closed, outcome: l.task.outcome ?? null,
            description, header: header ? { title: header.title ?? null, description: header.description ?? header.subtitle ?? null } : null,
            assignee: l.assigneeName, due_date: l.task.due_date ?? null, workflow_task: l.workflow,
            outcome_options: l.outcomes,
          },
          form: model,
          display_values: rows,
          required_empty: required.map(problemForModel),
          invalid: problems.filter((p) => p.problem === 'invalid').map(problemForModel),
          person_can_action: canActNow && canAct,
          how: l.access.closed ? 'closed' : l.access.mode === 'none' ? (l.access.viewer ? 'read_only_viewer' : 'read_only') : onBehalf(l) ? `on_behalf_of ${l.onBehalfName ?? 'the assignee'}${l.access.mode === 'break_glass' ? ' (break-glass)' : ''} — a reason is required` : l.awaitingMe ? 'assignee — queued: accept and complete' : 'assignee',
          ...(canAct ? {} : { note: 'Task actions are turned off for the Agent here: the person completes it with the task\'s own buttons.' }),
        },
      }
    },
  }]
  if (!canAct) return tools

  tools.push(
    {
      name: 'task_save_form_values',
      description: 'Save draft values into a task\'s form (like the task page\'s Save — nothing is submitted, the task stays open). Values: field key (or label) → value as text (numbers as digits, dates YYYY-MM-DD, yes/no true/false, a choice as its option). Only values the person gave you. Shown as a confirmation card first.',
      parameters: {
        type: 'object',
        properties: {
          task_id: taskIdProp,
          values: { type: 'object', description: 'Field key → value', additionalProperties: true },
          on_behalf_note: { type: 'string', description: 'When the task is someone else\'s and the person acts for them: why' },
        },
        required: ['values'],
      },
      mode: 'write',
      label: () => 'Saving the task\'s form',
      confirm: async (args) => {
        const id = taskIdOf(args)
        const l = await load(id)
        requireActable(l)
        const { values } = valuesOf(l, args.values)
        if (!Object.keys(values).length) throw new Error('Give the values to save (field key → value)')
        const behalf = behalfLines(l, text(args.on_behalf_note, NOTE_MAX))
        const vals = cardValues(l, values)
        const task: TaskActionCard = { action: 'save', task_title: String(l.task.title ?? 'Task'), href: `/tasks/${id}`, values: vals, on_behalf_of: onBehalf(l) ? l.onBehalfName : null, basis: onBehalf(l) ? l.access.basis ?? null : null }
        return {
          title: `Save values in “${l.task.title ?? 'Task'}”`,
          lines: [...vals.map((v) => `${v.label}: ${v.value}${v.changed ? ' (changed)' : ''}`), ...behalf.lines],
          warnings: ['A draft: the task is not submitted.', ...behalf.warnings],
          confirm_label: 'Save values',
          danger: l.access.mode === 'break_glass',
          task,
        }
      },
      run: async (args, env) => {
        const id = taskIdOf(args)
        const l = await load(id)
        requireActable(l)
        const { values } = valuesOf(l, args.values)
        const note = text(args.on_behalf_note, NOTE_MAX)
        if (l.workflow) {
          const { saveWorkflowTaskValues } = await import('@/lib/services/task-actions')
          const saved = await saveWorkflowTaskValues(agentCtx, id, values, { onBehalf: onBehalf(l), onBehalfNote: note, via: 'agent' })
          if (!saved.success) return { result: { error: 'Some values were refused', errors: saved.errors }, ok: false }
        } else {
          await saveStandardValues(agentCtx, await dbOf(), l.task, values)
        }
        env.emit(changed(id, String(l.task.title ?? 'Task')))
        const left = formProblems(l.task.metadata, values).filter((p) => p.problem === 'required_empty')
        return { result: { saved: Object.keys(values), still_required: left.map(problemForModel), note: 'Saved as a draft; the task is still open.' } }
      },
    },
    {
      name: 'task_complete',
      description: 'Complete (approve, decline…) a task with one of ITS outcomes, an optional comment (outcome note) and optional field values (key → value as text). Only when the person explicitly asked for this outcome. Checks the required fields first: if any are empty no card is shown and you get the list to ask for. Acting for someone else (their manager, a manager of the workflow, break-glass) needs on_behalf_note — ask the person for the reason. A queued task is accepted and completed in one step. Shown as a confirmation card; it runs only when the person confirms.',
      parameters: {
        type: 'object',
        properties: {
          task_id: taskIdProp,
          outcome: { type: 'string', description: 'One of the task\'s outcome options, as the person asked (e.g. Approved)' },
          comment: { type: 'string', description: 'Optional comment / outcome note (recorded with the outcome)' },
          values: { type: 'object', description: 'Optional field key → value to submit with it (values the person gave)', additionalProperties: true },
          on_behalf_note: { type: 'string', description: 'Required when acting for the assignee: why (ask the person)' },
        },
        required: ['outcome'],
      },
      mode: 'write',
      label: (args) => `Completing the task${typeof args.outcome === 'string' ? ` (${args.outcome})` : ''}`,
      confirm: async (args) => {
        const p = await prepareCompletion(args)
        const { l, outcome } = p
        const title = String(l.task.title ?? 'Task')
        const vals = cardValues(l, p.values)
        const nextText = await next(p.id, outcome, l.workflow)
        const behalf = behalfLines(l, p.note)
        const takesOwnership = Boolean(l.access.unassigned)
        const task: TaskActionCard = {
          action: 'complete', task_title: title, href: `/tasks/${p.id}`, outcome, tone: p.path.button?.style === 'danger' ? 'danger' : outcomeTone(outcome),
          comment: p.comment, values: vals, on_behalf_of: onBehalf(l) ? l.onBehalfName ?? 'the assignee' : null, basis: onBehalf(l) ? l.access.basis ?? null : null,
          on_behalf_note: p.note, accept_first: l.awaitingMe, next: nextText,
        }
        const card: Omit<ConfirmCard, 'tool_call_id' | 'tool'> = {
          title: `${l.awaitingMe ? 'Accept and complete' : 'Complete'} “${title}”`,
          lines: [
            `Outcome: ${outcome}`,
            ...(p.comment ? [`Comment: ${p.comment}`] : []),
            ...vals.map((v) => `${v.label}: ${v.value}${v.changed ? ' (changed)' : ''}`),
            ...behalf.lines,
            ...(nextText ? [nextText] : []),
          ],
          warnings: [
            ...(l.awaitingMe ? ['The task is waiting for you to accept it: confirming accepts it, then completes it.'] : []),
            ...(takesOwnership ? ['Nobody is assigned: you take ownership first (recorded in the history).'] : []),
            ...(p.path.button ? [`Completes with the form's “${p.path.button.label}” button (its after-submit actions run).`] : []),
            ...behalf.warnings,
          ],
          confirm_label: l.awaitingMe ? 'Accept and complete' : 'Confirm',
          danger: l.access.mode === 'break_glass',
          task,
        }
        return card
      },
      run: async (args, env) => {
        let p
        try {
          p = await prepareCompletion(args)
        } catch (error) {
          if (error instanceof ToolPrecheck) return { result: { error: `Not completed: ${error.message}`, ...error.result }, ok: false }
          throw error
        }
        const { l, outcome } = p
        const title = String(l.task.title ?? 'Task')
        const db = await dbOf()
        if (l.awaitingMe) await respond(agentCtx, db, l, 'accepted', null, null)
        let result: Record<string, unknown>
        if (l.workflow) {
          const { completeWorkflowTaskAction } = await import('@/lib/services/task-actions')
          const done = await completeWorkflowTaskAction(agentCtx, p.id, {
            outcome, notes: p.comment, values: Object.keys(p.values).length ? p.values : null, buttonId: p.path.buttonId,
            onBehalf: onBehalf(l), onBehalfNote: p.note,
          }, { via: 'agent', notifyAssigner: true })
          const { kickQueueProcessor } = await import('@/lib/process-queue')
          kickQueueProcessor()
          if (done.status === 'invalid') return { result: { error: 'Not completed: some fields need attention', errors: done.errors }, ok: false }
          if (p.path.button) await runButton(agentCtx, db, l, p.path.button)
          result = done.status === 'waiting'
            ? { status: 'waiting', responses: done.responses, needed: done.needed, note: `Your response is recorded; the task completes when ${done.needed} people have responded.` }
            : {
                status: 'completed', outcome: done.outcome, workflow_resumed: done.workflow_resumed, ...(done.workflow_error ? { workflow_error: done.workflow_error } : {}),
                acted_as: done.acted_as, on_behalf_of: done.on_behalf_of ? l.onBehalfName : null,
              }
          if (done.status === 'completed') {
            const { nextStepForResponse } = await import('@/lib/services/task-completion-screen')
            const step = await nextStepForResponse(ctx, p.id).catch(() => null)
            if (step) result.next = { state: step.state, steps: step.steps.map((s) => `${s.name}${s.assignees.length ? ` — with ${s.assignees.join(', ')}` : s.team ? ` — with the ${s.team} team` : ''}`) }
          }
        } else {
          if (Object.keys(p.values).length) await saveStandardValues(agentCtx, db, l.task, p.values)
          const { completeStandardTask } = await import('@/lib/services/tasks')
          const done = await completeStandardTask(agentCtx, p.id, {
            outcome, notes: p.comment, via: 'agent',
            onBehalf: onBehalf(l) ? { of: l.access.onBehalfOf, note: p.note, basis: l.access.basis ?? null } : null,
          })
          result = { status: done.status, outcome: done.outcome }
        }
        env.emit(changed(p.id, title))
        return { result: { ...result, note: 'Done: the task was actioned on the person\'s confirmation (recorded as via the Agent). Tell them the outcome and what happens next in one or two sentences.' } }
      },
    },
    {
      name: 'task_respond',
      description: 'Respond to a queued task: accept it (it becomes theirs to work on), hold it (keep it queued for later) or decline it (it is cancelled). Hold and decline need a reason. Only when the person asked. Shown as a confirmation card first.',
      parameters: {
        type: 'object',
        properties: {
          task_id: taskIdProp,
          response: { type: 'string', enum: ['accept', 'hold', 'decline'] },
          reason: { type: 'string', description: 'Why (required to hold or decline; shown to the person who assigned it)' },
          on_behalf_note: { type: 'string', description: 'When acting for the assignee: why (ask the person)' },
        },
        required: ['response'],
      },
      mode: 'write',
      label: (args) => (args.response === 'hold' ? 'Putting the task on hold' : args.response === 'decline' ? 'Declining the task' : 'Accepting the task'),
      confirm: async (args) => {
        const p = await prepareRespond(args)
        const behalf = behalfLines(p.l, p.note)
        const verb = p.response === 'accepted' ? 'Accept' : p.response === 'held' ? 'Hold' : 'Decline'
        const task: TaskActionCard = {
          action: p.response === 'accepted' ? 'accept' : p.response === 'held' ? 'hold' : 'decline', task_title: String(p.l.task.title ?? 'Task'), href: `/tasks/${p.id}`,
          comment: p.reason, tone: p.response === 'accepted' ? 'success' : p.response === 'held' ? 'warning' : 'danger',
          on_behalf_of: onBehalf(p.l) ? p.l.onBehalfName : null, basis: onBehalf(p.l) ? p.l.access.basis ?? null : null, on_behalf_note: p.note,
        }
        return {
          title: `${verb} “${p.l.task.title ?? 'Task'}”`,
          lines: [`Response: ${verb}`, ...(p.reason ? [`Reason: ${p.reason}`] : []), ...behalf.lines],
          warnings: [
            ...(p.response === 'rejected' ? ['Declining cancels the task; the person who assigned it is notified.'] : p.response === 'held' ? ['It stays in the queue; the person who assigned it is notified.'] : []),
            ...behalf.warnings,
          ],
          confirm_label: verb,
          danger: p.response === 'rejected' || p.l.access.mode === 'break_glass',
          task,
        }
      },
      run: async (args, env) => {
        const p = await prepareRespond(args)
        await respond(agentCtx, await dbOf(), p.l, p.response, p.reason, p.note)
        env.emit(changed(p.id, String(p.l.task.title ?? 'Task')))
        return { result: { response: p.response, note: 'Done on the person\'s confirmation.' } }
      },
    },
  )

  async function prepareRespond(args: Record<string, any>) {
    const id = taskIdOf(args)
    const l = await load(id)
    requireActable(l)
    const response = args.response === 'hold' ? 'held' as const : args.response === 'decline' || args.response === 'reject' ? 'rejected' as const : args.response === 'accept' ? 'accepted' as const : null
    if (!response) throw new Error('response must be accept, hold or decline')
    const reason = text(args.reason, 2000)
    if (response !== 'accepted' && !reason) throw new ToolPrecheck(`A reason is required to ${response === 'held' ? 'hold' : 'decline'} a task.`, { needs: 'reason', next_step: 'Ask the person for the reason, then call task_respond again with it.' })
    const note = requireNote(l, args)
    if (!onBehalf(l) && l.access.mode === 'assignee' && response === 'accepted' && !l.awaitingMe) throw new Error('This task is not waiting for acceptance — it is already yours to work on.')
    return { id, l, response, reason, note }
  }

  return tools
}

/**
 * The first concrete step of an outcome's path (get_process_context), in one
 * line: branch headers that only restate this outcome are dropped, branches
 * for another outcome skipped, and a real condition kept as "If …, …".
 */
export function nextStepLine(steps: readonly unknown[], outcome: string): string | null {
  const o = outcome.trim().toLowerCase()
  let skipIndent: number | null = null
  let condition: string | null = null
  for (const raw of steps) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    const indent = raw.length - raw.trimStart().length
    const text = raw.trim().replace(/^[-•]\s*/, '')
    if (skipIndent !== null && indent > skipIndent) continue
    skipIndent = null
    if (text.endsWith(':')) {
      const about = /outcome (?:is|equals|=)\s*“?"?([^”"():]+)/i.exec(text)?.[1]?.trim().toLowerCase()
      if (about && about !== o) { skipIndent = indent; continue }
      if (!about) condition = text.slice(0, -1).replace(/\s*\([^)]*\)\s*$/, '')
      continue
    }
    // "Human step “X” (task “…”): assigned to Y — choices: …" → "“X”, with Y".
    const step = text.replace(/^Human step “([^”]+)”(?: \(task “[^”]*”\))?: assigned to (.+?)(?: — .*)?$/, '“$1”, with $2').replace(/ \((?:requester|assignee|manager) id\)/g, '')
    const line = condition && /^if\b/i.test(condition) ? `${condition}, ${step.charAt(0).toLowerCase()}${step.slice(1)}` : step
    return line.slice(0, 240)
  }
  return null
}

/** A problem as the model reads it (what to ask, how). */
function problemForModel(p: FormProblem) {
  return { key: p.key, label: p.label, type: p.type, ...(p.options ? { options: p.options } : {}), ...(p.help_text ? { help_text: p.help_text } : {}), ...(p.placeholder ? { placeholder: p.placeholder } : {}), error: p.error, ask_with: p.ask_with }
}

/** A standard task's draft values (the task page's Save for standard tasks), on the person's own reach. */
async function saveStandardValues(ctx: ServiceContext, db: any, task: Record<string, any>, values: Record<string, unknown>) {
  const { requireTaskReach } = await import('@/lib/services/tasks')
  await requireTaskReach(ctx, String(task.id))
  const { mergeTaskFieldValuesChecked } = await import('@/lib/forms/task-values')
  const metadata = (task.metadata ?? {}) as Record<string, unknown>
  const merged = await mergeTaskFieldValuesChecked(db, String(task.tenant_id), metadata, values, { partial: true, taskId: String(task.id) })
  if (Object.keys(merged.errors).length) throw new Error(`Some values were refused: ${Object.values(merged.errors).join('; ')}`)
  const { error } = await db.from('tasks').update({ metadata: { ...metadata, template_values: merged.templateValues } }).eq('id', task.id).eq('tenant_id', task.tenant_id)
  if (error) throw new Error(error.message)
  task.metadata = { ...metadata, template_values: merged.templateValues }
  const { writeLifecycleEvent } = await import('@/lib/lifecycle-events')
  await writeLifecycleEvent({ supabase: db, tenantId: String(task.tenant_id), taskId: String(task.id), eventType: 'task_data_saved', actorId: ctx.actorId, metadata: { fields: Object.keys(values), via: 'agent' } })
}

/**
 * Accept / hold / decline: a collaborator answers for themselves (their own
 * row, as the task page does); the assignee of a standard task likewise; a
 * workflow task (and anyone acting on behalf) through the shared service.
 */
async function respond(ctx: ServiceContext, db: any, l: Loaded, response: 'accepted' | 'held' | 'rejected', reason: string | null, note: string | null) {
  const behalf = l.access.mode === 'on_behalf' || l.access.mode === 'break_glass'
  const task = l.task
  if (l.workflow && (behalf || !l.collaborator)) {
    const { respondToWorkflowTask } = await import('@/lib/services/task-actions')
    await respondToWorkflowTask(ctx, String(task.id), response, { comment: reason, onBehalf: behalf, onBehalfNote: note, via: 'agent' })
    const { kickQueueProcessor } = await import('@/lib/process-queue')
    kickQueueProcessor()
    return
  }
  if (behalf) throw new Error('Only the person assigned to this task can accept, hold or decline it.')
  const now = new Date().toISOString()
  if (l.collaborator) {
    await db.from('task_assignees').update({ acceptance_status: response, acceptance_comment: reason, accepted_at: response === 'accepted' ? now : null }).eq('task_id', task.id).eq('user_id', ctx.actorId)
  } else {
    if (task.assignee_id !== ctx.actorId) throw new Error('Only the person assigned to this task can accept, hold or decline it.')
    const updates: Record<string, unknown> = { acceptance_status: response, acceptance_comment: reason }
    if (response === 'accepted') { updates.accepted_at = now; if (['todo', 'draft', 'blocked', ''].includes(String(task.status ?? ''))) updates.status = 'in_progress' }
    if (response === 'rejected') updates.status = 'cancelled'
    await db.from('tasks').update(updates).eq('id', task.id).eq('tenant_id', task.tenant_id)
  }
  const { writeLifecycleEvent } = await import('@/lib/lifecycle-events')
  await writeLifecycleEvent({ supabase: db, tenantId: String(task.tenant_id), taskId: String(task.id), eventType: `task_${response}`, actorId: ctx.actorId, metadata: { action: response, comment: reason, via: 'agent' } })
  if (task.assigner_id && task.assigner_id !== ctx.actorId) {
    const { data: me } = await db.from('users').select('display_name').eq('id', ctx.actorId).maybeSingle()
    const label = response === 'accepted' ? 'accepted' : response === 'held' ? 'put on hold' : 'rejected'
    await db.from('notifications').insert({
      user_id: task.assigner_id, tenant_id: task.tenant_id, type: `task_${response}`, title: `Task ${label}`,
      body: `${me?.display_name || 'Someone'} has ${label} "${task.title}"${reason ? `: "${reason}"` : ''}`, task_id: task.id,
    })
  }
}

/** A form button's after-submit actions (the task page's form-button path), with the values as stored. Never fails the completion. */
async function runButton(ctx: ServiceContext, db: any, l: Loaded, button: any) {
  try {
    const { data: after } = await db.from('tasks').select('metadata').eq('id', l.task.id).eq('tenant_id', l.task.tenant_id).maybeSingle()
    const meta = (after?.metadata ?? l.task.metadata ?? {}) as Record<string, any>
    const { runButtonActions } = await import('@/lib/services/form-submissions')
    const formRef = (meta.form_ref ?? {}) as { form_id?: string; name?: string }
    await runButtonActions(ctx, db, {
      button,
      values: (meta.template_values ?? {}) as Record<string, unknown>,
      form: { id: formRef.form_id ?? String(l.task.id), name: formRef.name ?? 'Task form' },
      submissionId: null,
      taskId: String(l.task.id),
      fields: normalizeTaskFields(meta.fields),
      layout: meta.form_layout,
    })
  } catch (error) {
    console.warn('[assistants] form button actions after an Agent completion failed:', error instanceof Error ? error.message : error)
  }
}
