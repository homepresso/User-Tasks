import { randomUUID } from 'node:crypto'
import type { SqlClient } from './instance-db'

/**
 * The admin engine without a direct connection: on the Supabase database
 * provider with no DATABASE_URL (Vercel and the like), Settings → Infrastructure
 * and `usertasks-admin switch` reach the instance through the service-role
 * API instead. An ApiSqlClient is a SqlClient whose `api` carries the
 * service-role client; the switch log, instance settings and the switch
 * lease (migration 20261123000000) recognise it and use PostgREST / RPCs.
 *
 * Its `query` never runs SQL: anything that still needs a real connection
 * (copying the database, auth accounts or storage metadata; installing pg_cron
 * jobs; re-wrapping data keys) fails with NeedsDirectConnectionError, whose
 * message says what to add. The callers gate those changes up front, so this
 * is the backstop, never the normal path.
 */

/** The supabase-js surface used here (the service-role client). */
export interface ServiceApiClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase-js query builders, untyped tables
  from(relation: string): any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any
}

export interface ApiSqlClient extends SqlClient {
  readonly api: ServiceApiClient
  /** This client's identity for the switch lease. */
  readonly leaseHolder: string
  /** Nested lock calls on this client (the lease is released when it drops to 0). */
  lockDepth: number
}

/** Where to get the connection string for a Supabase project (the remedy text, no values). */
export const DATABASE_URL_HELP = 'Supabase → Project Settings → Database → Connection string, Session pooler'

/** Environment line to add (placeholders only). */
export const DATABASE_URL_SNIPPET = 'DATABASE_URL=postgresql://postgres.<project-ref>:<database-password>@aws-0-<region>.pooler.supabase.com:5432/postgres'

export const NEEDS_DIRECT_REMEDY = `add DATABASE_URL (${DATABASE_URL_HELP}) to the app environment and redeploy, or run usertasks-admin where DATABASE_URL is set`

export class NeedsDirectConnectionError extends Error {
  constructor(what: string) {
    super(`${what} needs a direct database connection: ${NEEDS_DIRECT_REMEDY}.`)
    this.name = 'NeedsDirectConnectionError'
  }
}

function describeSql(text: string): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ')
  return `This step (${words.length > 60 ? `${words.slice(0, 60)}…` : words})`
}

export function serviceSqlClient(api: ServiceApiClient): ApiSqlClient {
  return {
    api,
    leaseHolder: randomUUID(),
    lockDepth: 0,
    async query(text: string): Promise<never> {
      throw new NeedsDirectConnectionError(describeSql(text))
    },
  }
}

/** The service-role client behind `db`, or null for a direct connection. */
export function apiOf(db: SqlClient | null | undefined): ServiceApiClient | null {
  return (db as Partial<ApiSqlClient> | null | undefined)?.api ?? null
}

export function isApiClient(db: SqlClient | null | undefined): db is ApiSqlClient {
  return apiOf(db) !== null
}

/** PostgREST / RPC error codes for a missing table or function. */
const MISSING = new Set(['PGRST202', 'PGRST205', '42P01', '42883'])

export function isMissingObject(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && ((error.code && MISSING.has(error.code)) || /does not exist|could not find the (table|function)/i.test(error.message ?? '')))
}

/** Await a PostgREST call: its data, or throw its error (with the code kept). */
export async function apiData<T>(call: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null; count?: number | null }>): Promise<T> {
  const { data, error } = await call
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data as T
}

export async function apiCount(call: PromiseLike<{ error: { message: string; code?: string } | null; count?: number | null }>): Promise<number> {
  const { error, count } = await call
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return count ?? 0
}
