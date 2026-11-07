import type { ConnectorDefinition } from '../registry'
import { API_BASE_URL_FIELD, esignReferenceTemplates, webhookSecretField } from '@/lib/esign/connector-templates'

/**
 * PandaDoc (public API v1) — the shared e-sign actions (lib/esign). Auth:
 * `Authorization: API-Key <key>` or OAuth (access + refresh token).
 */

const TOKEN_URL = 'https://api.pandadoc.com/oauth2/access_token'

export const pandadocConnector: ConnectorDefinition = {
  key: 'pandadoc',
  name: 'PandaDoc',
  description: 'Create documents from files or templates (tokens, roles), send for e-signature, track recipients, download completed PDFs',
  category: 'productivity',
  icon: 'PenTool',
  color: '#248567',
  docsUrl: 'https://developers.pandadoc.com/reference/about',
  recommendedPermissions: {
    title: 'PandaDoc API key or OAuth app',
    items: [
      'API key: Settings → Integrations → API (Sandbox key for testing, Production key after enabling API access)',
      'OAuth: an application with redirect URI <your app>/api/connectors/oauth/callback, scope read+write',
      'Webhooks: Settings → Integrations → Webhooks, URL from the docs, events Document state changed and Recipient completed; copy the shared key',
    ],
    note: 'Sandbox API keys send watermarked documents and are rate-limited (10 requests per minute).',
  },
  fields: [API_BASE_URL_FIELD],
  credentialFields: [
    {
      key: 'auth_method',
      label: 'Authentication',
      type: 'select',
      options: [
        { value: 'api_key', label: 'API key' },
        { value: 'oauth', label: 'OAuth access token' },
      ],
      defaultValue: 'api_key',
    },
    { key: 'api_key', label: 'API Key', type: 'password', visibleWhen: { field: 'auth_method', notEquals: 'oauth' }, requiredWhen: { field: 'auth_method', notEquals: 'oauth' } },
    { key: 'access_token', label: 'Access Token', type: 'password', visibleWhen: { field: 'auth_method', equals: 'oauth' } },
    { key: 'refresh_token', label: 'Refresh Token (optional)', type: 'password', visibleWhen: { field: 'auth_method', equals: 'oauth' } },
    { key: 'client_id', label: 'Client ID (optional)', type: 'text', visibleWhen: { field: 'auth_method', equals: 'oauth' } },
    { key: 'client_secret', label: 'Client Secret (optional)', type: 'password', visibleWhen: { field: 'auth_method', equals: 'oauth' } },
    webhookSecretField('The webhook shared key (verifies ?signature= on each delivery)'),
  ],
  oauth: {
    authorizeUrl: 'https://app.pandadoc.com/oauth2/authorize',
    tokenUrl: TOKEN_URL,
    defaultScopes: ['read+write'],
  },
  referenceTemplates: esignReferenceTemplates('pandadoc'),
  buildIntegrationConfig: (config, credentials) => {
    const baseUrl = String(config.api_base_url || '').trim().replace(/\/+$/, '') || 'https://api.pandadoc.com/public/v1'
    const extra = credentials.webhook_secret ? { webhook_secret: credentials.webhook_secret } : {}
    if (credentials.auth_method === 'oauth') {
      if (credentials.refresh_token && credentials.client_id) {
        return {
          base_url: baseUrl,
          auth_type: 'bearer',
          auth_config: { _executor: 'oauth_refresh', token: credentials.access_token || '', refresh_token: credentials.refresh_token, client_id: credentials.client_id, client_secret: credentials.client_secret || '', token_url: TOKEN_URL, ...extra },
        }
      }
      return { base_url: baseUrl, auth_type: 'bearer', auth_config: { token: credentials.access_token || '', ...extra } }
    }
    const key = String(credentials.api_key || '').replace(/^API-Key\s+/i, '')
    return { base_url: baseUrl, auth_type: 'api_key', auth_config: { key_name: 'Authorization', key_value: key ? `API-Key ${key}` : '', add_to: 'header', ...extra } }
  },
}
