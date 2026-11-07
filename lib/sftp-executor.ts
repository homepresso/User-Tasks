/**
 * SFTP references (auth_config._executor = 'sftp'): file operations over SSH
 * with the ssh2 client.
 *
 *  - Host: egress-guarded (private / loopback / metadata refused unless
 *    ALLOW_PRIVATE_EGRESS=true); the vetted address is what we connect to.
 *  - Host key: pinned by SHA-256 fingerprint (auth_config.host_key_fingerprint,
 *    "SHA256:…" as `ssh-keygen -lf` prints it). Without a pin the call fails and
 *    the error carries the server's fingerprint to paste into the connector
 *    (SFTP_ALLOW_UNPINNED_HOST_KEYS=true accepts any key — self-host opt-out).
 *  - Paths: resolved against default_path; when restrict_to_default_path is on
 *    (default whenever a default path other than "/" is set) nothing outside it
 *    is reachable, including through symlinks (realpath checked).
 *  - Sizes: downloads / uploads capped at SFTP_MAX_BYTES (default 25 MB);
 *    listings at 1000 entries.
 *  - Time: 15 s handshake, whole call bounded by the reference timeout.
 */
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { posix } from 'node:path'
import { assertSafeEgressHost, assertSafeEgressUrl } from './egress-guard'

export interface SftpReferenceResult {
  status: number
  data: any
  operation?: string
}

export type SftpOperation = 'list' | 'download' | 'upload' | 'delete' | 'rename' | 'mkdir' | 'rmdir' | 'stat' | 'chmod' | 'exists'

const OPERATIONS: SftpOperation[] = ['list', 'download', 'upload', 'delete', 'rename', 'mkdir', 'rmdir', 'stat', 'chmod', 'exists']
const MAX_LIST_ENTRIES = 1000
const DEFAULT_TIMEOUT_MS = 60_000

export function maxSftpBytes(): number {
  const env = Number(process.env.SFTP_MAX_BYTES)
  return Number.isFinite(env) && env > 0 ? Math.floor(env) : 25 * 1024 * 1024
}

export class SftpError extends Error {
  constructor(message: string, public status: number, public code = 'sftp_error') {
    super(message)
    this.name = 'SftpError'
  }
}

// ─── Session abstraction (ssh2 in production; tests inject a fake) ───

export interface SftpStat {
  size: number
  mode: number
  mtime: number
  atime: number
  isDirectory: boolean
  isFile: boolean
  isSymbolicLink: boolean
}

export interface SftpSession {
  list(path: string): Promise<{ name: string; stat: SftpStat }[]>
  stat(path: string): Promise<SftpStat>
  realpath(path: string): Promise<string>
  read(path: string, maxBytes: number): Promise<Buffer>
  write(path: string, data: Buffer, flags: 'w' | 'a' | 'wx'): Promise<void>
  unlink(path: string): Promise<void>
  rename(from: string, to: string, overwrite: boolean): Promise<void>
  mkdir(path: string): Promise<void>
  rmdir(path: string): Promise<void>
  chmod(path: string, mode: number): Promise<void>
  close(): void
}

export interface SftpConnectOptions {
  host: string
  address: string
  port: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
  fingerprint?: string
  allowUnpinned: boolean
  readyTimeoutMs: number
}

type SessionFactory = (options: SftpConnectOptions) => Promise<SftpSession>

let sessionFactory: SessionFactory = connectSsh2
/** Tests: replace the ssh2 transport (pass null to restore). */
export function __setSftpSessionFactory(factory: SessionFactory | null) {
  sessionFactory = factory ?? connectSsh2
}

/** "SHA256:<base64, no padding>" of a raw host key blob, as ssh-keygen prints it. */
export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

export function normalizeFingerprint(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const body = text.replace(/^SHA256:/i, '').replace(/=+$/, '')
  return `SHA256:${body}`
}

const STATUS_FROM_CODE: Record<number, [number, string]> = {
  2: [404, 'not_found'],
  3: [403, 'permission_denied'],
  4: [500, 'failure'],
  5: [400, 'bad_message'],
  8: [501, 'unsupported'],
}

