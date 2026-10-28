import { z } from 'zod'
import type { McpContext, McpToolServer } from '../server'
import { mcpErr, mcpOk } from '../server'
import { fromMcpContext } from '@/lib/services/context'
import { resolvePage } from '@/lib/services/_shared'
import * as packages from '@/lib/services/packages'
import { searchPackageAssets } from '@/lib/services/package-assets'
import * as installs from '@/lib/services/package-installs'
import * as history from '@/lib/services/package-events'
import { messageOf } from './_util'

/*
 * Packages over MCP: the same services as /api/v1/packages and
 * /api/v1/package-installs. Files travel as base64 (`file`); a package built
 * in this workspace can be named by package_id instead. Secrets are never in a
 * package — credentials are requirements, supplied as `values`.
 */

async function run(fn: () => Promise<unknown>) {
  try {
    return mcpOk(await fn())
  } catch (error) {
    return mcpErr(messageOf(error, 'Request failed'))
  }
}

const TYPES = ['workflow', 'workflow_activity', 'data_table', 'integration', 'connector', 'decision_table', 'email_template', 'agent', 'report', 'role', 'mcp_server', 'retention_policy', 'log_destination', 'form', 'form_theme'] as const
const item = z.object({ type: z.enum(TYPES), id: z.string() })
const page = { limit: z.number().optional().describe('Page size (1-100, default 50; 0 = no limit)'), offset: z.number().optional() }
const values = z.record(z.string(), z.record(z.string(), z.any())).describe('{ <requirement id>: { <field key>: value } } (see packages_install_plan requirements)')
const fileArgs = {
  file: z.string().optional().describe('The .utpkg file, base64'),
  package_id: z.string().optional().describe('Or a package built in this workspace'),
  version: z.string().optional().describe('With package_id: version (default latest)'),
}
const installArgs = {
  ...fileArgs,
  values: values.optional(),
  keep_incomplete: z.boolean().optional().describe('Install with missing required values; affected assets stay disabled until packages_complete_setup'),
  adopt_by_name: z.boolean().optional(),
  data: z.record(z.string(), z.enum(['merge', 'replace', 'skip'])).optional().describe('Per data table: merge (default), replace or skip its rows'),
  keep_local_changes: z.boolean().optional(),
  allow_downgrade: z.boolean().optional(),
}

