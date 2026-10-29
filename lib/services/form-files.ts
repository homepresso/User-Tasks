/**
 * Form attachments: files uploaded into an Attachments field of a task form,
 * a reusable form's page (/f/<id>, the Run dialog, the Test runner's form
 * start) or a designer test run's User Task.
 *
 * Storage: the private `form-files` bucket of the configured
 * StorageProvider, at `<tenant>/<context>-<id>/<uuid>/<ascii name>`.
 * Nothing in the bucket is reachable by URL: /files refuses it, and
 * downloads go through /attachments/<id>, which authorises every request
 * (authorizeFileDownload) and hands out a short-lived signed link.
 *
 * Lifecycle (public.form_files, migration 20261120000000):
 *  - upload: `pending`, bound to the uploader and the upload context
 *    (form / task / test run + field), expires after
 *    FORM_ATTACHMENT_PENDING_HOURS (24).
 *  - submit / save: the field's value is rebuilt from these rows
 *    (resolveAttachmentValues) — a file the caller didn't upload into this
 *    context, or that doesn't exist, is refused; nothing the client sends
 *    about a file (name, size, url, storage ref) is trusted.
 *  - bound to the form submission (submitForm) or the task (completion; a
 *    draft's files are bound by the cleanup job when it finds them in the
 *    task's saved values).
 *  - deleting the task / submission (FKs set NULL) orphans the files;
 *    purgeFormFiles (job `form-files-cleanup`) deletes orphans and expired
 *    pending uploads with their stored objects.
 *
 * Security: the content is verified by magic bytes (lib/forms/attachment-sniff),
 * sizes by the field's config and the instance cap FORM_ATTACHMENT_MAX_MB,
 * dangerous types are refused, SVGs are sanitised, an optional scanner runs
 * (lib/forms/attachment-scan). The workflow engine reads files through
 * readWorkflowFile with the run's tenant (never another tenant's).
 */

import { createHash } from 'node:crypto'
import { getStorageProvider, type StorageProvider } from '@/lib/providers/storage'
import { readAll } from '@/lib/providers/storage/types'
import { formatStorageRef, parseStorageRef } from '@/lib/storage/refs'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import {
  attachmentIds, attachmentLimits, attachmentPath, attachmentsCountKey, attachmentsValueError, BLOCKED_EXTENSIONS, fileExtension,
  isAttachmentFile, isTypeAllowed, kindForExtension, normalizeAttachmentValue, sanitizeFileName, storageSafeName, type AttachmentFile,
} from '@/lib/forms/attachments'
import { verifyAttachmentContent } from '@/lib/forms/attachment-sniff'
import { scanFailOpen, scannerFor, type ScanResult } from '@/lib/forms/attachment-scan'
import { fieldKeyFromLabel, normalizeTaskFields, valueFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { deriveInputFields } from '@/lib/workflow-inputs'
import { isPlainObject } from '@/lib/utils/guards'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- form_files is not in the generated Database types */

export const FORM_FILES_BUCKET = 'form-files'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FILE_COLUMNS = 'id, tenant_id, storage_key, name, size, mime_type, checksum_sha256, uploaded_by, context_kind, form_id, task_id, workflow_id, run_id, field_key, status, submission_id, created_at'

export type UploadContext =
  | { kind: 'form'; formId: string }
  | { kind: 'task'; taskId: string }
  /** A workflow's start form (Run dialog, API starts): its attachments inputs. */
  | { kind: 'start'; workflowId: string }
  | { kind: 'test'; workflowId: string }

export interface FormFileRow {
  id: string
  tenant_id: string
  storage_key: string
  name: string
  size: number
  mime_type: string
  checksum_sha256: string
  uploaded_by: string | null
  context_kind: 'form' | 'task' | 'start' | 'test'
  form_id: string | null
  task_id: string | null
  workflow_id: string | null
  field_key: string
  status: 'uploading' | 'pending' | 'bound' | 'orphaned'
  submission_id: string | null
  created_at: string
}

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  const n = raw === undefined || raw === '' ? NaN : Number(raw)
  return Number.isFinite(n) && n >= min ? Math.min(n, max) : fallback
}

/** Largest single attachment on this instance (FORM_ATTACHMENT_MAX_MB, default 25, at most 45). */
export function instanceMaxMb(): number {
  return envNumber('FORM_ATTACHMENT_MAX_MB', 25, 0.1, 45)
}

/** Hours an upload stays pending before housekeeping removes it (FORM_ATTACHMENT_PENDING_HOURS, default 24). */
export function pendingTtlHours(): number {
  return envNumber('FORM_ATTACHMENT_PENDING_HOURS', 24, 1, 24 * 14)
}

/**
 * Largest request body the streamed (through-the-app) upload path takes:
 * FORM_UPLOAD_MAX_BODY_MB (default 50; also next.config's
 * proxyClientMaxBodySize), capped at 4 MB on Vercel, whose functions refuse
 * bodies over ~4.5 MB. Direct-to-storage uploads have no such limit.
 */
export function streamedUploadMaxBytes(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.FORM_UPLOAD_MAX_BODY_MB)
  let mb = Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 1024) : 50
  if (env.VERCEL) mb = Math.min(mb, 4)
  // Room for the multipart envelope.
  return Math.floor(mb * 1024 * 1024) - 64 * 1024
}

function streamedTooLarge(): ServiceError {
  const mb = Math.round((streamedUploadMaxBytes() + 64 * 1024) / 1024 / 1024 * 10) / 10
  return new ServiceError('validation_error', `This file is larger than the server's upload limit (${mb} MB). Use a storage provider with direct uploads (Supabase, S3 / MinIO, Azure Blob, Google Cloud Storage)${process.env.VERCEL ? '' : ' or raise FORM_UPLOAD_MAX_BODY_MB (and the reverse proxy\'s body limit)'}`, { status: 413 })
}

/** Pending uploads one person may hold in a workspace (FORM_ATTACHMENT_PENDING_LIMIT, default 200). */
function pendingLimit(): number {
  return Math.floor(envNumber('FORM_ATTACHMENT_PENDING_LIMIT', 200, 1, 100_000))
}

let ensured: Promise<void> | null = null

async function storage(): Promise<StorageProvider> {
  const provider = await getStorageProvider()
  // Supabase: the migration created the private bucket; local: a directory;
  // cloud stores: created where the credentials allow, else configured.
  ensured ??= provider.ensureBucket(FORM_FILES_BUCKET, { public: false }).catch(() => { ensured = null })
  await ensured
  return provider
}