function mapSftpError(error: any, what: string): SftpError {
  if (error instanceof SftpError) return error
  const code = typeof error?.code === 'number' ? error.code : undefined
  const [status, kind] = (code && STATUS_FROM_CODE[code]) || [502, 'sftp_error']
  return new SftpError(`${what}: ${error?.message ?? String(error)}`, status, kind)
}

function toStat(attrs: any): SftpStat {
  const mode = Number(attrs?.mode ?? 0)
  const type = mode & 0o170000
  return {
    size: Number(attrs?.size ?? 0),
    mode,
    mtime: Number(attrs?.mtime ?? 0),
    atime: Number(attrs?.atime ?? 0),
    isDirectory: typeof attrs?.isDirectory === 'function' ? attrs.isDirectory() : type === 0o040000,
    isFile: typeof attrs?.isFile === 'function' ? attrs.isFile() : type === 0o100000,
    isSymbolicLink: typeof attrs?.isSymbolicLink === 'function' ? attrs.isSymbolicLink() : type === 0o120000,
  }
}

async function connectSsh2(options: SftpConnectOptions): Promise<SftpSession> {
  const { Client } = await import('ssh2')
  const client = new Client()
  let seenFingerprint = ''
  const sftp: any = await new Promise((resolve, reject) => {
    client.on('ready', () => {
      client.sftp((err, s) => (err ? reject(err) : resolve(s)))
    })
    client.on('error', (err: any) => {
      if (err?.level === 'client-authentication') reject(new SftpError('SFTP authentication failed: check the username and password / private key', 401, 'auth_failed'))
      else if (/host key|verification/i.test(String(err?.message)) && seenFingerprint) {
        reject(new SftpError(
          options.fingerprint
            ? `SFTP host key mismatch: server presented ${seenFingerprint}, expected ${options.fingerprint}`
            : `SFTP host key not pinned: set Host Key Fingerprint to ${seenFingerprint} after confirming it with the server administrator`,
          495, 'host_key',
        ))
      } else reject(err)
    })
    client.connect({
      host: options.address,
      port: options.port,
      username: options.username,
      ...(options.privateKey ? { privateKey: options.privateKey, ...(options.passphrase ? { passphrase: options.passphrase } : {}) } : { password: options.password ?? '' }),
      readyTimeout: options.readyTimeoutMs,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer) => {
        seenFingerprint = hostKeyFingerprint(key)
        if (options.fingerprint) return seenFingerprint === options.fingerprint
        return options.allowUnpinned
      },
    } as any)
  })

  const call = <T>(fn: (cb: (err: any, value?: T) => void) => void) =>
    new Promise<T>((resolve, reject) => fn((err, value) => (err ? reject(err) : resolve(value as T))))

  return {
    list: async (path) => {
      const entries: any[] = await call((cb) => sftp.readdir(path, cb))
      return entries.map((e) => ({ name: e.filename, stat: toStat(e.attrs) }))
    },
    stat: async (path) => toStat(await call((cb) => sftp.stat(path, cb))),
    realpath: (path) => call((cb) => sftp.realpath(path, cb)),
    read: (path, maxBytes) => new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      let total = 0
      const stream = sftp.createReadStream(path)
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > maxBytes) {
          stream.destroy()
          reject(new SftpError(`File is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit`, 413, 'too_large'))
          return
        }
        chunks.push(chunk)
      })
      stream.on('error', reject)
      stream.on('end', () => resolve(Buffer.concat(chunks)))
    }),
    write: (path, data, flags) => new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(path, { flags })
      stream.on('error', reject)
      stream.on('close', () => resolve())
      stream.end(data)
    }),
    unlink: (path) => call((cb) => sftp.unlink(path, cb)),
    rename: async (from, to, overwrite) => {
      if (overwrite && typeof sftp.ext_openssh_rename === 'function') {
        try {
          await call((cb) => sftp.ext_openssh_rename(from, to, cb))
          return
        } catch (error: any) {
          if (!/not supported|unsupported/i.test(String(error?.message))) throw error
        }
      }
      await call((cb) => sftp.rename(from, to, cb))
    },
    mkdir: (path) => call((cb) => sftp.mkdir(path, cb)),
    rmdir: (path) => call((cb) => sftp.rmdir(path, cb)),
    chmod: (path, mode) => call((cb) => sftp.chmod(path, mode, cb)),
    close: () => { try { client.end() } catch { /* ignore */ } },
  }
}

