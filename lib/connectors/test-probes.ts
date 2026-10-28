import { JWT } from 'google-auth-library'
import { assertSafeEgressUrl } from '@/lib/egress-guard'
import { decryptSensitiveFields } from '@/lib/secret-fields'

interface IntegrationConfig {
  base_url: string
  auth_type: string
  auth_config?: Record<string, any>
  headers?: Record<string, string>
}

export interface ConnectorProbeResult {
  ok: boolean
  message: string
  statusCode?: number
}

interface ProbeRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: BodyInit
}

const TEST_TIMEOUT_MS = 10_000

function isJsonContentType(contentType: string | null) {
  return Boolean(contentType && contentType.toLowerCase().includes('application/json'))
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function parseJsonObject<T = Record<string, any>>(value: string | undefined): T {
  if (!value) throw new Error('Missing JSON credential payload')
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object for the service account credentials')
  }
  return parsed as T
}

function applyApiKeyToUrl(url: string, keyName: string, keyValue: string) {
  const next = new URL(url)
  next.searchParams.set(keyName, keyValue)
  return next.toString()
}

function buildUrl(baseUrl: string, path: string) {
  if (!path) return baseUrl
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return `${trimTrailingSlash(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`
}

async function resolveMicrosoftAccessToken(authConfig: Record<string, any>) {
  // Loaded on demand: @azure/identity is only needed for Microsoft probes.
  const { ClientSecretCredential } = await import('@azure/identity')
  const scope = authConfig.scope || 'https://graph.microsoft.com/.default'
  const credential = new ClientSecretCredential(
    authConfig.tenant_id,
    authConfig.client_id,
    authConfig.client_secret,
  )
  const token = await credential.getToken(scope)
  if (!token?.token) throw new Error('Microsoft token acquisition failed')
  return token.token
}

async function resolveGoogleAccessToken(authConfig: Record<string, any>) {
  const serviceAccount = parseJsonObject<{
    client_email?: string
    private_key?: string
  }>(authConfig.service_account_json)

  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('Service account JSON is missing client_email or private_key')
  }

  const jwt = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: Array.isArray(authConfig.scopes) ? authConfig.scopes : [],
    subject: authConfig.impersonate_email || undefined,
  })

  const token = await jwt.authorize()
  if (!token.access_token) throw new Error('Google access token acquisition failed')
  return token.access_token
}

async function resolveBoxAccessToken(authConfig: Record<string, any>) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: authConfig.client_id || '',
    client_secret: authConfig.client_secret || '',
    box_subject_type: 'enterprise',
    box_subject_id: authConfig.enterprise_id || '',
  })

  const resp = await fetch('https://api.box.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
  })

  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || `Box token request failed with HTTP ${resp.status}`)
  }

  return payload.access_token as string
}

async function resolveDropboxAccessToken(credentials: Record<string, any>, integrationConfig: IntegrationConfig) {
  if (!credentials.refresh_token || !credentials.app_key || !credentials.app_secret) {
    return integrationConfig.auth_config?.token || ''
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: credentials.refresh_token,
    client_id: credentials.app_key,
    client_secret: credentials.app_secret,
  })

  const resp = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
  })

  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || `Dropbox token refresh failed with HTTP ${resp.status}`)
  }

  return payload.access_token as string
}

async function buildAuthHeaders(
  connectorKey: string,
  integrationConfig: IntegrationConfig,
  credentials: Record<string, any>,
) {
  const headers: Record<string, string> = {}
  const authConfig = integrationConfig.auth_config ?? {}

  if (integrationConfig.auth_type === 'bearer') {
    let token = authConfig.token || ''

    if (authConfig._executor === 'ms_client_credentials') {
      token = await resolveMicrosoftAccessToken(authConfig)
    } else if (authConfig._executor === 'google_service_account') {
      token = await resolveGoogleAccessToken(authConfig)
    } else if (authConfig._executor === 'box_ccg') {
      token = await resolveBoxAccessToken(authConfig)
    } else if (connectorKey === 'dropbox') {
      token = await resolveDropboxAccessToken(credentials, integrationConfig)
    }

    if (token) headers.Authorization = `Bearer ${token}`
  } else if (integrationConfig.auth_type === 'basic') {
    const encoded = Buffer.from(`${authConfig.username || ''}:${authConfig.password || ''}`).toString('base64')
    headers.Authorization = `Basic ${encoded}`
  }

  return headers
}

function applyStaticHeaders(target: Record<string, string>, integrationConfig: IntegrationConfig) {
  for (const [key, value] of Object.entries(integrationConfig.headers ?? {})) {
    if (!value || key.startsWith('_')) continue
    target[key] = value
  }
}

