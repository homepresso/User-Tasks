/**
 * Host services for the custom action sandbox (lib/custom-actions/sandbox.ts):
 * the implementation behind `ctx.http`, `ctx.data`, `ctx.files`,
 * `ctx.secrets`, `ctx.crypto` and `ctx.intl`.
 *
 * Every call is checked HERE against two things the guest cannot change:
 *   1. the manifest's declared capabilities (what the action asked for), and
 *   2. the administrator's grants on the installed action (approved HTTP
 *      hosts, data tables with read / write access, stored secrets).
 * HTTP goes through the egress guard (no private / metadata addresses, every
 * redirect re-checked) and only to hosts in both lists. Data table access
 * uses the data table service with a context scoped to the granted tables.
 * Files are only the ones given to the action as `file` inputs, read from
 * the run's own workspace storage. Secrets are decrypted only on request,
 * only by declared name, and never logged.
 *
 * Server only.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- rows and responses are free-form JSON */

import { createHmac } from 'node:crypto'
import { isPlainObject } from '@/lib/utils/guards'
import { ACTION_LIMITS, type ActionManifest, type ActionOperation } from './contract'
import { HostServiceError, type SandboxHost } from './sandbox'
import { digestAlg, encodeBytes, syncHelpers, toBytes } from './helpers'

export { syncHelpers, zonedParts, zonedToUtc } from './helpers'

export interface DataGrant {
  table_id: string
  /** Display name (for messages and name lookups). */
  name?: string
  access: 'read' | 'write'
}

export interface ActionGrants {
  /** Hosts an administrator approved (a subset of manifest.capabilities.http.hosts). */
  approved_hosts: string[]
  data_grants: DataGrant[]
  /** Declared secret name → stored value (ciphertext); decrypted on use. */
  secret_values: Record<string, string>
}

/** What the host needs from its environment (injected so tests can stub it). */
export interface ActionHostDeps {
  tenantId: string
  /** Service-role database client (data grants). */
  supabase?: any
  actorId?: string | null
  fetchImpl?: typeof fetch
  /** Decrypt a stored secret value. */
  decrypt?: (ciphertext: string) => string
}

export const SECRET_REF = /^secret:\/\/([a-z][a-z0-9_]{1,62})$/

function cap(message: string): HostServiceError {
  return new HostServiceError(message, 'capability')
}

/** Is `host` within the approved ∩ declared lists? */
function hostPermitted(host: string, list: string[]): boolean {
  const h = host.toLowerCase()
  return list.some((entry) => {
    const e = entry.toLowerCase().replace(/:\d+$/, '')
    return e.startsWith('*.') ? h === e.slice(2) || h.endsWith(e.slice(1)) : h === e
  })
}

/**
 * The host for one run. `fileInputs` are the values given to the operation's
 * `file` inputs — the only files ctx.files.read may open.
 */
