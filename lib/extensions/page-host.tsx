/**
 * Server host for extension custom pages (/x/<id>/…): finds the longest
 * declared page path that prefixes the URL, checks that the extension is
 * usable in the workspace and the page's manifest guard passes for the
 * signed-in person, then renders the extension's component with the host API.
 * Returns null (→ not found) when any check fails.
 */

import type { ReactNode } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { getDeploymentMode } from '@/lib/deployment'
import { fromSession } from '@/lib/services/context'
import { createExtensionContext } from './host'
import { getExtensionManifest, hasExtensions } from './registry'
import { extensionPage } from './pages'
import { extensionAccess } from './state'
import { evaluateGuard, permissionChecker } from './ui'
import { extensionUiEntries, isInstanceAdminSession } from './ui-server'

export async function renderExtensionPage(extensionId: string, segments: string[], searchParams: Record<string, string | string[] | undefined>): Promise<ReactNode | null> {
  if (!hasExtensions()) return null
  const manifest = getExtensionManifest(extensionId)
  if (!manifest) return null
  const clean = segments.map((s) => decodeURIComponent(s)).filter(Boolean)
  const declared = manifest.contributes.ui.pages
    .filter((p) => p.path === '' || clean.join('/') === p.path || clean.join('/').startsWith(`${p.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (!declared) return null
  const Component = extensionPage(extensionId, declared.path)
  if (!Component) return null
  if (declared.path === '' && clean.length && !manifest.contributes.ui.pages.some((p) => p.path === '')) return null

  let ctx
  try { ctx = await fromSession() } catch (error) { unstable_rethrow(error); return null }
  const access = await extensionAccess(ctx.tenantId, extensionId)
  if (!access.usable) return null
  const entry = (await extensionUiEntries(ctx.tenantId)).find((e) => e.id === extensionId)
  if (!entry) return null
  const state = { deployment: getDeploymentMode(), instanceAdmin: declared.when?.instanceAdmin ? await isInstanceAdminSession() : false }
  if (!evaluateGuard(declared.when ? { ...declared.when, managerOnly: undefined } : undefined, { has: permissionChecker(ctx.permissions ?? []) }, entry, state)) return null

  const host = createExtensionContext({ extensionId, tenantId: ctx.tenantId, actorId: ctx.actorId, db: ctx.supabase })
  return <Component ctx={host} extensionId={extensionId} path={clean} searchParams={searchParams} />
}
