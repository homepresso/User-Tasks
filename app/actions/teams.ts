'use server'

import { revalidatePath } from 'next/cache'
import { fromSession } from '@/lib/services/context'
import * as teams from '@/lib/services/teams'

/* Team server actions: thin wrappers over lib/services/teams (shared with /api/v1/teams and MCP). */

export async function createTeam(formData: FormData) {
  await teams.createTeam(await fromSession(), {
    name: String(formData.get('name') ?? ''),
    description: (formData.get('description') as string) || null,
    parent_id: (formData.get('parent_id') as string) || null,
  })
  revalidatePath('/team')
}

export async function updateTeam(formData: FormData) {
  await teams.updateTeam(await fromSession(), String(formData.get('id') ?? ''), {
    name: String(formData.get('name') ?? ''),
    description: (formData.get('description') as string) || null,
  })
  revalidatePath('/team')
}

export async function deleteTeam(teamId: string) {
  await teams.deleteTeam(await fromSession(), teamId)
  revalidatePath('/team')
}

export async function addTeamMember(teamId: string, userId: string, role: string = 'member') {
  await teams.addTeamMember(await fromSession(), teamId, userId, role)
  revalidatePath('/team')
}

export async function removeTeamMember(teamId: string, userId: string) {
  await teams.removeTeamMember(await fromSession(), teamId, userId)
  revalidatePath('/team')
}
