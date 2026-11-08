import { applyAuthHeaders } from '@/lib/integrations/attach-auth'
import { connectorFetch } from '@/lib/integrations/http'
import { mintFromRefreshToken } from '@/lib/integrations/token-mint'
import { decryptSensitiveFields } from '@/lib/secret-fields'
import { isTeamsWebhookUrl } from './definitions/ms-teams'
import { SALESFORCE_DEFAULT_API_VERSION } from './definitions/salesforce'
import { getConnectorDefinition } from './registry'

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

function buildUrl(baseUrl: string, path: string) {
  if (!path) return baseUrl
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return `${trimTrailingSlash(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Probe auth = runtime auth: the same attach-auth / token-mint code the
 * reference executor uses (static tokens, basic, api_key header/query,
 * Google / Microsoft / Box / refresh-token mints, UKG customer key).
 */
async function applyProbeAuth(
  connectorKey: string,
  integrationConfig: IntegrationConfig,
  credentials: Record<string, any>,
  headers: Record<string, string>,
  query: Record<string, string>,
) {
  // Dropbox connectors stored before the refresh-token executor existed keep
  // the app key / secret / refresh token only in the connector credentials.
  if (connectorKey === 'dropbox' && integrationConfig.auth_config?._executor !== 'oauth_refresh'
    && credentials.refresh_token && credentials.app_key && credentials.app_secret) {
    const minted = await mintFromRefreshToken({
      token_url: 'https://api.dropboxapi.com/oauth2/token',
      refresh_token: credentials.refresh_token,
      client_id: credentials.app_key,
      client_secret: credentials.app_secret,
    })
    headers.Authorization = `Bearer ${minted.token}`
    return
  }
  // Authorization-code (oauth2) connectors need the token store; their
  // probe goes through the OAuth connect flow instead.
  if (integrationConfig.auth_type === 'oauth2') return
  await applyAuthHeaders(integrationConfig, headers, {}, query)
}

function applyStaticHeaders(target: Record<string, string>, integrationConfig: IntegrationConfig) {
  for (const [key, value] of Object.entries(integrationConfig.headers ?? {})) {
    if (!value || key.startsWith('_')) continue
    // A legacy CSRF "fetch" marker is not a header to send.
    if (key.toLowerCase() === 'x-csrf-token' && String(value).toLowerCase() === 'fetch') continue
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
  const query: Record<string, string> = {}
  await applyProbeAuth(connectorKey, integrationConfig, credentials, headers, query)
  Object.assign(headers, request.headers ?? {})

  let url = request.url
  if (Object.keys(query).length > 0) {
    const next = new URL(url)
    for (const [k, v] of Object.entries(query)) next.searchParams.set(k, v)
    url = next.toString()
  }

  // Egress guard on every hop (redirects re-checked), bounded time, no retry storm.
  return connectorFetch(url, {
    method: request.method ?? 'GET',
    headers,
    body: request.body,
  }, { timeoutMs: TEST_TIMEOUT_MS, maxAttempts: 1 })
}

/**
 * The URL a connection test reaches: the integration's base_url, or — like
 * the reference executor — the (secret) webhook URL kept in
 * auth_config.webhook_url when base_url is intentionally empty (Teams
 * Workflows webhooks).
 */
export function resolveConnectorProbeUrl(integrationConfig: { base_url?: unknown; auth_config?: Record<string, any> | null }): { url: string; fromWebhook: boolean } {
  const base = typeof integrationConfig?.base_url === 'string' ? integrationConfig.base_url.trim() : ''
  if (base) return { url: base, fromWebhook: false }
  const webhook = integrationConfig?.auth_config?.webhook_url
  if (typeof webhook === 'string' && webhook.trim()) return { url: webhook.trim(), fromWebhook: true }
  return { url: '', fromWebhook: false }
}

/**
 * Teams Workflows webhooks have no read-only endpoint: any request that
 * passes the signature check runs the flow and posts to the channel. So the
 * test checks the URL shape (Workflows / Logic Apps host, signed) without
 * posting anything; the Send Channel Message reference posts a real card.
 */
function probeTeamsWebhook(integrationConfig: IntegrationConfig): ConnectorProbeResult {
  const { url } = resolveConnectorProbeUrl(integrationConfig)
  if (!url) return { ok: false, message: 'The Workflows webhook URL is missing.' }
  if (!isTeamsWebhookUrl(url)) {
    return { ok: false, message: 'That is not a Teams Workflows webhook URL (expected https://…logic.azure.com/… or …powerplatform.com/…).' }
  }
  if (/\.webhook\.office\.com/i.test(new URL(url).hostname)) {
    return { ok: false, message: 'Classic Office 365 connector webhooks (webhook.office.com) were retired by Microsoft in May 2026 — create a Workflows webhook in Teams instead.' }
  }
  if (!new URL(url).searchParams.get('sig')) {
    return { ok: false, message: 'The webhook URL is missing its signature (sig=…) — copy the full URL from the Teams Workflows step.' }
  }
  return { ok: true, message: 'Workflows webhook URL looks valid. Nothing was posted — run Send Channel Message to post a test card to the channel.' }
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
  const apiVersion = config.api_version || SALESFORCE_DEFAULT_API_VERSION
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


// ─── Credential probes (CRM / HR / payments / messaging / AI) ───

async function readJson(resp: Response): Promise<any> {
  return resp.json().catch(() => null)
}

function firstErrorMessage(payload: any): string | undefined {
  if (!payload) return undefined
  if (Array.isArray(payload)) return payload[0]?.message
  return payload?.error?.message
    || (typeof payload?.error === 'string' ? payload.error : undefined)
    || payload?.message
    || payload?.errors?.[0]?.message
    || payload?.error_description
    || payload?.errorMessages?.[0]
}

async function simpleProbe(
  connectorKey: string,
  serviceName: string,
  integrationConfig: IntegrationConfig,
  config: Record<string, any>,
  credentials: Record<string, any>,
  request: ProbeRequest,
  success: (payload: any) => string,
): Promise<ConnectorProbeResult> {
  const resp = await performProbe(connectorKey, integrationConfig, config, credentials, request)
  const payload = await readJson(resp)
  if (resp.ok) return { ok: true, message: success(payload), statusCode: resp.status }
  return { ok: false, message: firstErrorMessage(payload) || buildStandardMessage(serviceName, resp), statusCode: resp.status }
}

async function probeWorkday(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const tenant = String(config.tenant || config.default_tenant || '').trim()
  if (!tenant) return { ok: false, message: 'Set the Workday tenant name to test the connection.' }
  if (integrationConfig.auth_type === 'basic') {
    // ISU Basic auth only reaches RaaS; the REST API needs OAuth.
    return { ok: true, message: 'Basic (ISU) credentials saved — they work for RaaS custom reports only; REST actions need OAuth 2.0.' }
  }
  return simpleProbe('workday', 'Workday', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, `/ccx/api/common/v1/${encodeURIComponent(tenant)}/workers?limit=1`),
    headers: { Accept: 'application/json' },
  }, () => `Connected to Workday tenant ${tenant} and verified REST API access`)
}

async function probeUkgPro(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  return simpleProbe('ukg_pro', 'UKG Pro', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, '/personnel/v1/org-levels?per_page=1'),
    headers: { Accept: 'application/json' },
  }, () => 'Connected to UKG Pro and verified web service access')
}

async function probeDocuSign(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const accountId = String(config.account_id || '').trim()
  if (!accountId) return { ok: false, message: 'Set the DocuSign Account ID to test the connection.' }
  return simpleProbe('docusign', 'DocuSign', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, `/v2.1/accounts/${encodeURIComponent(accountId)}`),
    headers: { Accept: 'application/json' },
  }, (p) => `Connected to DocuSign account ${p?.accountName || accountId}`)
}

async function probeTwilio(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const sid = String(credentials.account_sid || '').trim()
  if (!sid) return { ok: false, message: 'Set the Twilio Account SID to test the connection.' }
  return simpleProbe('twilio', 'Twilio', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, `/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`),
  }, (p) => `Connected to Twilio account ${p?.friendly_name || sid}${p?.status && p.status !== 'active' ? ` (status: ${p.status})` : ''}`)
}

async function probeSendGrid(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const resp = await performProbe('sendgrid', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, '/v3/scopes'),
  })
  const payload = await readJson(resp)
  if (!resp.ok) return { ok: false, message: firstErrorMessage(payload) || buildStandardMessage('SendGrid', resp), statusCode: resp.status }
  const scopes: string[] = Array.isArray(payload?.scopes) ? payload.scopes : []
  if (!scopes.includes('mail.send')) {
    return { ok: false, message: 'Connected to SendGrid, but this API key lacks the "Mail Send" (mail.send) permission.', statusCode: resp.status }
  }
  return { ok: true, message: 'Connected to SendGrid and verified Mail Send permission', statusCode: resp.status }
}

async function probeStripe(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const resp = await performProbe('stripe', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, '/v1/balance'),
  })
  const payload = await readJson(resp)
  if (!resp.ok) return { ok: false, message: firstErrorMessage(payload) || buildStandardMessage('Stripe', resp), statusCode: resp.status }
  const live = payload?.livemode === true
  return { ok: true, message: `Connected to Stripe (${live ? 'live' : 'test'} mode) and read the account balance`, statusCode: resp.status }
}

async function probeMercury(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  return simpleProbe('mercury', 'Mercury', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, '/accounts'),
  }, (p) => {
    const count = Array.isArray(p?.accounts) ? p.accounts.length : 0
    return `Connected to Mercury${count ? ` (${count} account${count === 1 ? '' : 's'} visible)` : ''}`
  })
}

/** OpenAI-compatible providers: GET {base}{prefix}/models lists the models the key can use. */
const MODELS_PATH: Record<string, string> = {
  openai: '/v1/models',
  deepseek: '/models',
  groq: '/openai/v1/models',
  xai: '/v1/models',
  mistral: '/v1/models',
  together: '/v1/models',
  ollama: '/v1/models',
}

const AI_NAMES: Record<string, string> = {
  openai: 'OpenAI', deepseek: 'DeepSeek', groq: 'Groq', xai: 'xAI', mistral: 'Mistral', together: 'Together AI', ollama: 'Ollama', claude: 'Anthropic', perplexity: 'Perplexity',
}

async function probeAiModels(connectorKey: string, integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  const name = AI_NAMES[connectorKey] ?? connectorKey
  const path = connectorKey === 'claude' ? '/v1/models?limit=1' : MODELS_PATH[connectorKey]
  return simpleProbe(connectorKey, name, integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, path),
    headers: connectorKey === 'claude' ? { 'anthropic-version': '2023-06-01' } : {},
  }, (p) => {
    const list = Array.isArray(p?.data) ? p.data : Array.isArray(p) ? p : []
    return `Connected to ${name}${list.length ? ' and listed available models' : ''}`
  })
}

async function probeFirebase(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  // documents:listCollectionIds — reads only collection ids, proves the
  // service account can reach this project's database.
  return simpleProbe('firebase', 'Firestore', integrationConfig, config, credentials, {
    url: `${trimTrailingSlash(integrationConfig.base_url)}:listCollectionIds`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageSize: 1 }),
  }, () => 'Connected to Firestore and listed collections')
}

async function probeGemini(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  return simpleProbe('google_gemini', 'Gemini', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, '/v1beta/models?pageSize=1'),
  }, () => 'Connected to the Gemini API and listed models')
}

async function probePerplexity(integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>) {
  // No models endpoint: the smallest possible completion validates the key.
  return simpleProbe('perplexity', 'Perplexity', integrationConfig, config, credentials, {
    url: buildUrl(integrationConfig.base_url, '/chat/completions'),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'sonar', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
  }, () => 'Connected to Perplexity and verified the API key')
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

/**
 * E-signature connectors: the adapter's own account call (DocuSign account,
 * Acrobat Sign users/me, Dropbox Sign account, PandaDoc member, SignNow
 * user, BoldSign templates) through the same auth, discovery and transport
 * as the actions.
 */
async function probeEsign(connectorKey: string, integrationConfig: IntegrationConfig, config: Record<string, any>, credentials: Record<string, any>): Promise<ConnectorProbeResult> {
  if (integrationConfig.auth_type === 'oauth2') {
    return { ok: false, message: 'This integration uses OAuth 2.0 Connect — run a Get Envelope Status or List Templates reference to test it.' }
  }
  const definition = getConnectorDefinition(connectorKey)
  const { connectorTemplateVars } = await import('./template-vars')
  const { contextFromIntegration } = await import('@/lib/esign/service')
  const { EsignError } = await import('@/lib/esign/types')
  try {
    const loaded = await contextFromIntegration({
      id: '00000000-0000-0000-0000-000000000000',
      type: connectorKey,
      tenant_id: '',
      config: { ...integrationConfig, template_vars: definition ? connectorTemplateVars(definition, config, credentials) : {} },
    }, { timeoutMs: TEST_TIMEOUT_MS * 2, resolveSecrets: false })
    const who = await loaded.adapter.whoami(loaded.ctx)
    return { ok: true, message: `Connected to ${who}` }
  } catch (error) {
    if (error instanceof EsignError) return { ok: false, message: error.message, ...(error.status ? { statusCode: error.status } : {}) }
    return { ok: false, message: (error as Error)?.message ?? 'Connection test failed' }
  }
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
  // Same migrate-on-read as the reference executor (legacy stored shapes).
  const decrypted = decryptSensitiveFields(rawIntegrationConfig)
  const upgrade = getConnectorDefinition(connectorKey)?.upgradeIntegrationConfig
  const integrationConfig = (upgrade ? upgrade(decrypted as any) : decrypted) as IntegrationConfig
  const { isEsignConnector } = await import('@/lib/esign/catalog')
  if (isEsignConnector(connectorKey)) return probeEsign(connectorKey, integrationConfig, config, credentials)
  switch (connectorKey) {
    case 'ms_teams':
      return probeTeamsWebhook(integrationConfig)
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
    case 'workday':
      return probeWorkday(integrationConfig, config, credentials)
    case 'ukg_pro':
      return probeUkgPro(integrationConfig, config, credentials)
    case 'docusign':
      return probeDocuSign(integrationConfig, config, credentials)
    case 'twilio':
      return probeTwilio(integrationConfig, config, credentials)
    case 'sendgrid':
      return probeSendGrid(integrationConfig, config, credentials)
    case 'stripe':
      return probeStripe(integrationConfig, config, credentials)
    case 'mercury':
      return probeMercury(integrationConfig, config, credentials)
    case 'openai':
    case 'claude':
    case 'deepseek':
    case 'groq':
    case 'xai':
    case 'mistral':
    case 'together':
    case 'ollama':
      return probeAiModels(connectorKey, integrationConfig, config, credentials)
    case 'perplexity':
      return probePerplexity(integrationConfig, config, credentials)
    case 'firebase':
      return probeFirebase(integrationConfig, config, credentials)
    case 'google_gemini':
      return probeGemini(integrationConfig, config, credentials)
    case 'azure_document_intelligence': {
      // The same free resource-info call as Settings → Document OCR → Test connection (egress guarded).
      const { testAzureOcr } = await import('@/lib/documents/ocr')
      return testAzureOcr({ endpoint: String(config.endpoint ?? ''), key: String(credentials.api_key ?? ''), apiVersion: config.api_version ? String(config.api_version) : null }, { guarded: true })
    }
    default:
      return probeGeneric(connectorKey, integrationConfig, config, credentials)
  }
}
