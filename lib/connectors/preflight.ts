import { buildConnectorTestResult, type ConnectorTestResult } from "./test-diagnostics"
import { isCiphertext } from "@/lib/secret-format"

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
    if (hasValue(rawJson) && !isCiphertext(String(rawJson))) {
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

  if (connectorKey === 'salesforce') {
    const refreshFields = ['client_id', 'client_secret', 'refresh_token']
    const present = refreshFields.filter((key) => hasValue(credentials[key]))
    if (present.length > 0 && present.length < refreshFields.length) {
      const missing = refreshFields.filter((key) => !hasValue(credentials[key]))
      return buildConnectorTestResult(
        connectorKey,
        `Salesforce refresh-token auth is only partially configured: missing ${missing.join(', ')}.`,
        'error',
      )
    }
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
