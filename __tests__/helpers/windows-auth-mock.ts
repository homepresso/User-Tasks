/**
 * A small NTLMv2 server (the acceptor side of MS-NLMP) for the Windows auth
 * transport tests: connection-based authentication over keep-alive sockets,
 * NTProofStr + MIC verification, optional channel-binding enforcement, and a
 * few routes (echo, redirects). Test-only.
 */
import { execFileSync } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TLSSocket } from 'node:tls'
import { tlsServerEndPoint } from '@/lib/integrations/windows-auth/channel-binding'
import { AV, channelBindingsHash, fileTime, ntowfv2, parseAvPairs, serializeAvPairs } from '@/lib/integrations/windows-auth/ntlm'

export interface MockNtlmOptions {
  user?: string
  domain?: string
  password?: string
  /** Schemes in WWW-Authenticate (default both). */
  schemes?: ('NTLM' | 'Negotiate')[]
  /** Close the connection after sending the challenge (breaks affinity). */
  closeAfterChallenge?: boolean
  /** Enforce channel binding (HTTPS only). */
  requireCbt?: boolean
  includeTimestamp?: boolean
  /** CHALLENGE flags (default 0xe28a8235: sign + seal + key exchange offered). */
  challengeFlags?: number
  tls?: { key: string; cert: string }
}

interface SocketState { negotiate?: Buffer; challenge?: Buffer; serverChallenge?: Buffer; authenticated?: boolean; id: number }

export interface MockNtlmServer {
  url: string
  stats: { handshakes: number; type1: number; type3: number; failures: string[]; requests: { method: string; path: string; auth: string | null; bodyBytes: number; socket: number }[] }
  /** Drop every open connection (forces re-authentication). */
  dropConnections(): void
  close(): Promise<void>
}

const field = (msg: Buffer, at: number) => msg.subarray(msg.readUInt32LE(at + 4), msg.readUInt32LE(at + 4) + msg.readUInt16LE(at))