// ─── Paths ───

export interface PathJail {
  root: string
  restricted: boolean
}

/** Resolve `input` against the jail root; refuses anything outside it when restricted. */
export function resolveRemotePath(input: unknown, jail: PathJail, label = 'path'): string {
  const raw = input == null ? '' : String(input)
  if (raw.includes('\u0000')) throw new SftpError(`Invalid ${label}`, 400, 'bad_path')
  const resolved = posix.resolve(jail.root, raw.trim() || '.')
  if (jail.restricted && !isInside(resolved, jail.root)) {
    throw new SftpError(`${label} "${raw.slice(0, 120)}" is outside the connector's default path ${jail.root}`, 403, 'outside_root')
  }
  return resolved
}

function isInside(path: string, root: string): boolean {
  if (root === '/') return true
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

// ─── Values ───

const truthy = (v: unknown) => v === true || v === 'true' || v === 1 || v === '1' || v === 'yes'

async function uploadBytes(content: unknown, encoding: string, tenantId: string): Promise<Buffer> {
  const max = maxSftpBytes()
  const check = (buf: Buffer) => {
    if (buf.byteLength > max) throw new SftpError(`Upload is larger than the ${Math.round(max / 1024 / 1024)} MB limit`, 413, 'too_large')
    return buf
  }
  // A workflow file / attachment object → fetch its bytes (tenant-scoped).
  if (content && typeof content === 'object' && !Buffer.isBuffer(content)) {
    const v = content as Record<string, any>
    if (v._binary && typeof v.base64 === 'string') return check(Buffer.from(v.base64, 'base64'))
    const { fileSource, fetchFile } = await import('@/lib/storage/files')
    const source = fileSource(content)
    if (!source) throw new SftpError('content: unsupported file value', 400, 'bad_content')
    if (/^https?:\/\//i.test(source)) await assertSafeEgressUrl(source)
    const res = await fetchFile(source, { signal: AbortSignal.timeout(30_000) }, { tenantId })
    if (!res.ok) throw new SftpError(`content: could not read the file (${res.status})`, 400, 'bad_content')
    if (Number(res.headers.get('content-length') ?? 0) > max) throw new SftpError(`Upload is larger than the ${Math.round(max / 1024 / 1024)} MB limit`, 413, 'too_large')
    return check(Buffer.from(await res.arrayBuffer()))
  }
  const text = content == null ? '' : String(content)
  const dataUrl = /^data:[^;,]*;base64,([\s\S]*)$/.exec(text)
  if (dataUrl) return check(Buffer.from(dataUrl[1], 'base64'))
  if (encoding === 'base64' || text.startsWith('base64:')) return check(Buffer.from(text.replace(/^base64:/, ''), 'base64'))
  return check(Buffer.from(text, 'utf8'))
}

function looksLikeText(buf: Buffer): boolean {
  if (buf.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return true
  } catch {
    return false
  }
}

function permissions(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, '0')
}

function iso(seconds: number): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null
}

// ─── Entry point ───

/** Operation from the reference path (/_internal/sftp/<op>) or body.operation. */
export function sftpOperationOf(requestConfig: any, body: Record<string, any>): SftpOperation {
  const fromPath = /\/_internal\/sftp\/(\w+)/.exec(String(requestConfig?.path_template ?? ''))?.[1]
  const op = String(body?.operation ?? fromPath ?? '').toLowerCase()
  if (!OPERATIONS.includes(op as SftpOperation)) throw new SftpError(`Unsupported SFTP operation "${op}"`, 400, 'bad_operation')
  return op as SftpOperation
}

