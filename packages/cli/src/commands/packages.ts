/**
 * `usertasks packages …` — hand-written commands next to the generated ones
 * (list, preview, get, update, delete, contents, versions, version); the
 * authoring ones (assets, create, add, show, set-data) are in
 * ./package-authoring:
 *
 *   packages remove <package> <type:id>…                       leave artifacts out
 *   packages build <package> [--release 1.2.0 | --bump patch] [--out file.utpkg]
 *   packages download <package> [version] -o file.utpkg
 *   packages inspect <file.utpkg>                              offline verify + contents
 *   packages install <file.utpkg> [--dry-run] [--set <req>.<field>=value]…
 *                    [-f values.yaml] [--keep-incomplete] [--data <table>=merge|replace|skip]…
 *   packages upgrade <file.utpkg> [… same flags, --keep-local-changes]
 *   packages complete <install> [--set …] [-f values.yaml]
 *   packages uninstall <install> [--force] [--delete-data] [--cancel-runs]
 *   packages installs                                          the package library
 *   packages history [package] [--action …] [--status …] [--user …] [--since …] [--until …]
 *
 * Requirement values: `-f values.yaml` ({ <requirement id>: { <field>: value } }),
 * `--set <requirement id>.<field key>=value` (requirement ids have no dots;
 * field keys may), `${env:VAR}` / `${file:path}` substituted locally. On a
 * terminal, missing values are prompted for (secrets without echo); leave a
 * prompt empty to skip it, then choose to keep the install incomplete.
 * Without a terminal, missing required values fail unless --keep-incomplete.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { jobProgressLine } from './resources'
import { basename, dirname, resolve } from 'node:path'
import { Option, type Command } from 'commander'
import { CliExit, CliUsageError, EXIT } from '../exit-codes'
import { substitute } from '../config-files'
import { collect, readBodyFile } from '../input'
import { grid } from '../output'
import { unpackPackage, type PackageRequirement } from '../package-format'
import type { Runtime } from '../runtime'

/** Installs write up to 2000 assets in one request. */
const INSTALL_TIMEOUT_MS = 300_000

type Values = Record<string, Record<string, unknown>>
interface FieldState { key: string; state: 'provided' | 'stored' | 'default' | 'missing' | 'optional' }
interface RequirementPlan extends PackageRequirement { status: 'met' | 'missing'; field_states?: FieldState[] }
interface PlanAsset { section: string; name: string; action: string; locally_modified?: boolean; needs_config?: boolean; skipped?: string; diffs?: Array<{ path: string }> }
interface InstallPlan {
  dry_run: boolean
  mode: 'install' | 'upgrade' | 'reinstall' | 'downgrade'
  package: { id: string; name: string; slug: string; version: string; description: string | null }
  verification: { valid: boolean; signed: boolean; signature_ok: boolean | null; fingerprint: string | null; trust: string; errors: string[] }
  installed_version: string | null
  plan: { assets: PlanAsset[]; summary: Record<string, number> }
  removed_upstream: Array<{ section: string; name: string | null }>
  requirements: RequirementPlan[]
  data: Array<{ table_id: string; name: string; rows: number; mode: string }>
  dependencies: Array<{ package_slug: string; version_range: string; installed_version: string | null; ok: boolean }>
  blockers: string[]
  missing_permissions?: Array<{ section: string; permission: string }>
  warnings: Array<{ warning: string }>
  install?: { id: string; status: string; version: string; slug: string }
  result?: { errors?: Array<{ asset_type: string; error: string }>; published?: string[]; rows?: Array<{ name: string; inserted: number; updated: number; deleted: number; error?: string }> }
}

const MARK: Record<string, string> = { create: '+', update: '~', unchanged: '=', error: '!' }

function readPackageFileBase64(path: string): string {
  try {
    return readFileSync(path).toString('base64')
  } catch (error) {
    throw new CliUsageError(`Cannot read ${path}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}`)
  }
}

function parseRef(value: string): { type: string; id: string } {
  const cut = value.indexOf(':')
  if (cut <= 0) throw new CliUsageError(`"${value}" is not <type>:<id> (e.g. workflow:3fa8…, data_table:…)`)
  return { type: value.slice(0, cut).replace(/-/g, '_'), id: value.slice(cut + 1) }
}