/** The authorised URL of a file (absolute on APP_URL when configured). */
export function attachmentUrl(id: string): string {
  const base = (configuredAppUrl() ?? '').trim().replace(/\/+$/, '')
  return `${base}${attachmentPath(id)}`
}

/** A row as the value object stored in task_data / form values. */
export function presentFormFile(row: FormFileRow): AttachmentFile {
  return {
    id: row.id,
    name: row.name,
    size: Number(row.size),
    mime_type: row.mime_type,
    url: attachmentUrl(row.id),
    storage_ref: formatStorageRef(FORM_FILES_BUCKET, row.storage_key),
    uploaded_by: row.uploaded_by,
    uploaded_at: Number.isNaN(new Date(row.created_at).getTime()) ? String(row.created_at ?? '') : new Date(row.created_at).toISOString(),
    checksum_sha256: row.checksum_sha256,
  }
}

/* ── Upload ──────────────────────────────────────────────────────────── */

function attachmentField(fields: TaskFieldDef[], fieldKey: string, where: string): TaskFieldDef {
  const field = fields.find((f) => f.key === fieldKey && f.type === 'attachments')
  if (!field) throw ServiceError.notFound(`${where} has no attachments field "${String(fieldKey).slice(0, 64)}"`)
  if (field.read_only) throw ServiceError.forbidden(`"${field.label}" is read-only`)
  return field
}

/** The field the upload goes to, authorised for the caller in their workspace. */
async function resolveUploadField(ctx: ServiceContext, db: AnySupabaseClient, context: UploadContext, fieldKey: string): Promise<{ field: TaskFieldDef; contextId: string }> {
  if (context.kind === 'form') {
    requirePerm(ctx, 'forms.submit')
    if (!UUID_RE.test(context.formId)) throw ServiceError.notFound('Form not found')
    const { data: form, error } = await (db as any).from('forms').select('id, fields').eq('id', context.formId).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (error) throw dbError(error)
    if (!form) throw ServiceError.notFound('Form not found')
    return { field: attachmentField(normalizeTaskFields(form.fields), fieldKey, 'The form'), contextId: form.id }
  }
  if (context.kind === 'task') {
    const task = await loadActionableTask(ctx, db, context.taskId)
    return { field: attachmentField(normalizeTaskFields(task.metadata?.fields), fieldKey, "The task's form"), contextId: task.id }
  }
  if (context.kind === 'start') {
    // A workflow's start form, as runs see it (published version, else the draft): workflows.activate starts runs.
    requirePerm(ctx, 'workflows.activate')
    const def = await loadStartDefinition(ctx, db, context.workflowId, false)
    const field = startFormAttachmentField(def, fieldKey)
    if (!field) throw ServiceError.notFound(`The workflow's start form has no attachments input "${String(fieldKey).slice(0, 64)}"`)
    return { field, contextId: def.id }
  }
  // A designer test run (Save & Test): the workflow's draft (workflows.edit) —
  // its start form, or a User Task's form.
  requirePerm(ctx, 'workflows.edit')
  if (!UUID_RE.test(context.workflowId)) throw ServiceError.notFound('Workflow not found')
  const { data: workflow, error } = await (db as any).from('workflows').select('id, nodes').eq('id', context.workflowId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!workflow) throw ServiceError.notFound('Workflow not found')
  const startField = startFormAttachmentField(await loadStartDefinition(ctx, db, context.workflowId, true), fieldKey)
  if (startField) return { field: startField, contextId: workflow.id }
  const { resolveRuntimeForm } = await import('./forms')
  for (const node of (Array.isArray(workflow.nodes) ? workflow.nodes : []) as any[]) {
    if (node?.type !== 'user_task' || !isPlainObject(node.config)) continue
    const form = await resolveRuntimeForm(db, ctx.tenantId, node.config).catch(() => null)
    const field = form?.fields.find((f) => f.key === fieldKey && f.type === 'attachments')
    if (field && !field.read_only) return { field, contextId: workflow.id }
  }
  throw ServiceError.notFound(`No User Task of this workflow has an attachments field "${String(fieldKey).slice(0, 64)}"`)
}

interface StartDefinition { id: string; nodes: unknown; user_variables: unknown }

async function loadStartDefinition(ctx: ServiceContext, db: AnySupabaseClient, workflowId: string, draft: boolean): Promise<StartDefinition> {
  if (!UUID_RE.test(workflowId)) throw ServiceError.notFound('Workflow not found')
  const { data: workflow, error } = await (db as any).from('workflows')
    .select('id, nodes, user_variables, published_version_id').eq('id', workflowId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!workflow) throw ServiceError.notFound('Workflow not found')
  if (!draft && workflow.published_version_id) {
    const { data: version } = await (db as any).from('workflow_versions').select('nodes, user_variables').eq('id', workflow.published_version_id).maybeSingle()
    if (version) return { id: workflow.id, nodes: version.nodes, user_variables: version.user_variables }
  }
  return { id: workflow.id, nodes: workflow.nodes, user_variables: workflow.user_variables }
}

/**
 * The start form's attachments input named `key` (a designer key or the
 * variable name), as a field keyed by the VARIABLE name — what the run's
 * variables and the upload records use.
 */
function startFormAttachmentField(def: StartDefinition, key: string): TaskFieldDef | null {
  return startAttachmentFields(def.user_variables).find((f) => f.key === key || fieldKeyFromLabel(f.key) === key) ?? null
}

/** Attachments inputs of a workflow (its user_variables) as fields keyed by variable name. */
export function startAttachmentFields(userVariables: unknown): TaskFieldDef[] {
  return deriveInputFields(userVariables).filter((f) => f.type === 'attachments').map((f) => ({
    key: f.key, label: f.label, type: 'attachments' as const, ...(f.required ? { required: true } : {}), ...(f.attachments && Object.keys(f.attachments).length ? { attachments: f.attachments } : {}),
  }))
}

/**
 * An open task the caller may fill in: tasks.complete and the task-action
 * rule's people (assignee, collaborator, team member, a manager of the
 * assignee, tasks.complete_any / tasks.manage_queue).
 */
