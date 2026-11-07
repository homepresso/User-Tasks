/**
 * Workflow steps for e-signature (server only):
 *
 *   esign_send      Send for Signature — documents (attachments, generated
 *                   files) or a provider template; idempotent per run + step.
 *   esign_envelope  Envelope actions — status, download signed document /
 *                   certificate into workflow files, void, embedded signing URL,
 *                   list templates.
 *   esign_wait      Wait for Signature — returns at once when the envelope is
 *                   already final, otherwise registers a wait and pauses the run
 *                   (EsignPause); lib/esign/waits resumes it.
 *
 * Config keys match components/automations/esign-action-panels.tsx; docs at
 * /docs/integrations/e-signature.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { esignOutputVar, type EsignNodeType } from './catalog'
import { downloadToStorage, envelopeOutput, loadEsignIntegration, sendForSignature, type LoadedEsign } from './service'
import { DEFAULT_POLL_MINUTES, DEFAULT_TIMEOUT_DAYS, outcomeFor, registerWait, waitOutput } from './waits'
import { EsignError } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- step config is free-form JSON */

export class EsignPause {
  constructor(readonly eventId: string, readonly reason: string) {}
}

export interface EsignNodeContext {
  type: EsignNodeType
  config: Record<string, any>
  resolve: (value: unknown) => unknown
  supabase: SupabaseClient
  tenantId: string
  variables: Record<string, any>
  runId?: string | null
  workflowId?: string | null
  nodeId: string
  nodeLabel?: string | null
  isTest?: boolean
  info: (message: string) => void
  /** Tests: a preloaded integration instead of the database row. */
  loaded?: LoadedEsign
}

const text = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).trim()

function resolveRows(rows: unknown, resolve: (v: unknown) => unknown): Record<string, unknown>[] {
  if (!Array.isArray(rows)) return []
  return rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries((row ?? {}) as Record<string, unknown>)) out[k] = typeof v === 'string' ? resolve(v) : v
    return out
  })
}

/** Recipients: the table rows (expressions resolved) plus a list from an expression. */
export function stepRecipients(config: Record<string, any>, resolve: (v: unknown) => unknown): unknown[] {
  const rows = resolveRows(config.recipients, resolve).filter((r) => text(r.email) || text(r.name))
  const fromVar = config.recipients_expr ? resolve(config.recipients_expr) : undefined
  let extra: unknown[] = []
  if (Array.isArray(fromVar)) extra = fromVar
  else if (typeof fromVar === 'string' && fromVar.trim()) {
    try { const p = JSON.parse(fromVar); extra = Array.isArray(p) ? p : [p] } catch { extra = fromVar.split(/[;\n]+/) }
  } else if (fromVar && typeof fromVar === 'object') extra = [fromVar]
  return [...rows.map((r) => ({ ...r, routing_order: r.routing_order === '' ? undefined : r.routing_order, anchor: text(r.anchor) || undefined })), ...extra]
}

function stepPrefill(config: Record<string, any>, resolve: (v: unknown) => unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of resolveRows(config.prefill, resolve)) {
    const k = text(row.key)
    if (k) out[k] = text(row.value)
  }
  return out
}

async function loadFor(ctx: EsignNodeContext): Promise<LoadedEsign> {
  if (ctx.loaded) return ctx.loaded
  const id = text(ctx.resolve(ctx.config.integration_id))
  return loadEsignIntegration(ctx.supabase, ctx.tenantId, id)
}

