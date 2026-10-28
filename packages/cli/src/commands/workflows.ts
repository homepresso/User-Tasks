/**
 * Hand-written `workflows instances` and `workflows migrate-instances`,
 * replacing the generated commands (same names and positionals, so the
 * command table stays the API's):
 *
 *   usertasks workflows instances <id> [--status active|waiting_for_event|paused] [--version-id <v>]
 *
 * is GET /workflows/{id}/instances, printed as a table of instance, version,
 * current node, waiting since and assignee (raw data with -o json/yaml).
 *
 *   usertasks workflows migrate-instances <id> --to <version>
 *     [--run <run-id> …| --from <version> | --all]
 *     [--map <source-node>=<target-node> …] [--target <node>] [--dry-run]
 *
 * is POST /workflows/{id}/instances/migrate. It always plans first (dry run)
 * and prints the plan as a table; without --dry-run it then asks for
 * confirmation (skipped with --yes or without a terminal) and migrates,
 * printing one result row per instance. -o json/yaml prints the raw API data.
 */

import type { Command } from 'commander'
import { Option } from 'commander'
import { CliUsageError } from '../exit-codes'
import { collect } from '../input'
import { grid } from '../output'
import type { Runtime } from '../runtime'
import { registerWorkflowRunCommand } from './workflow-run'

interface PlanItem {
  run_id: string
  ok: boolean
  blocked_reason: string | null
  warnings: string[]
  from_version_number: number | null
  source_node_id: string | null
  source_node_label: string | null
  target_node_id: string | null
  target_node_label: string | null
  target_node_type: string | null
  close: { open_task_ids: string[]; queued_job_ids: string[] }
  create: { creates_task: boolean; defaulted_variables: string[] }
}

interface MigrationData {
  dry_run: boolean
  plan: { to_version: { id: string; version_number: number | null }; items: PlanItem[]; summary: { total: number; ready: number; blocked: number; with_warnings: number }; truncated: boolean }
  results: Array<{ run_id: string; ok: boolean; conflict?: boolean; error?: string; new_run_id?: string; new_status?: string; target_node_id?: string }>
  summary: { migrated: number; skipped: number; failed: number }
}

const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : '-')
const node = (id: string | null, label: string | null) => (id ? (label && label !== id ? `${label} (${id})` : id) : '-')

interface InstancesData {
  instances: Array<{ run_id: string; title: string | null; status: string; version_number: number | null; current_node_id: string | null; current_node_label: string | null; waiting_since: string | null; open_task: { assignee_name: string | null; team_name: string | null } | null }>
  total: number
  versions: Array<{ version_number: number | null; is_published: boolean; instances: number }>
  on_older_versions: number
}

/** Live instances as a table plus per-version counts. */
export function renderInstances(data: InstancesData): string {
  const rows = data.instances.map((i) => [
    short(i.run_id),
    i.title ?? '-',
    i.version_number != null ? `v${i.version_number}` : 'draft',
    node(i.current_node_id, i.current_node_label),
    i.status === 'paused' ? 'paused' : 'waiting',
    i.waiting_since ? i.waiting_since.replace('T', ' ').slice(0, 16) : '-',
    i.open_task ? i.open_task.assignee_name ?? i.open_task.team_name ?? 'unassigned' : '-',
  ])
  const table = rows.length ? grid(['RUN', 'TITLE', 'VERSION', 'CURRENT NODE', 'STATE', 'WAITING SINCE', 'ASSIGNEE'], rows) : 'No live instances.'
  const counts = data.versions.map((v) => `${v.version_number != null ? `v${v.version_number}` : 'draft'}${v.is_published ? ' (published)' : ''}: ${v.instances}`).join(', ')
  return `${table}\n\n${data.total} live instance${data.total === 1 ? '' : 's'}${data.on_older_versions ? `, ${data.on_older_versions} on older versions` : ''}${counts ? ` — ${counts}` : ''}.`
}

