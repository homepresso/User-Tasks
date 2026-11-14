/**
 * Kerberos / SPNEGO tokens for the Windows transport. Node has no GSSAPI, so
 * tokens come from a pluggable provider:
 *
 *  - the `kerberos` npm package (Apache-2.0, native, MIT krb5 / Heimdal /
 *    SSPI), loaded lazily at run time from the server's node_modules. It is
 *    NOT a dependency of UserTasks: the build and the Vercel / Docker images
 *    never depend on a native module. Self-hosted installs add it with
 *    `npm install kerberos` (see /docs/integrations/windows-auth).
 *  - or a provider registered with registerSpnegoProvider() (tests, an
 *    extension that ships its own GSSAPI binding).
 *
 * Credentials are whatever GSSAPI finds: a ticket cache (KRB5CCNAME, from
 * `kinit`), or a client keytab (KRB5_CLIENT_KTNAME) that MIT krb5 uses to get
 * tickets on its own. The connection's password is never used for Kerberos.
 *
 * Server-only.
 */
import { createRequire } from 'node:module'
import path from 'node:path'

export interface SpnegoContext {
  /** Next token to send (base64), given the server's token (null on the first call). */
  step(serverToken: string | null): Promise<string>
  /** Verify the server's final (mutual-auth) token. */
  verify?(serverToken: string): Promise<void>
}

export interface SpnegoProvider {
  readonly name: string
  /**
   * Start a context for `spn` (`HTTP/host` or `HTTP@host`). `principal` is the
   * client principal to use (user@REALM) when the credential cache or keytab
   * holds more than one; null = the default principal.
   */
  initContext(spn: string, options: { principal: string | null }): Promise<SpnegoContext>
}

export class KerberosUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KerberosUnavailableError'
  }
}

export const KERBEROS_INSTALL_HINT =
  'Kerberos needs the optional `kerberos` package on the server: run `npm install kerberos` '
  + '(it builds against MIT krb5: `libkrb5-dev` / `krb5-devel`), restart, and provide a ticket cache '
  + '(KRB5CCNAME) or a client keytab (KRB5_CLIENT_KTNAME). See /docs/integrations/windows-auth'

let registered: SpnegoProvider | null = null

/** Use `provider` instead of the `kerberos` package (null restores the default). */
export function registerSpnegoProvider(provider: SpnegoProvider | null): void {
  registered = provider
  cachedNative = undefined
}

interface NativeKerberosClient {
  step(challenge: string): Promise<string>
  response?: string
  contextComplete?: boolean
}

interface NativeKerberosModule {
  initializeClient(service: string, options?: Record<string, unknown>): Promise<NativeKerberosClient>
  GSS_MECH_OID_SPNEGO?: number
}

let cachedNative: SpnegoProvider | null | undefined

/**
 * Load `kerberos` from the app's node_modules at run time. createRequire with
 * a computed name keeps bundlers from resolving (or failing on) the native
 * module at build time.
 */
function loadNativeModule(): NativeKerberosModule | null {
  const moduleName = ['kerb', 'eros'].join('')
  try {
    const req = createRequire(path.join(process.cwd(), 'package.json'))
    return req(moduleName) as NativeKerberosModule
  } catch {
    return null
  }
}

/** `HTTP/host` → `HTTP@host` (GSSAPI host-based service name). */
export function gssServiceName(spn: string): string {
  const slash = spn.indexOf('/')
  if (slash > 0) return `${spn.slice(0, slash)}@${spn.slice(slash + 1).split(':')[0]}`
  return spn
}

function nativeProvider(mod: NativeKerberosModule): SpnegoProvider {
  return {
    name: 'kerberos (npm)',
    async initContext(spn, { principal }) {
      const client = await mod.initializeClient(gssServiceName(spn), {
        ...(mod.GSS_MECH_OID_SPNEGO !== undefined ? { mechOID: mod.GSS_MECH_OID_SPNEGO } : {}),
        ...(principal ? { principal } : {}),
      })
      return {
        step: async (serverToken) => client.step(serverToken ?? ''),
        verify: async (serverToken) => { await client.step(serverToken) },
      }
    },
  }
}

/** The active provider, or null when none is available (no package, none registered). */
export function getSpnegoProvider(): SpnegoProvider | null {
  if (registered) return registered
  if (cachedNative === undefined) {
    const mod = loadNativeModule()
    cachedNative = mod && typeof mod.initializeClient === 'function' ? nativeProvider(mod) : null
  }
  return cachedNative
}

/**
 * Get the first Negotiate token for `spn`. Throws KerberosUnavailableError
 * (actionable message) when there is no provider, no ticket or no keytab.
 */
export async function initialKerberosToken(spn: string, principal: string | null): Promise<{ token: string; context: SpnegoContext }> {
  const provider = getSpnegoProvider()
  if (!provider) throw new KerberosUnavailableError(KERBEROS_INSTALL_HINT)
  let context: SpnegoContext
  let token: string
  try {
    context = await provider.initContext(spn, { principal })
    token = await context.step(null)
  } catch (error) {
    const detail = (error as Error)?.message ?? String(error)
    throw new KerberosUnavailableError(
      `Kerberos could not get a service ticket for ${spn}: ${detail}. Check the SPN, that the server can reach a KDC, `
      + 'and that a ticket cache (KRB5CCNAME) or client keytab (KRB5_CLIENT_KTNAME) holds credentials for the service account.',
    )
  }
  if (!token) throw new KerberosUnavailableError(`Kerberos returned an empty token for ${spn}`)
  return { token, context }
}
