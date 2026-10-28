import { rateLimit } from '@/lib/rate-limit'
import { getServiceDb } from '@/lib/providers/db'
import { activeAuthProviderId } from '@/lib/providers/auth'
import { startBuiltinSession } from '@/lib/providers/auth/builtin'
import { findCredentialById, insertCredential } from '@/lib/providers/auth/builtin/store'
import type { AuthErrorCode, AuthRequestContext } from '@/lib/providers/auth/types'
import { writeAudit } from '@/lib/audit-log'
import { getDirectoryConnection, resolveCredentialRefs, type LdapStoredCredentials } from './connection'
import { createLdapClient, LdapError, verifyLdapPassword, type LdapConnectionFactory } from './ldap'
import { findLocalUserByEmail, grantDirectoryAccess, provisionDirectoryUser, resolveProvisionRoleId } from './sync'

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role rows are untyped */

/**
 * LDAP bind login (built-in auth, opt-in per workspace with the LDAP
 * connector's bind_login): on the login page, for the organisation entered,
 *
 *  1. find the user's directory entry with the service account (user filter
 *     AND one of the login attributes = the entered name, escaped; exactly
 *     one match, enabled);
 *  2. bind as that DN with the entered password on a separate connection
 *     (empty passwords never reach the server: an empty simple bind is an
 *     anonymous bind);
 *  3. sign in the linked local account — the directory link, else the
 *     account with the entry's email, else (auto_provision) a new one — with
 *     a built-in session, after granting membership in the workspace.
 *
 * Names the directory doesn't know fall through to the normal password
 * login (local accounts, e.g. a break-glass admin, keep working), as does
 * an unreachable directory. A directory user with a wrong password is
 * refused without trying the local password. Attempts are rate limited per
 * IP and per workspace + name.
 */

export type LdapLoginResult =
  | { status: 'not_applicable' }
  | { status: 'signed_in'; userId: string }
  | { status: 'failed'; code: AuthErrorCode; message: string }

const WINDOW_MS = 15 * 60_000

export async function tryLdapLogin(
  orgSlug: string,
  login: string,
  password: string,
  ctx: AuthRequestContext = {},
  deps: { connect?: LdapConnectionFactory } = {},
): Promise<LdapLoginResult> {
  const slug = orgSlug.trim().toLowerCase()
  const name = login.trim()
  if (!slug || !name || name.length > 256) return { status: 'not_applicable' }
  if ((await activeAuthProviderId()) !== 'builtin') return { status: 'not_applicable' }

  const db = getServiceDb()
  const { data: tenant } = await (db as any).from('tenants').select('id').eq('slug', slug).maybeSingle()
  if (!tenant?.id) return { status: 'not_applicable' }
  const tenantId = String(tenant.id)
  const connection = await getDirectoryConnection(db, tenantId, 'ldap', { includeCredentials: true })
  if (!connection?.isEnabled || connection.settings.bind_login !== true) return { status: 'not_applicable' }

  for (const [key, max] of [[`auth:ldap:ip:${ctx.ip ?? 'unknown'}`, 50], [`auth:ldap:name:${tenantId}:${name.toLowerCase()}`, 20]] as const) {
    const limited = await rateLimit(key, { max, windowMs: WINDOW_MS })
    if (!limited.ok) {
      return { status: 'failed', code: 'rate_limited', message: `Too many attempts. Try again in ${Math.max(1, Math.ceil(limited.retryAfterMs / 60_000))} minute(s).` }
    }
  }

  let entry: Awaited<ReturnType<ReturnType<typeof createLdapClient>['findLoginUser']>>
  try {
    const { bind_password } = await resolveCredentialRefs(tenantId, (connection.credentials ?? {}) as LdapStoredCredentials & Record<string, unknown>)
    const client = createLdapClient({ settings: connection.settings, bindPassword: bind_password, connect: deps.connect })
    try {
      entry = await client.findLoginUser(name)
    } finally {
      await client.close?.()
    }
  } catch (error) {
    console.warn('[ldap-login] directory lookup failed, falling back to password login:', (error as Error).message)
    return { status: 'not_applicable' }
  }
  if (!entry) return { status: 'not_applicable' }

  const invalid = { status: 'failed', code: 'invalid_credentials', message: 'Invalid login credentials' } as const
  if (!entry.active || !password) return invalid
  let ok: boolean
  try {
    ok = await verifyLdapPassword({ settings: connection.settings, dn: entry.dn, password, connect: deps.connect })
  } catch (error) {
    const message = error instanceof LdapError ? error.message : String(error)
    console.warn('[ldap-login] bind failed:', message)
    return { status: 'failed', code: 'provider_error', message: 'The directory could not verify your password. Try again later.' }
  }
  if (!ok) return invalid

  // The local account behind the directory entry.
  const { data: link } = await (db as any)
    .from('directory_links')
    .select('local_id')
    .eq('tenant_id', tenantId)
    .eq('provider', 'ldap')
    .eq('object_type', 'user')
    .eq('external_id', entry.externalId)
    .maybeSingle()
  let userId: string | null = link?.local_id ? String(link.local_id) : null
  const roleId = await resolveProvisionRoleId(db, tenantId)
  if (!userId && entry.email) {
    userId = (await findLocalUserByEmail(db, entry.email))?.id ?? null
    if (!userId && connection.autoProvision) {
      userId = await provisionDirectoryUser(db, tenantId, 'ldap', { email: entry.email, displayName: entry.displayName }, roleId)
    }
    if (userId) {
      await (db as any).from('directory_links').upsert({
        tenant_id: tenantId, provider: 'ldap', object_type: 'user', external_id: entry.externalId,
        local_id: userId, display_name: entry.displayName, last_seen_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,provider,object_type,external_id' })
    }
  }
  if (!userId) {
    return { status: 'failed', code: 'sso_failed', message: 'Your directory account has no UserTasks account in this organisation. Ask an administrator.' }
  }
  await grantDirectoryAccess(db, tenantId, userId, roleId)

  // Built-in sessions belong to a credentials row (no password: directory sign-in).
  if (!(await findCredentialById(userId))) {
    const { data: profile } = await (db as any).from('users').select('email').eq('id', userId).maybeSingle()
    const email = String(profile?.email ?? entry.email ?? '')
    if (!email) return { status: 'failed', code: 'sso_failed', message: 'Your account has no email address.' }
    await insertCredential({ userId, email, passwordHash: null, emailConfirmed: true, metadata: { directory: 'ldap' } }).catch((error) => {
      if ((error as { code?: string }).code !== '23505') throw error
    })
  }
  await startBuiltinSession(userId, 'ldap', ctx)
  await writeAudit({
    supabase: db, tenantId, actorId: userId,
    objectType: 'directory_sync', objectId: connection.id,
    action: 'login', summary: `LDAP sign-in by ${entry.email ?? name}`,
    metadata: { provider: 'ldap', ip: ctx.ip ?? null },
  })
  return { status: 'signed_in', userId }
}
