/**
 * Hand-written `workflows run`: start a workflow with its input parameters.
 *
 *   usertasks workflows run <id> [--input key=value …] [-f inputs.json] [--wait] [--priority <n>] [--task <task-id>]
 *
 * Reads the input schema (GET /workflows/{id}/inputs), merges values from
 * -f (JSON/YAML object, or - for stdin) and --input (which wins), coerces
 * each by its field type (number, boolean, json, …), and asks on the
 * terminal for missing required inputs. Without a terminal, missing required
 * inputs are listed and the command exits 2 without starting anything.
 * Then POST /workflows/start: queued by default (prints the job), or with
 * --wait run now and print the run's status and outputs. The generated
 * `workflows start` (the raw endpoint) is unchanged.
 */

import type { Command } from 'commander'
import { CliExit, CliUsageError, EXIT } from '../exit-codes'
import { collect, readBodyFile } from '../input'
import { grid } from '../output'
import type { Runtime } from '../runtime'

export interface InputField {
  key: string
  label: string
  type: string
  required: boolean
  default: unknown
  description: string | null
  options: Array<{ value: string; label: string }> | null
}

export interface InputSchema {
  workflow_id: string
  workflow_name: string
  is_active: boolean
  published: boolean
  version_number: number | null
  fields: InputField[]
}

interface StartResult {
  mode: 'sync' | 'async'
  run_id?: string | null
  job_id?: string
  status?: string
  error?: string
  node_results?: Record<string, unknown>
  warnings?: string[]
}

const empty = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

/** Coerce a command-line string to the field's type (the server validates again). */
export function coerceInput(field: InputField | undefined, raw: string): unknown {
  if (!field) return raw
  const text = raw.trim()
  switch (field.type) {
    case 'number': {
      if (text === '' || !Number.isFinite(Number(text))) throw new CliUsageError(`${field.key}: "${raw}" is not a number`)
      return Number(text)
    }
    case 'boolean': {
      const lower = text.toLowerCase()
      if (['true', '1', 'yes', 'y', 'on'].includes(lower)) return true
      if (['false', '0', 'no', 'n', 'off'].includes(lower)) return false
      throw new CliUsageError(`${field.key}: "${raw}" is not true or false`)
    }
    case 'json': {
      try {
        return JSON.parse(raw)
      } catch {
        throw new CliUsageError(`${field.key}: not valid JSON`)
      }
    }
    case 'select': {
      if (field.options?.length && !field.options.some((o) => o.value === raw)) {
        throw new CliUsageError(`${field.key}: "${raw}" is not one of ${field.options.map((o) => o.value).join(', ')}`)
      }
      return raw
    }
    default:
      return raw
  }
}

/** Parse repeated `key=value` pairs, coercing declared inputs by type. */
export function parseInputPairs(pairs: readonly string[], fields: readonly InputField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq <= 0) throw new CliUsageError(`--input expects key=value, got "${pair}"`)
    const key = pair.slice(0, eq).trim()
    out[key] = coerceInput(fields.find((f) => f.key === key), pair.slice(eq + 1))
  }
  return out
}

/** Required inputs with neither a value nor a default. */
export function missingRequired(fields: readonly InputField[], values: Record<string, unknown>): InputField[] {
  return fields.filter((f) => f.required && empty(values[f.key]) && empty(f.default))
}

const describeField = (f: InputField) =>
  `${f.key} (${f.type}${f.type === 'select' && f.options?.length ? `: ${f.options.map((o) => o.value).join('|')}` : ''})${f.description ? ` — ${f.description}` : ''}`

/** Run outcome for the terminal. */
export function renderStart(result: StartResult, workflowName: string): string {
  const lines: string[] = []
  if (result.mode === 'async') {
    lines.push(`Queued "${workflowName}": job ${result.job_id}${result.run_id ? `, run ${result.run_id}` : ''}`)
    lines.push('Follow it with `usertasks queue list` or `usertasks runs list`.')
  } else {
    lines.push(`Run ${result.run_id ?? '-'} of "${workflowName}": ${result.status}`)
    if (result.error) lines.push(`Error: ${result.error}`)
    const steps = Object.entries(result.node_results ?? {})
    if (steps.length) {
      lines.push('')
      lines.push(grid(['STEP', 'OUTPUT'], steps.map(([node, out]) => {
        const text = JSON.stringify(out) ?? ''
        return [node, text.length > 100 ? `${text.slice(0, 97)}...` : text]
      })))
    }
  }
  for (const warning of result.warnings ?? []) lines.push(`warning: ${warning}`)
  return lines.join('\n')
}

