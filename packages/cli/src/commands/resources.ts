/**
 * Generic runner: turns the generated command table into commander
 * commands (`usertasks <resource> <verb> [positional…] [flags]`).
 *
 *   - path params listed as `positional` → positional arguments (then body
 *     fields listed there, e.g. `workspace-theme apply-preset <preset_id>`)
 *   - other path params and query params → `--kebab-case <value>` flags
 *   - request body → `-f file|-` (JSON or YAML) and/or `--set key=value`
 *     (`key=@file` reads a file into a field, e.g. `--set html_body=@email.html`)
 *   - limit/offset list endpoints → global `--limit/--offset`, plus `--all`
 *   - cursor-paged lists (limit + after) → global `--limit`, `--after <cursor>`
 *   - resources with HTML fields (task descriptions) → plain text by default
 *     (`strip_html=true` + client-side stripping); `--html` shows the HTML
 *   - operations with an async variant → run as a background job and wait
 *     for its result (progress on stderr); `--no-wait` prints the job
 */

import { Option, type Command } from 'commander'
import type { QueryValue } from '@usertasks/sdk'
import { CliUsageError } from '../exit-codes'
import { buildBody, collect } from '../input'
import type { Runtime } from '../runtime'
import type { CommandSpec } from '../spec'
import { HTML_FIELDS, stripHtmlFields } from '../html'
import { uploadFileFlags, type UploadContext } from './files'

/**
 * Generated commands whose body takes Attachments values: `--attach
 * field=path` uploads into the right context and adds the file ids to
 * `<bodyKey>.<field>`.
 */
const FILE_TARGETS: Record<string, { bodyKey: string; context: (path: Record<string, string>, body: Record<string, unknown>) => UploadContext }> = {
  'forms submit': { bodyKey: 'values', context: (path) => ({ form_id: path.id }) },
  'workflows start': { bodyKey: 'variables', context: (_path, body) => ({ workflow_id: String(body.workflow_id ?? '') }) },
}

const camel = (flag: string) => flag.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())

function describeBody(spec: CommandSpec): string {
  if (!spec.body) return ''
  const lines = spec.body.fields.map((field) => {
    const meta = [field.type, field.required ? 'required' : undefined].filter(Boolean).join(', ')
    return `  ${field.name}${meta ? ` (${meta})` : ''}${field.description ? ` - ${field.description}` : ''}`
  })
  return [
    '',
    'Request body: -f <file|-> (JSON or YAML) and/or --set key=value / key:=<json> / key=@file (file text) / key:=@file (parsed)',
    ...(lines.length ? ['Body fields:', ...lines] : []),
  ].join('\n')
}

function parseInteger(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw new CliUsageError(`--${flag} must be a non-negative integer`)
  return n
}