export function createActionHost(params: {
  manifest: ActionManifest
  operation: ActionOperation
  inputs: Record<string, unknown>
  grants: ActionGrants
  deps: ActionHostDeps
  /** Remaining wall-clock budget (ms) — HTTP timeouts never outlive the run. */
  remainingMs: () => number
}): SandboxHost {
  const { manifest, operation, inputs, grants, deps } = params
  const caps = manifest.capabilities ?? {}
  const declaredHosts = caps.http?.hosts ?? []
  const allowedHosts = declaredHosts.filter((h) => grants.approved_hosts.map((a) => a.toLowerCase()).includes(h.toLowerCase()))
  const declaredSecrets = new Set((caps.credentials ?? []).map((s) => s.name))

  const fileValues: unknown[] = []
  for (const field of operation.inputs) {
    if (field.type !== 'file') continue
    const v = inputs[field.name]
    if (Array.isArray(v)) fileValues.push(...v)
    else if (v !== null && v !== undefined && v !== '') fileValues.push(v)
  }

  function secretValue(ref: unknown): string {
    if (!caps.credentials?.length) throw cap('This action declares no secrets (capabilities.credentials)')
    const m = SECRET_REF.exec(String(ref ?? '').trim())
    const name = m?.[1] ?? String(ref ?? '').trim()
    if (!declaredSecrets.has(name)) throw cap(`secret://${name.slice(0, 60)} is not declared in the manifest`)
    const stored = grants.secret_values[name]
    if (!stored) throw new HostServiceError(`The secret "${name}" has not been set — an administrator sets it in Extensibility → Workflow actions`, 'host')
    try {
      return deps.decrypt ? deps.decrypt(stored) : stored
    } catch {
      throw new HostServiceError(`The secret "${name}" could not be decrypted`, 'host')
    }
  }

  async function grantFor(table: string, access: 'read' | 'write'): Promise<DataGrant> {
    if (!caps.data || (access === 'read' && !caps.data.read && !caps.data.write) || (access === 'write' && !caps.data.write)) {
      throw cap(`This action does not declare data ${access} access (capabilities.data.${access})`)
    }
    const t = table.trim()
    const lower = t.toLowerCase()
    const grant = grants.data_grants.find((g) => g.table_id === t || (g.name && g.name.toLowerCase() === lower))
    if (!grant) throw cap(`The table "${t.slice(0, 80)}" has not been granted to this action — an administrator grants tables in Extensibility → Workflow actions`)
    if (access === 'write' && grant.access !== 'write') throw cap(`The table "${grant.name ?? grant.table_id}" is granted read-only`)
    return grant
  }

  function serviceCtx(access: 'read' | 'write', tableId: string) {
    if (!deps.supabase) throw new HostServiceError('Data tables are not available here', 'host')
    return {
      supabase: deps.supabase,
      db: deps.supabase,
      tenantId: deps.tenantId,
      actorId: deps.actorId ?? null,
      permissions: new Set(access === 'write' ? ['data.view', 'data.manage_rows'] : ['data.view']),
      resourceScopes: { workflow_ids: [], table_ids: [tableId] },
      authKind: 'job' as const,
      source: 'job' as const,
    }
  }

  function rowOut(row: any) {
    return row ? { id: row.id, data: row.data ?? {}, created_at: row.created_at ?? null, updated_at: row.updated_at ?? null } : null
  }

  async function dataCall(name: string, args: unknown[]) {
    const svc = await import('@/lib/services/data-tables')
    const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn()
      } catch (error) {
        if (error instanceof HostServiceError) throw error
        throw new HostServiceError((error as Error)?.message ?? 'Data table request failed', 'host')
      }
    }
    switch (name) {
      case 'data.query': {
        const grant = await grantFor(String(args[0] ?? ''), 'read')
        const opts = isPlainObject(args[1]) ? args[1] : {}
        const limit = Math.min(ACTION_LIMITS.dataRowsPerQuery, Math.max(1, Number(opts.limit) || 100))
        const offset = Math.max(0, Number(opts.offset) || 0)
        const filters = Array.isArray(opts.filters) ? opts.filters.filter(isPlainObject).map((f) => ({ field: String(f.field ?? ''), operator: String(f.operator ?? 'equals') as any, value: f.value })) : []
        const sort = typeof opts.sort === 'string' ? svc.parseRowOrder(opts.sort) : {}
        const result = await wrap(() => svc.queryRows(serviceCtx('read', grant.table_id) as any, grant.table_id, { search: typeof opts.search === 'string' ? opts.search : undefined, filters, ...sort }, { limit, offset }))
        return { rows: result.rows.map(rowOut), total: result.total, truncated: result.truncated }
      }
      case 'data.get': {
        const grant = await grantFor(String(args[0] ?? ''), 'read')
        return rowOut(await wrap(() => svc.getRow(serviceCtx('read', grant.table_id) as any, grant.table_id, String(args[1] ?? ''))))
      }
      case 'data.insert': {
        const grant = await grantFor(String(args[0] ?? ''), 'write')
        if (!isPlainObject(args[1])) throw new HostServiceError('insert(table, values): values must be an object', 'invalid')
        const [written] = await wrap(() => svc.upsertRows(serviceCtx('write', grant.table_id) as any, grant.table_id, [{ data: args[1] as Record<string, unknown> }]))
        return rowOut(written?.row)
      }
      case 'data.update': {
        const grant = await grantFor(String(args[0] ?? ''), 'write')
        if (!isPlainObject(args[2])) throw new HostServiceError('update(table, rowId, values): values must be an object', 'invalid')
        return rowOut(await wrap(() => svc.updateRow(serviceCtx('write', grant.table_id) as any, grant.table_id, String(args[1] ?? ''), args[2] as Record<string, unknown>)))
      }
    }
    throw cap(`${name} is not a host function`)
  }

  async function httpFetch(rawUrl: unknown, rawInit: unknown) {
    if (!caps.http) throw cap('This action does not declare HTTP access (capabilities.http)')
    let url: URL
    try {
      url = new URL(String(rawUrl ?? ''))
    } catch {
      throw new HostServiceError('fetch: not a valid URL', 'invalid')
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HostServiceError('fetch: only http(s) URLs', 'invalid')
    if (!hostPermitted(url.hostname, declaredHosts)) throw cap(`${url.hostname} is not in the manifest's capabilities.http.hosts`)
    if (!hostPermitted(url.hostname, allowedHosts)) throw cap(`${url.hostname} has not been approved by an administrator for this action`)
    const init = isPlainObject(rawInit) ? rawInit : {}
    const method = String(init.method ?? 'GET').toUpperCase()
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) throw new HostServiceError(`fetch: method ${method} is not allowed`, 'invalid')
    const headers: Record<string, string> = {}
    if (isPlainObject(init.headers)) {
      for (const [k, v] of Object.entries(init.headers)) {
        if (/^(host|cookie|connection|content-length|transfer-encoding)$/i.test(k)) continue
        const value = typeof v === 'string' && SECRET_REF.test(v.replace(/^Bearer\s+/i, '').trim())
          ? v.replace(/secret:\/\/[a-z0-9_]+/i, (ref) => secretValue(ref))
          : String(v)
        headers[k] = value
      }
    }
    let body: string | undefined
    if (init.json !== undefined) {
      body = JSON.stringify(init.json)
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json'
    } else if (init.body !== undefined && init.body !== null) {
      body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body)
    }
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'user-agent')) headers['user-agent'] = `UserTasks-Action/${manifest.key}`
    const timeout = Math.max(100, Math.min(Number(init.timeout_ms) || 30_000, params.remainingMs()))
    const { safeFetch, EgressBlockedError } = await import('@/lib/egress-guard')
    let res: Response
    try {
      res = await safeFetch(url.toString(), { method, headers, body, signal: AbortSignal.timeout(timeout) }, { allowedHosts: allowedHosts.map((h) => h.replace(/:\d+$/, '')), fetchImpl: deps.fetchImpl })
    } catch (error) {
      if (error instanceof EgressBlockedError) throw cap(`Blocked by the egress guard: ${error.message}`)
      const timedOut = (error as Error)?.name === 'TimeoutError'
      throw new HostServiceError(timedOut ? `fetch ${url.hostname}: timed out` : `fetch ${url.hostname}: ${(error as Error)?.message ?? 'failed'}`, 'host', true)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > ACTION_LIMITS.httpResponseBytes) throw new HostServiceError(`fetch ${url.hostname}: response larger than ${ACTION_LIMITS.httpResponseBytes / 1024 / 1024} MB`, 'host')
    const text = buf.toString('utf8')
    let json: unknown = null
    if (/json/i.test(res.headers.get('content-type') ?? '') || /^\s*[[{]/.test(text)) {
      try { json = JSON.parse(text) } catch { json = null }
    }
    const outHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => { if (!/^set-cookie$/i.test(k)) outHeaders[k] = v })
    return { status: res.status, ok: res.ok, headers: outHeaders, text, json }
  }

  async function filesRead(file: unknown, rawOptions: unknown) {
    if (!caps.files) throw cap('This action does not declare file access (capabilities.files)')
    const key = (v: unknown) => {
      if (typeof v === 'string') return v.trim()
      if (isPlainObject(v)) return String(v.url ?? v.path ?? v.storage_ref ?? v.ref ?? v.id ?? '').trim()
      return ''
    }
    const wanted = key(file)
    const match = fileValues.find((v) => key(v) && key(v) === wanted)
    if (!wanted || !match) throw cap('ctx.files.read can only open a file given to this action as a file input')
    const { loadStepFiles } = await import('@/lib/workflow-files')
    let loaded
    try {
      ;[loaded] = await loadStepFiles(match, { tenantId: deps.tenantId, maxFiles: 1, maxTotalBytes: ACTION_LIMITS.fileBytes, timeoutMs: Math.max(1000, params.remainingMs()) })
    } catch (error) {
      throw new HostServiceError((error as Error)?.message ?? 'The file could not be read', 'host')
    }
    if (!loaded) throw new HostServiceError('The file could not be read', 'host')
    const options = isPlainObject(rawOptions) ? rawOptions : {}
    const asText = options.as === 'text'
    return {
      name: loaded.name,
      mime_type: loaded.mime_type,
      size: loaded.size,
      ...(asText ? { text: Buffer.from(loaded.bytes).toString('utf8') } : { base64: Buffer.from(loaded.bytes).toString('base64') }),
    }
  }

  return {
    async call(name, args) {
      if (name === 'http.fetch') return httpFetch(args[0], args[1])
      if (name.startsWith('data.')) return dataCall(name, args)
      if (name === 'files.read') return filesRead(args[0], args[1])
      if (name === 'secrets.get') return secretValue(args[0])
      if (name === 'crypto.hmac') {
        const [alg, key, data, encoding] = args
        const k = typeof key === 'string' && SECRET_REF.test(key.trim()) ? secretValue(key) : String(key ?? '')
        if (!k) throw new HostServiceError('hmac: a key (or secret://name) is required', 'invalid')
        return encodeBytes(createHmac(digestAlg(alg), k).update(toBytes(data)).digest(), String(encoding ?? 'hex'))
      }
      throw cap(`${name} is not a host function`)
    },
    callSync: syncHelpers,
  }
}