export async function runEsignNode(ctx: EsignNodeContext): Promise<Record<string, unknown> | EsignPause> {
  const { config, resolve } = ctx
  const ov = esignOutputVar(ctx.type, config)
  const loaded = await loadFor(ctx)
  const label = loaded.integration?.name ?? loaded.provider

  switch (ctx.type) {
    case 'esign_send': {
      const source = config.source === 'template' ? 'template' : 'documents'
      const result = await sendForSignature(loaded, {
        source,
        documents: source === 'documents' ? resolve(config.documents) : undefined,
        template_id: text(resolve(config.template_id)),
        recipients: stepRecipients(config, resolve),
        subject: text(resolve(config.subject)),
        message: text(resolve(config.message)),
        reminder_days: resolve(config.reminder_days),
        expires_in_days: resolve(config.expires_in_days),
        embedded: config.embedded,
        test_mode: config.test_mode === 'default' || config.test_mode === undefined || config.test_mode === '' ? undefined : config.test_mode,
        use_text_tags: config.use_text_tags,
        prefill: stepPrefill(config, resolve),
        advanced: text(resolve(config.advanced)) || undefined,
        client_reference: text(resolve(config.client_reference)),
      }, { runId: ctx.runId ?? null, nodeId: ctx.nodeId })
      const output = envelopeOutput(result.envelope, { replayed: result.replayed, integration: label })
      ctx.variables[ov] = output
      ctx.variables[`${ov}_id`] = output.envelope_id
      ctx.info(result.replayed
        ? `Envelope ${output.envelope_id} was already sent by an earlier attempt (client reference ${output.client_reference}) — not sent again`
        : `Sent ${loaded.provider} envelope ${output.envelope_id} to ${output.signer_count} signer(s)`)
      return output
    }

    case 'esign_envelope': {
      const action = String(config.action ?? 'status')
      const envelopeId = text(resolve(config.envelope_id))
      const needId = () => { if (!envelopeId) throw new EsignError('validation', 'Envelope ID is required', { retryable: false }) }
      let output: Record<string, unknown>
      if (action === 'list_templates') {
        output = { ...(await loaded.adapter.listTemplates(loaded.ctx, { search: text(resolve(config.search)), page_size: Number(config.page_size) || 50 })) }
      } else if (action === 'download') {
        needId()
        const files = await downloadToStorage(loaded, envelopeId, { kind: String(config.document ?? 'combined'), fileName: text(resolve(config.file_name)) })
        output = { envelope_id: envelopeId, file: files.file, certificate: files.certificate, files: files.files, ...(files.warnings.length ? { warnings: files.warnings } : {}) }
      } else if (action === 'cancel') {
        needId()
        await loaded.adapter.cancel(loaded.ctx, envelopeId, text(resolve(config.reason)) || 'Cancelled by workflow')
        output = { envelope_id: envelopeId, cancelled: true }
      } else if (action === 'signing_url') {
        needId()
        const email = text(resolve(config.recipient_email))
        if (!email) throw new EsignError('validation', 'Recipient email is required for a signing URL', { retryable: false })
        const link = await loaded.adapter.signingUrl(loaded.ctx, envelopeId, { email, name: text(resolve(config.recipient_name)), return_url: text(resolve(config.return_url)) })
        output = { envelope_id: envelopeId, ...link }
      } else {
        needId()
        output = envelopeOutput(await loaded.adapter.getEnvelope(loaded.ctx, envelopeId))
      }
      ctx.variables[ov] = output
      return output
    }

    case 'esign_wait': {
      const envelopeId = text(resolve(config.envelope_id))
      if (!envelopeId) throw new EsignError('validation', 'Envelope ID is required (e.g. {{envelope.envelope_id}})', { retryable: false })
      const waitConfig = {
        output_var: ov,
        download: config.download !== false,
        document: String(config.document ?? 'combined'),
        file_name: text(resolve(config.file_name)) || undefined,
        poll_minutes: Math.max(1, Number(config.poll_minutes) || DEFAULT_POLL_MINUTES),
      }
      // Already final (or a test run checking once): no wait.
      const envelope = await loaded.adapter.getEnvelope(loaded.ctx, envelopeId)
      const outcome = outcomeFor(envelope)
      if (outcome) {
        const output = await waitOutput(loaded, envelope, outcome, waitConfig, 0)
        ctx.variables[ov] = output
        ctx.variables.esign_outcome = outcome
        return output
      }
      if (!ctx.runId) throw new EsignError('validation', 'Wait for signature needs a saved workflow run', { retryable: false })
      const timeoutDays = Number(resolve(config.timeout_days)) || DEFAULT_TIMEOUT_DAYS
      const eventId = await registerWait({
        loaded, envelopeId, runId: ctx.runId, workflowId: ctx.workflowId ?? null, nodeId: ctx.nodeId, nodeLabel: ctx.nodeLabel ?? null,
        config: waitConfig, timeoutDays,
      })
      ctx.info(`Waiting for ${envelope.envelope_id} (${envelope.status}) — resumes on completion, decline, void or expiry (timeout ${timeoutDays} days)`)
      return new EsignPause(eventId, `waiting for signature on ${envelopeId}`)
    }
  }
  throw new EsignError('validation', `Unknown e-signature step ${ctx.type}`)
}

/** On resume: the wait's output → the step's variables (engine helper). */
export function applyWaitOutput(config: Record<string, any>, variables: Record<string, any>, output: Record<string, unknown>) {
  const ov = esignOutputVar('esign_wait', config)
  variables[ov] = output
  variables.esign_outcome = output.outcome
}
