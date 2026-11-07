import type { ConnectorDefinition } from '../registry'
import { API_BASE_URL_FIELD, esignReferenceTemplates, webhookSecretField } from '@/lib/esign/connector-templates'

/**
 * SignNow (REST API) — the shared e-sign actions (lib/esign). Auth: the
 * password grant for a service user, or OAuth (access + refresh token); the
 * client authenticates with its Basic authorization token.
 */

function apiBase(config: Record<string, any>): string {
  const override = String(config.api_base_url || '').trim().replace(/\/+$/, '')
  if (override) return override
  return config.environment === 'sandbox' ? 'https://api-eval.signnow.com' : 'https://api.signnow.com'
}

export const signnowConnector: ConnectorDefinition = {
  key: 'signnow',
  name: 'SignNow',
  description: 'Upload documents with text tags or copy templates, invite signers by role, track invites, download signed PDFs with history',
  category: 'productivity',
  icon: 'PenTool',
  color: '#1E4D8C',
  docsUrl: 'https://docs.signnow.com/docs/signnow/welcome',
  recommendedPermissions: {
    title: 'SignNow API application',
    items: [
      'An API application (developer sandbox: app-eval.signnow.com) — its client ID and client secret',
      'Service user: the user name and password the workflows send as (password grant), or OAuth with redirect URI <your app>/api/connectors/oauth/callback',
      'Event subscriptions (document.complete, document.fieldinvite.signed / decline) with a secret key, callback = the webhook URL shown in the docs',
    ],
    note: 'The sandbox (api-eval.signnow.com) is free; documents sent there are not legally binding.',
  },
  fields: [
    {
      key: 'environment',
      label: 'Environment',
      type: 'select',
      options: [
        { value: 'production', label: 'Production (api.signnow.com)' },
        { value: 'sandbox', label: 'Sandbox (api-eval.signnow.com)' },
      ],
      defaultValue: 'production',
    },
    { key: 'sender_email', label: 'Sender email (optional)', type: 'text', validation: { type: 'email' }, helpText: 'The "from" address of invites (default: the authenticated user)' },
    API_BASE_URL_FIELD,
  ],
  credentialFields: [
    {
      key: 'auth_method',
      label: 'Authentication',
      type: 'select',
      options: [
        { value: 'password', label: 'Service user (password grant)' },
        { value: 'oauth', label: 'OAuth access / refresh token' },
      ],
      defaultValue: 'password',
    },
    { key: 'client_id', label: 'Client ID', type: 'text', required: true },
    { key: 'client_secret', label: 'Client Secret', type: 'password', required: true },
    { key: 'username', label: 'User name (email)', type: 'text', visibleWhen: { field: 'auth_method', notEquals: 'oauth' }, requiredWhen: { field: 'auth_method', notEquals: 'oauth' } },
    { key: 'password', label: 'Password', type: 'password', visibleWhen: { field: 'auth_method', notEquals: 'oauth' }, requiredWhen: { field: 'auth_method', notEquals: 'oauth' } },
    { key: 'access_token', label: 'Access Token', type: 'password', visibleWhen: { field: 'auth_method', equals: 'oauth' } },
    { key: 'refresh_token', label: 'Refresh Token', type: 'password', visibleWhen: { field: 'auth_method', equals: 'oauth' } },
    webhookSecretField('The secret_key of your event subscriptions (verifies X-SignNow-Signature)'),
  ],
  oauth: {
    authorizeUrl: 'https://app.signnow.com/authorize',
    tokenUrl: 'https://api.signnow.com/oauth2/token',
    defaultScopes: ['*'],
    clientAuth: 'basic',
  },
  referenceTemplates: esignReferenceTemplates('signnow'),
  buildIntegrationConfig: (config, credentials) => {
    const baseUrl = apiBase(config)
    const extra = credentials.webhook_secret ? { webhook_secret: credentials.webhook_secret } : {}
    const client = { client_id: credentials.client_id || '', client_secret: credentials.client_secret || '' }
    if (credentials.auth_method === 'oauth') {
      if (credentials.refresh_token) {
        return { base_url: baseUrl, auth_type: 'bearer', auth_config: { _executor: 'oauth_refresh', client_auth: 'basic', token: credentials.access_token || '', refresh_token: credentials.refresh_token, token_url: `${baseUrl}/oauth2/token`, ...client, ...extra } }
      }
      return { base_url: baseUrl, auth_type: 'bearer', auth_config: { token: credentials.access_token || '', ...extra } }
    }
    return {
      base_url: baseUrl,
      auth_type: 'bearer',
      auth_config: { _executor: 'oauth_password', token_url: `${baseUrl}/oauth2/token`, username: credentials.username || '', password: credentials.password || '', ...client, ...extra },
    }
  },
}
