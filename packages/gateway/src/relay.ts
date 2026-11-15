/**
 * The relay listener: takes inbound callbacks on the customer's network
 * (e.g. SharePoint remote event receivers and add-in app events, which
 * SharePoint sends server-to-server) and forwards each one, signed, to
 * UserTasks (POST /api/gateway/v1/relay), returning UserTasks' answer to the
 * caller — so SharePoint never needs a route to the internet.
 *
 *   <publicUrl>/relay/ext-public/<extension>/<path>  → the extension's public route
 *   <publicUrl>/healthz                              → 200 when connected (load balancer checks)
 *
 * Only configured path prefixes, only allowed source addresses, bodies
 * capped; everything else 403 / 404 / 413 without contacting the cloud.
 */
import http from 'node:http'
import https from 'node:https'
import type { RelayConfig } from './config'
import { sourceAllowed } from './config'

export interface RelayDeps {
  forward(input: { method: string; path: string; headers: Record<string, string>; body: Buffer }): Promise<{ status: number; headers: Record<string, string>; body: Buffer }>
  healthy(): boolean
  log(level: 'info' | 'warn' | 'error', message: string, detail?: Record<string, unknown>): void
  securityEvent(type: string, message: string, detail?: Record<string, unknown>): void
}

const RELAY_PREFIX = '/relay'
const FORWARD_HEADERS = /^(content-type|soapaction|accept|user-agent|x-requestdigest|x-ms-[a-z-]+|x-sharepointhealthscore|request-id|sprequestguid|x-forms_based_auth_accepted)$/i
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

export function startRelay(config: RelayConfig, deps: RelayDeps): http.Server {
  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const send = (status: number, body: string, type = 'text/plain') => {
      if (res.headersSent) return
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
      res.end(body)
    }
    const remote = req.socket.remoteAddress ?? ''
    const url = new URL(req.url ?? '/', 'http://relay.local')
    if (url.pathname === '/healthz') return send(deps.healthy() ? 200 : 503, deps.healthy() ? 'ok' : 'not connected')
    if (!sourceAllowed(remote, config.allowSources)) {
      deps.securityEvent('relay_source_refused', `Relay call from ${remote} refused (not in allowSources)`, { remote })
      return send(403, 'Forbidden')
    }
    if (!url.pathname.startsWith(`${RELAY_PREFIX}/`)) return send(404, 'Not found')
    const path = url.pathname.slice(RELAY_PREFIX.length) + url.search
    const method = String(req.method ?? 'GET').toUpperCase()
    if (!METHODS.has(method) || !config.pathPrefixes.some((p) => path.startsWith(p)) || /\.\.|\/\/|\\/.test(url.pathname)) {
      deps.securityEvent('relay_path_refused', `Relay call ${method} ${url.pathname.slice(0, 120)} refused`, { remote })
      return send(404, 'Not found')
    }
    const chunks: Buffer[] = []
    let size = 0
    let tooBig = false
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > config.maxBodyBytes) { tooBig = true; req.destroy(); return }
      chunks.push(c)
    })
    req.on('error', () => send(400, 'Bad request'))
    req.on('end', async () => {
      if (tooBig) return send(413, 'Body too large')
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) if (FORWARD_HEADERS.test(k) && typeof v === 'string') headers[k] = v
      const started = Date.now()
      try {
        const answer = await deps.forward({ method, path, headers, body: Buffer.concat(chunks) })
        res.writeHead(answer.status, { ...answer.headers, 'cache-control': 'no-store' })
        res.end(answer.body)
        deps.log('info', 'relayed', { method, path: url.pathname.split('/').slice(0, 5).join('/'), status: answer.status, ms: Date.now() - started })
      } catch (error) {
        deps.log('warn', 'relay failed', { error: (error as Error).message })
        send(502, 'UserTasks is not reachable from the gateway right now')
      }
    })
  }
  const server = config.tls ? https.createServer({ cert: config.tls.cert, key: config.tls.key, minVersion: 'TLSv1.2' }, handler) : http.createServer(handler)
  server.headersTimeout = 15_000
  server.requestTimeout = 60_000
  server.listen(config.port, config.host)
  return server
}
