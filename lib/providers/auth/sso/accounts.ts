import { randomUUID } from 'node:crypto'
import { getServiceDb } from '@/lib/providers/db'
import { authDb } from '../builtin/db'
import { findCredentialByEmail, findIdentity, insertCredential, linkIdentity, confirmEmail } from '../builtin/store'
import { grantTenantRole, onUserCreated } from '../provisioning'
import { AuthError, type SessionUser } from '../types'
import { emailDomainAllowed, mapGroupsToRole, type SsoIdpConfig } from './config'

/**
 * Turns a verified external identity (OIDC ID token / SAML assertion) into a
 * local account:
 *
 *  1. an identity already linked (provider + subject) → that account;
 *  2. else, with linkByEmail and a verified email, the account with that
 *     email (built-in credentials, or a profile created by directory sync /
 *     an earlier Supabase install) — and the identity is linked to it;
 *  3. else, with jit, a new account: personal workspace (onUserCreated), SSO-
 *     only credentials (no password), linked identity, plus defaultOrg
 *     membership with defaultRole or the mapped role;
 *  4. else, without jit, a new account all the same when a directory source
 *     lists the person as a pending entry for a verified address (they were
 *     brought in by the directory — e.g. a SharePoint group — and become a
 *     user at their first sign-in; lib/directory-sync/sources.ts);
 *  5. else refused.
 *
 * Every sign-in then claims the person's pending directory entries
 * (workspace membership, link, source groups) for the verified addresses.
 *
 * The allowed-domain check applies to every path. Group → role mapping is
 * re-applied on each sign-in when roleMapping is set; with
 * enforceRoleMapping, a sign-in whose groups map to nothing resets the role
 * to defaultRole.
 */

export interface ExternalIdentity {
  idp: SsoIdpConfig
  subject: string
  email: string | null
  emailVerified: boolean
  name: string | null
  groups: string[]
  claims: Record<string, unknown>
}

export function identityProviderKey(idp: SsoIdpConfig): string {
  return `${idp.type}:${idp.id}`
}

