/**
 * @user-tasks/action/testing — run an action locally in the same QuickJS
 * sandbox UserTasks uses (sandbox.ts here is a verbatim copy of the app's),
 * with mocked host services:
 *
 *   import { readFileSync } from 'node:fs'
 *   import { runAction } from '@user-tasks/action/testing'
 *
 *   const result = await runAction({
 *     module: readFileSync('dist/action.js', 'utf8'),
 *     manifest: JSON.parse(readFileSync('manifest.json', 'utf8')),
 *     operation: 'add',
 *     inputs: { a: 1, b: 2 },
 *     mocks: { http: async (url) => ({ status: 200, json: { ok: true } }), secrets: { api_key: 'test' } },
 *   })
 *
 * Capabilities are enforced as in the app: HTTP only to manifest hosts,
 * secrets only by declared name, data / files only when declared. Needs the
 * optional peer dependencies quickjs-emscripten-core and
 * @jitl/quickjs-singlefile-cjs-release-sync.
 */

import { createHmac } from 'node:crypto'
import type { ActionManifest, ActionRunResult } from './contract'
import { ACTION_LIMITS } from './contract'
import { digestAlg, encodeBytes, syncHelpers, toBytes } from './helpers'
import { HostServiceError, runInSandbox } from './sandbox'

export { runInSandbox, HostServiceError } from './sandbox'
export { syncHelpers, zonedParts, zonedToUtc } from './helpers'

export interface ActionMocks {
  /** Answer ctx.http.fetch (only reached for hosts the manifest declares). */
  http?: (url: string, init: Record<string, unknown>) => Promise<{ status?: number; headers?: Record<string, string>; text?: string; json?: unknown }> | { status?: number; headers?: Record<string, string>; text?: string; json?: unknown }
  /** Tables by name: rows of `data` objects. Writes change these arrays. */
  data?: Record<string, Array<Record<string, unknown>>>
  /** Files by url / name: text content (or `{ base64 }`). */
  files?: Record<string, string | { base64: string; mime_type?: string }>
  /** Secret values by declared name. */
  secrets?: Record<string, string>
}

export interface RunActionOptions {
  module: string
  manifest: ActionManifest | Record<string, unknown>
  operation?: string
  inputs?: Record<string, unknown>
  mocks?: ActionMocks
  timeoutMs?: number
  memoryMb?: number
}

function fail(message: string): never {
  throw new HostServiceError(message, 'capability')
}

/** Run one operation with mocks. Never throws: failures come back as `{ ok: false, error }`. */
export async function runAction(options: RunActionOptions): Promise<ActionRunResult> {
  const manifest = options.manifest as ActionManifest
  const caps = manifest.capabilities ?? {}
  const mocks = options.mocks ?? {}
  const operation = options.operation ?? manifest.operations?.[0]?.id ?? 'run'
  const hosts = caps.http?.hosts ?? []
  const secretNames = new Set((caps.credentials ?? []).map((s) => s.name))
  const secret = (ref: unknown) => {
    const name = String(ref ?? '').replace(/^secret:\/\//, '')
    if (!secretNames.has(name)) fail(`secret://${name} is not declared in the manifest`)
    const value = mocks.secrets?.[name]
    if (value === undefined) throw new HostServiceError(`The secret "${name}" has no mock value`, 'host')
    return value
  }
  const table = (name: unknown, write: boolean) => {
    if (!caps.data || (write && !caps.data.write)) fail(`This action does not declare data ${write ? 'write' : 'read'} access`)
    const rows = mocks.data?.[String(name)]
    if (!rows) fail(`The table "${String(name)}" is not granted (no mock)`)
    return rows
  }
  let nextId = 1
  const row = (data: Record<string, unknown>) => {
    if (typeof data.__id !== 'string') Object.defineProperty(data, '__id', { value: `row_${nextId++}`, enumerable: false, writable: true })
    return { id: data.__id as string, data: { ...data }, created_at: null, updated_at: null }
  }
  const result = await runInSandbox({
    source: options.module,
    mode: 'module',
    operation,
    inputs: options.inputs ?? {},
    timeoutMs: options.timeoutMs ?? manifest.limits?.timeout_ms ?? ACTION_LIMITS.defaultTimeoutMs,
    memoryMb: options.memoryMb ?? manifest.limits?.memory_mb ?? ACTION_LIMITS.defaultMemoryMb,
    run: { id: 'local', workflow_id: null, step_id: null, test: true },
    host: {
      callSync: syncHelpers,
      async call(name, args) {
        switch (name) {
          case 'http.fetch': {
            if (!caps.http) fail('This action does not declare HTTP access')
            const url = new URL(String(args[0]))
            const h = url.hostname.toLowerCase()
            if (!hosts.some((e) => (e.startsWith('*.') ? h === e.slice(2) || h.endsWith(e.slice(1)) : h === e.replace(/:\d+$/, '')))) fail(`${h} is not in the manifest's capabilities.http.hosts`)
            if (!mocks.http) throw new HostServiceError(`No HTTP mock for ${url}`, 'host')
            const res = await mocks.http(url.toString(), (args[1] ?? {}) as Record<string, unknown>)
            const status = res.status ?? 200
            const text = res.text ?? (res.json !== undefined ? JSON.stringify(res.json) : '')
            return { status, ok: status >= 200 && status < 300, headers: res.headers ?? {}, text, json: res.json ?? null }
          }
          case 'secrets.get': return secret(args[0])
          case 'crypto.hmac': {
            const [alg, key, data, encoding] = args
            const k = typeof key === 'string' && key.startsWith('secret://') ? secret(key) : String(key ?? '')
            return encodeBytes(createHmac(digestAlg(alg), k).update(toBytes(data)).digest(), String(encoding ?? 'hex'))
          }
          case 'data.query': {
            const rows = table(args[0], false)
            const opts = (args[1] ?? {}) as { limit?: number; offset?: number }
            const all = rows.map(row)
            const offset = Number(opts.offset) || 0
            return { rows: all.slice(offset, offset + (Number(opts.limit) || 100)), total: all.length, truncated: false }
          }
          case 'data.get': return table(args[0], false).map(row).find((r) => r.id === String(args[1])) ?? null
          case 'data.insert': {
            const rows = table(args[0], true)
            const data = { ...(args[1] as Record<string, unknown>) }
            rows.push(data)
            return row(data)
          }
          case 'data.update': {
            const rows = table(args[0], true)
            const target = rows.find((r) => row(r).id === String(args[1]))
            if (!target) throw new HostServiceError('Row not found', 'host')
            Object.assign(target, args[2])
            return row(target)
          }
          case 'files.read': {
            if (!caps.files) fail('This action does not declare file access')
            const key = typeof args[0] === 'string' ? args[0] : String((args[0] as Record<string, unknown>)?.url ?? (args[0] as Record<string, unknown>)?.name ?? '')
            const file = mocks.files?.[key]
            if (file === undefined) throw new HostServiceError(`No mock file "${key}"`, 'host')
            const bytes = typeof file === 'string' ? Buffer.from(file, 'utf8') : Buffer.from(file.base64, 'base64')
            const as = (args[1] as { as?: string } | undefined)?.as
            return { name: key.split('/').pop(), mime_type: typeof file === 'string' ? 'text/plain' : file.mime_type ?? 'application/octet-stream', size: bytes.length, ...(as === 'text' ? { text: bytes.toString('utf8') } : { base64: bytes.toString('base64') }) }
          }
        }
        fail(`${name} is not a host function`)
      },
    },
  })
  const { raw: _raw, variables: _variables, ...rest } = result
  return rest
}
