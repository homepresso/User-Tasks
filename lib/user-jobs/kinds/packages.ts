import { z } from 'zod'
import { requirePerm, ServiceError } from '@/lib/services/context'
import * as packages from '@/lib/services/packages'
import * as installs from '@/lib/services/package-installs'
import { packageEventsCsv } from '@/lib/services/package-events'
import { defineJobKind } from '../define'

/*
 * Settings → Packages: build & download, download a version, install /
 * upgrade, complete setup and uninstall. Same services as the server
 * actions, /api/v1/packages* and the CLI; the services check the
 * permissions (packages.manage / view / install plus each asset's own).
 * The .utpkg travels as a job input or result file instead of base64 inside
 * a server action response.
 */

const uuid = z.string().uuid()
const values = z.record(z.string(), z.record(z.string(), z.unknown()))

export const packageBuildJob = defineJobKind({
  kind: 'package.build',
  effect: 'download',
  params: z.object({
    package_id: uuid,
    name: z.string().max(200).default('package'),
    version: z.string().max(64).optional(),
    bump: z.enum(['major', 'minor', 'patch']).optional(),
    notes: z.string().max(5000).nullable().optional(),
  }),
  title: (p) => `Build package “${p.name}”`,
  authorize: (ctx) => requirePerm(ctx, 'packages.manage'),
  async run({ ctx, params, progress }) {
    await progress(10, 'Exporting and signing')
    const built = await packages.buildPackageVersion(ctx, params.package_id, {
      ...(params.version ? { version: params.version } : {}),
      ...(params.bump ? { bump: params.bump } : {}),
      notes: params.notes ?? null,
      include_file: true,
    })
    const version = String(built.version?.version ?? '')
    return {
      file: { name: built.file_name, contentType: 'application/zip', body: packages.decodePackageFile(built.file_base64 ?? '') },
      data: { version: built.version, warnings: built.warnings, file_name: built.file_name, requirements: built.manifest.requirements.length },
      summary: `Version ${version} built${built.warnings.length ? ` (${built.warnings.length} warning${built.warnings.length === 1 ? '' : 's'})` : ''}`,
    }
  },
})

export const packageDownloadJob = defineJobKind({
  kind: 'package.download',
  effect: 'download',
  maxAttempts: 3,
  params: z.object({ package_id: uuid, version: z.string().min(1).max(64), name: z.string().max(200).default('package') }),
  title: (p) => `Download ${p.name} ${p.version}`,
  authorize: (ctx) => requirePerm(ctx, 'packages.view'),
  async run({ ctx, params }) {
    const file = await packages.downloadPackageVersion(ctx, params.package_id, params.version)
    return { file: { name: file.file_name, contentType: 'application/zip', body: file.bytes }, summary: file.file_name }
  },
})

export const packageInstallJob = defineJobKind({
  kind: 'package.install',
  effect: 'change',
  input: { maxBytes: 25 * 1024 * 1024 },
  params: z.object({
    file_name: z.string().max(200).optional(),
    name: z.string().max(200).default('package'),
    values: values.optional(),
    keep_incomplete: z.boolean().optional(),
    adopt_by_name: z.boolean().optional(),
    data: z.record(z.string(), z.enum(['merge', 'replace', 'skip'])).optional(),
    keep_local_changes: z.boolean().optional(),
    /** library: the file was taken from a package authored in another workspace. */
    source: z.enum(['file', 'library']).default('file'),
  }),
  title: (p) => `Install ${p.name}`,
  authorize: (ctx) => requirePerm(ctx, 'packages.install'),
  async run({ ctx, params, progress, readInput }) {
    const bytes = await readInput()
    if (!bytes) throw ServiceError.validation('The package file is missing')
    const { name, ...input } = params
    await progress(10, `Installing ${name}`)
    const result = await installs.installPackage(ctx, {
      ...input,
      file: Buffer.from(bytes).toString('base64'),
      source: params.source,
      source_label: params.file_name,
    })
    const s = result.plan.summary
    return { data: result, counts: { ...s }, summary: `${s.create} created, ${s.update} updated, ${s.unchanged} unchanged` }
  },
})

export const packageCompleteJob = defineJobKind({
  kind: 'package.complete',
  effect: 'change',
  params: z.object({ install_id: uuid, name: z.string().max(200).default('package'), values }),
  title: (p) => `Complete setup of ${p.name}`,
  authorize: (ctx) => requirePerm(ctx, 'packages.install'),
  async run({ ctx, params }) {
    const result = await installs.completePackageInstall(ctx, params.install_id, { values: params.values, dry_run: false })
    return { data: result, summary: 'Setup completed' }
  },
})

export const packageUninstallJob = defineJobKind({
  kind: 'package.uninstall',
  effect: 'change',
  params: z.object({ install_id: uuid, name: z.string().max(200).default('package'), force: z.boolean().optional(), delete_data: z.boolean().optional(), cancel_runs: z.boolean().optional() }),
  title: (p) => `Uninstall ${p.name}`,
  authorize: (ctx) => requirePerm(ctx, 'packages.install'),
  async run({ ctx, params }) {
    const result = await installs.uninstallPackage(ctx, params.install_id, { force: params.force, delete_data: params.delete_data, cancel_runs: params.cancel_runs })
    const errors = 'errors' in result ? (result.errors?.length ?? 0) : 0
    const removed = result.summary.delete - errors
    return {
      data: result,
      counts: { removed, kept: result.summary.skip, errors },
      summary: `${removed} item${removed === 1 ? '' : 's'} removed${result.summary.skip ? `, ${result.summary.skip} kept` : ''}${errors ? `, ${errors} failed` : ''}`,
    }
  },
})

/** Package history → CSV (the History tab's Export CSV), same filters as the list. */
export const packageHistoryCsvJob = defineJobKind({
  kind: 'package.history_csv',
  effect: 'download',
  maxAttempts: 3,
  params: z.object({
    package: z.string().max(200).nullish(),
    action: z.string().max(200).nullish(),
    status: z.string().max(200).nullish(),
    channel: z.string().max(200).nullish(),
    actor: z.string().max(320).nullish(),
    since: z.string().max(40).nullish(),
    until: z.string().max(40).nullish(),
  }),
  title: () => 'Package history (CSV)',
  authorize: (ctx) => requirePerm(ctx, 'packages.view'),
  async run({ ctx, params, progress }) {
    await progress(10, 'Collecting events')
    const csv = await packageEventsCsv(ctx, params)
    return { file: { name: csv.file_name, contentType: 'text/csv; charset=utf-8', body: csv.csv }, counts: { rows: csv.rows }, summary: `${csv.rows} event${csv.rows === 1 ? '' : 's'}` }
  },
})
