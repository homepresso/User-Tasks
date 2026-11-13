/**
 * Extension connector transports (`auth_config._transport = ext.<id>.<key>`):
 * the extension's `transports[key]` factory, only when the extension is
 * usable in the connection's workspace. See lib/integrations/transports.ts.
 */
import { TransportUnavailableError, type TransportContext } from '@/lib/integrations/transports'
import { createExtensionContext } from './host'
import { parseExtKey } from './manifest'
import { getServerExtension } from './server-registry'
import { extensionAccess } from './state'

export async function resolveExtensionTransport(kind: string, ctx: TransportContext): Promise<typeof fetch> {
  const parsed = parseExtKey(kind)
  const factory = parsed ? getServerExtension(parsed.extensionId)?.transports?.[parsed.key] : undefined
  if (!parsed || !factory) throw new TransportUnavailableError(`Connection transport "${kind}" is not installed in this build`)
  const access = await extensionAccess(ctx.tenantId, parsed.extensionId)
  if (!access.usable) throw new TransportUnavailableError(`Connection transport "${kind}": ${access.reason}`)
  const transport = await factory({
    ctx: createExtensionContext({ extensionId: parsed.extensionId, tenantId: ctx.tenantId }),
    config: ctx.integrationConfig,
  })
  return transport.fetch
}
