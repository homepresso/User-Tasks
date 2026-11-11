/**
 * Task attachments (lib/task-attachments.ts for the value shape; migration
 * 20261222000000): list, add (through the app, or direct-to-storage: init →
 * the browser / client PUTs to a signed URL → complete), soft delete,
 * download links, the workflow engine's reads and writes, and cleanup.
 *
 * Storage: the private `form-files` bucket of the configured
 * StorageProvider (Supabase, S3 / MinIO, Azure Blob, GCS, local disk), at
 * `<tenant>/attachment-<task>/<id>/<ascii name>`. Nothing is reachable by
 * URL: /attachments/<id> authorises every request (canViewAttachments) and
 * hands out a short-lived signed link.
 *
 * Checks: the same pipeline as form attachments (lib/services/form-files.ts
 * verifyUploadBytes): size (FORM_ATTACHMENT_MAX_MB), content by magic bytes,
 * blocked types, SVG sanitising, the optional virus scan. Nothing the client
 * sends about the stored file (key, size, type, checksum) is trusted.
 *
 * Who (mirrored by the RLS policies for direct database access):
 *  - view: the assignee, collaborators, team members, a manager of an
 *    assignee, the assigner, tasks.view_all / tasks.manage_queue;
 *  - add: people who can work on the open task — tasks.complete and the
 *    task-action rule (assignee, collaborator, team member, manager of an
 *    assignee, tasks.complete_any, tasks.manage_queue on a non-workflow task);
 *  - delete (soft): the uploader while they can see the task, or
 *    tasks.delete ("admin"); never while the task's form is on legal hold.
 *
 * Audit: add / delete / download are written to object_audit_log on the
 * task (actions attachment_add / attachment_delete / attachment_download);
 * adds and deletes also go on the task timeline (lifecycle events
 * attachment_added / attachment_deleted → event stream task.attachment_*).
 *
 * Governance: a task attachment follows the reusable form its task came
 * from (form_id): the form's legal hold blocks deletes and purges, and the
 * form's retention policy purges the attachments of closed tasks with its
 * submissions (lib/jobs/retention.ts). Soft-deleted attachments are purged
 * after TASK_ATTACHMENT_DELETED_RETENTION_DAYS (default 30). Exports never
 * carry them (runtime data, like submissions).
 */

import { createHash } from 'node:crypto'
import { readAll } from '@/lib/providers/storage/types'
import { formatStorageRef, parseStorageRef } from '@/lib/storage/refs'
import { signedObjectQuery } from '@/lib/storage/signing'
import { attachmentLimits, BLOCKED_EXTENSIONS, fileExtension, isTypeAllowed, kindForExtension, sanitizeFileName, storageSafeName } from '@/lib/forms/attachments'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { attachmentTypeSuggestions, TASK_ATTACHMENT_LIMITS, validateAttachmentMeta, type TaskAttachment, type TaskAttachmentMeta } from '@/lib/task-attachments'
import { hasPerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'
import {
  attachmentUrl, FORM_FILES_BUCKET, formFilesStorage, instanceMaxMb, streamedUploadMaxBytes, uploadWindowMinutes, verifyUploadBytes,
  WORKFLOW_FILE_MAX_BYTES, type FormFileRow, type WorkflowFileBytes,
} from './form-files'

/* eslint-disable @typescript-eslint/no-explicit-any -- task_attachments is not in the generated Database types */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUMNS = 'id, tenant_id, task_id, form_id, name, type, description, storage_key, file_name, mime_type, size, checksum_sha256, status, uploaded_by, run_id, created_at, expires_at, deleted_at'
const TASK_COLUMNS = 'id, tenant_id, title, status, is_workflow_task, event_id, assignee_id, assigner_id, assigned_team_id, assignment_mode, deleted_at'

export interface TaskAttachmentRow {
  id: string
  tenant_id: string
  task_id: string
  form_id: string | null
  name: string
  type: string
  description: string
  storage_key: string
  file_name: string
  mime_type: string
  size: number
  checksum_sha256: string
  status: 'uploading' | 'ready'
  uploaded_by: string | null
  run_id: string | null
  created_at: string
  expires_at: string | null
  deleted_at: string | null
}

/** A synthetic Attachments field: any safe type, the instance's size cap. */
const ATTACHMENT_FIELD: TaskFieldDef = { key: 'task_attachments', label: 'Attachment', type: 'attachments' }

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  const n = raw === undefined || raw === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : fallback
}

/** Largest attachment (the instance's FORM_ATTACHMENT_MAX_MB, default 25 MB). */
export function maxAttachmentBytes(): number {
  return attachmentLimits({ max_file_mb: instanceMaxMb() }, { instanceMaxMb: instanceMaxMb() }).maxFileBytes
}

function perTaskLimit(): number {
  return Math.floor(envNumber('TASK_ATTACHMENT_MAX_PER_TASK', TASK_ATTACHMENT_LIMITS.perTask, 1, 10_000))
}

/** Days a deleted attachment is kept before the cleanup job removes it (TASK_ATTACHMENT_DELETED_RETENTION_DAYS, default 30; 0 = at once). */
export function deletedRetentionDays(): number {
  return envNumber('TASK_ATTACHMENT_DELETED_RETENTION_DAYS', 30, 0, 3650)
}

