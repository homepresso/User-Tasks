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
 *  4. else refused.
 *
 * The allowed-domain check applies to every path. Group → role mapping is
 * re-applied on each sign-in when roleMapping is set.
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

  if (!userId) {
    if (!idp.jit) throw new AuthError('sso_failed', 'No account exists for you here. Ask an administrator to invite you.')
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

  if (idp.defaultOrg) {
    const mapped = mapGroupsToRole(identity.groups, idp.roleMapping)
    if (created) {
      await grantTenantRole(userId, idp.defaultOrg, mapped ?? idp.defaultRole, { setHome: true })
    } else if (mapped) {
      await grantTenantRole(userId, idp.defaultOrg, mapped, { replace: true })
    }
  }

  return { user: { id: userId, ...(email ? { email } : {}), user_metadata: identity.name ? { full_name: identity.name } : {} }, created }
}

/** Keep a small, non-sensitive subset of the claims for audit / debugging. */
function pickClaims(claims: Record<string, unknown>): Record<string, unknown> {
  const keep = ['iss', 'sub', 'email', 'name', 'preferred_username', 'tid', 'hd', 'oid', 'nameID', 'nameIDFormat', 'sessionIndex']
  return Object.fromEntries(keep.filter((k) => claims[k] !== undefined).map((k) => [k, claims[k]]))
}
