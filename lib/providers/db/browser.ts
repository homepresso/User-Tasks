import { createClient } from '@/lib/supabase/client'

/**
 * Browser database client (client components). The Supabase URL and anon key
 * come from the runtime public config (lib/config/public.ts), not from values
 * baked in at build time. Phases 2 and 4 move browser data access server-side
 * and retire this. Since phase 2 it is read-only (plus realtime and auth):
 * writes, RPCs and storage go through server actions, and only the files in
 * ./browser-allowlist.json may import it (__tests__/provider-seams.test.ts).
 */
export function getBrowserDb() {
  return createClient()
}
