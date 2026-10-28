/**
 * `usertasks packages …` — authoring commands (next to commands/packages.ts):
 *
 *   packages assets [text] [--type workflow,data_table] [--tag t] [--owner me]
 *                   [--updated-since 7d] [--sort updated] [--package p] [--after c | --all]
 *                                                    search every packageable asset
 *   packages create <name> [--from <ref>…] [--search <text> [--type t]] [--description …]
 *                   [--readme <file>] [--slug s] [--author a] [--rows <table>…]
 *   packages add <package> [<ref>…] [--search <text> [--type t]] [--without-dependencies]
 *                   [--rows <table>…]
 *   packages show <package>                           metadata, items (and why), requirements, versions
 *   packages set-data <package> <table> rows|schema   per data table: schema only or schema + rows
 *
 * A <ref> is <type>:<id> (workflow:3fa8…), a bare id (a workflow), or a name
 * (<type>:<name>, or just the name of a workflow), resolved through
 * GET /packages/assets. `--search` lists matches and, on a terminal, asks
 * which to use (numbers / ranges / `a` for all shown); without a terminal a
 * single (or single exact-name) match is used, otherwise it exits 2 with the
 * candidates.
 */

import { readFileSync } from 'node:fs'
import { Option, type Command } from 'commander'
import { CliUsageError } from '../exit-codes'
import { buildBody, collect } from '../input'
import { grid } from '../output'
import type { Runtime } from '../runtime'

export const ASSET_TYPES = ['workflow', 'workflow_activity', 'data_table', 'integration', 'connector', 'decision_table', 'email_template', 'agent', 'report', 'role', 'mcp_server', 'retention_policy', 'log_destination', 'form', 'form_theme'] as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface Ref { type: string; id: string }
export interface AssetHit extends Ref {
  name: string
  label: string
  description: string | null
  updated_at: string | null
  tags: string[]
  matched_reference?: string
  in_package?: 'root' | 'manual' | 'dependency' | 'excluded' | null
}
interface AssetPage { assets: AssetHit[]; total: number; counts: Record<string, number>; next_cursor: string | null; hidden_types: string[] }
interface ContentItem extends Ref { name: string; label: string; included_as: 'root' | 'dependency' | 'manual'; required_by?: Ref | 'root'; data_mode?: string; row_count?: number }
interface Contents { items: ContentItem[]; excluded: Array<Ref & { name: string | null }>; requirements: Array<{ id: string; label: string; required: boolean }>; warnings: string[] }
interface PackageRow { id: string; name: string; slug: string; description: string | null; readme?: string | null; author?: string | null; latest_version: string | null; roots: Ref[]; items: Ref[]; excluded: Ref[]; data_modes: Record<string, string> }

const IN_PACKAGE: Record<string, string> = { root: 'root', manual: 'added', dependency: 'dependency', excluded: 'left out' }
const key = (ref: Ref) => `${ref.type}:${ref.id}`

function normalizeType(type: string): string {
  const t = type.trim().replace(/-/g, '_')
  if (!(ASSET_TYPES as readonly string[]).includes(t)) throw new CliUsageError(`Unknown type "${type}" (expected ${ASSET_TYPES.join(', ')})`)
  return t
}

/** `type:id`, a bare id (workflow) or a name (`type:name` or a workflow name). */
export function parseRefSpec(value: string): { type: string; id?: string; name?: string } {
  const cut = value.indexOf(':')
  const head = cut > 0 ? value.slice(0, cut).replace(/-/g, '_') : ''
  if (cut > 0 && (ASSET_TYPES as readonly string[]).includes(head)) {
    const rest = value.slice(cut + 1).trim()
    if (!rest) throw new CliUsageError(`"${value}": nothing after the type`)
    return UUID.test(rest) ? { type: head, id: rest } : { type: head, name: rest }
  }
  if (UUID.test(value.trim())) return { type: 'workflow', id: value.trim() }
  if (!value.trim()) throw new CliUsageError('Empty reference')
  return { type: 'workflow', name: value.trim() }
}

