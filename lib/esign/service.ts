/**
 * The e-signature runtime shared by the connector references
 * (lib/esign/executor), the workflow steps (lib/esign/handlers), the
 * designer's template picker and the webhook / polling paths.
 *
 *  - loadEsignIntegration(): the tenant's e-sign integration (another
 *    workspace's id is "not found"), decrypted, `secret://` refs resolved.
 *  - sendForSignature(): idempotent send. The (integration, client reference)
 *    row in esign_envelopes is claimed before the provider call; a retry of
 *    the same step gets the envelope that was already sent.
 *  - downloadToStorage(): signed PDF / certificate → workflow file objects
 *    through the storage provider (Supabase Storage, S3, Azure, local …).
 *
 * Document bytes and credentials never reach a log line, a ledger row or a
 * step output — only names, sizes and provider ids.
 */

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSensitiveFields } from '@/lib/secret-fields'
import { esignProvider, esignProviderForConnector, type EsignProviderId } from './catalog'
import { settingsFrom, type EsignContext } from './client'
import type { EsignAdapter } from './adapter'
import { getEsignAdapter } from './providers'
import {
  EsignError, type DownloadedFile, type EsignDocument, type EsignEnvelope, type EsignRecipientInput, type SendDocumentsInput, type SendTemplateInput,
} from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- integration rows and step config are free-form JSON */

export const ESIGN_TIMEOUT_MS = 60_000
const STALE_SENDING_MS = 10 * 60_000

export interface LoadedEsign {
  ctx: EsignContext
  adapter: EsignAdapter
  provider: EsignProviderId
  integration: { id: string; name: string; type: string; tenant_id: string }
}

/** Keys of auth_config that may hold `secret://` references. */
const SECRET_REF_KEYS = ['token', 'key_value', 'password', 'client_secret', 'refresh_token', 'private_key', 'webhook_secret', 'api_key']

let serviceDbOverride: SupabaseClient | null = null
/** Tests: the client used for the ledger, waits and storage. */
export function setEsignServiceDb(db: SupabaseClient | null) { serviceDbOverride = db }

export async function serviceDb(): Promise<SupabaseClient> {
  if (serviceDbOverride) return serviceDbOverride
  const { createServiceClient } = await import('@/lib/cron-auth')
  return createServiceClient()
}

/** Integration row (already decrypted or not) → an adapter context. */
export async function contextFromIntegration(row: { id: string; type: string; tenant_id: string; config: any }, opts: { supabase?: SupabaseClient | null; timeoutMs?: number; resolveSecrets?: boolean } = {}): Promise<{ ctx: EsignContext; adapter: EsignAdapter; provider: EsignProviderId }> {
  const info = esignProviderForConnector(row.type)
  if (!info) throw new EsignError('configuration', `Integration type "${row.type}" is not an e-signature provider`, { retryable: false })
  let config = (decryptSensitiveFields(row.config ?? {}) ?? {}) as Record<string, any>
  const { getConnectorDefinition } = await import('@/lib/connectors/registry')
  const upgrade = getConnectorDefinition(row.type)?.upgradeIntegrationConfig
  if (upgrade) config = upgrade(config)
  if (opts.resolveSecrets !== false) {
    const auth = (config.auth_config ?? {}) as Record<string, unknown>
    const refs: Record<string, unknown> = {}
    for (const key of SECRET_REF_KEYS) if (typeof auth[key] === 'string' && String(auth[key]).startsWith('secret://')) refs[key] = auth[key]
    if (Object.keys(refs).length) {
      const { resolveTenantSecretRefs } = await import('@/lib/config/tenant-secret-refs')
      const resolved = await resolveTenantSecretRefs(String(row.tenant_id), refs, `${info.label} integration`)
      config = { ...config, auth_config: { ...auth, ...resolved } }
    }
  }
  const ctx: EsignContext = {
    provider: info.id,
    tenantId: String(row.tenant_id),
    integrationId: String(row.id),
    settings: settingsFrom(config),
    integrationConfig: config,
    supabase: opts.supabase ?? null,
    timeoutMs: opts.timeoutMs ?? ESIGN_TIMEOUT_MS,
  }
  return { ctx, adapter: getEsignAdapter(info.id), provider: info.id }
}

