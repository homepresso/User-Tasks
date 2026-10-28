'use client'

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { PERMISSION_PAYLOAD_VERSION } from '@/lib/permissions'
import { getMySession } from '@/app/actions/session'
import { signOutAction } from '@/app/actions/auth'
import { AUTH_CHANNEL, DASHBOARD_AUTH_CACHE_KEY } from '@/lib/auth-client'

/*
 * Session state comes from the server: the session cookies are httpOnly
 * (whatever the auth provider), so the browser asks GET /api/auth/session who
 * is signed in and getMySession() for the profile. A light heartbeat re-checks
 * the session while the tab is visible (and keeps a Supabase access token
 * fresh — the proxy refreshes it on every request); sign-out in another tab
 * arrives over a BroadcastChannel.
 */

interface DashboardAuthState {
  loading: boolean
  userId: string | null
  profile: any | null
  userRole: string | null
  permissions: string[]
  refreshProfile: () => Promise<void>
}

const DashboardAuthContext = createContext<DashboardAuthState>({
  loading: true,
  userId: null,
  profile: null,
  userRole: null,
  permissions: [],
  refreshProfile: async () => {},
})

const CACHE_KEY = DASHBOARD_AUTH_CACHE_KEY
// How long the cached auth state is considered fresh. Kept slightly
// under the default Supabase access token lifetime (1 hour) so we
// re-verify before the token expires. Previously this was set to 12h
// which caused silent auth failures — stale cache said "logged in"
// while server actions rejected the expired JWT.
const CACHE_TTL_MS = 50 * 60 * 1000 // 50 minutes
// Session re-check while the tab is visible (and on focus, throttled).
const HEARTBEAT_MS = 10 * 60 * 1000
const HEARTBEAT_MIN_GAP_MS = 60 * 1000

/** Who is signed in, per the httpOnly session cookies; null when nobody (401). */
async function fetchSessionUserId(): Promise<string | null | undefined> {
  try {
    const res = await fetch('/api/auth/session', { cache: 'no-store', credentials: 'same-origin' })
    if (res.status === 401) return null
    if (!res.ok) return undefined
    const body = (await res.json()) as { userId?: string }
    return body.userId ?? null
  } catch {
    // Network trouble is not a sign-out.
    return undefined
  }
}

// Module-level guard to prevent React StrictMode / dev double-mounts from
// double-firing the initial auth verification. useRef is per-instance and
// wouldn't dedupe two independent provider mounts within the same tab.
let authBootInProgress = false

function readCache() {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      userId: string
      profile: any
      userRole: string | null
      permissions: string[]
      cachedAt?: number
      permissionVersion?: number
    }
    if ((parsed.permissionVersion ?? 0) !== PERMISSION_PAYLOAD_VERSION) {
      return null
    }
    // Drop stale cache entries — forces a fresh verification on the next
    // page load after the TTL expires, at which point the user either gets
    // a refreshed session or is bounced to /login by the auth listener.
    if (parsed.cachedAt && Date.now() - parsed.cachedAt > CACHE_TTL_MS) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeCache(data: { userId: string; profile: any; userRole: string | null; permissions: string[] }) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, cachedAt: Date.now(), permissionVersion: PERMISSION_PAYLOAD_VERSION }))
  } catch {}
}

function clearCache() {
  try { sessionStorage.removeItem(CACHE_KEY) } catch {}
}