/** "1,3-5" / "a" → zero-based indexes into `count` rows. */
export function parseSelection(answer: string, count: number): number[] {
  const text = answer.trim().toLowerCase()
  if (!text) return []
  if (text === 'a' || text === 'all') return [...Array(count).keys()]
  const out = new Set<number>()
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const range = /^(\d+)(?:-(\d+))?$/.exec(part)
    if (!range) throw new CliUsageError(`"${part}" is not a number or range (e.g. 1,3-5)`)
    const from = Number(range[1])
    const to = range[2] ? Number(range[2]) : from
    if (from < 1 || to > count || from > to) throw new CliUsageError(`${part}: choose between 1 and ${count}`)
    for (let i = from; i <= to; i++) out.add(i - 1)
  }
  return [...out]
}

function assetLine(hit: AssetHit): string[] {
  return [
    hit.label,
    hit.name + (hit.matched_reference ? ` (reference “${hit.matched_reference}”)` : ''),
    hit.updated_at ? hit.updated_at.slice(0, 10) : '',
    hit.in_package ? IN_PACKAGE[hit.in_package] : '',
    key(hit),
  ]
}

async function searchAssets(runtime: Runtime, self: Command, query: Record<string, string | number | undefined>): Promise<AssetPage> {
  const clean: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') clean[k] = v
  return runtime.client(self).request<AssetPage>('GET', '/packages/assets', { query: clean })
}

/**
 * Matches for `--search` (or a name), then the user's choice: on a terminal a
 * numbered list and a prompt; otherwise the single (or single exact-name) match.
 */
async function chooseAssets(runtime: Runtime, self: Command, input: { search: string; types?: string; packageId?: string; exactName?: boolean; many: boolean }): Promise<Ref[]> {
  const page = await searchAssets(runtime, self, { search: input.search, type: input.types, package: input.packageId, limit: 50 })
  const exact = page.assets.filter((hit) => hit.name.toLowerCase() === input.search.toLowerCase())
  const what = `${input.types ? input.types.replace(/_/g, ' ') : 'asset'} matching “${input.search}”`
  if (!page.assets.length) throw new CliUsageError(`No ${what}${page.hidden_types.length ? ` (types you may not view are not searched: ${page.hidden_types.join(', ')})` : ''}`)
  const asRef = (hit: AssetHit): Ref => ({ type: hit.type, id: hit.id })
  if (input.exactName && exact.length === 1) return [asRef(exact[0])]
  if (page.assets.length === 1) return [asRef(page.assets[0])]
  const interactive = runtime.io.stdinIsTTY && runtime.io.prompt && !runtime.flags(self).yes
  const listing = grid(['#', 'TYPE', 'NAME', 'UPDATED', 'IN PACKAGE', 'REF'], page.assets.map((hit, i) => [String(i + 1), ...assetLine(hit)]))
  const more = page.total > page.assets.length ? `\n(${page.assets.length} of ${page.total} shown; narrow the search or add --type)` : ''
  if (!interactive) {
    if (exact.length === 1) return [asRef(exact[0])]
    throw new CliUsageError(`${page.total} ${what}; pass one of these refs (or narrow --search / --type):\n${listing}${more}`)
  }
  runtime.io.stderr.write(`${listing}${more}\n`)
  const answer = await runtime.io.prompt!(input.many ? 'Which? (e.g. 1,3-5; a = all shown; empty = cancel): ' : 'Which one? (number; empty = cancel): ')
  const picked = parseSelection(answer, page.assets.length)
  if (!picked.length) throw new Error('Aborted.')
  if (!input.many && picked.length > 1) throw new CliUsageError('Choose one')
  return picked.map((i) => asRef(page.assets[i]))
}

/** Resolve `--from` / positional refs (ids pass through; names are looked up). */
async function resolveRefs(runtime: Runtime, self: Command, specs: string[], packageId?: string): Promise<Ref[]> {
  const out: Ref[] = []
  for (const spec of specs) {
    const parsed = parseRefSpec(spec)
    if (parsed.id) out.push({ type: parsed.type, id: parsed.id })
    else out.push(...await chooseAssets(runtime, self, { search: parsed.name!, types: parsed.type, packageId, exactName: true, many: false }))
  }
  return out
}