async function loadActionableTask(ctx: ServiceContext, db: AnySupabaseClient, taskId: string): Promise<Record<string, any>> {
  requirePerm(ctx, 'tasks.complete')
  if (!UUID_RE.test(taskId)) throw ServiceError.notFound('Task not found')
  const { data: task, error } = await (db as any).from('tasks')
    .select('id, tenant_id, status, is_workflow_task, event_id, assignee_id, assigned_team_id, assignment_mode, deleted_at, metadata')
    .eq('id', taskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
  if (error) throw dbError(error)
  if (!task) throw ServiceError.notFound('Task not found')
  if (task.status === 'completed' || task.status === 'cancelled') throw ServiceError.conflict('This task is closed')
  if (!ctx.actorId) {
    if (!hasPerm(ctx, 'tasks.complete_any')) throw ServiceError.forbidden('Forbidden: you cannot act on that task')
    return task
  }
  const { loadTaskActorFacts } = await import('@/lib/task-authz')
  const facts = await loadTaskActorFacts(db, task, ctx.actorId)
  const allowed = facts.isAssignee || facts.isTeamMember || Boolean(facts.managedAssigneeId)
    || hasPerm(ctx, 'tasks.complete_any') || (!task.is_workflow_task && hasPerm(ctx, 'tasks.manage_queue'))
  if (!allowed) throw ServiceError.forbidden('Forbidden: you cannot act on that task')
  return task
}

export interface UploadFormFileInput {
  context: UploadContext
  field_key: string
  /** Original file name (sanitised here). */
  name: string
  bytes: Uint8Array
  /** Size the browser said it sent: a mismatch means the body was cut short. */
  declared_size?: number | null
}

async function rateLimited(ctx: ServiceContext) {
  const { rateLimit } = await import('@/lib/rate-limit')
  const hit = await rateLimit(`form-files:${ctx.tenantId}:${ctx.actorId ?? 'tenant'}`, { max: 120, windowMs: 60_000 })
  if (!hit.ok) throw new ServiceError('rate_limited', 'Too many uploads — wait a moment and try again', { details: { retry_after_ms: hit.retryAfterMs } })
}

function contextColumns(context: UploadContext, contextId: string) {
  return context.kind === 'form' ? { form_id: contextId } : context.kind === 'task' ? { task_id: contextId } : { workflow_id: contextId }
}

function tooLarge(maxBytes: number): ServiceError {
  return new ServiceError('validation_error', `Files must be ${Math.round(maxBytes / 1024 / 1024 * 10) / 10} MB or smaller`, { status: 413 })
}

/** Uploads not yet submitted: per person in the workspace, and per field of this context. */
async function checkUploadQuota(ctx: ServiceContext, db: AnySupabaseClient, context: UploadContext, contextId: string, field: TaskFieldDef, maxFiles: number) {
  const since = new Date(Date.now() - pendingTtlHours() * 3_600_000).toISOString()
  const { count: pendingCount } = await (db as any).from('form_files').select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId).eq('uploaded_by', ctx.actorId).in('status', ['uploading', 'pending']).gte('created_at', since)
  if ((pendingCount ?? 0) >= pendingLimit()) throw new ServiceError('rate_limited', 'You have too many unsubmitted uploads — submit or remove some first')
  const [contextColumn, contextValue] = Object.entries(contextColumns(context, contextId))[0]
  const { count: fieldCount } = await (db as any).from('form_files').select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId).eq('uploaded_by', ctx.actorId).in('status', ['uploading', 'pending']).eq('field_key', field.key)
    .eq(contextColumn, contextValue).gte('created_at', since)
  if ((fieldCount ?? 0) >= maxFiles + 10) throw new ServiceError('rate_limited', `Too many uploads for "${field.label}" — remove some first`)
}

/**
 * The checks every upload's bytes pass, whichever way they arrived: size,
 * content by magic bytes against the name and the field's types, SVG
 * sanitising (the bytes to store change), the optional virus scan.
 */
async function verifyUploadBytes(field: TaskFieldDef, name: string, bytes: Uint8Array, maxFileBytes: number): Promise<{ body: Uint8Array; mime: string; scan: ScanResult['status']; rewritten: boolean }> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw ServiceError.validation('The file is empty')
  if (bytes.byteLength > maxFileBytes) throw tooLarge(maxFileBytes)
  const verified = verifyAttachmentContent({ name, bytes, config: field.attachments })
  if (!verified.ok) throw new ServiceError('validation_error', verified.reason, { status: 415 })
  let body = bytes
  let rewritten = false
  if (verified.kind?.id === 'svg') {
    const { sanitizeSvg } = await import('@/lib/sanitize-svg')
    const text = new TextDecoder().decode(bytes).replace(/^﻿?\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?/i, '')
    const clean = sanitizeSvg(text)
    if (!clean) throw new ServiceError('validation_error', 'That SVG could not be used (it is not a valid, safe SVG image)', { status: 415 })
    body = new TextEncoder().encode(clean)
    rewritten = true
  }
  const scan = await scannerFor().scan(body, name)
  if (scan.status === 'infected') throw new ServiceError('validation_error', `The file was rejected by the virus scanner${scan.detail ? ` (${scan.detail.slice(0, 80)})` : ''}`, { status: 422 })
  if (scan.status === 'error' && !scanFailOpen()) {
    console.warn('[form-files] scan failed:', scan.detail)
    throw new ServiceError('internal', 'The file could not be scanned for viruses — try again later', { status: 503 })
  }
  return { body, mime: verified.mime, scan: scan.status, rewritten }
}

function storageKeyFor(ctx: ServiceContext, context: UploadContext, contextId: string, id: string, name: string): string {
  return `${ctx.tenantId}/${context.kind}-${contextId}/${id}/${storageSafeName(name)}`
}

/**
 * Store one uploaded file (the bytes came through the app) as a pending
 * attachment of a field and return its value object. Signed-in people only
 * (the uploader is who may use it). Small files and providers without
 * direct uploads (local disk) take this path; large files go straight to
 * storage (initDirectUpload / completeDirectUpload).
 */
