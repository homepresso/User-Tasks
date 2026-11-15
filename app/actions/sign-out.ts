'use server'

import { getAuthProvider, isAuthError } from '@/lib/providers/auth'
import type { AuthActionResult } from './auth'

/**
 * Sign out of UserTasks (only: an AD FS / SSO session at the identity
 * provider stays, by design). Its own module so pages that only need
 * sign-out (the account switcher on not-found / workspace states) don't
 * import the sign-in actions, which reach LDAP bind login and the directory
 * sources (__tests__/function-trace-guards).
 */
export async function signOutAction(options: { everywhere?: boolean } = {}): Promise<AuthActionResult> {
  try {
    await (await getAuthProvider()).signOut({ everywhere: options.everywhere === true })
    return { ok: true }
  } catch (error) {
    if (isAuthError(error)) return { ok: false, error: error.message, code: error.code }
    console.error('[auth]', error)
    return { ok: false, error: 'Sign-out failed.' }
  }
}