export function presentTaskAttachment(row: TaskAttachmentRow, names?: Map<string, string>): TaskAttachment {
  const created = new Date(row.created_at)
  return {
    id: row.id,
    task_id: row.task_id,
    name: row.name,
    type: row.type,
    description: row.description ?? '',
    file_name: row.file_name,
    mime: row.mime_type,
    mime_type: row.mime_type,
    size: Number(row.size),
    url: attachmentUrl(row.id),
    storage_ref: formatStorageRef(FORM_FILES_BUCKET, row.storage_key),
    checksum_sha256: row.checksum_sha256,
    uploaded_by: row.uploaded_by,
    ...(names ? { uploaded_by_name: row.uploaded_by ? names.get(row.uploaded_by) ?? null : null } : {}),
    created_at: Number.isNaN(created.getTime()) ? String(row.created_at ?? '') : created.toISOString(),
    run_id: row.run_id ?? null,
  }
}

/* ── Access ──────────────────────────────────────────────────────────── */

export interface TaskAttachmentAccess {
  task: Record<string, any>
  view: boolean
  /** May add (open task, tasks.complete and the task-action rule). */
  work: boolean
  /** tasks.delete: may delete anyone's attachment. */
  admin: boolean
  /** The task's form is on legal hold: nothing is deleted. */
  held: boolean
}

function closed(task: { status?: string | null }): boolean {
  return task.status === 'completed' || task.status === 'cancelled'
}

async function formHeld(db: AnySupabaseClient, tenantId: string, formId: string | null | undefined): Promise<boolean> {
  if (!formId) return false
  const { data } = await (db as any).from('forms').select('legal_hold').eq('id', formId).eq('tenant_id', tenantId).maybeSingle()
  return Boolean(data?.legal_hold)
}

function taskFormId(task: Record<string, any>): string | null {
  const id = task?.metadata?.form_ref?.form_id
  return typeof id === 'string' && UUID_RE.test(id) ? id : null
}

/**
 * The caller's access to a task's attachments (404 unless the task is a
 * live task of the caller's workspace they can see).
 */