export function registerPackageTools(server: McpToolServer, ctx: McpContext) {
  const svc = () => fromMcpContext(ctx)

  server.tool('packages_list', 'List packages authored in this workspace (bundles of a process: workflows and everything they use, built into signed .utpkg files).', page,
    async (args) => run(() => packages.listPackages(svc(), resolvePage(args))))
  server.tool('packages_get', 'Get a package (by id or slug) and its recent versions.', { package_id: z.string() },
    async (args) => run(() => packages.getPackage(svc(), args.package_id)))
  server.tool('packages_preview', 'Preview what a package of these root artifacts would contain: dependencies (and why each is included), data tables, and the requirements an install will ask for (credentials, environment URLs, assignees).', {
    roots: z.array(item).describe('Root artifacts, e.g. [{ type: "workflow", id }]'),
    items: z.array(item).optional(), excluded: z.array(item).optional(),
    data_modes: z.record(z.string(), z.enum(['schema', 'rows'])).optional(),
  }, async (args) => run(() => packages.previewPackageContents(svc(), args)))
  server.tool('packages_create', 'Create a package from root artifacts; dependencies are included automatically. data_modes picks schema-only or schema+rows per data table.', {
    name: z.string(), slug: z.string().optional(), description: z.string().optional(), readme: z.string().optional().describe('Markdown'),
    roots: z.array(item), items: z.array(item).optional(), excluded: z.array(item).optional(),
    data_modes: z.record(z.string(), z.enum(['schema', 'rows'])).optional(),
  }, async (args) => run(() => packages.createPackage(svc(), args)))
  server.tool('packages_update', 'Update a package: metadata, add / remove artifacts, data modes.', {
    package_id: z.string(), name: z.string().optional(), description: z.string().optional(), readme: z.string().optional(),
    add: z.array(item).optional(), remove: z.array(item).optional(), data_modes: z.record(z.string(), z.enum(['schema', 'rows'])).optional(),
  }, async (args) => run(async () => {
    const { package_id: id, ...input } = args
    return packages.updatePackage(svc(), id, input)
  }))
  server.tool('packages_delete', 'Delete a package and its built versions (installs in other workspaces are unaffected).', { package_id: z.string() },
    async (args) => run(() => packages.deletePackage(svc(), args.package_id)))
  server.tool('packages_assets_search', 'Search the assets a package can contain, across every type (workflows, custom steps, data tables, integrations and their references, connectors, decision tables, email templates, agents, reports, roles, MCP servers, retention policies, log destinations). Returns a page (default 50) with total and per-type counts; pass next_cursor as `after` for more. Use the ids with packages_create roots or packages_update add.', {
    search: z.string().optional().describe('Substring of the name or description'),
    types: z.array(z.enum(TYPES)).optional().describe('Only these types (default every type you may view)'),
    tag: z.string().optional().describe('Tag or report category'),
    owner: z.string().optional().describe('Created by: user id or "me"'),
    updated_since: z.string().optional().describe('YYYY-MM-DD, timestamp, or relative (24h, 7d)'),
    sort: z.enum(['name', 'updated']).optional(),
    limit: z.number().optional().describe('Page size 1-100 (default 50)'),
    after: z.string().optional().describe('The previous next_cursor'),
    package: z.string().optional().describe('Package id or slug: mark each hit with in_package'),
  }, async (args) => run(() => searchPackageAssets(svc(), args)))
  server.tool('packages_contents', 'What a package contains now: artifacts with the reason each is included, data modes and requirements.', { package_id: z.string() },
    async (args) => run(() => packages.getPackageContents(svc(), args.package_id)))
  server.tool('packages_versions_list', 'List built versions of a package.', { package_id: z.string(), ...page },
    async (args) => run(() => packages.listPackageVersions(svc(), args.package_id, resolvePage(args))))
  server.tool('packages_build', 'Build, sign and publish a new version of a package (version, or bump the latest: patch by default). Returns the version, its manifest (requirements, checksum, signature) and, with include_file, the .utpkg as base64.', {
    package_id: z.string(), version: z.string().optional(), bump: z.enum(['major', 'minor', 'patch']).optional(), notes: z.string().optional(),
    include_file: z.boolean().optional(),
  }, async (args) => run(async () => {
    const { package_id: id, ...input } = args
    return packages.buildPackageVersion(svc(), id, input)
  }))
  server.tool('packages_version_get', 'Get one built version (manifest: requirements, files, checksum, signature).', { package_id: z.string(), version: z.string().describe('Version id, number or "latest"') },
    async (args) => run(() => packages.getPackageVersion(svc(), args.package_id, args.version)))
  server.tool('packages_download', 'Download a built version as base64 .utpkg.', { package_id: z.string(), version: z.string().optional() },
    async (args) => run(async () => {
      const file = await packages.downloadPackageVersion(svc(), args.package_id, args.version ?? 'latest')
      return { file_name: file.file_name, checksum: file.checksum, size_bytes: file.bytes.byteLength, file_base64: Buffer.from(file.bytes).toString('base64') }
    }))
  server.tool('packages_inspect', 'Verify a .utpkg (checksum, file hashes, signature and signer trust) and list its assets, data, requirements and dependencies. Nothing is installed.', fileArgs,
    async (args) => run(async () => {
      const file = args.file ?? (args.package_id ? Buffer.from((await packages.downloadPackageVersion(svc(), args.package_id, args.version ?? 'latest')).bytes).toString('base64') : '')
      return installs.inspectAgainstWorkspace(svc(), { file })
    }))

  server.tool('packages_installs_list', 'The package library: installed packages with version, source, signer and status (complete / incomplete).', page,
    async (args) => run(() => installs.listPackageInstalls(svc(), resolvePage(args))))
  server.tool('packages_installs_get', 'An installed package: requirement checklist (what still needs configuration) and installed assets.', { install_id: z.string().describe('Install id or package slug') },
    async (args) => run(() => installs.getPackageInstall(svc(), args.install_id)))
  server.tool('packages_install_plan', 'Dry run of installing or upgrading a package: per-asset create / update / unchanged with diffs, requirements (met / missing), data rows, dependencies and blockers. Use before packages_install.', installArgs,
    async (args) => run(() => installs.planPackageInstall(svc(), { ...args, source: 'mcp' })))
  server.tool('packages_install', 'Install a package, or upgrade it in place when installed already (local credentials are kept). Missing required values fail unless keep_incomplete: then affected assets are installed disabled and dependent workflows stay inactive until packages_complete_setup.', installArgs,
    async (args) => run(() => installs.installPackage(svc(), { ...args, source: 'mcp' })))
  server.tool('packages_upgrade', 'Upgrade an installed package to the version in the file (dry_run shows the diff first).', { install_id: z.string(), dry_run: z.boolean().optional(), ...installArgs },
    async (args) => run(async () => {
      const { install_id: id, ...input } = args
      return installs.upgradePackageInstall(svc(), id, { ...input, source: 'mcp' })
    }))
  server.tool('packages_complete_setup', 'Complete setup of an incomplete install: supply the missing requirement values; the assets they unblock are enabled and its workflows activated.', {
    install_id: z.string(), values: values.optional(), dry_run: z.boolean().optional(),
  }, async (args) => run(() => installs.completePackageInstall(svc(), args.install_id, { values: args.values, dry_run: args.dry_run, source: 'mcp' })))
  server.tool('packages_uninstall', "Uninstall a package: removes its assets. Use dry_run first (every asset and what happens to it, unfinished runs, blockers); assets changed locally since install are kept unless force, data tables with rows unless delete_data; unfinished runs of the package's workflows block it unless cancel_runs.", {
    install_id: z.string(), dry_run: z.boolean().optional(), force: z.boolean().optional(), delete_data: z.boolean().optional(),
    cancel_runs: z.boolean().optional().describe("Cancel unfinished runs of the package's workflows first"),
  }, async (args) => run(() => installs.uninstallPackage(svc(), args.install_id, { ...args, source: 'mcp' })))
  server.tool('packages_history', 'Package history, newest first: every install, upgrade, reinstall, downgrade, reconfigure (complete setup) and uninstall, failed attempts included — who, when, channel, version from → to, signature status, counts, requirement changes, errors. packages_history_get adds the applied plan.', {
    package: z.string().optional().describe('Install id, package id or slug'),
    action: z.string().optional().describe('Comma-separated: install, upgrade, reinstall, downgrade, reconfigure, uninstall'),
    status: z.string().optional().describe('Comma-separated: succeeded, partial, failed'),
    channel: z.string().optional().describe('Comma-separated: ui, cli, api, mcp'),
    actor: z.string().optional().describe('User id or email'),
    since: z.string().optional().describe('YYYY-MM-DD or ISO timestamp'),
    until: z.string().optional().describe('YYYY-MM-DD (inclusive) or ISO timestamp'),
    ...page,
  }, async (args) => run(() => {
    const { limit, offset, ...filters } = args
    return history.listPackageEvents(svc(), filters, resolvePage({ limit, offset }))
  }))
  server.tool('packages_history_get', 'One package history event with the full plan / diff that was applied (secrets masked).', { event_id: z.string() },
    async (args) => run(() => history.getPackageEvent(svc(), args.event_id)))
}
