import { createHash, randomBytes } from 'node:crypto'
import { authDb, type AuthDb } from './db'

/**
 * SQL for the built-in auth store (app_auth). Every secret that reaches the
 * browser or an inbox (session cookie, confirmation / reset link token, SSO
 * state) is 256 bits of randomness; only its SHA-256 is stored, so a database
 * read can't be replayed as a session or a link.
 */

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export interface CredentialRow {
  user_id: string
  email: string
  password_hash: string | null
  email_confirmed_at: Date | null
  failed_attempts: number
  locked_until: Date | null
  metadata: Record<string, unknown>
}

const CREDENTIAL_COLUMNS = 'user_id, email, password_hash, email_confirmed_at, failed_attempts, locked_until, metadata'

export async function findCredentialByEmail(email: string, db: AuthDb = authDb()): Promise<CredentialRow | null> {
  const { rows } = await db.query<CredentialRow>(`SELECT ${CREDENTIAL_COLUMNS} FROM app_auth.credentials WHERE lower(email) = lower($1)`, [email.trim()])
  return rows[0] ?? null
}

export async function findCredentialById(userId: string, db: AuthDb = authDb()): Promise<CredentialRow | null> {
  const { rows } = await db.query<CredentialRow>(`SELECT ${CREDENTIAL_COLUMNS} FROM app_auth.credentials WHERE user_id = $1`, [userId])
  return rows[0] ?? null
}

export async function insertCredential(
  input: { userId: string; email: string; passwordHash: string | null; emailConfirmed: boolean; metadata?: Record<string, unknown> },
  db: AuthDb = authDb(),
): Promise<void> {
  await db.query(
    `INSERT INTO app_auth.credentials (user_id, email, password_hash, email_confirmed_at, password_changed_at, metadata)
     VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END, CASE WHEN $3::text IS NOT NULL THEN now() END, $5)`,
    [input.userId, input.email.trim(), input.passwordHash, input.emailConfirmed, input.metadata ?? {}],
  )
}

/** Record a failed password; locks the account once `threshold` failures accumulate. Returns the lock expiry, if locked. */
export async function recordFailedLogin(userId: string, threshold: number, lockoutMs: number, db: AuthDb = authDb()): Promise<Date | null> {
  const { rows } = await db.query<{ locked_until: Date | null }>(
    `UPDATE app_auth.credentials
        SET failed_attempts = failed_attempts + 1,
            locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + ($3::double precision * interval '1 millisecond') ELSE locked_until END,
            updated_at = now()
      WHERE user_id = $1
      RETURNING locked_until`,
    [userId, threshold, lockoutMs],
  )
  const until = rows[0]?.locked_until ?? null
  return until && until.getTime() > Date.now() ? until : null
}

export async function recordSuccessfulLogin(userId: string, db: AuthDb = authDb()): Promise<void> {
  await db.query(
    `UPDATE app_auth.credentials SET failed_attempts = 0, locked_until = NULL, last_sign_in_at = now(), updated_at = now() WHERE user_id = $1`,
    [userId],
  )
}

export async function setPasswordHash(userId: string, passwordHash: string, db: AuthDb = authDb()): Promise<void> {
  await db.query(
    `UPDATE app_auth.credentials
        SET password_hash = $2, password_changed_at = now(), failed_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE user_id = $1`,
    [userId, passwordHash],
  )
}

export async function confirmEmail(userId: string, db: AuthDb = authDb()): Promise<void> {
  await db.query(`UPDATE app_auth.credentials SET email_confirmed_at = COALESCE(email_confirmed_at, now()), updated_at = now() WHERE user_id = $1`, [userId])
}

export async function updateCredentialEmail(userId: string, email: string, db: AuthDb = authDb()): Promise<void> {
  await db.query(`UPDATE app_auth.credentials SET email = $2, email_confirmed_at = now(), updated_at = now() WHERE user_id = $1`, [userId, email.trim()])
}

// ── sessions ─────────────────────────────────────────────────────────────────

export interface SessionRow {
  id: string
  user_id: string
  email: string
  last_seen_at: Date
  idle_expires_at: Date
  expires_at: Date
}

export async function createSession(
  input: { userId: string; method: string; idleMs: number; maxMs: number; ip?: string | null; userAgent?: string | null },
  db: AuthDb = authDb(),
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const token = randomToken()
  const { rows } = await db.query<{ id: string; expires_at: Date }>(
    `INSERT INTO app_auth.sessions (user_id, token_hash, method, idle_expires_at, expires_at, ip, user_agent)
     VALUES ($1, $2, $3,
             now() + LEAST($4::double precision, $5::double precision) * interval '1 millisecond',
             now() + $5::double precision * interval '1 millisecond', $6, $7)
     RETURNING id, expires_at`,
    [input.userId, hashToken(token), input.method, input.idleMs, input.maxMs, input.ip?.slice(0, 100) ?? null, input.userAgent?.slice(0, 500) ?? null],
  )
  return { token, id: rows[0].id, expiresAt: rows[0].expires_at }
}

/** The live session for a cookie token (not revoked, not idle-expired, not past its absolute expiry). */
export async function findSession(token: string, db: AuthDb = authDb()): Promise<SessionRow | null> {
  if (!token || token.length > 200) return null
  const { rows } = await db.query<SessionRow>(
    `SELECT s.id, s.user_id, c.email, s.last_seen_at, s.idle_expires_at, s.expires_at
       FROM app_auth.sessions s
       JOIN app_auth.credentials c ON c.user_id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.idle_expires_at > now() AND s.expires_at > now()`,
    [hashToken(token)],
  )
  return rows[0] ?? null
}

