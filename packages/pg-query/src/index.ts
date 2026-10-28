/**
 * @usertasks/pg-query — PostgREST, in-process.
 *
 * supabase-js / postgrest-js clients keep their whole API; their REST
 * requests are answered by this package over a `pg` Pool instead of by a
 * PostgREST server (see ./fetch). Statements are ported from PostgREST v14
 * (Plan.hs, QueryBuilder.hs, SqlFragment.hs), run in one transaction per
 * request with PostgREST's transaction variables (role, request.jwt.claims,
 * search_path, role settings), and answered with PostgREST's status codes,
 * headers and error bodies. A conformance suite (test/conformance) compares
 * it with a real PostgREST.
 *
 * Supported: select trees (aliases, `!hint`, `!inner`/`!left`, nested and
 * to-one spread embeds, `rel(count)`, JSON paths `->`/`->>`, casts);
 * relationships M2O / O2M / O2O / M2M from FK metadata incl. PostgREST's
 * self-relationship and ambiguity rules (PGRST200/201); filters eq neq gt gte
 * lt lte like ilike match imatch (with any/all), in, is, isdistinct, cs cd ov
 * sl sr nxl nxr adj, fts plfts phfts wfts, not., or/and trees (nested, quoted
 * values, embedded paths), null-embed filters; order (nulls first/last,
 * embedded, by to-one embed column); limit/offset per level, db-max-rows;
 * count=exact (planned/estimated are counted exactly) with Content-Range and
 * 200/206/416; Accept application/json and vnd.pgrst.object+json (single);
 * insert (object/array, columns, missing=default), upsert (merge/ignore,
 * on_conflict, 200 vs 201), update, delete, returning representations with
 * embeds, max-affected with handling=strict, pg-safeupdate's WHERE rule;
 * rpc by POST (named JSON args, single unnamed json param) and GET/HEAD
 * (query args) returning scalar, SETOF scalar, composite, SETOF/TABLE or
 * void, with filters/order/limit/count on set results and overload
 * resolution (PGRST202/203); JWT verification (./jwt).
 *
 * Not supported — answered with an error: PUT, csv / geojson / explain
 * media types, aggregates (disabled, as on Supabase: PGRST123), to-many
 * spreads, functions with several unnamed parameters. Ignored: Prefer
 * tx=rollback / timezone and Range request headers (this codebase uses
 * neither). Not implemented: computed relationships and relationships
 * through views (none in this schema) and the fuzzy "Perhaps you meant"
 * hints on unknown names (hint is null).
 */
import { PostgrestClient } from '@supabase/postgrest-js'
import type { Pool } from 'pg'
import { PgExecutor } from './executor'
import { createPgFetch } from './fetch'
import { RequestHandler, type Identity } from './handler'
import { introspect, SchemaStore } from './schema'

export { createPgFetch, type PgFetchOptions } from './fetch'
export { RequestHandler, type Identity, type PgQueryRequest, type PgQueryResponse } from './handler'
export { PgExecutor, type PgExecutorOptions } from './executor'
export { introspect, SchemaStore, type SchemaCache } from './schema'
export { PgrstError, type ErrorBody } from './errors'
export { JwtVerifier, decodeJwtPayload, type JwtVerifierOptions, type Jwk } from './jwt'

export interface PgQueryOptions {
  pool: Pool
  /** Exposed schema (PostgREST db-schemas). Default `public`. */
  schema?: string
  /** db-extra-search-path. Default `public, extensions` (Supabase). */
  extraSearchPath?: string[]
  /** db-aggregates-enabled. Default false (Supabase). */
  aggregatesEnabled?: boolean
  /** db-max-rows: row cap per level of a read (Supabase API max_rows). Default none. */
  maxRows?: number | null
  /** Roles the executor may switch to. */
  allowedRoles?: string[]
  /** Role whose settings (timeouts) apply first, like PostgREST's login role. Default `authenticator`. */
  connectorRole?: string
  /** Re-introspect the schema in the background once the cache is older than this. Default 60 s. */
  schemaMaxAgeMs?: number
}

export interface PgQuery {
  handler: RequestHandler
  schemas: SchemaStore
  /** fetch for supabase-js / postgrest-js clients (see ./fetch). */
  fetch(identity: (headers: Headers) => Promise<Identity> | Identity, fallback?: typeof fetch): typeof fetch
  /** Bare postgrest-js client bound to a fixed identity. */
  client(identity: Identity): PostgrestClient
}

/** One engine per pool: shares the schema cache across every client. */
export function createPgQuery(opts: PgQueryOptions): PgQuery {
  const schema = opts.schema ?? 'public'
  const roles = [...(opts.allowedRoles ?? ['anon', 'authenticated', 'service_role']), opts.connectorRole ?? 'authenticator']
  const schemas = new SchemaStore(() => introspect(opts.pool, schema, roles), opts.schemaMaxAgeMs)
  const tx = new PgExecutor({ pool: opts.pool, allowedRoles: opts.allowedRoles, extraSearchPath: opts.extraSearchPath, connectorRole: opts.connectorRole })
  const handler = new RequestHandler({ schemas, tx, aggregatesEnabled: opts.aggregatesEnabled, maxRows: opts.maxRows })
  return {
    handler,
    schemas,
    fetch: (identity, fallback) => createPgFetch({ handler, identity, fallback }),
    client: (identity) => new PostgrestClient('http://pg-query.local/rest/v1', { fetch: createPgFetch({ handler, identity: () => identity }) }),
  }
}