/** `--set <requirement id>.<field key>=value` → values. */
export function parseValueAssignments(assignments: string[]): Values {
  const values: Values = {}
  for (const assignment of assignments) {
    const eq = assignment.indexOf('=')
    const target = eq > 0 ? assignment.slice(0, eq) : ''
    const dot = target.indexOf('.')
    if (eq <= 0 || dot <= 0) throw new CliUsageError(`--set ${assignment}: expected <requirement id>.<field key>=value`)
    ;(values[target.slice(0, dot)] ??= {})[target.slice(dot + 1)] = assignment.slice(eq + 1)
  }
  return values
}

function mergeValues(...sets: Values[]): Values {
  const out: Values = {}
  for (const set of sets) for (const [id, fields] of Object.entries(set)) out[id] = { ...(out[id] ?? {}), ...fields }
  return out
}

async function gatherValues(runtime: Runtime, self: Command, assignments: string[]): Promise<Values> {
  const flags = runtime.flags(self)
  let fromFile: Values = {}
  if (flags.file) {
    const parsed = await readBodyFile(flags.file, runtime.io.readStdin)
    if (parsed && (typeof parsed !== 'object' || Array.isArray(parsed))) throw new CliUsageError(`${flags.file}: expected { <requirement id>: { <field>: value } }`)
    fromFile = (parsed ?? {}) as Values
  }
  const values = mergeValues(fromFile, parseValueAssignments(assignments))
  const unresolved: string[] = []
  const substituted = substitute(values, { env: runtime.io.env, baseDir: flags.file && flags.file !== '-' ? dirname(resolve(flags.file)) : process.cwd() }, unresolved)
  if (unresolved.length) throw new CliUsageError(`Unresolved ${[...new Set(unresolved)].join(', ')} (set the variables or files)`)
  return substituted
}

function missingFields(requirements: RequirementPlan[], values: Values) {
  const out: Array<{ requirement: RequirementPlan; field: PackageRequirement['fields'][number] }> = []
  for (const requirement of requirements) {
    if (requirement.status !== 'missing') continue
    for (const state of requirement.field_states ?? []) {
      if (state.state !== 'missing') continue
      const given = values[requirement.id]?.[state.key]
      if (given !== undefined && given !== '') continue
      const field = requirement.fields.find((f) => f.key === state.key)
      if (field) out.push({ requirement, field })
    }
  }
  return out
}

export function renderInstallPlan(plan: InstallPlan): string {
  const lines: string[] = []
  const v = plan.verification
  lines.push(`${plan.package.name} ${plan.package.version} (${plan.package.slug})  ${plan.mode}${plan.installed_version ? ` from ${plan.installed_version}` : ''}`)
  lines.push(`  ${v.signed ? (v.signature_ok ? `signed · ${v.trust === 'instance' ? 'this instance' : v.trust} · ${v.fingerprint}` : 'INVALID SIGNATURE') : 'unsigned'}`)
  const width = Math.max(7, ...plan.plan.assets.map((a) => a.section.length))
  for (const asset of plan.plan.assets) {
    const flags = [asset.locally_modified ? 'changed locally' : '', asset.needs_config ? 'needs configuration' : '', asset.skipped ?? ''].filter(Boolean)
    lines.push(`${MARK[asset.action] ?? ' '} ${asset.action.padEnd(9)} ${asset.section.padEnd(width)}  ${asset.name}${flags.length ? `  [${flags.join(', ')}]` : ''}`)
    if (asset.action === 'update') for (const diff of (asset.diffs ?? []).slice(0, 8)) lines.push(`      ${diff.path}`)
  }
  for (const removed of plan.removed_upstream) lines.push(`- removed   ${removed.section.padEnd(width)}  ${removed.name ?? ''}  [no longer in the package; kept]`)
  for (const data of plan.data) lines.push(`  rows      ${'data_tables'.padEnd(width)}  ${data.name}: ${data.rows} row${data.rows === 1 ? '' : 's'} (${data.mode})`)
  const s = plan.plan.summary
  lines.push(`\nPlan: ${s.create ?? 0} to create, ${s.update ?? 0} to update, ${s.unchanged ?? 0} unchanged, ${s.error ?? 0} error${s.error === 1 ? '' : 's'}.`)
  if (plan.requirements.length) {
    lines.push('Requirements:')
    for (const requirement of plan.requirements) {
      lines.push(`  ${requirement.status === 'met' ? '✓' : '✗'} ${requirement.label}${requirement.required ? '' : ' (optional)'}  [${requirement.id}]`)
      for (const state of requirement.field_states ?? []) {
        if (state.state === 'missing') lines.push(`      missing ${state.key}`)
      }
    }
  }
  for (const dep of plan.dependencies) lines.push(`${dep.ok ? '✓' : '✗'} needs package ${dep.package_slug} ${dep.version_range}${dep.installed_version ? ` (installed ${dep.installed_version})` : ''}`)
  for (const missing of plan.missing_permissions ?? []) lines.push(`! missing permission '${missing.permission}' for ${missing.section}`)
  for (const blocker of plan.blockers) lines.push(`! ${blocker}`)
  for (const warning of plan.warnings) lines.push(`warning: ${warning.warning}`)
  return lines.join('\n')
}

