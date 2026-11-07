import type { ConnectorDefinition } from '../registry'
import { API_BASE_URL_FIELD, esignReferenceTemplates, webhookSecretField } from '@/lib/esign/connector-templates'

/**
 * Dropbox Sign (formerly HelloSign, API v3) — the shared e-sign actions
 * (lib/esign). Auth: the API key (HTTP Basic user name) or OAuth (access +
 * refresh token of an API app). test_mode sends non-binding requests.
 */

const TOKEN_URL = 'https://app.hellosign.com/oauth/token'

export const dropboxSignConnector: ConnectorDefinition = {
  key: 'dropbox_sign',
  name: 'Dropbox Sign',
  description: 'Send signature requests (files or templates) with text tags, track signers, download signed PDFs, embedded signing, test mode',
  category: 'productivity',
  icon: 'PenTool',
  color: '#0061FE',
  docsUrl: 'https://developers.hellosign.com/api/reference/',
  recommendedPermissions: {
    title: 'Dropbox Sign API key or API app',
    items: [
      'API key: Settings → API → API key (any plan; test mode is free)',
      'Embedded signing: an API app (its client ID) with your domain allowed',
      'OAuth (acting for other accounts): API app with OAuth, redirect URI <your app>/api/connectors/oauth/callback',
      'Callbacks: set the account or app callback URL to the webhook URL shown in the docs',
    ],
    note: 'Leave Test mode on until your account is on a paid API plan — test requests are not legally binding.',
  },
  fields: [
    {
      key: 'test_mode',
      label: 'Test mode',
      type: 'select',
      options: [
        { value: 'true', label: 'On (non-binding test requests)' },
        { value: 'false', label: 'Off (production)' },
      ],
      defaultValue: 'true',
    },
    API_BASE_URL_FIELD,
  ],
  credentialFields: [
    {
      key: 'auth_method',
      label: 'Authentication',
      type: 'select',
      options: [
        { value: 'api_key', label: 'API key' },
        { value: 'oauth', label: 'OAuth access token (API app)' },
      ],
      defaultValue: 'api_key',
    },
    {
      key: 'api_key',
      label: 'API Key',
      type: 'password',
      visibleWhen: { field: 'auth_method', notEquals: 'oauth' },
      requiredWhen: { field: 'auth_method', notEquals: 'oauth' },
      helpText: 'Also verifies callbacks (event_hash)',
    },
    { key: 'access_token', label: 'Access Token', type: 'password', visibleWhen: { field: 'auth_method', equals: 'oauth' } },
    { key: 'refresh_token', label: 'Refresh Token (optional)', type: 'password', visibleWhen: { field: 'auth_method', equals: 'oauth' } },
    { key: 'client_id', label: 'API App Client ID (optional)', type: 'text', helpText: 'Needed for embedded signing and OAuth refresh' },
    { key: 'client_secret', label: 'API App Client Secret (optional)', type: 'password', visibleWhen: { field: 'auth_method', equals: 'oauth' } },
    webhookSecretField('With OAuth only: the API key of the app owner, used to verify callback event hashes (API-key connectors use the API key)'),
  ],
  oauth: {
    authorizeUrl: 'https://app.hellosign.com/oauth/authorize',
    tokenUrl: TOKEN_URL,
    defaultScopes: [],
  },
  referenceTemplates: esignReferenceTemplates('dropbox_sign'),
  buildIntegrationConfig: (config, credentials) => {
    const baseUrl = String(config.api_base_url || '').trim().replace(/\/+$/, '') || 'https://api.hellosign.com/v3'
    const extra = credentials.webhook_secret ? { webhook_secret: credentials.webhook_secret } : {}
    if (credentials.auth_method === 'oauth') {
      if (credentials.refresh_token && credentials.client_id) {
        return {
          base_url: baseUrl,
          auth_type: 'bearer',
          auth_config: {
            _executor: 'oauth_refresh',
            token: credentials.access_token || '',
            refresh_token: credentials.refresh_token,
            client_id: credentials.client_id,
            client_secret: credentials.client_secret || '',
            token_url: TOKEN_URL,
            ...extra,
          },
        }
      }
      return { base_url: baseUrl, auth_type: 'bearer', auth_config: { token: credentials.access_token || '', ...extra } }
    }
    return { base_url: baseUrl, auth_type: 'basic', auth_config: { username: credentials.api_key || '', password: '', ...extra } }
  },
}
