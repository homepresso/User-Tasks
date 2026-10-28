import { Pool, type PoolConfig } from "pg"
import sql from "mssql"
import { decryptSensitiveFields } from "./secret-fields"
import { optionalPackageInstallHint } from "./optional-drivers"

export type DbType = "postgres" | "mssql" | "mysql" | "oracle" | "snowflake" | "mongodb"
export type AuthMethod = "sql" | "entra_password" | "entra_client_secret" | "entra_default"
export const SUPPORTED_DB_TYPES: DbType[] = ["postgres", "mssql", "mysql", "oracle", "snowflake", "mongodb"]

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
}

export interface QueryResult {
  rows: Record<string, any>[]
  fields: { name: string; dataTypeID?: number }[]
  rowCount: number
  duration: number
}

function asBoolean(value: unknown, defaultValue = false) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    if (value.toLowerCase() === "true" || value.toLowerCase() === "require" || value.toLowerCase() === "prefer") return true
    if (value.toLowerCase() === "false" || value.toLowerCase() === "disable") return false
  }
  return defaultValue
}

function parseUrlParts(raw: string | undefined) {
  if (!raw) return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function normalizeMongoConnectionString(config: DbConnectionConfig) {
  if (!config.connectionString) throw new Error("MongoDB connection string is required")
  const hasProtocol = /^mongodb(\+srv)?:\/\//i.test(config.connectionString)
  if (!hasProtocol) throw new Error("MongoDB connection string must start with mongodb:// or mongodb+srv://")

  const parsed = new URL(config.connectionString)
  if (!parsed.username && config.username) parsed.username = encodeURIComponent(config.username)
  if (!parsed.password && config.password) parsed.password = encodeURIComponent(config.password)
  return parsed.toString()
}

function buildOracleConnectString(config: DbConnectionConfig) {
  if (config.connectionType === "tns" && config.tnsString) return config.tnsString
  const service = config.service || config.database
  if (!service) throw new Error("Oracle service name or SID is required")
  if (config.connectionType === "sid") return `${config.host}:${config.port || 1521}:${service}`
  return `${config.host}:${config.port || 1521}/${service}`
}

// ─── PostgreSQL ───

const pgPoolCache = new Map<string, Pool>()

function getPgPool(config: DbConnectionConfig): Pool {
  const key = `pg:${config.host}:${config.port}/${config.database}/${config.username}`
  if (pgPoolCache.has(key)) return pgPoolCache.get(key)!

  const poolConfig: PoolConfig = {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  }

  const pool = new Pool(poolConfig)
  pgPoolCache.set(key, pool)
  return pool
}

async function pgTest(
  config: DbConnectionConfig
): Promise<{ success: boolean; message: string; serverVersion?: string }> {
  let pool: Pool | null = null
  try {
    pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      max: 1,
      connectionTimeoutMillis: 15000,
    })
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
    } else if (message.includes("SSL")) {
      message += ` — Try enabling or disabling SSL`
    }

    return { success: false, message }
  } finally {
    try { if (pool) await pool.end() } catch { /* ignore */ }
  }
}

async function pgQuery(
  config: DbConnectionConfig,
  query: string,
  params?: any[]
): Promise<QueryResult> {
  const pool = getPgPool(config)
  const start = Date.now()
  const result = await pool.query(query, params)
  return {
    rows: result.rows,
    fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rowCount: result.rowCount ?? 0,
    duration: Date.now() - start,
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
      trustServerCertificate: config.trustServerCertificate ?? true,
      connectTimeout: 15000,
      requestTimeout: 30000,
    },
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
    // Entra ID with username + password (user's Azure AD credentials)
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
    // Entra ID with DefaultAzureCredential (managed identity, CLI, env vars)
    try {
      const { DefaultAzureCredential } = await import("@azure/identity")
      const credential = new DefaultAzureCredential()
      const token = await credential.getToken("https://database.windows.net/.default")
      opts.authentication = {
        type: "azure-active-directory-access-token",
        options: {
          token: token.token,
        },
      }
    } catch (e: any) {
      throw new Error(`Entra default credential failed: ${e.message}. Ensure Azure CLI is logged in or managed identity is configured.`)
    }
  }

  return opts
}

