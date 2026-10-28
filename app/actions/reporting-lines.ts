'use server'

import { revalidatePath } from 'next/cache'
import { fromSession, isServiceError } from '@/lib/services/context'
import { setManager } from '@/lib/services/manager-tasks'

/** Team page: set or clear a member's manager (team.change_roles; lib/services/manager-tasks.ts). */
export async function setMemberManager(userId: string, managerUserId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await setManager(await fromSession(), userId, managerUserId)
    revalidatePath('/team')
    revalidatePath('/tasks/team')
    return { ok: true }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    throw error
  }
}
