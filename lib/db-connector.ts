import { createHash } from "node:crypto"
import { lookup } from "node:dns/promises"
import net from "node:net"
import pg, { Pool, type PoolClient, type PoolConfig } from "pg"
import sql from "mssql"
import { decryptSensitiveFields } from "./secret-fields"
import { optionalPackageInstallHint } from "./optional-drivers"
import { assertSafeEgressHost } from "./egress-guard"
import { splitMongoUri } from "./connectors/definitions/mongodb"

export type DbType = "postgres" | "mssql" | "mysql" | "oracle" | "snowflake" | "mongodb"
export type AuthMethod = "sql" | "entra_password" | "entra_client_secret" | "entra_default"
export const SUPPORTED_DB_TYPES: DbType[] = ["postgres", "mssql", "mysql", "oracle", "snowflake", "mongodb"]

/**
 * TLS for the SQL drivers.
 *  - disable: plaintext
 *  - require: TLS without certificate verification (the pre-2026-10 "Require SSL" behaviour)
 *  - verify-ca: TLS, certificate chain verified (system CAs + ca_cert), host name not checked
 *  - verify-full: TLS, chain and host name verified (default for new Postgres connectors)
 */
export type TlsMode = "disable" | "require" | "verify-ca" | "verify-full"

export function isSupportedDbType(value: unknown): value is DbType {
  return typeof value === "string" && SUPPORTED_DB_TYPES.includes(value as DbType)
}

export interface DbConnectionConfig {
  type: DbType
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl?: boolean
  /** Explicit TLS mode; when absent `ssl` decides (legacy configs). */
  tlsMode?: TlsMode
  /** Extra CA certificate(s), PEM. */
  caCert?: string
  // MSSQL-specific
  trustServerCertificate?: boolean
  encrypt?: boolean
  instanceName?: string
  // Entra ID / Azure AD
  authMethod?: AuthMethod
  entraClientId?: string
  entraClientSecret?: string
  entraTenantId?: string
  connectionString?: string
  schema?: string
  warehouse?: string
  role?: string
  account?: string
  service?: string
  connectionType?: "sid" | "service_name" | "tns"
  tnsString?: string
  /** Oracle: tcp (default) or tcps. */
  protocol?: "tcp" | "tcps"
  /** Snowflake: password (default) or key_pair (SNOWFLAKE_JWT). */
  snowflakeAuth?: "password" | "key_pair"
  privateKey?: string
  privateKeyPassphrase?: string
}

export interface QueryResult {
  rows: Record<string, any>[]
  fields: { name: string; dataTypeID?: number }[]
  rowCount: number
  duration: number
  /** More rows matched than `maxRows`; `rows` holds the first `maxRows`. */
  truncated?: boolean
  /** The write ran in a transaction that was rolled back (dry run). */
  rolledBack?: boolean
}

export interface QueryOptions {
  /** Statement / call timeout (ms). Default 30 s. */
  timeoutMs?: number
  /** Rows kept from a result set. Default DB_MAX_ROWS or 5000. */
  maxRows?: number
  /** Run inside a read-only transaction where the database supports one (pg, mysql, oracle). */
  readOnly?: boolean
  /** Postgres: allow `;`-separated statements (simple protocol). Only for SQL written whole by the reference author. */
  allowMultiStatement?: boolean
  /**
   * Run the statement in a transaction (custom reference writes):
   *  - rollback: always roll back (dry run) — the result reports what would change;
   *  - maxAffected: more affected rows than this rolls back and throws
   *    AffectedRowsLimitError.
   */
  transaction?: { rollback?: boolean; maxAffected?: number }
}

/** A write affected more rows than its cap allows; the transaction was rolled back. */
export class AffectedRowsLimitError extends Error {
  affectedRows: number
  maxAffected: number
  constructor(affectedRows: number, maxAffected: number) {
    super(`This change would affect ${affectedRows} rows — more than the maximum of ${maxAffected}. Nothing was changed (rolled back).`)
    this.name = "AffectedRowsLimitError"
    this.affectedRows = affectedRows
    this.maxAffected = maxAffected
  }
}

/** Commit or roll back a write transaction: "rollback" for dry runs and over-cap writes (which then throw). */
function transactionOutcome(options: QueryOptions | undefined, affected: number): "commit" | "rollback" | "exceeded" {
  const tx = options?.transaction
  if (!tx) return "commit"
  if (tx.rollback) return "rollback"
  if (tx.maxAffected !== undefined && affected > tx.maxAffected) return "exceeded"
  return "commit"
}

export const DEFAULT_TIMEOUT_MS = 30_000

export function defaultMaxRows(): number {
  const env = Number(process.env.DB_MAX_ROWS)
  return Number.isFinite(env) && env > 0 ? Math.floor(env) : 5000
}

function resolveOptions(options?: QueryOptions) {
  const timeoutMs = options?.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const maxRows = options?.maxRows && options.maxRows > 0 ? Math.floor(options.maxRows) : defaultMaxRows()
  return { timeoutMs, maxRows, readOnly: !!options?.readOnly, allowMultiStatement: !!options?.allowMultiStatement }
}

function asBoolean(value: unknown, defaultValue = false) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const v = value.toLowerCase()
    if (v === "true" || v === "require" || v === "prefer" || v === "verify-full" || v === "verify-ca" || v === "skip-verify") return true
    if (v === "false" || v === "disable") return false
  }
  return defaultValue
}

function tlsModeFrom(value: unknown): TlsMode | undefined {
  if (typeof value !== "string") return undefined
  const v = value.toLowerCase()
  if (v === "verify-full" || v === "verify-ca" || v === "require" || v === "disable") return v
  if (v === "prefer") return "require"
  if (v === "skip-verify") return "require"
  return undefined
}

function parseUrlParts(raw: string | undefined) {
  if (!raw) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

// ─── Identifiers ───

const IDENT_PART = String.raw`(?:[A-Za-z_][A-Za-z0-9_$#]*|"[^"\u0000]{1,128}"|\[[^\]\u0000]{1,128}\]|\`[^\`\u0000]{1,128}\`)`
const IDENT_RE = new RegExp(`^${IDENT_PART}(?:\\.${IDENT_PART}){0,2}$`)

/** A table / view / procedure name: up to three dot-separated parts, each plain or quoted ("x", [x], `x`). */
export function isValidIdentifier(name: unknown): name is string {
  return typeof name === "string" && name.length <= 400 && IDENT_RE.test(name.trim())
}

export function assertIdentifier(name: unknown, label = "identifier"): string {
  const trimmed = typeof name === "string" ? name.trim() : ""
  if (!isValidIdentifier(trimmed)) {
    throw new Error(`Invalid ${label} "${String(name ?? "").slice(0, 80)}": use letters, digits and _ (schema.name), or a quoted name`)
  }
  return trimmed
}

const BIND_NAME_RE = /^@?[A-Za-z_][A-Za-z0-9_]{0,127}$/

function assertBindName(name: string): string {
  if (!BIND_NAME_RE.test(name)) throw new Error(`Invalid parameter name "${name.slice(0, 80)}"`)
  return name.replace(/^@/, "")
}

// ─── Egress (SSRF) ───

/**
 * Database hosts are user-supplied: every connection target goes through the
 * egress guard (private / loopback / metadata addresses are refused unless
 * ALLOW_PRIVATE_EGRESS=true). Returns the address to connect to — a vetted IP
 * for DNS names, so a re-resolve cannot swap in a private address.
 */
async function vetDbHost(host: string): Promise<string> {
  const target = String(host ?? "").trim().replace(/^\[|\]$/g, "")
  await assertSafeEgressHost(target)
  if (net.isIP(target)) return target
  try {
    const addresses = await lookup(target, { all: true })
    const first = addresses[0]?.address
    if (first) {
      await assertSafeEgressHost(first)
      return first
    }
  } catch (error) {
    if ((error as Error)?.name === "EgressBlockedError") throw error
  }
  return target
}

/** Hosts named in an Oracle TNS descriptor (HOST=…). */
function tnsHosts(tns: string): string[] {
  return [...tns.matchAll(/\(\s*HOST\s*=\s*([^)\s]+)\s*\)/gi)].map((m) => m[1])
}

/** host[:port] entries of a mongodb:// URI (userinfo stripped). */
export function mongoUriHosts(uri: string): string[] {
  const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]*)/i.exec(uri)
  if (!m) return []
  return m[1].split(",").map((h) => {
    const host = h.trim()
    if (host.startsWith("[")) return host.slice(1, host.indexOf("]"))
    return host.replace(/:\d+$/, "")
  }).filter(Boolean)
}

/** The Mongo driver's `lookup` socket option: every resolved address passes the egress guard. */
function guardedLookup(hostname: string, options: any, callback: (...args: any[]) => void) {
  const opts = typeof options === "function" ? {} : (options ?? {})
  const cb = typeof options === "function" ? options : callback
  ;(async () => {
    await assertSafeEgressHost(hostname)
    const res = (await lookup(hostname, { ...opts, all: true })) as unknown as { address: string; family: number }[]
    for (const a of res) await assertSafeEgressHost(a.address)
    return res
  })().then(
    (res) => (opts.all ? cb(null, res) : cb(null, res[0]?.address, res[0]?.family)),
    (err) => cb(err),
  )
}

// ─── Pool registry ───
// One pool per full connection identity (host, vetted address, database,
// user, PASSWORD hash, TLS settings…). A changed password or TLS setting is a
// new pool; idle pools are closed after POOL_IDLE_MS and the registry keeps at
// most MAX_POOLS (least recently used closed first).

const POOL_IDLE_MS = 10 * 60_000
const MAX_POOLS = 50

interface PoolEntry {
  value: any
  close: () => Promise<void> | void
}

const poolRegistry = new Map<string, Promise<PoolEntry>>()
const poolLastUsed = new Map<string, number>()
let sweepTimer: ReturnType<typeof setInterval> | null = null

function closeEntry(key: string) {
  const entry = poolRegistry.get(key)
  poolRegistry.delete(key)
  poolLastUsed.delete(key)
  entry?.then((e) => e.close()).catch(() => {})
}

