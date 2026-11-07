/**
 * The custom action sandbox: tenant code runs in QuickJS compiled to
 * WebAssembly (quickjs-emscripten), never in the app's own JavaScript
 * engine.
 *
 * Why this is a security boundary (node:vm and `new Function` are not):
 *   - The guest is a separate JavaScript engine inside a WebAssembly
 *     instance. It shares no objects, prototypes or globals with Node: there
 *     is no `process`, `require`, `globalThis` of the host, no fs, sockets,
 *     timers or fetch to reach — only what this file injects. Constructor-
 *     chain tricks (`(0).constructor.constructor('return process')()`) reach
 *     the guest's own Function, which can only see the guest's own globals.
 *   - WebAssembly memory is bounds-checked linear memory: guest code cannot
 *     read or write host memory. Each run gets a fresh runtime + context
 *     (no state shared between runs, actions or workspaces).
 *   - Memory is capped per run (setMemoryLimit) and the native stack too;
 *     CPU is capped by an interrupt handler polled by the interpreter (a
 *     `while (true) {}` is interrupted at the deadline); wall-clock time
 *     (host calls included) is capped by the run loop below.
 *   - The only way out is `ctx`: a small set of host functions that take and
 *     return JSON strings. Every capability is checked on the HOST side
 *     against the manifest and the administrator's approvals
 *     (lib/custom-actions/host.ts) — the guest cannot forge a grant.
 *
 * No native addon (isolated-vm needs one, and breaks on serverless builds);
 * the WebAssembly build is a single file and runs anywhere Node 20 runs.
 * A CPU-bound guest runs on the event loop until its deadline (default 10 s,
 * ceiling 60 s) — limits are per run and operators can lower the ceiling
 * with CUSTOM_ACTION_MAX_TIMEOUT_MS.
 *
 * Server only.
 */

import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten-core'
import { ACTION_LIMITS, type ActionErrorCode, type ActionLogEntry, type ActionRunResult } from './contract'

type QuickJsLoader = { newQuickJSWASMModuleFromVariant: (variant: never) => Promise<QuickJSWASMModule>; variant: unknown }
let loaderPromise: Promise<QuickJsLoader> | null = null

/**
 * A fresh WebAssembly instance per run (~3 ms): every run gets its own
 * linear memory, so nothing — not even a QuickJS bug — can carry state from
 * one run (or workspace) to the next, and a trapped instance is just dropped.
 */
async function quickJs(): Promise<QuickJSWASMModule> {
  if (!loaderPromise) {
    loaderPromise = (async () => {
      const [core, variant] = await Promise.all([
        import('quickjs-emscripten-core'),
        import('@jitl/quickjs-singlefile-cjs-release-sync'),
      ])
      return { newQuickJSWASMModuleFromVariant: core.newQuickJSWASMModuleFromVariant as QuickJsLoader['newQuickJSWASMModuleFromVariant'], variant: (variant as { default?: unknown }).default ?? variant }
    })()
    loaderPromise.catch(() => { loaderPromise = null })
  }
  const loader = await loaderPromise
  return loader.newQuickJSWASMModuleFromVariant(loader.variant as never)
}

/** Host services the guest may call. Each returns JSON-able data or throws. */
export interface SandboxHost {
  /** Async capability calls (http, data, files, secrets). */
  call?(name: string, args: unknown[]): Promise<unknown>
  /** Sync, authority-free helpers (crypto, intl). */
  callSync?(name: string, args: unknown[]): unknown
}

export interface SandboxRunOptions {
  /** The ES module (mode 'module') or legacy activity source (mode 'legacy'). */
  source: string
  mode: 'module' | 'legacy'
  /** Operation id (module mode). */
  operation: string
  inputs: Record<string, unknown>
  timeoutMs: number
  memoryMb: number
  host?: SandboxHost
  /** ctx.run (ids only). */
  run?: { id?: string | null; workflow_id?: string | null; step_id?: string | null; test?: boolean }
  /** Legacy activities: the context object and variables snapshot their helpers see. */
  legacy?: { context: Record<string, unknown>; variables: Record<string, unknown>; resolveExpression?: (expression: string) => unknown }
}

export interface SandboxRunResult extends ActionRunResult {
  /** Legacy mode: the raw value the activity returned (the engine normalises it). */
  raw?: unknown
  /** Legacy mode: helpers.setVariable writes, applied by the engine. */
  variables?: Record<string, unknown>
}

