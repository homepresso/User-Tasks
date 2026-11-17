/**
 * Team requests service (Settings → Requests): list, open and triage the
 * requests notifyTeam (lib/contact/team-requests) records in
 * public.team_requests.
 *
 *  - Instance admins only (INSTANCE_ADMIN_EMAILS / instance.admin_emails,
 *    verified email): the Settings → Infrastructure check. Workspace roles
 *    never grant it. Every function re-checks it.
 *  - The tables are service role only (RLS on, no client grants), so every
 *    read and write here uses the service client after the check.
 *  - Status and note changes are audited: a team_request_events row (the
 *    request's own history) and an object_audit_log row in the admin's
 *    workspace (object_type `team_request`, no personal details in the
 *    summary) for the activity feed and log export.
 *  - Lists are keyset paged on (created_at, id), newest first.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- team_requests is not in the generated Database types */

import { z } from 'zod'
import { ilikeOrFilter } from '@/lib/utils'
import {
  OPEN_STATUSES, TEAM_REQUEST_KIND_LABELS, TEAM_REQUEST_KINDS, TEAM_REQUEST_STATUS_LABELS, TEAM_REQUEST_STATUSES,
  type TeamRequestKind, type TeamRequestStatus,
} from '@/lib/contact/team-request-labels'
import { ServiceError } from './context'

export { OPEN_STATUSES, TEAM_REQUEST_KIND_LABELS, TEAM_REQUEST_KINDS, TEAM_REQUEST_STATUS_LABELS, TEAM_REQUEST_STATUSES }
export type { TeamRequestKind, TeamRequestStatus }

export interface TeamRequestViewer {
  id: string
  email?: string | null
}

export interface AdminCheck {
  (viewer: TeamRequestViewer): Promise<boolean>
}

/** Instance admins (the Settings → Infrastructure check). */
export const isTeamRequestsAdmin: AdminCheck = async (viewer) => {
  const { viewerCanSeeInfrastructure } = await import('@/lib/admin/infrastructure')
  return viewerCanSeeInfrastructure(viewer)
}

export interface TeamRequestDeps {
  check?: AdminCheck
}

async function requireAdmin(viewer: TeamRequestViewer | null | undefined, deps: TeamRequestDeps = {}): Promise<TeamRequestViewer> {
  if (!viewer?.id) throw new ServiceError('unauthorized', 'Sign in to see team requests')
  if (!(await (deps.check ?? isTeamRequestsAdmin)(viewer))) throw ServiceError.forbidden('Only instance administrators can see team requests')
  return viewer
}

async function db(): Promise<any> {
  const { hasServiceDb, getServiceDb } = await import('@/lib/providers/db')
  if (!hasServiceDb()) throw new ServiceError('internal', 'Team requests need the service database client (SUPABASE_SERVICE_ROLE_KEY or DATABASE_URL).', { status: 503 })
  return getServiceDb()
}

function tableError(error: { message?: string; code?: string }): ServiceError {
  // 42P01 / PGRST205: the migration is not applied yet.
  if (error.code === '42P01' || error.code === 'PGRST205') {
    return new ServiceError('internal', 'Team requests are not set up on this database yet (migration 20270116120000_team_requests).', { status: 503 })
  }
  console.error('[team-requests]', error.message ?? error)
  return new ServiceError('internal', 'Could not load team requests')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const teamRequestFiltersSchema = z.object({
  kind: z.enum([...TEAM_REQUEST_KINDS, 'all']).default('all'),
  status: z.enum([...TEAM_REQUEST_STATUSES, 'open', 'all']).default('open'),
  q: z.string().trim().max(200).optional().transform((v) => v || undefined),
  cursor: z.string().max(200).optional().transform((v) => v || undefined),
  limit: z.number().int().min(1).max(100).default(50),
})
export type TeamRequestFilters = z.input<typeof teamRequestFiltersSchema>

/** List columns (no detail_html: that is loaded with one request). */
const LIST_COLUMNS = 'id, created_at, kind, title, name, email, company, status, handled_at'

export interface TeamRequestListItem {
  id: string
  created_at: string
  kind: TeamRequestKind
  title: string
  name: string | null
  email: string | null
  company: string | null
  status: TeamRequestStatus
  handled_at: string | null
}

export interface TeamRequestEvent {
  id: number
  occurred_at: string
  actor_email: string | null
  from_status: string | null
  to_status: string | null
  note: string | null
}

export interface TeamRequestDetail extends TeamRequestListItem {
  summary: string
  reply_to: string | null
  url: string | null
  facts: Record<string, unknown>
  detail_html: string
  handled_by: string | null
  note: string | null
  delivery: Record<string, unknown>
  events: TeamRequestEvent[]
}

/** Opaque keyset cursor: the last row's (created_at, id). */
export function encodeCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.created_at, row.id])).toString('base64url')
}

export function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (typeof createdAt === 'string' && !Number.isNaN(Date.parse(createdAt)) && typeof id === 'string' && UUID.test(id)) return { createdAt, id }
  } catch { /* invalid below */ }
  throw ServiceError.validation('Invalid page cursor')
}

