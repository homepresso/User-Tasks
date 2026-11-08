import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))

import { msTeamsConnector } from '@/lib/connectors/definitions/ms-teams'
import { resolveConnectorProbeUrl, runConnectorProbe } from '@/lib/connectors/test-probes'
import type { ServiceContext } from '@/lib/services/context'
import { testConnector } from '@/lib/services/connectors'
import { createMemorySupabase } from './fixtures/supabase-memory'

const WEBHOOK = 'https://prod-00.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=s3cr3t'

function context(): ServiceContext {
  return {
    supabase: createMemorySupabase({}) as unknown as ServiceContext['supabase'],
    tenantId: 'tenant-a',
    actorId: 'user-1',
    permissions: new Set(['integrations.test']),
    authKind: 'api_key',
    source: 'api',
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Microsoft Teams Test connection', () => {
  it('resolves the probe URL from the webhook when base_url is empty (as the executor does)', () => {
    const integrationConfig = msTeamsConnector.buildIntegrationConfig({}, { webhook_url: WEBHOOK })
    expect(integrationConfig.base_url).toBe('')
    const { url, fromWebhook } = resolveConnectorProbeUrl(integrationConfig)
    expect(url).toMatch(/^https:\/\//)
    expect(fromWebhook).toBe(true)
    expect(resolveConnectorProbeUrl({ base_url: 'https://api.example.com' })).toEqual({ url: 'https://api.example.com', fromWebhook: false })
  })

  it('testConnector succeeds for a valid Workflows webhook without posting to the channel', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await testConnector(context(), { connector_key: 'ms_teams', config: {}, credentials: { webhook_url: WEBHOOK } })
    expect(result.status).toBe('success')
    expect(result.message).not.toMatch(/Invalid base URL/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('flags retired and unsigned webhook URLs without echoing the secret', async () => {
    const retired = await runConnectorProbe('ms_teams', {}, {}, msTeamsConnector.buildIntegrationConfig({}, { webhook_url: 'https://contoso.webhook.office.com/webhookb2/x/IncomingWebhook/y/z' }) as Parameters<typeof runConnectorProbe>[3])
    expect(retired.ok).toBe(false)
    expect(retired.message).toMatch(/retired/)
    const unsigned = await runConnectorProbe('ms_teams', {}, {}, msTeamsConnector.buildIntegrationConfig({}, { webhook_url: WEBHOOK.replace(/&sig=.*/, '') }) as Parameters<typeof runConnectorProbe>[3])
    expect(unsigned.ok).toBe(false)
    expect(unsigned.message).toMatch(/signature/)
    expect(unsigned.message).not.toContain('logic.azure.com/workflows')
  })
})
