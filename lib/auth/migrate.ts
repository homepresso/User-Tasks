import type { AuthDb } from '@/lib/providers/auth/builtin/db'
import { isBcryptHash } from '@/lib/providers/auth/builtin/passwords'

/**
 * Supabase Auth → built-in auth user migration (the admin CLI's
 * `switch auth`, phase 11, runs this).
 *
 * Copies every live auth.users account into app_auth.credentials with the
 * SAME id (public.users and every foreign key stay valid), email, bcrypt hash
 * (GoTrue's `$2a$10$…` hashes verify unchanged, so people keep their
 * passwords), confirmation time and user metadata; and auth.identities
 * (Google / Azure / SAML logins) into app_auth.identities, so SSO users link
 * by subject when the matching IdP is configured (`identityProviders` maps a
 * Supabase provider name to an AUTH_SSO_PROVIDERS key such as `oidc:google`;
 * unmapped ones are kept as `supabase:<provider>` for reference, and those
 * users link by verified email instead).
 *
 * Idempotent: re-running updates changed rows and reports the rest as
 * unchanged. Supabase sessions can't be carried over (different cookies and
 * signing), so everyone signs in again; any built-in sessions of migrated
 * users are revoked too. Supabase's own tables are only read — switching back
 * stays possible.
 *
 * `dryRun` runs the same statements in a transaction that is rolled back and
 * returns the report it would have produced.
 */

export interface MigrateUsersOptions {
  /** Connection that sees auth.* and app_auth.* (the same database). */
  db: AuthDb
  dryRun?: boolean
  /** Supabase identity provider → app_auth.identities provider key (e.g. { google: 'oidc:google', azure: 'oidc:entra' }). */
  identityProviders?: Record<string, string>
  /** Restrict to these user ids (tests, partial runs). */
  userIds?: string[]
}

export interface MigrationIssue {
  id: string
  email: string | null
  reason: 'no_email' | 'no_profile' | 'email_conflict' | 'no_password'
}

export interface UserMigrationReport {
  dryRun: boolean
  users: { total: number; created: number; updated: number; unchanged: number; skipped: number }
  /** Accounts copied without a usable bcrypt hash (SSO / magic-link only): they sign in with SSO or reset their password. */
  withoutPassword: number
  identities: { total: number; linked: number; unchanged: number }
  sessionsRevoked: number
  issues: MigrationIssue[]
}

interface AuthUserRow {
  id: string
  email: string | null
  encrypted_password: string | null
  /** As text: a JS Date would drop Postgres' microseconds (and re-runs would see a change). */
  email_confirmed_at: string | null
  raw_user_meta_data: Record<string, unknown> | null
  has_profile: boolean
}

interface IdentityRow {
  user_id: string
  provider: string
  subject: string
  email: string | null
  last_sign_in_at: Date | null
}

class DryRunRollback extends Error {
  constructor(readonly report: UserMigrationReport) {
    super('dry run')
  }
}