/** The tenant's e-sign integration (active), as an adapter context. */
export async function loadEsignIntegration(db: SupabaseClient, tenantId: string, integrationId: string, opts: { timeoutMs?: number } = {}): Promise<LoadedEsign> {
  const id = String(integrationId ?? '').trim()
  if (!id) throw new EsignError('configuration', 'Choose an e-signature integration for this step', { retryable: false })
  const { data: row } = await (db as any).from('integrations').select('id, name, type, config, tenant_id, is_active').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (!row) throw new EsignError('not_found', 'The e-signature integration was not found in this workspace', { retryable: false })
  if (row.is_active === false) throw new EsignError('configuration', 'The e-signature integration is inactive', { retryable: false })
  if (!esignProviderForConnector(row.type)) throw new EsignError('configuration', `"${row.name}" is not an e-signature integration (DocuSign, Adobe Acrobat Sign, Dropbox Sign, PandaDoc, SignNow or BoldSign)`, { retryable: false })
  const loaded = await contextFromIntegration(row, { supabase: db, timeoutMs: opts.timeoutMs })
  return { ...loaded, integration: { id: row.id, name: row.name, type: row.type, tenant_id: row.tenant_id } }
}

/* ── Input normalization ───────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const t = value.trim()
  if (!t) return undefined
  if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'))) {
    try { return JSON.parse(t) } catch { throw new EsignError('validation', 'Could not read the value as JSON', { retryable: false }) }
  }
  return value
}

/** Recipients from a list (objects or "Name <email>" strings), JSON text or one object. */
export function normalizeRecipients(value: unknown): EsignRecipientInput[] {
  const parsed = parseMaybeJson(value)
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : typeof parsed === 'string' ? parsed.split(/[;\n]+/) : []
  const out: EsignRecipientInput[] = []
  for (const entry of list) {
    if (entry === null || entry === undefined || entry === '') continue
    let r: Record<string, any>
    if (typeof entry === 'string') {
      const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(entry)
      r = m ? { name: m[1], email: m[2] } : { email: entry.trim(), name: entry.trim().split('@')[0] }
    } else r = entry as Record<string, any>
    const email = String(r.email ?? r.email_address ?? r.emailAddress ?? '').trim()
    const name = String(r.name ?? r.full_name ?? ([r.first_name, r.last_name].filter(Boolean).join(' ') || email.split('@')[0])).trim()
    if (!EMAIL_RE.test(email)) throw new EsignError('validation', `Recipient "${name || email || '?'}" has no valid email address`, { retryable: false })
    const order = Number(r.routing_order ?? r.order ?? r.signing_order)
    const kindRaw = String(r.kind ?? r.type ?? 'signer').toLowerCase()
    const anchorText = r.anchor && typeof r.anchor === 'object' ? r.anchor : r.anchor ?? r.anchor_text ?? r.signature_anchor
    const anchor = typeof anchorText === 'string' && anchorText.trim()
      ? { signature: anchorText.trim(), ...(r.date_anchor ? { date: String(r.date_anchor) } : {}) }
      : anchorText && typeof anchorText === 'object' ? anchorText : undefined
    out.push({
      name: name.slice(0, 100),
      email,
      ...(r.role ? { role: String(r.role).slice(0, 100) } : {}),
      ...(Number.isFinite(order) && order > 0 ? { routing_order: Math.floor(order) } : {}),
      kind: kindRaw === 'cc' || kindRaw === 'carbon_copy' || kindRaw === 'copy' ? 'cc' : 'signer',
      ...(anchor ? { anchor } : {}),
    })
  }
  if (!out.length) throw new EsignError('validation', 'Add at least one recipient (name and email)', { retryable: false })
  if (!out.some((r) => r.kind !== 'cc')) throw new EsignError('validation', 'Add at least one signer (not only copies)', { retryable: false })
  if (out.length > 50) throw new EsignError('validation', 'At most 50 recipients per envelope', { retryable: false })
  return out
}

/** Prefill values: an object, a [{ key, value }] list or JSON text of either. */
export function normalizePrefill(value: unknown): Record<string, string> {
  const parsed = parseMaybeJson(value)
  const out: Record<string, string> = {}
  if (Array.isArray(parsed)) {
    for (const e of parsed) {
      const k = String(e?.key ?? e?.name ?? '').trim()
      if (k) out[k] = e?.value === undefined || e?.value === null ? '' : String(e.value)
    }
  } else if (parsed && typeof parsed === 'object') {
    for (const [k, v] of Object.entries(parsed)) if (k.trim()) out[k.trim()] = v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  return out
}

/** Provider-specific "Advanced" fields (a JSON object). */
export function parseAdvanced(value: unknown): Record<string, unknown> | undefined {
  const parsed = parseMaybeJson(value)
  if (parsed === undefined || parsed === null || parsed === '') return undefined
  if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new EsignError('validation', 'Advanced provider options must be a JSON object', { retryable: false })
  return parsed as Record<string, unknown>
}

function positiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function bool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  return /^(1|true|yes|on)$/i.test(String(value).trim())
}