function printPlan(runtime: Runtime, self: Command, plan: InstallPlan) {
  if (runtime.settings(self).output === 'table') runtime.io.stdout.write(`${renderInstallPlan(plan)}\n`)
  else runtime.print(self, plan)
}

interface InstallOpts {
  dryRun?: boolean
  set: string[]
  keepIncomplete?: boolean
  adoptByName?: boolean
  data: string[]
  keepLocalChanges?: boolean
  allowDowngrade?: boolean
  sourceLabel?: string
}

function parseData(entries: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of entries) {
    const [table, mode] = entry.split('=')
    if (!table || !['merge', 'replace', 'skip'].includes(mode)) throw new CliUsageError(`--data ${entry}: expected <table id>=merge|replace|skip`)
    out[table] = mode
  }
  return out
}

/** Prompt for missing values on a terminal; returns the extra values. */
async function promptMissing(runtime: Runtime, self: Command, requirements: RequirementPlan[], values: Values): Promise<Values> {
  const extra: Values = {}
  const missing = missingFields(requirements, values)
  if (!missing.length || !runtime.io.stdinIsTTY || !runtime.io.prompt || runtime.flags(self).yes) return extra
  runtime.io.stderr.write(`\n${missing.length} required value${missing.length === 1 ? '' : 's'} missing (leave empty to skip):\n`)
  for (const { requirement, field } of missing) {
    const question = `  ${requirement.label} — ${field.label}${field.description && field.description !== 'Optional' ? ` (${field.description})` : ''}: `
    const answer = field.secret ? await runtime.io.promptSecret(question) : await runtime.io.prompt(question)
    if (answer.trim()) (extra[requirement.id] ??= {})[field.key] = answer.trim()
  }
  return extra
}

