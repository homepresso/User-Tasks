/**
 * The Infrastructure add-on's provider (lib/extensions/sdk InfrastructureProvider),
 * found among the build's extensions: the first compatible extension whose
 * server module has `infrastructure`. Core uses it for everything that
 * CHANGES providers and refuses those calls itself when it is missing or not
 * licensed — the add-on being hidden in the UI is never the only gate.
 *
 * Licence: instance-wide (tenantId null) for the provider's `feature`
 * (`infrastructure-separation`), through extensionAccess → the licensing
 * entitlement port: an expired licence keeps working for 24 hours, then
 * changes stop. Nothing here is consulted to RUN the configured providers, so
 * a missing or expired licence never stops a running install.
 *
 * Server-only.
 */
import type { ExtensionContext, InfrastructureProvider } from '@/lib/extensions/sdk'
import { hasExtensions } from '@/lib/extensions/registry'
import { getDeploymentMode } from '@/lib/deployment'
import { addonRequiredMessage, INFRASTRUCTURE_FEATURE } from './addon'

export interface ResolvedInfrastructureProvider {
  extensionId: string
  provider: InfrastructureProvider
  ctx: ExtensionContext
}

export type InfrastructureAddonState =
  /** No extension in this build provides it. */
  | { state: 'missing'; reason: string }
  /** Installed but not usable now (no licence, expired more than 24 hours ago, wrong feature). */
  | { state: 'unlicensed'; extensionId: string; reason: string; href: string; licenceReason?: string | null }
  | { state: 'ready'; resolved: ResolvedInfrastructureProvider; warning: string | null }

type Override = (() => Promise<InfrastructureAddonState>) | null
const SLOT = Symbol.for('usertasks.infrastructure.provider')
const state: { override: Override } = ((globalThis as unknown as Record<symbol, { override: Override }>)[SLOT] ??= { override: null })

/** Whether the add-on can change infrastructure now, and why not. */
export async function infrastructureAddon(): Promise<InfrastructureAddonState> {
  if (state.override) return state.override()
  if (!hasExtensions()) return { state: 'missing', reason: addonRequiredMessage() }
  const [{ getServerExtensions }, { extensionAccess }, { createExtensionContext }] = await Promise.all([
    import('@/lib/extensions/server-registry'),
    import('@/lib/extensions/state'),
    import('@/lib/extensions/host'),
  ])
  for (const server of getServerExtensions()) {
    const provider = server.infrastructure
    if (!provider) continue
    const access = await extensionAccess(null, server.id, provider.feature ?? INFRASTRUCTURE_FEATURE)
    if (!access.usable) {
      return { state: 'unlicensed', extensionId: server.id, href: provider.href, reason: `${addonRequiredMessage()} ${access.reason ?? ''}`.trim(), licenceReason: access.reason ?? null }
    }
    return {
      state: 'ready',
      warning: access.entitlement.reason ?? null,
      resolved: { extensionId: server.id, provider, ctx: createExtensionContext({ extensionId: server.id, tenantId: null }) },
    }
  }
  return { state: 'missing', reason: addonRequiredMessage() }
}

/** The licensed provider, or null. */
export async function resolveInfrastructureProvider(): Promise<ResolvedInfrastructureProvider | null> {
  const addon = await infrastructureAddon()
  return addon.state === 'ready' ? addon.resolved : null
}

/** What pages show about the add-on (no functions: safe to pass to client components). */
export interface InfrastructureAddonView {
  state: 'missing' | 'unlicensed' | 'ready'
  /** The add-on's page when installed. */
  href: string | null
  /** Why changes are unavailable (missing / unlicensed), or the expiry warning (ready). */
  reason: string | null
  /**
   * UserTasks Cloud: paid extensions are for self-hosted installs, so pages
   * show the status read-only instead of the add-on's card and Change… links.
   */
  cloud?: boolean
}

export async function infrastructureAddonView(): Promise<InfrastructureAddonView> {
  const view = await addonView()
  return getDeploymentMode() === 'cloud' ? { ...view, cloud: true } : view
}

async function addonView(): Promise<InfrastructureAddonView> {
  try {
    const addon = await infrastructureAddon()
    if (addon.state === 'ready') return { state: 'ready', href: addon.resolved.provider.href, reason: addon.warning }
    // Pages say "installed, but no usable licence: <why>", so only the licence's own reason (not the whole refusal again).
    if (addon.state === 'unlicensed') return { state: 'unlicensed', href: addon.href, reason: addon.licenceReason || addon.reason }
    return { state: 'missing', href: null, reason: addon.reason }
  } catch (error) {
    return { state: 'missing', href: null, reason: `${addonRequiredMessage()} (${(error as Error).message})` }
  }
}

/** Test hook: a fixed answer, or undefined to restore the registry lookup. */
export function __setInfrastructureAddonForTests(answer: InfrastructureAddonState | undefined): void {
  state.override = answer === undefined ? null : async () => answer
}