export async function taskAttachmentAccess(ctx: ServiceContext, db: AnySupabaseClient, taskId: string): Promise<TaskAttachmentAccess> {
  if (!UUID_RE.test(String(taskId))) throw ServiceError.notFound('Task not found')
  const { data: task, error } = await (db as any).from('tasks').select(`${TASK_COLUMNS}, metadata`)
    .eq('id', taskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
  if (error) throw dbError(error)
  if (!task) throw ServiceError.notFound('Task not found')
  const admin = hasPerm(ctx, 'tasks.delete')
  const broadView = hasPerm(ctx, 'tasks.view_all') || hasPerm(ctx, 'tasks.manage_queue')
  let related = false
  let assigner = false
  if (ctx.actorId) {
    const { loadTaskActorFacts } = await import('@/lib/task-authz')
    const facts = await loadTaskActorFacts(db, task, ctx.actorId)
    related = facts.isAssignee || facts.isTeamMember || Boolean(facts.managedAssigneeId) || facts.isWorkflowManager === true
    assigner = task.assigner_id === ctx.actorId
  }
  const work = !closed(task) && hasPerm(ctx, 'tasks.complete') && Boolean(ctx.actorId) && (
    related || hasPerm(ctx, 'tasks.complete_any') || (!task.is_workflow_task && hasPerm(ctx, 'tasks.manage_queue'))
  )
  let view = work || related || assigner || broadView
  // Invited viewers (task_viewers) read the files; they never add them.
  if (!view && ctx.actorId) {
    const { findTaskViewerGrant } = await import('@/lib/task-authz')
    view = Boolean(await findTaskViewerGrant(db, ctx.tenantId, ctx.actorId, taskId))
  }
  if (!view) throw ServiceError.notFound('Task not found')
  return { task, view, work, admin, held: await formHeld(db, ctx.tenantId, taskFormId(task)) }
}

/** May the caller (signed in) see the task this attachment belongs to? */
export async function canViewTaskAttachment(ctx: ServiceContext, row: Pick<TaskAttachmentRow, 'tenant_id' | 'task_id' | 'uploaded_by' | 'status' | 'deleted_at'>): Promise<boolean> {
  if (row.tenant_id !== ctx.tenantId || !ctx.actorId || row.deleted_at) return false
  if (row.status !== 'ready') return row.uploaded_by === ctx.actorId
  const db = await serviceRoleClient(ctx)
  try {
    await taskAttachmentAccess(ctx, db, row.task_id)
    return true
  } catch (error) {
    if (error instanceof ServiceError && (error.code === 'not_found' || error.code === 'forbidden')) return false
    throw error
  }
}

function canDelete(ctx: ServiceContext, access: TaskAttachmentAccess, row: Pick<TaskAttachmentRow, 'uploaded_by'>): boolean {
  if (access.held) return false
  return access.admin || (Boolean(ctx.actorId) && row.uploaded_by === ctx.actorId)
}

/* ── Reads ───────────────────────────────────────────────────────────── */

async function loadRow(db: AnySupabaseClient, tenantId: string, id: string): Promise<TaskAttachmentRow | null> {
  if (!UUID_RE.test(String(id))) return null
  const { data, error } = await (db as any).from('task_attachments').select(COLUMNS).eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw dbError(error)
  return (data as TaskAttachmentRow | null) ?? null
}

async function userNames(db: AnySupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  const out = new Map<string, string>()
  if (!unique.length) return out
  const { data } = await (db as any).from('users').select('id, display_name, email').in('id', unique)
  for (const u of (data ?? []) as any[]) out.set(String(u.id), String(u.display_name || u.email || 'Someone'))
  return out
}

export interface TaskAttachmentList {
  task_id: string
  attachments: Array<TaskAttachment & { can_delete: boolean }>
  can_add: boolean
  /** The task's form is on legal hold (nothing can be deleted). */
  legal_hold: boolean
  type_suggestions: string[]
  max_file_bytes: number
}

/** The task's attachments, oldest first, with what the caller may do. */
export async function listTaskAttachments(ctx: ServiceContext, taskId: string): Promise<TaskAttachmentList> {
  const db = await serviceRoleClient(ctx)
  const access = await taskAttachmentAccess(ctx, db, taskId)
  const { data, error } = await (db as any).from('task_attachments').select(COLUMNS)
    .eq('tenant_id', ctx.tenantId).eq('task_id', taskId).eq('status', 'ready').is('deleted_at', null)
    .order('created_at', { ascending: true }).limit(500)
  if (error) throw dbError(error)
  const rows = (data ?? []) as TaskAttachmentRow[]
  const names = await userNames(db, rows.map((r) => r.uploaded_by ?? ''))
  const { data: used } = await (db as any).from('task_attachments').select('type')
    .eq('tenant_id', ctx.tenantId).is('deleted_at', null).order('created_at', { ascending: false }).limit(200)
  return {
    task_id: taskId,
    attachments: rows.map((row) => ({ ...presentTaskAttachment(row, names), can_delete: canDelete(ctx, access, row) })),
    can_add: access.work,
    legal_hold: access.held,
    type_suggestions: attachmentTypeSuggestions(((used ?? []) as any[]).map((r) => String(r.type ?? ''))),
    max_file_bytes: maxAttachmentBytes(),
  }
}

/** One attachment (the caller must be able to see its task). */
export async function getTaskAttachment(ctx: ServiceContext, taskId: string, attachmentId: string): Promise<TaskAttachment> {
  const db = await serviceRoleClient(ctx)
  await taskAttachmentAccess(ctx, db, taskId)
  const row = await loadRow(db, ctx.tenantId, attachmentId)
  if (!row || row.task_id !== taskId || row.status !== 'ready' || row.deleted_at) throw ServiceError.notFound('Attachment not found')
  return presentTaskAttachment(row, await userNames(db, [row.uploaded_by ?? '']))
}

/* ── Add ─────────────────────────────────────────────────────────────── */

export interface AddTaskAttachmentInput {
  task_id: string
  name?: string
  type?: string
  description?: string
  /** Original file name (sanitised here). */
  file_name: string
  bytes: Uint8Array
  /** Size the client said it sent: a mismatch means the body was cut short. */
  declared_size?: number | null
}

function metaOrThrow(input: { name?: unknown; type?: unknown; description?: unknown }, fileName: string): TaskAttachmentMeta {
  const meta = validateAttachmentMeta(input, fileName)
  if (!meta.ok) {
    const [field, message] = Object.entries(meta.errors)[0] as [string, string]
    throw new ServiceError('validation_error', `${field[0].toUpperCase()}${field.slice(1)}: ${message}`, { details: meta.errors })
  }
  return meta.value
}

function tooLarge(): ServiceError {
  return new ServiceError('validation_error', `Files must be ${Math.round(maxAttachmentBytes() / 1024 / 1024 * 10) / 10} MB or smaller`, { status: 413 })
}

function streamedTooLarge(): ServiceError {
  const mb = Math.round((streamedUploadMaxBytes() + 64 * 1024) / 1024 / 1024 * 10) / 10
  return new ServiceError('validation_error', `This file is larger than the server's upload limit (${mb} MB). Use a storage provider with direct uploads (Supabase, S3 / MinIO, Azure Blob, Google Cloud Storage)`, { status: 413 })
}

async function rateLimited(ctx: ServiceContext) {
  const { rateLimit } = await import('@/lib/rate-limit')
  const hit = await rateLimit(`task-attachments:${ctx.tenantId}:${ctx.actorId ?? 'key'}`, { max: 120, windowMs: 60_000 })
  if (!hit.ok) throw new ServiceError('rate_limited', 'Too many uploads — wait a moment and try again', { details: { retry_after_ms: hit.retryAfterMs } })
}

async function checkQuota(db: AnySupabaseClient, tenantId: string, taskId: string) {
  const { count } = await (db as any).from('task_attachments').select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('task_id', taskId).is('deleted_at', null)
  if ((count ?? 0) >= perTaskLimit()) throw new ServiceError('rate_limited', `A task can hold at most ${perTaskLimit()} attachments — delete some first`)
}

function storageKey(tenantId: string, taskId: string, id: string, fileName: string): string {
  return `${tenantId}/attachment-${taskId}/${id}/${storageSafeName(fileName)}`
}

async function requireWork(ctx: ServiceContext, db: AnySupabaseClient, taskId: string): Promise<TaskAttachmentAccess> {
  if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: attaching files needs a user-bound credential (a personal API key, OAuth or a signed-in user)')
  const access = await taskAttachmentAccess(ctx, db, taskId)
  if (!access.work) {
    if (closed(access.task)) throw ServiceError.conflict('This task is closed')
    throw ServiceError.forbidden('Forbidden: you can view this task but not add attachments to it')
  }
  return access
}

async function announceAdded(db: AnySupabaseClient, ctx: { tenantId: string; actorId: string | null; source?: string }, row: TaskAttachmentRow) {
  const [{ writeLifecycleEvent }, { writeAudit }] = await Promise.all([import('@/lib/lifecycle-events'), import('@/lib/audit-log')])
  const meta = { attachment_id: row.id, name: row.name, type: row.type, file_name: row.file_name, size: Number(row.size), mime_type: row.mime_type, ...(row.run_id ? { run_id: row.run_id } : {}) }
  await Promise.all([
    writeLifecycleEvent({ supabase: db as any, tenantId: ctx.tenantId, taskId: row.task_id, eventType: 'attachment_added', actorId: ctx.actorId, metadata: meta }),
    writeAudit({
      supabase: db as any, tenantId: ctx.tenantId, actorId: ctx.actorId, objectType: 'task', objectId: row.task_id, action: 'attachment_add',
      summary: `Attached "${row.name}" (${row.file_name})`, metadata: { ...meta, via: ctx.source ?? 'api' },
    }),
  ])
}

/**
 * Store one file (the bytes came through the app: the browser's server
 * path, base64 API uploads) and record it as a ready attachment.
 */
export async function addTaskAttachment(ctx: ServiceContext, input: AddTaskAttachmentInput): Promise<TaskAttachment> {
  const db = await serviceRoleClient(ctx)
  await requireWork(ctx, db, input.task_id)
  await rateLimited(ctx)
  const fileName = sanitizeFileName(input.file_name)
  const meta = metaOrThrow(input, fileName)
  const bytes = input.bytes
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw ServiceError.validation('The file is empty')
  if (bytes.byteLength > maxAttachmentBytes()) throw tooLarge()
  if (input.declared_size !== undefined && input.declared_size !== null && Number(input.declared_size) !== bytes.byteLength) {
    if (Number(input.declared_size) > streamedUploadMaxBytes()) throw streamedTooLarge()
    throw ServiceError.validation('The upload was incomplete — try again')
  }
  await checkQuota(db, ctx.tenantId, input.task_id)
  const row = await storeVerified(db, {
    tenantId: ctx.tenantId, taskId: input.task_id, meta, fileName, bytes, uploadedBy: ctx.actorId, runId: null,
  })
  await announceAdded(db, ctx, row)
  return presentTaskAttachment(row, await userNames(db, [ctx.actorId ?? '']))
}

/** Verify, store and record (status ready). Shared by people and workflow steps. */
async function storeVerified(db: AnySupabaseClient, input: {
  tenantId: string; taskId: string; meta: TaskAttachmentMeta; fileName: string; bytes: Uint8Array; uploadedBy: string | null; runId: string | null
}): Promise<TaskAttachmentRow> {
  const checked = await verifyUploadBytes(ATTACHMENT_FIELD, input.fileName, input.bytes, maxAttachmentBytes())
  const id = crypto.randomUUID()
  const key = storageKey(input.tenantId, input.taskId, id, input.fileName)
  const provider = await formFilesStorage()
  try {
    await provider.put(FORM_FILES_BUCKET, key, checked.body, { contentType: checked.mime, cacheControl: 'private, no-store' })
  } catch (error) {
    console.error('[task-attachments] store failed:', error instanceof Error ? error.message : error)
    throw new ServiceError('internal', 'The file could not be stored — try again')
  }
  const { data, error } = await (db as any).from('task_attachments').insert({
    id,
    tenant_id: input.tenantId,
    task_id: input.taskId,
    name: input.meta.name,
    type: input.meta.type,
    description: input.meta.description,
    storage_key: key,
    file_name: input.fileName,
    mime_type: checked.mime,
    size: checked.body.byteLength,
    checksum_sha256: createHash('sha256').update(checked.body).digest('hex'),
    status: 'ready',
    scan_status: checked.scan,
    uploaded_by: input.uploadedBy,
    run_id: input.runId,
    expires_at: null,
  }).select(COLUMNS).single()
  if (error || !data) {
    await provider.delete(FORM_FILES_BUCKET, [key]).catch(() => {})
    throw dbError(error, 'The attachment could not be recorded')
  }
  return data as TaskAttachmentRow
}

export interface InitTaskAttachmentInput {
  task_id: string
  name?: string
  type?: string
  description?: string
  file_name: string
  size: number
}

export type InitTaskAttachmentResult =
  | { mode: 'direct'; attachment_id: string; upload: { url: string; method: 'PUT'; headers: Record<string, string> }; expires_at: string }
  /** Send the file through the app (multipart), at most `max_bytes`. */
  | { mode: 'server'; max_bytes: number }

/**
 * Start a direct upload: the same checks on the declared name and size, an
 * `uploading` row with the name / type / description, and a signed URL for
 * exactly that object. Providers without signed uploads answer
 * `{ mode: 'server' }`.
 */
export async function initTaskAttachmentUpload(ctx: ServiceContext, input: InitTaskAttachmentInput): Promise<InitTaskAttachmentResult> {
  const db = await serviceRoleClient(ctx)
  await requireWork(ctx, db, input.task_id)
  await rateLimited(ctx)
  const fileName = sanitizeFileName(input.file_name)
  const meta = metaOrThrow(input, fileName)
  const size = Number(input.size)
  if (!Number.isInteger(size) || size <= 0) throw ServiceError.validation('The file is empty')
  if (size > maxAttachmentBytes()) throw tooLarge()
  const ext = fileExtension(fileName)
  if (BLOCKED_EXTENSIONS.has(ext) || !isTypeAllowed(undefined, ext, kindForExtension(ext))) {
    throw new ServiceError('validation_error', ext ? `.${ext} files are not allowed` : 'Files without an extension are not allowed', { status: 415 })
  }
  await checkQuota(db, ctx.tenantId, input.task_id)
  const server = (): InitTaskAttachmentResult => {
    if (size > streamedUploadMaxBytes()) throw streamedTooLarge()
    return { mode: 'server', max_bytes: Math.min(streamedUploadMaxBytes(), maxAttachmentBytes()) }
  }
  const provider = await formFilesStorage()
  if (typeof provider.createUploadUrl !== 'function') return server()
  const id = crypto.randomUUID()
  const key = storageKey(ctx.tenantId, input.task_id, id, fileName)
  const contentType = kindForExtension(ext)?.mime ?? 'application/octet-stream'
  const expiresAt = new Date(Date.now() + uploadWindowMinutes() * 60_000).toISOString()
  const { error } = await (db as any).from('task_attachments').insert({
    id, tenant_id: ctx.tenantId, task_id: input.task_id, name: meta.name, type: meta.type, description: meta.description,
    storage_key: key, file_name: fileName, mime_type: contentType, size, status: 'uploading', uploaded_by: ctx.actorId, expires_at: expiresAt,
  })
  if (error) throw dbError(error, 'The upload could not be started')
  try {
    const upload = await provider.createUploadUrl(FORM_FILES_BUCKET, key, { contentType, ttlSeconds: uploadWindowMinutes() * 60 })
    return { mode: 'direct', attachment_id: id, upload, expires_at: expiresAt }
  } catch (err) {
    await (db as any).from('task_attachments').delete().eq('id', id)
    console.warn('[task-attachments] signed upload URL failed, using the server path:', err instanceof Error ? err.message : err)
    return server()
  }
}

/**
 * Finish a direct upload: the uploader only, within the window, while they
 * can still work on the task. The object is read back and verified; on
 * failure the object and the row are deleted.
 */
export async function completeTaskAttachmentUpload(ctx: ServiceContext, attachmentId: string): Promise<TaskAttachment> {
  if (!ctx.actorId) throw ServiceError.notFound('Upload not found')
  const db = await serviceRoleClient(ctx)
  const row = await loadRow(db, ctx.tenantId, attachmentId)
  if (!row || row.uploaded_by !== ctx.actorId || row.deleted_at) throw ServiceError.notFound('Upload not found')
  if (row.status === 'ready') return presentTaskAttachment(row, await userNames(db, [ctx.actorId]))
  const provider = await formFilesStorage()
  const discard = async () => {
    await (db as any).from('task_attachments').delete().eq('id', row.id)
    await provider.delete(FORM_FILES_BUCKET, [row.storage_key]).catch(() => {})
  }
  if (!row.expires_at || new Date(row.expires_at).getTime() < Date.now()) {
    await discard()
    throw new ServiceError('validation_error', 'The upload took too long — try again', { status: 410 })
  }
  try {
    await requireWork(ctx, db, row.task_id)
    const head = await provider.head(FORM_FILES_BUCKET, row.storage_key)
    if (!head) throw ServiceError.validation('The file did not arrive — try again')
    if (head.size > maxAttachmentBytes()) throw tooLarge()
    const object = await provider.get(FORM_FILES_BUCKET, row.storage_key)
    if (!object) throw ServiceError.validation('The file did not arrive — try again')
    const bytes = await readAll(object.body)
    if (bytes.byteLength !== Number(row.size)) throw ServiceError.validation('The uploaded file is not the one that was announced — try again')
    const checked = await verifyUploadBytes(ATTACHMENT_FIELD, row.file_name, bytes, maxAttachmentBytes())
    if (checked.rewritten || head.contentType !== checked.mime) {
      await provider.put(FORM_FILES_BUCKET, row.storage_key, checked.body, { contentType: checked.mime, cacheControl: 'private, no-store', upsert: true })
    }
    const { data: updated, error } = await (db as any).from('task_attachments').update({
      size: checked.body.byteLength,
      mime_type: checked.mime,
      checksum_sha256: createHash('sha256').update(checked.body).digest('hex'),
      scan_status: checked.scan,
      status: 'ready',
      expires_at: null,
      created_at: new Date().toISOString(),
    }).eq('id', row.id).eq('status', 'uploading').select(COLUMNS).single()
    if (error || !updated) throw dbError(error, 'The upload could not be recorded')
    await announceAdded(db, ctx, updated as TaskAttachmentRow)
    return presentTaskAttachment(updated as TaskAttachmentRow, await userNames(db, [ctx.actorId]))
  } catch (err) {
    await discard()
    throw err
  }
}

/** Abandon a direct upload that never completed (the uploader only). */
export async function cancelTaskAttachmentUpload(ctx: ServiceContext, attachmentId: string): Promise<{ removed: boolean }> {
  if (!ctx.actorId) throw ServiceError.notFound('Upload not found')
  const db = await serviceRoleClient(ctx)
  const row = await loadRow(db, ctx.tenantId, attachmentId)
  if (!row || row.uploaded_by !== ctx.actorId) throw ServiceError.notFound('Upload not found')
  if (row.status !== 'uploading') return { removed: false }
  await (db as any).from('task_attachments').delete().eq('id', row.id).eq('status', 'uploading')
  const provider = await formFilesStorage()
  await provider.delete(FORM_FILES_BUCKET, [row.storage_key]).catch(() => {})
  return { removed: true }
}

/* ── API uploads (REST / MCP / CLI / SDK) ────────────────────────────── */

export interface ApiAddTaskAttachmentInput {
  name?: string
  type?: string
  description?: string
  file_name: string
  size?: number
  content_base64?: string
}

export type ApiAddTaskAttachmentResult = { mode: 'uploaded'; attachment: TaskAttachment } | InitTaskAttachmentResult

/** POST /tasks/{id}/attachments: the content inline (base64), or a direct upload (signed URL, then complete). */
export async function apiAddTaskAttachment(ctx: ServiceContext, taskId: string, input: ApiAddTaskAttachmentInput): Promise<ApiAddTaskAttachmentResult> {
  if (typeof input.content_base64 === 'string' && input.content_base64.length) {
    const clean = input.content_base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) throw ServiceError.validation('content_base64 is not valid base64')
    const bytes = new Uint8Array(Buffer.from(clean, 'base64'))
    const attachment = await addTaskAttachment(ctx, { ...input, task_id: taskId, bytes, declared_size: input.size ?? null })
    return { mode: 'uploaded', attachment }
  }
  if (!input.size) throw ServiceError.validation('Pass content_base64, or size to start a direct upload')
  return initTaskAttachmentUpload(ctx, { ...input, task_id: taskId, size: input.size })
}

