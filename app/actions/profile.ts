'use server'

import { getTypedServiceDb, type ServiceDb } from '@/lib/providers/db'
import type { Database } from '@/lib/database.types'
import { getCachedUser } from '@/lib/supabase/server'

/**
 * Update the signed-in user's own profile row.
 *
 * The `users` table has no self-UPDATE RLS policy — writes go through the
 * service role (same as `touchUserLastSeen`). A direct client-side update from
 * the browser is silently rejected by RLS, which is why the old profile form
 * appeared to save but never changed anything. This action authenticates the
 * caller server-side and updates ONLY their own row.
 */

let serviceClient: ServiceDb<Database> | null = null
function getServiceClient() {
  if (!serviceClient) {
    serviceClient = getTypedServiceDb({ anonFallback: true })
  }
  return serviceClient
}

export interface UpdateProfileInput {
  display_name: string
  timezone: string
  description: string | null
  skills: string[]
}

export async function updateUserProfile(input: UpdateProfileInput): Promise<{ error: string | null }> {
  const user = await getCachedUser()
  if (!user) return { error: 'Not signed in.' }

  const displayName = (input.display_name ?? '').trim()
  if (!displayName) return { error: 'Display name is required.' }

  const skills = Array.isArray(input.skills)
    ? input.skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 100)
    : []

  const supabase = getServiceClient()
  const { error } = await supabase
    .from('users')
    .update({
      display_name: displayName,
      timezone: input.timezone || null,
      description: input.description?.trim() || null,
      skills,
    })
    .eq('id', user.id) // only ever the caller's own row

  if (error) {
    console.error('updateUserProfile failed', error)
    return { error: 'Could not save your profile. Please try again.' }
  }
  return { error: null }
}

const PRIORITIES = ['critical', 'high', 'medium', 'low', 'none'] as const
const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

export interface UpdatePreferencesInput {
  default_priority: string
  queue_bypass_priority: string
  available_hours_week: number
  hours_per_day: Record<string, number>
}

/**
 * Save the signed-in user's task preferences (settings → preferences),
 * merged into users.preferences. Runs as the user: RLS (users_update) allows
 * only their own row, as for the browser update it replaces.
 */
export async function updateUserPreferences(input: UpdatePreferencesInput): Promise<{ error: string | null }> {
  const { getSessionDbWithUser } = await import('@/lib/providers/db/session')
  const { supabase, user } = await getSessionDbWithUser()
  if (!user) return { error: 'Not signed in.' }

  const hours = (value: unknown, max: number) => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : null
  }
  if (!PRIORITIES.includes(input?.default_priority as never) || !PRIORITIES.includes(input?.queue_bypass_priority as never)) {
    return { error: 'Choose a priority from the list.' }
  }
  const weekly = hours(input.available_hours_week, 168)
  if (weekly === null) return { error: 'Weekly hours must be a number.' }
  const perDay: Record<string, number> = {}
  for (const day of WEEK_DAYS) perDay[day] = hours(input.hours_per_day?.[day], 24) ?? 0

  const { data: current, error: loadError } = await supabase.from('users').select('preferences').eq('id', user.id).single()
  if (loadError) return { error: 'Could not save your preferences. Please try again.' }
  const { error } = await supabase
    .from('users')
    .update({
      preferences: {
        ...((current?.preferences ?? {}) as Record<string, unknown>),
        default_priority: input.default_priority,
        queue_bypass_priority: input.queue_bypass_priority,
        available_hours_week: weekly,
        hours_per_day: perDay,
      },
    })
    .eq('id', user.id) // only ever the caller's own row
  if (error) {
    console.error('updateUserPreferences failed', error)
    return { error: 'Could not save your preferences. Please try again.' }
  }
  return { error: null }
}
