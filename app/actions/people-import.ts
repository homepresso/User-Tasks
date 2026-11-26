'use server'

import type { ActionResult } from '@/lib/action-result'
import { fromSession, isServiceError } from '@/lib/services/context'
import * as peopleImport from '@/lib/services/people-import'

/*
 * Organization → Import people server actions: thin wrappers over
 * lib/services/people-import, which checks the permissions (team.invite /
 * settings.edit) and re-reads the directory on the server. They return
 * { ok, error } so the wizard can show the message.
 */

function failure(error: unknown): { ok: false; error: string } {
  if (isServiceError(error)) return { ok: false, error: error.message }
  console.error('[people-import action]', error)
  return { ok: false, error: 'Something went wrong. Try again.' }
}

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    return failure(error)
  }
}

export async function listPeopleImportSources(): Promise<ActionResult<{ sources: peopleImport.ImportSource[] }>> {
  return run(async () => peopleImport.listImportSources(await fromSession()))
}

export async function previewPeopleImport(input: { provider: string; group_ids?: string[] }): Promise<ActionResult<peopleImport.PeopleImportPreview>> {
  return run(async () => peopleImport.previewPeopleImport(await fromSession(), input))
}

export async function invitePeopleFromDirectory(input: { provider: string; external_ids: string[]; role: peopleImport.ImportInviteRole }): Promise<ActionResult<peopleImport.InviteResult>> {
  return run(async () => peopleImport.invitePeopleFromDirectory(await fromSession(), input))
}

export async function keepPeopleInSync(input: { provider: string; group_ids: string[] }): Promise<ActionResult<{ run_id: string; already_running: boolean; scope_group_ids: string[] }>> {
  return run(async () => peopleImport.keepPeopleInSync(await fromSession(), input))
}