class SandboxError extends Error {
  constructor(message: string, readonly code: ActionErrorCode, readonly retryable = false) {
    super(message)
    this.name = 'SandboxError'
  }
}

/** Operator ceiling on per-run time (env), never above the contract's. */
export function maxTimeoutMs(): number {
  const env = Number(process.env.CUSTOM_ACTION_MAX_TIMEOUT_MS)
  return Number.isFinite(env) && env >= ACTION_LIMITS.minTimeoutMs ? Math.min(env, ACTION_LIMITS.maxTimeoutMs) : ACTION_LIMITS.maxTimeoutMs
}

// Guest-side bootstrap: builds `ctx` over the two host functions, then hides
// them. Everything crossing the boundary is a JSON string.
const BOOTSTRAP = String.raw`
(() => {
  const hostCall = globalThis.__ut_host_call
  const hostSync = globalThis.__ut_host_sync
  const hostLog = globalThis.__ut_host_log
  delete globalThis.__ut_host_call
  delete globalThis.__ut_host_sync
  delete globalThis.__ut_host_log
  const call = async (name, ...args) => {
    const text = await hostCall(name, JSON.stringify(args))
    return text === undefined || text === '' ? undefined : JSON.parse(text)
  }
  const sync = (name, ...args) => {
    const text = hostSync(name, JSON.stringify(args))
    return text === undefined || text === '' ? undefined : JSON.parse(text)
  }
  const log = (level) => (message, metadata) => {
    let meta
    try { meta = metadata === undefined ? undefined : JSON.stringify(metadata) } catch (e) { meta = undefined }
    hostLog(level, String(message), meta)
  }
  const logger = { info: log('info'), warn: log('warn'), error: log('error'), debug: log('info') }
  globalThis.console = { log: logger.info, info: logger.info, warn: logger.warn, error: logger.error, debug: logger.info }
  const freeze = Object.freeze
  globalThis.__ut_make_ctx = (meta) => freeze({
    operation: meta.operation,
    run: freeze(meta.run),
    log: freeze(logger),
    fail(message, options) {
      const error = new Error(String(message))
      error.__ut_retryable = Boolean(options && options.retryable)
      throw error
    },
    http: freeze({ fetch: (url, init) => call('http.fetch', String(url), init || {}) }),
    data: freeze({
      query: (table, options) => call('data.query', String(table), options || {}),
      get: (table, rowId) => call('data.get', String(table), String(rowId)),
      insert: (table, values) => call('data.insert', String(table), values || {}),
      update: (table, rowId, values) => call('data.update', String(table), String(rowId), values || {}),
    }),
    files: freeze({ read: (file, options) => call('files.read', file, options || {}) }),
    secrets: freeze({ get: (ref) => call('secrets.get', String(ref)) }),
    crypto: freeze({
      randomUUID: () => sync('crypto.randomUUID'),
      randomBytes: (n, encoding) => sync('crypto.randomBytes', n, encoding || 'hex'),
      randomInt: (min, max) => sync('crypto.randomInt', min, max),
      digest: (alg, data, encoding) => sync('crypto.digest', alg, data, encoding || 'hex'),
      hmac: (alg, key, data, encoding) => call('crypto.hmac', alg, key, data, encoding || 'hex'),
      timingSafeEqual: (a, b) => sync('crypto.timingSafeEqual', String(a), String(b)),
      encode: (data, from, to) => sync('crypto.encode', data, from, to),
    }),
    intl: freeze({
      formatNumber: (value, locale, options) => sync('intl.formatNumber', value, locale, options || {}),
      formatDate: (value, locale, options) => sync('intl.formatDate', value, locale, options || {}),
      zonedParts: (instant, timeZone) => sync('intl.zonedParts', instant, timeZone),
      zonedToUtc: (local, timeZone) => sync('intl.zonedToUtc', local, timeZone),
      timeZones: () => sync('intl.timeZones'),
      collate: (a, b, locale, options) => sync('intl.collate', a, b, locale, options || {}),
    }),
  })
  const encode = (value) => {
    if (value === undefined) return 'null'
    return JSON.stringify(value)
  }
  globalThis.__ut_run_module = async (ns, inputsJson, metaJson) => {
    const meta = JSON.parse(metaJson)
    const inputs = JSON.parse(inputsJson)
    const ctx = globalThis.__ut_make_ctx(meta)
    const def = ns.default !== undefined ? ns.default : ns
    if (meta.operation === '__ut_list__') {
      // Upload-time probe: which operations have a function (nothing runs).
      const ops = def && typeof def === 'object' ? (def.operations || def) : null
      const names = ops ? Object.keys(ops).filter((k) => typeof ops[k] === 'function') : []
      return encode({ operations: names, single: typeof def === 'function' })
    }
    let fn = null
    if (typeof def === 'function') fn = def
    else if (def && typeof def === 'object') {
      const ops = def.operations || def
      if (ops && typeof ops[meta.operation] === 'function') fn = ops[meta.operation]
      else if (typeof def.run === 'function') fn = def.run
    }
    if (!fn && typeof ns[meta.operation] === 'function') fn = ns[meta.operation]
    if (!fn) {
      const error = new Error('The module has no function for operation "' + meta.operation + '" (export default defineAction({ operations: { ' + meta.operation + ': … } }))')
      error.__ut_invalid = true
      throw error
    }
    const result = await fn(inputs, ctx)
    return encode(result)
  }
})()
`