/** Fill the JSON body template leaf by leaf ({{name}} → value; never re-keys the body). */
export function renderSftpBody(bodyTemplate: unknown, values: Record<string, any>): Record<string, any> {
  let template: any = {}
  if (typeof bodyTemplate === 'string' && bodyTemplate.trim()) {
    try { template = JSON.parse(bodyTemplate) } catch { throw new SftpError('The SFTP reference body template is not valid JSON', 400, 'bad_template') }
  } else if (bodyTemplate && typeof bodyTemplate === 'object') template = bodyTemplate
  const fill = (node: any): any => {
    if (typeof node === 'string') {
      const whole = /^\{\{\s*(\w+)\s*\}\}$/.exec(node)
      if (whole) return values[whole[1]] ?? ''
      return node.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => (values[k] == null ? '' : String(values[k])))
    }
    if (Array.isArray(node)) return node.map(fill)
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fill(v)]))
    return node
  }
  return fill(template)
}

export async function executeSftpReference(
  integrationConfig: any,
  requestConfig: any,
  values: Record<string, any>,
  options: { timeout: number; tenantId: string; supabase: unknown },
): Promise<SftpReferenceResult> {
  const auth = integrationConfig?.auth_config ?? {}
  const body = renderSftpBody(requestConfig?.body_template, values ?? {})
  const operation = sftpOperationOf(requestConfig, body)
  try {
    const data = await runSftp(auth, operation, body, options)
    return { status: 200, data, operation }
  } catch (error: any) {
    const mapped = error instanceof SftpError ? error : mapSftpError(error, `SFTP ${operation} failed`)
    if (mapped.status === 495 || mapped.status === 401 || error?.name === 'EgressBlockedError') {
      // Configuration problems: fail the step rather than hand back data.
      throw new Error(mapped.message)
    }
    return { status: mapped.status, data: { error: mapped.message, code: mapped.code }, operation }
  }
}

async function runSftp(auth: Record<string, any>, operation: SftpOperation, body: Record<string, any>, options: { timeout: number; tenantId: string; supabase: unknown }) {
  const host = String(auth.host ?? '').trim()
  if (!host) throw new SftpError('SFTP host is not configured', 400, 'config')
  const port = Number(auth.port) || 22
  await assertSafeEgressHost(host)
  let address = host
  if (!net.isIP(host)) {
    try {
      const resolved = await lookup(host, { all: true })
      if (resolved[0]?.address) {
        await assertSafeEgressHost(resolved[0].address)
        address = resolved[0].address
      }
    } catch (error: any) {
      if (error?.name === 'EgressBlockedError') throw error
    }
  }

  const defaultPath = posix.normalize(String(auth.default_path || '/').trim() || '/').replace(/(.)\/+$/, '$1')
  const root = defaultPath.startsWith('/') ? defaultPath : `/${defaultPath}`
  const restrictSetting = auth.restrict_to_default_path
  const jail: PathJail = { root, restricted: restrictSetting === undefined || restrictSetting === '' ? root !== '/' : truthy(restrictSetting) }

  const usesKey = auth.auth_method === 'private_key' || (!!auth.private_key && !auth.password)
  const session = await sessionFactory({
    host,
    address,
    port,
    username: String(auth.username ?? ''),
    password: usesKey ? undefined : String(auth.password ?? ''),
    privateKey: usesKey ? String(auth.private_key ?? '') : undefined,
    // Older connectors kept the key passphrase in `password`.
    passphrase: usesKey ? String(auth.private_key_passphrase || auth.password || '') || undefined : undefined,
    fingerprint: normalizeFingerprint(auth.host_key_fingerprint) || undefined,
    allowUnpinned: process.env.SFTP_ALLOW_UNPINNED_HOST_KEYS === 'true',
    readyTimeoutMs: 15_000,
  })

  const timeoutMs = options.timeout && options.timeout > 0 ? options.timeout : DEFAULT_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      perform(session, operation, body, jail, options.tenantId, options.supabase),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SftpError(`SFTP ${operation} timed out after ${Math.round(timeoutMs / 1000)}s`, 504, 'timeout')), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
    session.close()
  }
}