function parseRows(rows: string[]): Record<string, 'rows'> {
  return Object.fromEntries(rows.map((id) => [id, 'rows' as const]))
}

/** Dependencies only the new refs pulled in (for --without-dependencies). */
export function dependenciesOnlyFrom(after: readonly ContentItem[], added: readonly Ref[], before: ReadonlySet<string>): Ref[] {
  const addedKeys = new Set(added.map(key))
  return after
    .filter((item) => item.included_as === 'dependency' && !before.has(key(item)) && !addedKeys.has(key(item)))
    .filter((item) => item.required_by && item.required_by !== 'root' && addedKeys.has(key(item.required_by)))
    .map((item) => ({ type: item.type, id: item.id }))
}

export function renderShow(pkg: PackageRow, versions: Array<{ version: string; created_at: string; signed: boolean; asset_count: number }>, contents: Contents): string {
  const names = new Map(contents.items.map((item) => [key(item), item.name]))
  const lines = [
    `${pkg.name} (${pkg.slug})${pkg.latest_version ? `  latest ${pkg.latest_version}` : '  not built yet'}`,
    ...(pkg.description ? [`  ${pkg.description}`] : []),
    `  id ${pkg.id}${pkg.author ? ` · author ${pkg.author}` : ''}${pkg.readme ? ` · readme ${pkg.readme.length} chars` : ''}`,
    '',
    grid(['TYPE', 'NAME', 'INCLUDED', 'DATA', 'REF'], contents.items.map((item) => [
      item.label,
      item.name,
      item.included_as === 'dependency' && item.required_by && item.required_by !== 'root' ? `used by ${names.get(key(item.required_by)) ?? key(item.required_by)}` : item.included_as === 'manual' ? 'added' : item.included_as,
      item.type === 'data_table' ? (item.data_mode === 'rows' ? `schema + ${item.row_count ?? 0} rows` : 'schema only') : '',
      key(item),
    ])),
    `${contents.items.length} item${contents.items.length === 1 ? '' : 's'} (${contents.items.filter((i) => i.included_as !== 'dependency').length} chosen, ${contents.items.filter((i) => i.included_as === 'dependency').length} dependencies)`,
  ]
  if (contents.excluded.length) {
    lines.push('', 'Left out:')
    for (const ref of contents.excluded) lines.push(`  ${ref.name ?? '(deleted)'}  ${key(ref)}`)
  }
  if (contents.requirements.length) {
    lines.push('', 'Asked for on install:')
    for (const r of contents.requirements) lines.push(`  ${r.required ? '*' : ' '} ${r.label}`)
  }
  for (const warning of contents.warnings) lines.push(`warning: ${warning}`)
  if (versions.length) {
    lines.push('', grid(['VERSION', 'BUILT', 'ASSETS', 'SIGNED'], versions.slice(0, 5).map((v) => [v.version, v.created_at.slice(0, 10), String(v.asset_count), v.signed ? 'yes' : 'no'])))
  }
  return lines.join('\n')
}

function replaceGenerated(parent: Command, name: string) {
  const index = parent.commands.findIndex((command) => command.name() === name)
  if (index >= 0) (parent.commands as Command[]).splice(index, 1)
}

