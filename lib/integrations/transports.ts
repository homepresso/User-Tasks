/**
 * Connector transport hook: lets a connection supply its own HTTP transport
 * for integration calls (references, connection probes) — the seam NTLM,
 * Kerberos / SPNEGO and vendor JWT schemes plug into. Auth today is
 * header-only (lib/integrations/attach-auth); a transport performs the
 * request itself (handshakes, connection-bound auth, client certificates).
 *
 * A connection names its transport in `auth_config._transport`:
 *   - a core kind: `windows` (built in, NTLMv2 / Negotiate / Kerberos —
 *     lib/integrations/windows-auth), or one registered with
 *     registerTransport(), or
 *   - `ext.<extension id>.<key>`: the extension's `transports[key]`, only
 *     when the extension is usable in the connection's workspace.
 * `auth_type: windows` implies `_transport: windows` unless another
 * transport is named explicitly. `gateway` (built in, lib/gateway/transport)
 * sends the request through one of the workspace's on-premises gateways: a
 * REMOTE transport — the server never dials the URL itself, so connectorFetch
 * skips its own egress check and the gateway's allowlist applies instead
 * (markRemoteTransport / isRemoteTransport).
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
  /**
   * Send without the connection's credentials (TLS trust and proxy only).
   * Only transports that support it may be asked (core `windows`); others
   * are refused rather than risk sending credentials.
   */
  anonymous?: boolean
  /** The integrations row the request is made for (audit trail of remote transports). */
  integrationId?: string | null
}

export type CoreTransportFactory = (ctx: TransportContext) => Promise<typeof fetch>

const coreTransports = new Map<string, CoreTransportFactory>()

/** Built-in kinds, loaded on first use (keeps node:http/tls code out of unrelated bundles). */
const builtinTransports: Record<string, () => Promise<CoreTransportFactory>> = {
  windows: async () => (await import('./windows-auth/factory')).windowsTransportFactory,
  gateway: async () => (await import('@/lib/gateway/transport')).gatewayTransportFactory,
}

/** Transports that may be asked for anonymous requests (they keep TLS trust / routing but drop credentials). */
const ANONYMOUS_CAPABLE = new Set(['windows', 'gateway'])

const REMOTE = Symbol.for('usertasks.transport.remote')

/**
 * Mark a transport fetch as remote: the request is carried elsewhere (an
 * on-premises gateway) and never dialled from this server, so the server's
 * egress guard does not apply to it (the remote side enforces its own).
 */
export function markRemoteTransport<T extends typeof fetch>(fn: T): T {
  Object.defineProperty(fn, REMOTE, { value: true })
  return fn
}

export function isRemoteTransport(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as unknown as Record<symbol, unknown>)[REMOTE] === true
}

export function registerTransport(kind: string, factory: CoreTransportFactory): void {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(kind)) throw new Error(`Invalid transport kind "${kind}"`)
  coreTransports.set(kind, factory)
}

export function transportKindOf(integrationConfig: Record<string, unknown> | null | undefined): string | null {
  const authConfig = (integrationConfig?.auth_config ?? {}) as Record<string, unknown>
  const kind = typeof authConfig._transport === 'string' ? authConfig._transport.trim() : ''
  if (kind) return kind
  return integrationConfig?.auth_type === 'windows' ? 'windows' : null
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
  if (ctx.anonymous && !ANONYMOUS_CAPABLE.has(kind)) throw new TransportUnavailableError(`Connection transport "${kind}" cannot send anonymous requests`)
  if (kind.startsWith('ext.')) {
    const { resolveExtensionTransport } = await import('@/lib/extensions/transports')
    return resolveExtensionTransport(kind, ctx)
  }
  const factory = coreTransports.get(kind) ?? (Object.hasOwn(builtinTransports, kind) ? await builtinTransports[kind]() : undefined)
  if (!factory) throw new TransportUnavailableError(`Connection transport "${kind}" is not available in this build`)
  return factory(ctx)
}
