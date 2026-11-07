/**
 * The UserTasks custom workflow action contract: what an action declares in
 * its manifest, the module it ships, and the `ctx` the sandbox gives it.
 *
 * Pure and isomorphic — shared by the app, the starter kit and the
 * @usertasks/action package (packages/action keeps a copy of the constants
 * and types; __tests__/custom-action-contract checks they agree).
 *
 * ── Manifest (manifest.json beside the module) ────────────────────────────
 *   manifest_version  1
 *   key           the action's identity in a workspace: lowercase letters,
 *                 digits and underscores (`acme_math`); `ut_` is reserved for
 *                 official gallery actions
 *   name          palette label; description; icon (Lucide name, kebab case);
 *                 color (#RRGGBB); category (palette group, free text)
 *   version       semver; each upload is a new immutable version
 *   entry         the module file in a zip package (default `dist/action.js`,
 *                 else the only .js / .mjs file)
 *   operations    one or more functions the action offers. Each has an `id`,
 *                 a `label`, a `description`, typed `inputs` and `outputs`
 *                 (see ActionField). The designer shows a function picker
 *                 when there is more than one, a generated input panel per
 *                 function and the outputs (with types) in the data picker.
 *   capabilities  what the code may ask the host for — nothing by default:
 *                   http     { hosts: ['api.example.com', '*.example.org'] }
 *                            requests go through the egress guard and only to
 *                            hosts an administrator approved (a subset)
 *                   data     { read?: true, write?: true } data table rows of
 *                            the tables an administrator granted
 *                   files    true — read the bytes of files given to the
 *                            action as `file` inputs (the run's own storage)
 *                   credentials  [{ name, label, description? }] secrets an
 *                            administrator stores (encrypted) for the action;
 *                            the code reads them as `secret://<name>`
 *   limits        { timeout_ms?, memory_mb? } defaults for every run (an
 *                 operator ceiling still applies: LIMITS below)
 *   summary, purpose, recommended_for, setup_notes  designer guidance
 *   author, license, homepage, tags
 *
 * ── Module ────────────────────────────────────────────────────────────────
 *   ONE self-contained ES module (bundle dependencies; no imports). Its
 *   default export is `defineAction({ operations: { <id>: fn } })` (or a
 *   plain function for a single-operation action). Each function receives
 *   `(inputs, ctx)` and returns its outputs as an object (or a promise of
 *   one). It runs in a QuickJS WebAssembly sandbox: no Node APIs, no
 *   process / env / fs / network / database, no timers; only `ctx`.
 *
 * ── ctx ───────────────────────────────────────────────────────────────────
 *   ctx.operation            the function id being run
 *   ctx.run                  { id, workflow_id, step_id, test } (ids only)
 *   ctx.log.info|warn|error(message, metadata?)
 *   ctx.http.fetch(url, { method, headers, body, json, timeout_ms })
 *                            → { status, ok, headers, text, json }  [http]
 *   ctx.data.query(table, { filters, search, sort, limit })   [data.read]
 *   ctx.data.get(table, rowId)                                [data.read]
 *   ctx.data.insert(table, values) / update(table, rowId, values) [data.write]
 *   ctx.files.read(file, { as: 'text' | 'base64' })           [files]
 *   ctx.secrets.get('secret://name')                      [credentials]
 *   ctx.crypto.randomUUID() / randomBytes(n, encoding) / digest(alg, data,
 *     encoding) / hmac(alg, key, data, encoding) / timingSafeEqual(a, b)
 *                            (always available, no authority)
 *   ctx.intl.formatNumber(value, locale, options) / formatDate(value,
 *     locale, options) / zonedParts(isoInstant, timeZone) / zonedToUtc(
 *     localIso, timeZone) / timeZones() (always available)
 *   Throw `new Error(message)` to fail the step; `ctx.fail(message,
 *   { retryable })` fails with a retry hint the workflow's retry policy uses.
 */

export const ACTION_MANIFEST_VERSION = 1

/** Field types an input or output may declare. */
export const ACTION_FIELD_TYPES = [
  'string', 'text', 'number', 'integer', 'boolean', 'date', 'datetime',
  'select', 'object', 'array', 'json', 'file',
] as const
export type ActionFieldType = (typeof ACTION_FIELD_TYPES)[number]

export const ACTION_CAPABILITIES = ['http', 'data', 'files', 'credentials'] as const
export type ActionCapability = (typeof ACTION_CAPABILITIES)[number]