/** Complete a direct upload of a task's attachment (REST: …/attachments/{attachmentId}/complete). */
export async function apiCompleteTaskAttachment(ctx: ServiceContext, taskId: string, attachmentId: string): Promise<{ attachment: TaskAttachment }> {
  const db = await serviceRoleClient(ctx)
  const row = await loadRow(db, ctx.tenantId, attachmentId)
  if (!row || row.task_id !== taskId) throw ServiceError.notFound('Upload not found')
  return { attachment: await completeTaskAttachmentUpload(ctx, attachmentId) }
}

/* ── Delete ──────────────────────────────────────────────────────────── */

/**
 * Soft-delete an attachment: its uploader (while they can see the task) or
 * tasks.delete. Refused while the task's form is on legal hold. The cleanup
 * job removes the row and the stored object later.
 */
export async function deleteTaskAttachment(ctx: ServiceContext, taskId: string, attachmentId: string): Promise<{ deleted: true; id: string }> {
  const db = await serviceRoleClient(ctx)
  const access = await taskAttachmentAccess(ctx, db, taskId)
  const row = await loadRow(db, ctx.tenantId, attachmentId)
  if (!row || row.task_id !== taskId || row.status !== 'ready' || row.deleted_at) throw ServiceError.notFound('Attachment not found')
  if (access.held || await formHeld(db, ctx.tenantId, row.form_id)) throw ServiceError.conflict("This attachment is on legal hold (the task's form is held) and can't be deleted")
  if (!canDelete(ctx, access, row)) throw ServiceError.forbidden('Forbidden: only the person who added it, or someone with tasks.delete, can delete this attachment')
  const { error } = await (db as any).from('task_attachments').update({ deleted_at: new Date().toISOString(), deleted_by: ctx.actorId })
    .eq('id', row.id).eq('tenant_id', ctx.tenantId).is('deleted_at', null)
  if (error) {
    if ((error as { code?: string }).code === '55006') throw ServiceError.conflict('This attachment is on legal hold and can\'t be deleted')
    throw dbError(error)
  }
  const [{ writeLifecycleEvent }, { writeAudit }] = await Promise.all([import('@/lib/lifecycle-events'), import('@/lib/audit-log')])
  const meta = { attachment_id: row.id, name: row.name, type: row.type, file_name: row.file_name, size: Number(row.size) }
  await Promise.all([
    writeLifecycleEvent({ supabase: db as any, tenantId: ctx.tenantId, taskId, eventType: 'attachment_deleted', actorId: ctx.actorId, metadata: meta }),
    writeAudit({
      supabase: db as any, tenantId: ctx.tenantId, actorId: ctx.actorId, objectType: 'task', objectId: taskId, action: 'attachment_delete',
      summary: `Deleted attachment "${row.name}" (${row.file_name})`, metadata: { ...meta, via: ctx.source },
    }),
  ])
  return { deleted: true, id: row.id }
}