export async function uploadFormFile(ctx: ServiceContext, input: UploadFormFileInput): Promise<AttachmentFile> {
  if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: uploads need a signed-in person')
  const db = await serviceRoleClient(ctx)
  const { field, contextId } = await resolveUploadField(ctx, db, input.context, String(input.field_key ?? ''))
  await rateLimited(ctx)

  const bytes = input.bytes
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw ServiceError.validation('The file is empty')
  const limits = attachmentLimits(field.attachments, { required: field.required, instanceMaxMb: instanceMaxMb() })
  if (bytes.byteLength > limits.maxFileBytes) throw tooLarge(limits.maxFileBytes)
  if (input.declared_size !== undefined && input.declared_size !== null && Number(input.declared_size) !== bytes.byteLength) {
    // A proxy in front of the app (or its own body buffer) may have cut the body short.
    if (Number(input.declared_size) > streamedUploadMaxBytes()) throw streamedTooLarge()
    throw ServiceError.validation('The upload was incomplete — try again')
  }
  if (bytes.byteLength > streamedUploadMaxBytes()) throw streamedTooLarge()
  const name = sanitizeFileName(input.name)
  const checked = await verifyUploadBytes(field, name, bytes, limits.maxFileBytes)
  await checkUploadQuota(ctx, db, input.context, contextId, field, limits.maxFiles)

  const id = crypto.randomUUID()
  const key = storageKeyFor(ctx, input.context, contextId, id, name)
  const provider = await storage()
  try {
    await provider.put(FORM_FILES_BUCKET, key, checked.body, { contentType: checked.mime, cacheControl: 'private, no-store' })
  } catch (error) {
    console.error('[form-files] store failed:', error instanceof Error ? error.message : error)
    throw new ServiceError('internal', 'The file could not be stored — try again')
  }
  const row = {
    id,
    tenant_id: ctx.tenantId,
    storage_key: key,
    name,
    size: checked.body.byteLength,
    mime_type: checked.mime,
    checksum_sha256: createHash('sha256').update(checked.body).digest('hex'),
    uploaded_by: ctx.actorId,
    context_kind: input.context.kind,
    ...contextColumns(input.context, contextId),
    field_key: field.key,
    status: 'pending',
    scan_status: checked.scan,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + pendingTtlHours() * 3_600_000).toISOString(),
  }
  const { data: inserted, error } = await (db as any).from('form_files').insert(row).select(FILE_COLUMNS).single()
  if (error || !inserted) {
    await provider.delete(FORM_FILES_BUCKET, [key]).catch(() => {})
    throw dbError(error, 'The file could not be recorded')
  }
  return presentFormFile(inserted as FormFileRow)
}

/* ── Direct-to-storage uploads ───────────────────────────────────────── */

/** How long a direct upload may take between init and complete (FORM_ATTACHMENT_UPLOAD_WINDOW_MINUTES, default 15). */
export function uploadWindowMinutes(): number {
  return Math.floor(envNumber('FORM_ATTACHMENT_UPLOAD_WINDOW_MINUTES', 15, 1, 120))
}

export interface InitDirectUploadInput {
  context: UploadContext
  field_key: string
  name: string
  /** Size of the file the browser will send. */
  size: number
}

export type InitDirectUploadResult =
  | { mode: 'direct'; file_id: string; upload: { url: string; method: 'PUT'; headers: Record<string, string> }; expires_at: string }
  /** Send the file through the app (POST …/files), at most `max_bytes`. */
  | { mode: 'server'; max_bytes: number }

/**
 * Start a direct upload: the same authorisation, limits and quota as the
 * server path, checked on the declared name and size; an `uploading`
 * form_files row (uploader, context, field, the window's expiry) and a
 * signed URL from the storage provider for exactly that object. Providers
 * without signed uploads answer `{ mode: 'server' }` (send it through the app).
 */
export async function initDirectUpload(ctx: ServiceContext, input: InitDirectUploadInput): Promise<InitDirectUploadResult> {
  if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: uploads need a signed-in person')
  const db = await serviceRoleClient(ctx)
  const { field, contextId } = await resolveUploadField(ctx, db, input.context, String(input.field_key ?? ''))
  await rateLimited(ctx)
  const size = Number(input.size)
  if (!Number.isInteger(size) || size <= 0) throw ServiceError.validation('The file is empty')
  const limits = attachmentLimits(field.attachments, { required: field.required, instanceMaxMb: instanceMaxMb() })
  if (size > limits.maxFileBytes) throw tooLarge(limits.maxFileBytes)
  const name = sanitizeFileName(input.name)
  const ext = fileExtension(name)
  if (BLOCKED_EXTENSIONS.has(ext) || !isTypeAllowed(field.attachments, ext, kindForExtension(ext))) {
    throw new ServiceError('validation_error', ext ? `.${ext} files are not allowed here` : 'Files without an extension are not allowed here', { status: 415 })
  }
  await checkUploadQuota(ctx, db, input.context, contextId, field, limits.maxFiles)

  const provider = await storage()
  const server = (): InitDirectUploadResult => {
    if (size > streamedUploadMaxBytes()) throw streamedTooLarge()
    return { mode: 'server', max_bytes: streamedUploadMaxBytes() }
  }
  if (typeof provider.createUploadUrl !== 'function') return server()
  const id = crypto.randomUUID()
  const key = storageKeyFor(ctx, input.context, contextId, id, name)
  const contentType = kindForExtension(ext)?.mime ?? 'application/octet-stream'
  const expiresAt = new Date(Date.now() + uploadWindowMinutes() * 60_000).toISOString()
  const { error } = await (db as any).from('form_files').insert({
    id,
    tenant_id: ctx.tenantId,
    storage_key: key,
    name,
    size,
    mime_type: contentType,
    checksum_sha256: '0'.repeat(64),
    uploaded_by: ctx.actorId,
    context_kind: input.context.kind,
    ...contextColumns(input.context, contextId),
    field_key: field.key,
    status: 'uploading',
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
  })
  if (error) throw dbError(error, 'The upload could not be started')
  try {
    const upload = await provider.createUploadUrl(FORM_FILES_BUCKET, key, { contentType, ttlSeconds: uploadWindowMinutes() * 60 })
    return { mode: 'direct', file_id: id, upload, expires_at: expiresAt }
  } catch (err) {
    await (db as any).from('form_files').delete().eq('id', id)
    console.warn('[form-files] signed upload URL failed, using the server path:', err instanceof Error ? err.message : err)
    return server()
  }
}

/**
 * Finish a direct upload: the uploader only, within the upload window. The
 * object is read back from storage and checked like a server upload (size
 * against the declared size and the limits, content by magic bytes, blocked
 * types, SVG sanitised — the object rewritten —, checksum, optional scan).
 * Pass: the row becomes `pending` with the verified facts. Fail: the object
 * and the row are deleted and the reason returned as an error.
 */