export function registerPackageAuthoringCommands(program: Command, runtime: Runtime) {
  const packages = program.commands.find((command) => command.name() === 'packages') ?? program.command('packages')
  for (const name of ['assets', 'create', 'add']) replaceGenerated(packages, name)

  packages
    .command('assets [search]')
    .description('Search every asset a package can contain (workflows, tables, integrations and their references, …), newest or A–Z, with counts')
    .option('--search <text>', 'Substring of the name or description (same as the argument)')
    .option('--type <types>', `Only these types, comma-separated (${ASSET_TYPES.join(', ')})`)
    .option('--tag <tag>', 'Tag (workflows, custom steps, integrations, agents) or report category')
    .option('--owner <user>', 'Created by: user id or "me"')
    .option('--updated-since <when>', 'YYYY-MM-DD, timestamp, or relative (24h, 7d, 4w)')
    .addOption(new Option('--sort <order>', 'name (A–Z) or updated (newest first)').choices(['name', 'updated']))
    .option('--package <package>', 'Mark which assets are already in this package (id or slug)')
    .option('--after <cursor>', 'Next page: the previous next_cursor')
    .addHelpText('after', '\nPaging: --limit (1-100, default 50), --after <next_cursor>, or --all for every page.\nAPI: GET /api/v1/packages/assets  (permission: packages.view + each type\'s view permission)')
    .action(async (text: string | undefined, opts: { search?: string; type?: string; tag?: string; owner?: string; updatedSince?: string; sort?: string; package?: string; after?: string }, self: Command) => {
      const flags = runtime.flags(self)
      const types = opts.type ? opts.type.split(',').map(normalizeType).join(',') : undefined
      const limit = flags.limit !== undefined ? Number(flags.limit) : undefined
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) throw new CliUsageError('--limit must be 1-100')
      const query = { search: opts.search ?? text, type: types, tag: opts.tag, owner: opts.owner, updated_since: opts.updatedSince, sort: opts.sort, package: opts.package, limit }
      let page = await searchAssets(runtime, self, { ...query, after: opts.after })
      const assets = [...page.assets]
      while (flags.all && page.next_cursor) {
        page = await searchAssets(runtime, self, { ...query, limit: 100, after: page.next_cursor })
        assets.push(...page.assets)
      }
      if (runtime.settings(self).output !== 'table') {
        runtime.print(self, flags.all ? { ...page, assets, next_cursor: null } : page, { listKey: 'assets' })
        return
      }
      const counts = Object.entries(page.counts).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(', ')
      runtime.io.stdout.write(`${assets.length ? grid(['TYPE', 'NAME', 'UPDATED', ...(opts.package ? ['IN PACKAGE'] : []), 'REF'], assets.map((hit) => {
        const [label, name, updated, inPackage, ref] = assetLine(hit)
        return [label, name, updated, ...(opts.package ? [inPackage] : []), ref]
      })) : 'No matching assets.'}\n${assets.length} of ${page.total}${counts ? ` (${counts})` : ''}${!flags.all && page.next_cursor ? `\nMore: --after ${page.next_cursor}  (or --all)` : ''}\n`)
      if (page.hidden_types.length) runtime.info(self, `not searched (no view permission): ${page.hidden_types.join(', ')}`)
    })

  packages
    .command('create [name]')
    .description('Create a package from root artifacts (everything they use is included automatically)')
    .option('--from <ref>', 'Root artifact: <type>:<id>, a workflow id, <type>:<name> or a workflow name (repeatable)', collect, [])
    .option('--search <text>', 'Find the root(s) by search (asks which on a terminal)')
    .option('--type <types>', 'With --search: only these types (comma-separated)')
    .option('--description <text>', 'Description')
    .option('--readme <file>', 'Markdown readme shown before install (- for stdin)')
    .option('--slug <slug>', 'Slug (default: from the name)')
    .option('--author <author>', 'Author (default: the workspace name)')
    .option('--rows <table-id>', 'Package this data table with its rows (repeatable)', collect, [])
    .option('--set <assignment>', 'Set a body field (repeatable): key=value, key:=<json>, key=@file', collect, [])
    .addHelpText('after', '\nExamples:\n  usertasks packages create "Invoice approval" --from "Invoice approval" --readme README.md\n  usertasks packages create "Vendor onboarding" --search vendor --type workflow,data_table\n  usertasks packages create -f package.yaml\n\nAPI: POST /api/v1/packages  (permission: packages.manage)')
    .action(async (name: string | undefined, opts: { from: string[]; search?: string; type?: string; description?: string; readme?: string; slug?: string; author?: string; rows: string[]; set: string[] }, self: Command) => {
      const flags = runtime.flags(self)
      const base = await buildBody(flags.file, opts.set, runtime.io.readStdin)
      const body: Record<string, unknown> = base && typeof base === 'object' && !Array.isArray(base) ? { ...(base as Record<string, unknown>) } : {}
      if (name) body.name = name
      if (!body.name) throw new CliUsageError('A package needs a name: usertasks packages create <name> --from <workflow>')
      if (opts.description !== undefined) body.description = opts.description
      if (opts.slug) body.slug = opts.slug
      if (opts.author) body.author = opts.author
      if (opts.readme) body.readme = opts.readme === '-' ? await runtime.io.readStdin() : readText(opts.readme)
      const roots = [...(Array.isArray(body.roots) ? body.roots as Ref[] : [])]
      roots.push(...await resolveRefs(runtime, self, opts.from))
      if (opts.search) roots.push(...await chooseAssets(runtime, self, { search: opts.search, types: opts.type ? opts.type.split(',').map(normalizeType).join(',') : undefined, many: true }))
      if (!roots.length) throw new CliUsageError('Name what the package starts from: --from <workflow name | type:id> or --search <text>')
      body.roots = roots
      if (opts.rows.length) body.data_modes = { ...(body.data_modes as Record<string, string> | undefined), ...parseRows(opts.rows) }
      const data = await runtime.client(self).request<{ package: PackageRow }>('POST', '/packages', { body })
      if (runtime.settings(self).output !== 'table') { runtime.print(self, data); return }
      runtime.io.stdout.write(`Created ${data.package.name} (${data.package.slug}) from ${roots.length} root${roots.length === 1 ? '' : 's'}.\n  Contents: usertasks packages show ${data.package.slug}\n  Build:    usertasks packages build ${data.package.slug}\n`)
    })

  packages
    .command('add <package> [refs...]')
    .description('Add artifacts (<type>:<id>, ids, names or --search) and, by default, everything they use')
    .option('--search <text>', 'Find what to add by search (asks which on a terminal)')
    .option('--type <types>', 'With --search: only these types (comma-separated)')
    .option('--without-dependencies', 'Leave out the dependencies only these artifacts pull in (they must already exist where the package is installed)')
    .option('--rows <table-id>', 'Package this data table with its rows (repeatable)', collect, [])
    .addHelpText('after', '\nExamples:\n  usertasks packages add invoice-approval data_table:3fa8c21b-… --rows 3fa8c21b-…\n  usertasks packages add invoice-approval --search "vendor" --type data_table,decision_table\n  usertasks packages add invoice-approval "email_template:Approval request"\n\nAPI: GET /api/v1/packages/assets, PATCH /api/v1/packages/{id}  (permission: packages.manage)')
    .action(async (pkg: string, refs: string[], opts: { search?: string; type?: string; withoutDependencies?: boolean; rows: string[] }, self: Command) => {
      const client = runtime.client(self)
      const add = await resolveRefs(runtime, self, refs, pkg)
      if (opts.search) add.push(...await chooseAssets(runtime, self, { search: opts.search, types: opts.type ? opts.type.split(',').map(normalizeType).join(',') : undefined, packageId: pkg, many: true }))
      if (!add.length && !opts.rows.length) throw new CliUsageError('Nothing to add: pass <type>:<id>… or --search <text>')
      const body: Record<string, unknown> = { ...(add.length ? { add } : {}), ...(opts.rows.length ? { data_modes: parseRows(opts.rows) } : {}) }
      if (opts.withoutDependencies && add.length) {
        const { package: current } = await client.request<{ package: PackageRow }>('GET', '/packages/{id}', { path: { id: pkg } })
        const before = await client.request<Contents>('GET', '/packages/{id}/contents', { path: { id: pkg } })
        const addKeys = new Set(add.map(key))
        const known = new Set([...current.roots, ...current.items].map(key))
        const excluded = current.excluded.filter((ref) => !addKeys.has(key(ref)))
        const after = await client.request<Contents>('POST', '/packages/preview', {
          body: { roots: current.roots, items: [...current.items, ...add.filter((ref) => !known.has(key(ref)))], excluded, data_modes: current.data_modes },
        })
        const leaveOut = dependenciesOnlyFrom(after.items, add, new Set(before.items.map(key)))
        if (leaveOut.length) {
          body.excluded = [...excluded, ...leaveOut]
          runtime.info(self, `leaving out ${leaveOut.length} dependenc${leaveOut.length === 1 ? 'y' : 'ies'}: ${leaveOut.map((ref) => after.items.find((i) => key(i) === key(ref))?.name ?? key(ref)).join(', ')}`)
        }
      }
      const data = await client.request<{ package: PackageRow }>('PATCH', '/packages/{id}', { path: { id: pkg }, body })
      if (runtime.settings(self).output !== 'table') { runtime.print(self, data); return }
      runtime.io.stdout.write(`Added ${add.length} item${add.length === 1 ? '' : 's'} to ${data.package.name}${opts.rows.length ? ` (rows for ${opts.rows.length} table${opts.rows.length === 1 ? '' : 's'})` : ''}. See: usertasks packages show ${data.package.slug}\n`)
    })

  packages
    .command('show <package>')
    .description('A package: metadata, every item with why it is included (root, added, used by …), data modes, what is left out, requirements and recent versions')
    .addHelpText('after', '\nAPI: GET /api/v1/packages/{id}, GET /api/v1/packages/{id}/contents  (permission: packages.view)')
    .action(async (pkg: string, _opts: unknown, self: Command) => {
      const client = runtime.client(self)
      const [detail, contents] = await Promise.all([
        client.request<{ package: PackageRow; versions: Array<{ version: string; created_at: string; signed: boolean; asset_count: number }> }>('GET', '/packages/{id}', { path: { id: pkg } }),
        client.request<Contents>('GET', '/packages/{id}/contents', { path: { id: pkg } }),
      ])
      if (runtime.settings(self).output !== 'table') { runtime.print(self, { ...detail, contents }); return }
      runtime.io.stdout.write(`${renderShow(detail.package, detail.versions, contents)}\n`)
    })

  packages
    .command('set-data <package> <table> <mode>')
    .description('Package a data table as schema only or schema + rows (<table>: id or name of a table in the package)')
    .addHelpText('after', '\nAPI: PATCH /api/v1/packages/{id} with data_modes  (permission: packages.manage)')
    .action(async (pkg: string, table: string, mode: string, _opts: unknown, self: Command) => {
      if (mode !== 'rows' && mode !== 'schema') throw new CliUsageError(`mode must be "rows" or "schema", not "${mode}"`)
      const client = runtime.client(self)
      let tableId = table
      let tableName = table
      if (!UUID.test(table)) {
        const contents = await client.request<Contents>('GET', '/packages/{id}/contents', { path: { id: pkg } })
        const tables = contents.items.filter((item) => item.type === 'data_table')
        const match = tables.filter((item) => item.name.toLowerCase() === table.toLowerCase())
        if (match.length !== 1) {
          throw new CliUsageError(`${match.length ? 'Several' : 'No'} data table${match.length ? 's' : ''} named “${table}” in the package${tables.length ? `; its tables:\n${tables.map((t) => `  ${t.name}  ${t.id}`).join('\n')}` : ' (it has none)'}`)
        }
        tableId = match[0].id
        tableName = match[0].name
      }
      const data = await client.request<{ package: PackageRow }>('PATCH', '/packages/{id}', { path: { id: pkg }, body: { data_modes: { [tableId]: mode } } })
      if (runtime.settings(self).output !== 'table') { runtime.print(self, data); return }
      runtime.io.stdout.write(`${data.package.name}: ${tableName} → ${mode === 'rows' ? 'schema + rows' : 'schema only'}\n`)
    })
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    throw new CliUsageError(`Cannot read ${path}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`)
  }
}