/* ── Download ────────────────────────────────────────────────────────── */

export const DOWNLOAD_TTL_SECONDS = 300

async function auditDownload(db: AnySupabaseClient, ctx: ServiceContext, row: TaskAttachmentRow) {
  const { writeAudit } = await import('@/lib/audit-log')
  await writeAudit({
    supabase: db as any, tenantId: row.tenant_id, actorId: ctx.actorId, objectType: 'task', objectId: row.task_id, action: 'attachment_download',
    summary: `Downloaded attachment "${row.name}" (${row.file_name})`,
    metadata: { attachment_id: row.id, file_name: row.file_name, size: Number(row.size), via: ctx.source },
  })
}

/**
 * A short-lived signed download link (absolute on APP_URL; 5 minutes) for
 * API / MCP / CLI callers. Without a signing key the plain /attachments/<id>
 * link is returned (it needs a signed-in session).
 */
export async function taskAttachmentDownloadUrl(ctx: ServiceContext, taskId: string, attachmentId: string): Promise<{ url: string; expires_at: string | null; attachment: TaskAttachment }> {
  const db = await serviceRoleClient(ctx)
  await taskAttachmentAccess(ctx, db, taskId)
  const row = await loadRow(db, ctx.tenantId, attachmentId)
  if (!row || row.task_id !== taskId || row.status !== 'ready' || row.deleted_at) throw ServiceError.notFound('Attachment not found')
  const query = signedObjectQuery(FORM_FILES_BUCKET, row.id, DOWNLOAD_TTL_SECONDS)
  await auditDownload(db, ctx, row)
  return {
    url: query ? `${attachmentUrl(row.id)}?${query}` : attachmentUrl(row.id),
    expires_at: query ? new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString() : null,
    attachment: presentTaskAttachment(row),
  }
}