async function performProbe(
  connectorKey: string,
  integrationConfig: IntegrationConfig,
  config: Record<string, any>,
  credentials: Record<string, any>,
  request: ProbeRequest,
) {
  const headers: Record<string, string> = {}
  applyStaticHeaders(headers, integrationConfig)
  Object.assign(headers, await buildAuthHeaders(connectorKey, integrationConfig, credentials))
  Object.assign(headers, request.headers ?? {})

  let url = request.url
  if (integrationConfig.auth_type === 'api_key') {
    const authConfig = integrationConfig.auth_config ?? {}
    const keyName = authConfig.key_name ?? 'X-API-Key'
    const keyValue = authConfig.key_value ?? ''
    const addTo = authConfig.add_to ?? 'header'
    if (addTo === 'query') {
      url = applyApiKeyToUrl(url, keyName, keyValue)
    } else {
      headers[keyName] = keyValue
    }
  }

  await assertSafeEgressUrl(url)
  const resp = await fetch(url, {
    method: request.method ?? 'GET',
    headers,
    body: request.body,
    signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
  })

  return resp
}

function buildStandardMessage(serviceName: string, resp: Response) {
  return resp.ok
    ? `Connected successfully to ${serviceName} (HTTP ${resp.status})`
    : `${serviceName} responded with HTTP ${resp.status} ${resp.statusText}`
}

function normalizeSitePath(siteUrl: string) {
  const url = new URL(siteUrl)
  const path = url.pathname.replace(/\/+$/, '')
  return {
    host: url.hostname,
    path: path || '/',
  }
}

async function probeSlack(integrationConfig: IntegrationConfig, credentials: Record<string, any>) {
  const resp = await performProbe('slack', integrationConfig, {}, credentials, {
    url: buildUrl(integrationConfig.base_url, '/auth.test'),
  })
  const payload = await resp.json().catch(() => null)
  if (resp.ok && payload?.ok) {
    return { ok: true, message: `Connected to Slack workspace ${payload.team || 'workspace'} as ${payload.user || 'authenticated user'}`, statusCode: resp.status }
  }
  const error = payload?.error ? `Slack API rejected the token: ${payload.error}` : buildStandardMessage('Slack', resp)
  return { ok: false, message: error, statusCode: resp.status }
}

async function probeN8n(integrationConfig: IntegrationConfig, credentials: Record<string, any>) {
  const resp = await performProbe('n8n', integrationConfig, {}, credentials, {
    url: buildUrl(integrationConfig.base_url, '/api/v1/workflows?limit=1'),
  })
  const payload = await resp.json().catch(() => null)
  if (resp.ok) {
    const count = Array.isArray(payload?.data) ? payload.data.length : 0
    return { ok: true, message: `Connected to n8n and verified workflow API access${count ? ` (${count} workflow${count === 1 ? '' : 's'} in sample)` : ''}`, statusCode: resp.status }
  }
  return { ok: false, message: buildStandardMessage('n8n', resp), statusCode: resp.status }
}

async function probeSalesforce(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const apiVersion = config.api_version || 'v59.0'
  const resp = await performProbe('salesforce', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, `/services/data/${apiVersion}/limits`),
  })
  const payload = await resp.json().catch(() => null)
  if (resp.ok) {
    return { ok: true, message: `Connected to Salesforce and verified REST API access${payload?.DailyApiRequests ? ` (daily API limit visible)` : ''}`, statusCode: resp.status }
  }
  const firstError = Array.isArray(payload) ? payload[0]?.message : undefined
  return { ok: false, message: firstError || buildStandardMessage('Salesforce', resp), statusCode: resp.status }
}

async function probeJira(integrationConfig: IntegrationConfig, credentials: Record<string, any>) {
  const resp = await performProbe('jira', integrationConfig, {}, credentials, {
    url: buildUrl(integrationConfig.base_url, '/rest/api/3/myself'),
    headers: { Accept: 'application/json' },
  })
  const payload = await resp.json().catch(() => null)
  if (resp.ok) {
    return { ok: true, message: `Connected to Jira as ${payload?.displayName || payload?.emailAddress || 'authenticated user'}`, statusCode: resp.status }
  }
  return { ok: false, message: payload?.errorMessages?.join(', ') || buildStandardMessage('Jira', resp), statusCode: resp.status }
}