async function mssqlTest(
  config: DbConnectionConfig
): Promise<{ success: boolean; message: string; serverVersion?: string }> {
  let pool: sql.ConnectionPool | null = null
  try {
    const mssqlConfig = await getMssqlConfig(config)
    pool = new sql.ConnectionPool(mssqlConfig)
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

const mssqlPoolCache = new Map<string, sql.ConnectionPool>()

async function getMssqlPool(config: DbConnectionConfig): Promise<sql.ConnectionPool> {
  const key = `mssql:${config.host}:${config.port}/${config.database}/${config.username}/${config.authMethod ?? "sql"}`
  if (mssqlPoolCache.has(key)) {
    const existing = mssqlPoolCache.get(key)!
    if (existing.connected) return existing
    mssqlPoolCache.delete(key)
  }

  const mssqlConfig = await getMssqlConfig(config)
  const pool = new sql.ConnectionPool(mssqlConfig)
  await pool.connect()
  mssqlPoolCache.set(key, pool)
  return pool
}

async function mssqlQuery(
  config: DbConnectionConfig,
  query: string,
): Promise<QueryResult> {
  const pool = await getMssqlPool(config)
  const start = Date.now()
  const result = await pool.request().query(query)
  return {
    rows: result.recordset,
    fields: result.recordset.columns
      ? Object.keys(result.recordset.columns).map((name) => ({ name }))
      : result.recordset.length > 0
        ? Object.keys(result.recordset[0]).map((name) => ({ name }))
        : [],
    rowCount: result.rowsAffected?.[0] ?? result.recordset.length,
    duration: Date.now() - start,
  }
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
  const pool = await getMssqlPool(config)
  const start = Date.now()
  const result = await pool.request()
    .input('schema', schema)
    .input('name', name)
    .query(
      `SELECT PARAMETER_NAME as name, DATA_TYPE as type, PARAMETER_MODE as mode,
              CHARACTER_MAXIMUM_LENGTH as max_length
       FROM INFORMATION_SCHEMA.PARAMETERS
       WHERE SPECIFIC_SCHEMA = @schema AND SPECIFIC_NAME = @name
       ORDER BY ORDINAL_POSITION`
    )
  return result.recordset ?? []
}

async function mssqlExecProcedure(config: DbConnectionConfig, procedureName: string, params: Record<string, any>) {
  const pool = await getMssqlPool(config)
  const start = Date.now()
  const request = pool.request()

  for (const [key, value] of Object.entries(params)) {
    request.input(key.replace('@', ''), value)
  }

  const result = await request.execute(procedureName)
  return {
    rows: result.recordset ?? [],
    fields: result.recordset?.length
      ? Object.keys(result.recordset[0]).map((n) => ({ name: n }))
      : [],
    rowCount: result.rowsAffected?.[0] ?? result.recordset?.length ?? 0,
    duration: Date.now() - start,
    returnValue: result.returnValue,
    output: result.output,
  }
}

async function mssqlDescribe(config: DbConnectionConfig, schema: string, table: string) {
  const pool = await getMssqlPool(config)
  const start = Date.now()
  const result = await pool.request()
    .input('schema', schema)
    .input('table', table)
    .query(
      `SELECT COLUMN_NAME as [column], DATA_TYPE as type,
              CASE WHEN IS_NULLABLE = 'YES' THEN 1 ELSE 0 END as nullable,
              COLUMN_DEFAULT as default_value
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
       ORDER BY ORDINAL_POSITION`
    )
  return result.recordset ?? []
}

// ─── MySQL ───

const mysqlPoolCache = new Map<string, any>()

async function getMysqlPool(config: DbConnectionConfig) {
  const key = `mysql:${config.host}:${config.port}/${config.database}/${config.username}`
  if (mysqlPoolCache.has(key)) return mysqlPoolCache.get(key)
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
    ssl: asBoolean(config.ssl, true) ? {} : undefined,
  })
  mysqlPoolCache.set(key, pool)
  return pool
}

