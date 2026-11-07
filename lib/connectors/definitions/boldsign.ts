import type { ConnectorDefinition } from '../registry'
import { API_BASE_URL_FIELD, esignReferenceTemplates, webhookSecretField } from '@/lib/esign/connector-templates'

/** BoldSign (API v1) — the shared e-sign actions (lib/esign). Auth: X-API-KEY. */

export const boldsignConnector: ConnectorDefinition = {
  key: 'boldsign',
  name: 'BoldSign',
  description: 'Send documents (text tags) or templates for e-signature, reminders and expiry, track signers, download signed PDFs and audit logs',
  category: 'productivity',
  icon: 'PenTool',
  color: '#2B60DE',
  docsUrl: 'https://developers.boldsign.com/',
  recommendedPermissions: {
    title: 'BoldSign API key',
    items: [
      'API → API Key: generate a key (a sandbox key for testing, a live key for production)',
      'Webhooks: API → Webhooks, URL from the docs, events Sent / Signed / Completed / Declined / Revoked / Expired; copy the signing secret',
    ],
    note: 'Sandbox API keys send documents that are not legally binding.',
  },
  fields: [
    {
      key: 'region',
      label: 'Region',
      type: 'select',
      options: [
        { value: 'us', label: 'US (api.boldsign.com)' },
        { value: 'eu', label: 'EU (api-eu.boldsign.com)' },
      ],
      defaultValue: 'us',
    },
    API_BASE_URL_FIELD,
  ],
  credentialFields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true },
    webhookSecretField('The webhook signing secret (verifies X-BoldSign-Signature)'),
  ],
  referenceTemplates: esignReferenceTemplates('boldsign'),
  buildIntegrationConfig: (config, credentials) => {
    const override = String(config.api_base_url || '').trim().replace(/\/+$/, '')
    const baseUrl = override || (config.region === 'eu' ? 'https://api-eu.boldsign.com/v1' : 'https://api.boldsign.com/v1')
    return {
      base_url: baseUrl,
      auth_type: 'api_key',
      auth_config: { key_name: 'X-API-KEY', key_value: credentials.api_key || '', add_to: 'header', ...(credentials.webhook_secret ? { webhook_secret: credentials.webhook_secret } : {}) },
    }
  },
}