/** Slide the idle expiry forward (never past the absolute expiry). */
export async function touchSession(sessionId: string, idleMs: number, db: AuthDb = authDb()): Promise<void> {
  await db.query(
    `UPDATE app_auth.sessions
        SET last_seen_at = now(), idle_expires_at = LEAST(expires_at, now() + $2::double precision * interval '1 millisecond')
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, idleMs],
  )
}

export async function revokeSession(token: string, db: AuthDb = authDb()): Promise<void> {
  await db.query(`UPDATE app_auth.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [hashToken(token)])
}

/** Revoke every session of a user (password change, sign out everywhere, account removal). */
export async function revokeUserSessions(userId: string, db: AuthDb = authDb()): Promise<number> {
  const { rowCount } = await db.query(`UPDATE app_auth.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId])
  return rowCount ?? 0
}

// ── one-time tokens ──────────────────────────────────────────────────────────

export type TokenKind = 'email_confirmation' | 'password_reset'

export async function issueToken(
  input: { userId: string; kind: TokenKind; ttlMs: number; data?: Record<string, unknown> },
  db: AuthDb = authDb(),
): Promise<string> {
  const token = randomToken()
  // A new link supersedes older unused ones of the same kind.
  await db.query(`UPDATE app_auth.tokens SET used_at = now() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL`, [input.userId, input.kind])
  await db.query(
    `INSERT INTO app_auth.tokens (token_hash, kind, user_id, data, expires_at)
     VALUES ($1, $2, $3, $4, now() + $5::double precision * interval '1 millisecond')`,
    [hashToken(token), input.kind, input.userId, input.data ?? {}, input.ttlMs],
  )
  return token
}

/** Use a token once: returns its user and data, or null when unknown, used, expired or of another kind. */
export async function consumeToken(token: string, kind: TokenKind, db: AuthDb = authDb()): Promise<{ userId: string; data: Record<string, unknown> } | null> {
  if (!token || token.length > 200) return null
  const { rows } = await db.query<{ user_id: string; data: Record<string, unknown> }>(
    `UPDATE app_auth.tokens SET used_at = now()
      WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id, data`,
    [hashToken(token), kind],
  )
  return rows[0] ? { userId: rows[0].user_id, data: rows[0].data ?? {} } : null
}

// ── linked identities ────────────────────────────────────────────────────────

export interface IdentityRow {
  user_id: string
  provider: string
  subject: string
  email: string | null
  last_sign_in_at: Date | null
}

export async function findIdentity(provider: string, subject: string, db: AuthDb = authDb()): Promise<IdentityRow | null> {
  const { rows } = await db.query<IdentityRow>(
    `SELECT user_id, provider, subject, email, last_sign_in_at FROM app_auth.identities WHERE provider = $1 AND subject = $2`,
    [provider, subject],
  )
  return rows[0] ?? null
}

export async function linkIdentity(
  input: { userId: string; provider: string; subject: string; email: string | null; claims?: Record<string, unknown> },
  db: AuthDb = authDb(),
): Promise<void> {
  await db.query(
    `INSERT INTO app_auth.identities (user_id, provider, subject, email, claims, last_sign_in_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (provider, subject) DO UPDATE SET email = EXCLUDED.email, claims = EXCLUDED.claims, last_sign_in_at = now()
     WHERE app_auth.identities.user_id = EXCLUDED.user_id`,
    [input.userId, input.provider, input.subject, input.email, input.claims ?? {}],
  )
}

export async function listIdentities(userId: string, db: AuthDb = authDb()): Promise<IdentityRow[]> {
  const { rows } = await db.query<IdentityRow>(
    `SELECT user_id, provider, subject, email, last_sign_in_at FROM app_auth.identities WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  )
  return rows
}

// ── SSO flow state & replay protection ──────────────────────────────────────

export async function saveFlowState(id: string, kind: string, data: Record<string, unknown>, ttlMs: number, db: AuthDb = authDb()): Promise<void> {
  await db.query(
    `INSERT INTO app_auth.flow_states (id, kind, data, expires_at) VALUES ($1, $2, $3, now() + $4::double precision * interval '1 millisecond')`,
    [hashToken(id), kind, data, ttlMs],
  )
}

/** Single use: the row is deleted as it is read. */
export async function takeFlowState(id: string, kind: string, db: AuthDb = authDb()): Promise<Record<string, unknown> | null> {
  if (!id || id.length > 300) return null
  const { rows } = await db.query<{ data: Record<string, unknown> }>(
    `DELETE FROM app_auth.flow_states WHERE id = $1 AND kind = $2 AND expires_at > now() RETURNING data`,
    [hashToken(id), kind],
  )
  return rows[0]?.data ?? null
}

/** Remember `key` until `expiresAt`; false when it was already seen (a replay). */
export async function rememberOnce(key: string, expiresAt: Date, db: AuthDb = authDb()): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO app_auth.replay_cache (key, expires_at) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
    [key, expiresAt],
  )
  return (rowCount ?? 0) === 1
}

export async function purgeExpired(db: AuthDb = authDb()): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT app_auth.purge_expired() AS n`)
  return Number(rows[0]?.n ?? 0)
}