const LEGACY_PREFIX = `globalThis.__ut_legacy = async function (inputs, context, helpers, module, exports) {
"use strict";
`
const LEGACY_SUFFIX = `
const __candidate =
  typeof run === 'function' ? run :
  typeof execute === 'function' ? execute :
  typeof handler === 'function' ? handler :
  typeof main === 'function' ? main :
  (module && typeof module.exports === 'function' ? module.exports : null) ||
  (module && module.exports && typeof module.exports.default === 'function' ? module.exports.default : null) ||
  (exports && typeof exports.default === 'function' ? exports.default : null)
if (typeof __candidate !== 'function') {
  throw new Error("Custom activity source must export one of run, execute, handler, main, module.exports, or module.exports.default")
}
return await __candidate(inputs, context, helpers)
};`

const LEGACY_RUNNER = `globalThis.__ut_run_legacy = async (inputsJson, contextJson, variablesJson) => {
  const inputs = JSON.parse(inputsJson)
  const context = JSON.parse(contextJson)
  const variables = JSON.parse(variablesJson)
  const writes = {}
  const ctx = globalThis.__ut_make_ctx({ operation: 'run', run: context.run || {} })
  const helpers = Object.freeze({
    resolveExpression: (expression) => { const t = __ut_resolve(String(expression)); return t === '' ? undefined : JSON.parse(t) },
    getVariable: (name) => (Object.prototype.hasOwnProperty.call(writes, name) ? writes[name] : variables[name]),
    setVariable: (name, value) => { writes[String(name)] = value; return value },
    log: (message, metadata, level) => ctx.log[level === 'warn' || level === 'error' ? level : 'info'](message, metadata),
    uuid: () => ctx.crypto.randomUUID(),
    now: () => new Date().toISOString(),
  })
  const module = { exports: {} }
  const result = await globalThis.__ut_legacy(inputs, context, helpers, module, module.exports)
  return JSON.stringify({ result: result === undefined ? null : result, writes })
}`

function errorFromGuest(dumped: unknown): SandboxError {
  const e = (dumped && typeof dumped === 'object' ? dumped : { message: String(dumped) }) as Record<string, unknown>
  const message = String(e.message ?? e.name ?? 'The action failed')
  const name = String(e.name ?? '')
  if (/interrupted/i.test(message) || name === 'InternalError' && /interrupt/i.test(message)) return new SandboxError('The action ran past its time limit', 'timeout', true)
  if (/out of memory|string too long|invalid array length/i.test(message)) return new SandboxError('The action ran out of memory', 'memory')
  if (/stack overflow/i.test(message) || /Maximum call stack/i.test(message)) return new SandboxError('The action overflowed its stack (deep recursion?)', 'memory')
  if (e.__ut_invalid) return new SandboxError(message, 'invalid')
  if (e.__ut_capability) return new SandboxError(message, 'capability')
  if (e.__ut_host) return new SandboxError(message, 'host', Boolean(e.__ut_retryable))
  return new SandboxError(message.slice(0, 2000), 'action', Boolean(e.__ut_retryable))
}

/** Errors a host service throws carry a code (capability / host) into the guest. */
export class HostServiceError extends Error {
  constructor(message: string, readonly code: 'capability' | 'host' | 'invalid' = 'host', readonly retryable = false) {
    super(message)
    this.name = 'HostServiceError'
  }
}

/**
 * Run one operation of an action (or a legacy activity) in a fresh QuickJS
 * runtime. Never throws: failures come back as `{ ok: false, error }`.
 */