async function mysqlTest(config: DbConnectionConfig): Promise<{ success: boolean; message: string; serverVersion?: string }> {
  let connection: any = null
  try {
    const mysql = await import("mysql2/promise")
    connection = await mysql.createConnection({
      host: config.host,
      port: config.port || 3306,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: asBoolean(config.ssl, true) ? {} : undefined,
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

async function mysqlQuery(config: DbConnectionConfig, query: string, params?: any): Promise<QueryResult> {
  const pool = await getMysqlPool(config)
  const start = Date.now()
  const [rows, fields] = await pool.query(query, Array.isArray(params) ? params : params ? [params] : [])
  const rowArray = Array.isArray(rows) ? rows : []
  return {
    rows: rowArray as Record<string, any>[],
    fields: Array.isArray(fields) ? fields.map((field: any) => ({ name: field.name, dataTypeID: field.columnType })) : [],
    rowCount: rowArray.length,
    duration: Date.now() - start,
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

const oraclePoolCache = new Map<string, any>()

async function getOraclePool(config: DbConnectionConfig) {
  const key = `oracle:${config.host}:${config.port}/${config.database}/${config.username}/${config.service ?? ""}`
  if (oraclePoolCache.has(key)) return oraclePoolCache.get(key)
  const oracledb: any = await loadOracle()
  const pool = await oracledb.createPool({
    user: config.username,
    password: config.password,
    connectString: buildOracleConnectString(config),
    poolMin: 1,
    poolMax: 4,
    poolIncrement: 1,
    poolTimeout: 30,
  })
  oraclePoolCache.set(key, pool)
  return pool
}

async function oracleTest(config: DbConnectionConfig): Promise<{ success: boolean; message: string; serverVersion?: string }> {
  let connection: any = null
  try {
    const oracledb: any = await loadOracle()
    connection = await oracledb.getConnection({
      user: config.username,
      password: config.password,
      connectString: buildOracleConnectString(config),
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

async function oracleQuery(config: DbConnectionConfig, query: string, params?: any): Promise<QueryResult> {
  const oracledb: any = await loadOracle()
  const pool = await getOraclePool(config)
  const connection = await pool.getConnection()
  const start = Date.now()
  try {
    const result = await connection.execute(query, params ?? [], { outFormat: oracledb.OUT_FORMAT_OBJECT, autoCommit: true })
    const meta = Array.isArray(result.metaData) ? result.metaData : []
    const rows = Array.isArray(result.rows) ? result.rows as Record<string, any>[] : []
    return {
      rows,
      fields: meta.map((field: any) => ({ name: field.name })),
      rowCount: result.rowsAffected ?? rows.length,
      duration: Date.now() - start,
    }
  } finally {
    try { await connection.close() } catch {}
  }
}

async function oracleExecProcedure(config: DbConnectionConfig, procedureName: string, params: Record<string, any>) {
  const oracledb: any = await loadOracle()
  const pool = await getOraclePool(config)
  const connection = await pool.getConnection()
  const start = Date.now()
  try {
    const bindNames = Object.keys(params)
    const bindClause = bindNames.map((name) => `:${name}`).join(", ")
    const plsql = `BEGIN ${procedureName}(${bindClause}); END;`
    await connection.execute(plsql, params, { autoCommit: true, outFormat: oracledb.OUT_FORMAT_OBJECT })
    return { rows: [], fields: [], rowCount: 0, duration: Date.now() - start, output: params }
  } finally {
    try { await connection.close() } catch {}
  }
}

// ─── Snowflake ───

async function openSnowflakeConnection(config: DbConnectionConfig) {
  const snowflake: any = await loadSnowflake()
  const connection = snowflake.createConnection({
    account: config.account || config.host,
    username: config.username,
    password: config.password,
    warehouse: config.warehouse,
    database: config.database,
    schema: config.schema,
    role: config.role || undefined,
  })

  await new Promise<void>((resolve, reject) => {
    connection.connect((err: Error | null) => err ? reject(err) : resolve())
  })

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

async function snowflakeQuery(config: DbConnectionConfig, query: string, params?: any): Promise<QueryResult> {
  const connection = await openSnowflakeConnection(config)
  const start = Date.now()
  try {
    const rows: any[] = await new Promise((resolve, reject) => {
      connection.execute({
        sqlText: query,
        binds: Array.isArray(params) ? params : undefined,
        complete: (err: Error | null, stmt: any, resultRows: any[]) => {
          if (err) return reject(err)
          const columns = stmt?.getColumns?.() ?? []
          resolve(Object.assign(resultRows ?? [], { __columns: columns }))
        },
      })
    })
    const columns = (rows as any).__columns ?? []
    return {
      rows: Array.isArray(rows) ? rows : [],
      fields: Array.isArray(columns) ? columns.map((column: any) => ({ name: column.getName?.() ?? column.name })) : [],
      rowCount: Array.isArray(rows) ? rows.length : 0,
      duration: Date.now() - start,
    }
  } finally {
    try { connection?.destroy?.(() => {}) } catch {}
  }
}

// ─── MongoDB ───

const mongoClientCache = new Map<string, any>()

async function getMongoClient(config: DbConnectionConfig) {
  const uri = normalizeMongoConnectionString(config)
  if (mongoClientCache.has(uri)) return mongoClientCache.get(uri)
  const { MongoClient } = await loadMongo()
  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    connectTimeoutMS: 15000,
    serverSelectionTimeoutMS: 15000,
  })
  await client.connect()
  mongoClientCache.set(uri, client)
  return client
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

export async function executeMongoOperation(config: DbConnectionConfig, spec: Record<string, any>) {
  const client = await getMongoClient(config)
  const db = client.db(config.database)
  const collectionName = String(spec.collection ?? "")
  const collection = collectionName ? db.collection(collectionName) : null

  const parseJson = (value: any, fallback: any) => {
    if (value == null || value === "") return fallback
    if (typeof value === "object") return value
    try { return JSON.parse(String(value)) } catch { return fallback }
  }

  switch (spec.operation) {
    case "find": {
      if (!collection) throw new Error("Collection is required")
      const filter = parseJson(spec.filter, {})
      const projection = parseJson(spec.projection, undefined)
      const sort = parseJson(spec.sort, undefined)
      const limit = Number(spec.limit ?? 100) || 100
      const skip = Number(spec.skip ?? 0) || 0
      const cursor = collection.find(filter, projection ? { projection } : undefined)
      if (sort) cursor.sort(sort)
      if (skip > 0) cursor.skip(skip)
      if (limit > 0) cursor.limit(limit)
      const documents = await cursor.toArray()
      return { documents, count: documents.length }
    }
    case "findOne": {
      if (!collection) throw new Error("Collection is required")
      return await collection.findOne(parseJson(spec.filter, {}))
    }
    case "insertOne":
      if (!collection) throw new Error("Collection is required")
      return await collection.insertOne(parseJson(spec.document, {}))
    case "insertMany":
      if (!collection) throw new Error("Collection is required")
      return await collection.insertMany(parseJson(spec.documents, []))
    case "updateOne":
      if (!collection) throw new Error("Collection is required")
      return await collection.updateOne(parseJson(spec.filter, {}), parseJson(spec.update, {}))
    case "updateMany":
      if (!collection) throw new Error("Collection is required")
      return await collection.updateMany(parseJson(spec.filter, {}), parseJson(spec.update, {}))
    case "deleteOne":
      if (!collection) throw new Error("Collection is required")
      return await collection.deleteOne(parseJson(spec.filter, {}))
    case "deleteMany":
      if (!collection) throw new Error("Collection is required")
      return await collection.deleteMany(parseJson(spec.filter, {}))
    case "aggregate":
      if (!collection) throw new Error("Collection is required")
      return { documents: await collection.aggregate(parseJson(spec.pipeline, [])).toArray() }
    case "listCollections": {
      const collections = await db.listCollections().toArray()
      return { collections, count: collections.length }
    }
    case "countDocuments":
      if (!collection) throw new Error("Collection is required")
      return { count: await collection.countDocuments(parseJson(spec.filter, {})) }
    default:
      throw new Error(`Unsupported MongoDB operation: ${spec.operation}`)
  }
}

// ─── Public API (dispatches by type) ───

export async function testConnection(
  config: DbConnectionConfig
): Promise<{ success: boolean; message: string; serverVersion?: string }> {
  switch (config.type) {
    case "mongodb":
      return mongoTest(config)
    case "snowflake":
      return snowflakeTest(config)
    case "oracle":
      return oracleTest(config)
    case "mysql":
      return mysqlTest(config)
    case "mssql":
      return mssqlTest(config)
    case "postgres":
    default:
      return pgTest(config)
  }
}

export async function executeQuery(
  config: DbConnectionConfig,
  query: string,
  params?: any
): Promise<QueryResult> {
  try {
    switch (config.type) {
      case "snowflake":
        return await snowflakeQuery(config, query, params)
      case "oracle":
        return await oracleQuery(config, query, params)
      case "mysql":
        return await mysqlQuery(config, query, params)
      case "mssql":
        return await mssqlQuery(config, query)
      case "postgres":
      default:
        return await pgQuery(config, query, params)
    }
  } catch (error: any) {
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
  params: Record<string, any> = {}
): Promise<QueryResult & { returnValue?: number; output?: any }> {
  try {
    switch (config.type) {
      case "mongodb":
        throw new Error("MongoDB does not support stored procedures in this connector")
      case "oracle":
        return await oracleExecProcedure(config, procedureName, params)
      case "mysql": {
        const placeholders = Object.keys(params).map(() => "?").join(", ")
        return await mysqlQuery(config, `CALL ${procedureName}(${placeholders})`, Object.values(params))
      }
      case "snowflake": {
        const placeholders = Object.keys(params).map(() => "?").join(", ")
        return await snowflakeQuery(config, `CALL ${procedureName}(${placeholders})`, Object.values(params))
      }
      case "mssql":
        return await mssqlExecProcedure(config, procedureName, params)
      case "postgres":
      default: {
        // PostgreSQL: call procedure or function via SQL
        // Validate procedure name to prevent SQL injection (allow schema.name format)
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(procedureName)) {
          throw new Error(`Invalid procedure name: ${procedureName}`)
        }
        const paramNames = Object.keys(params)
        const paramValues = Object.values(params)
        const placeholders = paramNames.map((_, i) => `$${i + 1}`).join(", ")
        const query = paramNames.length
          ? `SELECT * FROM ${procedureName}(${placeholders})`
          : `SELECT * FROM ${procedureName}()`
        return await pgQuery(config, query, paramValues)
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
  const dbType = db.db_type ?? headers.db_type ?? (parsedUrl?.protocol ? parsedUrl.protocol.replace(":", "") : "postgres")
  if (!isSupportedDbType(dbType)) return null

  const host = db.host ?? headers.host ?? headers.account ?? parsedUrl?.hostname ?? ""
  const database = db.database ?? headers.database ?? (parsedUrl?.pathname ? parsedUrl.pathname.replace(/^\/+/, "") : "")
  const port = Number(db.port ?? headers.port) || (dbType === "mssql" ? 1433 : dbType === "mysql" ? 3306 : dbType === "oracle" ? 1521 : 5432)

  if (dbType !== "mongodb" && dbType !== "snowflake" && !host) return null
  if (!database) return null

  return {
    type: dbType,
    host,
    port,
    database,
    username: db.username ?? authConfig.username ?? parsedUrl?.username ?? "",
    password: db.password ?? authConfig.password ?? parsedUrl?.password ?? "",
    ssl: asBoolean(db.ssl ?? headers.ssl, false),
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
  // PostgreSQL
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
      WHERE SPECIFIC_SCHEMA = '${schema.replace(/'/g, "''")}' AND SPECIFIC_NAME = '${procName.replace(/'/g, "''")}'
      ORDER BY ORDINAL_POSITION
    `)
    return (result.rows ?? []).map((r: any) => ({
      name: String(r.name ?? '').replace(/^@/, ''),
      type: r.type,
      isOutput: !!r.is_output,
      hasDefault: !!r.has_default,
    }))
  }
  // PostgreSQL
  const result = await executeQuery(config, `
    SELECT
      p.parameter_name as name,
      p.data_type as type,
      CASE WHEN p.parameter_mode IN ('INOUT','OUT') THEN true ELSE false END as is_output,
      false as has_default
    FROM information_schema.parameters p
    WHERE p.specific_schema = '${schema.replace(/'/g, "''")}' AND p.specific_name = '${procName.replace(/'/g, "''")}'
    ORDER BY p.ordinal_position
  `)
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
      WHERE TABLE_SCHEMA = '${schema.replace(/'/g, "''")}' AND TABLE_NAME = '${tableName.replace(/'/g, "''")}'
      ORDER BY ORDINAL_POSITION
    `)
    return (result.rows ?? []).map((r: any) => ({ name: r.name, type: r.type, nullable: !!r.nullable }))
  }
  const result = await executeQuery(config, `
    SELECT column_name as name, data_type as type, CASE WHEN is_nullable='YES' THEN true ELSE false END as nullable
    FROM information_schema.columns
    WHERE table_schema = '${schema.replace(/'/g, "''")}' AND table_name = '${tableName.replace(/'/g, "''")}'
    ORDER BY ordinal_position
  `)
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
      WHERE TC.TABLE_SCHEMA = '${schema.replace(/'/g, "''")}' AND TC.TABLE_NAME = '${tableName.replace(/'/g, "''")}'
        AND TC.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ORDER BY KCU.ORDINAL_POSITION
    `)
    return (result.rows ?? []).map((r: any) => r.col)
  }
  const result = await executeQuery(config, `
    SELECT kcu.column_name as col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = '${schema.replace(/'/g, "''")}' AND tc.table_name = '${tableName.replace(/'/g, "''")}'
      AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY kcu.ordinal_position
  `)
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
      WHERE TABLE_SCHEMA = '${schema.replace(/'/g, "''")}' AND TABLE_NAME = '${tableName.replace(/'/g, "''")}'
        AND COLUMNPROPERTY(OBJECT_ID('${schema}.${tableName}'), COLUMN_NAME, 'IsIdentity') = 1
    `)
    return (result.rows ?? [])[0]?.col ?? null
  }
  // PostgreSQL: check for serial/identity columns
  const result = await executeQuery(config, `
    SELECT column_name as col
    FROM information_schema.columns
    WHERE table_schema = '${schema.replace(/'/g, "''")}' AND table_name = '${tableName.replace(/'/g, "''")}'
      AND (column_default LIKE 'nextval%' OR is_identity = 'YES')
    LIMIT 1
  `)
  return (result.rows ?? [])[0]?.col ?? null
}
