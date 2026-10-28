'use server'

import { revalidatePath } from 'next/cache'
import { fromSession, isServiceError, requirePerm } from '@/lib/services/context'
import * as destinations from '@/lib/services/log-destinations'

/*
 * Log export server actions for /settings/log-export: thin wrappers over
 * lib/services/log-destinations (shared with /api/v1/log-destinations, MCP
 * and the CLI). log_destinations has no client grants, so everything goes
 * through the service layer, which reads and writes with a service-role
 * client after its own permission checks (observability.view to read,
 * settings.edit to change). Credentials come back masked ('__SECRET__').
 *
 * Expected failures (validation, permission, conflict) are returned as
 * { ok: false, error } so their messages survive production builds, where
 * thrown Server Function errors are redacted.
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

const PATH = '/settings/log-export'

/** A destination as the service presents it (credentials masked). */
export interface LogDestinationRow {
  id: string
  name: string
  type: string
  config: Record<string, unknown>
  credentials: Record<string, unknown>
  filters: Record<string, unknown>
  enabled: boolean
  cursor: string
  status: string
  events_sent: number
  next_attempt_at: string | null
  last_success_at: string | null
  last_error: string | null
  last_error_at: string | null
  consecutive_failures: number
  created_by: string | null
  created_at: string
  updated_at: string
}
export type LogDestinationStatus = Awaited<ReturnType<typeof destinations.getLogDestinationStatus>>
export type LogDestinationTestResult = Awaited<ReturnType<typeof destinations.testLogDestination>>

/** Destinations with their delivery status (lag, last success / error). */
export async function listLogDestinationsWithStatus() {
  return run(async () => {
    const ctx = await fromSession()
    const { log_destinations: rows } = await destinations.listLogDestinations(ctx, { limit: null, offset: 0 })
    const statuses = await Promise.all(rows.map((row) =>
      destinations.getLogDestinationStatus(ctx, String(row.id)).catch(() => null)))
    return rows.map((row, i) => ({ destination: row as LogDestinationRow, status: statuses[i] }))
  })
}

export async function createLogDestinationAction(input: destinations.LogDestinationCreateInput) {
  return run(async () => {
    const result = await destinations.createLogDestination(await fromSession(), input)
    revalidatePath(PATH)
    return result as { log_destination: LogDestinationRow; signing_secret?: string }
  })
}

export async function updateLogDestinationAction(id: string, input: destinations.LogDestinationUpdateInput) {
  return run(async () => {
    const result = await destinations.updateLogDestination(await fromSession(), id, input)
    revalidatePath(PATH)
    return result as { log_destination: LogDestinationRow; changed: boolean }
  })
}

export async function setLogDestinationEnabledAction(id: string, enabled: boolean) {
  return updateLogDestinationAction(id, { enabled })
}

export async function deleteLogDestinationAction(id: string) {
  return run(async () => {
    const result = await destinations.deleteLogDestination(await fromSession(), id)
    revalidatePath(PATH)
    return result
  })
}

export async function testLogDestinationAction(id: string) {
  return run(async () => destinations.testLogDestination(await fromSession(), id))
}

export async function resetLogDestinationCursorAction(id: string, from: destinations.StartFrom) {
  return run(async () => {
    const result = await destinations.resetLogDestinationCursor(await fromSession(), id, from)
    revalidatePath(PATH)
    return result
  })
}

/** Workflows for the filter picker (session client: workflows RLS applies). */
export async function listLogExportWorkflowOptions() {
  return run(async () => {
    const ctx = await fromSession()
    requirePerm(ctx, 'observability.view')
    const { data, error } = await ctx.supabase
      .from('workflows')
      .select('id, name')
      .eq('tenant_id', ctx.tenantId)
      .order('name')
      .limit(1000)
    if (error) throw error
    return (data ?? []).map((row: { id: string; name: string | null }) => ({ id: row.id, name: row.name ?? 'Untitled workflow' }))
  })
}