async function installFlow(runtime: Runtime, self: Command, file: string, opts: InstallOpts, mode: 'install' | 'upgrade') {
  const client = runtime.client(self, { timeoutMs: INSTALL_TIMEOUT_MS })
  const base = {
    file: readPackageFileBase64(file),
    file_name: basename(file),
    source: 'cli',
    source_label: opts.sourceLabel ?? basename(file),
    ...(opts.adoptByName ? { adopt_by_name: true } : {}),
    ...(opts.keepLocalChanges ? { keep_local_changes: true } : {}),
    ...(opts.allowDowngrade ? { allow_downgrade: true } : {}),
    ...(opts.data.length ? { data: parseData(opts.data) } : {}),
  }
  let values = await gatherValues(runtime, self, opts.set)
  let plan = await client.request<InstallPlan>('POST', '/package-installs/plan', { body: { ...base, values, keep_incomplete: true } })
  if (mode === 'upgrade' && plan.mode === 'install') throw new CliUsageError(`${plan.package.name} is not installed here; use \`usertasks packages install\``)
  printPlan(runtime, self, plan)
  if (!plan.verification.valid) throw new CliExit(EXIT.validation)
  if (opts.dryRun) {
    if (plan.blockers.filter((b) => !b.startsWith('Missing required values')).length || plan.plan.summary.error) throw new CliExit(EXIT.changes)
    return
  }

  let keepIncomplete = Boolean(opts.keepIncomplete)
  const extra = await promptMissing(runtime, self, plan.requirements, values)
  if (Object.keys(extra).length) {
    values = mergeValues(values, extra)
    plan = await client.request<InstallPlan>('POST', '/package-installs/plan', { body: { ...base, values, keep_incomplete: true } })
  }
  const stillMissing = missingFields(plan.requirements, values)
  if (stillMissing.length && !keepIncomplete) {
    if (runtime.io.stdinIsTTY && !runtime.flags(self).yes && await runtime.io.confirm(`${stillMissing.length} required value${stillMissing.length === 1 ? ' is' : 's are'} still missing. Install anyway and complete setup later (affected items stay disabled)?`)) {
      keepIncomplete = true
    } else {
      runtime.io.stderr.write(`error: missing required values:\n${stillMissing.map(({ requirement, field }) => `  --set '${requirement.id}.${field.key}=…'   (${requirement.label} — ${field.label})`).join('\n')}\n  or pass --keep-incomplete and run \`usertasks packages complete\` later\n`)
      throw new CliExit(EXIT.validation)
    }
  }
  const blockers = plan.blockers.filter((b) => !b.startsWith('Missing required values'))
  if (blockers.length) throw new CliExit(EXIT.validation)
  const s = plan.plan.summary
  if (!(await runtime.confirm(self, `${plan.mode === 'install' ? 'Install' : plan.mode === 'upgrade' ? 'Upgrade to' : 'Reinstall'} ${plan.package.name} ${plan.package.version} (${s.create ?? 0} create, ${s.update ?? 0} update)?`))) throw new Error('Aborted.')
  const result = await client.requestAndWait<InstallPlan>('POST', '/package-installs', { body: { ...base, values, keep_incomplete: keepIncomplete }, onProgress: (job) => runtime.info(self, jobProgressLine(job)) })
  if (runtime.settings(self).output !== 'table') { runtime.print(self, result); return }
  const install = result.install!
  const lines = [`${result.mode === 'upgrade' ? 'Upgraded' : 'Installed'} ${result.package.name} ${result.package.version} (install ${install.id}): ${install.status}.`]
  for (const row of result.result?.rows ?? []) lines.push(`  rows ${row.name}: ${row.inserted} inserted, ${row.updated} updated${row.deleted ? `, ${row.deleted} deleted` : ''}${row.error ? ` — ${row.error}` : ''}`)
  if (result.result?.published?.length) lines.push(`  activated ${result.result.published.length} workflow${result.result.published.length === 1 ? '' : 's'}`)
  for (const error of result.result?.errors ?? []) lines.push(`! ${error.asset_type}: ${error.error}`)
  for (const warning of result.warnings) lines.push(`warning: ${warning.warning}`)
  if (install.status === 'incomplete') lines.push(`Setup is incomplete: items that need configuration are disabled. Finish with:\n  usertasks packages complete ${install.slug} --set '<requirement>.<field>=…'`)
  runtime.io.stdout.write(`${lines.join('\n')}\n`)
  if (result.result?.errors?.length) throw new CliExit(EXIT.changes)
}

function installOptions(command: Command): Command {
  return command
    .option('--dry-run', 'Show the plan (diff) only')
    .option('--set <assignment>', 'Requirement value: <requirement id>.<field key>=value (repeatable; ${env:VAR} allowed). -f <values.yaml> for many', collect, [])
    .option('--keep-incomplete', 'Install even if required values are missing (items stay disabled until `packages complete`)')
    .option('--adopt-by-name', 'First install: adopt existing assets with the same unique name')
    .option('--data <table=mode>', 'Rows of a packaged data table: <table id>=merge|replace|skip (repeatable; default merge)', collect, [])
    .option('--allow-downgrade', 'Install an older version over a newer one')
    .option('--source-label <label>', 'Where the file came from (shown in the library; default the file name)')
}