async function perform(session: SftpSession, operation: SftpOperation, body: Record<string, any>, jail: PathJail, tenantId: string, supabase: unknown) {
  // Symlinks may point outside the root: the real path must stay inside too.
  const checkReal = async (path: string, label = 'path') => {
    if (!jail.restricted) return path
    let real: string
    try { real = await session.realpath(path) } catch { return path } // missing paths cannot escape
    const realRoot = await session.realpath(jail.root).catch(() => jail.root)
    if (!isInside(real, realRoot)) throw new SftpError(`${label} resolves outside the connector's default path`, 403, 'outside_root')
    return path
  }
  const parentReal = async (path: string, label = 'path') => {
    await checkReal(posix.dirname(path), label)
    return path
  }

  try {
    switch (operation) {
      case 'list': {
        const path = await checkReal(resolveRemotePath(body.path, jail))
        const entries = await session.list(path)
        entries.sort((a, b) => a.name.localeCompare(b.name))
        const files = entries.filter((e) => e.name !== '.' && e.name !== '..').slice(0, MAX_LIST_ENTRIES).map((e) => ({
          name: e.name,
          path: posix.join(path, e.name),
          type: e.stat.isDirectory ? 'directory' : e.stat.isSymbolicLink ? 'symlink' : 'file',
          size: e.stat.size,
          permissions: permissions(e.stat.mode),
          modifyTime: iso(e.stat.mtime),
        }))
        return { path, files, count: files.length, ...(entries.length > MAX_LIST_ENTRIES ? { truncated: true } : {}) }
      }
      case 'download': {
        const path = await checkReal(resolveRemotePath(body.path, jail))
        const st = await session.stat(path)
        if (st.isDirectory) throw new SftpError('download: the path is a directory', 400, 'is_directory')
        const max = maxSftpBytes()
        if (st.size > max) throw new SftpError(`File is larger than the ${Math.round(max / 1024 / 1024)} MB limit`, 413, 'too_large')
        const bytes = await session.read(path, max)
        const filename = posix.basename(path)
        const text = looksLikeText(bytes)
        return {
          filename,
          path,
          size: bytes.byteLength,
          encoding: text ? 'utf8' : 'base64',
          content: text ? bytes.toString('utf8') : bytes.toString('base64'),
          ...(text ? {} : { file: await storeDownload(bytes, filename, tenantId, supabase) }),
        }
      }
      case 'upload': {
        const path = await parentReal(resolveRemotePath(body.path, jail), 'path')
        if (path === jail.root || path.endsWith('/')) throw new SftpError('upload: path must include a file name', 400, 'bad_path')
        const mode = String(body.mode ?? 'overwrite').toLowerCase()
        const flags = mode === 'append' ? 'a' : mode === 'create' || mode === 'create_only' ? 'wx' : 'w'
        const bytes = await uploadBytes(body.content, String(body.encoding ?? 'text').toLowerCase(), tenantId)
        await session.write(path, bytes, flags)
        return { path, size: bytes.byteLength, mode: flags === 'a' ? 'append' : flags === 'wx' ? 'create' : 'overwrite' }
      }
      case 'delete': {
        const path = await checkReal(resolveRemotePath(body.path, jail))
        await session.unlink(path)
        return { status: 'deleted', path }
      }
      case 'rename': {
        const from = await checkReal(resolveRemotePath(body.from_path, jail, 'from_path'), 'from_path')
        const to = await parentReal(resolveRemotePath(body.to_path, jail, 'to_path'), 'to_path')
        if (from === jail.root) throw new SftpError('rename: cannot move the default path itself', 400, 'bad_path')
        await session.rename(from, to, truthy(body.overwrite))
        return { status: 'renamed', from_path: from, to_path: to }
      }
      case 'mkdir': {
        const path = resolveRemotePath(body.path, jail)
        const recursive = body.recursive === undefined || body.recursive === '' ? true : truthy(body.recursive)
        if (!recursive) {
          await parentReal(path)
          await session.mkdir(path)
          return { path, created: true }
        }
        const segments = path.split('/').filter(Boolean)
        let current = ''
        let created = false
        for (const segment of segments) {
          current = `${current}/${segment}`
          if (jail.restricted && !isInside(current, jail.root) && !isInside(jail.root, current)) throw new SftpError('path is outside the default path', 403, 'outside_root')
          let exists = false
          try {
            const st = await session.stat(current)
            if (!st.isDirectory) throw new SftpError(`${current} exists and is not a directory`, 409, 'conflict')
            exists = true
          } catch (error) {
            if (error instanceof SftpError) throw error
          }
          if (!exists) {
            if (jail.restricted && !isInside(current, jail.root)) throw new SftpError('path is outside the default path', 403, 'outside_root')
            await session.mkdir(current)
            created = true
          }
        }
        await checkReal(path)
        return { path, created }
      }
      case 'rmdir': {
        const path = await checkReal(resolveRemotePath(body.path, jail))
        if (path === jail.root || path === '/') throw new SftpError('rmdir: refusing to remove the default path', 400, 'bad_path')
        await session.rmdir(path)
        return { status: 'removed', path }
      }
      case 'stat': {
        const path = await checkReal(resolveRemotePath(body.path, jail))
        const st = await session.stat(path)
        return {
          path,
          size: st.size,
          permissions: permissions(st.mode),
          modifyTime: iso(st.mtime),
          accessTime: iso(st.atime),
          isDirectory: st.isDirectory,
          isFile: st.isFile,
        }
      }
      case 'chmod': {
        const path = await checkReal(resolveRemotePath(body.path, jail))
        const modeText = String(body.mode ?? '').trim()
        if (!/^0?[0-7]{3,4}$/.test(modeText)) throw new SftpError('mode must be octal permissions such as 0644 or 755', 400, 'bad_mode')
        await session.chmod(path, parseInt(modeText, 8))
        return { status: 'changed', path, mode: modeText.padStart(4, '0') }
      }
      case 'exists': {
        const path = resolveRemotePath(body.path, jail)
        try {
          await checkReal(path)
          const st = await session.stat(path)
          return { exists: true, type: st.isDirectory ? 'directory' : st.isSymbolicLink ? 'symlink' : 'file', path }
        } catch (error: any) {
          if (error instanceof SftpError) throw error
          if (error?.code === 2) return { exists: false, type: null, path }
          throw error
        }
      }
    }
  } catch (error) {
    throw mapSftpError(error, `SFTP ${operation} failed`)
  }
}