export async function migrateSupabaseUsers(options: MigrateUsersOptions): Promise<UserMigrationReport> {
  const { db } = options
  const { rows: schema } = await db.query<{ auth_users: string | null; app_auth: string | null }>(
    "SELECT to_regclass('auth.users')::text AS auth_users, to_regclass('app_auth.credentials')::text AS app_auth",
  )
  if (!schema[0]?.auth_users) throw new Error('auth.users not found: this database has no Supabase Auth data to migrate')
  if (!schema[0]?.app_auth) throw new Error('app_auth.credentials not found: apply migration 20261106100000_builtin_auth.sql first')

  const run = async (tx: AuthDb): Promise<UserMigrationReport> => {
    const report: UserMigrationReport = {
      dryRun: Boolean(options.dryRun),
      users: { total: 0, created: 0, updated: 0, unchanged: 0, skipped: 0 },
      withoutPassword: 0,
      identities: { total: 0, linked: 0, unchanged: 0 },
      sessionsRevoked: 0,
      issues: [],
    }
    const filter = options.userIds?.length ? 'AND u.id = ANY($1::uuid[])' : ''
    const params = options.userIds?.length ? [options.userIds] : []
    const { rows: users } = await tx.query<AuthUserRow>(
      `SELECT u.id, u.email, u.encrypted_password, u.email_confirmed_at::text AS email_confirmed_at, u.raw_user_meta_data,
              EXISTS (SELECT 1 FROM public.users p WHERE p.id = u.id) AS has_profile
         FROM auth.users u
        WHERE u.deleted_at IS NULL ${filter}
        ORDER BY u.created_at, u.id`,
      params,
    )
    const migrated: string[] = []
    for (const user of users) {
      report.users.total++
      const email = user.email?.trim().toLowerCase() || null
      if (!email) { report.users.skipped++; report.issues.push({ id: user.id, email: null, reason: 'no_email' }); continue }
      // The profile row is what the app (and the credentials FK) hangs off.
      if (!user.has_profile) { report.users.skipped++; report.issues.push({ id: user.id, email, reason: 'no_profile' }); continue }
      const { rows: clash } = await tx.query<{ user_id: string }>(
        'SELECT user_id FROM app_auth.credentials WHERE lower(email) = $1 AND user_id <> $2',
        [email, user.id],
      )
      if (clash.length) { report.users.skipped++; report.issues.push({ id: user.id, email, reason: 'email_conflict' }); continue }

      const hash = isBcryptHash(user.encrypted_password) ? user.encrypted_password : null
      if (!hash) { report.withoutPassword++; report.issues.push({ id: user.id, email, reason: 'no_password' }) }
      const { rows } = await tx.query<{ inserted: boolean; changed: boolean }>(
        `WITH prev AS (SELECT * FROM app_auth.credentials WHERE user_id = $1)
         INSERT INTO app_auth.credentials AS c (user_id, email, password_hash, email_confirmed_at, password_changed_at, metadata, migrated_from)
         VALUES ($1, $2, $3, $4::timestamptz, CASE WHEN $3::text IS NOT NULL THEN now() END, COALESCE($5::jsonb, '{}'::jsonb), 'supabase')
         ON CONFLICT (user_id) DO UPDATE
           SET email = EXCLUDED.email,
               password_hash = EXCLUDED.password_hash,
               email_confirmed_at = EXCLUDED.email_confirmed_at,
               metadata = EXCLUDED.metadata,
               migrated_from = 'supabase',
               updated_at = now()
           WHERE (c.email, c.password_hash, c.email_confirmed_at, c.metadata)
                 IS DISTINCT FROM (EXCLUDED.email, EXCLUDED.password_hash, EXCLUDED.email_confirmed_at, EXCLUDED.metadata)
         RETURNING (SELECT count(*) = 0 FROM prev) AS inserted, true AS changed`,
        [user.id, email, hash, user.email_confirmed_at, user.raw_user_meta_data ? JSON.stringify(user.raw_user_meta_data) : null],
      )
      if (rows.length === 0) report.users.unchanged++
      else if (rows[0].inserted) report.users.created++
      else report.users.updated++
      migrated.push(user.id)
    }

    if (migrated.length) {
      const { rows: identities } = await tx.query<IdentityRow>(
        `SELECT i.user_id, i.provider, i.provider_id AS subject, i.identity_data->>'email' AS email, i.last_sign_in_at
           FROM auth.identities i
          WHERE i.user_id = ANY($1::uuid[]) AND i.provider <> 'email'
          ORDER BY i.created_at`,
        [migrated],
      )
      for (const identity of identities) {
        report.identities.total++
        const provider = options.identityProviders?.[identity.provider] ?? `supabase:${identity.provider}`
        const { rowCount } = await tx.query(
          `INSERT INTO app_auth.identities (user_id, provider, subject, email, claims, last_sign_in_at)
           VALUES ($1, $2, $3, $4, jsonb_build_object('migrated_from', 'supabase', 'supabase_provider', $5::text), $6)
           ON CONFLICT (provider, subject) DO NOTHING`,
          [identity.user_id, provider, identity.subject, identity.email, identity.provider, identity.last_sign_in_at],
        )
        if ((rowCount ?? 0) > 0) report.identities.linked++
        else report.identities.unchanged++
      }
      const { rowCount } = await tx.query(
        'UPDATE app_auth.sessions SET revoked_at = now() WHERE user_id = ANY($1::uuid[]) AND revoked_at IS NULL',
        [migrated],
      )
      report.sessionsRevoked = rowCount ?? 0
    }
    if (options.dryRun) throw new DryRunRollback(report)
    return report
  }

  try {
    return await db.transaction(run)
  } catch (error) {
    if (error instanceof DryRunRollback) return error.report
    throw error
  }
}

/** One-line summary for CLI output. */
export function formatMigrationReport(report: UserMigrationReport): string {
  const u = report.users
  return [
    `${report.dryRun ? '[dry run] ' : ''}users: ${u.total} found, ${u.created} created, ${u.updated} updated, ${u.unchanged} unchanged, ${u.skipped} skipped`,
    `identities: ${report.identities.total} found, ${report.identities.linked} linked, ${report.identities.unchanged} already linked`,
    `without a password (SSO / magic link only): ${report.withoutPassword}`,
    `built-in sessions revoked: ${report.sessionsRevoked} (everyone signs in again)`,
    ...report.issues.filter((i) => i.reason !== 'no_password').map((i) => `  skipped ${i.id} <${i.email ?? 'no email'}>: ${i.reason}`),
  ].join('\n')
}
