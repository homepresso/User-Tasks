/**
 * `usertasks config export | apply | diff | new` — config-as-code on top of
 * GET /config/export and POST /config/apply. The folder layout is the
 * GitHub-sync repo layout, so a synced repo's `usertasks/` folder can be
 * applied directly.
 */

import { Option, type Command } from 'commander'
import { jobProgressLine } from './resources'
import { EXIT, CliExit, CliUsageError } from '../exit-codes'
import { isNonEmptyDir, prepareUpload, scaffold, writeExport, type ConfigFormat, type UploadFile } from '../config-files'
import type { Runtime } from '../runtime'

/** Applying up to 2000 assets is one synchronous request (the route allows 300 s). */
const APPLY_TIMEOUT_MS = 300_000

interface FieldDiff { path: string; before?: unknown; after?: unknown }
interface AssetPlan {
  section: string
  name: string
  action: 'create' | 'update' | 'unchanged' | 'error'
  source_id: string | null
  local_id: string | null
  matched_by?: string
  diffs?: FieldDiff[]
  diffs_truncated?: boolean
  error?: string
  file?: string
}
export interface ApplyResponse {
  dry_run: boolean
  plan: { assets: AssetPlan[]; summary: Record<'create' | 'update' | 'unchanged' | 'error', number> }
  missing_permissions?: Array<{ section: string; permission: string }>
  warnings?: Array<{ warning: string; source_id?: string }>
  result?: {
    created: Record<string, number>
    updated: Record<string, number>
    errors: Array<{ asset_type: string; source_id: string; error: string }>
    warnings: Array<{ warning: string }>
  }
}

const MARK: Record<AssetPlan['action'], string> = { create: '+', update: '~', unchanged: '=', error: '!' }

