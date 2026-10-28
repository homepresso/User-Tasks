'use server'

import { revalidatePath } from 'next/cache'
import { fromSession, isServiceError, requirePerm } from '@/lib/services/context'
import * as packages from '@/lib/services/packages'
import { searchPackageAssets, type AssetSearchInput } from '@/lib/services/package-assets'
import * as installs from '@/lib/services/package-installs'
import * as history from '@/lib/services/package-events'
import type { RequirementValues } from '@/lib/packages/requirements'

/*
 * Settings → Packages server actions: thin wrappers over lib/services/packages
 * and lib/services/package-installs (the same services as /api/v1/packages*,
 * MCP packages_* and `usertasks packages …`). Package tables are
 * service-role only; the services elevate after their permission checks.
 * Expected failures come back as { ok: false, error } (thrown Server Function
 * errors are redacted in production).
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; details?: unknown }

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message, details: error.details }
    throw error
  }
}

const PATH = '/settings/packages'
const PATHS = [PATH, '/packages']
const revalidate = () => { for (const path of PATHS) revalidatePath(path) }

/** The signed-in user's context, in another workspace they belong to when `tenantId` is given. */
const sessionFor = (tenantId?: string | null) => fromSession(tenantId ? { tenantId } : {})

export async function listPackagesAction() {
  return run(async () => (await packages.listPackages(await fromSession(), { limit: null, offset: 0 })).packages)
}

export async function getPackageAction(id: string) {
  return run(async () => packages.getPackage(await fromSession(), id))
}

export async function getPackageContentsAction(id: string) {
  return run(async () => packages.getPackageContents(await fromSession(), id))
}

export async function previewPackageAction(input: Parameters<typeof packages.previewPackageContents>[1]) {
  return run(async () => packages.previewPackageContents(await fromSession(), input))
}

export async function createPackageAction(input: packages.PackageCreateInput) {
  return run(async () => {
    const result = await packages.createPackage(await fromSession(), input)
    revalidate()
    return result.package
  })
}

export async function updatePackageAction(id: string, input: packages.PackageUpdateInput) {
  return run(async () => (await packages.updatePackage(await fromSession(), id, input)).package)
}

export async function deletePackageAction(id: string) {
  return run(async () => packages.deletePackage(await fromSession(), id))
}

export async function buildPackageVersionAction(id: string, input: packages.BuildVersionInput) {
  return run(async () => {
    const built = await packages.buildPackageVersion(await fromSession(), id, { ...input, include_file: true })
    return { version: built.version, warnings: built.warnings, file_name: built.file_name, file_base64: built.file_base64!, requirements: built.manifest.requirements.length }
  })
}

export async function downloadPackageVersionAction(id: string, version: string) {
  return run(async () => {
    const file = await packages.downloadPackageVersion(await fromSession(), id, version)
    return { file_name: file.file_name, file_base64: Buffer.from(file.bytes).toString('base64') }
  })
}

/** Server-side asset search for the package editor picker (paged, every packageable type). */
export async function searchPackageAssetsAction(input: AssetSearchInput) {
  return run(async () => searchPackageAssets(await fromSession(), input))
}

export async function listInstallsAction() {
  return run(async () => (await installs.listPackageInstalls(await fromSession(), { limit: null, offset: 0 })).installs)
}

export async function getInstallAction(id: string) {
  return run(async () => installs.getPackageInstall(await fromSession(), id))
}

export async function inspectPackageFileAction(file: string, tenantId?: string | null) {
  return run(async () => installs.inspectAgainstWorkspace(await sessionFor(tenantId), { file }))
}

export interface InstallActionInput {
  file: string
  file_name?: string
  values?: RequirementValues
  keep_incomplete?: boolean
  adopt_by_name?: boolean
  data?: Record<string, 'merge' | 'replace' | 'skip'>
  keep_local_changes?: boolean
  /** Install into another workspace the user belongs to (from the Authored library). */
  tenant_id?: string | null
  /** 'library' when the file was taken from a package authored in a workspace. */
  source?: 'file' | 'library'
}

function installInput(input: InstallActionInput): installs.PackageInstallInput {
  const { tenant_id: _tenant, source, ...rest } = input
  return { ...rest, source: source ?? 'file', source_label: input.file_name }
}

export async function planInstallAction(input: InstallActionInput) {
  return run(async () => installs.planPackageInstall(await sessionFor(input.tenant_id), installInput(input)))
}

export async function installPackageAction(input: InstallActionInput) {
  return run(async () => {
    const result = await installs.installPackage(await sessionFor(input.tenant_id), installInput(input))
    revalidate()
    return result
  })
}

export async function completeInstallAction(id: string, values: RequirementValues, dryRun = false) {
  return run(async () => installs.completePackageInstall(await fromSession(), id, { values, dry_run: dryRun }))
}

export async function uninstallAction(id: string, input: { dry_run?: boolean; force?: boolean; delete_data?: boolean; cancel_runs?: boolean }) {
  return run(async () => {
    const result = await installs.uninstallPackage(await fromSession(), id, input)
    if (!input.dry_run) revalidate()
    return result
  })
}

export async function listPackageEventsAction(filters: history.PackageEventFilters, page: { limit: number; offset: number }) {
  return run(async () => history.listPackageEvents(await fromSession(), filters, { limit: Math.min(Math.max(page.limit, 1), 200), offset: Math.max(page.offset, 0) }))
}

export async function getPackageEventAction(id: string) {
  return run(async () => (await history.getPackageEvent(await fromSession(), id)).event)
}

export async function exportPackageEventsCsvAction(filters: history.PackageEventFilters) {
  return run(async () => history.packageEventsCsv(await fromSession(), filters))
}

/** Other workspaces the user can install packages into (Authored → Install in another workspace). */
export async function listInstallTargetsAction() {
  return run(async () => {
    const ctx = await fromSession()
    requirePerm(ctx, 'packages.view')
    const { data, error } = await (ctx.supabase as any).rpc('get_user_tenant_ids') // eslint-disable-line @typescript-eslint/no-explicit-any -- untyped RPC
    if (error) throw new Error(error.message)
    const ids = [...new Set(((data ?? []) as unknown[]).map((row) => String(typeof row === 'object' && row !== null ? Object.values(row)[0] : row)))].filter((id) => id && id !== ctx.tenantId)
    if (!ids.length) return []
    const { data: tenants } = await ctx.supabase.from('tenants').select('id, name').in('id', ids)
    const out: Array<{ id: string; name: string }> = []
    for (const tenant of (tenants ?? []) as Array<{ id: string; name: string }>) {
      try {
        const other = await fromSession({ tenantId: tenant.id })
        if (other.permissions?.has('packages.install')) out.push({ id: tenant.id, name: tenant.name })
      } catch { /* not a member any more */ }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  })
}