/** Parse repeated `source=target` node mappings. */
export function parseNodeMap(pairs: readonly string[]): Record<string, string> | undefined {
  if (!pairs.length) return undefined
  const map: Record<string, string> = {}
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq <= 0 || eq === pair.length - 1) throw new CliUsageError(`--map expects source=target, got "${pair}"`)
    map[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
  }
  return map
}

/** The plan as a readable table plus a summary line. */
export function renderMigrationPlan(data: MigrationData): string {
  const version = `v${data.plan.to_version.version_number ?? '?'}`
  const rows = data.plan.items.map((item) => [
    short(item.run_id),
    item.from_version_number != null ? `v${item.from_version_number}` : '-',
    node(item.source_node_id, item.source_node_label),
    item.ok ? `${node(item.target_node_id, item.target_node_label)}${item.create.creates_task ? ' [new task]' : ''}` : '-',
    item.ok ? `close${item.close.open_task_ids.length ? ` +${item.close.open_task_ids.length} task` : ''}${item.close.queued_job_ids.length ? ` +${item.close.queued_job_ids.length} job` : ''}` : 'BLOCKED',
    item.ok ? item.warnings.join('; ') || '-' : item.blocked_reason ?? '',
  ])
  const table = rows.length ? grid(['RUN', 'FROM', 'CURRENT NODE', `TARGET NODE (${version})`, 'ACTION', 'NOTES'], rows) : 'No live instances match.'
  const { total, ready, blocked, with_warnings: warned } = data.plan.summary
  const lines = [table, '', `Plan: ${ready} of ${total} instance${total === 1 ? '' : 's'} ready to migrate to ${version}${blocked ? `, ${blocked} blocked` : ''}${warned ? `, ${warned} with warnings` : ''}.`]
  if (data.plan.truncated) lines.push('More live instances match than one request handles (500): run again for the rest.')
  return lines.join('\n')
}

/** Per-instance results of a migration. */
export function renderMigrationResults(data: MigrationData): string {
  const rows = data.results.map((r) => [
    short(r.run_id),
    r.ok ? 'migrated' : r.conflict ? 'conflict' : 'skipped',
    r.new_run_id ?? '-',
    r.target_node_id ?? '-',
    r.new_status ?? '-',
    r.error ?? '',
  ])
  const table = rows.length ? grid(['RUN', 'RESULT', 'NEW RUN', 'TARGET NODE', 'NEW STATUS', 'NOTES'], rows) : 'Nothing to migrate.'
  const { migrated, skipped, failed } = data.summary
  return `${table}\n\nMigrated ${migrated}, skipped ${skipped}, failed ${failed}.`
}

