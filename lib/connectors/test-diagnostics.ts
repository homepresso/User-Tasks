type TestResultStatus = 'success' | 'error'

export interface ConnectorTestResult {
  status: TestResultStatus
  message: string
  hint?: string
}

function includesAny(value: string, patterns: string[]) {
  const normalized = value.toLowerCase()
  return patterns.some((pattern) => normalized.includes(pattern))
}

function inferHint(connectorKey: string, message: string, statusCode?: number): string | undefined {
  const lower = message.toLowerCase()

  if (includesAny(lower, ['invalid url', 'only absolute urls are supported', 'failed to parse url'])) {
    return 'Check that the base URL or service URL is complete and starts with https://.'
  }

  if (includesAny(lower, ['fetch failed', 'getaddrinfo', 'enotfound', 'econnrefused', 'connect timeout', 'network'])) {
    return 'The remote service could not be reached. Verify the hostname, port, firewall rules, and whether the service is publicly accessible from the server runtime.'
  }

  if (statusCode === 401 || includesAny(lower, ['401', 'unauthorized', 'invalid authentication credentials'])) {
    if (['sharepoint', 'onedrive_business', 'exchange_online', 'ms_dataverse'].includes(connectorKey)) {
      return 'The Microsoft app registration is being rejected. Check tenant ID, client ID, client secret, admin consent, and that the app has the required Microsoft Graph or Dataverse application permissions.'
    }
    if (['gmail', 'google_drive', 'google_docs', 'google_tasks'].includes(connectorKey)) {
      return 'Google rejected the service account access. Check that the API is enabled, the JSON key is valid, and domain-wide delegation plus impersonation are configured where required.'
    }
    if (connectorKey === 'salesforce') {
      return 'Salesforce rejected the token. Confirm the instance URL matches the org, and if you use refresh flow ensure the Connected App consumer key, secret, and refresh token are all present.'
    }
    if (connectorKey === 'n8n') {
      return 'n8n rejected the API key. Make sure you are using the instance base URL and a current API key from Settings > API.'
    }
    return 'Authentication failed. Recheck the credential values and whether the token, secret, or password is still valid.'
  }

  if (statusCode === 403 || includesAny(lower, ['403', 'forbidden', 'insufficient', 'permission', 'access denied'])) {
    if (['sharepoint', 'onedrive_business', 'exchange_online'].includes(connectorKey)) {
      return 'The Microsoft app authenticated but lacks permission. Grant the required application permissions in Entra ID and ensure admin consent has been granted.'
    }
    if (connectorKey === 'ms_dataverse') {
      return 'The Dataverse app likely needs the correct application user setup and environment permissions in addition to API access.'
    }
    if (['gmail', 'google_drive', 'google_docs', 'google_tasks'].includes(connectorKey)) {
      return 'Google accepted the credentials but blocked access. Check sharing, delegation scope, and whether the impersonated user is allowed to access the target mailbox, document, or task list.'
    }
    return 'The credentials were accepted, but the service denied permission for this request. Check scopes, roles, or app permissions.'
  }

  if (statusCode === 404 || includesAny(lower, ['404', 'not found'])) {
    if (connectorKey === 'sharepoint') {
      return 'The SharePoint site URL may be wrong, or the app does not have access to that site collection.'
    }
    if (connectorKey === 'salesforce') {
      return 'The Salesforce instance URL may not match the org or pod hosting this environment.'
    }
    return 'The service is reachable, but the endpoint or target resource was not found. Verify the base URL and connector environment settings.'
  }

  if (connectorKey === 'mongodb' && includesAny(lower, ['authentication failed', 'bad auth'])) {
    return 'Check the MongoDB username, password, and whether the user has access to the selected database and auth source.'
  }

  if (connectorKey === 'aws_s3' && includesAny(lower, ['signature', 'access key id', 'secret access key'])) {
    return 'Verify the AWS access key, secret access key, bucket region, and that the IAM principal has S3 permissions for the bucket.'
  }

  if (connectorKey === 'azure_blob' && includesAny(lower, ['authenticationfailed', 'signature did not match', 'authorization'])) {
    return 'Verify the storage account name, whether you are using the correct account key or SAS token, and that the token covers the target container permissions.'
  }

  return undefined
}

export function buildConnectorTestResult(
  connectorKey: string,
  message: string,
  status: TestResultStatus = 'error',
  statusCode?: number,
): ConnectorTestResult {
  const hint = inferHint(connectorKey, message, statusCode)
  return { status, message, hint }
}
