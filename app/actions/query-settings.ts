'use server'

import { revalidatePath } from 'next/cache'
import { fromSession, isServiceError } from '@/lib/services/context'
import * as query from '@/lib/services/query-settings'

/*
 * Settings → Query server actions: thin wrappers over
 * lib/services/query-settings (shared with /api/v1/settings/query, MCP and
 * the CLI). settings.edit, audited by the service.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    throw error
  }
}

const PATH = '/settings/query'

export async function updateQuerySettingsAction(input: Record<string, unknown>) {
  const result = await run(async () => query.updateQuerySettings(await fromSession(), input))
  if (result.ok) revalidatePath(PATH)
  return result
}

export async function runQueryRollupsAction(action: query.RollupAction, tenantId?: string | null) {
  return run(async () => query.runQueryRollupAction(await fromSession(), action, { tenantId: tenantId ?? null }))
}

/** Settings navigation: is Settings → Query visible to this person (cloud: instance admins only)? */
export async function queryAccessAction(): Promise<{ cloud: boolean; canView: boolean; canEdit: boolean }> {
  try {
    return await query.queryPageAccess(await fromSession())
  } catch {
    return { cloud: false, canView: false, canEdit: false }
  }
}
