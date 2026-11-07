/**
 * The reference templates every e-sign connector shares (client-safe). Each
 * runs through lib/esign/executor (path /_internal/esign/<operation>), so
 * the inputs and outputs are the same for DocuSign, Adobe Acrobat Sign,
 * Dropbox Sign, PandaDoc, SignNow and BoldSign.
 */

import type { ConnectorField, ReferenceTemplate } from '@/lib/connectors/registry'
import { esignProvider, type EsignProviderId } from './catalog'

const ENVELOPE_OUTPUTS = [
  { name: 'envelope_id', type: 'string' },
  { name: 'status', type: 'string' },
  { name: 'provider_status', type: 'string' },
  { name: 'completed', type: 'boolean' },
  { name: 'signed_count', type: 'number' },
  { name: 'signer_count', type: 'number' },
  { name: 'recipients', type: 'array' },
  { name: 'client_reference', type: 'string' },
]

const RECIPIENTS_HELP = 'List of { name, email, role?, routing_order?, kind?: "signer" | "cc", anchor?: "/sn1/" } — or "Name <email>" lines'

export function esignReferenceTemplates(provider: EsignProviderId): ReferenceTemplate[] {
  const info = esignProvider(provider)!
  const noun = info.envelopeNoun
  const id = { name: 'envelope_id', type: 'string', required: true, description: `${info.label} ${noun} ID` }
  const sendCommon = [
    { name: 'recipients', type: 'array', required: true, description: RECIPIENTS_HELP },
    { name: 'subject', type: 'string', required: true, description: 'Email subject / title' },
    { name: 'message', type: 'string', required: false, description: 'Message to the recipients' },
    ...(info.supports.reminders ? [{ name: 'reminder_days', type: 'number', required: false, description: 'Remind unsigned recipients every N days' }] : []),
    ...(info.supports.expiry ? [{ name: 'expires_in_days', type: 'number', required: false, description: `The ${noun} expires after N days` }] : []),
    { name: 'embedded', type: 'boolean', required: false, description: 'Recipients sign through a link UserTasks shows (see Get Embedded Signing URL)', defaultValue: 'false' },
    ...(info.supports.testMode ? [{ name: 'test_mode', type: 'boolean', required: false, description: 'Send a non-binding test request (defaults to the connector setting)' }] : []),
    { name: 'client_reference', type: 'string', required: false, description: 'Idempotency key: a retry with the same value returns the first send instead of sending again (default: derived from the workflow run and step)' },
    { name: 'advanced', type: 'object', required: false, description: `${info.label} request fields merged into the request (JSON object)` },
  ]
  return [
    {
      key: 'send_documents',
      name: 'Send Documents for Signature',
      description: `Send one or more files (workflow attachments, generated documents, URLs) for signature as a new ${noun}`,
      method: 'POST',
      pathTemplate: '/_internal/esign/send_documents',
      inputs: [
        { name: 'documents', type: 'array', required: true, description: 'File object(s) or list — form attachments, document step outputs, storage:// refs or URLs' },
        ...sendCommon,
        ...(info.supports.textTags ? [{ name: 'use_text_tags', type: 'boolean', required: false, description: `The documents contain ${info.label} text tags that place the fields`, defaultValue: 'true' }] : []),
      ],
      outputs: ENVELOPE_OUTPUTS,
    },
    {
      key: 'send_template',
      name: 'Send from Template',
      description: `Send a ${noun} from a ${info.label} template: recipients map to template roles, prefill sets template fields`,
      method: 'POST',
      pathTemplate: '/_internal/esign/send_template',
      inputs: [
        { name: 'template_id', type: 'string', required: true, description: `${info.label} template ID (List Templates)` },
        ...sendCommon,
        { name: 'prefill', type: 'object', required: false, description: 'Template field name → value' },
      ],
      outputs: ENVELOPE_OUTPUTS,
    },
    {
      key: 'get_status',
      name: 'Get Envelope Status',
      description: `Status of a ${noun} and of each recipient (normalized: sent, delivered, completed, declined, voided, expired)`,
      method: 'GET',
      pathTemplate: '/_internal/esign/get_status',
      inputs: [id],
      outputs: [...ENVELOPE_OUTPUTS, { name: 'completed_at', type: 'string' }, { name: 'void_reason', type: 'string' }],
    },
    {
      key: 'download_signed',
      name: 'Download Signed Document',
      description: 'Download the signed (combined) PDF and/or the certificate / audit trail as workflow files',
      method: 'GET',
      pathTemplate: '/_internal/esign/download_signed',
      inputs: [
        id,
        { name: 'document', type: 'string', required: false, description: 'combined (signed PDF), certificate (audit trail) or both', defaultValue: 'combined' },
        { name: 'file_name', type: 'string', required: false, description: 'File name for the stored PDF' },
      ],
      outputs: [{ name: 'file', type: 'object' }, { name: 'certificate', type: 'object' }, { name: 'files', type: 'array' }],
    },
    {
      key: 'cancel_envelope',
      name: 'Void / Cancel Envelope',
      description: `Void (cancel) a ${noun} that is still out for signature`,
      method: 'POST',
      pathTemplate: '/_internal/esign/cancel_envelope',
      inputs: [id, { name: 'reason', type: 'string', required: true, description: 'Reason shown to the recipients' }],
      outputs: [{ name: 'envelope_id', type: 'string' }, { name: 'cancelled', type: 'boolean' }],
    },
    {
      key: 'signing_url',
      name: 'Get Embedded Signing URL',
      description: 'A signing link for one recipient (send with Embedded signing on), for a "Sign now" link in a task or form',
      method: 'POST',
      pathTemplate: '/_internal/esign/signing_url',
      inputs: [
        id,
        { name: 'recipient_email', type: 'string', required: true, description: 'Signer email' },
        { name: 'recipient_name', type: 'string', required: false, description: 'Signer name' },
        { name: 'return_url', type: 'string', required: false, description: 'Where the signer lands afterwards' },
      ],
      outputs: [{ name: 'url', type: 'string' }, { name: 'expires_at', type: 'string' }],
    },
    {
      key: 'search_templates',
      name: 'List Templates',
      description: `${info.label} templates (search, paging) with their role names`,
      method: 'GET',
      pathTemplate: '/_internal/esign/search_templates',
      inputs: [
        { name: 'search', type: 'string', required: false, description: 'Name contains' },
        { name: 'page_size', type: 'number', required: false, description: 'Templates per page', defaultValue: '25' },
        { name: 'cursor', type: 'string', required: false, description: 'next_cursor of the previous page' },
      ],
      outputs: [{ name: 'templates', type: 'array' }, { name: 'next_cursor', type: 'string' }],
    },
  ]
}

/** The connector credential field for the webhook secret. */
export function webhookSecretField(helpText: string): ConnectorField {
  return { key: 'webhook_secret', label: 'Webhook secret (optional)', type: 'password', helpText }
}

/** API base URL override (sandboxes, regional hosts, proxies, a local mock server). */
export const API_BASE_URL_FIELD: ConnectorField = {
  key: 'api_base_url',
  label: 'API base URL override (advanced)',
  type: 'text',
  placeholder: 'Leave empty for the provider default',
  validation: { type: 'url' },
  helpText: 'Only for a regional host, a proxy or a mock server; calls still pass the egress guard.',
}
