/**
 * Contract-test harness for connector reference templates: runs a template
 * through the real runtime (services/connectors row building →
 * lib/reference-executor → attach-auth / token mints → lib/integrations/http)
 * with fetch replaced, and records every outbound request exactly as sent
 * (URL, method, headers with secret values masked, body).
 *
 * Test files must stub DNS so the egress guard resolves provider hosts
 * offline (vi.mock is hoisted, so it has to live in the test file):
 *
 *   vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))
 *
 * Google service-account connectors should also mock google-auth-library's
 * JWT (see __tests__/connectors-google-contract.test.ts).
 */
import { vi } from 'vitest'
import { getConnectorDefinition } from '@/lib/connectors/registry'
import { connectorTemplateVars } from '@/lib/connectors/template-vars'
import { templateHash } from '@/lib/connectors/reference-upgrade'
import { normalizeReferenceInput, normalizeReferenceOutput } from '@/lib/services/references'
import { clearMintedTokenCache } from '@/lib/integrations/token-mint'
import { isSensitiveKey } from '@/lib/secret-fields'

export const TEST_TENANT = '00000000-0000-4000-8000-000000000001'

export interface RecordedRequest {
  url: string
  method: string
  /** Header names lower-cased; credential values masked as "<scheme> ***" or "***". */
  headers: Record<string, string>
  /** Body as text (FormData → "<FormData k1,k2>", bytes → "<bytes N>"). */
  body: string | null
}

export type Responder = (req: RecordedRequest) => Response | Promise<Response>

export interface RunTemplateOptions {
  connector: string
  template: string
  config?: Record<string, any>
  credentials?: Record<string, any>
  inputs?: Record<string, any>
  /** Answers each request (default: 200 {"ok":true}; token endpoints get a fake access token). */
  respond?: Responder
  /** Override the stored reference row (e.g. a legacy row shape). */
  mutateReference?: (ref: Record<string, any>) => void
  /** Drop template_vars from the integration (rows created before they existed). */
  legacyIntegration?: boolean
}

export interface RunTemplateResult {
  requests: RecordedRequest[]
  /** The provider call (requests minus token-endpoint calls). */
  call: RecordedRequest
  result: Awaited<ReturnType<typeof import('@/lib/reference-executor')['executeReference']>>
}

const SECRET_HEADER_RE = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-goog-api-key|x-n8n-api-key|us-customer-api-key|ocp-apim-subscription-key)$|token|secret|password|signature/i

function maskHeaders(raw: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  const entries = raw instanceof Headers ? [...raw.entries()] : Array.isArray(raw) ? raw : Object.entries(raw ?? {})
  for (const [k, v] of entries) {
    const key = k.toLowerCase()
    const value = String(v)
    if (SECRET_HEADER_RE.test(key)) {
      const scheme = /^(Bearer|Basic|SharedKey|Token)\s/i.exec(value)
      out[key] = scheme ? `${scheme[1]} ***` : '***'
    } else out[key] = value
  }
  return out
}

function bodyText(body: unknown): string | null {
  if (body == null) return null
  if (typeof body === 'string') return body
  if (typeof FormData !== 'undefined' && body instanceof FormData) return `<FormData ${[...body.keys()].join(',')}>`
  if (body instanceof Uint8Array) return `<bytes ${body.byteLength}>`
  if (body instanceof URLSearchParams) return body.toString()
  return `<${(body as object)?.constructor?.name ?? typeof body}>`
}

export const isTokenEndpoint = (url: string) =>
  /\/oauth2(\/v2\.0)?\/token\b|\/oauth\/token\b|\/oauth2\/token\b|services\/oauth2\/token/.test(url)

function defaultRespond(req: RecordedRequest): Response {
  if (req.method === 'POST' && isTokenEndpoint(req.url)) {
    return Response.json({ access_token: 'minted-access-token', token_type: 'Bearer', expires_in: 3600 })
  }
  return Response.json({ ok: true })
}