export function registerWorkflowRunCommand(workflows: Command, runtime: Runtime) {
  workflows
    .command('run')
    .argument('<id>', 'Workflow id')
    .description('Run a workflow with its inputs (prompts for missing required inputs on a terminal)')
    .option('--input <key=value>', 'Input value, coerced by the input type (repeatable)', collect, [])
    .option('--wait', 'Run now and wait for the result (default: queue in the background)')
    .option('--priority <n>', 'Queue priority 0-100 for background runs (default 50)')
    .option('--task <task-id>', 'Associate the run with a task')
    .addHelpText('after', [
      '',
      'Inputs: -f <file> (JSON/YAML object of inputs, - for stdin), then --input key=value (wins).',
      'List them with `usertasks workflows inputs <id>`. Without a terminal, missing required inputs exit 2.',
      '',
      'Examples:',
      '  usertasks workflows run <id> --input customer=Acme --input amount=120 --wait',
      '  usertasks workflows run <id> -f inputs.json --priority 80',
      '',
      'API: GET /api/v1/workflows/{id}/inputs, POST /api/v1/workflows/start  (permission: workflows.activate)',
    ].join('\n'))
    .action(async (id: string, opts: { input: string[]; wait?: boolean; priority?: string; task?: string }, self: Command) => {
      const flags = runtime.flags(self) as { file?: string; quiet?: boolean }
      let priority: number | undefined
      if (opts.priority !== undefined) {
        priority = Number(opts.priority)
        if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new CliUsageError('--priority must be a whole number from 0 to 100')
      }

      const client = runtime.client(self)
      const schema = await client.request('GET', '/workflows/{id}/inputs', { path: { id } }) as InputSchema
      if (!schema.published) runtime.info(self, `Note: "${schema.workflow_name}" has not been published; the run uses the draft.`)

      let fromFile: Record<string, unknown> = {}
      if (flags.file) {
        const doc = await readBodyFile(flags.file, () => runtime.io.readStdin())
        if (doc !== undefined && (typeof doc !== 'object' || doc === null || Array.isArray(doc))) throw new CliUsageError(`${flags.file} must hold an object of inputs`)
        const object = (doc ?? {}) as Record<string, unknown>
        // Accept a start body too ({ variables: {...} }).
        const declared = new Set(schema.fields.map((f) => f.key))
        fromFile = object.variables && typeof object.variables === 'object' && !declared.has('variables') ? object.variables as Record<string, unknown> : object
      }
      const values: Record<string, unknown> = { ...fromFile, ...parseInputPairs(opts.input, schema.fields) }

      const missing = missingRequired(schema.fields, values)
      if (missing.length) {
        if (!runtime.io.stdinIsTTY || !runtime.io.prompt) {
          runtime.io.stderr.write(`error: missing required input${missing.length === 1 ? '' : 's'} for "${schema.workflow_name}":\n${missing.map((f) => `  - ${describeField(f)}`).join('\n')}\n  pass them with --input key=value or -f inputs.json\n`)
          throw new CliExit(EXIT.usage)
        }
        for (const field of missing) {
          for (let attempt = 0; ; attempt++) {
            const answer = await runtime.io.prompt(`${field.label} [${describeField(field)}]: `)
            if (empty(answer)) {
              runtime.io.stderr.write(`${field.key} is required.\n`)
            } else {
              try {
                values[field.key] = coerceInput(field, answer)
                break
              } catch (error) {
                runtime.io.stderr.write(`${(error as Error).message}\n`)
              }
            }
            if (attempt >= 2) throw new CliUsageError(`No value for required input ${field.key}`)
          }
        }
      }

      const result = await client.request('POST', '/workflows/start', {
        body: {
          workflow_id: id,
          variables: values,
          async: !opts.wait,
          ...(priority !== undefined ? { priority } : {}),
          ...(opts.task ? { task_id: opts.task } : {}),
        },
      }) as StartResult

      if (['json', 'yaml'].includes(runtime.settings(self).output)) runtime.print(self, result)
      else runtime.io.stdout.write(`${renderStart(result, schema.workflow_name)}\n`)
      if (result.mode === 'sync' && result.status === 'failed') throw new CliExit(EXIT.error)
    })
}
