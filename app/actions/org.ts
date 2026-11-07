'use server'

import { revalidatePath } from 'next/cache'
import { fromSession } from '@/lib/services/context'
import * as org from '@/lib/services/org'
import * as projects from '@/lib/services/projects'
import { runAction } from '@/lib/actions/run-action'
import type { ActionResult } from '@/lib/action-result'

/*
 * Organization page server actions: thin wrappers over lib/services/org and
 * lib/services/projects (shared with /api/v1/org, /api/v1/projects and MCP).
 * Each returns an ActionResult so the page can show the service's message.
 */

function done<T>(label: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  return runAction(label, 'Something went wrong', async () => {
    const result = await fn()
    revalidatePath('/org')
    return result
  })
}

/* ── People ── */

export async function updatePersonProfile(userId: string, patch: org.PersonProfilePatch) {
  return done('org.updatePerson', async () => { await org.updatePersonProfile(await fromSession(), userId, patch); return null })
}

export async function detachPersonProfile(userId: string) {
  return done('org.detachPerson', async () => org.detachPersonProfile(await fromSession(), userId))
}

/* ── Org units ── */

export async function createOrgUnit(input: org.OrgUnitInput) {
  return done('org.createUnit', async () => org.createOrgUnit(await fromSession(), input))
}

export async function updateOrgUnit(unitId: string, input: org.OrgUnitUpdateInput) {
  return done('org.updateUnit', async () => org.updateOrgUnit(await fromSession(), unitId, input))
}

export async function deleteOrgUnit(unitId: string) {
  return done('org.deleteUnit', async () => org.deleteOrgUnit(await fromSession(), unitId))
}

export async function detachOrgUnit(unitId: string) {
  return done('org.detachUnit', async () => { await org.detachOrgUnit(await fromSession(), unitId); return null })
}

export async function addOrgUnitMember(unitId: string, userId: string, options: { role?: string | null; is_primary?: boolean } = {}) {
  return done('org.addUnitMember', async () => org.addOrgUnitMember(await fromSession(), unitId, userId, options))
}

export async function removeOrgUnitMember(unitId: string, userId: string) {
  return done('org.removeUnitMember', async () => org.removeOrgUnitMember(await fromSession(), unitId, userId))
}

/* ── Projects ── */

export async function createProject(input: projects.ProjectInput) {
  return done('projects.create', async () => { const p = await projects.createProject(await fromSession(), input); return { id: p.id } })
}

export async function updateProject(projectId: string, input: projects.ProjectUpdateInput) {
  return done('projects.update', async () => { await projects.updateProject(await fromSession(), projectId, input); return null })
}

export async function archiveProject(projectId: string, archived: boolean) {
  return done('projects.archive', async () => { await projects.archiveProject(await fromSession(), projectId, archived); return null })
}

export async function deleteProject(projectId: string) {
  return done('projects.delete', async () => projects.deleteProject(await fromSession(), projectId))
}

export async function addProjectMember(projectId: string, userId: string, options: { role?: string | null; allocation_percent?: number | null } = {}) {
  return done('projects.addMember', async () => { await projects.addProjectMember(await fromSession(), projectId, userId, options); return null })
}

export async function removeProjectMember(projectId: string, userId: string) {
  return done('projects.removeMember', async () => { await projects.removeProjectMember(await fromSession(), projectId, userId); return null })
}

export async function attachProjectTeam(projectId: string, teamId: string) {
  return done('projects.attachTeam', async () => { await projects.attachProjectTeam(await fromSession(), projectId, teamId); return null })
}

export async function detachProjectTeam(projectId: string, teamId: string) {
  return done('projects.detachTeam', async () => { await projects.detachProjectTeam(await fromSession(), projectId, teamId); return null })
}
