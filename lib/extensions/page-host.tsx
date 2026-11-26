/**
 * Server host for extension custom pages (/x/<id>/…): finds the longest
 * declared page path that prefixes the URL, checks that the extension is
 * usable in the workspace and the page's manifest guard passes for the
 * signed-in person, then renders the extension's component with the host API.
 * Returns null (→ not found) when any check fails.
 *
 * Instance-wide extensions (the Infrastructure add-on: licensed per
 * deployment, never enabled per workspace) serve their instance-admin pages
 * without a workspace enablement, while the instance-wide licence allows it
 * (lib/infrastructure/provider). The page's `instanceAdmin` guard still
 * applies.
 */

import type { ReactNode } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { getDeploymentMode } from '@/lib/deployment'
import { fromSession } from '@/lib/services/context'
import { createExtensionContext } from './host'
import { getExtensionManifest, hasExtensions } from './registry'
import { infrastructureAddon } from '@/lib/infrastructure/provider'
import { INFRASTRUCTURE_FEATURE } from '@/lib/infrastructure/addon'
import { extensionPage } from './pages'
import { extensionAccess } from './state'
import { evaluateGuard, permissionChecker, type ExtensionUiEntry } from './ui'
import { extensionUiEntries, isInstanceAdminSession } from './ui-server'

export async function renderExtensionPage(extensionId: string, segments: string[], searchParams: Record<string, string | string[] | undefined>): Promise<ReactNode | null> {
  const result = await resolveAndRender(extensionId, segments, searchParams, false)
  return result.kind === 'page' ? result.node : null
}

/** /x/<id>/…: the page, `signed_out` (the route sends the person to sign in and back), or not found. */
export async function renderExtensionPageResult(extensionId: string, segments: string[], searchParams: Record<string, string | string[] | undefined>): Promise<EmbeddedPageResult> {
  return resolveAndRender(extensionId, segments, searchParams, false)
}

export type EmbeddedPageResult = { kind: 'page'; node: ReactNode } | { kind: 'signed_out' } | { kind: 'not_found' }

/**
 * Trusted embedding (/embed/x/<id>/…): the same checks as /x/, for pages the
 * manifest declares `embeddable` only. `signed_out` lets the route offer a
 * sign-in that works from inside a frame.
 */
export async function renderEmbeddedExtensionPage(extensionId: string, segments: string[], searchParams: Record<string, string | string[] | undefined>): Promise<EmbeddedPageResult> {
  return resolveAndRender(extensionId, segments, searchParams, true)
}

/** Is /x/<id>/<path> served at /embed/x/… too (the declared page is embeddable)? */
export function isEmbeddableExtensionPath(extensionId: string, segments: string[]): boolean {
  const manifest = hasExtensions() ? getExtensionManifest(extensionId) : null
  return Boolean(manifest && declaredPage(manifest, segments.filter(Boolean))?.embeddable)
}

type Manifest = NonNullable<ReturnType<typeof getExtensionManifest>>

/**
 * The entry for an instance-wide extension (the licensed Infrastructure
 * add-on), which no workspace enables: its licence is per deployment
 * (tenant null). Null for any other extension, or while it is not licensed.
 */
async function instanceWideEntry(extensionId: string, manifest: Manifest): Promise<ExtensionUiEntry | null> {
  const addon = await infrastructureAddon()
  if (addon.state !== 'ready' || addon.resolved.extensionId !== extensionId) return null
  return { id: extensionId, name: manifest.name, version: manifest.version, licence: 'licensed', features: [addon.resolved.provider.feature ?? INFRASTRUCTURE_FEATURE], config: {} }
}

function declaredPage(manifest: Manifest, clean: string[]) {
  return manifest.contributes.ui.pages
    .filter((p) => p.path === '' || clean.join('/') === p.path || clean.join('/').startsWith(`${p.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

async function resolveAndRender(extensionId: string, segments: string[], searchParams: Record<string, string | string[] | undefined>, embedded: boolean): Promise<EmbeddedPageResult> {
  const notFound = { kind: 'not_found' } as const
  if (!hasExtensions()) return notFound
  const manifest = getExtensionManifest(extensionId)
  if (!manifest) return notFound
  const clean = segments.map((s) => decodeURIComponent(s)).filter(Boolean)
  const declared = declaredPage(manifest, clean)
  if (!declared) return notFound
  if (embedded && !declared.embeddable) return notFound
  const Component = extensionPage(extensionId, declared.path)
  if (!Component) return notFound
  if (declared.path === '' && clean.length && !manifest.contributes.ui.pages.some((p) => p.path === '')) return notFound

  let ctx
  try { ctx = await fromSession() } catch (error) { unstable_rethrow(error); return { kind: 'signed_out' } }
  const access = await extensionAccess(ctx.tenantId, extensionId)
  const entry = (access.usable ? (await extensionUiEntries(ctx.tenantId)).find((e) => e.id === extensionId) : undefined)
    ?? (declared.when?.instanceAdmin ? await instanceWideEntry(extensionId, manifest) : null)
  if (!entry) return notFound
  const state = { deployment: getDeploymentMode(), instanceAdmin: declared.when?.instanceAdmin ? await isInstanceAdminSession() : false }
  if (!evaluateGuard(declared.when ? { ...declared.when, managerOnly: undefined } : undefined, { has: permissionChecker(ctx.permissions ?? []) }, entry, state)) return notFound

  const host = createExtensionContext({ extensionId, tenantId: ctx.tenantId, actorId: ctx.actorId, db: ctx.supabase, permissions: ctx.permissions })
  return { kind: 'page', node: <Component ctx={host} extensionId={extensionId} path={clean} searchParams={searchParams} /> }
}