/** Marker on rows /attachments/<id> serves for a task attachment. */
export interface TaskAttachmentDownloadRow extends FormFileRow { task_attachment: TaskAttachmentRow }

/** /attachments/<id>: a ready task attachment as the download route's row (null when it isn't one). */
export async function loadTaskAttachmentDownload(db: AnySupabaseClient, id: string): Promise<TaskAttachmentDownloadRow | null> {
  if (!UUID_RE.test(String(id))) return null
  const { data } = await (db as any).from('task_attachments').select(COLUMNS).eq('id', id).maybeSingle()
  const row = data as TaskAttachmentRow | null
  if (!row || row.status !== 'ready' || row.deleted_at) return null
  return {
    id: row.id, tenant_id: row.tenant_id, storage_key: row.storage_key, name: row.file_name, size: Number(row.size), mime_type: row.mime_type,
    checksum_sha256: row.checksum_sha256, uploaded_by: row.uploaded_by, context_kind: 'task', form_id: null, task_id: row.task_id, workflow_id: null,
    field_key: 'task_attachments', status: 'bound', submission_id: null, created_at: row.created_at, task_attachment: row,
  }
}

export function isTaskAttachmentDownload(row: FormFileRow): row is TaskAttachmentDownloadRow {
  return Boolean((row as Partial<TaskAttachmentDownloadRow>).task_attachment)
}