function short(value: unknown, max = 60): string {
  const text = value === undefined ? '(none)' : typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? String(value)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Human plan: one line per asset, field diffs under updates, then a summary. */
export function renderPlan(response: ApplyResponse): string {
  const assets = response.plan.assets
  const sectionWidth = Math.max(7, ...assets.map((a) => a.section.length))
  const lines: string[] = []
  for (const asset of assets) {
    const label = `${MARK[asset.action]} ${asset.action.padEnd(9)} ${asset.section.padEnd(sectionWidth)}  ${asset.name}`
    if (asset.action === 'error') {
      lines.push(`${label}: ${asset.error ?? 'error'}${asset.file && asset.file !== asset.name ? ` (${asset.file})` : ''}`)
      continue
    }
    lines.push(asset.action === 'update' && asset.matched_by && asset.matched_by !== 'id' ? `${label}  [matched by ${asset.matched_by}]` : label)
    for (const diff of asset.diffs ?? []) lines.push(`      ${diff.path}: ${short(diff.before)} → ${short(diff.after)}`)
    if (asset.diffs_truncated) lines.push('      … more changes not shown')
  }
  const s = response.plan.summary
  lines.push(`${lines.length ? '\n' : ''}Plan: ${s.create} to create, ${s.update} to update, ${s.unchanged} unchanged, ${s.error} error${s.error === 1 ? '' : 's'}.`)
  for (const missing of response.missing_permissions ?? []) lines.push(`! apply would be refused: missing '${missing.permission}' for ${missing.section}`)
  for (const warning of response.warnings ?? []) lines.push(`warning: ${warning.warning}`)
  if (response.result) {
    const sum = (record: Record<string, number>) => Object.values(record).reduce((a, b) => a + b, 0)
    lines.push(`Applied: ${sum(response.result.created)} created, ${sum(response.result.updated)} updated.`)
    for (const error of response.result.errors) lines.push(`! ${error.asset_type} ${error.source_id}: ${error.error}`)
    for (const warning of response.result.warnings) lines.push(`warning: ${warning.warning}`)
  }
  return lines.join('\n')
}

function hasErrors(response: ApplyResponse): boolean {
  return response.plan.summary.error > 0 || (response.result?.errors.length ?? 0) > 0
}

const parseTypes = (value: string | undefined) => value?.split(',').map((t) => t.trim()).filter(Boolean)

export function registerConfigCommands(program: Command, runtime: Runtime) {
  const config = program.command('config').description('Config-as-code: export, diff and apply workspace configuration (export, apply, diff, new)')

  config
    .command('export <dir>')
    .description('Export workspace configuration into a folder (GitHub-sync layout; secrets are replaced by "__SECRET__")')
    .option('--types <list>', 'Comma-separated sections (workflows, decision_tables, workflow_activities, data_tables, integrations, agents, reports, retention_policies, roles, mcp_servers, email_templates, connectors, log_destinations, form_themes, forms, workspace_theme)')
    .option('--ids <list>', 'Only these asset ids (comma-separated; any type) — single-asset export')
    .option('--with-dependencies', 'With --ids: also export everything those assets depend on')
    .option('--include-rows', 'Also export the rows of the exported data tables (data-rows/ folder)')
    .addOption(new Option('--format <format>', 'File format').choices(['json', 'yaml']).default('json'))
    .option('--force', 'Write into a non-empty folder, replacing files from an earlier export')
    .action(async (dir: string, opts: { types?: string; ids?: string; withDependencies?: boolean; includeRows?: boolean; format: ConfigFormat; force?: boolean }, self: Command) => {
      if (isNonEmptyDir(dir) && !opts.force) throw new CliUsageError(`${dir} is not empty; pass --force to overwrite it`)
      const types = parseTypes(opts.types)
      const ids = parseTypes(opts.ids)
      if (opts.withDependencies && !ids?.length) throw new CliUsageError('--with-dependencies needs --ids')
      // A background job on servers that support it (no long request), else inline.
      const data = await runtime.client(self).requestAndWait<{ files: UploadFile[]; skipped: Array<{ section: string; permission: string }> }>('GET', '/config/export', {
        onProgress: (job) => runtime.info(self, jobProgressLine(job)),
        query: {
          format: 'files',
          ...(types?.length ? { types: types.join(',') } : {}),
          ...(ids?.length ? { ids: ids.join(',') } : {}),
          ...(opts.withDependencies ? { with_dependencies: 'true' } : {}),
          ...(opts.includeRows ? { include_rows: 'true' } : {}),
        },
      })
      const { written, removed } = writeExport(dir, data.files ?? [], opts.format, Boolean(opts.force))
      for (const skipped of data.skipped ?? []) runtime.info(self, `skipped ${skipped.section}: missing permission '${skipped.permission}'`)
      if (runtime.settings(self).output === 'table') {
        runtime.io.stdout.write(`Exported ${written.length} files to ${dir}${removed.length ? ` (removed ${removed.length} stale)` : ''}.\n`)
      } else {
        runtime.print(self, { dir, files: written, removed, skipped: data.skipped ?? [] })
      }
    })

  const applyLike = async (path: string, opts: { adoptByName?: boolean; sourceLabel?: string; rowsMode?: string }, self: Command, dryRun: boolean): Promise<ApplyResponse> => {
    const upload = prepareUpload(path, runtime.io.env)
    for (const assigned of upload.assignedIds) runtime.info(self, `assigned id ${assigned.id} to ${assigned.file} (written back)`)
    const client = runtime.client(self, { timeoutMs: APPLY_TIMEOUT_MS })
    // Real applies run as a background job where the server supports it.
    const send = dryRun ? client.request.bind(client) : client.requestAndWait.bind(client)
    const response = await send<ApplyResponse>('POST', '/config/apply', {
      ...(dryRun ? {} : { onProgress: (job: { status: string; progress: number; message: string | null }) => runtime.info(self, jobProgressLine(job)) }),
      body: {
        files: upload.files,
        dry_run: dryRun,
        ...(opts.adoptByName ? { adopt_by_name: true } : {}),
        ...(opts.sourceLabel ? { source_label: opts.sourceLabel } : {}),
        ...(opts.rowsMode ? { rows_mode: opts.rowsMode } : {}),
      },
    })
    if (runtime.settings(self).output === 'table') runtime.io.stdout.write(`${renderPlan(response)}\n`)
    else runtime.print(self, response)
    return response
  }

  config
    .command('apply <path>')
    .description('Create or update assets from a config folder or file (never deletes). ${env:VAR} and ${file:path} are substituted locally')
    .option('--dry-run', 'Show the plan without changing anything')
    .option('--adopt-by-name', 'Match unmapped assets to existing ones with the same unique name')
    .option('--source-label <label>', 'Label recorded with the id mappings (default "default"); use one per source workspace')
    .addOption(new Option('--rows-mode <mode>', 'Data-table rows (data-rows/): merge (default), replace or skip').choices(['merge', 'replace', 'skip']))
    .action(async (path: string, opts: { dryRun?: boolean; adoptByName?: boolean; sourceLabel?: string; rowsMode?: string }, self: Command) => {
      const response = await applyLike(path, opts, self, Boolean(opts.dryRun))
      if (hasErrors(response)) throw new CliExit(EXIT.changes)
    })

  config
    .command('diff <path>')
    .description('Compare a config folder or file with the workspace (a dry-run apply)')
    .option('--exit-code', 'Exit 7 when there are changes or errors')
    .option('--adopt-by-name', 'Match unmapped assets to existing ones with the same unique name')
    .option('--source-label <label>', 'Label used for id mappings (default "default")')
    .action(async (path: string, opts: { exitCode?: boolean; adoptByName?: boolean; sourceLabel?: string }, self: Command) => {
      const response = await applyLike(path, opts, self, true)
      const s = response.plan.summary
      if (hasErrors(response) || (opts.exitCode && s.create + s.update > 0)) throw new CliExit(EXIT.changes)
    })

  config
    .command('new <type> <name>')
    .description('Scaffold a new asset file with a generated id (types: workflow, decision-table, activity, data-table, integration, reference, agent, report, retention-policy, role, mcp-server, email-template, connector, log-destination, form, form-theme)')
    .option('--dir <dir>', 'Config folder', '.')
    .addOption(new Option('--format <format>', 'File format').choices(['json', 'yaml']).default('json'))
    .action(async (type: string, name: string, opts: { dir: string; format: ConfigFormat }, self: Command) => {
      const created = scaffold(opts.dir, type, name, opts.format)
      if (runtime.settings(self).output === 'table') runtime.io.stdout.write(`Created ${created.file}\n`)
      else runtime.print(self, created)
    })
}
