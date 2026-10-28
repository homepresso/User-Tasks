import { resolveProviderSecretRefs } from '@/lib/config'
import { appUrlOrLocalhost } from '@/lib/config/bootstrap'
import { formatMigrationReport, migrateSupabaseUsers } from '@/lib/auth/migrate'
import type { AuthDb } from '@/lib/providers/auth/builtin/db'
import { runDoctor } from '@/lib/admin/doctor'
import type { SqlClient } from '../ops/instance-db'
import { tableExists } from '../ops/instance-db'
import { readJsonl, restoreRows, snapshotTable, writeJsonl } from './backup'
import type { AreaSwitch, PreflightCheck, SwitchContext } from './types'

/**
 * auth: supabase ⇄ builtin / oidc / saml (and between the three built-in
 * modes, which share the app_auth store).
 *  - away from Supabase Auth: copy auth.users + identities into app_auth
 *    with the same ids and bcrypt hashes (lib/auth/migrate.ts) — people keep
 *    their passwords; built-in sessions of migrated users are revoked;
 *  - back to Supabase Auth: revoke every built-in session. Accounts created
 *    in app_auth after the first switch have no Supabase Auth account (the
 *    pre-flight lists how many).
 * Supabase Auth's own tables are never written, so switching back is always
 * possible. Sessions don't carry over: everyone signs in again.
 * app_auth.credentials / identities are snapshotted (bcrypt hashes — the
 * backup directory is private) and restored by rollback.
 */

const CREDENTIALS = 'app_auth.credentials'
const IDENTITIES = 'app_auth.identities'

/** AuthDb over the CLI's single connection (transactions as BEGIN/COMMIT on it). */
export function clientAuthDb(db: SqlClient): AuthDb {
  const self: AuthDb = {
    query: (text, values) => db.query(text, values) as never,
    async transaction(fn) {
      await db.query('BEGIN')
      try {
        const result = await fn(self)
        await db.query('COMMIT')
        return result
      } catch (error) {
        await db.query('ROLLBACK').catch(() => undefined)
        throw error
      }
    },
  } as AuthDb
  return self
}

function identityMap(ctx: SwitchContext): Record<string, string> {
  const raw = typeof ctx.options.flags.map === 'string' ? ctx.options.flags.map : ''
  return Object.fromEntries(raw.split(',').filter(Boolean).map((pair) => pair.split('=').map((s) => s.trim()) as [string, string]))
}

async function redirectNotes(ctx: SwitchContext): Promise<string[]> {
  const { parseSsoProviders } = await import('@/lib/providers/auth/sso/config')
  const config = await resolveProviderSecretRefs(ctx.targetConfig, 'auth').catch(() => ctx.targetConfig.providers.auth)
  const origin = appUrlOrLocalhost().replace(/\/+$/, '')
  let idps: ReturnType<typeof parseSsoProviders> = []
  try { idps = parseSsoProviders(config.options.sso_providers) } catch { return [] }
  if (!idps.length) return []
  return ['Register these at each identity provider:', ...idps.map((idp) => idp.type === 'oidc'
    ? `  ${idp.id} (OIDC) redirect URI: ${origin}/auth/sso/${idp.id}/callback`
    : `  ${idp.id} (SAML) ACS: ${origin}/auth/saml/${idp.id}/acs  entity id / metadata: ${idp.spEntityId ?? `${origin}/auth/saml/${idp.id}/metadata`}`)]
}