async function probeGoogleDrive(integrationConfig: IntegrationConfig, credentials: Record<string, any>) {
  const resp = await performProbe('google_drive', integrationConfig, {}, credentials, {
    url: buildUrl(integrationConfig.base_url, '/drive/v3/about?fields=user,storageQuota'),
  })
  const payload = await resp.json().catch(() => null)
  if (resp.ok) {
    const name = payload?.user?.displayName || payload?.user?.emailAddress || 'service account'
    return { ok: true, message: `Connected to Google Drive as ${name}`, statusCode: resp.status }
  }
  return { ok: false, message: payload?.error?.message || buildStandardMessage('Google Drive', resp), statusCode: resp.status }
}

async function probeGmail(integrationConfig: IntegrationConfig, credentials: Record<string, any>) {
  const resp = await performProbe('gmail', integrationConfig, {}, credentials, {
    url: buildUrl(integrationConfig.base_url, '/gmail/v1/users/me/profile'),
  })
  const payload = await resp.json().catch(() => null)
  if (resp.ok) {
    return { ok: true, message: `Connected to Gmail mailbox ${payload?.emailAddress || 'profile'}`, statusCode: resp.status }
  }
  return { ok: false, message: payload?.error?.message || buildStandardMessage('Gmail', resp), statusCode: resp.status }
}

async function probeGoogleTasks(integrationConfig: IntegrationConfig, credentials: Record<string, any>) {
  const resp = await performProbe('google_tasks', integrationConfig, {}, credentials, {
    url: buildUrl(integrationConfig.base_url, '/tasks/v1/users/@me/lists?maxResults=1'),
  })
  const payload = await resp.json().catch(() => null)
  if (resp.ok) {
    const count = Array.isArray(payload?.items) ? payload.items.length : 0
    return { ok: true, message: `Connected to Google Tasks${count ? ` and read ${count} task list sample` : ''}`, statusCode: resp.status }
  }
  return { ok: false, message: payload?.error?.message || buildStandardMessage('Google Tasks', resp), statusCode: resp.status }
}

async function probeSharePoint(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const site = normalizeSitePath(config.site_url)
  const resp = await performProbe('sharepoint', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, `/v1.0/sites/${site.host}:${site.path}?$select=id,displayName,webUrl`),
  })
  const payload = await resp.json().catch(() => null)
  if (resp.ok) {
    return { ok: true, message: `Connected to SharePoint site ${payload?.displayName || payload?.webUrl || config.site_url}`, statusCode: resp.status }
  }
  return { ok: false, message: payload?.error?.message || buildStandardMessage('SharePoint', resp), statusCode: resp.status }
}

async function probeOneDrive(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const path = config.default_user
    ? `/v1.0/users/${encodeURIComponent(config.default_user)}/drive?$select=id,driveType,owner`
    : '/v1.0/organization?$select=id,displayName'
  const resp = await performProbe('onedrive_business', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, path),
  })
  const payload = await resp.json().catch(() => null)
  if (resp.ok) {
    const name = config.default_user || payload?.value?.[0]?.displayName || 'tenant'
    return { ok: true, message: `Connected to OneDrive for Business for ${name}`, statusCode: resp.status }
  }
  return { ok: false, message: payload?.error?.message || buildStandardMessage('OneDrive for Business', resp), statusCode: resp.status }
}

async function probeExchange(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const path = config.default_user
    ? `/v1.0/users/${encodeURIComponent(config.default_user)}/mailFolders/inbox?$select=id,displayName,totalItemCount`
    : '/v1.0/organization?$select=id,displayName'
  const resp = await performProbe('exchange_online', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, path),
  })
  const payload = await resp.json().catch(() => null)
  if (resp.ok) {
    const label = config.default_user || payload?.value?.[0]?.displayName || 'tenant'
    return { ok: true, message: `Connected to Exchange Online for ${label}`, statusCode: resp.status }
  }
  return { ok: false, message: payload?.error?.message || buildStandardMessage('Exchange Online', resp), statusCode: resp.status }
}

async function probeDataverse(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const resp = await performProbe('ms_dataverse', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, '/api/data/v9.2/WhoAmI'),
    headers: { Accept: 'application/json' },
  })
  const payload = await resp.json().catch(() => null)
  if (resp.ok) {
    return { ok: true, message: `Connected to Dataverse environment ${config.environment_url}${payload?.OrganizationId ? ' and resolved application identity' : ''}`, statusCode: resp.status }
  }
  return { ok: false, message: payload?.error?.message || buildStandardMessage('Dataverse', resp), statusCode: resp.status }
}

