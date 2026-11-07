import { buildConnectorTestResult, type ConnectorTestResult } from "./test-diagnostics"
import { isMaskedSecret } from "@/lib/secret-format"

type Values = Record<string, any>

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

function missingKeys(values: Values, keys: string[]) {
  return keys.filter((key) => !hasValue(values[key]))
}

export function runConnectorPreflight(
  connectorKey: string,
  config: Values,
  credentials: Values,
): ConnectorTestResult | null {
  if (['sharepoint', 'onedrive_business', 'exchange_online', 'ms_dataverse'].includes(connectorKey)) {
    const missing = missingKeys(config, ['tenant_id']).concat(missingKeys(credentials, ['client_id', 'client_secret']))
    if (missing.length > 0) {
      return buildConnectorTestResult(
        connectorKey,
        `Microsoft app registration setup is incomplete: missing ${missing.join(', ')}.`,
        'error',
      )
    }
  }

  if (['gmail', 'google_drive', 'google_docs', 'google_tasks'].includes(connectorKey)) {
    const rawJson = credentials.service_account_json
    // Encrypted-at-rest values (`enc:v1:…` / `enc:v2:…`) can reach client-side preflight via
    // edit-form round-trips; skip JSON checks for those (server decrypts first).
    if (hasValue(rawJson) && !isMaskedSecret(rawJson)) {
      try {
        const parsed = JSON.parse(String(rawJson))
        const missing = ['client_email', 'private_key'].filter((key) => !hasValue(parsed[key]))
        if (missing.length > 0) {
          return buildConnectorTestResult(
            connectorKey,
            `The service account JSON is missing required keys: ${missing.join(', ')}.`,
            'error',
          )
        }
      } catch {
        return buildConnectorTestResult(connectorKey, 'The service account JSON could not be parsed.', 'error')
      }
    }

    if ((connectorKey === 'gmail' || connectorKey === 'google_tasks') && !hasValue(credentials.impersonate_email)) {
      return buildConnectorTestResult(
        connectorKey,
        'An impersonated user email is required for this connector.',
        'error',
      )
    }
  }

  // Refresh-token renewal needs the client id and the refresh token together
  // (the secret is optional for public clients but required by these providers).
  const refreshLabels: Record<string, string> = {
    salesforce: 'Salesforce',
    servicenow: 'ServiceNow',
    workday: 'Workday',
    docusign: 'DocuSign',
  }
  if (refreshLabels[connectorKey] && !(connectorKey === 'docusign' && credentials.auth_method === 'jwt')) {
    const refreshFields = ['client_id', 'client_secret', 'refresh_token']
    const present = refreshFields.filter((key) => hasValue(credentials[key]))
    if (present.length > 0 && present.length < refreshFields.length) {
      const missing = refreshFields.filter((key) => !hasValue(credentials[key]))
      return buildConnectorTestResult(
        connectorKey,
        `${refreshLabels[connectorKey]} refresh-token auth is only partially configured: missing ${missing.join(', ')}.`,
        'error',
      )
    }
  }

  if (connectorKey === 'twilio') {
    const hasApiKey = hasValue(credentials.api_key_sid) && hasValue(credentials.api_key_secret)
    if (!hasValue(credentials.account_sid)) {
      return buildConnectorTestResult(connectorKey, 'The Twilio Account SID is required (it is part of every API path).', 'error')
    }
    if (!hasApiKey && !hasValue(credentials.auth_token)) {
      return buildConnectorTestResult(connectorKey, 'Provide the Auth Token, or an API Key SID and secret.', 'error')
    }
    if (hasValue(credentials.api_key_sid) !== hasValue(credentials.api_key_secret)) {
      return buildConnectorTestResult(connectorKey, 'Provide both the API Key SID and the API Key Secret (or neither).', 'error')
    }
  }

  if (connectorKey === 'stripe' && hasValue(credentials.secret_key) && !isMaskedSecret(credentials.secret_key)) {
    const key = String(credentials.secret_key)
    const live = /^(sk|rk)_live_/.test(key)
    const test = /^(sk|rk)_test_/.test(key)
    if (/^pk_/.test(key)) {
      return buildConnectorTestResult(connectorKey, 'That is a publishable key (pk_…) — use a secret (sk_…) or restricted (rk_…) key.', 'error')
    }
    if ((config.mode === 'live' && test) || (config.mode === 'test' && live)) {
      return buildConnectorTestResult(connectorKey, `The key is a ${live ? 'live' : 'test'}-mode key but Mode is set to ${config.mode}.`, 'error')
    }
  }

  if (connectorKey === 'docusign') {
    if (credentials.auth_method === 'jwt') {
      const missing = missingKeys(credentials, ['client_id', 'user_id', 'private_key'])
      if (missing.length) return buildConnectorTestResult(connectorKey, `DocuSign JWT Grant needs ${missing.join(', ')}.`, 'error')
    } else if (!hasValue(credentials.access_token) && !hasValue(credentials.refresh_token)) {
      return buildConnectorTestResult(connectorKey, 'Paste a DocuSign access token (or the refresh token with the integration key and secret), choose JWT Grant, or use Connect (OAuth 2.0) on the integration.', 'error')
    }
  }

  // E-signature connectors: the credentials each auth method needs.
  if (connectorKey === 'adobe_sign' && !hasValue(credentials.access_token) && !hasValue(credentials.refresh_token)) {
    return buildConnectorTestResult(connectorKey, 'Paste an Acrobat Sign integration key or OAuth access token (or a refresh token with the client ID and secret).', 'error')
  }
  if (connectorKey === 'adobe_sign' && hasValue(credentials.refresh_token) && missingKeys(credentials, ['client_id', 'client_secret']).length) {
    return buildConnectorTestResult(connectorKey, 'Acrobat Sign token refresh needs the OAuth client ID and client secret.', 'error')
  }
  if ((connectorKey === 'dropbox_sign' || connectorKey === 'pandadoc') && credentials.auth_method === 'oauth' && !hasValue(credentials.access_token) && !hasValue(credentials.refresh_token)) {
    return buildConnectorTestResult(connectorKey, 'Paste the OAuth access token (or a refresh token with the client ID and secret).', 'error')
  }
  if (connectorKey === 'signnow' && credentials.auth_method === 'oauth' && !hasValue(credentials.access_token) && !hasValue(credentials.refresh_token)) {
    return buildConnectorTestResult(connectorKey, 'Paste the SignNow access token or refresh token, or use the service-user (password) method.', 'error')
  }

  if (connectorKey === 'workday' && credentials.auth_type !== 'basic' && !hasValue(config.tenant) && !hasValue(config.default_tenant)) {
    return buildConnectorTestResult(connectorKey, 'Set the Workday tenant name — every REST path includes it.', 'error')
  }

  if (connectorKey === 'azure_blob') {
    const hasAccountKey = hasValue(credentials.account_key)
    const hasSasToken = hasValue(credentials.sas_token)
    if (!hasAccountKey && !hasSasToken) {
      return buildConnectorTestResult(
        connectorKey,
        'Provide either an account key or a SAS token before testing Azure Blob Storage.',
        'error',
      )
    }
    if (hasAccountKey && hasSasToken) {
      return buildConnectorTestResult(
        connectorKey,
        'Use either an account key or a SAS token for Azure Blob Storage, not both at the same time.',
        'error',
      )
    }
  }

  if (connectorKey === 'dropbox' && hasValue(credentials.refresh_token)) {
    const missing = missingKeys(credentials, ['app_key', 'app_secret'])
    if (missing.length > 0) {
      return buildConnectorTestResult(
        connectorKey,
        `Dropbox token refresh is enabled but missing ${missing.join(', ')}.`,
        'error',
      )
    }
  }

  if (connectorKey === 'box') {
    if (credentials.auth_type === 'client_credentials') {
      const missing = missingKeys(credentials, ['client_id', 'client_secret', 'enterprise_id'])
      if (missing.length > 0) {
        return buildConnectorTestResult(
          connectorKey,
          `Box server-to-server auth is incomplete: missing ${missing.join(', ')}.`,
          'error',
        )
      }
    }
    if (credentials.auth_type === 'developer_token' && !hasValue(credentials.access_token)) {
      return buildConnectorTestResult(
        connectorKey,
        'A Box developer token or access token is required for developer-token mode.',
        'error',
      )
    }
  }

  return null
}
