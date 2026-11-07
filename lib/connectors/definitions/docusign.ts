import type { ConnectorDefinition } from '../registry'
import { API_BASE_URL_FIELD, esignReferenceTemplates, webhookSecretField } from '@/lib/esign/connector-templates'

/**
 * DocuSign eSignature (REST v2.1) — the shared e-sign actions (lib/esign).
 * Auth: Authorization Code Grant (access + refresh token, or the OAuth 2.0
 * Connect button on the integration) or JWT Grant (integration key, user ID
 * and RSA private key; service integrations). The account and its base URI
 * are discovered with /oauth/userinfo unless set here.
 *
 * Integrations stored by the earlier definition (raw REST templates with a
 * fixed base URL and account id) keep working: their references are left as
 * they are, and the base URL / auth shape is unchanged for them.
 */

const DEMO_REST = 'https://demo.docusign.net/restapi'
const PROD_REST = 'https://www.docusign.net/restapi'

function isDemo(config: Record<string, any>): boolean {
  const env = String(config.environment ?? '').toLowerCase()
  if (env) return env !== 'production'
  const base = String(config.base_url ?? '').toLowerCase()
  return !base || base === 'auto' || /demo\.docusign\.net/.test(base)
}

export const docusignConnector: ConnectorDefinition = {
  key: 'docusign',
  name: 'DocuSign',
  description: 'Send documents or templates for e-signature, track envelopes and recipients, download signed PDFs and certificates, embedded signing',
  category: 'productivity',
  icon: 'PenTool',
  color: '#4C00FF',
  docsUrl: 'https://developers.docusign.com/docs/esign-rest-api/reference/',
  recommendedPermissions: {
    title: 'DocuSign app (integration key)',
    items: [
      'Authorization Code Grant: scopes signature extended; redirect URI <your app>/api/connectors/oauth/callback',
      'JWT Grant: scopes signature impersonation; an RSA key pair on the integration key; the user grants consent once',
      'A sender user who can send envelopes and use the templates you reference',
      'Webhooks: a Connect configuration (JSON, HMAC on) pointing at the webhook URL shown in the docs',
    ],
    note: 'Demo (developer) accounts use account-d.docusign.com and demo.docusign.net; switch Environment to Production after go-live review.',
  },
  fields: [
    {
      key: 'environment',
      label: 'Environment',
      type: 'select',
      options: [
        { value: 'demo', label: 'Demo / developer sandbox' },
        { value: 'production', label: 'Production' },
      ],
      defaultValue: 'demo',
      helpText: 'Selects the OAuth server (account-d.docusign.com or account.docusign.com) used for tokens and account discovery',
    },
    {
      key: 'base_url',
      label: 'Account base URI',
      type: 'select',
      options: [
        { value: 'auto', label: 'Auto-detect (from /oauth/userinfo)' },
        { value: 'https://demo.docusign.net/restapi', label: 'Demo / Sandbox' },
        { value: 'https://na1.docusign.net/restapi', label: 'Production (NA1)' },
        { value: 'https://na2.docusign.net/restapi', label: 'Production (NA2)' },
        { value: 'https://na3.docusign.net/restapi', label: 'Production (NA3)' },
        { value: 'https://na4.docusign.net/restapi', label: 'Production (NA4)' },
        { value: 'https://ca.docusign.net/restapi', label: 'Production (CA)' },
        { value: 'https://eu.docusign.net/restapi', label: 'Production (EU)' },
        { value: 'https://au.docusign.net/restapi', label: 'Production (AU)' },
      ],
      defaultValue: 'auto',
      helpText: 'Auto-detect reads the account\'s base_uri from /oauth/userinfo (recommended)',
    },
    {
      key: 'account_id',
      label: 'Account ID (optional)',
      type: 'text',
      placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      helpText: 'API Account ID (GUID). Empty = the user\'s default account',
    },
    API_BASE_URL_FIELD,
    {
      key: 'default_return_url',
      label: 'Default return URL (embedded signing)',
      type: 'text',
      validation: { type: 'url' },
      helpText: 'Where a signer lands after embedded signing when the step does not set one',
    },
  ],
  credentialFields: [
    {
      key: 'auth_method',
      label: 'Authentication',
      type: 'select',
      options: [
        { value: 'authorization_code', label: 'Authorization Code Grant (access / refresh token)' },
        { value: 'jwt', label: 'JWT Grant (service integration)' },
      ],
      defaultValue: 'authorization_code',
    },
    {
      key: 'access_token',
      label: 'Access Token',
      type: 'password',
      visibleWhen: { field: 'auth_method', notEquals: 'jwt' },
      helpText: 'OAuth access token (8 hours). Add the integration key, secret and refresh token for automatic renewal — or use Connect (OAuth 2.0) on the integration.',
    },
    {
      key: 'client_id',
      label: 'Integration Key',
      type: 'text',
      requiredWhen: { field: 'auth_method', equals: 'jwt' },
      helpText: 'The integration key (client ID) of your DocuSign app',
    },
    {
      key: 'client_secret',
      label: 'Secret Key (optional)',
      type: 'password',
      visibleWhen: { field: 'auth_method', notEquals: 'jwt' },
    },
    {
      key: 'refresh_token',
      label: 'Refresh Token (optional)',
      type: 'password',
      visibleWhen: { field: 'auth_method', notEquals: 'jwt' },
      helpText: 'Refresh token from the Authorization Code Grant (scopes: signature extended)',
    },
    {
      key: 'user_id',
      label: 'User ID (GUID) to act as',
      type: 'text',
      visibleWhen: { field: 'auth_method', equals: 'jwt' },
      requiredWhen: { field: 'auth_method', equals: 'jwt' },
      helpText: 'The API username (user GUID) of the sender — Apps and Keys page',
    },
    {
      key: 'private_key',
      label: 'RSA Private Key',
      type: 'textarea',
      visibleWhen: { field: 'auth_method', equals: 'jwt' },
      requiredWhen: { field: 'auth_method', equals: 'jwt' },
      placeholder: '-----BEGIN RSA PRIVATE KEY-----',
      helpText: 'The private key of the RSA key pair added to the integration key (stored encrypted)',
    },
    webhookSecretField('DocuSign Connect HMAC key — turn on "Include HMAC signature" in the Connect configuration and paste the key here'),
  ],
  oauth: {
    authorizeUrl: 'https://account-d.docusign.com/oauth/auth',
    tokenUrl: 'https://account-d.docusign.com/oauth/token',
    defaultScopes: ['signature', 'extended'],
    clientAuth: 'basic',
  },
  referenceTemplates: esignReferenceTemplates('docusign'),
  buildIntegrationConfig: (config, credentials) => {
    const demo = isDemo(config)
    const chosen = String(config.base_url || '').trim().replace(/\/+$/, '')
    const baseUrl = chosen && chosen !== 'auto' ? chosen : demo ? DEMO_REST : PROD_REST
    const authServer = demo ? 'https://account-d.docusign.com' : 'https://account.docusign.com'
    const webhook = credentials.webhook_secret ? { webhook_secret: credentials.webhook_secret } : {}
    if (credentials.auth_method === 'jwt') {
      return {
        base_url: baseUrl,
        auth_type: 'bearer',
        auth_config: {
          _executor: 'docusign_jwt',
          client_id: credentials.client_id || '',
          user_id: credentials.user_id || '',
          private_key: credentials.private_key || '',
          environment: demo ? 'demo' : 'production',
          ...webhook,
        },
      }
    }
    if (credentials.refresh_token && credentials.client_id) {
      return {
        base_url: baseUrl,
        auth_type: 'bearer',
        auth_config: {
          _executor: 'oauth_refresh',
          client_auth: 'basic',
          token: credentials.access_token || '',
          refresh_token: credentials.refresh_token,
          client_id: credentials.client_id,
          client_secret: credentials.client_secret || '',
          token_url: `${authServer}/oauth/token`,
          ...webhook,
        },
      }
    }
    return {
      base_url: baseUrl,
      auth_type: 'bearer',
      auth_config: { token: credentials.access_token || '', ...webhook },
    }
  },
}