export function registerPackageCommands(program: Command, runtime: Runtime) {
  const packages = program.commands.find((command) => command.name() === 'packages') ?? program.command('packages')
  packages.description('Packages: bundle a process (workflow + everything it uses), build signed .utpkg files, install / upgrade / complete / uninstall them')

  packages
    .command('remove <package> <refs...>')
    .description('Leave artifacts (<type>:<id>) out of a package')
    .action(async (pkg: string, refs: string[], _opts: unknown, self: Command) => {
      runtime.print(self, await runtime.client(self).request('PATCH', '/packages/{id}', { path: { id: pkg }, body: { remove: refs.map(parseRef) } }))
    })

  packages
    .command('build <package>')
    .description('Build, sign and publish a new version and save the .utpkg')
    .option('--release <version>', 'Exact semantic version, e.g. 1.2.0 (default: bump the latest)')
    .addOption(new Option('--bump <kind>', 'Which part to bump').choices(['major', 'minor', 'patch']).default('patch'))
    .option('--notes <text>', 'Release notes')
    .option('--out <file>', 'Where to save the file (default <slug>-<version>.utpkg); alias -O')
    .option('-O <file>', 'Alias of --out')
    .addHelpText('after', '\nAPI: POST /api/v1/packages/{id}/versions  (permission: packages.manage)')
    .action(async (pkg: string, opts: { release?: string; bump: string; notes?: string; out?: string; O?: string }, self: Command) => {
      const data = await runtime.client(self, { timeoutMs: INSTALL_TIMEOUT_MS }).requestAndWait<{ version: { version: string; checksum: string; signed: boolean; fingerprint: string | null; asset_count: number }; manifest: { requirements: unknown[] }; warnings: string[]; file_name: string; file_base64: string }>('POST', '/packages/{id}/versions', {
        onProgress: (job) => runtime.info(self, jobProgressLine(job)),
        path: { id: pkg },
        body: { ...(opts.release ? { version: opts.release } : { bump: opts.bump }), ...(opts.notes ? { notes: opts.notes } : {}), include_file: true },
      })
      const target = opts.out ?? opts.O ?? data.file_name
      writeFileSync(target, Buffer.from(data.file_base64, 'base64'))
      if (runtime.settings(self).output !== 'table') { runtime.print(self, { ...data, file_base64: undefined, file: target }); return }
      const v = data.version
      runtime.io.stdout.write(`Built ${v.version}: ${v.asset_count} assets, ${data.manifest.requirements.length} requirement${data.manifest.requirements.length === 1 ? '' : 's'}, ${v.signed ? `signed ${v.fingerprint}` : 'unsigned'}\n  ${v.checksum}\n  saved ${target}\n`)
      for (const warning of data.warnings) runtime.info(self, `warning: ${warning}`)
    })

  packages
    .command('download <package> [version]')
    .description('Download a built version (default latest) as .utpkg')
    .option('--out <file>', 'Where to save the file')
    .action(async (pkg: string, version: string | undefined, opts: { out?: string }, self: Command) => {
      const data = await runtime.client(self).request<{ file_name: string; checksum: string; file_base64: string }>('GET', '/packages/{id}/versions/{versionId}/download', { path: { id: pkg, versionId: version ?? 'latest' } })
      const target = opts.out ?? data.file_name
      writeFileSync(target, Buffer.from(data.file_base64, 'base64'))
      runtime.info(self, `saved ${target} (${data.checksum})`)
      if (runtime.settings(self).output !== 'table') runtime.print(self, { file: target, checksum: data.checksum })
    })

  packages
    .command('inspect <file>')
    .description('Verify a .utpkg offline (checksum, file hashes, signature) and show its contents and requirements')
    .action(async (file: string, _opts: unknown, self: Command) => {
      let unpacked
      try {
        unpacked = unpackPackage(readFileSync(file))
      } catch (error) {
        throw new CliUsageError(`${file}: ${(error as Error).message}`)
      }
      const { manifest, verification, files } = unpacked
      const assets: Record<string, string[]> = {}
      for (const entry of files) {
        const match = /^assets\/([^/]+)\/.+\.json$/.exec(entry.path)
        if (!match) continue
        try { (assets[match[1]] ??= []).push(String(JSON.parse(entry.content)?.asset?.name ?? entry.path)) } catch { /* reported by verification */ }
      }
      if (runtime.settings(self).output !== 'table') {
        runtime.print(self, { package: manifest.package, verification, assets, data: manifest.data, requirements: manifest.requirements, dependencies: manifest.dependencies })
      } else {
        const p = manifest.package
        const lines = [
          `${p.name} ${p.version} (${p.slug})${p.author ? ` by ${p.author}` : ''}`,
          p.description ? `  ${p.description}` : '',
          `  id ${p.id} · built ${p.created_at}`,
          `  ${verification.valid ? '✓ intact' : '✗ MODIFIED OR CORRUPT'} · ${verification.signed ? (verification.signature_ok ? `signed ${verification.fingerprint}` : 'invalid signature') : 'unsigned'}`,
          ...verification.errors.map((e) => `  ! ${e}`),
          '',
          grid(['SECTION', 'ASSETS'], Object.entries(assets).map(([dir, names]) => [dir, names.join(', ')])),
          ...Object.entries(manifest.data ?? {}).filter(([, d]) => d.mode === 'rows').map(([id, d]) => `  rows: ${id} (${d.row_count ?? 0})`),
        ]
        if (manifest.requirements.length) {
          lines.push('', 'Requirements (asked for on install):')
          for (const r of manifest.requirements) lines.push(`  ${r.required ? '*' : ' '} ${r.label}  [${r.id}]`, ...r.fields.map((f) => `      ${f.key}${f.secret ? ' (secret)' : ''}${f.default !== undefined ? ` default ${JSON.stringify(f.default)}` : ''}`))
        }
        for (const d of manifest.dependencies ?? []) lines.push(`  needs ${d.package_slug} ${d.version_range}`)
        runtime.io.stdout.write(`${lines.filter((l, i) => l !== '' || i > 0).join('\n')}\n`)
      }
      if (!verification.valid) throw new CliExit(EXIT.validation)
    })

  installOptions(packages.command('install <file>'))
    .description('Install a package (or upgrade it in place when installed already): plan, prompt for missing values, apply')
    .option('--keep-local-changes', 'Upgrade: keep assets changed in this workspace since the last install')
    .addHelpText('after', '\nAPI: POST /api/v1/package-installs/plan, POST /api/v1/package-installs  (permission: packages.install)')
    .action(async (file: string, opts: InstallOpts, self: Command) => installFlow(runtime, self, file, opts, 'install'))

  installOptions(packages.command('upgrade <file>'))
    .description('Upgrade an installed package in place (shows the diff first; local requirement values are kept)')
    .option('--keep-local-changes', 'Keep assets changed in this workspace since the last install')
    .action(async (file: string, opts: InstallOpts, self: Command) => installFlow(runtime, self, file, opts, 'upgrade'))

  packages
    .command('complete <install>')
    .description('Complete setup of an incomplete install (install id or package slug): supply the missing values')
    .option('--set <assignment>', 'Requirement value: <requirement id>.<field key>=value (repeatable)', collect, [])
    .option('--dry-run', 'Show what is still missing')
    .addHelpText('after', '\nAPI: POST /api/v1/package-installs/{id}/complete  (permission: packages.install)')
    .action(async (installId: string, opts: { set: string[]; dryRun?: boolean }, self: Command) => {
      const client = runtime.client(self, { timeoutMs: INSTALL_TIMEOUT_MS })
      let values = await gatherValues(runtime, self, opts.set)
      const current = await client.request<{ dry_run: boolean; status: string; requirements: RequirementPlan[] }>('POST', '/package-installs/{id}/complete', { path: { id: installId }, body: { values, dry_run: true, source: 'cli' } })
      if (!opts.dryRun) values = mergeValues(values, await promptMissing(runtime, self, current.requirements, values))
      const result = await client.request<{ status: string; requirements: RequirementPlan[]; warnings: Array<{ warning: string }>; result?: { published?: string[] } }>('POST', '/package-installs/{id}/complete', { path: { id: installId }, body: { values, dry_run: Boolean(opts.dryRun), source: 'cli' } })
      if (runtime.settings(self).output !== 'table') { runtime.print(self, result); return }
      const lines = [`Setup ${result.status}${opts.dryRun ? ' (dry run)' : ''}.`]
      for (const r of result.requirements) lines.push(`  ${r.status === 'met' ? '✓' : '✗'} ${r.label}${r.status === 'missing' ? `  — missing ${(r.field_states ?? []).filter((f) => f.state === 'missing').map((f) => f.key).join(', ')}` : ''}`)
      if (result.result?.published?.length) lines.push(`  activated ${result.result.published.length} workflow${result.result.published.length === 1 ? '' : 's'}`)
      for (const w of result.warnings) lines.push(`warning: ${w.warning}`)
      runtime.io.stdout.write(`${lines.join('\n')}\n`)
      if (result.status !== 'complete' && !opts.dryRun) throw new CliExit(EXIT.changes)
    })

  packages
    .command('uninstall <install>')
    .description('Uninstall a package and its artifacts: lists what will be removed, then asks')
    .option('--force', 'Also remove assets changed in this workspace since install')
    .option('--delete-data', 'Also delete data tables that hold rows (the rows are lost)')
    .option('--cancel-runs', "Cancel unfinished runs of the package's workflows first (otherwise they block the uninstall)")
    .option('--dry-run', 'List only')
    .addHelpText('after', '\nAPI: POST /api/v1/package-installs/{id}/uninstall  (permission: packages.install + each section\'s delete permission)')
    .action(async (installId: string, opts: { force?: boolean; deleteData?: boolean; cancelRuns?: boolean; dryRun?: boolean }, self: Command) => {
      const client = runtime.client(self, { timeoutMs: INSTALL_TIMEOUT_MS })
      const body = { force: Boolean(opts.force), delete_data: Boolean(opts.deleteData), cancel_runs: Boolean(opts.cancelRuns), source: 'cli' }
      type UninstallPlan = {
        name: string; version: string; plan: Array<{ section: string; name: string | null; action: string; reason?: string; rows?: number }>; summary: Record<string, number>
        active_runs?: Array<{ id: string; workflow_name: string | null; status: string }>; active_run_count?: number; blockers?: string[]
      }
      const plan = await client.request<UninstallPlan>('POST', '/package-installs/{id}/uninstall', { path: { id: installId }, body: { ...body, dry_run: true } })
      const blockers = plan.blockers ?? []
      if (runtime.settings(self).output === 'table') {
        const lines = [grid(['ACTION', 'SECTION', 'NAME', 'NOTE'], plan.plan.map((p) => [p.action, p.section, p.name ?? '', [p.reason, p.action === 'delete' && p.rows ? `${p.rows} rows deleted` : ''].filter(Boolean).join('; ')])),
          `${plan.summary.delete} to remove${plan.summary.rows ? ` (${plan.summary.rows} table rows)` : ''}, ${plan.summary.skip} kept.`]
        if (plan.active_run_count) {
          lines.push(`${plan.active_run_count} unfinished run${plan.active_run_count === 1 ? '' : 's'}${opts.cancelRuns ? ' will be cancelled' : ''}:`)
          for (const run of plan.active_runs ?? []) lines.push(`  ${run.id}  ${run.workflow_name ?? ''}  ${run.status}`)
        }
        for (const blocker of blockers) lines.push(`! ${blocker}`)
        runtime.io.stdout.write(`${lines.join('\n')}\n`)
      } else if (opts.dryRun) runtime.print(self, plan)
      if (opts.dryRun) { if (blockers.length) throw new CliExit(EXIT.changes); return }
      if (blockers.length) throw new CliExit(EXIT.validation)
      if (!(await runtime.confirm(self, `Uninstall ${plan.name} ${plan.version} and remove ${plan.summary.delete} asset${plan.summary.delete === 1 ? '' : 's'}${body.delete_data && plan.summary.rows ? ` and ${plan.summary.rows} table rows` : ''}?`))) throw new Error('Aborted.')
      const result = await client.requestAndWait<{ summary: Record<string, number>; errors?: Array<{ section: string; error: string }>; runs_cancelled?: number }>('POST', '/package-installs/{id}/uninstall', { path: { id: installId }, body, onProgress: (job) => runtime.info(self, jobProgressLine(job)) })
      if (runtime.settings(self).output !== 'table') { runtime.print(self, result); return }
      runtime.io.stdout.write(`Uninstalled: ${result.summary.delete - (result.errors?.length ?? 0)} removed, ${result.summary.skip} kept${result.runs_cancelled ? `, ${result.runs_cancelled} runs cancelled` : ''}.\n`)
      for (const e of result.errors ?? []) runtime.io.stdout.write(`! ${e.section}: ${e.error}\n`)
      if (result.errors?.length) throw new CliExit(EXIT.changes)
    })

  packages
    .command('history [package]')
    .description('Package history (newest first): installs, upgrades, setups and uninstalls, failed attempts included')
    .option('--action <actions>', 'install, upgrade, reinstall, downgrade, reconfigure, uninstall (comma-separated)')
    .option('--status <statuses>', 'succeeded, partial, failed (comma-separated)')
    .option('--channel <channels>', 'ui, cli, api, mcp (comma-separated)')
    .option('--user <user>', 'Who: user id or email')
    .option('--since <date>', 'From this date (YYYY-MM-DD) or timestamp')
    .option('--until <date>', 'Up to and including this date')
    .option('--limit <n>', 'How many (default 50, 0 = all)')
    .addHelpText('after', '\nOne event with its applied plan: usertasks package-events get <id>\nAPI: GET /api/v1/package-events  (permission: packages.view)')
    .action(async (pkg: string | undefined, opts: { action?: string; status?: string; channel?: string; user?: string; since?: string; until?: string; limit?: string }, self: Command) => {
      const query: Record<string, string> = {}
      if (pkg) query.package = pkg
      for (const key of ['action', 'status', 'channel', 'since', 'until', 'limit'] as const) if (opts[key]) query[key] = String(opts[key])
      if (opts.user) query.actor = opts.user
      type Event = { id: string; created_at: string; package_name: string; action: string; status: string; from_version: string | null; to_version: string | null; channel: string; actor: { name: string | null; email: string | null } | null; counts: Record<string, number>; signed: boolean | null; error: string | null }
      const data = await runtime.client(self).request<{ events: Event[]; total: number }>('GET', '/package-events', { query })
      if (runtime.settings(self).output !== 'table') { runtime.print(self, data, { listKey: 'events' }); return }
      const version = (e: Event) => (e.from_version && e.to_version && e.from_version !== e.to_version ? `${e.from_version} → ${e.to_version}` : e.to_version ?? e.from_version ?? '')
      const counts = (e: Event) => {
        const c = e.counts ?? {}
        return e.action === 'uninstall' ? `-${c.removed ?? 0} kept ${c.skipped ?? 0}` : `+${c.created ?? 0} ~${c.updated ?? 0}${c.skipped ? ` kept ${c.skipped}` : ''}`
      }
      runtime.io.stdout.write(`${grid(['WHEN', 'PACKAGE', 'ACTION', 'STATUS', 'VERSION', 'BY', 'VIA', 'ITEMS', 'ID'], data.events.map((e) => [
        e.created_at.slice(0, 19).replace('T', ' '), e.package_name, e.action, e.status === 'failed' && e.error ? `failed: ${e.error.slice(0, 60)}` : e.status, version(e),
        e.actor?.email ?? e.actor?.name ?? '', e.channel, e.status === 'failed' ? '' : counts(e), e.id,
      ]))}\n${data.events.length < data.total ? `${data.events.length} of ${data.total} (use --limit 0 for all)\n` : ''}`)
    })

  packages
    .command('installs')
    .description('The package library: installed packages, version, source, signer and status')
    .addHelpText('after', '\nAPI: GET /api/v1/package-installs  (permission: packages.view)')
    .action(async (_opts: unknown, self: Command) => {
      const data = await runtime.client(self).request<{ installs: Array<{ id: string; name: string; slug: string; version: string; status: string; source: string; signed: boolean; fingerprint: string | null; incomplete_count: number; installed_at: string }> }>('GET', '/package-installs', { query: { limit: '0' } })
      if (runtime.settings(self).output !== 'table') { runtime.print(self, data, { listKey: 'installs' }); return }
      runtime.io.stdout.write(`${grid(['NAME', 'VERSION', 'STATUS', 'SOURCE', 'SIGNED', 'INSTALLED', 'ID'], data.installs.map((i) => [
        i.name, i.version, i.status === 'incomplete' ? `incomplete (${i.incomplete_count})` : i.status, i.source, i.signed ? (i.fingerprint ?? 'yes').slice(0, 11) : 'no', i.installed_at.slice(0, 10), i.id,
      ]))}\n`)
    })
}