/** Hard ceilings (an action's own limits are clamped to these). */
export const ACTION_LIMITS = {
  /** Module size (bytes). */
  moduleBytes: 1024 * 1024,
  /** Manifest size (bytes, JSON). */
  manifestBytes: 128 * 1024,
  operations: 40,
  fieldsPerOperation: 40,
  /** Wall-clock time per run (ms): default and ceiling. */
  defaultTimeoutMs: 10_000,
  maxTimeoutMs: 60_000,
  minTimeoutMs: 100,
  /** Sandbox heap (MB): default and ceiling. */
  defaultMemoryMb: 32,
  maxMemoryMb: 128,
  minMemoryMb: 8,
  /** Sandbox stack (bytes): ~1,300 frames of plain recursion; kept small so the
   *  guest overflows its own stack long before the host's. */
  stackBytes: 256 * 1024,
  /** Inputs and outputs crossing the sandbox boundary (bytes, JSON). */
  inputBytes: 5 * 1024 * 1024,
  outputBytes: 5 * 1024 * 1024,
  /** Host calls (http, data, files, …) per run. */
  hostCalls: 200,
  httpResponseBytes: 5 * 1024 * 1024,
  fileBytes: 10 * 1024 * 1024,
  logEntries: 200,
  logMessageChars: 2000,
  dataRowsPerQuery: 500,
} as const

/** A select option (type `select`). */
export interface ActionFieldOption {
  value: string
  label?: string
}

/** One input or output of an operation. */
export interface ActionField {
  /** Identifier (letters, digits, underscore; starts with a letter). */
  name: string
  label?: string
  type: ActionFieldType
  description?: string
  required?: boolean
  /** Inputs: used when the designer leaves the input empty. */
  default?: unknown
  /** Inputs: an example shown in the designer and used by Test. */
  example?: unknown
  /** type select: the choices. */
  options?: ActionFieldOption[]
  /** type array: the item type (and fields when items are objects). */
  items?: { type: ActionFieldType; fields?: ActionField[] }
  /** type object: its fields (the data picker shows them). */
  fields?: ActionField[]
  /** type text: multi-line editor in the designer. type string: placeholder. */
  placeholder?: string
}

export interface ActionOperation {
  id: string
  label: string
  description?: string
  inputs: ActionField[]
  outputs: ActionField[]
  /** Sample inputs for Test and the gallery (falls back to field examples). */
  sample?: Record<string, unknown>
}

export interface ActionSecretSpec {
  name: string
  label?: string
  description?: string
  required?: boolean
}

export interface ActionCapabilities {
  http?: { hosts: string[] }
  data?: { read?: boolean; write?: boolean }
  files?: boolean
  /** Named secrets (the key is not `secrets`: config-as-code scrubs values under secret-looking keys). */
  credentials?: ActionSecretSpec[]
}

export interface ActionManifest {
  manifest_version: 1
  key: string
  name: string
  version: string
  description?: string
  icon?: string
  color?: string
  category?: string
  entry?: string
  operations: ActionOperation[]
  capabilities: ActionCapabilities
  limits: { timeout_ms: number; memory_mb: number }
  summary?: string
  purpose?: string
  recommended_for?: string
  setup_notes?: string[]
  author?: string
  license?: string
  homepage?: string
  tags?: string[]
}

/** What a run returns to the engine (and to Test). */
export interface ActionRunResult {
  ok: boolean
  outputs: Record<string, unknown>
  logs: ActionLogEntry[]
  error?: { message: string; code: ActionErrorCode; retryable: boolean }
  stats: { duration_ms: number; host_calls: number; memory_bytes: number | null }
}

export interface ActionLogEntry {
  level: 'info' | 'warn' | 'error'
  message: string
  metadata?: Record<string, unknown>
  at?: string
}

/**
 * timeout      ran past its time limit (wall clock or CPU)
 * memory       exceeded its memory limit (or stack)
 * capability   asked for something its manifest / grants don't allow
 * action       the code threw (or called ctx.fail)
 * invalid      bad module, unknown operation, bad inputs or outputs
 * host         a host service failed (HTTP error, missing row, …)
 * disabled     the action is disabled (kill switch)
 */
export type ActionErrorCode = 'timeout' | 'memory' | 'capability' | 'action' | 'invalid' | 'host' | 'disabled'
export const ACTION_ERROR_CODES = ['timeout', 'memory', 'capability', 'action', 'invalid', 'host', 'disabled'] as const

/** `ut_` keys belong to official gallery actions. */
export const OFFICIAL_KEY_PREFIX = 'ut_'
