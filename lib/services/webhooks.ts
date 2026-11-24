/**
 * Inbound workflow webhooks (workflow_webhooks): list, get, create, update,
 * delete and secret rotation. Shared by /api/v1/workflows/{id}/webhooks,
 * /api/v1/webhooks/{id}[/rotate], the MCP webhooks_* tools and the editor's
 * /api/webhooks/create-key route. Every operation needs settings.manage_webhooks.
 *
 * The secret is the bearer key callers send to /api/webhooks/inbound?hook=…
 * (unchanged). It is generated server-side and returned once — on create and
 * on rotate. Stored: a SHA-256 (api_key_sha256, what /api/webhooks/inbound
 * checks — see lib/webhook-secret), a bcrypt hash (api_key_hash, so a release
 * from before the SHA-256 column still verifies it after a rollback) and an
 * 8-character prefix. Never the secret itself.
 */

import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError } from './_shared'
import { appUrlOrLocalhost } from '@/lib/config/bootstrap'
import { hashWebhookSecret, isMissingSha256Column } from '@/lib/webhook-secret'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow_webhooks rows */

const COLUMNS = 'id, workflow_id, slug, api_key_prefix, is_active, payload_mapping, last_received_at, receive_count, created_at'
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{2,99}$/i

export interface WebhookCreateInput {
  /** URL slug (`?hook=<slug>`); generated when omitted. */
  slug?: string
  payload_mapping?: unknown[]
  is_active?: boolean
}

function inboundUrl(slug: string) {
  const base = (appUrlOrLocalhost()).replace(/\/+$/, '')
  return `${base}/api/webhooks/inbound?hook=${encodeURIComponent(slug)}`
}

/** Public shape (+ inbound url): the secret hash is dropped even if a client returned it. */
function present(raw: Record<string, any>): Record<string, any> {
  const row = { ...raw }
  delete row.api_key_hash
  delete row.api_key_sha256
  return { ...row, url: inboundUrl(row.slug) }
}

function newSecret() {
  const secret = randomBytes(32).toString('hex')
  return { secret, prefix: secret.slice(0, 8) }
}

/** The stored forms of a new secret (see the header). */
async function secretColumns(secret: string, prefix: string) {
  return { api_key_hash: await bcrypt.hash(secret, 10), api_key_sha256: hashWebhookSecret(secret), api_key_prefix: prefix }
}

/**
 * Run a write that sets api_key_sha256; until migration
 * 20270125090000_webhook_secret_sha256 is applied the column is missing, so
 * retry without it (the bcrypt hash alone, verified as before).
 */
type WriteResult = { data: any; error: any }
async function withSha256Fallback(columns: Record<string, unknown>, write: (columns: Record<string, unknown>) => PromiseLike<WriteResult>): Promise<WriteResult> {
  const result = await write(columns)
  if (!isMissingSha256Column(result.error)) return result
  const rest = { ...columns }
  delete rest.api_key_sha256
  return write(rest)
}

async function loadWorkflow(ctx: ServiceContext, workflowId: string) {
  const { data, error } = await (ctx.supabase as any).from('workflows')
    .select('id, name').eq('id', workflowId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workflow not found')
  return data as { id: string; name: string }
}

async function loadWebhook(ctx: ServiceContext, webhookId: string) {
  const { data, error } = await (ctx.supabase as any).from('workflow_webhooks')
    .select(COLUMNS).eq('id', webhookId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Webhook not found')
  return data as Record<string, any>
}

export async function listWorkflowWebhooks(ctx: ServiceContext, workflowId: string) {
  requirePerm(ctx, 'settings.manage_webhooks')
  await loadWorkflow(ctx, workflowId)
  const { data, error } = await (ctx.supabase as any).from('workflow_webhooks')
    .select(COLUMNS).eq('workflow_id', workflowId).eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false })
  if (error) throw dbError(error)
  const webhooks = (data ?? []).map(present)
  return { webhooks, total: webhooks.length }
}

/** Create a webhook for a workflow. Returns the row and its `secret` (shown once). */
export async function createWorkflowWebhook(ctx: ServiceContext, workflowId: string, input: WebhookCreateInput = {}) {
  requirePerm(ctx, 'settings.manage_webhooks')
  const workflow = await loadWorkflow(ctx, workflowId)
  const slug = (input.slug ?? '').trim() || `wh-${workflowId.slice(0, 8)}-${Date.now().toString(36)}`
  if (!SLUG_PATTERN.test(slug)) throw ServiceError.validation('slug must be 3-100 letters, digits, "-" or "_"')
  if (input.payload_mapping !== undefined && !Array.isArray(input.payload_mapping)) throw ServiceError.validation('payload_mapping must be an array')

  const { data: taken } = await (ctx.supabase as any).from('workflow_webhooks').select('id').eq('slug', slug).maybeSingle()
  if (taken) throw ServiceError.conflict('That webhook slug is already in use')

  const { secret, prefix } = newSecret()
  const { data, error } = await withSha256Fallback({
    workflow_id: workflowId,
    tenant_id: ctx.tenantId,
    slug,
    ...await secretColumns(secret, prefix),
    is_active: input.is_active ?? true,
    payload_mapping: input.payload_mapping ?? [],
  }, (row) => (ctx.supabase as any).from('workflow_webhooks').insert(row).select(COLUMNS).single())
  if (error?.code === '23505') throw ServiceError.conflict('That webhook slug is already in use')
  if (error || !data) throw dbError(error, 'Failed to create webhook')
  await audit(ctx, {
    objectType: 'webhook', objectId: data.id, action: 'create',
    summary: `Created webhook "${slug}" for workflow "${workflow.name}"`, metadata: { workflow_id: workflowId },
  })
  return { webhook: present(data), secret }
}

