/**
 * The event stream from the terminal:
 *
 *   usertasks logs tail [--category workflow,task] [--type 'workflow.*'] [--severity warn]
 *                       [--workflow <id>] [--run <id>] [--since 15m] [-o json|text]
 *   usertasks logs export --since 1h [--until 10m] [filters] > events.ndjson
 *
 * `tail` follows GET /api/v1/events/stream (Server-Sent Events) and reconnects
 * with Last-Event-ID, so restarts of the server-side stream lose nothing.
 * Output is one line per event: `time severity type message` (text, default)
 * or the event JSON (NDJSON with -o json) for piping into other tools.
 * `export` pages GET /api/v1/events by cursor and always writes NDJSON.
 */

import { Option, type Command } from 'commander'
import type { UsertasksEvent } from '@usertasks/sdk'
import { CliUsageError } from '../exit-codes'
import type { Runtime } from '../runtime'

const SEVERITIES = ['debug', 'info', 'warn', 'error']
const EXPORT_PAGE_SIZE = 1000
const DURATION = /^(\d+)\s*(s|m|h|d|w)$/i
const DURATION_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }

/** Pin a relative time (`1h`) to an ISO timestamp once, so it doesn't slide between pages. */
export function pinTime(value: string, now: number = Date.now()): string {
  const match = DURATION.exec(value.trim())
  return match ? new Date(now - Number(match[1]) * DURATION_MS[match[2].toLowerCase()]).toISOString() : value.trim()
}

interface FilterOptions {
  category?: string
  type?: string
  severity?: string
  workflow?: string
  run?: string
  task?: string
  trace?: string
  since?: string
}

function addFilterOptions(command: Command): Command {
  return command
    .option('--category <list>', 'Categories, comma-separated: workflow, integration, agent, task, system, audit, security')
    .option('--type <list>', 'Event types or globs, comma-separated (e.g. "workflow.*", "*.failed")')
    .addOption(new Option('--severity <level>', 'Minimum severity').choices(SEVERITIES))
    .option('--workflow <id>', 'Only events of this workflow')
    .option('--run <id>', 'Only events of this workflow run')
    .option('--task <id>', 'Only events of this task')
    .option('--trace <id>', 'Only events with this trace id')
}

function filterQuery(opts: FilterOptions): Record<string, string> {
  const query: Record<string, string> = {}
  if (opts.category) query.category = opts.category
  if (opts.type) query.type = opts.type
  if (opts.severity) query.severity = opts.severity
  if (opts.workflow) query.workflow_id = opts.workflow
  if (opts.run) query.run_id = opts.run
  if (opts.task) query.task_id = opts.task
  if (opts.trace) query.trace_id = opts.trace
  return query
}

/** `time severity type message` (one line; newlines in the message flattened). */
export function formatEventLine(event: UsertasksEvent): string {
  const message = String(event.message ?? '').replace(/\s*[\r\n]+\s*/g, ' ')
  return `${event.occurred_at} ${event.severity.toUpperCase().padEnd(5)} ${event.type} ${message}`
}

function wantsJson(runtime: Runtime, command: Command): boolean {
  const raw = runtime.flags(command).output ?? runtime.io.env.USERTASKS_OUTPUT ?? ''
  return raw.trim().toLowerCase() === 'json'
}

/** Abort on Ctrl-C / SIGTERM so the command ends with exit code 0 (tests pass io.signal). */
function stopSignal(runtime: Runtime): { signal: AbortSignal; dispose: () => void } {
  if (runtime.io.signal) return { signal: runtime.io.signal, dispose: () => {} }
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return {
    signal: controller.signal,
    dispose: () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
    },
  }
}

export function registerLogCommands(program: Command, runtime: Runtime) {
  const logs = program.command('logs').description('Tail and export the event stream (workflow, integration, agent, task, system, audit and security events)')

  addFilterOptions(
    logs
      .command('tail')
      .description('Stream events live (Ctrl-C to stop); reconnects automatically without gaps'),
  )
    .option('--since <when>', 'Start from this ISO time or duration back (30s, 15m, 1h); default: from now')
    .option('--after <id>', 'Start after this event id')
    .addHelpText('after', [
      '',
      'Output: text lines `time severity type message` (default), or NDJSON with -o json.',
      'Audit and security events also need the settings.view permission.',
      'API: GET /api/v1/events/stream  (permission: observability.view; OAuth scope events:read)',
    ].join('\n'))
    .action(async (opts: FilterOptions & { after?: string }, self: Command) => {
      if (opts.after && !/^\d+$/.test(opts.after)) throw new CliUsageError('--after must be an event id')
      const json = wantsJson(runtime, self)
      const client = runtime.client(self)
      const { signal, dispose } = stopSignal(runtime)
      try {
        const stream = client.events.stream({
          ...filterQuery(opts),
          ...(opts.since ? { since: opts.since } : {}),
          ...(opts.after ? { after: opts.after } : {}),
          signal,
          onReconnect: ({ reason, after, delayMs, error }) => {
            if (reason !== 'error') return
            const why = error instanceof Error ? error.message : 'stream error'
            runtime.info(self, `warning: ${why}; reconnecting in ${Math.round(delayMs / 1000)}s${after ? ` (after ${after})` : ''}`)
          },
        })
        for await (const event of stream) {
          runtime.io.stdout.write(`${json ? JSON.stringify(event) : formatEventLine(event)}\n`)
        }
      } finally {
        dispose()
      }
    })

  addFilterOptions(
    logs
      .command('export')
      .description('Write past events as NDJSON (one event per line) to stdout'),
  )
    .option('--since <when>', 'From this ISO time or duration back (30s, 15m, 1h, 2d)')
    .option('--until <when>', 'Up to this ISO time or duration back')
    .option('--after <id>', 'Only events after this id (instead of --since)')
    .addHelpText('after', [
      '',
      'Example: usertasks logs export --since 1h --category workflow > events.ndjson',
      'Events are retained for 72 hours by default.',
      'API: GET /api/v1/events (cursor paged; permission: observability.view)',
    ].join('\n'))
    .action(async (opts: FilterOptions & { until?: string; after?: string }, self: Command) => {
      if (!opts.since && !opts.after) throw new CliUsageError('logs export needs --since (e.g. --since 1h) or --after <id>')
      if (opts.after && !/^\d+$/.test(opts.after)) throw new CliUsageError('--after must be an event id')
      const client = runtime.client(self)
      let count = 0
      for await (const event of client.events.iterate({
        ...filterQuery(opts),
        ...(opts.since ? { since: pinTime(opts.since) } : {}),
        ...(opts.until ? { until: pinTime(opts.until) } : {}),
        ...(opts.after ? { after: opts.after } : {}),
        limit: EXPORT_PAGE_SIZE,
      })) {
        runtime.io.stdout.write(`${JSON.stringify(event)}\n`)
        count++
      }
      runtime.info(self, `Exported ${count} event${count === 1 ? '' : 's'}.`)
    })
}
