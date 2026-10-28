import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "@/lib/database.types"
import { getPublicConfig } from "@/lib/config/public"
import { getRealtimeTokenAction } from "@/app/actions/auth"

/**
 * Browser Supabase client — Supabase Realtime only (lib/providers/realtime/
 * supabase, loaded lazily when REALTIME_PROVIDER=supabase). It has no auth
 * session of its own: session cookies are httpOnly and every sign-in happens
 * server side. Realtime authenticates with a short-lived access token from
 * the server (getRealtimeTokenAction: the Supabase session's token, or one
 * minted for a built-in session), refreshed before it expires; supabase-js
 * calls `accessToken` on connect and on every heartbeat. With `accessToken`
 * set, `client.auth` is disabled by design.
 */

let client: ReturnType<typeof createBrowserClient<Database>> | null = null
let clientConfig = ""

let token: { value: string; expiresAt: number } | null = null
let pending: Promise<string | null> | null = null

async function realtimeAccessToken(): Promise<string | null> {
  if (token && token.expiresAt - Date.now() > 60_000) return token.value
  pending ??= getRealtimeTokenAction()
    .then((result) => {
      token = result ? { value: result.token, expiresAt: result.expiresAt } : null
      return token?.value ?? null
    })
    .catch(() => token?.value ?? null)
    .finally(() => { pending = null })
  return pending
}

export function createClient() {
  // Runtime public config (injected by the root layout), not build-time env.
  // A prerendered page may swap in the server's values after load; the next
  // call then gets a client for them.
  const { supabaseUrl, supabaseAnonKey } = getPublicConfig()
  if (!supabaseUrl && typeof window === "undefined") {
    // Prerendering a client page at build time without Supabase config (a
    // Docker image built with no Supabase args). The SSR pass never queries;
    // the browser gets the runtime config before hydration.
    return createBrowserClient<Database>("http://localhost", "unconfigured", { accessToken: realtimeAccessToken })
  }
  const key = `${supabaseUrl}\n${supabaseAnonKey}`
  if (client && clientConfig === key) return client
  // @supabase/ssr caches its first browser client; opt out when replacing it.
  client = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey, { isSingleton: false, accessToken: realtimeAccessToken })
  clientConfig = key
  return client
}
