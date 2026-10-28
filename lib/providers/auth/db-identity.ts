import { SignJWT } from 'jose'
import { supabaseJwtSecret } from '@/lib/config/bootstrap'
import { ConfigError } from '@/lib/config/schema'
import type { DbIdentity, SessionUser } from './types'

/**
 * The database identity of a user signed in through the built-in session
 * store (builtin / oidc / saml providers). RLS reads it exactly as it reads a
 * Supabase session: auth.uid() = claims.sub, role authenticated.
 *
 *  - DB_PROVIDER=postgres: pg-query runs each query with these claims
 *    (SET LOCAL ROLE authenticated + request.jwt.claims).
 *  - DB_PROVIDER=supabase: PostgREST only trusts signed JWTs, so the session
 *    client sends a short-lived HS256 token signed with SUPABASE_JWT_SECRET
 *    (the project's legacy JWT secret, still accepted by PostgREST and
 *    Realtime). Without that secret built-in auth can't be used with the
 *    Supabase data API.
 */

export const DB_TOKEN_TTL_SECONDS = 600

export function dbIdentityFor(user: SessionUser, sessionId?: string): DbIdentity {
  return {
    role: 'authenticated',
    claims: {
      sub: user.id,
      role: 'authenticated',
      aud: 'authenticated',
      ...(user.email ? { email: user.email } : {}),
      ...(sessionId ? { session_id: sessionId } : {}),
      app_metadata: { provider: 'usertasks' },
    },
  }
}

/** HS256 access token PostgREST / Supabase Realtime accept for this identity. */
export async function mintSupabaseAccessToken(
  identity: DbIdentity,
  { ttlSeconds = DB_TOKEN_TTL_SECONDS, now = Date.now() }: { ttlSeconds?: number; now?: number } = {},
): Promise<{ token: string; expiresAt: number }> {
  const secret = supabaseJwtSecret()
  if (!secret) {
    throw new ConfigError('Built-in auth with the Supabase data API (DB_PROVIDER=supabase) or Supabase Realtime requires SUPABASE_JWT_SECRET')
  }
  const iat = Math.floor(now / 1000)
  const exp = iat + ttlSeconds
  const token = await new SignJWT({ ...identity.claims })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(identity.claims.sub)
    .setIssuer('usertasks')
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret))
  return { token, expiresAt: exp * 1000 }
}