export async function resolveExternalAccount(identity: ExternalIdentity): Promise<{ user: SessionUser; created: boolean }> {
  const { idp } = identity
  const providerKey = identityProviderKey(idp)
  const email = identity.email?.trim().toLowerCase() || null
  const db = authDb()

  if (email && !emailDomainAllowed(email, idp.allowedDomains)) {
    throw new AuthError('sso_failed', 'Your email domain is not allowed to sign in here.')
  }

  let userId: string | null = null
  let created = false

  const linked = await findIdentity(providerKey, identity.subject, db)
  if (linked) {
    userId = linked.user_id
  } else if (email && idp.linkByEmail && identity.emailVerified) {
    const credential = await findCredentialByEmail(email, db)
    if (credential) {
      userId = credential.user_id
      // The IdP vouched for the address.
      await confirmEmail(userId, db)
    } else {
      // A profile without credentials (directory sync, or users from a
      // previous Supabase Auth install): give it SSO-only credentials.
      const { data } = await getServiceDb().from('users').select('id').eq('email', email).is('deleted_at', null).limit(1).maybeSingle()
      const profileId = (data as { id?: string } | null)?.id
      if (profileId) {
        await insertCredential({ userId: profileId, email, passwordHash: null, emailConfirmed: true }, db)
        userId = profileId
      }
    }
  }

  // Verified addresses for directory entries: the email, plus the UPN when the IdP's domains are owned.
  const directoryKeys = identity.emailVerified && email ? [...new Set([email, ...verifiedUpn(identity)])] : []

  if (!userId) {
    const pending = !idp.jit && directoryKeys.length > 0 && await directorySources().then((m) => m.hasPendingDirectoryEntry(getServiceDb() as never, directoryKeys)).catch(() => false)
    if (!idp.jit && !pending) throw new AuthError('sso_failed', 'No account exists for you here. Ask an administrator to invite you.')
    if (!email || !identity.emailVerified) {
      throw new AuthError('sso_failed', 'Your identity provider did not supply a verified email address.')
    }
    const id = randomUUID()
    await db.transaction(async (tx) => {
      await onUserCreated(tx, { id, email, displayName: identity.name, provider: idp.type === 'saml' ? 'saml' : idp.preset === 'google' ? 'google' : idp.preset.startsWith('entra') ? 'azure_ad' : 'email' })
      await insertCredential({ userId: id, email, passwordHash: null, emailConfirmed: true, metadata: { full_name: identity.name, sso: providerKey } }, tx)
    })
    userId = id
    created = true
  }

  await linkIdentity({ userId, provider: providerKey, subject: identity.subject, email, claims: pickClaims(identity.claims) }, db)

  // Pending directory entries first: when a directory source is why this person may sign in,
  // the workspace membership it grants is the source's (it ends when the source drops them).
  if (directoryKeys.length) {
    const claimed = await directorySources().then((m) => m.claimDirectoryEntries(getServiceDb() as never, { userId: userId as string, keys: directoryKeys })).catch((error) => {
      console.warn('[auth] claiming directory entries failed:', (error as Error)?.message ?? error)
      return null
    })
    // A new account brought in only by a directory source lands in that workspace, not its personal one.
    if (created && !idp.defaultOrg && claimed?.tenants.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service-role rows are untyped
      await (getServiceDb() as any).from('users').update({ tenant_id: claimed.tenants[0], current_tenant_id: claimed.tenants[0] }).eq('id', userId).then(() => undefined, () => undefined)
    }
  }

  if (idp.defaultOrg) {
    const mapped = mapGroupsToRole(identity.groups, idp.roleMapping)
    if (created) {
      await grantTenantRole(userId, idp.defaultOrg, mapped ?? idp.defaultRole, { setHome: true })
    } else {
      // Mapped role on every sign-in; with enforceRoleMapping, no mapped group
      // means back to defaultRole. A workspace owner is never replaced by a
      // claim rule (unless the mapping itself says owner).
      const target = mapped ?? (idp.roleMapping && idp.enforceRoleMapping ? idp.defaultRole : null)
      if (target && (target === 'owner' || !(await holdsOwnerRole(userId, idp.defaultOrg)))) {
        await grantTenantRole(userId, idp.defaultOrg, target, { replace: true })
      }
    }
  }

  return { user: { id: userId, ...(email ? { email } : {}), user_metadata: identity.name ? { full_name: identity.name } : {} }, created }
}

/** Directory sources (extension-contributed people and groups), loaded only when needed. */
const directorySources = () => import('@/lib/directory-sync/sources')

/** The `upn` claim as a directory key, when it is in one of the IdP's allowed (owned) domains. */
function verifiedUpn(identity: ExternalIdentity): string[] {
  const upn = typeof identity.claims.upn === 'string' ? identity.claims.upn.trim().toLowerCase() : ''
  if (!upn || !identity.idp.allowedDomains?.length || !emailDomainAllowed(upn, identity.idp.allowedDomains)) return []
  return [upn]
}

async function holdsOwnerRole(userId: string, orgSlug: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service-role rows are untyped
  const db = getServiceDb() as any
  const { data: tenant } = await db.from('tenants').select('id').eq('slug', orgSlug.toLowerCase()).maybeSingle()
  if (!tenant) return false
  const { data: rows } = await db.from('user_roles').select('role_id').eq('tenant_id', tenant.id).eq('user_id', userId)
  const roleIds = ((rows ?? []) as Array<{ role_id: string }>).map((r) => r.role_id)
  if (roleIds.length === 0) return false
  const { data: owners } = await db.from('roles').select('id').in('id', roleIds).eq('slug', 'owner').eq('is_system', true)
  return ((owners ?? []) as unknown[]).length > 0
}

/** Keep a small, non-sensitive subset of the claims for audit / debugging. */
function pickClaims(claims: Record<string, unknown>): Record<string, unknown> {
  const keep = ['iss', 'sub', 'email', 'name', 'preferred_username', 'upn', 'tid', 'hd', 'oid', 'nameID', 'nameIDFormat', 'sessionIndex']
  return Object.fromEntries(keep.filter((k) => claims[k] !== undefined).map((k) => [k, claims[k]]))
}
