/**
 * Hand-written task niceties on top of the generated `tasks` commands:
 *
 *   usertasks tasks complete <id> [--outcome approved] [--notes "…"] [--set field=value …]
 *                                 [--on-behalf --note "why"]
 *   usertasks tasks team [--indirect] [--overdue] [--sla-breached]
 *
 * is `POST /tasks/{id}/action` with action "complete" (records the outcome,
 * applies the completion rule and resumes the workflow); each --set becomes
 * a User Task field value (`field=value`, `field:=<json>`, `field=@file`).
 * Workflow tasks are completed by their assignee; their manager acts on
 * behalf with --on-behalf and a --note. `tasks team` is the manager view
 * (`GET /tasks?scope=reports`).
 */

import type { Command } from 'commander'
import { applyAssignments, collect } from '../input'
import type { Runtime } from '../runtime'

export function registerTaskCommands(program: Command, runtime: Runtime) {
  const tasks = program.commands.find((command) => command.name() === 'tasks') ?? program.command('tasks')
  tasks
    .command('complete <id>')
    .description('Complete a task with an outcome and field values (resumes its workflow)')
    .option('--outcome <value>', 'Outcome, e.g. approved / rejected (default completed)')
    .option('--notes <text>', 'Outcome notes')
    .option('--set <field=value>', 'Task field value (repeatable): field=value, field:=<json>, field=@file', collect, [])
    .option('--on-behalf', 'Act for the assignee (you are their manager, or hold tasks.complete_any)')
    .option('--note <text>', 'Why you are acting on behalf (required with --on-behalf)')
    .addHelpText('after', '\nAPI: POST /api/v1/tasks/{id}/action  (permission: tasks.complete)')
    .action(async (id: string, opts: { outcome?: string; notes?: string; set: string[]; onBehalf?: boolean; note?: string }, self: Command) => {
      const values = opts.set.length ? await applyAssignments({}, opts.set) : undefined
      const data = await runtime.client(self).request('POST', '/tasks/{id}/action', {
        path: { id },
        body: {
          action: 'complete',
          ...(opts.outcome ? { outcome: opts.outcome } : {}),
          ...(opts.notes ? { outcome_notes: opts.notes } : {}),
          ...(values && Object.keys(values as object).length ? { values } : {}),
          ...(opts.onBehalf ? { on_behalf: true } : {}),
          ...(opts.note ? { on_behalf_note: opts.note } : {}),
        },
      })
      runtime.print(self, data)
    })

  tasks
    .command('team')
    .description('Open tasks of your reports with workload per person (the manager view)')
    .option('--indirect', 'Include reports of reports')
    .option('--overdue', 'Only overdue tasks')
    .option('--sla-breached', 'Only tasks whose SLA is breached')
    .option('--assignee <id>', 'One report only')
    .addHelpText('after', '\nAPI: GET /api/v1/tasks?scope=reports  (permission: tasks.view_own)')
    .action(async (opts: { indirect?: boolean; overdue?: boolean; slaBreached?: boolean; assignee?: string }, self: Command) => {
      const data = await runtime.client(self).request('GET', '/tasks', {
        query: {
          scope: 'reports',
          ...(opts.indirect ? { indirect: 'true' } : {}),
          ...(opts.overdue ? { overdue: 'true' } : {}),
          ...(opts.slaBreached ? { sla_breached: 'true' } : {}),
          ...(opts.assignee ? { assignee_id: opts.assignee } : {}),
        },
      })
      runtime.print(self, data)
    })
}
