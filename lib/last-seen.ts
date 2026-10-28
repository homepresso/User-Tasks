import { getTypedServiceDb, type ServiceDb } from '@/lib/providers/db'
import type { Database } from '@/lib/database.types'

export { LAST_SEEN_STORAGE_PREFIX, LAST_SEEN_TOUCH_INTERVAL_MS } from './last-seen-constants'

let serviceClient: ServiceDb<Database> | null = null

function getServiceClient() {
  if (!serviceClient) {
    serviceClient = getTypedServiceDb({ anonFallback: true })
  }
  return serviceClient
}

export async function touchUserLastSeen(userId: string | null | undefined, seenAt = new Date()) {
  if (!userId) return

  const supabase = getServiceClient()
  await supabase
    .from('users')
    .update({ last_seen_at: seenAt.toISOString() })
    .eq('id', userId)
}