export async function getWebhook(ctx: ServiceContext, webhookId: string) {
  requirePerm(ctx, 'settings.manage_webhooks')
  return { webhook: present(await loadWebhook(ctx, webhookId)) }
}

export interface WebhookUpdateInput {
  slug?: string
  payload_mapping?: unknown[]
  is_active?: boolean
}

/** Change the slug, payload mapping or active flag (the secret is only changed by rotate). */
export async function updateWebhook(ctx: ServiceContext, webhookId: string, input: WebhookUpdateInput) {
  requirePerm(ctx, 'settings.manage_webhooks')
  const webhook = await loadWebhook(ctx, webhookId)
  const update: Record<string, unknown> = {}
  if (input.slug !== undefined && input.slug.trim() !== webhook.slug) {
    const slug = input.slug.trim()
    if (!SLUG_PATTERN.test(slug)) throw ServiceError.validation('slug must be 3-100 letters, digits, "-" or "_"')
    const { data: taken } = await (ctx.supabase as any).from('workflow_webhooks').select('id').eq('slug', slug).neq('id', webhookId).maybeSingle()
    if (taken) throw ServiceError.conflict('That webhook slug is already in use')
    update.slug = slug
  }
  if (input.payload_mapping !== undefined) {
    if (!Array.isArray(input.payload_mapping)) throw ServiceError.validation('payload_mapping must be an array')
    if (JSON.stringify(input.payload_mapping) !== JSON.stringify(webhook.payload_mapping ?? [])) update.payload_mapping = input.payload_mapping
  }
  if (input.is_active !== undefined && input.is_active !== webhook.is_active) update.is_active = input.is_active
  if (!Object.keys(update).length) return { webhook: present(webhook), changed: false }

  const { data, error } = await (ctx.supabase as any).from('workflow_webhooks')
    .update(update).eq('id', webhookId).eq('tenant_id', ctx.tenantId).select(COLUMNS).single()
  if (error?.code === '23505') throw ServiceError.conflict('That webhook slug is already in use')
  if (error || !data) throw dbError(error, 'Failed to update webhook')
  await audit(ctx, {
    objectType: 'webhook', objectId: webhookId, action: 'update',
    summary: `Updated webhook "${data.slug}"`, metadata: { workflow_id: data.workflow_id, fields: Object.keys(update) },
  })
  return { webhook: present(data), changed: true }
}

export async function deleteWebhook(ctx: ServiceContext, webhookId: string) {
  requirePerm(ctx, 'settings.manage_webhooks')
  const webhook = await loadWebhook(ctx, webhookId)
  const { error } = await (ctx.supabase as any).from('workflow_webhooks').delete().eq('id', webhookId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error, 'Failed to delete webhook')
  await audit(ctx, { objectType: 'webhook', objectId: webhookId, action: 'delete', summary: `Deleted webhook "${webhook.slug}"`, metadata: { workflow_id: webhook.workflow_id } })
  return { deleted: true as const, id: webhookId }
}

/** Replace the webhook's secret; the old one stops working. Returns the new `secret` (shown once). */
export async function rotateWebhookSecret(ctx: ServiceContext, webhookId: string) {
  requirePerm(ctx, 'settings.manage_webhooks')
  await loadWebhook(ctx, webhookId)
  const { secret, prefix } = newSecret()
  // api_key_sha256 is always overwritten: the old secret must stop verifying.
  const { data, error } = await withSha256Fallback(await secretColumns(secret, prefix), (update) =>
    (ctx.supabase as any).from('workflow_webhooks')
      .update(update)
      .eq('id', webhookId).eq('tenant_id', ctx.tenantId).select(COLUMNS).single())
  if (error || !data) throw dbError(error, 'Failed to rotate webhook secret')
  await audit(ctx, { objectType: 'webhook', objectId: webhookId, action: 'update', summary: `Rotated the secret of webhook "${data.slug}"`, metadata: { workflow_id: data.workflow_id } })
  return { webhook: present(data), secret }
}
