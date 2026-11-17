'use server'

import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { isServiceError } from '@/lib/services/context'
import {
  getTeamRequest, listTeamRequests, updateTeamRequest,
  type TeamRequestDetail, type TeamRequestFilters, type TeamRequestListItem, type TeamRequestUpdate,
} from '@/lib/services/team-requests'

/*
 * Settings → Requests. Every action re-checks instance-admin access in
 * lib/services/team-requests — the page being visible is not enough. Server
 * actions are POST-only and same-origin. The Settings link shows for the
 * same people as Settings → Infrastructure (canViewInfrastructureAction).
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

async function viewer() {
  const { user } = await getSessionDbWithUser()
  return user ? { id: user.id, email: user.email ?? null } : null
}

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    console.error('[team requests]', error)
    return { ok: false, error: 'Something went wrong' }
  }
}

export async function listTeamRequestsAction(filters: TeamRequestFilters): Promise<Result<{ items: TeamRequestListItem[]; nextCursor: string | null }>> {
  return run(async () => listTeamRequests(await viewer(), filters))
}

export async function getTeamRequestAction(id: string): Promise<Result<TeamRequestDetail>> {
  return run(async () => getTeamRequest(await viewer(), id))
}

export async function updateTeamRequestAction(id: string, change: TeamRequestUpdate): Promise<Result<TeamRequestDetail>> {
  // No revalidatePath: the page updates the row in place and keeps its page.
  return run(async () => updateTeamRequest(await viewer(), id, change))
}