export function registerWorkflowCommands(program: Command, runtime: Runtime) {
  const workflows = program.commands.find((command) => command.name() === 'workflows') ?? program.command('workflows')
  // Replace the generated commands with the friendlier ones.
  for (const name of ['instances', 'migrate-instances']) {
    const generated = workflows.commands.findIndex((command) => command.name() === name)
    if (generated >= 0) (workflows.commands as Command[]).splice(generated, 1)
  }

  registerWorkflowRunCommand(workflows, runtime)

  workflows
    .command('instances')
    .argument('<id>')
    .description('List live instances (waiting or paused runs) with their current node and version')
    .addOption(new Option('--status <status>', 'active (default) = waiting and paused').choices(['active', 'waiting_for_event', 'paused']))
    .option('--version-id <version>', 'Only instances on this version')
    .addHelpText('after', '\nPaging: --limit/--offset (up to 500 per page).\n\nAPI: GET /api/v1/workflows/{id}/instances  (permission: workflows.view_runs)')
    .action(async (id: string, opts: { status?: string; versionId?: string }, self: Command) => {
      const flags = runtime.flags(self)
      const query: Record<string, string> = {}
      if (opts.status) query.status = opts.status
      if (opts.versionId) query.version_id = opts.versionId
      if (flags.limit) query.limit = String(flags.limit)
      if (flags.offset) query.offset = String(flags.offset)
      const data = await runtime.client(self).request('GET', '/workflows/{id}/instances', { path: { id }, query }) as InstancesData
      if (['json', 'yaml'].includes(runtime.settings(self).output)) runtime.print(self, data)
      else runtime.io.stdout.write(`${renderInstances(data)}\n`)
    })

  workflows
    .command('migrate-instances')
    .argument('<id>')
    .description('Migrate live instances to another version (plan first; --dry-run only plans)')
    .requiredOption('--to <version>', 'Target version id')
    .option('--run <run-id>', 'Instance to migrate (repeatable)', collect, [])
    .option('--from <version>', 'Migrate every live instance on this version')
    .option('--map <source=target>', 'Continue instances at <source> node on <target> node (repeatable)', collect, [])
    .option('--target <node>', 'Target node for instances not in --map (default: the node with the same id)')
    .option('--dry-run', 'Only print the plan')
    .addHelpText('after', [
      '',
      'Choose instances with --run (repeatable), --from <version>, or the global --all (every live instance not on --to).',
      'Each instance is closed (status migrated, open task cancelled) and a new run starts on --to at its target node.',
      '',
      'API: POST /api/v1/workflows/{id}/instances/migrate  (permission: workflows.manage_runs)',
    ].join('\n'))
    .action(async (id: string, opts: { to: string; run: string[]; from?: string; map: string[]; target?: string; dryRun?: boolean }, self: Command) => {
      const all = Boolean(runtime.flags(self).all)
      if (!opts.run.length && !opts.from && !all) throw new CliUsageError('Choose instances: --run <run-id>, --from <version> or --all')
      const body = {
        to_version_id: opts.to,
        ...(opts.run.length ? { run_ids: opts.run } : {}),
        ...(opts.from ? { from_version_id: opts.from } : {}),
        ...(all ? { all_active: true } : {}),
        ...(parseNodeMap(opts.map) ? { node_map: parseNodeMap(opts.map) } : {}),
        ...(opts.target ? { default_target_node_id: opts.target } : {}),
      }
      const client = runtime.client(self)
      const tabular = !['json', 'yaml'].includes(runtime.settings(self).output)
      const plan = await client.request('POST', '/workflows/{id}/instances/migrate', { path: { id }, body: { ...body, dry_run: true } }) as MigrationData

      if (opts.dryRun) {
        if (tabular) runtime.io.stdout.write(`${renderMigrationPlan(plan)}\n`)
        else runtime.print(self, plan)
        return
      }
      if (tabular) runtime.io.stderr.write(`${renderMigrationPlan(plan)}\n\n`)
      if (!plan.plan.summary.ready) {
        runtime.info(self, 'Nothing to migrate.')
        if (!tabular) runtime.print(self, plan)
        return
      }
      const version = `v${plan.plan.to_version.version_number ?? '?'}`
      if (!(await runtime.confirm(self, `Migrate ${plan.plan.summary.ready} instance${plan.plan.summary.ready === 1 ? '' : 's'} to ${version}?`))) throw new Error('Aborted.')
      // Only the instances the plan cleared, so a run that came live in between is not swept in.
      const runIds = plan.plan.items.filter((item) => item.ok).map((item) => item.run_id)
      const result = await client.request('POST', '/workflows/{id}/instances/migrate', {
        path: { id },
        body: { to_version_id: body.to_version_id, run_ids: runIds, ...(body.node_map ? { node_map: body.node_map } : {}), ...(body.default_target_node_id ? { default_target_node_id: body.default_target_node_id } : {}), dry_run: false },
      }) as MigrationData
      if (tabular) runtime.io.stdout.write(`${renderMigrationResults(result)}\n`)
      else runtime.print(self, result)
    })
}
