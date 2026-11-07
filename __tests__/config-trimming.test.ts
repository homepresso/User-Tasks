import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveInstanceConfig } from '@/lib/config'
import { resolveSecretRef, SECRET_REF_PREFIX } from '@/lib/config/secret-refs'

/**
 * Provider settings are trimmed wherever they come from (production's anon key
 * env had a trailing newline and broke Realtime): instance_settings written by
 * the Infrastructure page / admin CLI / API, provider option env vars, and
 * values read from a secret store (files and pasted values end in newlines).
 */
describe('config values are trimmed on every path', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('instance_settings provider options (Infrastructure page, admin CLI, API)', () => {
    const config = resolveInstanceConfig(new Map<string, unknown>([
      ['storage.bucket', '  uploads\n'],
      ['storage.endpoint', 'https://s3.example.com\r\n'],
      ['storage.force_path_style', true],
    ]))
    const options = config.providers.storage.options as Record<string, unknown>
    expect(options.bucket).toBe('uploads')
    expect(options.endpoint).toBe('https://s3.example.com')
    expect(options.force_path_style).toBe(true)
  })

  it('secret store values', async () => {
    const store = { id: 'test', get: async () => 'postgres://u:p@db.example.com:5432/app\n' }
    const ref = `${SECRET_REF_PREFIX}db_url`
    await expect(resolveSecretRef(ref, store, { ttlMs: 0 })).resolves.toBe('postgres://u:p@db.example.com:5432/app')
  })

  it('scheduler secrets from env', async () => {
    vi.stubEnv('WORKFLOW_PROCESSOR_SECRET', 'abc123\n')
    vi.stubEnv('CRON_SECRET', ' cron-secret\n')
    const { getBootstrapConfig } = await import('@/lib/config/bootstrap')
    expect(getBootstrapConfig().processorSecret).toBe('abc123')
    expect(getBootstrapConfig().cronSecret).toBe('cron-secret')
  })
})
