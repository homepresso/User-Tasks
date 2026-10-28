/**
 * PostgREST-shaped errors. Bodies are `{ code, details, hint, message }`
 * exactly as PostgREST sends them, so postgrest-js turns them into the same
 * `error` objects callers already handle.
 */

export interface ErrorBody {
  code: string
  details: unknown
  hint: string | null
  message: string
}

export class PgrstError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.message)
    this.name = 'PgrstError'
  }
}

/** PGRST100: the request could not be parsed. */
export function parseError(message: string, details: string, hint: string | null = null): PgrstError {
  return new PgrstError(400, { code: 'PGRST100', message, details, hint })
}

export function unsupported(feature: string): PgrstError {
  return new PgrstError(400, {
    code: 'PGRST127',
    message: 'Feature not implemented',
    details: `pg-query does not support ${feature}`,
    hint: null,
  })
}

interface PgErrorLike {
  code?: string
  message?: string
  detail?: string
  hint?: string
}

/** HTTP status for a Postgres SQLSTATE, as PostgREST maps it. */
export function statusForSqlState(code: string, authenticated: boolean): number {
  if (code === '42501') return authenticated ? 403 : 401
  const exact: Record<string, number> = {
    '23503': 409,
    '23505': 409,
    '25006': 405,
    '42883': 404,
    '42P01': 404,
    '42P17': 500,
    P0001: 400,
  }
  if (code in exact) return exact[code]
  const prefix: Array<[string, number]> = [
    ['08', 503],
    ['09', 500],
    ['0L', 403],
    ['0P', 403],
    ['25', 500],
    ['28', 403],
    ['2D', 500],
    ['38', 500],
    ['39', 500],
    ['3B', 500],
    ['40', 500],
    ['53', 503],
    ['54', 500],
    ['55', 500],
    ['57', 500],
    ['58', 500],
    ['F0', 500],
    ['HV', 500],
    ['P0', 500],
    ['XX', 500],
  ]
  for (const [p, status] of prefix) if (code.startsWith(p)) return status
  return 400
}

export function fromPgError(err: unknown, authenticated: boolean): PgrstError {
  if (err instanceof PgrstError) return err
  const e = (err ?? {}) as PgErrorLike
  if (!e.code) {
    // Connection failures and other driver errors: PostgREST answers 503 when
    // it cannot reach the database.
    return new PgrstError(503, {
      code: 'PGRST000',
      message: e.message ?? String(err),
      details: null,
      hint: null,
    })
  }
  // RAISE ... USING ERRCODE 'PTxyz' sets the HTTP status (PostgREST convention).
  let status = statusForSqlState(e.code, authenticated)
  if (/^PT\d{3}$/.test(e.code)) status = Number(e.code.slice(2))
  return new PgrstError(status, {
    code: e.code,
    message: e.message ?? '',
    details: e.detail ?? null,
    hint: e.hint ?? null,
  })
}
