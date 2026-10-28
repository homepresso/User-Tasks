/**
 * Cookie-bound database client (server components, actions, session routes).
 * Separate from ./index so modules that client components also import (e.g.
 * lib/last-seen) can use the service factory without pulling next/headers
 * into the browser bundle. Imported lazily for the same reason.
 */

/** Client for the current request's user (RLS applies). */
export async function getSessionDb() {
  const { createClient: createSessionClient } = await import('@/lib/supabase/server')
  return createSessionClient()
}

/** Cookie-bound client plus the request-deduped user (see lib/supabase/server). */
export async function getSessionDbWithUser() {
  const { createClientWithUser } = await import('@/lib/supabase/server')
  return createClientWithUser()
}
