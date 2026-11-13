/**
 * Connector transport hook: lets a connection supply its own HTTP transport
 * for integration calls (references, connection probes) — the seam NTLM,
 * Kerberos / SPNEGO and vendor JWT schemes plug into. Auth today is
 * header-only (lib/integrations/attach-auth); a transport performs the
 * request itself (handshakes, connection-bound auth, client certificates).
 *
 * A connection names its transport in `auth_config._transport`:
 *   - a core kind registered with registerTransport() (none yet; NTLM /
 *     Kerberos land here), or
 *   - `ext.<extension id>.<key>`: the extension's `transports[key]`, only
 *     when the extension is usable in the connection's workspace.
 *
 * Core keeps the rules that matter around it: connectorFetch still checks
 * every hop with the egress guard, owns the timeout budget, retries and
 * redirects, and strips credentials across origins. The transport only
 * replaces the single `fetch` call (ConnectorFetchOptions.fetchImpl).
 *
 * Server-only.
 */

export interface TransportContext {
  tenantId: string | null
  /** The decrypted integration config (base_url, auth_type, auth_config …). */
  integrationConfig: Record<string, unknown>
}

export type CoreTransportFactory = (ctx: TransportContext) => Promise<typeof fetch>

const coreTransports = new Map<string, CoreTransportFactory>()

export function registerTransport(kind: string, factory: CoreTransportFactory): void {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(kind)) throw new Error(`Invalid transport kind "${kind}"`)
  coreTransports.set(kind, factory)
}

export function transportKindOf(integrationConfig: Record<string, unknown> | null | undefined): string | null {
  const authConfig = (integrationConfig?.auth_config ?? {}) as Record<string, unknown>
  const kind = typeof authConfig._transport === 'string' ? authConfig._transport.trim() : ''
  return kind || null
}

export class TransportUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransportUnavailableError'
  }
}

/**
 * The fetch to use for this connection: undefined = the platform fetch (no
 * transport configured). Throws when a transport is configured but
 * unavailable — never silently falls back to a plain request.
 */
export async function resolveTransportFetch(ctx: TransportContext): Promise<typeof fetch | undefined> {
  const kind = transportKindOf(ctx.integrationConfig)
  if (!kind) return undefined
  if (kind.startsWith('ext.')) {
    const { resolveExtensionTransport } = await import('@/lib/extensions/transports')
    return resolveExtensionTransport(kind, ctx)
  }
  const factory = coreTransports.get(kind)
  if (!factory) throw new TransportUnavailableError(`Connection transport "${kind}" is not available in this build`)
  return factory(ctx)
}