export async function listTeamRequests(
  viewer: TeamRequestViewer | null | undefined,
  input: TeamRequestFilters = {},
  deps: TeamRequestDeps = {},
): Promise<{ items: TeamRequestListItem[]; nextCursor: string | null }> {
  await requireAdmin(viewer, deps)
  const parsed = teamRequestFiltersSchema.safeParse(input)
  if (!parsed.success) throw ServiceError.validation(parsed.error.issues[0]?.message ?? 'Invalid filters')
  const f = parsed.data
  let query = (await db()).from('team_requests').select(LIST_COLUMNS)
  if (f.status === 'open') query = query.in('status', OPEN_STATUSES)
  else if (f.status !== 'all') query = query.eq('status', f.status)
  if (f.kind !== 'all') query = query.eq('kind', f.kind)
  if (f.q) query = query.or(ilikeOrFilter(['name', 'email', 'company', 'title'], f.q))
  if (f.cursor) {
    const { createdAt, id } = decodeCursor(f.cursor)
    query = query.or(`created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt.${id})`)
  }
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(f.limit + 1)
  if (error) throw tableError(error)
  const rows = (data ?? []) as TeamRequestListItem[]
  const items = rows.slice(0, f.limit)
  return { items, nextCursor: rows.length > f.limit ? encodeCursor(items[items.length - 1]) : null }
}

export async function getTeamRequest(viewer: TeamRequestViewer | null | undefined, id: string, deps: TeamRequestDeps = {}): Promise<TeamRequestDetail> {
  await requireAdmin(viewer, deps)
  if (!UUID.test(id)) throw ServiceError.notFound('Request not found')
  const client = await db()
  const [row, events] = await Promise.all([
    client.from('team_requests').select('*').eq('id', id).maybeSingle(),
    client.from('team_request_events').select('id, occurred_at, actor_email, from_status, to_status, note').eq('request_id', id).order('occurred_at', { ascending: false }).limit(50),
  ])
  if (row.error) throw tableError(row.error)
  if (!row.data) throw ServiceError.notFound('Request not found')
  return { ...(row.data as Omit<TeamRequestDetail, 'events'>), events: events.error ? [] : (events.data ?? []) }
}

export const teamRequestUpdateSchema = z.object({
  status: z.enum(TEAM_REQUEST_STATUSES).optional(),
  note: z.string().max(5000).nullable().optional().transform((v) => (v === undefined ? undefined : v?.trim() || null)),
}).refine((v) => v.status !== undefined || v.note !== undefined, 'Nothing to change')
export type TeamRequestUpdate = z.input<typeof teamRequestUpdateSchema>

/** The admin's workspace (current, else home) for the object audit log row. */
async function auditTenant(client: any, actorId: string): Promise<string | null> {
  const { data } = await client.from('users').select('tenant_id, current_tenant_id').eq('id', actorId).maybeSingle()
  return (data?.current_tenant_id ?? data?.tenant_id ?? null) as string | null
}

export async function updateTeamRequest(
  viewer: TeamRequestViewer | null | undefined,
  id: string,
  input: TeamRequestUpdate,
  deps: TeamRequestDeps = {},
): Promise<TeamRequestDetail> {
  const admin = await requireAdmin(viewer, deps)
  if (!UUID.test(id)) throw ServiceError.notFound('Request not found')
  const parsed = teamRequestUpdateSchema.safeParse(input)
  if (!parsed.success) throw ServiceError.validation(parsed.error.issues[0]?.message ?? 'Invalid change')
  const change = parsed.data
  const client = await db()
  const { data: before, error: readError } = await client.from('team_requests').select('id, kind, status, note').eq('id', id).maybeSingle()
  if (readError) throw tableError(readError)
  if (!before) throw ServiceError.notFound('Request not found')

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const statusChanged = change.status !== undefined && change.status !== before.status
  const noteChanged = change.note !== undefined && (change.note ?? null) !== (before.note ?? null)
  if (!statusChanged && !noteChanged) return getTeamRequest(admin, id, deps)
  if (statusChanged) {
    patch.status = change.status
    const closed = change.status === 'handled' || change.status === 'spam'
    patch.handled_by = closed ? admin.id : null
    patch.handled_at = closed ? new Date().toISOString() : null
  }
  if (noteChanged) patch.note = change.note
  const { error: updateError } = await client.from('team_requests').update(patch).eq('id', id)
  if (updateError) throw tableError(updateError)

  // Audit: the request's own history, then the admin's workspace audit log (never throws).
  const { error: eventError } = await client.from('team_request_events').insert({
    request_id: id,
    actor_id: admin.id,
    actor_email: admin.email ?? null,
    from_status: statusChanged ? before.status : null,
    to_status: statusChanged ? change.status : null,
    note: noteChanged ? change.note : null,
    detail: { note_changed: noteChanged },
  })
  if (eventError) console.error('[team-requests] audit event insert failed', eventError.message ?? eventError)
  try {
    const tenantId = await auditTenant(client, admin.id)
    if (tenantId) {
      const { writeAudit } = await import('@/lib/audit-log')
      await writeAudit({
        supabase: client,
        tenantId,
        actorId: admin.id,
        objectType: 'team_request',
        objectId: id,
        action: 'update',
        summary: statusChanged
          ? `Team request (${TEAM_REQUEST_KIND_LABELS[before.kind as TeamRequestKind] ?? before.kind}) marked ${TEAM_REQUEST_STATUS_LABELS[change.status!]}`
          : 'Team request note updated',
        diff: {
          ...(statusChanged ? { status: { before: before.status, after: change.status } } : {}),
          ...(noteChanged ? { note: { before: before.note ? '(set)' : null, after: change.note ? '(set)' : null } } : {}),
        },
      })
    }
  } catch (error) {
    console.warn('[team-requests] workspace audit failed', error)
  }
  return getTeamRequest(admin, id, deps)
}