export const authSwitch: AreaSwitch = {
  area: 'auth',
  writesProviderSetting: true,
  supports: () => null,
  async preflight(ctx) {
    const checks: PreflightCheck[] = []
    if (!(await tableExists(ctx.db, CREDENTIALS))) {
      checks.push({ name: 'app_auth', severity: 'error', detail: 'app_auth.credentials missing: apply migration 20261106100000_builtin_auth (usertasks-admin db migrate)' })
      return checks
    }
    const supabaseAuth = await tableExists(ctx.db, 'auth.users') && (await ctx.db.query<{ ok: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') AS ok`)).rows[0]?.ok
    if (ctx.from === 'supabase' && !supabaseAuth) checks.push({ name: 'supabase auth', severity: 'error', detail: 'auth.users not found: this database has no Supabase Auth data to migrate' })
    if (ctx.to === 'supabase') {
      if (!supabaseAuth) checks.push({ name: 'supabase auth', severity: 'error', detail: 'This database has no Supabase Auth (auth.users): the supabase provider needs a Supabase project' })
      if (!ctx.config.bootstrap.supabase.url || !ctx.config.bootstrap.supabase.anonKey) checks.push({ name: 'supabase', severity: 'error', detail: 'SUPABASE_URL and SUPABASE_ANON_KEY are required by the supabase auth provider' })
      if (supabaseAuth) {
        const { rows } = await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${CREDENTIALS} c WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = c.user_id)`)
        const n = rows[0]?.n ?? 0
        checks.push(n
          ? { name: 'accounts', severity: 'warn', detail: `${n} built-in account(s) have no Supabase Auth account and won't be able to sign in` }
          : { name: 'accounts', severity: 'ok', detail: 'every built-in account exists in Supabase Auth' })
      }
    } else {
      const report = await runDoctor({ config: ctx.targetConfig, sql: ctx.db, areas: ['auth'] })
      for (const c of report.checks) checks.push({ name: c.name, severity: c.status === 'fail' ? 'error' : c.status === 'warn' ? 'warn' : 'ok', detail: c.detail })
    }
    return checks
  },
  async backup(ctx) {
    const files = [
      writeJsonl(ctx.backupDir, 'app_auth.credentials.jsonl', await snapshotTable(ctx.db, CREDENTIALS)),
      writeJsonl(ctx.backupDir, 'app_auth.identities.jsonl', await snapshotTable(ctx.db, IDENTITIES)),
    ]
    ctx.rollbackData.startedAt = new Date().toISOString()
    return files
  },
  steps(ctx) {
    const steps = []
    if (ctx.from === 'supabase') {
      steps.push({
        id: 'migrate-users',
        title: 'Copy Supabase Auth accounts into the built-in store',
        async plan() {
          const report = await migrateSupabaseUsers({ db: clientAuthDb(ctx.db), dryRun: true, identityProviders: identityMap(ctx) })
          return formatMigrationReport(report).split('\n')[0]
        },
        async run() {
          const report = await migrateSupabaseUsers({ db: clientAuthDb(ctx.db), identityProviders: identityMap(ctx) })
          return formatMigrationReport(report).replace(/\n/g, '; ')
        },
      })
    }
    if (ctx.to === 'supabase' || ctx.from === 'supabase') {
      steps.push({
        id: 'revoke-sessions',
        title: 'Sign everyone out of the built-in provider',
        async run() {
          const { rowCount } = await ctx.db.query('UPDATE app_auth.sessions SET revoked_at = now() WHERE revoked_at IS NULL')
          return `${rowCount ?? 0} built-in session(s) revoked`
        },
      })
    }
    steps.push({
      id: 'notes',
      title: 'Collect identity provider URLs',
      async run() {
        const notes = await redirectNotes(ctx)
        ctx.notes.push(...notes, 'Everyone signs in again (sessions do not carry over between auth providers).')
        return notes.length ? `${notes.length - 1} identity provider(s)` : 'no SSO identity providers configured'
      },
    })
    return steps
  },
  async rollback(ctx) {
    if (!ctx.backupDir) return ['no backup directory: the built-in store was left as it is']
    const credentials = readJsonl<Record<string, unknown>>(ctx.backupDir, 'app_auth.credentials.jsonl')
    const identities = readJsonl<Record<string, unknown>>(ctx.backupDir, 'app_auth.identities.jsonl')
    if (!credentials || !identities) return ['no app_auth snapshot: the built-in store was left as it is']
    const startedAt = (ctx.record.config_before?.rollback?.startedAt as string | undefined) ?? ctx.record.started_at
    const keep = credentials.map((row) => String(row.user_id))
    if (ctx.dryRun) {
      const { rows } = await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${CREDENTIALS} WHERE migrated_from = 'supabase' AND created_at >= $1 AND NOT (user_id::text = ANY($2::text[]))`, [startedAt, keep])
      return [`would remove ${rows[0]?.n ?? 0} account(s) the switch copied and restore ${credentials.length} earlier one(s)`]
    }
    await ctx.db.query('BEGIN')
    try {
      await ctx.db.query(
        `DELETE FROM ${IDENTITIES} WHERE created_at >= $1 AND claims->>'migrated_from' = 'supabase'`,
        [startedAt],
      )
      const { rowCount } = await ctx.db.query(
        `DELETE FROM ${CREDENTIALS} WHERE migrated_from = 'supabase' AND created_at >= $1 AND NOT (user_id::text = ANY($2::text[]))`,
        [startedAt, keep],
      )
      const restored = await restoreRows(ctx.db, CREDENTIALS, 'user_id', credentials)
      await ctx.db.query('UPDATE app_auth.sessions SET revoked_at = now() WHERE revoked_at IS NULL')
      await ctx.db.query('COMMIT')
      return [`removed ${rowCount ?? 0} copied account(s), restored ${restored} earlier one(s), revoked built-in sessions`]
    } catch (error) {
      await ctx.db.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  },
}
