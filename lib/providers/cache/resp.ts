import net from 'node:net'
import tls from 'node:tls'

/**
 * A minimal Redis protocol (RESP2) client: one pipelined connection, the
 * handful of commands the redis cache store uses, TLS, AUTH with a username
 * and a password or a short-lived token (re-sent before the token expires,
 * and on every reconnect), and SELECT. Works with Redis, Valkey, KeyDB,
 * Dragonfly, Azure Cache for Redis / Azure Managed Redis (non-clustered or
 * the Enterprise cluster policy) and Memorystore. Redis Cluster's MOVED /
 * ASK redirects are not followed: they fail with an explanatory error.
 *
 * No dependency (and nothing to bundle for the worker / admin CLI). A
 * command that times out closes the connection — replies would no longer
 * line up — and the next command reconnects.
 */

export type RespValue = string | number | null | RespValue[]

/** An error reply from the server (`-ERR …`). */
export class RespReplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RespReplyError'
  }
}

export interface RespCredentials {
  username?: string
  password?: string
  /** Epoch ms when the password (a token) expires: AUTH is repeated before then. */
  expiresAt?: number
}

export interface RespClientOptions {
  host: string
  port: number
  /** TLS options (null / undefined: plain TCP). */
  tls?: tls.ConnectionOptions | null
  db?: number
  credentials?: () => Promise<RespCredentials | null>
  connectTimeoutMs?: number
  commandTimeoutMs?: number
}

interface Pending {
  resolve: (value: RespValue) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

const CRLF = Buffer.from('\r\n')

export function encodeCommand(args: Array<string | number | Buffer>): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)]
  for (const arg of args) {
    const data = Buffer.isBuffer(arg) ? arg : Buffer.from(String(arg), 'utf8')
    parts.push(Buffer.from(`$${data.length}\r\n`), data, CRLF)
  }
  return Buffer.concat(parts)
}

/** Parse one value from `buf` at `offset`; null when the buffer holds only part of it. */
export function parseReply(buf: Buffer, offset = 0): { value: RespValue | RespReplyError; next: number } | null {
  if (offset >= buf.length) return null
  const lineEnd = buf.indexOf(CRLF, offset)
  if (lineEnd === -1) return null
  const type = String.fromCharCode(buf[offset])
  const line = buf.toString('utf8', offset + 1, lineEnd)
  const after = lineEnd + 2
  switch (type) {
    case '+':
      return { value: line, next: after }
    case '-':
      return { value: new RespReplyError(line), next: after }
    case ':':
      return { value: Number(line), next: after }
    case '$': {
      const length = Number(line)
      if (length < 0) return { value: null, next: after }
      if (buf.length < after + length + 2) return null
      return { value: buf.toString('utf8', after, after + length), next: after + length + 2 }
    }
    case '*': {
      const count = Number(line)
      if (count < 0) return { value: null, next: after }
      const items: RespValue[] = []
      let cursor = after
      for (let i = 0; i < count; i++) {
        const item = parseReply(buf, cursor)
        if (!item) return null
        // An error inside an array (EXEC) is surfaced as its message.
        items.push(item.value instanceof RespReplyError ? item.value.message : item.value)
        cursor = item.next
      }
      return { value: items, next: cursor }
    }
    default:
      throw new Error(`Unexpected Redis reply type ${JSON.stringify(type)}`)
  }
}

export function redisClusterError(message: string): Error | null {
  return /^(MOVED|ASK|CROSSSLOT|CLUSTERDOWN) /.test(message)
    ? new Error('Redis Cluster mode is not supported: use a non-clustered instance (Azure Managed Redis: the Enterprise cluster policy)')
    : null
}

export class RespClient {
  private socket: net.Socket | null = null
  private connecting: Promise<void> | null = null
  private pending: Pending[] = []
  private buffer: Buffer = Buffer.alloc(0)
  private reauthTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private lastFailure: { at: number; error: Error } | null = null

  constructor(private readonly options: RespClientOptions) {}

  async command(args: Array<string | number | Buffer>): Promise<RespValue> {
    if (this.closed) throw new Error('Redis client is closed')
    await this.connect()
    return this.send(args)
  }

  async close(): Promise<void> {
    this.closed = true
    this.teardown(new Error('Redis client closed'))
  }

  private connect(): Promise<void> {
    if (this.socket && !this.connecting) return Promise.resolve()
    if (this.connecting) return this.connecting
    // Fail fast while the server is down, instead of a connect attempt per command.
    if (this.lastFailure && Date.now() - this.lastFailure.at < 500) return Promise.reject(this.lastFailure.error)
    this.connecting = this.open().then(
      () => { this.connecting = null },
      (error: Error) => {
        this.connecting = null
        this.lastFailure = { at: Date.now(), error }
        this.teardown(error)
        throw error
      },
    )
    return this.connecting
  }