/** Fake values for every field a definition declares (fixtures are obviously fake). */
export function fakeConnectorValues(connector: string): { config: Record<string, any>; credentials: Record<string, any> } {
  const def = getConnectorDefinition(connector)
  if (!def) throw new Error(`Unknown connector ${connector}`)
  const fake = (fields: typeof def.fields) => Object.fromEntries(fields.map((f) => [f.key, f.defaultValue ?? f.options?.[0]?.value ?? `fake-${f.key.replace(/_/g, '-')}`]))
  return { config: fake(def.fields), credentials: fake(def.credentialFields) }
}

export async function runConnectorTemplate(opts: RunTemplateOptions): Promise<RunTemplateResult> {
  const def = getConnectorDefinition(opts.connector)
  if (!def) throw new Error(`Unknown connector ${opts.connector}`)
  const template = def.referenceTemplates.find((t) => t.key === opts.template)
  if (!template) throw new Error(`Unknown template ${opts.connector}.${opts.template}`)
  const defaults = fakeConnectorValues(opts.connector)
  const config = { ...defaults.config, ...(opts.config ?? {}) }
  const credentials = { ...defaults.credentials, ...(opts.credentials ?? {}) }

  // As lib/services/connectors builds the integration and reference rows.
  const built = def.buildIntegrationConfig(config, credentials)
  const integrationConfig: Record<string, any> = { ...built, headers: { ...(built.headers ?? {}) } }
  if (!opts.legacyIntegration) integrationConfig.template_vars = connectorTemplateVars(def, config, credentials)
  const reference: Record<string, any> = {
    id: 'ref-1',
    tenant_id: TEST_TENANT,
    integration_id: 'int-1',
    name: `${def.name}: ${template.name}`,
    inputs: template.inputs.map((input) => normalizeReferenceInput({ ...input, default_value: input.defaultValue ?? '' })),
    outputs: template.outputs.map((output) => normalizeReferenceOutput(output)),
    request_config: {
      method: template.method,
      path_template: template.pathTemplate,
      body_template: template.bodyTemplate ?? '',
      headers: template.headers ?? {},
      typed_placeholders: true,
      connector_template: { key: template.key, hash: templateHash(template) },
      ...(template.baseUrl ? { base_url: template.baseUrl } : {}),
    },
    integration: { id: 'int-1', tenant_id: TEST_TENANT, name: `${def.name} (Connector)`, type: def.key, config: integrationConfig },
  }
  opts.mutateReference?.(reference)

  const tenantConnector = { id: 'conn-1', tenant_id: TEST_TENANT, connector_key: def.key, integration_id: 'int-1', config, credentials }
  const builder = (table: string) => {
    const b: any = {
      select: () => b, eq: () => b, in: () => b, is: () => b, order: () => b, limit: () => b,
      insert: async () => ({ error: null }), update: () => b,
      single: async () => ({ data: table === 'integration_references' ? reference : null, error: null }),
      maybeSingle: async () => ({ data: table === 'tenant_connectors' ? tenantConnector : null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
    }
    return b
  }
  const supabase: any = { from: (table: string) => builder(table), rpc: async () => ({ data: null, error: null }) }

  const requests: RecordedRequest[] = []
  const respond = opts.respond ?? defaultRespond
  clearMintedTokenCache()
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const req: RecordedRequest = {
      url: String(input instanceof Request ? input.url : input),
      method: String(init.method ?? 'GET').toUpperCase(),
      headers: maskHeaders(init.headers),
      body: bodyText(init.body),
    }
    requests.push(req)
    return (await respond(req)) ?? defaultRespond(req)
  })
  vi.stubGlobal('fetch', fetchMock)
  try {
    const { executeReference } = await import('@/lib/reference-executor')
    const result = await executeReference({ supabase, referenceId: 'ref-1', inputValues: opts.inputs ?? {}, timeout: 5_000 })
    const providerCalls = requests.filter((r) => !(r.method === 'POST' && isTokenEndpoint(r.url)))
    return { requests, call: providerCalls[providerCalls.length - 1], result }
  } finally {
    vi.unstubAllGlobals()
  }
}

/** True when no recorded request leaks a secret credential value in its URL or body. */
export function assertNoSecretInUrls(requests: RecordedRequest[], secrets: string[]) {
  for (const req of requests) {
    for (const secret of secrets) {
      if (secret && req.url.includes(secret)) throw new Error(`secret leaked into URL ${req.url}`)
    }
  }
}

export { isSensitiveKey }
