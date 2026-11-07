/* eslint-disable @typescript-eslint/no-explicit-any -- provider / config JSON is free-form */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const resolveTenantSecretRefs = vi.fn()
vi.mock('@/lib/config/tenant-secret-refs', () => ({ resolveTenantSecretRefs: (...args: unknown[]) => resolveTenantSecretRefs(...args) }))

import { credentialsFromIntegration, loadMediaCredentials } from '@/lib/media/credentials'
import { CONNECTOR_CATALOG, getConnectorDefinition } from '@/lib/connectors/registry'
import { mediaProviderForType, MEDIA_PROVIDERS } from '@/lib/media/catalog'

const TENANT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

/** A Supabase-like client over in-memory integration rows (filters by every .eq()). */
function fakeDb(rows: Array<Record<string, unknown>>) {
  const filters: Array<[string, unknown]> = []
  const query: any = {
    select: () => query,
    eq: (col: string, value: unknown) => { filters.push([col, value]); return query },
    maybeSingle: async () => ({ data: rows.find((r) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null }),
  }
  return { from: vi.fn(() => { filters.length = 0; return query }), filters }
}

const openaiRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'int-openai', tenant_id: TENANT, type: 'openai', is_active: true,
  config: { base_url: 'https://api.openai.com', auth_type: 'bearer', auth_config: { token: 'sk-plain' }, headers: { 'OpenAI-Organization': 'org-9' } },
  ...overrides,
})

beforeEach(() => {
  resolveTenantSecretRefs.mockReset()
  resolveTenantSecretRefs.mockImplementation(async (tenantId: string, creds: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...creds }
    for (const [k, v] of Object.entries(creds)) {
      if (typeof v !== 'string' || !v.startsWith('secret://')) continue
      if (!v.startsWith(`secret://tenants/${tenantId}/`)) throw new Error(`integration ${k}: secret references must name a secret under tenants/${tenantId}/`)
      out[k] = `resolved:${v.slice(-6)}`
    }
    return out
  })
})

describe('credentialsFromIntegration', () => {
  it('reads the existing OpenAI connector shape', () => {
    const c = credentialsFromIntegration({ id: 'i1', type: 'openai', config: openaiRow().config })
    expect(c).toEqual({ provider: 'openai', integrationId: 'i1', baseUrl: 'https://api.openai.com', apiKey: 'sk-plain', extra: { organization: 'org-9' } })
  })

  it('reads the existing Gemini connector shape (key_value, add_to query)', () => {
    const c = credentialsFromIntegration({ id: 'i2', type: 'google_gemini', config: { base_url: 'https://generativelanguage.googleapis.com', auth_type: 'api_key', auth_config: { key_name: 'key', key_value: 'AIza1', add_to: 'query' } } })
    expect(c).toMatchObject({ provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'AIza1' })
  })

  it('honours a base_url override (local mock servers)', () => {
    const c = credentialsFromIntegration({ id: 'i3', type: 'openai', config: { ...openaiRow().config, base_url: 'http://127.0.0.1:4790/' } })
    expect(c.baseUrl).toBe('http://127.0.0.1:4790')
  })

  it('maps every new connector preset to its provider with the right fields', () => {
    const build = (key: string, config: Record<string, unknown>, creds: Record<string, unknown>) => credentialsFromIntegration({ id: key, type: key, config: getConnectorDefinition(key)!.buildIntegrationConfig(config, creds) })
    expect(build('azure_speech', { region: 'eastus' }, { api_key: 'k1' })).toMatchObject({ provider: 'azure_speech', apiKey: 'k1', region: 'eastus', baseUrl: 'https://eastus.api.cognitive.microsoft.com' })
    expect(build('azure_ai_vision', { endpoint: 'https://v.cognitiveservices.azure.com/' }, { api_key: 'k2' })).toMatchObject({ provider: 'azure_vision', apiKey: 'k2', endpoint: 'https://v.cognitiveservices.azure.com' })
    expect(build('aws_media', { region: 'eu-west-1', bucket: 'stage' }, { access_key_id: 'AKIA1', secret_access_key: 's3cr3t', session_token: 'tok' })).toMatchObject({ provider: 'aws', region: 'eu-west-1', bucket: 'stage', accessKeyId: 'AKIA1', secretAccessKey: 's3cr3t', sessionToken: 'tok', baseUrl: 'https://transcribe.eu-west-1.amazonaws.com' })
    expect(build('deepgram', {}, { api_key: 'dg1' })).toMatchObject({ provider: 'deepgram', apiKey: 'dg1', baseUrl: 'https://api.deepgram.com' })
    expect(build('assemblyai', { data_region: 'eu' }, { api_key: 'aa1' })).toMatchObject({ provider: 'assemblyai', apiKey: 'aa1', baseUrl: 'https://api.eu.assemblyai.com' })
    expect(build('elevenlabs', { voice: 'v1' }, { api_key: 'el1' })).toMatchObject({ provider: 'elevenlabs', apiKey: 'el1', extra: { voice: 'v1' } })
    expect(build('stability_ai', { image_model: 'ultra' }, { api_key: 'st1' })).toMatchObject({ provider: 'stability', apiKey: 'st1', extra: { image_model: 'ultra' } })
  })

  it('every media integration type has a connector preset', () => {
    for (const p of MEDIA_PROVIDERS) expect(p.integrationTypes.some((t) => CONNECTOR_CATALOG.some((c) => c.key === t)), p.id).toBe(true)
    for (const key of ['azure_speech', 'azure_ai_vision', 'aws_media', 'deepgram', 'assemblyai', 'elevenlabs', 'stability_ai']) {
      const def = getConnectorDefinition(key)!
      expect(def.category).toBe('ai')
      expect(mediaProviderForType(key)).not.toBeNull()
      for (const f of def.credentialFields) expect(f.helpText, `${key}.${f.key}`).toBeTruthy()
    }
  })

  it('refuses non-media types', () => {
    expect(() => credentialsFromIntegration({ id: 'x', type: 'slack', config: {} })).toThrow(/not a media AI provider/)
  })
})