function ensureSweeper() {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [key, used] of poolLastUsed) if (now - used > POOL_IDLE_MS) closeEntry(key)
  }, 60_000)
  sweepTimer.unref?.()
}

async function pooled<T>(key: string, create: () => Promise<PoolEntry>): Promise<T> {
  ensureSweeper()
  let entry = poolRegistry.get(key)
  if (!entry) {
    if (poolRegistry.size >= MAX_POOLS) {
      const oldest = [...poolLastUsed.entries()].sort((a, b) => a[1] - b[1])[0]
      if (oldest) closeEntry(oldest[0])
    }
    entry = create()
    poolRegistry.set(key, entry)
    entry.catch(() => {
      if (poolRegistry.get(key) === entry) {
        poolRegistry.delete(key)
        poolLastUsed.delete(key)
      }
    })
  }
  poolLastUsed.set(key, Date.now())
  return (await entry).value as T
}

/** Drop one pool (after a connection-level failure) or every pool (tests, shutdown). */
export async function closeDbPools(key?: string): Promise<void> {
  const keys = key ? [key] : [...poolRegistry.keys()]
  await Promise.all(keys.map(async (k) => {
    const entry = poolRegistry.get(k)
    poolRegistry.delete(k)
    poolLastUsed.delete(k)
    try { await (await entry)?.close() } catch { /* ignore */ }
  }))
}

/** Stable pool key: the whole connection config (password included) hashed, never stored in clear. */
export function dbPoolKey(config: DbConnectionConfig, address?: string): string {
  const material = JSON.stringify(Object.keys(config).sort().map((k) => [k, (config as any)[k]]).concat([["_address", address ?? ""]]))
  return `${config.type}:${createHash("sha256").update(material).digest("hex")}`
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.() } catch { /* ignore */ }
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`))
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// ─── Mongo connection string ───

export { splitMongoUri }

function mongoConnection(config: DbConnectionConfig) {
  if (!config.connectionString) throw new Error("MongoDB connection string is required")
  if (!/^mongodb(\+srv)?:\/\//i.test(config.connectionString)) throw new Error("MongoDB connection string must start with mongodb:// or mongodb+srv://")
  const split = splitMongoUri(config.connectionString)
  const username = config.username || split.username
  const password = config.password || split.password
  return { uri: split.uri, auth: username ? { username, password: password ?? "" } : undefined }
}

function buildOracleConnectString(config: DbConnectionConfig) {
  if (config.connectionType === "tns" && config.tnsString) return config.tnsString
  const service = config.service || config.database
  if (!service) throw new Error("Oracle service name or SID is required")
  if (config.connectionType === "sid") return `${config.host}:${config.port || 1521}:${service}`
  const prefix = config.protocol === "tcps" ? "tcps://" : ""
  return `${prefix}${config.host}:${config.port || 1521}/${service}`
}

// ─── PostgreSQL ───

function pgTlsMode(config: DbConnectionConfig): TlsMode {
  return config.tlsMode ?? (config.ssl ? "require" : "disable")
}

function pgSsl(config: DbConnectionConfig): PoolConfig["ssl"] {
  const mode = pgTlsMode(config)
  if (mode === "disable") return undefined
  if (mode === "require") return { rejectUnauthorized: false }
  const base: Record<string, any> = { rejectUnauthorized: true, servername: net.isIP(config.host) ? undefined : config.host }
  if (config.caCert) base.ca = config.caCert
  if (mode === "verify-ca") base.checkServerIdentity = () => undefined
  return base
}

async function getPgPool(config: DbConnectionConfig): Promise<Pool> {
  const address = await vetDbHost(config.host)
  const key = dbPoolKey(config, address)
  return pooled<Pool>(key, async () => {
    const pool = new Pool({
      host: address,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: pgSsl(config),
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: DEFAULT_TIMEOUT_MS,
      query_timeout: DEFAULT_TIMEOUT_MS + 5_000,
    })
    // An idle client's error (server restart, network drop) is emitted on the
    // pool; unhandled it would crash the process.
    pool.on("error", (err) => {
      console.warn(`[db-connector] postgres pool error (${config.host}): ${err.message}`)
    })
    return { value: pool, close: () => pool.end() }
  })
}

async function pgTest(
  config: DbConnectionConfig
): Promise<{ success: boolean; message: string; serverVersion?: string }> {
  let pool: Pool | null = null
  try {
    const address = await vetDbHost(config.host)
    pool = new Pool({
      host: address,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: pgSsl(config),
      max: 1,
      connectionTimeoutMillis: 15000,
    })
    pool.on("error", () => {})
    const result = await pool.query("SELECT version(), current_database()")
    const version = result.rows[0]?.version ?? "Unknown"
    const dbName = result.rows[0]?.current_database ?? config.database
    return {
      success: true,
      message: `Connected to ${dbName}`,
      serverVersion: version.split(",")[0], // Short version
    }
  } catch (error: any) {
    let message = error.message ?? "Connection failed"

    // Provide helpful hints for common errors
    if (message.includes("ECONNREFUSED")) {
      message += ` — Check that PostgreSQL is running on ${config.host}:${config.port}`
    } else if (message.includes("ENOTFOUND")) {
      message += ` — Could not resolve hostname "${config.host}"`
    } else if (message.includes("timeout") || message.includes("ETIMEDOUT")) {
      message += ` — Connection timed out. Check firewall rules`
    } else if (message.includes("password authentication failed")) {
      message += ` — Check username and password`
    } else if (message.includes("does not exist")) {
      message += ` — Database "${config.database}" not found`
    } else if (message.includes("no pg_hba.conf entry")) {
      message += ` — Server rejected the connection. Check pg_hba.conf on the server`
    } else if (/self[- ]signed|unable to verify|certificate/i.test(message)) {
      message += ` — The server certificate could not be verified. Paste the provider's CA certificate, or choose "Require (no certificate check)"`
    } else if (message.includes("SSL")) {
      message += ` — Try enabling or disabling SSL`
    }

    return { success: false, message }
  } finally {
    try { if (pool) await pool.end() } catch { /* ignore */ }
  }
}

/** pg Query that stops reading after `cap` rows (closes the portal with Sync). */
function cappedPgQuery(client: PoolClient, text: string, values: any[], cap: number, timeoutMs: number): Promise<{ result: any; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const QueryCtor: any = (pg as any).Query
    let truncated = false
    const query: any = new QueryCtor({
      text,
      values,
      rows: cap + 1,
      query_timeout: timeoutMs,
      callback: (err: Error | null, result: any) => (err ? reject(err) : resolve({ result, truncated })),
    })
    query.query_timeout = timeoutMs // read by Client#query for submittables
    // With a row limit pg does not pipeline Sync after Execute: it is ours to
    // send when we stop early, and after an error (else the client waits for
    // a ReadyForQuery that never comes).
    let synced = false
    const original = query.handlePortalSuspended.bind(query)
    query.handlePortalSuspended = (connection: any) => {
      if ((query._result?.rows?.length ?? 0) > cap) {
        truncated = true
        synced = true
        connection.sync()
        return
      }
      original(connection)
    }
    const originalError = query.handleError.bind(query)
    query.handleError = (err: Error, connection: any) => {
      if (!synced && connection && !/timeout/i.test(err?.message ?? "")) {
        synced = true
        try { connection.sync() } catch { /* connection gone */ }
      }
      originalError(err, connection)
    }
    ;(client as any).query(query)
  })
}

