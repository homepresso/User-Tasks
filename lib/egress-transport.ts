import dns from 'node:dns'
import net from 'node:net'
import { Agent, buildConnector, fetch as undiciFetch } from 'undici'

/**
 * The connection-pinned transport for outbound traffic the egress guard
 * checks (connectors / API references / HTTP Request / Call Reference,
 * workflow file fetches, agent tools, log export).
 *
 * The guard checks a URL's host before each request, but plain fetch()
 * resolved the name AGAIN to connect: a name answering a public address to
 * the check and 127.0.0.1 / 169.254.169.254 to the connect (DNS rebinding)
 * reached internal services. Here the socket's own DNS lookup is the check:
 * the name is resolved once, every address is checked against the egress
 * policy (private ranges, metadata endpoints, special-purpose ranges,
 * ALLOW_PRIVATE_EGRESS / EGRESS_PRIVATE_ALLOW exactly as the guard applies
 * them), and the socket connects only to those checked addresses. The URL
 * keeps its hostname, so TLS SNI, certificate checks and Host are unchanged.
 * IP-literal hosts (no lookup) are checked before connecting.
 *
 * Server-only (undici is a server external): never imported by client code.
 * Import egressFetch from lib/egress-guard (which installs the address check
 * below); this module has no import of the guard, so there is no cycle.
 */

type AddressCheck = (host: string, address: string) => void

/** Until lib/egress-guard installs the real check, every address is refused (fail closed). */
let assertSafeResolvedAddress: AddressCheck = (host) => {
  throw Object.assign(new Error(`Egress check not configured; refusing to connect to ${host}`), { code: 'EGRESS_UNCONFIGURED' })
}

/** Called once by lib/egress-guard with its assertSafeResolvedAddress. */
export function installEgressAddressCheck(check: AddressCheck): void {
  assertSafeResolvedAddress = check
}

type LookupAddress = { address: string; family: number }
type Resolver = (hostname: string) => Promise<LookupAddress[]>

const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses)))
  })

let resolver: Resolver = systemResolver

/** Test seam: replace the DNS resolver (null restores the system resolver). */
export function setEgressResolver(next: Resolver | null): void {
  resolver = next ?? systemResolver
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/** net/tls `lookup`: resolve once, refuse unless every address is allowed, connect only to those. */
export function egressLookup(hostname: string, options: dns.LookupOptions | LookupCallback, callback?: LookupCallback): void {
  const cb = (typeof options === 'function' ? options : callback) as LookupCallback
  const opts = (typeof options === 'object' && options ? options : {}) as dns.LookupOptions
  resolver(hostname).then(
    (all) => {
      const addresses = opts.family === 4 || opts.family === 6 ? all.filter((a) => a.family === opts.family) : all
      if (!addresses.length) return cb(Object.assign(new Error(`No addresses for ${hostname}`), { code: 'ENOTFOUND' }), [])
      try {
        // Any blocked address refuses the name (as assertSafeEgressHost does):
        // a mixed answer is how rebinding attacks hedge.
        for (const { address } of addresses) assertSafeResolvedAddress(hostname, address)
      } catch (error) {
        return cb(error as NodeJS.ErrnoException, [])
      }
      if (opts.all) cb(null, addresses)
      else cb(null, addresses[0].address, addresses[0].family)
    },
    (error: NodeJS.ErrnoException) => cb(error, []),
  )
}

const baseConnect = buildConnector({ lookup: egressLookup as never })

/** undici connector: IP literals are checked here (net does not call lookup for them). */
const connect: buildConnector.connector = (options, callback) => {
  const host = String(options.hostname ?? '').replace(/^\[|\]$/g, '')
  if (net.isIP(host)) {
    try {
      assertSafeResolvedAddress(host, host)
    } catch (error) {
      callback(error as Error, null)
      return
    }
  }
  baseConnect(options, callback)
}

let agent: Agent | null = null

/** The shared pinned dispatcher (keep-alive pooled per origin; a pooled socket keeps its checked address). */
export function egressDispatcher(): Agent {
  agent ??= new Agent({ connect })
  return agent
}

/**
 * Bodies built with the runtime's own FormData / Blob / URLSearchParams /
 * ReadableStream (Node's bundled undici) are serialised through the global
 * Response first: undici's own fetch does not recognise another copy's
 * classes. Strings and bytes pass through.
 */
async function portableInit(init: RequestInit | undefined): Promise<RequestInit | undefined> {
  const body = init?.body
  if (body == null || typeof body === 'string' || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return init
  const encoded = new Response(body as BodyInit)
  const headers = new Headers(init!.headers)
  const type = encoded.headers.get('content-type')
  if (type && !headers.has('content-type')) headers.set('content-type', type)
  return { ...init, headers, body: new Uint8Array(await encoded.arrayBuffer()) }
}

/**
 * fetch() over the pinned dispatcher. Callers follow redirects themselves
 * (redirect: 'manual', re-checking each hop). Returns undici's Response (the
 * same Web API as the global one).
 */
export const egressFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  // Unit tests fake upstreams by stubbing the global fetch: under Vitest the
  // global is used unless the test installed a resolver (setEgressResolver),
  // which is how the transport's own tests opt in. Never applies in the app.
  if (process.env.VITEST && resolver === systemResolver) return globalThis.fetch(input, init)
  const portable = await portableInit(init)
  return undiciFetch(input as never, { ...(portable as object), dispatcher: egressDispatcher() } as never)
}) as unknown as typeof fetch