describe('loadMediaCredentials', () => {
  it('scopes the lookup to the tenant: another tenant\'s integration is not found', async () => {
    const db = fakeDb([openaiRow({ tenant_id: OTHER })])
    await expect(loadMediaCredentials(db as any, TENANT, 'int-openai')).rejects.toThrow(/not found in this workspace/)
    expect(db.filters).toEqual([['id', 'int-openai'], ['tenant_id', TENANT]])
  })

  it('refuses inactive and non-media integrations', async () => {
    await expect(loadMediaCredentials(fakeDb([openaiRow({ is_active: false })]) as any, TENANT, 'int-openai')).rejects.toThrow(/inactive/)
    await expect(loadMediaCredentials(fakeDb([openaiRow({ type: 'slack' })]) as any, TENANT, 'int-openai')).rejects.toThrow(/not a media AI provider/)
    await expect(loadMediaCredentials(fakeDb([openaiRow({ config: { auth_config: {} } })]) as any, TENANT, 'int-openai')).rejects.toThrow(/no API key/)
  })

  it('loads, and resolves secret:// refs under the workspace prefix', async () => {
    const row = openaiRow({ config: { base_url: 'https://api.openai.com', auth_config: { token: `secret://tenants/${TENANT}/openai-key` } } })
    const { provider, credentials } = await loadMediaCredentials(fakeDb([row]) as any, TENANT, 'int-openai')
    expect(provider.id).toBe('openai')
    expect(credentials.apiKey).toBe('resolved:ai-key')
    expect(resolveTenantSecretRefs).toHaveBeenCalledWith(TENANT, { token: `secret://tenants/${TENANT}/openai-key` }, 'OpenAI integration')
  })

  it('refuses a secret:// ref outside the workspace prefix', async () => {
    const row = openaiRow({ config: { auth_config: { token: `secret://tenants/${OTHER}/stolen` } } })
    await expect(loadMediaCredentials(fakeDb([row]) as any, TENANT, 'int-openai')).rejects.toThrow(/must name a secret under tenants\//)
  })
})