/** The download route's authorisation of a task attachment (audited when allowed). */
export async function authorizeTaskAttachmentDownload(ctx: ServiceContext, row: TaskAttachmentDownloadRow): Promise<boolean> {
  const allowed = await canViewTaskAttachment(ctx, row.task_attachment)
  if (allowed) await auditDownload(await serviceRoleClient(ctx), ctx, row.task_attachment)
  return allowed
}

/* ── Workflow engine ─────────────────────────────────────────────────── */

/** A task's attachments as workflow values (service; the run's tenant only). */
export async function listTaskAttachmentsForWorkflow(db: AnySupabaseClient, tenantId: string, taskId: string | null | undefined): Promise<TaskAttachment[]> {
  if (!taskId || !UUID_RE.test(String(taskId)) || !UUID_RE.test(tenantId)) return []
  try {
    const { data, error } = await (db as any).from('task_attachments').select(COLUMNS)
      .eq('tenant_id', tenantId).eq('task_id', taskId).eq('status', 'ready').is('deleted_at', null)
      .order('created_at', { ascending: true }).limit(500)
    if (error) return []
    return ((data ?? []) as TaskAttachmentRow[]).map((row) => presentTaskAttachment(row))
  } catch {
    return []
  }
}

/**
 * readWorkflowFile's fallback (lib/services/form-files.ts): a task
 * attachment named by its id (file object, /attachments/<id>) or storage
 * key, of `tenantId` only.
 */
export async function readTaskAttachmentForWorkflow(db: AnySupabaseClient, tenantId: string, target: { id?: string; key?: string }): Promise<WorkflowFileBytes | null> {
  if (!UUID_RE.test(tenantId)) return null
  let query = (db as any).from('task_attachments').select(COLUMNS).eq('tenant_id', tenantId).eq('status', 'ready').is('deleted_at', null)
  if (target.id && UUID_RE.test(target.id)) query = query.eq('id', target.id)
  else if (target.key) query = query.eq('storage_key', target.key)
  else return null
  const { data: row } = await query.maybeSingle()
  if (!row || !String(row.storage_key).startsWith(`${tenantId}/attachment-`)) return null
  const provider = await formFilesStorage()
  const object = await provider.get(FORM_FILES_BUCKET, row.storage_key)
  if (!object) return null
  if (object.size > WORKFLOW_FILE_MAX_BYTES) {
    await object.body.cancel().catch(() => {})
    throw new Error(`"${row.file_name}" is too large for a workflow step (${WORKFLOW_FILE_MAX_BYTES / 1024 / 1024} MB at most)`)
  }
  const bytes = await readAll(object.body)
  return { name: row.file_name, mime_type: row.mime_type, size: bytes.byteLength, bytes }
}

/**
 * "Add task attachment" step: attach bytes a run produced or downloaded to
 * a task of the run's workspace (any status: a step may file a generated
 * document on a completed task). Same content checks as uploads.
 */
export async function addTaskAttachmentFromWorkflow(db: AnySupabaseClient, input: {
  tenantId: string
  taskId: string
  runId: string | null
  fileName: string
  bytes: Uint8Array
  name?: string
  type?: string
  description?: string
}): Promise<TaskAttachment> {
  if (!UUID_RE.test(String(input.taskId))) throw new Error('Add task attachment: the task id is not valid')
  const { data: task } = await (db as any).from('tasks').select('id').eq('id', input.taskId).eq('tenant_id', input.tenantId).is('deleted_at', null).maybeSingle()
  if (!task) throw new Error('Add task attachment: the task was not found in this workspace')
  const fileName = sanitizeFileName(input.fileName)
  const meta = validateAttachmentMeta(input, fileName)
  if (!meta.ok) throw new Error(`Add task attachment: ${Object.values(meta.errors)[0]}`)
  if (!(input.bytes instanceof Uint8Array) || !input.bytes.byteLength) throw new Error('Add task attachment: the file is empty')
  if (input.bytes.byteLength > maxAttachmentBytes()) throw new Error(`Add task attachment: files must be ${Math.round(maxAttachmentBytes() / 1024 / 1024)} MB or smaller`)
  await checkQuota(db, input.tenantId, input.taskId).catch((e) => { throw new Error(`Add task attachment: ${e instanceof Error ? e.message : e}`) })
  const row = await storeVerified(db, {
    tenantId: input.tenantId, taskId: input.taskId, meta: meta.value, fileName, bytes: input.bytes, uploadedBy: null,
    runId: input.runId && UUID_RE.test(input.runId) ? input.runId : null,
  }).catch((e) => { throw new Error(`Add task attachment: ${e instanceof Error ? e.message : e}`) })
  await announceAdded(db, { tenantId: input.tenantId, actorId: null, source: 'workflow' }, row)
  return presentTaskAttachment(row)
}