  private async open(): Promise<void> {
    const { host, port } = this.options
    const timeoutMs = this.options.connectTimeoutMs ?? 5_000
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const s = this.options.tls
        ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, ...this.options.tls })
        : net.connect({ host, port })
      const timer = setTimeout(() => { s.destroy(); reject(new Error(`Redis connect to ${host}:${port} timed out after ${timeoutMs} ms`)) }, timeoutMs)
      s.once(this.options.tls ? 'secureConnect' : 'connect', () => { clearTimeout(timer); resolve(s) })
      s.once('error', (error) => { clearTimeout(timer); reject(new Error(`Redis connect to ${host}:${port} failed: ${error.message}`)) })
    })
    socket.setNoDelay(true)
    // Events of a connection that has since been replaced are ignored.
    socket.on('data', (chunk) => { if (this.socket === socket) this.onData(chunk) })
    socket.on('error', (error) => { if (this.socket === socket) this.teardown(new Error(`Redis connection error: ${error.message}`)) })
    socket.on('close', () => { if (this.socket === socket) this.teardown(new Error('Redis connection closed')) })
    this.socket = socket
    this.buffer = Buffer.alloc(0)
    this.refState()
    await this.authenticate()
    if (this.options.db) await this.send(['SELECT', this.options.db])
  }

  private async authenticate(): Promise<void> {
    const credentials = await this.options.credentials?.()
    if (credentials?.password !== undefined) {
      const args = credentials.username ? ['AUTH', credentials.username, credentials.password] : ['AUTH', credentials.password]
      try {
        await this.send(args)
      } catch (error) {
        // The reply never contains the password; keep the server's reason.
        throw new Error(`Redis AUTH failed: ${(error as Error).message}`)
      }
    }
    if (this.reauthTimer) clearTimeout(this.reauthTimer)
    this.reauthTimer = null
    if (credentials?.expiresAt) {
      // Re-authenticate the live connection a minute before the token lapses.
      const delay = Math.max(30_000, credentials.expiresAt - Date.now() - 60_000)
      this.reauthTimer = setTimeout(() => {
        this.authenticate().catch((error: Error) => this.teardown(error))
      }, delay)
      this.reauthTimer.unref?.()
    }
  }

  private send(args: Array<string | number | Buffer>): Promise<RespValue> {
    const socket = this.socket
    if (!socket) return Promise.reject(new Error('Redis is not connected'))
    const timeoutMs = this.options.commandTimeoutMs ?? 2_000
    return new Promise<RespValue>((resolve, reject) => {
      const entry: Pending = { resolve, reject, timer: null }
      entry.timer = setTimeout(() => {
        this.teardown(new Error(`Redis command ${String(args[0])} timed out after ${timeoutMs} ms`))
      }, timeoutMs)
      this.pending.push(entry)
      this.refState()
      socket.write(encodeCommand(args))
    })
  }

  private onData(chunk: Buffer) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    let offset = 0
    for (;;) {
      let parsed: ReturnType<typeof parseReply>
      try {
        parsed = parseReply(this.buffer, offset)
      } catch (error) {
        this.teardown(error as Error)
        return
      }
      if (!parsed) break
      offset = parsed.next
      const entry = this.pending.shift()
      if (!entry) continue
      if (entry.timer) clearTimeout(entry.timer)
      if (parsed.value instanceof RespReplyError) entry.reject(redisClusterError(parsed.value.message) ?? parsed.value)
      else entry.resolve(parsed.value)
    }
    this.buffer = offset >= this.buffer.length ? Buffer.alloc(0) : this.buffer.subarray(offset)
    this.refState()
  }

  /** Keep the process alive only while replies are outstanding. */
  private refState() {
    if (!this.socket) return
    if (this.pending.length) this.socket.ref()
    else this.socket.unref()
  }

  private teardown(error: Error) {
    const socket = this.socket
    this.socket = null
    if (this.reauthTimer) clearTimeout(this.reauthTimer)
    this.reauthTimer = null
    const pending = this.pending
    this.pending = []
    for (const entry of pending) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(error)
    }
    if (socket) socket.destroy()
  }
}

export interface RedisUrlParts {
  host: string
  port: number
  tls: boolean
  username?: string
  password?: string
  db?: number
}

/** redis[s]://[user[:password]@]host[:port][/db] (also valkey[s]://). */
export function parseRedisUrl(url: string): RedisUrlParts {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('CACHE_REDIS_URL is not a valid URL (redis://host:6379 or rediss://host:6380)')
  }
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase()
  if (!['redis', 'rediss', 'valkey', 'valkeys'].includes(scheme)) throw new Error('CACHE_REDIS_URL must use redis://, rediss://, valkey:// or valkeys://')
  const db = parsed.pathname.replace(/^\/+/, '')
  if (db && !/^\d+$/.test(db)) throw new Error('CACHE_REDIS_URL: the path must be a database number')
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port: parsed.port ? Number(parsed.port) : 6379,
    tls: scheme === 'rediss' || scheme === 'valkeys',
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(db ? { db: Number(db) } : {}),
  }
}