export async function runInSandbox(options: SandboxRunOptions): Promise<SandboxRunResult> {
  const started = Date.now()
  const timeoutMs = Math.max(ACTION_LIMITS.minTimeoutMs, Math.min(options.timeoutMs, maxTimeoutMs()))
  const memoryBytes = Math.max(ACTION_LIMITS.minMemoryMb, Math.min(options.memoryMb, ACTION_LIMITS.maxMemoryMb)) * 1024 * 1024
  const deadline = started + timeoutMs
  const logs: ActionLogEntry[] = []
  let hostCalls = 0
  let memoryUsed: number | null = null
  let rt: QuickJSRuntime | null = null
  let vm: QuickJSContext | null = null
  let disposed = false
  const pending = new Set<Promise<void>>()
  const handles: QuickJSHandle[] = []

  const finish = (partial: Omit<SandboxRunResult, 'logs' | 'stats'>): SandboxRunResult => ({
    ...partial,
    logs,
    stats: { duration_ms: Date.now() - started, host_calls: hostCalls, memory_bytes: memoryUsed },
  })
  const failure = (error: SandboxError): SandboxRunResult => finish({ ok: false, outputs: {}, error: { message: error.message, code: error.code, retryable: error.retryable } })

  const inputsJson = JSON.stringify(options.inputs ?? {})
  if (inputsJson.length > ACTION_LIMITS.inputBytes) return failure(new SandboxError(`The inputs are larger than ${ACTION_LIMITS.inputBytes / 1024 / 1024} MB`, 'invalid'))
  if (Buffer.byteLength(options.source, 'utf8') > ACTION_LIMITS.moduleBytes) return failure(new SandboxError('The module is too large', 'invalid'))

  try {
    const qjs = await quickJs()
    rt = qjs.newRuntime()
    rt.setMemoryLimit(memoryBytes)
    rt.setMaxStackSize(ACTION_LIMITS.stackBytes)
    rt.setInterruptHandler(() => Date.now() > deadline)
    vm = rt.newContext()
    const ctxVm = vm

    const guestError = (error: unknown): QuickJSHandle => {
      const message = error instanceof Error ? error.message : String(error)
      const handle = ctxVm.newError(message.slice(0, 2000))
      if (error instanceof HostServiceError) {
        const flag = error.code === 'capability' ? '__ut_capability' : error.code === 'invalid' ? '__ut_invalid' : '__ut_host'
        ctxVm.setProp(handle, flag, ctxVm.true)
        if (error.retryable) ctxVm.setProp(handle, '__ut_retryable', ctxVm.true)
      } else {
        ctxVm.setProp(handle, '__ut_host', ctxVm.true)
      }
      return handle
    }

    const hostCallFn = ctxVm.newFunction('__ut_host_call', (nameH, argsH) => {
      const name = ctxVm.getString(nameH)
      const argsText = ctxVm.getString(argsH)
      const deferred = ctxVm.newPromise()
      hostCalls += 1
      const work = (async () => {
        if (hostCalls > ACTION_LIMITS.hostCalls) throw new HostServiceError(`More than ${ACTION_LIMITS.hostCalls} host calls in one run`, 'capability')
        if (!options.host?.call) throw new HostServiceError(`${name.split('.')[0]} is not available to this action`, 'capability')
        let args: unknown[]
        try { args = JSON.parse(argsText) } catch { throw new HostServiceError('Bad arguments', 'invalid') }
        return options.host.call(name, Array.isArray(args) ? args : [])
      })()
      const settled = work.then(
        (value) => {
          if (disposed || !deferred.alive) return
          const text = value === undefined ? '' : JSON.stringify(value)
          const h = ctxVm.newString(text)
          deferred.resolve(h)
          h.dispose()
        },
        (error) => {
          if (disposed || !deferred.alive) return
          const h = guestError(error)
          deferred.reject(h)
          h.dispose()
        },
      ).finally(() => { pending.delete(settled) })
      pending.add(settled)
      return deferred.handle
    })
    ctxVm.setProp(ctxVm.global, '__ut_host_call', hostCallFn)
    hostCallFn.dispose()

    const hostSyncFn = ctxVm.newFunction('__ut_host_sync', (nameH, argsH) => {
      const name = ctxVm.getString(nameH)
      try {
        if (!options.host?.callSync) throw new HostServiceError(`${name} is not available`, 'capability')
        const args = JSON.parse(ctxVm.getString(argsH))
        const value = options.host.callSync(name, Array.isArray(args) ? args : [])
        return ctxVm.newString(value === undefined ? '' : JSON.stringify(value))
      } catch (error) {
        return { error: guestError(error) }
      }
    })
    ctxVm.setProp(ctxVm.global, '__ut_host_sync', hostSyncFn)
    hostSyncFn.dispose()

    const hostLogFn = ctxVm.newFunction('__ut_host_log', (levelH, messageH, metaH) => {
      if (logs.length >= ACTION_LIMITS.logEntries) return
      const level = ctxVm.getString(levelH)
      const entry: ActionLogEntry = {
        level: level === 'warn' || level === 'error' ? level : 'info',
        message: ctxVm.getString(messageH).slice(0, ACTION_LIMITS.logMessageChars),
        at: new Date().toISOString(),
      }
      if (metaH && ctxVm.typeof(metaH) === 'string') {
        const text = ctxVm.getString(metaH)
        if (text.length <= 4000) {
          try {
            const meta = JSON.parse(text)
            if (meta && typeof meta === 'object' && !Array.isArray(meta)) entry.metadata = meta
          } catch { /* dropped */ }
        }
      }
      logs.push(entry)
      if (logs.length === ACTION_LIMITS.logEntries) logs.push({ level: 'warn', message: `Log limit reached (${ACTION_LIMITS.logEntries}); later entries were dropped` })
    })
    ctxVm.setProp(ctxVm.global, '__ut_host_log', hostLogFn)
    hostLogFn.dispose()

    if (options.mode === 'legacy') {
      const resolveFn = ctxVm.newFunction('__ut_resolve', (exprH) => {
        const expr = ctxVm.getString(exprH)
        try {
          const value = options.legacy?.resolveExpression ? options.legacy.resolveExpression(expr) : undefined
          return ctxVm.newString(value === undefined ? '' : JSON.stringify(value))
        } catch (error) {
          return { error: guestError(error) }
        }
      })
      ctxVm.setProp(ctxVm.global, '__ut_resolve', resolveFn)
      resolveFn.dispose()
    }

    const boot = ctxVm.evalCode(BOOTSTRAP, 'ut-bootstrap.js')
    if (boot.error) {
      const dumped = ctxVm.dump(boot.error)
      boot.error.dispose()
      throw errorFromGuest(dumped)
    }
    boot.value.dispose()

    const run = { id: options.run?.id ?? null, workflow_id: options.run?.workflow_id ?? null, step_id: options.run?.step_id ?? null, test: Boolean(options.run?.test) }
    let resultPromise: QuickJSHandle
    if (options.mode === 'module') {
      const evaluated = ctxVm.evalCode(options.source, 'action.js', { type: 'module' })
      if (evaluated.error) {
        const dumped = ctxVm.dump(evaluated.error)
        evaluated.error.dispose()
        const err = errorFromGuest(dumped)
        throw err.code === 'action' ? new SandboxError(`The module failed to load: ${err.message}`, 'invalid') : err
      }
      const nsPromise = evaluated.value
      handles.push(nsPromise)
      await settle(nsPromise)
      const nsState = ctxVm.getPromiseState(nsPromise)
      if (nsState.type === 'rejected') {
        const dumped = ctxVm.dump(nsState.error)
        nsState.error.dispose()
        const err = errorFromGuest(dumped)
        throw err.code === 'action' ? new SandboxError(`The module failed to load: ${err.message}`, 'invalid') : err
      }
      if (nsState.type !== 'fulfilled') throw new SandboxError('The module did not finish loading', 'invalid')
      const ns = nsState.value
      handles.push(ns)
      const runner = ctxVm.getProp(ctxVm.global, '__ut_run_module')
      handles.push(runner)
      const inputsH = ctxVm.newString(inputsJson)
      const metaH = ctxVm.newString(JSON.stringify({ operation: options.operation, run }))
      handles.push(inputsH, metaH)
      const called = ctxVm.callFunction(runner, ctxVm.undefined, ns, inputsH, metaH)
      if (called.error) {
        const dumped = ctxVm.dump(called.error)
        called.error.dispose()
        throw errorFromGuest(dumped)
      }
      resultPromise = called.value
    } else {
      const defined = ctxVm.evalCode(`${LEGACY_PREFIX}${options.source}${LEGACY_SUFFIX}\n${LEGACY_RUNNER}`, 'activity.js')
      if (defined.error) {
        const dumped = ctxVm.dump(defined.error)
        defined.error.dispose()
        const err = errorFromGuest(dumped)
        throw err.code === 'action' ? new SandboxError(`The activity source failed to load: ${err.message}`, 'invalid') : err
      }
      defined.value.dispose()
      const runner = ctxVm.getProp(ctxVm.global, '__ut_run_legacy')
      handles.push(runner)
      const context = { ...(options.legacy?.context ?? {}), run }
      const args = [inputsJson, safeJson(context), safeJson(options.legacy?.variables ?? {})].map((s) => ctxVm.newString(s))
      handles.push(...args)
      const called = ctxVm.callFunction(runner, ctxVm.undefined, ...args)
      if (called.error) {
        const dumped = ctxVm.dump(called.error)
        called.error.dispose()
        throw errorFromGuest(dumped)
      }
      resultPromise = called.value
    }
    handles.push(resultPromise)
    await settle(resultPromise)
    const state = ctxVm.getPromiseState(resultPromise)
    if (state.type === 'rejected') {
      const dumped = ctxVm.dump(state.error)
      state.error.dispose()
      throw errorFromGuest(dumped)
    }
    if (state.type !== 'fulfilled') throw new SandboxError('The action did not finish', 'timeout', true)
    const text = ctxVm.typeof(state.value) === 'string' ? ctxVm.getString(state.value) : 'null'
    state.value.dispose()
    memoryUsed = readMemory()
    if (text.length > ACTION_LIMITS.outputBytes) throw new SandboxError(`The outputs are larger than ${ACTION_LIMITS.outputBytes / 1024 / 1024} MB`, 'invalid')
    const parsed = text ? JSON.parse(text) : null
    if (options.mode === 'legacy') {
      const { result, writes } = (parsed ?? {}) as { result?: unknown; writes?: Record<string, unknown> }
      const outputs = result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : {}
      return finish({ ok: true, outputs, raw: result ?? null, variables: writes ?? {} })
    }
    if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
      throw new SandboxError('The action must return an object of outputs ({ name: value })', 'invalid')
    }
    return finish({ ok: true, outputs: (parsed ?? {}) as Record<string, unknown> })
  } catch (error) {
    memoryUsed = memoryUsed ?? readMemory()
    if (error instanceof SandboxError) return failure(error)
    const message = error instanceof Error ? error.message : String(error)
    if (/out of memory|memory access out of bounds|Maximum call stack|stack overflow/i.test(message)) {
      // The WebAssembly instance trapped; it is per run, so it is simply dropped.
      return failure(new SandboxError('The action ran out of memory or stack (deep recursion?)', 'memory'))
    }
    return failure(new SandboxError(message.slice(0, 2000), 'host'))
  } finally {
    disposed = true
    for (const h of handles) {
      try { if (h.alive) h.dispose() } catch { /* already gone */ }
    }
    try { vm?.dispose() } catch { /* a leaked handle must not crash the host */ }
    try { rt?.dispose() } catch { /* idem */ }
  }

  function readMemory(): number | null {
    if (!rt || !vm || disposed) return null
    try {
      const h = rt.computeMemoryUsage()
      const usage = vm.dump(h) as Record<string, number>
      h.dispose()
      return typeof usage?.memory_used_size === 'number' ? usage.memory_used_size : null
    } catch {
      return null
    }
  }

  /** Pump jobs until `promise` settles, waiting on host calls in between. */
  async function settle(promise: QuickJSHandle): Promise<void> {
    for (;;) {
      if (Date.now() > deadline) throw new SandboxError('The action ran past its time limit', 'timeout', true)
      const jobs = rt!.executePendingJobs()
      if (jobs.error) {
        const dumped = jobs.error.context.dump(jobs.error)
        jobs.error.dispose()
        throw errorFromGuest(dumped)
      }
      const state = vm!.getPromiseState(promise)
      if (state.type !== 'pending') {
        if (state.type === 'fulfilled' && state.value !== promise) {
          // getPromiseState returned a new handle for the value; the caller reads it again.
          state.value.dispose()
        } else if (state.type === 'rejected') {
          state.error.dispose()
        }
        return
      }
      if (pending.size === 0) {
        // Nothing left to wait for: a promise that never resolves.
        if (vm!.runtime.hasPendingJob()) continue
        throw new SandboxError('The action is waiting on something that never finishes (no host call pending)', 'action')
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        Promise.race([...pending]),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(1, deadline - Date.now() + 1)) }),
      ])
      if (timer) clearTimeout(timer)
    }
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, (_k, v) => (typeof v === 'bigint' ? String(v) : v))
  } catch {
    return '{}'
  }
}