// Safe useLayoutEffect that falls back to useEffect on server
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export function DashboardAuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  // Start with loading=true to match SSR output
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<any>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [userId, setUserId] = useState<string | null>(null)

  // Guard against double-firing the init effect if React re-runs it (e.g.
  // StrictMode mount→unmount→mount). This is critical — without it, a
  // single page load can issue 2-3 getUser() calls in rapid succession.
  const bootedRef = useRef(false)

  // Synchronously hydrate from sessionStorage BEFORE browser paints
  // This runs after hydration but before the browser shows anything new
  useIsomorphicLayoutEffect(() => {
    const cached = readCache()
    if (cached) {
      setUserId(cached.userId)
      setProfile(cached.profile)
      setUserRole(cached.userRole)
      setPermissions(cached.permissions)
      setLoading(false)
    }
  }, [])

  const fetchProfile = useCallback(async (uid: string) => {
    // Profile, role and permissions come from one server action (the same
    // queries and database functions, run as the user server-side).
    const result = await getMySession().catch(() => null)

    if (!result?.ok || !result.data.profile) {
      await signOutAction().catch(() => null)
      clearCache()
      router.replace('/login?error=no_profile')
      return
    }

    const { profile: newProfile, role: newRole, permissions: newPerms } = result.data

    writeCache({ userId: uid, profile: newProfile, userRole: newRole, permissions: newPerms })
    setProfile(newProfile)
    setUserRole(newRole)
    setPermissions(newPerms)
  }, [router])

  const refreshProfile = useCallback(async () => {
    if (userId) await fetchProfile(userId)
  }, [userId, fetchProfile])

  // Auth verification — runs exactly ONCE per tab session.
  //
  //   1. If we have a non-expired cache, trust it — DO NOT make a network
  //      call. The heartbeat and the sign-out broadcast below still catch a
  //      session that ends.
  //   2. If there's no cache, ask the server once who is signed in and fetch
  //      the profile.
  //   3. Use a ref guard so StrictMode re-mounts don't re-trigger the call.
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true

    const cached = readCache()

    if (cached) {
      setLoading(false)
    } else if (!authBootInProgress) {
      // authBootInProgress is a module-level guard so multiple provider
      // instances (e.g. two dashboard layouts in a single render tree) don't
      // both check the session.
      authBootInProgress = true
      ;(async () => {
        try {
          const uid = await fetchSessionUserId()
          if (!uid) {
            router.replace('/login')
            return
          }
          setUserId(uid)
          await fetchProfile(uid)
          setLoading(false)
        } finally {
          authBootInProgress = false
        }
      })()
    }

    const signedOut = () => {
      clearCache()
      setProfile(null)
      setUserId(null)
      setPermissions([])
      setUserRole(null)
      setLoading(true)
      router.replace('/login')
    }

    // Sign-out in another tab (lib/auth-client).
    let channel: BroadcastChannel | null = null
    try {
      channel = new BroadcastChannel(AUTH_CHANNEL)
      channel.onmessage = (event) => { if (event.data?.type === 'signed-out') signedOut() }
    } catch {
      channel = null
    }

    // Heartbeat: a session that expired or was revoked sends the user to
    // /login; a live one refreshes the cache's timestamp (as Supabase's
    // TOKEN_REFRESHED event used to).
    let lastBeat = Date.now()
    const beat = async (force = false) => {
      if (!force && Date.now() - lastBeat < HEARTBEAT_MIN_GAP_MS) return
      lastBeat = Date.now()
      const uid = await fetchSessionUserId()
      if (uid === undefined) return
      const current = readCache()
      if (uid === null) {
        signedOut()
        return
      }
      if (current && current.userId === uid) writeCache(current)
      else if (current && current.userId !== uid) { clearCache(); window.location.reload() }
    }
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void beat(true) }, HEARTBEAT_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void beat() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      channel?.close()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [router, fetchProfile])

  // Memoize so consumers only re-render when auth state actually changes,
  // not on every provider render (a fresh object identity would re-render
  // every useDashboardAuth() consumer in the tree).
  const value = useMemo(
    () => ({ loading, userId, profile, userRole, permissions, refreshProfile }),
    [loading, userId, profile, userRole, permissions, refreshProfile],
  )

  return (
    <DashboardAuthContext value={value}>
      {children}
    </DashboardAuthContext>
  )
}

export function useDashboardAuth() {
  return useContext(DashboardAuthContext)
}