async function storeDownload(bytes: Buffer, filename: string, tenantId: string, supabase: unknown) {
  const ext = filename.includes('.') ? (filename.split('.').pop() ?? 'bin').replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'bin' : 'bin'
  try {
    const { storeWorkflowFile } = await import('@/lib/storage/files')
    const stored = await storeWorkflowFile(supabase as any, tenantId, new Uint8Array(bytes), ext, 'application/octet-stream')
    return { _file: true, name: filename, url: stored.url, path: stored.path, size: bytes.byteLength, content_type: 'application/octet-stream', ...((stored as any).ref ? { ref: (stored as any).ref } : {}) }
  } catch {
    return null // content (base64) is still returned
  }
}

/**
 * "Test connection" for the SFTP connector: handshake (host key checked),
 * login, stat of the default path. Without a pinned fingerprint the result
 * names the fingerprint the server presented (credentials are not sent to an
 * unverified server).
 */
export async function testSftpConnection(authConfig: Record<string, any>): Promise<{ success: boolean; message: string; fingerprint?: string }> {
  try {
    const data = await runSftp(authConfig ?? {}, 'stat', { path: '' }, { timeout: 20_000, tenantId: '', supabase: null })
    return { success: true, message: `Connected; ${data?.path ?? '/'} is ${data?.isDirectory ? 'a directory' : 'reachable'}` }
  } catch (error: any) {
    const message = error?.message ?? String(error)
    const fingerprint = /(SHA256:[A-Za-z0-9+/]+)/.exec(message)?.[1]
    return { success: false, message, ...(fingerprint ? { fingerprint } : {}) }
  }
}