export async function completeDirectUpload(ctx: ServiceContext, fileId: string): Promise<AttachmentFile> {
  if (!ctx.actorId || !UUID_RE.test(String(fileId))) throw ServiceError.notFound('Upload not found')
  const db = await serviceRoleClient(ctx)
  const { data: row } = await (db as any).from('form_files').select(`${FILE_COLUMNS}, expires_at`).eq('id', fileId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (!row || row.uploaded_by !== ctx.actorId) throw ServiceError.notFound('Upload not found')
  if (row.status !== 'uploading') {
    if (row.status === 'pending') return presentFormFile(row as FormFileRow)
    throw ServiceError.conflict('This upload is already finished')
  }
  const provider = await storage()
  const discard = async () => {
    await provider.delete(FORM_FILES_BUCKET, [row.storage_key]).catch(() => {})
    await (db as any).from('form_files').delete().eq('id', row.id)
  }
  if (!row.expires_at || new Date(row.expires_at).getTime() < Date.now()) {
    await discard()
    throw new ServiceError('validation_error', 'The upload took too long — try again', { status: 410 })
  }
  try {
    // Re-authorise the context (the task may have closed, permissions changed).
    const context: UploadContext = row.context_kind === 'form' ? { kind: 'form', formId: row.form_id } : row.context_kind === 'task' ? { kind: 'task', taskId: row.task_id }
      : row.context_kind === 'start' ? { kind: 'start', workflowId: row.workflow_id } : { kind: 'test', workflowId: row.workflow_id }
    if (!context.kind || !(context as Record<string, unknown>)[context.kind === 'form' ? 'formId' : context.kind === 'task' ? 'taskId' : 'workflowId']) throw ServiceError.notFound('Upload not found')
    const { field } = await resolveUploadField(ctx, db, context, row.field_key)
    const limits = attachmentLimits(field.attachments, { required: field.required, instanceMaxMb: instanceMaxMb() })
    const head = await provider.head(FORM_FILES_BUCKET, row.storage_key)
    if (!head) throw ServiceError.validation('The file did not arrive — try again')
    if (head.size > limits.maxFileBytes) throw tooLarge(limits.maxFileBytes)
    const object = await provider.get(FORM_FILES_BUCKET, row.storage_key)
    if (!object) throw ServiceError.validation('The file did not arrive — try again')
    const bytes = await readAll(object.body)
    if (bytes.byteLength !== Number(row.size)) throw ServiceError.validation('The uploaded file is not the one that was announced — try again')
    const checked = await verifyUploadBytes(field, row.name, bytes, limits.maxFileBytes)
    // Store the verified type (and sanitised bytes) whatever the browser sent.
    if (checked.rewritten || head.contentType !== checked.mime) {
      await provider.put(FORM_FILES_BUCKET, row.storage_key, checked.body, { contentType: checked.mime, cacheControl: 'private, no-store', upsert: true })
    }
    const { data: updated, error } = await (db as any).from('form_files').update({
      size: checked.body.byteLength,
      mime_type: checked.mime,
      checksum_sha256: createHash('sha256').update(checked.body).digest('hex'),
      scan_status: checked.scan,
      status: 'pending',
      expires_at: new Date(Date.now() + pendingTtlHours() * 3_600_000).toISOString(),
    }).eq('id', row.id).eq('status', 'uploading').select(FILE_COLUMNS).single()
    if (error || !updated) throw dbError(error, 'The upload could not be recorded')
    return presentFormFile(updated as FormFileRow)
  } catch (err) {
    await discard()
    throw err
  }
}

/**
 * Remove a pending upload (the × on a file before submitting): the uploader
 * only. A task draft that already saved the file keeps it (the cleanup job
 * removes it once no saved value refers to it).
 */
export async function removePendingFormFile(ctx: ServiceContext, fileId: string): Promise<{ removed: boolean }> {
  if (!ctx.actorId || !UUID_RE.test(fileId)) throw ServiceError.notFound('File not found')
  const db = await serviceRoleClient(ctx)
  const { data: row } = await (db as any).from('form_files').select(FILE_COLUMNS).eq('id', fileId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (!row || row.uploaded_by !== ctx.actorId) throw ServiceError.notFound('File not found')
  if (row.status !== 'pending' && row.status !== 'uploading') return { removed: false }
  if (row.task_id && await taskReferences(db, ctx.tenantId, row.task_id, row.id)) return { removed: false }
  await deleteFormFileRows(db, [row as FormFileRow])
  return { removed: true }
}

/* ── Submit / save: the value rebuilt from the server's records ─────── */

export type FileValueContext =
  | { kind: 'form'; formId: string; actorId: string | null }
  | { kind: 'task'; taskId: string }
  | { kind: 'start'; workflowId: string; actorId: string | null }

/**
 * Rebuild every attachments field's value from form_files: each id must be
 * a file of this workspace and field, uploaded into this context (a
 * reusable form: by the submitter, still pending; a task: for this task).
 * Returns the rebuilt values plus `<key>_count`, or errors per field.
 * `keys` limits the fields (draft saves send some fields only).
 */
export async function resolveAttachmentValues(
  db: AnySupabaseClient,
  tenantId: string,
  fields: TaskFieldDef[],
  values: Record<string, unknown>,
  context: FileValueContext | null,
  keys?: string[],
): Promise<{ errors: Record<string, string>; values: Record<string, unknown> }> {
  const errors: Record<string, string> = {}
  const out: Record<string, unknown> = {}
  const targets = valueFields(fields).filter((f) => f.type === 'attachments' && (!keys || keys.includes(f.key)))
  if (!targets.length) return { errors, values: out }
  const wanted = new Map<string, string[]>()
  for (const field of targets) wanted.set(field.key, attachmentIds(values[field.key]))
  const allIds = [...new Set([...wanted.values()].flat())]
  const rows = new Map<string, FormFileRow>()
  if (allIds.length) {
    if (!context) {
      for (const field of targets) if ((wanted.get(field.key) ?? []).length) errors[field.key] = `${field.label}: files can't be attached here`
      return { errors, values: out }
    }
    const { data, error } = await (db as any).from('form_files').select(FILE_COLUMNS).eq('tenant_id', tenantId).in('id', allIds)
    if (error) throw dbError(error)
    for (const row of (data ?? []) as FormFileRow[]) rows.set(String(row.id).toLowerCase(), row)
  }
  for (const field of targets) {
    const files: AttachmentFile[] = []
    let problem: string | null = null
    for (const id of wanted.get(field.key) ?? []) {
      const row = rows.get(id)
      const belongs = row && row.field_key === field.key && (row.status === 'pending' || row.status === 'bound') && (
        context!.kind === 'form'
          ? row.context_kind === 'form' && row.form_id === context!.formId && row.status === 'pending' && row.uploaded_by !== null && row.uploaded_by === context!.actorId
          : context!.kind === 'start'
            ? row.context_kind === 'start' && row.workflow_id === context!.workflowId && row.status === 'pending' && row.uploaded_by !== null && row.uploaded_by === context!.actorId
            : row.context_kind === 'task' && row.task_id === context!.taskId
      )
      if (!belongs) { problem = `${field.label}: a file is no longer available — remove it and upload it again`; break }
      files.push(presentFormFile(row!))
    }
    // The raw value must be a list of file objects (a forged string or number is refused).
    const raw = values[field.key]
    const rawList = Array.isArray(raw) ? raw : raw === null || raw === undefined ? [] : [raw]
    if (!problem && normalizeAttachmentValue(rawList).length !== rawList.length) {
      problem = `${field.label} has an invalid value`
    }
    problem ??= files.length ? attachmentsValueError(field, files) : null
    if (problem) { errors[field.key] = problem; continue }
    out[field.key] = files
    out[attachmentsCountKey(field.key)] = files.length
  }
  return { errors, values: out }
}

/** Ids of every file in the attachments fields of a value set. */
export function attachmentIdsIn(fields: TaskFieldDef[], values: Record<string, unknown> | null | undefined): string[] {
  const ids: string[] = []
  for (const field of valueFields(fields)) if (field.type === 'attachments') ids.push(...attachmentIds(values?.[field.key]))
  return [...new Set(ids)]
}

/** Bind files to a stored submission and / or task (never throws). */
export async function bindFormFiles(db: AnySupabaseClient, tenantId: string, ids: string[], binding: { submissionId?: string | null; taskId?: string | null }): Promise<void> {
  if (!ids.length) return
  try {
    const patch: Record<string, unknown> = { status: 'bound', bound_at: new Date().toISOString(), expires_at: null }
    if (binding.submissionId) patch.submission_id = binding.submissionId
    let query = (db as any).from('form_files').update(patch).eq('tenant_id', tenantId).in('id', ids).in('status', ['pending', 'bound'])
    // A task's files stay the task's: only rows of that task (or form rows being submitted) are touched.
    if (binding.taskId) query = query.eq('task_id', binding.taskId)
    const { error } = await query
    if (error) console.warn('[form-files] bind failed:', error.message)
  } catch (error) {
    console.warn('[form-files] bind failed:', error instanceof Error ? error.message : error)
  }
}

/* ── Download ────────────────────────────────────────────────────────── */

export async function loadFormFile(db: AnySupabaseClient, fileId: string): Promise<FormFileRow | null> {
  if (!UUID_RE.test(fileId)) return null
  const { data } = await (db as any).from('form_files').select(FILE_COLUMNS).eq('id', fileId).maybeSingle()
  return (data as FormFileRow | null) ?? null
}

/**
 * May the caller (signed in, acting in the file's workspace) download it?
 *  - the uploader, always (a pending upload: only them);
 *  - a task's file: people who can see the task (assignee, collaborators,
 *    team members, the manager chain) and tasks.view_all / tasks.manage_queue;
 *  - a submission's file: its submitter and forms.edit.
 */
export async function authorizeFileDownload(ctx: ServiceContext, row: FormFileRow): Promise<boolean> {
  if (row.tenant_id !== ctx.tenantId || (row.status !== 'pending' && row.status !== 'bound') || !ctx.actorId) return false
  if (row.uploaded_by && row.uploaded_by === ctx.actorId) return true
  if (row.status === 'pending' && row.context_kind !== 'task') return false
  const db = await serviceRoleClient(ctx)
  if (row.task_id) {
    const { data: task } = await (db as any).from('tasks').select('id').eq('id', row.task_id).eq('tenant_id', row.tenant_id).is('deleted_at', null).maybeSingle()
    if (task) {
      if (hasPerm(ctx, 'tasks.view_all') || hasPerm(ctx, 'tasks.manage_queue')) return true
      const { canUserSeeTask } = await import('@/lib/task-authz')
      if (await canUserSeeTask(db, row.tenant_id, ctx.actorId, row.task_id)) return true
    }
  }
  if (row.submission_id) {
    if (hasPerm(ctx, 'forms.edit')) return true
    const { data: submission } = await (db as any).from('form_submissions').select('submitted_by').eq('id', row.submission_id).eq('tenant_id', row.tenant_id).maybeSingle()
    if (submission?.submitted_by && submission.submitted_by === ctx.actorId) return true
  }
  return false
}

/** The stored object (stream + metadata), or null when it is gone. */
export async function openFormFileObject(row: FormFileRow) {
  const provider = await storage()
  return provider.get(FORM_FILES_BUCKET, row.storage_key)
}

/* ── Workflow engine ─────────────────────────────────────────────────── */

export interface WorkflowFileBytes {
  name: string
  mime_type: string
  size: number
  bytes: Uint8Array
}

const ATTACHMENT_URL_RE = /(?:^|\/)attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i

/**
 * The form file a workflow value points at: a file object (`id`), its
 * authorised URL (/attachments/<id>) or its `storage://form-files/…`
 * reference. Null when the value isn't a form file.
 */
export function formFileTarget(value: unknown): { id?: string; key?: string } | null {
  if (isAttachmentFile(value)) return { id: String(value.id).toLowerCase() }
  if (typeof value !== 'string') return null
  const ref = parseStorageRef(value)
  if (ref?.bucket === FORM_FILES_BUCKET) return { key: ref.key }
  if (value.startsWith('storage://')) return null
  const match = ATTACHMENT_URL_RE.exec(value.split('#')[0])
  if (match && (value.startsWith('/') || /^https?:\/\//i.test(value))) {
    // Only this app's URLs (or relative ones) name our files.
    if (/^https?:\/\//i.test(value)) {
      const app = (configuredAppUrl() ?? '').trim()
      try { if (!app || new URL(value).origin !== new URL(app).origin) return null } catch { return null }
    }
    return { id: match[1].toLowerCase() }
  }
  return null
}

/** Largest file a workflow step reads into memory. */
export const WORKFLOW_FILE_MAX_BYTES = 50 * 1024 * 1024

/**
 * Read a form file for a workflow run of `tenantId` (service): only that
 * workspace's files — a value naming another tenant's file is "not found".
 */
export async function readWorkflowFile(db: AnySupabaseClient, tenantId: string, value: unknown): Promise<WorkflowFileBytes | null> {
  const target = formFileTarget(value)
  if (!target || !UUID_RE.test(tenantId)) return null
  let query = (db as any).from('form_files').select(FILE_COLUMNS).eq('tenant_id', tenantId).in('status', ['pending', 'bound'])
  query = target.id ? query.eq('id', target.id) : query.eq('storage_key', target.key)
  const { data: row } = await query.maybeSingle()
  if (!row || !String(row.storage_key).startsWith(`${tenantId}/`)) return null
  const provider = await storage()
  const object = await provider.get(FORM_FILES_BUCKET, row.storage_key)
  if (!object) return null
  if (object.size > WORKFLOW_FILE_MAX_BYTES) {
    await object.body.cancel().catch(() => {})
    throw new Error(`"${row.name}" is too large for a workflow step (${WORKFLOW_FILE_MAX_BYTES / 1024 / 1024} MB at most)`)
  }
  const bytes = await readAll(object.body)
  return { name: row.name, mime_type: row.mime_type, size: bytes.byteLength, bytes }
}

/* ── Cleanup ─────────────────────────────────────────────────────────── */

async function taskReferences(db: AnySupabaseClient, tenantId: string, taskId: string, fileId: string): Promise<boolean> {
  const { data: task } = await (db as any).from('tasks').select('metadata').eq('id', taskId).eq('tenant_id', tenantId).maybeSingle()
  const meta = isPlainObject(task?.metadata) ? task!.metadata as Record<string, any> : {}
  const values = isPlainObject(meta.template_values) ? meta.template_values : {}
  return attachmentIdsIn(normalizeTaskFields(meta.fields), values).includes(fileId.toLowerCase())
}

async function deleteFormFileRows(db: AnySupabaseClient, rows: FormFileRow[]): Promise<number> {
  if (!rows.length) return 0
  const provider = await storage()
  await provider.delete(FORM_FILES_BUCKET, rows.map((r) => r.storage_key))
  const { error } = await (db as any).from('form_files').delete().in('id', rows.map((r) => r.id))
  if (error) throw new Error(`Could not delete form files: ${error.message}`)
  return rows.length
}

/**
 * Housekeeping (job `form-files-cleanup`, every 15 minutes): pending uploads
 * past their expiry (a task draft's files that the saved values still use
 * are bound instead), orphans (status `orphaned`, or bound files whose task
 * and submission are both gone) — rows and stored objects.
 */
export async function purgeFormFiles(options: { supabase?: AnySupabaseClient; limit?: number; deadline?: number } = {}): Promise<{ deleted: number; bound: number }> {
  let db = options.supabase
  if (!db) {
    const { createServiceClient } = await import('@/lib/cron-auth')
    db = createServiceClient() as AnySupabaseClient
  }
  const limit = Math.max(1, Math.min(options.limit ?? 1000, 10_000))
  const totals = { deleted: 0, bound: 0 }
  const now = () => new Date().toISOString()
  const timeLeft = () => !options.deadline || Date.now() < options.deadline

  // Expired pending uploads.
  while (totals.deleted + totals.bound < limit && timeLeft()) {
    const { data, error } = await (db as any).from('form_files').select(FILE_COLUMNS)
      .in('status', ['uploading', 'pending']).lt('expires_at', now()).order('expires_at', { ascending: true }).limit(100)
    if (error) throw new Error(`Could not list expired uploads: ${error.message}`)
    const rows = (data ?? []) as FormFileRow[]
    if (!rows.length) break
    const keep: string[] = []
    const drop: FormFileRow[] = []
    for (const row of rows) {
      if (row.status === 'pending' && row.task_id && await taskReferences(db, row.tenant_id, row.task_id, row.id)) keep.push(row.id)
      else drop.push(row)
    }
    if (keep.length) {
      await (db as any).from('form_files').update({ status: 'bound', bound_at: now(), expires_at: null }).in('id', keep)
      totals.bound += keep.length
    }
    totals.deleted += await deleteFormFileRows(db, drop)
    if (rows.length < 100) break
  }

  // Orphans: explicitly orphaned, or bound to nothing any more.
  for (const filter of ['orphaned', 'unbound'] as const) {
    while (totals.deleted + totals.bound < limit && timeLeft()) {
      let query = (db as any).from('form_files').select(FILE_COLUMNS)
      query = filter === 'orphaned' ? query.eq('status', 'orphaned') : query.eq('status', 'bound').is('task_id', null).is('submission_id', null).is('run_id', null)
      const { data, error } = await query.limit(100)
      if (error) throw new Error(`Could not list orphaned files: ${error.message}`)
      const rows = (data ?? []) as FormFileRow[]
      if (!rows.length) break
      totals.deleted += await deleteFormFileRows(db, rows)
      if (rows.length < 100) break
    }
  }
  return totals
}

/**
 * A designer test run's User Task values (the Test runner resumes the run
 * with them): every file object in `task_data` is replaced by the server's
 * record of a file the tester uploaded in this workspace, or dropped —
 * never a client-forged reference. `<key>_count` follows each list.
 */
export async function sanitizeTestTaskFiles(db: AnySupabaseClient, tenantId: string, actorId: string | null, taskData: Record<string, unknown>): Promise<Record<string, unknown>> {
  const keys = Object.keys(taskData).filter((key) => {
    const v = taskData[key]
    // File objects only (a list of plain ids could be anything, e.g. user ids).
    return isAttachmentFile(v) || (Array.isArray(v) && v.length > 0 && v.some(isAttachmentFile))
  })
  if (!keys.length) return taskData
  const ids = [...new Set(keys.flatMap((key) => attachmentIds(taskData[key])))]
  const rows = new Map<string, FormFileRow>()
  if (actorId && ids.length) {
    const { data } = await (db as any).from('form_files').select(FILE_COLUMNS).eq('tenant_id', tenantId).eq('uploaded_by', actorId).in('id', ids).in('status', ['pending', 'bound'])
    for (const row of (data ?? []) as FormFileRow[]) rows.set(String(row.id).toLowerCase(), row)
  }
  const out = { ...taskData }
  for (const key of keys) {
    const files = attachmentIds(taskData[key]).map((id) => rows.get(id)).filter((r): r is FormFileRow => Boolean(r)).map(presentFormFile)
    out[key] = files
    out[attachmentsCountKey(key)] = files.length
  }
  return out
}

/**
 * A request body that names a form attachment (its /attachments/<id> link,
 * its storage reference, or a file object as JSON — what a file input of a
 * Call Reference / storage connector upload becomes) → the file's bytes and
 * MIME type, read for `tenantId` only. Null when the body isn't a form file.
 */
export async function readFormFileBody(body: string, tenantId: string | null | undefined): Promise<{ bytes: Uint8Array; mime_type: string; name: string } | null> {
  if (!tenantId || typeof body !== 'string' || body.length > 4096) return null
  let value: unknown = body.trim()
  if (typeof value === 'string' && value.startsWith('{')) {
    try { value = JSON.parse(value) } catch { /* not JSON */ }
  }
  if (!formFileTarget(value)) return null
  const { createServiceClient } = await import('@/lib/cron-auth')
  const file = await readWorkflowFile(createServiceClient() as AnySupabaseClient, tenantId, value)
  if (!file) throw new Error('The attached file was not found (or belongs to another workspace)')
  return { bytes: file.bytes, mime_type: file.mime_type, name: file.name }
}

/**
 * Upload operations whose body template is JSON but whose API takes
 * multipart (Box `multipart/form-data`: `attributes` + `file`; Google Drive
 * `multipart/related`: metadata + media): when a field of the JSON names a
 * form attachment, build the real multipart body — the other fields as the
 * metadata, the file's bytes as the file part. Null when no field names a
 * form file (the body is sent as before).
 */
export async function buildFormFileMultipart(body: string, contentType: string, tenantId: string | null | undefined): Promise<{ body: FormData | Uint8Array; contentType: string | null } | null> {
  if (!tenantId || !body.trim().startsWith('{')) return null
  let json: Record<string, unknown>
  try { json = JSON.parse(body) } catch { return null }
  if (!isPlainObject(json)) return null
  const fileKeys = Object.keys(json).filter((key) => formFileTarget(json[key]))
  if (!fileKeys.length) return null
  const { createServiceClient } = await import('@/lib/cron-auth')
  const db = createServiceClient() as AnySupabaseClient
  const files = new Map<string, WorkflowFileBytes>()
  for (const key of fileKeys) {
    const file = await readWorkflowFile(db, tenantId, json[key])
    if (!file) throw new Error('The attached file was not found (or belongs to another workspace)')
    files.set(key, file)
  }
  const meta: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(json)) if (!files.has(key)) meta[key] = value

  if (/^multipart\/related/i.test(contentType)) {
    const file = files.get(fileKeys[0])!
    if (typeof meta.mimeType === 'string' && (!meta.mimeType || meta.mimeType === 'application/octet-stream')) meta.mimeType = file.mime_type
    if (typeof meta.name === 'string' && !meta.name) meta.name = file.name
    const boundary = `ut-${crypto.randomUUID()}`
    const enc = new TextEncoder()
    const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${file.mime_type}\r\n\r\n`)
    const tail = enc.encode(`\r\n--${boundary}--\r\n`)
    const out = new Uint8Array(head.length + file.bytes.length + tail.length)
    out.set(head, 0)
    out.set(file.bytes, head.length)
    out.set(tail, head.length + file.bytes.length)
    return { body: out, contentType: `multipart/related; boundary=${boundary}` }
  }
  const form = new FormData()
  for (const [key, value] of Object.entries(meta)) form.append(key, typeof value === 'string' ? value : JSON.stringify(value))
  for (const [key, file] of files) form.append(key, new Blob([file.bytes as unknown as BlobPart], { type: file.mime_type }), file.name)
  // fetch sets multipart/form-data with its boundary.
  return { body: form, contentType: null }
}


/**
 * A run started from a start form: its uploads (context `start`, this
 * workflow, still pending) are bound to the run (the engine calls this when
 * the run row exists — async starts get it from the queue). Deleting the run
 * then orphans them. Never throws.
 */
export async function bindStartRunFiles(db: AnySupabaseClient, tenantId: string, workflowId: string, runId: string, variables: Record<string, unknown> | null | undefined): Promise<void> {
  try {
    const ids = new Set<string>()
    for (const value of Object.values(variables ?? {})) {
      const list = Array.isArray(value) ? value : [value]
      for (const entry of list) if (isAttachmentFile(entry)) ids.add(String(entry.id).toLowerCase())
    }
    if (!ids.size) return
    await (db as any).from('form_files').update({ status: 'bound', run_id: runId, bound_at: new Date().toISOString(), expires_at: null })
      .eq('tenant_id', tenantId).eq('workflow_id', workflowId).eq('context_kind', 'start').eq('status', 'pending').in('id', [...ids])
  } catch (error) {
    console.warn('[form-files] binding start files failed:', error instanceof Error ? error.message : error)
  }
}

/* ── API / MCP / CLI uploads ─────────────────────────────────────────── */

export interface ApiUploadInput {
  task_id?: string
  form_id?: string
  /** A workflow's start form. */
  workflow_id?: string
  field_key: string
  name: string
  size?: number
  content_base64?: string
}

export type ApiUploadResult = { mode: 'uploaded'; file: AttachmentFile } | InitDirectUploadResult

function apiUploadContext(input: ApiUploadInput): UploadContext {
  const given = [input.task_id && 'task', input.form_id && 'form', input.workflow_id && 'workflow'].filter(Boolean)
  if (given.length !== 1) throw ServiceError.validation('Pass exactly one of task_id, form_id or workflow_id')
  if (input.task_id) return { kind: 'task', taskId: input.task_id }
  if (input.form_id) return { kind: 'form', formId: input.form_id }
  return { kind: 'start', workflowId: input.workflow_id! }
}

/**
 * POST /files/uploads (REST, MCP, CLI, SDK): the content in the request
 * (base64; checked and stored at once), or a direct upload (signed URL, then
 * complete). Same contexts, permissions and checks as the browser.
 */
export async function apiUploadFile(ctx: ServiceContext, input: ApiUploadInput): Promise<ApiUploadResult> {
  if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: uploads need a user-bound credential (a personal API key, OAuth or a signed-in user)')
  const context = apiUploadContext(input)
  if (typeof input.content_base64 === 'string' && input.content_base64.length) {
    const clean = input.content_base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) throw ServiceError.validation('content_base64 is not valid base64')
    const bytes = new Uint8Array(Buffer.from(clean, 'base64'))
    const file = await uploadFormFile(ctx, { context, field_key: input.field_key, name: input.name, bytes, declared_size: input.size ?? null })
    return { mode: 'uploaded', file }
  }
  if (!input.size) throw ServiceError.validation('Pass content_base64, or size to start a direct upload')
  return initDirectUpload(ctx, { context, field_key: input.field_key, name: input.name, size: input.size })
}
