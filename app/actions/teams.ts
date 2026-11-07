'use server'

import { revalidatePath } from 'next/cache'
import { fromSession, requirePerm } from '@/lib/services/context'
import * as teams from '@/lib/services/teams'
import { findRecentDuplicate } from '@/lib/recent-duplicate'
import { runAction } from '@/lib/actions/run-action'

/* Team server actions: thin wrappers over lib/services/teams (shared with /api/v1/teams and MCP). */

export async function createTeam(formData: FormData) {
  const ctx = await fromSession()
  requirePerm(ctx, 'team.invite')
  // A repeated submit (double click, retry) must not add a second team with
  // the same name; teams have no creator column, so match on tenant + name.
  const recent = await findRecentDuplicate(ctx.supabase, 'teams', { tenant_id: ctx.tenantId, name: String(formData.get('name') ?? '').trim() })
  if (recent) {
    revalidatePath('/team')
    return
  }
  await teams.createTeam(ctx, {
    name: String(formData.get('name') ?? ''),
    description: (formData.get('description') as string) || null,
    parent_id: (formData.get('parent_id') as string) || null,
    lead_user_id: (formData.get('lead_user_id') as string) || null,
    org_unit_id: (formData.get('org_unit_id') as string) || null,
    colour: (formData.get('colour') as string) || null,
    kind: (formData.get('kind') as string) || null,
  })
  revalidatePath('/team')
  revalidatePath('/org')
}

export async function updateTeam(formData: FormData) {
  await teams.updateTeam(await fromSession(), String(formData.get('id') ?? ''), {
    name: String(formData.get('name') ?? ''),
    description: (formData.get('description') as string) || null,
  })
  revalidatePath('/team')
}

/** Edit a team's details (name, description, parent, lead, org unit, colour, kind); returns the service's message on failure. */
export async function updateTeamDetails(teamId: string, input: teams.TeamUpdateInput) {
  return runAction('teams.update', 'Could not update the team', async () => {
    await teams.updateTeam(await fromSession(), teamId, input)
    revalidatePath('/team')
    revalidatePath('/org')
    return null
  })
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
