'use client'

import { signOutAction } from '@/app/actions/auth'

/**
 * Browser side of sign-out. The session cookies are httpOnly, so the server
 * action clears them; this clears the dashboard's cached auth state and tells
 * other tabs (they go to /login, as Supabase's onAuthStateChange SIGNED_OUT
 * event used to make them).
 */

export const AUTH_CHANNEL = 'usertasks-auth'
export const DASHBOARD_AUTH_CACHE_KEY = 'dashboard_auth_cache'

export function broadcastSignedOut(): void {
  try {
    const channel = new BroadcastChannel(AUTH_CHANNEL)
    channel.postMessage({ type: 'signed-out' })
    channel.close()
  } catch {
    // BroadcastChannel unavailable (old browsers): other tabs notice on their next session check.
  }
}

export async function signOutAndRedirect(to = '/login'): Promise<void> {
  await signOutAction().catch(() => null)
  try { sessionStorage.removeItem(DASHBOARD_AUTH_CACHE_KEY) } catch {}
  broadcastSignedOut()
  window.location.assign(to)
}