/** Add `<parent> <verb>` for one operation (via .command() so exit/output overrides are inherited). */
export function addResourceCommand(parent: Command, spec: CommandSpec, runtime: Runtime): Command {
  const command = parent.command(spec.verb).description(spec.summary)
  for (const name of spec.positional) command.argument(`<${name}>`)
  for (const name of spec.bodyPositional ?? []) command.argument(`<${name}>`)
  for (const name of spec.pathFlags) command.requiredOption(`--${name.replace(/_/g, '-')} <value>`, `${name} path parameter`)
  const htmlFields = HTML_FIELDS[spec.resource]
  if (htmlFields) command.option('--html', `Show ${htmlFields.join('/')} as stored HTML (default: plain text)`)
  for (const param of spec.query) {
    if (param.name === 'strip_html') continue // driven by --html
    const option = new Option(`--${param.flag} <value>`, param.description ?? param.name)
    if (param.enum) option.choices(param.enum)
    if (param.required) option.makeOptionMandatory()
    command.addOption(option)
  }
  if (spec.body) command.option('--set <assignment>', 'Set a body field (repeatable): key=value, key:=<json>, key=@file (text), key:=@file (JSON/YAML)', collect, [])
  const fileTarget = FILE_TARGETS[`${spec.resource} ${spec.verb}`]
  if (fileTarget) command.option('--attach <field=path>', 'Upload a file into an Attachments field (repeatable; the field collects them)', collect, [])
  if (spec.async) command.option('--no-wait', 'Start a background job and print it instead of waiting (follow it with `usertasks jobs get <id>`)')
  if (spec.paginated) command.addHelpText('after', '\nPaging: --limit/--offset for one page, --all to fetch every page.')
  if (spec.cursor) command.addHelpText('after', '\nPaging: --limit for the page size; pass next_cursor as --after for the next page.')
  const help = [
    describeBody(spec),
    `\nAPI: ${spec.method} /api/v1${spec.path}${spec.permission ? `  (permission: ${spec.permission})` : ''}`,
  ].join('')
  command.addHelpText('after', help)

  command.action(async (...args: unknown[]) => {
    const self = args[args.length - 1] as Command
    const positionalValues = args.slice(0, spec.positional.length) as string[]
    const bodyValues = args.slice(spec.positional.length, spec.positional.length + (spec.bodyPositional?.length ?? 0)) as string[]
    const opts = self.opts() as Record<string, unknown>
    const flags = runtime.flags(self)

    const path: Record<string, string> = {}
    spec.positional.forEach((name, i) => (path[name] = positionalValues[i]))
    for (const name of spec.pathFlags) path[name] = String(opts[camel(name.replace(/_/g, '-'))])

    const query: Record<string, QueryValue> = {}
    for (const param of spec.query) {
      if (param.name === 'strip_html') continue
      const value = opts[camel(param.flag)]
      if (value !== undefined) query[param.name] = value as string
    }
    const keepHtml = Boolean(opts.html)
    if (!keepHtml && spec.query.some((param) => param.name === 'strip_html')) query.strip_html = 'true'
    const present = (data: unknown) => (htmlFields && !keepHtml ? stripHtmlFields(data, htmlFields) : data)
    if (spec.cursor) {
      const limit = parseInteger(flags.limit, 'limit')
      if (limit !== undefined) query.limit = limit
    }
    if (spec.paginated) {
      const limit = parseInteger(flags.limit, 'limit')
      const offset = parseInteger(flags.offset, 'offset')
      if (limit !== undefined) query.limit = limit
      if (offset !== undefined) query.offset = offset
    }

    let body = spec.body ? await buildBody(flags.file, (opts.set as string[]) ?? [], runtime.io.readStdin) : undefined
    if (spec.bodyPositional?.length) {
      const base = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
      body = { ...base, ...Object.fromEntries(spec.bodyPositional.map((name, i) => [name, bodyValues[i]])) }
    }

    if (spec.destructive) {
      const target = positionalValues.length ? ` ${positionalValues.join(' ')}` : ''
      if (!(await runtime.confirm(self, `${spec.verb} ${spec.resource}${target}?`))) throw new Error('Aborted.')
    }

    const client = runtime.client(self)
    const fileFlags = (opts.attach as string[] | undefined) ?? []
    if (fileTarget && fileFlags.length) {
      const base = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
      const target = base[fileTarget.bodyKey] && typeof base[fileTarget.bodyKey] === 'object' ? (base[fileTarget.bodyKey] as Record<string, unknown>) : {}
      const context = fileTarget.context(path, base)
      if (Object.values(context).some((v) => !v)) throw new CliUsageError('--attach needs the target id (the form id, or workflow_id in the body)')
      body = { ...base, [fileTarget.bodyKey]: { ...target, ...(await uploadFileFlags(client, context, fileFlags)) } }
    }
    if (spec.paginated && flags.all && spec.listKey) {
      const items: unknown[] = []
      // paginate() owns limit (page size); a given --offset is the starting row.
      const rest = { ...query }
      delete rest.limit
      for await (const item of client.paginate(spec.path, { path, query: rest, listKey: spec.listKey })) items.push(item)
      runtime.print(self, present(items))
      return
    }
    const requestOptions = {
      path,
      query,
      ...(body !== undefined ? { body } : spec.body?.required ? { body: {} } : {}),
      envelope: spec.envelope,
    }
    if (spec.async) {
      if (opts.wait === false) {
        const started = await client.startJob(spec.method, spec.path, requestOptions)
        runtime.print(self, started.job ? { job: started.job } : started.data)
        return
      }
      const data = await client.requestAndWait(spec.method, spec.path, { ...requestOptions, onProgress: (job) => runtime.info(self, jobProgressLine(job)) })
      runtime.print(self, present(data), { listKey: spec.listKey })
      return
    }
    const data = await client.request(spec.method, spec.path, requestOptions)
    runtime.print(self, present(data), { listKey: spec.listKey })
  })
  return command
}

/** One stderr line per progress change of a background job. */
export function jobProgressLine(job: { status: string; progress: number; message: string | null; title?: string }): string {
  const pct = job.status === 'running' && job.progress > 0 ? ` ${job.progress}%` : ''
  return `job ${job.status}${pct}${job.message ? ` — ${job.message}` : ''}`
}

/** Add one command group per resource, with a sub-command per verb. */
export function registerResourceCommands(program: Command, specs: readonly CommandSpec[], runtime: Runtime) {
  const groups = new Map<string, CommandSpec[]>()
  for (const spec of specs) groups.set(spec.resource, [...(groups.get(spec.resource) ?? []), spec])
  for (const [resource, group] of groups) {
    const parent = program.command(resource).description(`${resource} (${group.map((s) => s.verb).join(', ')})`)
    for (const spec of group) addResourceCommand(parent, spec, runtime)
  }
}