/** Document inputs → bytes (tenant-scoped storage, inline base64, URLs through the egress guard). */
export async function loadDocuments(value: unknown, tenantId: string, provider: EsignProviderId): Promise<EsignDocument[]> {
  const { resolveFileInputs, fileInputValues } = await import('@/lib/files/resolve-input')
  if (!fileInputValues(value).length) throw new EsignError('validation', 'Choose the document(s) to send for signature', { retryable: false })
  const files = await resolveFileInputs(value, { tenantId, label: 'Document', maxFiles: 20, maxTotalBytes: 25 * 1024 * 1024 })
  const docs: EsignDocument[] = files.map((f) => ({ name: f.name || 'document.pdf', mime_type: f.mime_type || 'application/pdf', bytes: f.bytes }))
  if (docs.length > 1 && !esignProvider(provider)?.supports.multipleDocuments) {
    if (!docs.every((d) => /pdf/i.test(d.mime_type) || /\.pdf$/i.test(d.name))) {
      throw new EsignError('validation', `${esignProvider(provider)?.label} takes one document per envelope: send PDFs (they are merged) or one file`, { retryable: false })
    }
    const { mergePdfs } = await import('@/lib/documents/pdf-tools')
    const merged = await mergePdfs(docs.map((d) => ({ name: d.name, bytes: d.bytes })))
    return [{ name: docs[0].name.replace(/\.pdf$/i, '') + ' (combined).pdf', mime_type: 'application/pdf', bytes: merged.bytes }]
  }
  return docs
}

/* ── Idempotent send ───────────────────────────────────────────────── */

export interface SendRequest {
  source: 'documents' | 'template'
  documents?: unknown
  template_id?: string
  recipients: unknown
  subject: string
  message?: string
  reminder_days?: unknown
  expires_in_days?: unknown
  embedded?: unknown
  test_mode?: unknown
  use_text_tags?: unknown
  prefill?: unknown
  advanced?: unknown
  client_reference?: string
}

export interface SendResult {
  envelope: EsignEnvelope
  /** The envelope was already sent by an earlier attempt with the same client reference. */
  replayed: boolean
}

/** A deterministic client reference for a step run (retries of the same step get the same one). */
export function defaultClientReference(parts: { runId?: string | null; nodeId?: string | null; integrationId: string; source: string; templateId?: string; subject: string; recipients: EsignRecipientInput[]; documentNames?: string[] }): string {
  const material = JSON.stringify([parts.runId ?? '', parts.nodeId ?? '', parts.integrationId, parts.source, parts.templateId ?? '', parts.subject, parts.recipients.map((r) => [r.email.toLowerCase(), r.role ?? '', r.kind ?? 'signer']), parts.documentNames ?? []])
  return `ut-${createHash('sha256').update(material).digest('hex').slice(0, 32)}`
}

function compactEnvelope(e: EsignEnvelope) {
  return { ...e, recipients: e.recipients.slice(0, 50) }
}

