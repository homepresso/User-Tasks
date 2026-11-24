/**
 * Finds the processing provider among the build's extensions (the first
 * compatible extension whose server module has `processing` and whose
 * licence allows it) and registers that lookup with lib/processing/handoff.
 * Called once per process at startup: instrumentation.ts (web app) and
 * scripts/worker.ts (scheduler / processor). Kept out of handoff.ts so the
 * queue kick does not pull the extension and services graph into every
 * server function.
 *
 * Server-only.
 */
import { setProcessingProviderResolver, type ResolvedProcessingProvider } from './handoff'

export async function resolveFromExtensions(): Promise<ResolvedProcessingProvider | null> {
  const [{ getServerExtensions }, { extensionAccess }, { createExtensionContext }] = await Promise.all([
    import('@/lib/extensions/server-registry'),
    import('@/lib/extensions/state'),
    import('@/lib/extensions/host'),
  ])
  for (const server of getServerExtensions()) {
    const provider = server.processing
    if (!provider) continue
    const access = await extensionAccess(null, server.id, provider.feature)
    if (!access.usable) continue
    return { extensionId: server.id, provider, ctx: createExtensionContext({ extensionId: server.id, tenantId: null }) }
  }
  return null
}

export function registerProcessingProviderResolver(): void {
  setProcessingProviderResolver(resolveFromExtensions)
}
