import type { ConnectorDefinition } from '../registry'
import { API_BASE_URL_FIELD, esignReferenceTemplates, webhookSecretField } from '@/lib/esign/connector-templates'

/**
 * Adobe Acrobat Sign (REST v6) — the shared e-sign actions (lib/esign).
 * Auth: an integration key, or OAuth 2.0 (access + refresh token; refresh at
 * https://api.<shard>.adobesign.com/oauth/v2/refresh). The API access point
 * is discovered with GET /api/rest/v6/baseUris.
 */

const ADOBE_SCOPES = [
  'user_read:account', 'user_login:account', 'agreement_read:account', 'agreement_write:account', 'agreement_send:account',
  'library_read:account', 'webhook_read:account', 'webhook_write:account', 'webhook_retention:account',
]

function shardOf(config: Record<string, any>): string {
  const shard = String(config.shard || 'na1').trim().toLowerCase()
  return /^[a-z]{2}\d{1,2}$/.test(shard) ? shard : 'na1'
}

export const adobeSignConnector: ConnectorDefinition = {
  key: 'adobe_sign',
  name: 'Adobe Acrobat Sign',
  description: 'Send agreements for e-signature from files or library templates, track participants, download signed PDFs and audit reports',
  category: 'productivity',
  icon: 'PenTool',
  color: '#EB1000',
  docsUrl: 'https://secure.na1.adobesign.com/public/docs/restapi/v6',
  recommendedPermissions: {
    title: 'Acrobat Sign API application',
    items: [
      `OAuth scopes: ${ADOBE_SCOPES.join(' ')}`,
      'Redirect URI: <your app>/api/connectors/oauth/callback',
      'Or an integration key (Account → Acrobat Sign API → API Information) with the same scopes',
      'Webhooks: register the webhook URL shown in the docs (it carries the webhook secret as ?token=)',
    ],
    note: 'Developer accounts are free and behave like production (agreements are watermarked).',
  },
  fields: [
    {
      key: 'shard',
      label: 'Shard',
      type: 'text',
      placeholder: 'na1',
      defaultValue: 'na1',
      helpText: 'Your account\'s shard (na1, na2, eu1, eu2, jp1, au1, in1 …) — the API access point is discovered from it',
    },
    API_BASE_URL_FIELD,
  ],
  credentialFields: [
    {
      key: 'access_token',
      label: 'Integration Key or Access Token',
      type: 'password',
      helpText: 'An integration key (long-lived), or an OAuth access token — add the client ID, secret and refresh token for renewal',
    },
    { key: 'client_id', label: 'OAuth Client ID', type: 'text', helpText: 'Application ID — also verifies webhook deliveries (X-AdobeSign-ClientId)' },
    { key: 'client_secret', label: 'OAuth Client Secret (optional)', type: 'password' },
    { key: 'refresh_token', label: 'Refresh Token (optional)', type: 'password' },
    webhookSecretField('Any long random string: append ?token=<secret> to the webhook URL you register in Acrobat Sign'),
  ],
  oauth: {
    authorizeUrl: 'https://secure.na1.adobesign.com/public/oauth/v2',
    tokenUrl: 'https://api.na1.adobesign.com/oauth/v2/token',
    refreshUrl: 'https://api.na1.adobesign.com/oauth/v2/refresh',
    defaultScopes: ADOBE_SCOPES,
  },
  referenceTemplates: esignReferenceTemplates('adobe_sign'),
  buildIntegrationConfig: (config, credentials) => {
    const shard = shardOf(config)
    const override = String(config.api_base_url || '').trim().replace(/\/+$/, '')
    const baseUrl = override || `https://api.${shard}.adobesign.com/api/rest/v6`
    const extra = {
      ...(credentials.client_id ? { client_id: credentials.client_id } : {}),
      ...(credentials.webhook_secret ? { webhook_secret: credentials.webhook_secret } : {}),
    }
    if (credentials.refresh_token && credentials.client_id) {
      return {
        base_url: baseUrl,
        auth_type: 'bearer',
        auth_config: {
          _executor: 'oauth_refresh',
          token: credentials.access_token || '',
          refresh_token: credentials.refresh_token,
          client_secret: credentials.client_secret || '',
          token_url: `https://api.${shard}.adobesign.com/oauth/v2/refresh`,
          ...extra,
        },
      }
    }
    return { base_url: baseUrl, auth_type: 'bearer', auth_config: { token: credentials.access_token || '', ...extra } }
  },
}