export async function sendForSignature(loaded: Pick<LoadedEsign, 'ctx' | 'adapter' | 'provider'>, req: SendRequest, caller: { runId?: string | null; nodeId?: string | null } = {}): Promise<SendResult> {
  const { ctx, adapter, provider } = loaded
  const subject = String(req.subject ?? '').trim()
  if (!subject) throw new EsignError('validation', 'Add an email subject', { retryable: false })
  const recipients = normalizeRecipients(req.recipients)
  const common = {
    subject,
    message: req.message ? String(req.message) : undefined,
    recipients,
    reminder_days: positiveNumber(req.reminder_days),
    expires_in_days: positiveNumber(req.expires_in_days),
    embedded: bool(req.embedded),
    test_mode: bool(req.test_mode),
    advanced: parseAdvanced(req.advanced),
  }

  let documents: EsignDocument[] = []
  let templateId = ''
  if (req.source === 'template') {
    templateId = String(req.template_id ?? '').trim()
    if (!templateId) throw new EsignError('validation', 'Choose a template', { retryable: false })
  } else {
    documents = await loadDocuments(req.documents, ctx.tenantId, provider)
  }
  const clientReference = String(req.client_reference ?? '').trim().slice(0, 100) || defaultClientReference({
    runId: caller.runId, nodeId: caller.nodeId, integrationId: ctx.integrationId, source: req.source, templateId, subject, recipients, documentNames: documents.map((d) => d.name),
  })

  const db = await serviceDb()
  const claim = await claimLedger(db, ctx, clientReference, subject, caller)
  if (claim.kind === 'replay') return { envelope: claim.envelope, replayed: true }

  try {
    let envelope: EsignEnvelope
    if (req.source === 'template') {
      const input: SendTemplateInput = { ...common, client_reference: clientReference, template_id: templateId, prefill: normalizePrefill(req.prefill) }
      envelope = await adapter.sendTemplate(ctx, input)
    } else {
      const input: SendDocumentsInput = { ...common, client_reference: clientReference, documents, use_text_tags: bool(req.use_text_tags) ?? true }
      envelope = await adapter.sendDocuments(ctx, input)
    }
    envelope = { ...envelope, client_reference: clientReference }
    if (claim.kind === 'claimed') {
      await (db as any).from('esign_envelopes').update({ status: 'sent', envelope_id: envelope.envelope_id, envelope: compactEnvelope(envelope), error: null, updated_at: new Date().toISOString() })
        .eq('tenant_id', ctx.tenantId).eq('integration_id', ctx.integrationId).eq('client_reference', clientReference)
    }
    return { envelope, replayed: false }
  } catch (error) {
    if (claim.kind === 'claimed') {
      await (db as any).from('esign_envelopes').update({ status: 'failed', error: String((error as Error)?.message ?? error).slice(0, 1000), updated_at: new Date().toISOString() })
        .eq('tenant_id', ctx.tenantId).eq('integration_id', ctx.integrationId).eq('client_reference', clientReference)
        .then(() => undefined, () => undefined)
    }
    throw error
  }
}

type Claim = { kind: 'claimed' } | { kind: 'replay'; envelope: EsignEnvelope } | { kind: 'unledgered' }

async function claimLedger(db: SupabaseClient, ctx: EsignContext, ref: string, subject: string, caller: { runId?: string | null; nodeId?: string | null }): Promise<Claim> {
  const row = {
    tenant_id: ctx.tenantId, integration_id: ctx.integrationId, provider: ctx.provider, client_reference: ref, status: 'sending', subject: subject.slice(0, 500),
    run_id: caller.runId ?? null, node_id: caller.nodeId ?? null,
  }
  const { error } = await (db as any).from('esign_envelopes').insert(row)
  if (!error) return { kind: 'claimed' }
  if (error.code === '42P01' || /esign_envelopes/.test(String(error.message)) && /does not exist|schema cache/i.test(String(error.message))) {
    console.warn('[esign] esign_envelopes is missing (apply migration 20261206000000) — sending without the idempotency ledger')
    return { kind: 'unledgered' }
  }
  if (error.code !== '23505') throw new EsignError('provider_error', `Could not record the send: ${error.message}`)
  const { data: existing } = await (db as any).from('esign_envelopes').select('status, envelope_id, envelope, updated_at')
    .eq('tenant_id', ctx.tenantId).eq('integration_id', ctx.integrationId).eq('client_reference', ref).maybeSingle()
  if (existing?.status === 'sent' && existing.envelope_id) {
    const envelope = (existing.envelope ?? {}) as EsignEnvelope
    return { kind: 'replay', envelope: { ...envelope, envelope_id: String(existing.envelope_id), provider: ctx.provider, client_reference: ref } }
  }
  const stale = existing?.status === 'failed' || (existing?.updated_at && Date.now() - Date.parse(existing.updated_at) > STALE_SENDING_MS)
  if (!stale) throw new EsignError('conflict', `A send with client reference "${ref}" is already in progress — retry in a few minutes`, { retryable: true })
  // Take the row over (compare-and-set on its updated_at so two retries cannot both send).
  const { data: taken } = await (db as any).from('esign_envelopes')
    .update({ status: 'sending', error: null, updated_at: new Date().toISOString(), run_id: caller.runId ?? null, node_id: caller.nodeId ?? null })
    .eq('tenant_id', ctx.tenantId).eq('integration_id', ctx.integrationId).eq('client_reference', ref).eq('updated_at', existing!.updated_at)
    .select('id')
  if (!taken?.length) throw new EsignError('conflict', `A send with client reference "${ref}" is already in progress — retry in a few minutes`, { retryable: true })
  return { kind: 'claimed' }
}

