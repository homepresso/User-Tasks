import type { Pool, PoolClient } from 'pg'
import { PgrstError } from './errors'
import type { Identity, PgQueryRequest, TxClient, TxRunner } from './handler'
import type { SchemaCache } from './schema'

/**
 * Transaction runner over a `pg` Pool. Every request runs in its own
 * transaction that first sets, with set_config(..., true) (= SET LOCAL):
 * search_path, the impersonated role's settings, `role`, request.jwt.claims
 * (plus the legacy request.jwt.claim.* keys), request.method/path/headers —
 * the same transaction variables PostgREST sets, so RLS policies and
 * auth.uid() behave identically. Nothing outlives the transaction, which
 * keeps the pool safe behind PgBouncer in transaction mode (statements are
 * unnamed, so no server-side prepared statements either).
 */

export interface PgExecutorOptions {
  pool: Pool
  /** Roles the executor may switch to. */
  allowedRoles?: string[]
  /** db-extra-search-path (Supabase: public, extensions). */
  extraSearchPath?: string[]
  /**
   * Role whose settings apply to every transaction before the impersonated
   * role's (PostgREST's connector role; on Supabase `authenticator`, which
   * carries statement_timeout and lock_timeout). Default `authenticator`.
   */
  connectorRole?: string
  /**
   * Roles that must bypass RLS (default service_role, as on Supabase). Where
   * such a role exists without BYPASSRLS — managed PostgreSQL, whose admin
   * may not grant it — the transaction keeps the connection's own role
   * instead, which owns the schema and so bypasses RLS the same way; the JWT
   * claims (auth.role() = 'service_role') are set as usual.
   */
  bypassRlsRoles?: string[]
}

function quoteIdent(s: string) {
  return `"${s.replace(/"/g, '""')}"`
}

export class PgExecutor implements TxRunner {
  private readonly allowed: Set<string>
  private readonly extra: string[]
  private readonly bypass: Set<string>

  constructor(private readonly opts: PgExecutorOptions) {
    this.allowed = new Set(opts.allowedRoles ?? ['anon', 'authenticated', 'service_role'])
    this.extra = opts.extraSearchPath ?? ['public', 'extensions']
    this.bypass = new Set(opts.bypassRlsRoles ?? ['service_role'])
  }

  async run<T>(
    o: { readOnly: boolean; identity: Identity; request: PgQueryRequest; cache: SchemaCache },
    fn: (tx: TxClient) => Promise<{ value: T; rollback: boolean }>,
  ): Promise<T> {
    if (!this.allowed.has(o.identity.role)) {
      throw new PgrstError(401, { code: 'PGRST301', message: `role "${o.identity.role}" is not allowed`, details: null, hint: null })
    }
    let client: PoolClient
    try {
      client = await this.opts.pool.connect()
    } catch (err) {
      throw new PgrstError(503, {
        code: 'PGRST000',
        message: 'Database connection error. Retrying the connection.',
        details: err instanceof Error ? err.message : String(err),
        hint: null,
      })
    }
    let broken = false
    try {
      const settings = this.settings(o.identity, o.request, o.cache)
      await client.query(o.readOnly ? 'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY' : 'BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE')
      await client.query(
        'select ' + settings.map((_, i) => `set_config($${2 * i + 1}, $${2 * i + 2}, true)`).join(', '),
        settings.flat(),
      )
      const result = await fn(client)
      await client.query(result.rollback ? 'ROLLBACK' : 'COMMIT')
      return result.value
    } catch (err) {
      // Driver-level failures (no SQLSTATE) may leave the connection unusable.
      if (!(err instanceof PgrstError) && !(err as { code?: string })?.code) broken = true
      await client.query('ROLLBACK').catch(() => {
        broken = true
      })
      throw err
    } finally {
      client.release(broken ? true : undefined)
    }
  }

  private settings(identity: Identity, request: PgQueryRequest, cache: SchemaCache): Array<[string, string]> {
    const headers: Record<string, string> = {}
    request.headers.forEach((v, k) => {
      if (k !== 'cookie') headers[k] = v
    })
    const claims = identity.claims
    const asOwner = this.bypass.has(identity.role) && Boolean(cache.rolesWithoutBypassRls?.has(identity.role))
    const out: Array<[string, string]> = [
      ['search_path', [cache.schema, ...this.extra].map(quoteIdent).join(', ')],
      ...(cache.roleSettings.get(this.opts.connectorRole ?? 'authenticator') ?? []).filter(([k]) => k !== 'session_preload_libraries'),
      ...(cache.roleSettings.get(identity.role) ?? []),
      ...(asOwner ? [] : [['role', identity.role] as [string, string]]),
      ['request.jwt.claims', JSON.stringify(claims)],
      ['request.method', request.method.toUpperCase()],
      ['request.path', `/${request.path}`],
      ['request.headers', JSON.stringify(headers)],
      ['request.cookies', '{}'],
    ]
    // Legacy per-claim settings, still read by older auth.uid()/auth.role() definitions.
    for (const key of ['sub', 'role', 'email']) {
      const v = claims[key]
      if (typeof v === 'string') out.push([`request.jwt.claim.${key}`, v])
    }
    return out
  }
}
