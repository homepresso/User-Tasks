/**
 * Connector references of the e-sign providers: templates whose path is
 * /_internal/esign/<operation> run here instead of as a raw HTTP request
 * (lib/reference-executor dispatches them), so Call Reference steps, agents,
 * MCP tools, reports and the references API all get the shared, normalized
 * actions. Returns { status, data } like any reference; provider failures
 * come back as the provider's HTTP status with an error message.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ESIGN_INTERNAL_PATH, ESIGN_OPERATIONS, type EsignOperation } from './catalog'
import { contextFromIntegration, downloadToStorage, envelopeOutput, sendForSignature } from './service'
import { EsignError } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- reference inputs are free-form */

export function esignOperationFromPath(path: unknown): EsignOperation | null {
  const p = String(path ?? '')
  if (!p.startsWith(ESIGN_INTERNAL_PATH)) return null
  const op = p.slice(ESIGN_INTERNAL_PATH.length).split(/[/?#]/)[0]
  return (ESIGN_OPERATIONS as readonly string[]).includes(op) ? (op as EsignOperation) : null
}

export interface EsignExecuteResult {
  status: number
  data: any
  error_message?: string
  operation: string
}

export async function executeEsignReference(opts: {
  integration: { id: string; type: string; tenant_id?: string | null }
  integrationConfig: Record<string, any>
  path: string
  values: Record<string, any>
  tenantId: string
  supabase: SupabaseClient
  timeout: number
  caller?: { callerId?: string | null; callerNodeId?: string | null; callerType?: string | null } | null
}): Promise<EsignExecuteResult> {
  const operation = esignOperationFromPath(opts.path)
  if (!operation) return { status: 400, data: { error: `Unknown e-signature operation "${opts.path}"` }, error_message: `Unknown e-signature operation "${opts.path}"`, operation: 'unknown' }
  const v = opts.values ?? {}
  const str = (k: string) => (v[k] === undefined || v[k] === null ? '' : String(v[k]).trim())
  try {
    const loaded = await contextFromIntegration({ id: opts.integration.id, type: opts.integration.type, tenant_id: opts.tenantId, config: opts.integrationConfig }, { supabase: opts.supabase, timeoutMs: Math.max(opts.timeout, 30_000) })
    const need = (k: string, label: string) => {
      const value = str(k)
      if (!value) throw new EsignError('validation', `${label} is required`, { retryable: false })
      return value
    }
    const runCaller = opts.caller?.callerType === 'workflow_node' ? { runId: opts.caller?.callerId ?? null, nodeId: opts.caller?.callerNodeId ?? null } : {}
    switch (operation) {
      case 'send_documents':
      case 'send_template': {
        const result = await sendForSignature(loaded, {
          source: operation === 'send_template' ? 'template' : 'documents',
          documents: v.documents,
          template_id: str('template_id'),
          recipients: v.recipients,
          subject: str('subject'),
          message: str('message'),
          reminder_days: v.reminder_days,
          expires_in_days: v.expires_in_days,
          embedded: v.embedded,
          test_mode: v.test_mode,
          use_text_tags: v.use_text_tags,
          prefill: v.prefill,
          advanced: v.advanced,
          client_reference: str('client_reference'),
        }, runCaller)
        return { status: result.replayed ? 200 : 201, data: envelopeOutput(result.envelope, { replayed: result.replayed }), operation }
      }
      case 'get_status': {
        const envelope = await loaded.adapter.getEnvelope(loaded.ctx, need('envelope_id', 'Envelope ID'))
        return { status: 200, data: envelopeOutput(envelope), operation }
      }
      case 'download_signed': {
        const id = need('envelope_id', 'Envelope ID')
        const result = await downloadToStorage(loaded, id, { kind: str('document') || 'combined', fileName: str('file_name') })
        return { status: 200, data: { envelope_id: id, ...result }, operation }
      }
      case 'cancel_envelope': {
        const id = need('envelope_id', 'Envelope ID')
        await loaded.adapter.cancel(loaded.ctx, id, str('reason') || 'Cancelled')
        return { status: 200, data: { envelope_id: id, cancelled: true }, operation }
      }
      case 'signing_url': {
        const id = need('envelope_id', 'Envelope ID')
        const link = await loaded.adapter.signingUrl(loaded.ctx, id, { email: need('recipient_email', 'Recipient email'), name: str('recipient_name'), return_url: str('return_url') })
        return { status: 200, data: { envelope_id: id, ...link }, operation }
      }
      case 'search_templates': {
        const page = await loaded.adapter.listTemplates(loaded.ctx, { search: str('search'), page_size: Number(v.page_size) || undefined, cursor: str('cursor') || null })
        return { status: 200, data: page, operation }
      }
    }
  } catch (error) {
    if (error instanceof EsignError) {
      const status = error.status && error.status >= 400 ? error.status : error.code === 'validation' || error.code === 'configuration' || error.code === 'unsupported' ? 400 : error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 502
      return { status, data: { error: error.message, code: error.code, retryable: error.retryable }, error_message: error.message, operation }
    }
    throw error
  }
  return { status: 400, data: { error: 'Unsupported operation' }, error_message: 'Unsupported operation', operation }
}
