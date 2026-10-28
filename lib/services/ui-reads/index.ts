import { hasPerm, isServiceError, type ServiceContext } from '../context'
import type { UiRead } from './define'
import { reads as activity } from './activity'
import { reads as agents } from './agents'
import { reads as automations } from './automations'
import { reads as data } from './data'
import { reads as forms } from './forms'
import { reads as governance } from './governance'
import { reads as integrations } from './integrations'
import { reads as reports } from './reports'
import { reads as settings } from './settings'
import { reads as tasks } from './tasks'

/**
 * Every read the dashboard runs server-side, by name ('<area>.<read>').
 * Served by /api/internal/read for the signed-in user; the browser calls
 * them through lib/server-read.ts. Nothing here takes a service-role client.
 */
export const UI_READS = {
  ...activity,
  ...agents,
  ...automations,
  ...data,
  ...forms,
  ...governance,
  ...integrations,
  ...reports,
  ...settings,
  ...tasks,
}

export type UiReads = typeof UI_READS
export type UiReadName = keyof UiReads & string

export interface UiReadRequest { name: string; args?: unknown }
export type UiReadResult = { ok: true; data: unknown } | { ok: false; error: string; status: number }

/** Run one read for the context's user: known name, valid args, permission, then the query. */
export async function runUiRead(ctx: ServiceContext, request: UiReadRequest): Promise<UiReadResult> {
  const def = (Object.hasOwn(UI_READS, request.name) ? (UI_READS as Record<string, UiRead>)[request.name] : undefined)
  if (!def) return { ok: false, error: `Unknown read '${request.name}'`, status: 404 }
  const parsed = def.args.safeParse(request.args ?? undefined)
  if (!parsed.success) return { ok: false, error: `Invalid arguments for '${request.name}'`, status: 400 }
  const perms = def.perm === undefined ? [] : typeof def.perm === 'string' ? [def.perm] : def.perm
  if (perms.length && !perms.some((p) => hasPerm(ctx, p))) {
    return { ok: false, error: `Forbidden: you lack the '${perms.join("' or '")}' permission`, status: 403 }
  }
  try {
    return { ok: true, data: (await def.run(ctx, parsed.data)) ?? null }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message, status: error.status }
    console.error(`[ui-read ${request.name}]`, error)
    return { ok: false, error: error instanceof Error && error.message ? error.message : 'Read failed', status: 500 }
  }
}