/* ── Downloads ─────────────────────────────────────────────────────── */

export async function downloadWithRetry(loaded: Pick<LoadedEsign, 'ctx' | 'adapter'>, envelopeId: string, kind: 'combined' | 'certificate'): Promise<DownloadedFile> {
  const sleep = loaded.ctx.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  for (let attempt = 1; ; attempt++) {
    try {
      return await loaded.adapter.download(loaded.ctx, envelopeId, kind)
    } catch (error) {
      // Files can lag the completion event by a few seconds (Dropbox Sign 409, PandaDoc processing).
      if (error instanceof EsignError && (error.status === 409 || error.code === 'provider_unavailable') && attempt < 3) {
        await sleep(3_000 * attempt)
        continue
      }
      throw error
    }
  }
}

export interface StoredFile { _file: true; name: string; url: string; size: number; mime_type: string; [k: string]: unknown }

export async function storeFile(tenantId: string, file: DownloadedFile, name: string): Promise<StoredFile> {
  const { storeDocumentFile, outputFileName } = await import('@/lib/documents/store')
  const db = await serviceDb()
  return storeDocumentFile(db as never, tenantId, file.bytes, outputFileName(name, 'signed', 'pdf'), file.mime_type || 'application/pdf') as unknown as StoredFile
}

export interface DownloadResult {
  file: StoredFile | null
  certificate: StoredFile | null
  files: StoredFile[]
  warnings: string[]
}

/** Signed document and/or certificate → stored workflow files. */
export async function downloadToStorage(loaded: Pick<LoadedEsign, 'ctx' | 'adapter'>, envelopeId: string, opts: { kind?: string; fileName?: string } = {}): Promise<DownloadResult> {
  const kind = opts.kind === 'certificate' || opts.kind === 'both' ? opts.kind : 'combined'
  const base = String(opts.fileName ?? '').trim().replace(/\.pdf$/i, '') || `signed-${envelopeId.slice(0, 12)}`
  const out: DownloadResult = { file: null, certificate: null, files: [], warnings: [] }
  if (kind === 'combined' || kind === 'both') {
    out.file = await storeFile(loaded.ctx.tenantId, await downloadWithRetry(loaded, envelopeId, 'combined'), `${base}.pdf`)
    out.files.push(out.file)
  }
  if (kind === 'certificate' || kind === 'both') {
    try {
      out.certificate = await storeFile(loaded.ctx.tenantId, await downloadWithRetry(loaded, envelopeId, 'certificate'), `${base}-certificate.pdf`)
      out.files.push(out.certificate)
    } catch (error) {
      if (error instanceof EsignError && error.code === 'unsupported' && kind === 'both') out.warnings.push(error.message)
      else throw error
    }
  }
  return out
}

/** Compact recipient summary for step outputs / logs. */
export function recipientSummary(envelope: EsignEnvelope) {
  return envelope.recipients.map((r) => ({ name: r.name, email: r.email, role: r.role, routing_order: r.routing_order, kind: r.kind, status: r.status, signed_at: r.signed_at, declined_reason: r.declined_reason }))
}

/** The output a step / reference returns for an envelope. */
export function envelopeOutput(envelope: EsignEnvelope, extra: Record<string, unknown> = {}) {
  const signers = envelope.recipients.filter((r) => r.kind !== 'cc')
  return {
    provider: envelope.provider,
    envelope_id: envelope.envelope_id,
    status: envelope.status,
    provider_status: envelope.provider_status,
    subject: envelope.subject,
    terminal: envelope.terminal,
    completed: envelope.status === 'completed',
    signed_count: signers.filter((r) => r.status === 'signed').length,
    signer_count: signers.length,
    recipients: recipientSummary(envelope),
    sent_at: envelope.sent_at,
    completed_at: envelope.completed_at,
    expires_at: envelope.expires_at,
    void_reason: envelope.void_reason,
    client_reference: envelope.client_reference,
    ...extra,
  }
}