async function probeDropbox(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const resp = await performProbe('dropbox', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, '/2/users/get_current_account'),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'null',
  })
  const payload = await resp.json().catch(() => null)
  if (resp.ok) {
    return { ok: true, message: `Connected to Dropbox account ${payload?.email || payload?.name?.display_name || 'authenticated account'}`, statusCode: resp.status }
  }
  return { ok: false, message: payload?.error_summary || buildStandardMessage('Dropbox', resp), statusCode: resp.status }
}

async function probeBox(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const resp = await performProbe('box', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, '/2.0/users/me'),
  })
  const payload = await resp.json().catch(() => null)
  if (resp.ok) {
    return { ok: true, message: `Connected to Box as ${payload?.login || payload?.name || 'authenticated user'}`, statusCode: resp.status }
  }
  return { ok: false, message: payload?.message || buildStandardMessage('Box', resp), statusCode: resp.status }
}

async function probeServiceNow(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const resp = await performProbe('servicenow', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, '/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id,user_name'),
  })
  const payload = await resp.json().catch(() => null)
  if (resp.ok) {
    const count = Array.isArray(payload?.result) ? payload.result.length : 0
    return { ok: true, message: `Connected to ServiceNow instance ${config.instance}${count ? ' and verified table API access' : ''}`, statusCode: resp.status }
  }
  return { ok: false, message: payload?.error?.message || buildStandardMessage('ServiceNow', resp), statusCode: resp.status }
}

async function probeOData(connectorKey: string, integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>, serviceName: string) {
  const resp = await performProbe(connectorKey, integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, '/$metadata'),
    headers: { Accept: 'application/xml, application/json;q=0.8, */*;q=0.5' },
  })
  const body = await resp.text()
  if (resp.ok) {
    const hasMetadata = /edmx:Edmx|<Schema\b|<EntityContainer\b/i.test(body)
    return {
      ok: hasMetadata,
      message: hasMetadata
        ? `Connected to ${serviceName} and retrieved service metadata`
        : `${serviceName} responded but did not return recognizable OData metadata`,
      statusCode: resp.status,
    }
  }
  return { ok: false, message: body || buildStandardMessage(serviceName, resp), statusCode: resp.status }
}

async function probeGeneric(connectorKey: string, integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const resp = await performProbe(connectorKey, integrationConfig, config, credentials, {
    url: integrationConfig.base_url,
  })
  let message = buildStandardMessage(connectorKey, resp)
  if (!resp.ok) {
    const contentType = resp.headers.get('content-type')
    if (isJsonContentType(contentType)) {
      const payload = await resp.json().catch(() => null)
      message = payload?.error?.message || payload?.message || message
    }
  }
  return { ok: resp.ok, message, statusCode: resp.status }
}

export async function runConnectorProbe(
  connectorKey: string,
  rawConfig: Record<string, any>,
  rawCredentials: Record<string, any>,
  rawIntegrationConfig: IntegrationConfig,
): Promise<ConnectorProbeResult> {
  // Safety net at the probe boundary: callers may hand us stored
  // (encrypted-at-rest) credentials — decrypt is an idempotent no-op for plaintext.
  const config = decryptSensitiveFields(rawConfig)
  const credentials = decryptSensitiveFields(rawCredentials)
  const integrationConfig = decryptSensitiveFields(rawIntegrationConfig)
  switch (connectorKey) {
    case 'slack':
      return probeSlack(integrationConfig, credentials)
    case 'n8n':
      return probeN8n(integrationConfig, credentials)
    case 'salesforce':
      return probeSalesforce(integrationConfig, config, credentials)
    case 'jira':
      return probeJira(integrationConfig, credentials)
    case 'gmail':
      return probeGmail(integrationConfig, credentials)
    case 'google_drive':
      return probeGoogleDrive(integrationConfig, credentials)
    case 'google_tasks':
      return probeGoogleTasks(integrationConfig, credentials)
    case 'sharepoint':
      return probeSharePoint(integrationConfig, config, credentials)
    case 'onedrive_business':
      return probeOneDrive(integrationConfig, config, credentials)
    case 'exchange_online':
      return probeExchange(integrationConfig, config, credentials)
    case 'ms_dataverse':
      return probeDataverse(integrationConfig, config, credentials)
    case 'dropbox':
      return probeDropbox(integrationConfig, config, credentials)
    case 'box':
      return probeBox(integrationConfig, config, credentials)
    case 'servicenow':
      return probeServiceNow(integrationConfig, config, credentials)
    case 'odata':
      return probeOData(connectorKey, integrationConfig, config, credentials, 'OData service')
    case 'sap_odata':
      return probeOData(connectorKey, integrationConfig, config, credentials, 'SAP OData service')
    default:
      return probeGeneric(connectorKey, integrationConfig, config, credentials)
  }
}