/* ── Governance / cleanup ────────────────────────────────────────────── */

/** Hard-delete rows (the delete trigger queues their objects) and drain the queue for them now. */
async function hardDelete(db: AnySupabaseClient, rows: Array<Pick<TaskAttachmentRow, 'id' | 'storage_key'>>): Promise<number> {
  if (!rows.length) return 0
  const { error } = await (db as any).from('task_attachments').delete().in('id', rows.map((r) => r.id))
  if (error) throw new Error(`Could not delete task attachments: ${error.message}`)
  const provider = await formFilesStorage()
  const keys = rows.map((r) => r.storage_key)
  await provider.delete(FORM_FILES_BUCKET, keys)
  await (db as any).from('task_attachment_purges').delete().in('storage_key', keys)
  return rows.length
}

/**
 * The form's retention policy reached its cut-off: delete the attachments
 * created before `before` on CLOSED tasks of that form (with their stored
 * objects), unless the form is on legal hold. Open tasks keep theirs.
 */
export async function purgeTaskAttachmentsForForm(db: AnySupabaseClient, input: { tenantId: string; formId: string; before: string; limit?: number }): Promise<{ held: boolean; attachments: number }> {
  if (await formHeld(db, input.tenantId, input.formId)) return { held: true, attachments: 0 }
  const limit = Math.max(1, input.limit ?? 10_000)
  let total = 0
  while (total < limit) {
    const { data, error } = await (db as any).from('task_attachments').select('id, storage_key, task:tasks!inner(status)')
      .eq('tenant_id', input.tenantId).eq('form_id', input.formId).lt('created_at', input.before)
      .in('task.status', ['completed', 'cancelled']).limit(Math.min(100, limit - total))
    if (error) throw new Error(`Could not list task attachments under retention: ${error.message}`)
    const rows = (data ?? []) as Array<{ id: string; storage_key: string }>
    if (!rows.length) break
    total += await hardDelete(db, rows)
    if (rows.length < 100) break
  }
  return { held: false, attachments: total }
}

/**
 * Housekeeping (job `form-files-cleanup`, every 15 minutes): direct uploads
 * never completed, soft-deleted attachments past the retention window
 * (unless their form is on legal hold), and stored objects of rows deleted
 * with their task (the purge queue).
 */
export async function purgeTaskAttachments(options: { supabase?: AnySupabaseClient; limit?: number; deadline?: number } = {}): Promise<{ expired: number; deleted: number; objects: number; held: number }> {
  let db = options.supabase
  if (!db) {
    const { createServiceClient } = await import('@/lib/cron-auth')
    db = createServiceClient() as AnySupabaseClient
  }
  const limit = Math.max(1, Math.min(options.limit ?? 1000, 10_000))
  const totals = { expired: 0, deleted: 0, objects: 0, held: 0 }
  const timeLeft = () => !options.deadline || Date.now() < options.deadline
  const sb = db as any

  // Direct uploads that never completed.
  {
    const { data, error } = await sb.from('task_attachments').select('id, storage_key').eq('status', 'uploading').lt('expires_at', new Date().toISOString()).limit(limit)
    if (error) throw new Error(`Could not list expired task attachment uploads: ${error.message}`)
    totals.expired += await hardDelete(db, (data ?? []) as any[])
  }

  // Soft-deleted past the window, unless held.
  if (timeLeft()) {
    const cutoff = new Date(Date.now() - deletedRetentionDays() * 86_400_000).toISOString()
    const { data, error } = await sb.from('task_attachments').select('id, storage_key, tenant_id, form_id').not('deleted_at', 'is', null).lte('deleted_at', cutoff).limit(limit)
    if (error) throw new Error(`Could not list deleted task attachments: ${error.message}`)
    const rows = (data ?? []) as Array<{ id: string; storage_key: string; tenant_id: string; form_id: string | null }>
    const heldForms = new Set<string>()
    const formIds = [...new Set(rows.map((r) => r.form_id).filter((v): v is string => Boolean(v)))]
    if (formIds.length) {
      const { data: forms } = await sb.from('forms').select('id').in('id', formIds).eq('legal_hold', true)
      for (const f of (forms ?? []) as any[]) heldForms.add(String(f.id))
    }
    const drop = rows.filter((r) => !(r.form_id && heldForms.has(r.form_id)))
    totals.held += rows.length - drop.length
    totals.deleted += await hardDelete(db, drop)
  }

  // Objects of rows deleted with their task (cascade) or elsewhere.
  while (timeLeft() && totals.objects < limit) {
    const { data, error } = await sb.from('task_attachment_purges').select('storage_key').order('queued_at', { ascending: true }).limit(100)
    if (error) throw new Error(`Could not list task attachment purges: ${error.message}`)
    const keys = ((data ?? []) as Array<{ storage_key: string }>).map((r) => r.storage_key)
    if (!keys.length) break
    const provider = await formFilesStorage()
    await provider.delete(FORM_FILES_BUCKET, keys)
    await sb.from('task_attachment_purges').delete().in('storage_key', keys)
    totals.objects += keys.length
    if (keys.length < 100) break
  }
  return totals
}

/** Is `value` (a storage:// ref) a task attachment's object? (The bucket is shared with form attachments.) */
export function isTaskAttachmentRef(value: unknown): boolean {
  const ref = typeof value === 'string' ? parseStorageRef(value) : null
  return Boolean(ref && ref.bucket === FORM_FILES_BUCKET && /^[0-9a-f-]{36}\/attachment-/i.test(ref.key))
}