export async function startMockNtlmServer(options: MockNtlmOptions = {}): Promise<MockNtlmServer> {
  const user = options.user ?? 'svc'
  const domain = options.domain ?? 'CONTOSO'
  const password = options.password ?? 'S3cret!'
  const schemes = options.schemes ?? ['Negotiate', 'NTLM']
  const states = new WeakMap<Socket, SocketState>()
  const sockets = new Set<Socket>()
  let nextId = 1
  const stats: MockNtlmServer['stats'] = { handshakes: 0, type1: 0, type3: 0, failures: [], requests: [] }

  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const socket = req.socket
      let state = states.get(socket)
      if (!state) { state = { id: nextId++ }; states.set(socket, state) }
      const auth = req.headers.authorization ?? null
      const url = new URL(req.url ?? '/', 'http://x')
      stats.requests.push({ method: req.method ?? '', path: url.pathname, auth: auth ? auth.split(' ')[0] : null, bodyBytes: body.length, socket: state.id })

      const deny = (reason?: string) => {
        if (reason) stats.failures.push(reason)
        state!.authenticated = false
        res.writeHead(401, { 'WWW-Authenticate': schemes, 'Content-Type': 'text/plain', 'Content-Length': '12' })
        res.end('Unauthorized')
      }

      if (auth) {
        const [scheme, token] = auth.split(' ')
        if (!schemes.includes(scheme as 'NTLM')) return deny(`scheme ${scheme} not offered`)
        const msg = Buffer.from(token ?? '', 'base64')
        if (!msg.subarray(0, 8).equals(Buffer.from('NTLMSSP\0', 'latin1'))) return deny('not an NTLM token')
        const type = msg.readUInt32LE(8)
        if (type === 1) {
          stats.type1++
          if (body.length) stats.failures.push('body sent with NEGOTIATE')
          const serverChallenge = randomBytes(8)
          const pairs = [
            { id: AV.NB_DOMAIN_NAME, value: Buffer.from(domain, 'utf16le') },
            { id: AV.NB_COMPUTER_NAME, value: Buffer.from('SP', 'utf16le') },
            ...(options.includeTimestamp === false ? [] : [{ id: AV.TIMESTAMP, value: fileTime() }]),
          ]
          const info = serializeAvPairs(pairs)
          const head = Buffer.alloc(56)
          Buffer.from('NTLMSSP\0', 'latin1').copy(head, 0)
          head.writeUInt32LE(2, 8)
          head.writeUInt32LE((options.challengeFlags ?? 0xe28a8235) >>> 0, 20)
          serverChallenge.copy(head, 24)
          head.writeUInt16LE(info.length, 40); head.writeUInt16LE(info.length, 42); head.writeUInt32LE(56, 44)
          const challenge = Buffer.concat([head, info])
          state.negotiate = Buffer.from(msg)
          state.challenge = challenge
          state.serverChallenge = serverChallenge
          state.authenticated = false
          res.writeHead(401, {
            'WWW-Authenticate': `${scheme} ${challenge.toString('base64')}`,
            'Content-Length': '0',
            ...(options.closeAfterChallenge ? { Connection: 'close' } : {}),
          })
          res.end()
          return
        }
        if (type === 3) {
          stats.type3++
          if (!state.challenge || !state.serverChallenge || !state.negotiate) return deny('AUTHENTICATE without a challenge on this connection')
          const nt = field(msg, 20)
          const proof = nt.subarray(0, 16)
          const blob = nt.subarray(16)
          const msgUser = field(msg, 36).toString('utf16le')
          const msgDomain = field(msg, 28).toString('utf16le')
          const key = ntowfv2(password, msgUser, msgDomain)
          const expected = createHmac('md5', key).update(state.serverChallenge).update(blob).digest()
          if (msgUser.toLowerCase() !== user.toLowerCase() || msgDomain.toLowerCase() !== domain.toLowerCase() || !expected.equals(proof)) {
            state.challenge = undefined
            return deny('bad credentials')
          }
          // MIC
          const sessionBaseKey = createHmac('md5', key).update(proof).digest()
          if (msg.readUInt32LE(60) & 0x40000000) { state.challenge = undefined; return deny('key exchange requested') }
          const exported = sessionBaseKey
          const zeroed = Buffer.from(msg); zeroed.fill(0, 72, 88)
          const mic = createHmac('md5', exported).update(state.negotiate).update(state.challenge).update(zeroed).digest()
          if (!mic.equals(msg.subarray(72, 88))) { state.challenge = undefined; return deny('bad MIC') }
          if (options.requireCbt) {
            const pairs = parseAvPairs(blob.subarray(28))
            const cert = (socket as TLSSocket).getCertificate?.() as { raw?: Buffer } | null
            const want = cert?.raw ? channelBindingsHash(tlsServerEndPoint(cert.raw)) : Buffer.alloc(16)
            const got = pairs.find((p) => p.id === AV.CHANNEL_BINDINGS)?.value
            if (!got || !got.equals(want)) { state.challenge = undefined; return deny('channel binding mismatch') }
          }
          state.challenge = undefined
          state.authenticated = true
          stats.handshakes++
        } else {
          return deny(`unexpected message type ${type}`)
        }
      } else if (!state.authenticated) {
        return deny()
      }

      if (url.pathname === '/redirect-cross') {
        res.writeHead(302, { Location: url.searchParams.get('to') ?? 'http://example.invalid/' , 'Content-Length': '0' })
        return res.end()
      }
      if (url.pathname === '/redirect-same') {
        res.writeHead(302, { Location: '/echo?after=redirect', 'Content-Length': '0' })
        return res.end()
      }
      const payload = JSON.stringify({ method: req.method, path: url.pathname, query: url.search, body: body.toString('utf8'), bodyBytes: body.length, socket: state.id, host: req.headers.host })
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) })
      res.end(payload)
    })
  }

  const server = options.tls ? https.createServer({ key: options.tls.key, cert: options.tls.cert }, handler) : http.createServer(handler)
  server.keepAliveTimeout = 30_000
  server.on(options.tls ? 'secureConnection' : 'connection', (s: Socket) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  return {
    url: `${options.tls ? 'https' : 'http'}://127.0.0.1:${port}`,
    stats,
    dropConnections() { for (const s of sockets) s.destroy() },
    close: () => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()) }),
  }
}

/** A throwaway CA and a server certificate for 127.0.0.1 (openssl), or null when openssl is unavailable. */
export function makeTestCertificates(): { caPem: string; cert: string; key: string } | null {
  const dir = mkdtempSync(path.join(tmpdir(), 'ut-winauth-'))
  try {
    const run = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' })
    run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=UserTasks Test CA', '-sha256')
    run('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'srv.key', '-out', 'srv.csr', '-subj', '/CN=127.0.0.1', '-sha256')
    writeFileSync(path.join(dir, 'ext.cnf'), 'subjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=CA:FALSE\n')
    run('x509', '-req', '-in', 'srv.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'srv.pem', '-days', '2', '-sha256', '-extfile', 'ext.cnf')
    return {
      caPem: readFileSync(path.join(dir, 'ca.pem'), 'utf8'),
      cert: readFileSync(path.join(dir, 'srv.pem'), 'utf8'),
      key: readFileSync(path.join(dir, 'srv.key'), 'utf8'),
    }
  } catch {
    return null
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
