/**
 * Server side of the UI contributions: the ExtensionUiState for the
 * signed-in person (rendered into the dashboard shell), and the checks that
 * guard UI actions and data sources — an action or source may only run when
 * an entry that names it is visible to the caller (the same guards the
 * shell evaluated), and the extension is usable in the workspace.
 *
 * Server-only. With no extensions in the build, loadExtensionUiState makes
 * no database call.
 */

import { unstable_rethrow } from 'next/navigation'
import { getDeploymentMode } from '@/lib/deployment'
import type { ServiceContext } from '@/lib/services/context'
import { ServiceError } from '@/lib/services/context'
import { getEntitlementPort } from './entitlement-port'
import type { ExtensionGuard, ExtensionManifest } from './manifest'
import { getExtensionManifest, hasExtensions } from './registry'
import { extensionAccess, loadTenantExtensions, usableExtensionIds } from './state'
import { EMPTY_EXTENSION_UI, evaluateGuard, permissionChecker, type ExtensionUiEntry, type ExtensionUiState } from './ui'

/** Does any usable manifest have an entry guarded by instanceAdmin (or an instance settings page)? */
function needsInstanceAdmin(manifests: ExtensionManifest[]): boolean {
  return manifests.some((m) => {
    const ui = m.contributes.ui
    const guards = [...ui.navItems, ...ui.navSections, ...ui.createEntries, ...ui.paletteEntries, ...ui.userMenu, ...ui.itemActions, ...ui.detailTabs, ...ui.widgets, ...ui.settingsPages, ...ui.pages].map((e) => e.when)
    return guards.some((g) => g?.instanceAdmin) || ui.settingsPages.some((p) => p.scope === 'instance')
  })
}

export async function isInstanceAdminSession(): Promise<boolean> {
  try {
    const [{ getSessionDbWithUser }, { viewerCanSeeInfrastructure }] = await Promise.all([
      import('@/lib/providers/db/session'),
      import('@/lib/admin/infrastructure'),
    ])
    const { user } = await getSessionDbWithUser()
    return await viewerCanSeeInfrastructure(user)
  } catch {
    return false
  }
}

/** The extension entries for one workspace (usable extensions only). */
export async function extensionUiEntries(tenantId: string): Promise<ExtensionUiEntry[]> {
  const ids = await usableExtensionIds(tenantId)
  if (!ids.length) return []
  const { rows } = await loadTenantExtensions(tenantId)
  const port = getEntitlementPort()
  const entries: ExtensionUiEntry[] = []
  for (const id of ids) {
    const manifest = getExtensionManifest(id)
    if (!manifest) continue
    const decision = await port.check({ tenantId, extensionId: id })
    const features: string[] = []
    for (const feature of manifest.licence.features) {
      if ((await port.check({ tenantId, extensionId: id, feature })).allowed) features.push(feature)
    }
    entries.push({ id, name: manifest.name, version: manifest.version, licence: decision.state, features, config: { ...(rows.get(id)?.config ?? {}) } })
  }
  return entries
}

/**
 * The shell's extension state for the signed-in person. Never throws: a
 * failure (no session, table missing) renders the shell without extensions.
 */
export async function loadExtensionUiState(ctx?: Pick<ServiceContext, 'tenantId'>): Promise<ExtensionUiState> {
  const deployment = getDeploymentMode()
  if (!hasExtensions()) return { ...EMPTY_EXTENSION_UI, deployment }
  try {
    let tenantId = ctx?.tenantId
    if (!tenantId) {
      const { fromSession } = await import('@/lib/services/context')
      tenantId = (await fromSession()).tenantId
    }
    const extensions = await extensionUiEntries(tenantId)
    const manifests = extensions.map((e) => getExtensionManifest(e.id)).filter((m): m is ExtensionManifest => Boolean(m))
    const instanceAdmin = extensions.length > 0 && needsInstanceAdmin(manifests) ? await isInstanceAdminSession() : false
    return { extensions, deployment, instanceAdmin }
  } catch (error) {
    // Next's own control-flow errors (dynamic rendering, redirects) must propagate.
    unstable_rethrow(error)
    if (!(error instanceof ServiceError)) console.warn('[extensions] UI state unavailable:', error instanceof Error ? error.message : error)
    return { ...EMPTY_EXTENSION_UI, deployment }
  }
}

type Reference = { kind: 'action'; name: string } | { kind: 'data'; name: string }

/** Guards of every UI entry that names this action / data source. */
export function guardsReferencing(manifest: ExtensionManifest, ref: Reference): Array<ExtensionGuard | undefined> {
  const ui = manifest.contributes.ui
  const guards: Array<ExtensionGuard | undefined> = []
  if (ref.kind === 'action') {
    for (const entry of [...ui.navItems, ...ui.createEntries, ...ui.paletteEntries, ...ui.userMenu, ...ui.itemActions]) {
      if ('action' in entry.target && entry.target.action === ref.name) guards.push(entry.when)
    }
    for (const page of ui.settingsPages) {
      if (page.schema.actions?.some((a) => a.action === ref.name)) guards.push(page.when)
    }
    // Custom pages may run any action of their extension (their own guard applies).
    for (const page of ui.pages) guards.push(page.when)
  } else {
    for (const item of ui.navItems) if (item.badge?.source === ref.name) guards.push(item.when)
    for (const widget of ui.widgets) if (widget.source === ref.name) guards.push(widget.when)
    for (const tab of ui.detailTabs) if (tab.source === ref.name) guards.push(tab.when)
  }
  return guards
}

/**
 * Throw unless the caller may run this action / data source: the extension
 * is usable in the workspace and at least one entry naming it is visible.
 */
export async function assertUiReference(ctx: ServiceContext, extensionId: string, ref: Reference): Promise<ExtensionManifest> {
  const manifest = getExtensionManifest(extensionId)
  if (!manifest) throw ServiceError.notFound(`Extension "${extensionId}" is not installed`)
  const access = await extensionAccess(ctx.tenantId, extensionId)
  if (!access.usable) throw ServiceError.forbidden(access.reason ?? 'Extension not available')
  const guards = guardsReferencing(manifest, ref)
  if (!guards.length) throw ServiceError.notFound(`${manifest.name} has no ${ref.kind === 'action' ? 'action' : 'data source'} "${ref.name}" in its UI`)
  const entry = (await extensionUiEntries(ctx.tenantId)).find((e) => e.id === extensionId)
  if (!entry) throw ServiceError.forbidden('Extension not available')
  const subject = { has: permissionChecker(ctx.permissions ?? []) }
  const needsAdmin = guards.some((g) => g?.instanceAdmin)
  const state = { deployment: getDeploymentMode(), instanceAdmin: needsAdmin ? await isInstanceAdminSession() : false }
  // managerOnly entries: treated as visible here (the shell decided); data stays behind the handler's own checks.
  if (!guards.some((g) => evaluateGuard(g ? { ...g, managerOnly: undefined } : g, subject, entry, state))) {
    throw ServiceError.forbidden('Forbidden')
  }
  return manifest
}