async function pgQuery(
  config: DbConnectionConfig,
  query: string,
  params?: any[],
  options?: QueryOptions,
): Promise<QueryResult> {
  const { timeoutMs, maxRows, readOnly, allowMultiStatement } = resolveOptions(options)
  const tx = !readOnly && !!options?.transaction
  const pool = await getPgPool(config)
  const client = await pool.connect()
  const start = Date.now()
  let failed: Error | undefined
  let rolledBack = false
  try {
    if (readOnly) await client.query("BEGIN READ ONLY")
    else if (tx) await client.query("BEGIN")
    const values = Array.isArray(params) ? params : params == null ? [] : [params]
    let result: any
    let truncated = false
    if (allowMultiStatement && values.length === 0) {
      // Author-written script: simple protocol (several statements allowed).
      result = await client.query({ text: query, query_timeout: timeoutMs } as any)
      if (Array.isArray(result)) result = result[result.length - 1]
    } else {
      // Extended protocol: exactly one statement; rows read in a capped portal.
      ;({ result, truncated } = await cappedPgQuery(client, query, values, maxRows, timeoutMs))
    }
    if (readOnly) await client.query("COMMIT")
    else if (tx) {
      const outcome = transactionOutcome(options, Number(result?.rowCount ?? 0))
      await client.query(outcome === "commit" ? "COMMIT" : "ROLLBACK")
      rolledBack = outcome !== "commit"
      if (outcome === "exceeded") throw new AffectedRowsLimitError(Number(result?.rowCount ?? 0), options!.transaction!.maxAffected!)
    }
    const rows: any[] = result?.rows ?? []
    if (rows.length > maxRows) {
      rows.length = maxRows
      truncated = true
    }
    return {
      rows,
      fields: (result?.fields ?? []).map((f: any) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      rowCount: result?.rowCount ?? rows.length,
      duration: Date.now() - start,
      ...(truncated ? { truncated } : {}),
      ...(rolledBack ? { rolledBack } : {}),
    }
  } catch (error) {
    failed = error as Error
    if ((readOnly || tx) && !rolledBack) await client.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    // A client whose statement failed mid-flight (timeout, cap) is discarded.
    client.release(failed && /timeout|terminat|Connection/i.test(failed.message) ? failed : undefined)
  }
}

async function pgListTables(config: DbConnectionConfig) {
  const result = await pgQuery(
    config,
    `SELECT schemaname as schema, tablename as name, 'table' as type
     FROM pg_tables
     WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
     UNION ALL
     SELECT schemaname, viewname, 'view'
     FROM pg_views
     WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
     ORDER BY type, schema, name`
  )
  return result.rows
}

async function pgListStoredProcedures(config: DbConnectionConfig) {
  const result = await pgQuery(
    config,
    `SELECT n.nspname as schema, p.proname as name,
            CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure' ELSE 'function' END as type
     FROM pg_proc p
     JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND p.prokind IN ('f', 'p')
     ORDER BY type, n.nspname, p.proname`
  )
  return result.rows
}

async function pgDescribeProcedure(config: DbConnectionConfig, schema: string, name: string) {
  const result = await pgQuery(
    config,
    `SELECT p.proname as name,
            pg_get_function_arguments(p.oid) as arguments,
            pg_get_function_result(p.oid) as return_type,
            CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure' END as type
     FROM pg_proc p
     JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = $1 AND p.proname = $2`,
    [schema, name]
  )
  return result.rows
}

async function pgDescribe(config: DbConnectionConfig, schema: string, table: string) {
  const result = await pgQuery(
    config,
    `SELECT column_name as column, data_type as type,
            is_nullable = 'YES' as nullable, column_default as default_value
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table]
  )
  return result.rows
}

// ─── MS SQL Server ───

async function getMssqlConfig(config: DbConnectionConfig): Promise<sql.config> {
  const opts: sql.config = {
    server: config.host,
    database: config.database,
    options: {
      encrypt: config.encrypt ?? config.ssl ?? false,
      // Legacy configs without the setting keep trusting the certificate;
      // connectors store trust_cert explicitly (default "false").
      trustServerCertificate: config.trustServerCertificate ?? true,
      connectTimeout: 15000,
      requestTimeout: DEFAULT_TIMEOUT_MS,
    },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30_000 },
  }

  // Only set port if no instance name (they're mutually exclusive in MSSQL)
  if (config.instanceName) {
    opts.options!.instanceName = config.instanceName
  } else {
    opts.port = config.port || 1433
  }

  const method = config.authMethod ?? "sql"

  if (method === "sql") {
    // Standard SQL authentication
    opts.user = config.username
    opts.password = config.password
  } else if (method === "entra_password") {
    // Entra ID with username + password (deprecated by Microsoft; blocked by MFA)
    (opts as any).authentication = {
      type: "azure-active-directory-password",
      options: {
        userName: config.username,
        password: config.password,
        clientId: config.entraClientId,
        tenantId: config.entraTenantId,
      },
    }
  } else if (method === "entra_client_secret") {
    // Entra ID with service principal (client ID + secret)
    (opts as any).authentication = {
      type: "azure-active-directory-service-principal-secret",
      options: {
        clientId: config.entraClientId!,
        clientSecret: config.entraClientSecret!,
        tenantId: config.entraTenantId!,
      },
    }
  } else if (method === "entra_default") {
    // DefaultAzureCredential (managed identity, CLI, env vars); tedious asks
    // the credential for a fresh token on every new pooled connection.
    (opts as any).authentication = {
      type: "azure-active-directory-default",
      options: { clientId: config.entraClientId || undefined },
    }
  }

  return opts
}

async function mssqlTest(
  config: DbConnectionConfig
): Promise<{ success: boolean; message: string; serverVersion?: string }> {
  let pool: sql.ConnectionPool | null = null
  try {
    await vetDbHost(config.host)
    const mssqlConfig = await getMssqlConfig(config)
    pool = new sql.ConnectionPool(mssqlConfig)
    pool.on("error", () => {})
    await pool.connect()
    const result = await pool.request().query("SELECT @@VERSION AS version, DB_NAME() AS db_name")
    const version = result.recordset[0]?.version ?? "Unknown"
    const dbName = result.recordset[0]?.db_name ?? config.database
    return {
      success: true,
      message: `Connected to ${dbName}`,
      serverVersion: version.split("\n")[0], // First line only
    }
  } catch (error: any) {
    let message = error.message ?? "Connection failed"

    // Provide helpful hints for common errors
    if (message.includes("ECONNREFUSED")) {
      message += ` — Check that SQL Server is running on ${config.host}:${config.port} and accepting TCP/IP connections`
    } else if (message.includes("ENOTFOUND")) {
      message += ` — Could not resolve hostname "${config.host}". Check the server address`
    } else if (message.includes("ETIMEDOUT") || message.includes("timeout")) {
      message += ` — Connection timed out. Check firewall rules and that the server is accessible from this network`
    } else if (message.includes("Login failed")) {
      const isAzure = config.host.includes(".database.windows.net")
      message += isAzure
        ? ` — Check username and password. For Azure SQL, the username should be just the login name (e.g. "sqladmin" not "sqladmin@server"). Verify the credentials in the Azure Portal under SQL Server > Settings > SQL admin.`
        : ` — Check username and password. Ensure SQL Server authentication is enabled (not just Windows auth).`
    } else if (message.includes("Cannot open database")) {
      message += ` — Database "${config.database}" not found. Check the database name`
    } else if (message.includes("TCP Provider")) {
      message += ` — SQL Server may not have TCP/IP enabled. Check SQL Server Configuration Manager`
    }

    return { success: false, message }
  } finally {
    try { if (pool) await pool.close() } catch { /* ignore close errors */ }
  }
}

async function getMssqlPool(config: DbConnectionConfig): Promise<sql.ConnectionPool> {
  // The server name is kept (Azure SQL routes on it); the host is vetted.
  const address = await vetDbHost(config.host)
  const key = dbPoolKey(config, address)
  const pool = await pooled<sql.ConnectionPool>(key, async () => {
    const created = new sql.ConnectionPool(await getMssqlConfig(config))
    created.on("error", (err: Error) => console.warn(`[db-connector] mssql pool error (${config.host}): ${err.message}`))
    try {
      await created.connect()
    } catch (error) {
      try { await created.close() } catch { /* ignore */ }
      throw error
    }
    return { value: created, close: () => created.close() }
  })
  if (!pool.connected && !(pool as any).connecting) {
    await closeDbPools(key)
    return getMssqlPool(config)
  }
  return pool
}

/** mssql parameter type for a JS value (strings stay NVARCHAR so Unicode survives). */
function mssqlType(value: unknown): any {
  if (typeof value === "number") {
    if (Number.isInteger(value)) return Math.abs(value) <= 2147483647 ? sql.Int : sql.BigInt
    return sql.Float
  }
  if (typeof value === "bigint") return sql.BigInt
  if (typeof value === "boolean") return sql.Bit
  if (value instanceof Date) return sql.DateTime2
  if (Buffer.isBuffer(value)) return sql.VarBinary(sql.MAX)
  return sql.NVarChar(sql.MAX)
}

function bindMssql(request: sql.Request, params: unknown) {
  const add = (name: string, value: unknown) => {
    const v = value != null && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value) ? JSON.stringify(value) : value
    if (v === null || v === undefined) request.input(name, sql.NVarChar(sql.MAX), null)
    else request.input(name, mssqlType(v), v)
  }
  if (Array.isArray(params)) params.forEach((value, i) => add(`p${i + 1}`, value))
  else if (params && typeof params === "object") for (const [k, v] of Object.entries(params)) add(assertBindName(k), v)
}

async function mssqlQuery(
  config: DbConnectionConfig,
  query: string,
  params?: unknown,
  options?: QueryOptions,
): Promise<QueryResult> {
  const { timeoutMs, maxRows } = resolveOptions(options)
  const pool = await getMssqlPool(config)
  const start = Date.now()
  if (options?.transaction) {
    // Writes: run inside a transaction, then commit or roll back (dry run / over the cap).
    const transaction = new sql.Transaction(pool)
    await transaction.begin()
    let done = false
    try {
      const result = await mssqlStream(new sql.Request(transaction), query, params, maxRows, timeoutMs, start)
      const outcome = transactionOutcome(options, result.rowCount)
      if (outcome === "commit") await transaction.commit()
      else await transaction.rollback()
      done = true
      if (outcome === "exceeded") throw new AffectedRowsLimitError(result.rowCount, options.transaction.maxAffected!)
      return outcome === "rollback" ? { ...result, rolledBack: true } : result
    } catch (error) {
      if (!done) await transaction.rollback().catch(() => {})
      throw error
    }
  }
  return mssqlStream(pool.request(), query, params, maxRows, timeoutMs, start)
}

function mssqlStream(request: sql.Request, query: string, params: unknown, maxRows: number, timeoutMs: number, start: number): Promise<QueryResult> {
  bindMssql(request, params)
  request.stream = true
  return withTimeout(new Promise<QueryResult>((resolve, reject) => {
    const rows: any[] = []
    let columns: string[] = []
    let truncated = false
    let cancelled = false
    request.on("recordset", (cols: Record<string, any>) => {
      // Last result set wins (EXEC / batches), as recordset did.
      columns = Object.keys(cols ?? {})
      if (!truncated) rows.length = 0
    })
    request.on("row", (row: any) => {
      if (rows.length < maxRows) rows.push(row)
      else if (!cancelled) {
        truncated = true
        cancelled = true
        request.cancel()
      }
    })
    request.on("error", (err: any) => {
      if (cancelled && (err?.code === "ECANCEL" || /cancel/i.test(err?.message ?? ""))) return
      reject(err)
    })
    request.on("done", (result: any) => {
      resolve({
        rows,
        fields: columns.length ? columns.map((name) => ({ name })) : rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [],
        rowCount: result?.rowsAffected?.length ? result.rowsAffected[result.rowsAffected.length - 1] : rows.length,
        duration: Date.now() - start,
        ...(truncated ? { truncated } : {}),
      })
    })
    request.query(query)
  }), timeoutMs + 5_000, "SQL Server query", () => request.cancel())
}

async function mssqlListTables(config: DbConnectionConfig) {
  const result = await mssqlQuery(
    config,
    `SELECT TABLE_SCHEMA as [schema], TABLE_NAME as name, 'table' as type
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_TYPE = 'BASE TABLE'
     UNION ALL
     SELECT TABLE_SCHEMA, TABLE_NAME, 'view'
     FROM INFORMATION_SCHEMA.VIEWS
     ORDER BY type, [schema], name`
  )
  return result.rows
}

async function mssqlListStoredProcedures(config: DbConnectionConfig) {
  const result = await mssqlQuery(
    config,
    `SELECT ROUTINE_SCHEMA as [schema], ROUTINE_NAME as name, ROUTINE_TYPE as type
     FROM INFORMATION_SCHEMA.ROUTINES
     WHERE ROUTINE_TYPE IN ('PROCEDURE', 'FUNCTION')
       AND ROUTINE_SCHEMA != 'sys'
     ORDER BY ROUTINE_TYPE, ROUTINE_SCHEMA, ROUTINE_NAME`
  )
  return result.rows
}

async function mssqlDescribeProcedure(config: DbConnectionConfig, schema: string, name: string) {
  const result = await mssqlQuery(
    config,
    `SELECT PARAMETER_NAME as name, DATA_TYPE as type, PARAMETER_MODE as mode,
            CHARACTER_MAXIMUM_LENGTH as max_length
     FROM INFORMATION_SCHEMA.PARAMETERS
     WHERE SPECIFIC_SCHEMA = @schema AND SPECIFIC_NAME = @name
     ORDER BY ORDINAL_POSITION`,
    { schema, name },
  )
  return result.rows
}

async function mssqlExecProcedure(config: DbConnectionConfig, procedureName: string, params: Record<string, any>, options?: QueryOptions) {
  const { timeoutMs, maxRows } = resolveOptions(options)
  const pool = await getMssqlPool(config)
  const start = Date.now()
  const request = pool.request()
  bindMssql(request, params)

  const result: any = await withTimeout(request.execute(procedureName), timeoutMs + 5_000, "SQL Server procedure", () => request.cancel())
  const rows: any[] = result.recordset ?? []
  const truncated = rows.length > maxRows
  return {
    rows: truncated ? rows.slice(0, maxRows) : rows,
    fields: rows.length ? Object.keys(rows[0]).map((n) => ({ name: n })) : [],
    rowCount: result.rowsAffected?.[0] ?? rows.length,
    duration: Date.now() - start,
    returnValue: result.returnValue,
    output: result.output,
    ...(truncated ? { truncated } : {}),
  }
}

async function mssqlDescribe(config: DbConnectionConfig, schema: string, table: string) {
  const result = await mssqlQuery(
    config,
    `SELECT COLUMN_NAME as [column], DATA_TYPE as type,
            CASE WHEN IS_NULLABLE = 'YES' THEN 1 ELSE 0 END as nullable,
            COLUMN_DEFAULT as default_value
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
     ORDER BY ORDINAL_POSITION`,
    { schema, table },
  )
  return result.rows
}

// ─── MySQL ───

function mysqlSsl(config: DbConnectionConfig): any {
  const mode = config.tlsMode ?? (asBoolean(config.ssl, true) ? "verify-full" : "disable")
  if (mode === "disable") return undefined
  if (mode === "require") return { rejectUnauthorized: false }
  return config.caCert ? { ca: config.caCert, rejectUnauthorized: true } : {}
}

async function getMysqlPool(config: DbConnectionConfig) {
  const address = await vetDbHost(config.host)
  const key = dbPoolKey(config, address)
  return pooled<any>(key, async () => {
    const mysql = await import("mysql2/promise")
    const pool = mysql.createPool({
      host: config.host,
      port: config.port || 3306,
      database: config.database,
      user: config.username,
      password: config.password,
      waitForConnections: true,
      connectionLimit: 5,
      maxIdle: 5,
      idleTimeout: 30000,
      enableKeepAlive: true,
      connectTimeout: 15000,
      ssl: mysqlSsl(config),
    })
    return { value: pool, close: () => pool.end() }
  })
}

async function mysqlTest(config: DbConnectionConfig): Promise<{ success: boolean; message: string; serverVersion?: string }> {
  let connection: any = null
  try {
    await vetDbHost(config.host)
    const mysql = await import("mysql2/promise")
    connection = await mysql.createConnection({
      host: config.host,
      port: config.port || 3306,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: mysqlSsl(config),
      connectTimeout: 15000,
    })
    const [rows] = await connection.query("SELECT VERSION() AS version, DATABASE() AS db_name")
    const row = Array.isArray(rows) ? rows[0] as any : null
    return {
      success: true,
      message: `Connected to ${row?.db_name ?? config.database}`,
      serverVersion: row?.version ?? "Unknown",
    }
  } catch (error: any) {
    return { success: false, message: error.message ?? "Connection failed" }
  } finally {
    try { await connection?.end() } catch {}
  }
}

async function mysqlQuery(config: DbConnectionConfig, query: string, params?: any, options?: QueryOptions): Promise<QueryResult> {
  const { timeoutMs, maxRows, readOnly } = resolveOptions(options)
  const tx = !readOnly && !!options?.transaction
  const pool = await getMysqlPool(config)
  const conn = await pool.getConnection()
  const start = Date.now()
  const values = Array.isArray(params) ? params : params != null && params !== "" ? [params] : []
  let rolledBack = false
  try {
    if (readOnly) await conn.query("START TRANSACTION READ ONLY")
    else if (tx) await conn.query("START TRANSACTION")
    const out = await new Promise<QueryResult>((resolve, reject) => {
      const rows: any[] = []
      let fields: any[] = []
      let header: any = null
      let truncated = false
      const q = conn.connection.query({ sql: query, values, timeout: timeoutMs })
      // Each result set starts with its fields (the last one wins, as CALL / multi-results did);
      // the OK packet that ends a CALL comes with no fields and must not clear the rows.
      q.on("fields", (f: any[]) => {
        if (!Array.isArray(f) || f.length === 0) return
        fields = f
        rows.length = 0
        truncated = false
      })
      q.on("result", (row: any) => {
        if (row && row.constructor?.name === "ResultSetHeader") { header = row; return }
        if (rows.length < maxRows) rows.push(row)
        else truncated = true // keep reading (bounded memory), stop storing
      })
      q.on("error", reject)
      q.on("end", () => resolve({
        rows,
        fields: fields.map((field: any) => ({ name: field.name, dataTypeID: field.columnType })),
        rowCount: header && !fields.length ? (header.affectedRows ?? 0) : rows.length,
        duration: Date.now() - start,
        ...(truncated ? { truncated } : {}),
      }))
    })
    if (readOnly) await conn.query("COMMIT")
    else if (tx) {
      const outcome = transactionOutcome(options, out.rowCount)
      await conn.query(outcome === "commit" ? "COMMIT" : "ROLLBACK")
      rolledBack = outcome !== "commit"
      if (outcome === "exceeded") throw new AffectedRowsLimitError(out.rowCount, options!.transaction!.maxAffected!)
      if (rolledBack) return { ...out, rolledBack }
    }
    return out
  } catch (error) {
    if ((readOnly || tx) && !rolledBack) await conn.query("ROLLBACK").catch(() => {})
    throw error
  } finally {
    conn.release()
  }
}

// ─── Optional drivers ───
// snowflake-sdk, oracledb and mongodb are optionalDependencies: installs (and
// the default Docker image) may leave them out. Loading one that is missing
// fails with an actionable message instead of a bare "Cannot find module".

const OPTIONAL_DRIVERS = {
  oracledb: "Oracle",
  "snowflake-sdk": "Snowflake",
  mongodb: "MongoDB",
} as const

export type OptionalDriver = keyof typeof OPTIONAL_DRIVERS

/** True when `error` (or an error in its `cause` chain) says `pkg` itself could not be resolved. */
export function isMissingModuleError(error: unknown, pkg: string): boolean {
  for (let e = error as { code?: unknown; message?: unknown; cause?: unknown } | null, depth = 0; e && depth < 5; e = e.cause as typeof e, depth++) {
    const message = typeof e.message === "string" ? e.message : String(e)
    // The package itself, not a module missing somewhere inside it (whose
    // require stack would also mention the package path).
    const subject = new RegExp(`(cannot find (module|package)|failed to load external module|can't resolve) ['"]?${pkg.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}(['"]|:|\\s|$)`, "i")
    if (subject.test(message)) return true
  }
  return false
}

export function missingDriverMessage(pkg: OptionalDriver): string {
  return `The ${OPTIONAL_DRIVERS[pkg]} connector requires the optional package ${pkg}; ${optionalPackageInstallHint(pkg)}.`
}

/** Runs a driver import, turning "module not found" into {@link missingDriverMessage}. */
export async function loadOptionalDriver<T>(pkg: OptionalDriver, load: () => Promise<T>): Promise<T> {
  try {
    return await load()
  } catch (error) {
    if (isMissingModuleError(error, pkg)) throw new Error(missingDriverMessage(pkg))
    throw error
  }
}

// Literal specifiers keep the imports visible to Next's output tracing, so an
// installed driver is copied into the standalone build.
const loadOracle = (): Promise<any> => loadOptionalDriver("oracledb", () => import("oracledb"))
const loadSnowflake = (): Promise<any> => loadOptionalDriver("snowflake-sdk", () => import("snowflake-sdk"))
const loadMongo = (): Promise<any> => loadOptionalDriver("mongodb", () => import("mongodb"))

// ─── Oracle ───

async function vetOracleHosts(config: DbConnectionConfig) {
  const hosts = config.connectionType === "tns" && config.tnsString ? tnsHosts(config.tnsString) : [config.host]
  for (const host of hosts) if (host) await vetDbHost(host)
}

async function getOraclePool(config: DbConnectionConfig) {
  await vetOracleHosts(config)
  const key = dbPoolKey(config)
  return pooled<any>(key, async () => {
    const oracledb: any = await loadOracle()
    const pool = await oracledb.createPool({
      user: config.username,
      password: config.password,
      connectString: buildOracleConnectString(config),
      poolMin: 0,
      poolMax: 4,
      poolIncrement: 1,
      poolTimeout: 60,
      connectTimeout: 15,
    })
    return { value: pool, close: () => pool.close(0) }
  })
}

async function oracleTest(config: DbConnectionConfig): Promise<{ success: boolean; message: string; serverVersion?: string }> {
  let connection: any = null
  try {
    const oracledb: any = await loadOracle()
    await vetOracleHosts(config)
    connection = await oracledb.getConnection({
      user: config.username,
      password: config.password,
      connectString: buildOracleConnectString(config),
      connectTimeout: 15,
    })
    const result = await connection.execute("SELECT banner FROM v$version WHERE ROWNUM = 1", [], { outFormat: oracledb.OUT_FORMAT_OBJECT })
    return {
      success: true,
      message: `Connected to ${config.database || config.service || "Oracle"}`,
      serverVersion: (result.rows?.[0] as any)?.BANNER ?? "Unknown",
    }
  } catch (error: any) {
    return { success: false, message: error.message ?? "Connection failed" }
  } finally {
    try { await connection?.close() } catch {}
  }
}

/** Oracle binds: an array (positional) or a plain object (named); anything else is no binds. */
function oracleBinds(params: unknown): any[] | Record<string, any> {
  if (Array.isArray(params)) return params
  if (params && typeof params === "object") {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(params)) out[assertBindName(k)] = v
    return out
  }
  return []
}

async function oracleQuery(config: DbConnectionConfig, query: string, params?: any, options?: QueryOptions): Promise<QueryResult> {
  const { timeoutMs, maxRows, readOnly } = resolveOptions(options)
  const oracledb: any = await loadOracle()
  const pool = await getOraclePool(config)
  const connection = await pool.getConnection()
  const start = Date.now()
  try {
    connection.callTimeout = timeoutMs
    const tx = !readOnly && !!options?.transaction
    if (readOnly) await connection.execute("SET TRANSACTION READ ONLY")
    const result = await connection.execute(query, oracleBinds(params), { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: !readOnly && !tx, maxRows: maxRows + 1 })
    if (readOnly) await connection.rollback()
    let rolledBack = false
    if (tx) {
      const affected = Number(result.rowsAffected ?? 0)
      const outcome = transactionOutcome(options, affected)
      if (outcome === "commit") await connection.commit()
      else { await connection.rollback(); rolledBack = true }
      if (outcome === "exceeded") throw new AffectedRowsLimitError(affected, options!.transaction!.maxAffected!)
    }
    const meta = Array.isArray(result.metaData) ? result.metaData : []
    const rows = Array.isArray(result.rows) ? result.rows as Record<string, any>[] : []
    const truncated = rows.length > maxRows
    if (truncated) rows.length = maxRows
    return {
      rows,
      fields: meta.map((field: any) => ({ name: field.name })),
      rowCount: result.rowsAffected ?? rows.length,
      duration: Date.now() - start,
      ...(truncated ? { truncated } : {}),
      ...(rolledBack ? { rolledBack } : {}),
    }
  } finally {
    try { await connection.close() } catch {}
  }
}

async function oracleExecProcedure(config: DbConnectionConfig, procedureName: string, params: Record<string, any>, options?: QueryOptions) {
  const { timeoutMs } = resolveOptions(options)
  const oracledb: any = await loadOracle()
  const pool = await getOraclePool(config)
  const connection = await pool.getConnection()
  const start = Date.now()
  try {
    connection.callTimeout = timeoutMs
    const binds = oracleBinds(params) as Record<string, any>
    // p1, p2, … (from a JSON array) bind by position; other names by name (param => :param).
    const names = Object.keys(binds)
    const positional = names.length > 0 && names.every((name) => /^p\d+$/.test(name))
    const bindClause = names.map((name) => (positional ? `:${name}` : `${name} => :${name}`)).join(", ")
    const plsql = `BEGIN ${procedureName}(${bindClause}); END;`
    const result = await connection.execute(plsql, binds, { autoCommit: true, outFormat: oracledb.OUT_FORMAT_OBJECT })
    return { rows: [], fields: [], rowCount: 0, duration: Date.now() - start, output: result?.outBinds ?? {} }
  } finally {
    try { await connection.close() } catch {}
  }
}

// ─── Snowflake ───

async function openSnowflakeConnection(config: DbConnectionConfig, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const account = config.account || config.host
  // The SDK builds <account>.snowflakecomputing.com; refuse anything that could steer the host.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(account ?? "")) throw new Error("Invalid Snowflake account identifier")
  const snowflake: any = await loadSnowflake()
  const keyPair = config.snowflakeAuth === "key_pair" || (!!config.privateKey && !config.password)
  const connection = snowflake.createConnection({
    account,
    username: config.username,
    ...(keyPair
      ? { authenticator: "SNOWFLAKE_JWT", privateKey: config.privateKey, ...(config.privateKeyPassphrase ? { privateKeyPass: config.privateKeyPassphrase } : {}) }
      : { password: config.password }),
    warehouse: config.warehouse,
    database: config.database,
    schema: config.schema,
    role: config.role || undefined,
    timeout: 15_000,
    application: "UserTasks",
  })

  try {
    await withTimeout(new Promise<void>((resolve, reject) => {
      connection.connect((err: Error | null) => err ? reject(err) : resolve())
    }), 20_000, "Snowflake login")
    await new Promise<void>((resolve, reject) => {
      connection.execute({
        sqlText: `ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = ${Math.max(1, Math.ceil(timeoutMs / 1000))}`,
        complete: (err: Error | null) => err ? reject(err) : resolve(),
      })
    })
  } catch (error) {
    try { connection.destroy(() => {}) } catch {}
    throw error
  }

  return connection
}

async function snowflakeTest(config: DbConnectionConfig): Promise<{ success: boolean; message: string; serverVersion?: string }> {
  let connection: any = null
  try {
    connection = await openSnowflakeConnection(config)
    const rows: any[] = await new Promise((resolve, reject) => {
      connection.execute({
        sqlText: "SELECT CURRENT_VERSION() AS VERSION, CURRENT_DATABASE() AS DB_NAME",
        complete: (err: Error | null, _stmt: any, resultRows: any[]) => err ? reject(err) : resolve(resultRows ?? []),
      })
    })
    return {
      success: true,
      message: `Connected to ${rows[0]?.DB_NAME ?? config.database}`,
      serverVersion: rows[0]?.VERSION ?? "Unknown",
    }
  } catch (error: any) {
    return { success: false, message: error.message ?? "Connection failed" }
  } finally {
    try { connection?.destroy?.(() => {}) } catch {}
  }
}

async function snowflakeQuery(config: DbConnectionConfig, query: string, params?: any, options?: QueryOptions): Promise<QueryResult> {
  const { timeoutMs, maxRows } = resolveOptions(options)
  const connection = await openSnowflakeConnection(config, timeoutMs)
  const start = Date.now()
  const tx = options?.transaction
  const run = (sqlText: string) => new Promise<void>((resolve, reject) => {
    connection.execute({ sqlText, complete: (err: Error | null) => (err ? reject(err) : resolve()) })
  })
  try {
    if (!tx) return await snowflakeStatement(connection, query, params, maxRows, timeoutMs, start)
    await run("BEGIN")
    let ended = false
    try {
      const result = await snowflakeStatement(connection, query, params, maxRows, timeoutMs, start)
      const outcome = transactionOutcome(options, result.rowCount)
      await run(outcome === "commit" ? "COMMIT" : "ROLLBACK")
      ended = true
      if (outcome === "exceeded") throw new AffectedRowsLimitError(result.rowCount, tx.maxAffected!)
      return outcome === "rollback" ? { ...result, rolledBack: true } : result
    } catch (error) {
      if (!ended) await run("ROLLBACK").catch(() => {})
      throw error
    }
  } finally {
    try { connection?.destroy?.(() => {}) } catch {}
  }
}

function snowflakeStatement(connection: any, query: string, params: any, maxRows: number, timeoutMs: number, start: number): Promise<QueryResult> {
  return withTimeout(new Promise<QueryResult>((resolve, reject) => {
    connection.execute({
      sqlText: query,
      binds: Array.isArray(params) ? params : undefined,
      streamResult: true,
      complete: (err: Error | null, stmt: any) => {
        if (err) return reject(err)
        const columns = stmt?.getColumns?.() ?? []
        const total = Number(stmt?.getNumRows?.() ?? 0)
        const rows: any[] = []
        const finish = () => resolve({
          rows,
          fields: Array.isArray(columns) ? columns.map((column: any) => ({ name: column.getName?.() ?? column.name })) : [],
          rowCount: Number(stmt?.getNumUpdatedRows?.() ?? 0) || total || rows.length,
          duration: Date.now() - start,
          ...(total > maxRows ? { truncated: true } : {}),
        })
        if (!total) return finish()
        const stream = stmt.streamRows({ start: 0, end: Math.min(total, maxRows) - 1 })
        stream.on("data", (row: any) => rows.push(row))
        stream.on("error", reject)
        stream.on("end", finish)
      },
    })
  }), timeoutMs + 5_000, "Snowflake query")
}

// ─── MongoDB ───

async function getMongoClient(config: DbConnectionConfig) {
  const { uri, auth } = mongoConnection(config)
  for (const host of mongoUriHosts(uri)) {
    if (net.isIP(host)) await assertSafeEgressHost(host)
  }
  // Credentials taken out of the URI are part of the pool identity too.
  const key = dbPoolKey({ ...config, connectionString: uri, username: auth?.username ?? "", password: auth?.password ?? "" })
  return pooled<any>(key, async () => {
    const { MongoClient } = await loadMongo()
    const client = new MongoClient(uri, {
      ...(auth ? { auth } : {}),
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 60_000,
      connectTimeoutMS: 15000,
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 60_000,
      lookup: guardedLookup,
    })
    try {
      await client.connect()
    } catch (error) {
      try { await client.close() } catch { /* ignore */ }
      // Node's "Invalid URL" carries the full URI (with credentials) on .input.
      throw new Error((error as Error)?.message ?? "MongoDB connection failed")
    }
    return { value: client, close: () => client.close() }
  })
}

async function mongoTest(config: DbConnectionConfig): Promise<{ success: boolean; message: string; serverVersion?: string }> {
  try {
    const client = await getMongoClient(config)
    const admin = client.db(config.database).admin()
    const result = await admin.command({ ping: 1 })
    return {
      success: true,
      message: `Connected to ${config.database}`,
      serverVersion: result?.ok === 1 ? "MongoDB reachable" : "Unknown",
    }
  } catch (error: any) {
    return { success: false, message: error.message ?? "Connection failed" }
  }
}

/** Server-side JavaScript operators: never accepted from a reference. */
const MONGO_JS_OPERATORS = new Set(["$where", "$function", "$accumulator"])
/** Pipeline stages that write: refused in the read-only aggregate operation. */
const MONGO_WRITE_STAGES = new Set(["$out", "$merge"])

/** Throws when `value` uses a server-side JavaScript operator (or, for pipelines, a write stage). */
export function assertSafeMongoValue(value: unknown, label: string, opts: { pipeline?: boolean } = {}, depth = 0): void {
  if (depth > 64) throw new Error(`${label} is nested too deeply`)
  if (Array.isArray(value)) {
    for (const item of value) assertSafeMongoValue(item, label, opts, depth + 1)
    return
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, nested] of Object.entries(value)) {
      if (MONGO_JS_OPERATORS.has(key)) throw new Error(`${label}: ${key} (server-side JavaScript) is not allowed`)
      if (opts.pipeline && depth <= 1 && MONGO_WRITE_STAGES.has(key)) throw new Error(`${label}: the ${key} stage is not allowed in Aggregate (it writes to a collection)`)
      assertSafeMongoValue(nested, label, opts, depth + 1)
    }
  }
}

function parseMongoJson(value: any, fallback: any, label: string) {
  if (value == null || value === "") return fallback
  if (typeof value === "object") return value
  try {
    return JSON.parse(String(value))
  } catch {
    throw new Error(`${label} must be valid JSON (e.g. {"status": "active"})`)
  }
}

function mongoFilter(value: any, label = "filter") {
  const filter = parseMongoJson(value, {}, label)
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) throw new Error(`${label} must be a JSON object`)
  assertSafeMongoValue(filter, label)
  return filter
}

const truthy = (v: unknown) => v === true || v === "true" || v === 1 || v === "1"

export async function executeMongoOperation(config: DbConnectionConfig, spec: Record<string, any>, options?: QueryOptions) {
  const { timeoutMs, maxRows } = resolveOptions(options)
  const operation = spec?.operation
  const collectionName = String(spec?.collection ?? "")
  if (collectionName && (/[$\u0000]/.test(collectionName) || /^system\./i.test(collectionName) || collectionName.length > 255)) {
    throw new Error(`Invalid collection name "${collectionName.slice(0, 80)}"`)
  }
  if (!operation) throw new Error("MongoDB operation is missing")
  const needsCollection = operation !== "listCollections"
  if (needsCollection && !collectionName) throw new Error("Collection is required")

  const client = await getMongoClient(config)
  const db = client.db(config.database)
  const collection = collectionName ? db.collection(collectionName) : null
  const readOpts = { maxTimeMS: timeoutMs }

  const requireFilterForMany = (filter: Record<string, any>, op: string) => {
    if (Object.keys(filter).length === 0 && !truthy(spec.allow_all)) {
      throw new Error(`${op} with an empty filter would affect every document; give a filter (or set allow_all to true)`)
    }
  }

  switch (operation) {
    case "find": {
      const filter = mongoFilter(spec.filter)
      const projection = parseMongoJson(spec.projection, undefined, "projection")
      const sort = parseMongoJson(spec.sort, undefined, "sort")
      if (projection) assertSafeMongoValue(projection, "projection")
      if (sort) assertSafeMongoValue(sort, "sort")
      const requested = Math.floor(Number(spec.limit ?? 100))
      const limit = Math.min(requested > 0 ? requested : 100, maxRows)
      const skip = Math.max(0, Math.floor(Number(spec.skip ?? 0)) || 0)
      const cursor = collection!.find(filter, { ...(projection ? { projection } : {}), ...readOpts })
      if (sort) cursor.sort(sort)
      if (skip > 0) cursor.skip(skip)
      cursor.limit(limit)
      const documents = await cursor.toArray()
      return { documents, count: documents.length }
    }
    case "findOne":
      return await collection!.findOne(mongoFilter(spec.filter), readOpts)
    case "insertOne": {
      const document = parseMongoJson(spec.document, null, "document")
      if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("document must be a JSON object")
      return await collection!.insertOne(document)
    }
    case "insertMany": {
      const documents = parseMongoJson(spec.documents, null, "documents")
      if (!Array.isArray(documents) || documents.length === 0) throw new Error("documents must be a non-empty JSON array")
      if (documents.length > maxRows) throw new Error(`insertMany accepts at most ${maxRows} documents per call`)
      return await collection!.insertMany(documents)
    }
    case "updateOne":
    case "updateMany": {
      const filter = mongoFilter(spec.filter)
      if (operation === "updateMany") requireFilterForMany(filter, "updateMany")
      const update = parseMongoJson(spec.update, null, "update")
      if (!update || typeof update !== "object") throw new Error("update must be a JSON object (e.g. {\"$set\": {…}}) or pipeline")
      assertSafeMongoValue(update, "update", { pipeline: Array.isArray(update) })
      return operation === "updateOne" ? await collection!.updateOne(filter, update) : await collection!.updateMany(filter, update)
    }
    case "deleteOne":
      return await collection!.deleteOne(mongoFilter(spec.filter))
    case "deleteMany": {
      const filter = mongoFilter(spec.filter)
      requireFilterForMany(filter, "deleteMany")
      return await collection!.deleteMany(filter)
    }
    case "aggregate": {
      const pipeline = parseMongoJson(spec.pipeline, [], "pipeline")
      if (!Array.isArray(pipeline)) throw new Error("pipeline must be a JSON array of stages")
      assertSafeMongoValue(pipeline, "pipeline", { pipeline: true })
      const documents = await collection!.aggregate([...pipeline, { $limit: maxRows + 1 }], readOpts).toArray()
      const truncated = documents.length > maxRows
      if (truncated) documents.length = maxRows
      return { documents, count: documents.length, ...(truncated ? { truncated } : {}) }
    }
    case "listCollections": {
      const collections = await db.listCollections().toArray()
      return { collections, count: collections.length }
    }
    case "countDocuments":
      return { count: await collection!.countDocuments(mongoFilter(spec.filter), readOpts) }
    default:
      throw new Error(`Unsupported MongoDB operation: ${operation}`)
  }
}

// ─── Public API (dispatches by type) ───

export async function testConnection(
  config: DbConnectionConfig
): Promise<{ success: boolean; message: string; serverVersion?: string }> {
  try {
    switch (config.type) {
      case "mongodb":
        return await mongoTest(config)
      case "snowflake":
        return await snowflakeTest(config)
      case "oracle":
        return await oracleTest(config)
      case "mysql":
        return await mysqlTest(config)
      case "mssql":
        return await mssqlTest(config)
      case "postgres":
      default:
        return await pgTest(config)
    }
  } catch (error: any) {
    return { success: false, message: error?.message ?? "Connection failed" }
  }
}

export async function executeQuery(
  config: DbConnectionConfig,
  query: string,
  params?: any,
  options?: QueryOptions,
): Promise<QueryResult> {
  try {
    switch (config.type) {
      case "mongodb":
        throw new Error("MongoDB references run operations, not SQL")
      case "snowflake":
        return await snowflakeQuery(config, query, params, options)
      case "oracle":
        return await oracleQuery(config, query, params, options)
      case "mysql":
        return await mysqlQuery(config, query, params, options)
      case "mssql":
        return await mssqlQuery(config, query, params, options)
      case "postgres":
      default:
        return await pgQuery(config, query, params, options)
    }
  } catch (error: any) {
    if (error instanceof AffectedRowsLimitError) throw error
    throw new Error(`Query failed: ${error.message}`)
  }
}

export async function listTables(
  config: DbConnectionConfig
): Promise<{ schema: string; name: string; type: string }[]> {
  switch (config.type) {
    case "mongodb": {
      const result = await executeMongoOperation(config, { operation: "listCollections" }) as any
      return (result.collections ?? []).map((collection: any) => ({
        schema: config.database,
        name: collection.name,
        type: "table",
      }))
    }
    case "mysql":
      return (await executeQuery(config, `
        SELECT TABLE_SCHEMA as schema_name, TABLE_NAME as name, LOWER(TABLE_TYPE) as type
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_TYPE, TABLE_NAME
      `)).rows.map((row: any) => ({ schema: row.schema_name, name: row.name, type: row.type === "view" ? "view" : "table" }))
    case "oracle":
      return (await executeQuery(config, `
        SELECT OWNER as schema_name, TABLE_NAME as name, 'table' as type FROM ALL_TABLES
        UNION ALL
        SELECT OWNER as schema_name, VIEW_NAME as name, 'view' as type FROM ALL_VIEWS
      `)).rows.map((row: any) => ({ schema: row.SCHEMA_NAME ?? row.schema_name ?? row.OWNER, name: row.NAME ?? row.name, type: String(row.TYPE ?? row.type).toLowerCase() }))
    case "snowflake":
      return (await executeQuery(config, `
        SELECT TABLE_SCHEMA as schema_name, TABLE_NAME as name, LOWER(TABLE_TYPE) as type
        FROM INFORMATION_SCHEMA.TABLES
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `)).rows.map((row: any) => ({ schema: row.SCHEMA_NAME ?? row.schema_name, name: row.NAME ?? row.name, type: String(row.TYPE ?? row.type).toLowerCase() }))
    case "mssql":
      return mssqlListTables(config) as any
    case "postgres":
    default:
      return pgListTables(config) as any
  }
}

export async function describeTable(
  config: DbConnectionConfig,
  schema: string,
  table: string
): Promise<{ column: string; type: string; nullable: boolean; default_value: string | null }[]> {
  switch (config.type) {
    case "mongodb": {
      const client = await getMongoClient(config)
      const sample = await client.db(config.database).collection(table).findOne({})
      return Object.keys(sample ?? {}).map((key) => ({
        column: key,
        type: Array.isArray((sample as any)?.[key]) ? "array" : typeof (sample as any)?.[key],
        nullable: true,
        default_value: null,
      }))
    }
    case "mysql":
      return (await executeQuery(config, `
        SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type, IS_NULLABLE = 'YES' as nullable, COLUMN_DEFAULT as default_value
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `, [schema, table])).rows.map((row: any) => ({
        column: row.column_name,
        type: row.data_type,
        nullable: !!row.nullable,
        default_value: row.default_value ?? null,
      }))
    case "oracle":
      return (await executeQuery(config, `
        SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type, CASE WHEN NULLABLE = 'Y' THEN 1 ELSE 0 END as nullable, DATA_DEFAULT as default_value
        FROM ALL_TAB_COLUMNS
        WHERE OWNER = :1 AND TABLE_NAME = :2
        ORDER BY COLUMN_ID
      `, [schema.toUpperCase(), table.toUpperCase()])).rows.map((row: any) => ({
        column: row.COLUMN_NAME ?? row.column_name,
        type: row.DATA_TYPE ?? row.data_type,
        nullable: !!(row.NULLABLE ?? row.nullable),
        default_value: row.DATA_DEFAULT ?? row.default_value ?? null,
      }))
    case "snowflake":
      return (await executeQuery(config, `
        SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type, IFF(IS_NULLABLE='YES', TRUE, FALSE) as nullable, COLUMN_DEFAULT as default_value
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
      `, [schema, table])).rows.map((row: any) => ({
        column: row.COLUMN_NAME ?? row.column_name,
        type: row.DATA_TYPE ?? row.data_type,
        nullable: !!(row.NULLABLE ?? row.nullable),
        default_value: row.COLUMN_DEFAULT ?? row.default_value ?? null,
      }))
    case "mssql":
      return mssqlDescribe(config, schema, table) as any
    case "postgres":
    default:
      return pgDescribe(config, schema, table) as any
  }
}

export async function listStoredProcedures(
  config: DbConnectionConfig
): Promise<{ schema: string; name: string; type: string }[]> {
  switch (config.type) {
    case "mongodb":
      return []
    case "mysql":
      return (await executeQuery(config, `
        SELECT ROUTINE_SCHEMA as schema_name, ROUTINE_NAME as routine_name, LOWER(ROUTINE_TYPE) as routine_type
        FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_SCHEMA = DATABASE()
        ORDER BY ROUTINE_TYPE, ROUTINE_NAME
      `)).rows.map((row: any) => ({ schema: row.schema_name, name: row.routine_name, type: row.routine_type }))
    case "oracle":
      return (await executeQuery(config, `
        SELECT OWNER as schema_name, OBJECT_NAME as object_name, LOWER(OBJECT_TYPE) as object_type
        FROM ALL_PROCEDURES
        WHERE OBJECT_TYPE IN ('PROCEDURE', 'FUNCTION')
      `)).rows.map((row: any) => ({ schema: row.SCHEMA_NAME ?? row.schema_name, name: row.OBJECT_NAME ?? row.object_name, type: row.OBJECT_TYPE ?? row.object_type }))
    case "snowflake":
      return (await executeQuery(config, `
        SELECT PROCEDURE_SCHEMA as schema_name, PROCEDURE_NAME as procedure_name, 'procedure' as procedure_type
        FROM INFORMATION_SCHEMA.PROCEDURES
      `)).rows.map((row: any) => ({ schema: row.SCHEMA_NAME ?? row.schema_name, name: row.PROCEDURE_NAME ?? row.procedure_name, type: row.PROCEDURE_TYPE ?? row.procedure_type }))
    case "mssql":
      return mssqlListStoredProcedures(config) as any
    case "postgres":
    default:
      return pgListStoredProcedures(config) as any
  }
}

export async function describeProcedure(
  config: DbConnectionConfig,
  schema: string,
  name: string
): Promise<any[]> {
  switch (config.type) {
    case "mongodb":
      return []
    case "mysql":
      return (await executeQuery(config, `
        SELECT PARAMETER_NAME as name, DATA_TYPE as type, 0 as is_output, 0 as has_default
        FROM INFORMATION_SCHEMA.PARAMETERS
        WHERE SPECIFIC_SCHEMA = ? AND SPECIFIC_NAME = ?
        ORDER BY ORDINAL_POSITION
      `, [schema, name])).rows
    case "oracle":
      return (await executeQuery(config, `
        SELECT ARGUMENT_NAME as name, DATA_TYPE as type,
               CASE WHEN IN_OUT IN ('OUT', 'IN/OUT') THEN 1 ELSE 0 END as is_output,
               CASE WHEN DEFAULTED = 'Y' THEN 1 ELSE 0 END as has_default
        FROM ALL_ARGUMENTS
        WHERE OWNER = :1 AND OBJECT_NAME = :2
        ORDER BY POSITION
      `, [schema.toUpperCase(), name.toUpperCase()])).rows
    case "snowflake":
      return (await executeQuery(config, `
        SELECT ARGUMENT_SIGNATURE as name, DATA_TYPE as type, FALSE as is_output, FALSE as has_default
        FROM INFORMATION_SCHEMA.PROCEDURES
        WHERE PROCEDURE_SCHEMA = ? AND PROCEDURE_NAME = ?
      `, [schema, name])).rows
    case "mssql":
      return mssqlDescribeProcedure(config, schema, name) as any
    case "postgres":
    default:
      return pgDescribeProcedure(config, schema, name) as any
  }
}

export async function executeStoredProcedure(
  config: DbConnectionConfig,
  procedureName: string,
  params: Record<string, any> = {},
  options?: QueryOptions,
): Promise<QueryResult & { returnValue?: number; output?: any }> {
  try {
    if (config.type === "mongodb") throw new Error("MongoDB does not support stored procedures in this connector")
    const name = assertIdentifier(procedureName, "procedure name")
    const safeParams: Record<string, any> = {}
    for (const [k, v] of Object.entries(params ?? {})) safeParams[assertBindName(k)] = v
    const values = Object.values(safeParams)
    switch (config.type) {
      case "oracle":
        return await oracleExecProcedure(config, name, safeParams, options)
      case "mysql":
        return await mysqlQuery(config, `CALL ${name}(${values.map(() => "?").join(", ")})`, values, options)
      case "snowflake":
        return await snowflakeQuery(config, `CALL ${name}(${values.map(() => "?").join(", ")})`, values, options)
      case "mssql":
        return await mssqlExecProcedure(config, name, safeParams, options)
      case "postgres":
      default: {
        const placeholders = values.map((_, i) => `$${i + 1}`).join(", ")
        return await pgQuery(config, `SELECT * FROM ${name}(${placeholders})`, values, options)
      }
    }
  } catch (error: any) {
    throw new Error(`Stored procedure failed: ${error.message}`)
  }
}

export function parseDbConfig(rawIntegrationConfig: any): DbConnectionConfig | null {
  // Central read boundary: credential fields (db_config.password, auth_config.password, …)
  // are encrypted at rest — decrypt here so every DB caller gets usable credentials.
  // Idempotent no-op for plaintext/legacy configs.
  const integrationConfig = decryptSensitiveFields(rawIntegrationConfig)
  const db = integrationConfig?.db_config ?? {}
  const headers = integrationConfig?.headers ?? {}
  const authConfig = integrationConfig?.auth_config ?? {}
  const parsedUrl = parseUrlParts(integrationConfig?.base_url)
  const urlType = parsedUrl?.protocol ? parsedUrl.protocol.replace(":", "").replace("+srv", "") : ""
  const dbType = db.db_type ?? headers.db_type ?? (urlType === "postgresql" ? "postgres" : urlType || "postgres")
  if (!isSupportedDbType(dbType)) return null

  const host = db.host ?? headers.host ?? headers.account ?? parsedUrl?.hostname ?? ""
  const database = db.database ?? headers.database ?? (parsedUrl?.pathname ? parsedUrl.pathname.replace(/^\/+/, "") : "")
  const port = Number(db.port ?? headers.port) || (dbType === "mssql" ? 1433 : dbType === "mysql" ? 3306 : dbType === "oracle" ? 1521 : 5432)

  if (dbType !== "mongodb" && dbType !== "snowflake" && !host) return null
  if (!database) return null

  const rawSsl = db.ssl ?? headers.ssl
  return {
    type: dbType,
    host,
    port,
    database,
    username: db.username ?? authConfig.username ?? parsedUrl?.username ?? "",
    password: db.password ?? authConfig.password ?? parsedUrl?.password ?? "",
    ssl: asBoolean(rawSsl, false),
    tlsMode: tlsModeFrom(rawSsl),
    caCert: headers.ca_cert || db.ca_cert || undefined,
    trustServerCertificate: asBoolean(db.trustServerCertificate ?? headers.trustServerCertificate, true),
    encrypt: asBoolean(db.encrypt ?? headers.encrypt, false),
    instanceName: db.instanceName,
    authMethod: db.auth_method as AuthMethod,
    entraClientId: db.entra_client_id,
    entraClientSecret: db.entra_client_secret,
    entraTenantId: db.entra_tenant_id,
    connectionString: headers.connection_string ?? integrationConfig?.base_url,
    schema: headers.schema ?? db.schema,
    warehouse: headers.warehouse ?? db.warehouse,
    role: headers.role ?? db.role,
    account: headers.account ?? db.account ?? parsedUrl?.hostname ?? "",
    service: headers.service ?? db.service,
    connectionType: headers.connection_type ?? db.connection_type,
    tnsString: headers.tns_string ?? db.tns_string,
    protocol: (headers.protocol ?? db.protocol) === "tcps" ? "tcps" : undefined,
    snowflakeAuth: (authConfig.auth_method ?? db.snowflake_auth) === "key_pair" ? "key_pair" : undefined,
    privateKey: authConfig.private_key || db.private_key || undefined,
    privateKeyPassphrase: authConfig.private_key_passphrase || db.private_key_passphrase || undefined,
  }
}

// ─── Database object discovery ───

export interface DbObject {
  name: string
  schema: string
  type: 'table' | 'view' | 'procedure'
  fullName: string
}

export interface DbParameter {
  name: string
  type: string
  isOutput: boolean
  hasDefault: boolean
}

export async function discoverObjects(config: DbConnectionConfig): Promise<DbObject[]> {
  if (config.type === 'mongodb') {
    const collections = await listTables(config)
    return collections.map((c) => ({
      name: c.name,
      schema: c.schema,
      type: 'table',
      fullName: `${c.schema}.${c.name}`,
    }))
  }
  if (config.type === 'mssql') {
    const result = await executeQuery(config, `
      SELECT TABLE_SCHEMA as [schema], TABLE_NAME as name, 'table' as type FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'
      UNION ALL
      SELECT TABLE_SCHEMA, TABLE_NAME, 'view' FROM INFORMATION_SCHEMA.VIEWS
      UNION ALL
      SELECT ROUTINE_SCHEMA, ROUTINE_NAME, 'procedure' FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_TYPE = 'PROCEDURE'
      ORDER BY type, [schema], name
    `)
    return (result.rows ?? []).map((r: any) => ({
      name: r.name,
      schema: r.schema,
      type: r.type as DbObject['type'],
      fullName: `[${r.schema}].[${r.name}]`,
    }))
  }
  if (config.type !== 'postgres') {
    const [tables, procs] = await Promise.all([listTables(config), listStoredProcedures(config)])
    return [
      ...tables.map((t) => ({ name: t.name, schema: t.schema, type: (t.type === 'view' ? 'view' : 'table') as DbObject['type'], fullName: `${t.schema}.${t.name}` })),
      ...procs.filter((p) => String(p.type).toLowerCase() === 'procedure').map((p) => ({ name: p.name, schema: p.schema, type: 'procedure' as const, fullName: `${p.schema}.${p.name}` })),
    ]
  }
  const result = await executeQuery(config, `
    SELECT table_schema as schema, table_name as name, 'table' as type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type = 'BASE TABLE'
    UNION ALL
    SELECT table_schema, table_name, 'view' FROM information_schema.views WHERE table_schema NOT IN ('pg_catalog','information_schema')
    UNION ALL
    SELECT routine_schema, routine_name, 'procedure' FROM information_schema.routines WHERE routine_schema NOT IN ('pg_catalog','information_schema') AND routine_type IN ('PROCEDURE','FUNCTION')
    ORDER BY type, schema, name
  `)
  return (result.rows ?? []).map((r: any) => ({
    name: r.name,
    schema: r.schema,
    type: r.type as DbObject['type'],
    fullName: r.schema === 'public' ? r.name : `${r.schema}.${r.name}`,
  }))
}

export async function discoverParameters(config: DbConnectionConfig, schema: string, procName: string): Promise<DbParameter[]> {
  if (config.type === 'mongodb') return []
  if (config.type === 'mssql') {
    const result = await executeQuery(config, `
      SELECT
        PARAMETER_NAME as name,
        DATA_TYPE as type,
        CASE WHEN PARAMETER_MODE = 'INOUT' OR PARAMETER_MODE = 'OUT' THEN 1 ELSE 0 END as is_output,
        0 as has_default
      FROM INFORMATION_SCHEMA.PARAMETERS
      WHERE SPECIFIC_SCHEMA = @schema AND SPECIFIC_NAME = @name
      ORDER BY ORDINAL_POSITION
    `, { schema, name: procName })
    return (result.rows ?? []).map((r: any) => ({
      name: String(r.name ?? '').replace(/^@/, ''),
      type: r.type,
      isOutput: !!r.is_output,
      hasDefault: !!r.has_default,
    }))
  }
  if (config.type !== 'postgres') {
    return (await describeProcedure(config, schema, procName)).map((r: any) => ({
      name: String(r.NAME ?? r.name ?? ''),
      type: r.TYPE ?? r.type,
      isOutput: !!Number(r.IS_OUTPUT ?? r.is_output ?? 0),
      hasDefault: !!Number(r.HAS_DEFAULT ?? r.has_default ?? 0),
    }))
  }
  const result = await executeQuery(config, `
    SELECT
      p.parameter_name as name,
      p.data_type as type,
      CASE WHEN p.parameter_mode IN ('INOUT','OUT') THEN true ELSE false END as is_output,
      false as has_default
    FROM information_schema.parameters p
    JOIN information_schema.routines r ON r.specific_schema = p.specific_schema AND r.specific_name = p.specific_name
    WHERE p.specific_schema = $1 AND (p.specific_name = $2 OR r.routine_name = $2)
    ORDER BY p.ordinal_position
  `, [schema, procName])
  return (result.rows ?? []).map((r: any) => ({
    name: r.name,
    type: r.type,
    isOutput: !!r.is_output,
    hasDefault: !!r.has_default,
  }))
}

export async function discoverColumns(config: DbConnectionConfig, schema: string, tableName: string): Promise<{ name: string; type: string; nullable: boolean }[]> {
  if (config.type === 'mongodb') {
    const described = await describeTable(config, schema, tableName)
    return described.map((r) => ({ name: r.column, type: r.type, nullable: r.nullable }))
  }
  if (config.type === 'mssql') {
    const result = await executeQuery(config, `
      SELECT COLUMN_NAME as name, DATA_TYPE as type, CASE WHEN IS_NULLABLE='YES' THEN 1 ELSE 0 END as nullable
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
      ORDER BY ORDINAL_POSITION
    `, { schema, table: tableName })
    return (result.rows ?? []).map((r: any) => ({ name: r.name, type: r.type, nullable: !!r.nullable }))
  }
  if (config.type !== 'postgres') {
    return (await describeTable(config, schema, tableName)).map((r) => ({ name: r.column, type: r.type, nullable: r.nullable }))
  }
  const result = await executeQuery(config, `
    SELECT column_name as name, data_type as type, CASE WHEN is_nullable='YES' THEN true ELSE false END as nullable
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `, [schema, tableName])
  return (result.rows ?? []).map((r: any) => ({ name: r.name, type: r.type, nullable: !!r.nullable }))
}

export async function discoverPrimaryKey(config: DbConnectionConfig, schema: string, tableName: string): Promise<string[]> {
  if (config.type === 'mongodb') return ['_id']
  if (config.type === 'mysql') {
    const result = await executeQuery(config, `
      SELECT COLUMN_NAME as col
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY ORDINAL_POSITION
    `, [schema, tableName])
    return (result.rows ?? []).map((r: any) => r.col)
  }
  if (config.type === 'oracle') {
    const result = await executeQuery(config, `
      SELECT cols.COLUMN_NAME as col
      FROM ALL_CONSTRAINTS cons
      JOIN ALL_CONS_COLUMNS cols ON cons.OWNER = cols.OWNER AND cons.CONSTRAINT_NAME = cols.CONSTRAINT_NAME
      WHERE cons.CONSTRAINT_TYPE = 'P' AND cons.OWNER = :1 AND cons.TABLE_NAME = :2
      ORDER BY cols.POSITION
    `, [schema.toUpperCase(), tableName.toUpperCase()])
    return (result.rows ?? []).map((r: any) => r.COL ?? r.col)
  }
  if (config.type === 'snowflake') {
    const result = await executeQuery(config, `
      SELECT kcu.COLUMN_NAME as col
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
       AND tc.TABLE_NAME = kcu.TABLE_NAME
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        AND tc.TABLE_SCHEMA = ?
        AND tc.TABLE_NAME = ?
      ORDER BY kcu.ORDINAL_POSITION
    `, [schema, tableName])
    return (result.rows ?? []).map((r: any) => r.COL ?? r.col)
  }
  if (config.type === 'mssql') {
    const result = await executeQuery(config, `
      SELECT KCU.COLUMN_NAME as col
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS TC
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE KCU
        ON TC.CONSTRAINT_NAME = KCU.CONSTRAINT_NAME AND TC.TABLE_SCHEMA = KCU.TABLE_SCHEMA
      WHERE TC.TABLE_SCHEMA = @schema AND TC.TABLE_NAME = @table
        AND TC.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ORDER BY KCU.ORDINAL_POSITION
    `, { schema, table: tableName })
    return (result.rows ?? []).map((r: any) => r.col)
  }
  const result = await executeQuery(config, `
    SELECT kcu.column_name as col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = $1 AND tc.table_name = $2
      AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY kcu.ordinal_position
  `, [schema, tableName])
  return (result.rows ?? []).map((r: any) => r.col)
}

export async function discoverIdentityColumn(config: DbConnectionConfig, schema: string, tableName: string): Promise<string | null> {
  if (config.type === 'mongodb') return '_id'
  if (config.type === 'mysql') {
    const result = await executeQuery(config, `
      SELECT COLUMN_NAME as col
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND EXTRA LIKE '%auto_increment%'
      LIMIT 1
    `, [schema, tableName])
    return (result.rows ?? [])[0]?.col ?? null
  }
  if (config.type === 'oracle') {
    const result = await executeQuery(config, `
      SELECT COLUMN_NAME as col
      FROM ALL_TAB_IDENTITY_COLS
      WHERE OWNER = :1 AND TABLE_NAME = :2
    `, [schema.toUpperCase(), tableName.toUpperCase()])
    return (result.rows ?? [])[0]?.COL ?? (result.rows ?? [])[0]?.col ?? null
  }
  if (config.type === 'snowflake') {
    const result = await executeQuery(config, `
      SELECT COLUMN_NAME as col
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND IDENTITY_START IS NOT NULL
      LIMIT 1
    `, [schema, tableName])
    return (result.rows ?? [])[0]?.COL ?? (result.rows ?? [])[0]?.col ?? null
  }
  if (config.type === 'mssql') {
    const result = await executeQuery(config, `
      SELECT COLUMN_NAME as col
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
        AND COLUMNPROPERTY(OBJECT_ID(QUOTENAME(@schema) + '.' + QUOTENAME(@table)), COLUMN_NAME, 'IsIdentity') = 1
    `, { schema, table: tableName })
    return (result.rows ?? [])[0]?.col ?? null
  }
  // PostgreSQL: check for serial/identity columns
  const result = await executeQuery(config, `
    SELECT column_name as col
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
      AND (column_default LIKE 'nextval%' OR is_identity = 'YES')
    LIMIT 1
  `, [schema, tableName])
  return (result.rows ?? [])[0]?.col ?? null
}
