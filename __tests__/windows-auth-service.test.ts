import { afterEach, describe, expect, it, vi } from 'vitest'

const TEST_KEY = Buffer.alloc(32, 9).toString('base64')
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY
  vi.resetModules()
})

const windowsConfig = (authConfig: Record<string, unknown>) => ({ base_url: 'https://sp.contoso.com/sites/finance', auth_type: 'windows', auth_config: authConfig })

describe('auth_type windows in the integrations service', () => {
  it('is an accepted auth type, validated and normalised on create', async () => {
    const { validateIntegrationConfig, INTEGRATION_AUTH_TYPES } = await import('@/lib/services/integrations')
    expect(INTEGRATION_AUTH_TYPES).toContain('windows')
    const out = validateIntegrationConfig('rest_api', windowsConfig({ username: ' CONTOSO\\svc ', password: 'p', spn: '', proxy_url: 'http://proxy.contoso.com:8080', junk: 1 }))
    expect(out.auth_config).toEqual({ mode: 'negotiate', username: 'CONTOSO\\svc', password: 'p', proxy_url: 'http://proxy.contoso.com:8080' })
    expect(() => validateIntegrationConfig('rest_api', windowsConfig({ username: 'CONTOSO\\svc' }))).toThrow(/password is required/)
    expect(() => validateIntegrationConfig('rest_api', windowsConfig({ username: 'u', password: 'p', mode: 'digest' }))).toThrow(/mode/)
    expect(validateIntegrationConfig('rest_api', windowsConfig({ username: 'svc@contoso.com', mode: 'kerberos' })).auth_config.mode).toBe('kerberos')
  })

  it('encrypts only the password at rest and masks it in API responses', async () => {
    process.env.ENCRYPTION_KEY = TEST_KEY
    vi.resetModules()
    const { encryptSensitiveFields, decryptSensitiveFields } = await import('@/lib/secret-fields')
    const { presentIntegration } = await import('@/lib/services/integrations')
    const { resolveSecretPlaceholders } = await import('@/lib/services/_shared')
    const stored = encryptSensitiveFields(windowsConfig({ mode: 'ntlm', username: 'CONTOSO\\svc', password: 'S3cret!', ca_bundle: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----' }))
    expect(stored.auth_config.password).toMatch(/^enc:v1:/)
    expect(stored.auth_config.username).toBe('CONTOSO\\svc')
    expect(stored.auth_config.ca_bundle).toContain('BEGIN CERTIFICATE')
    const presented = presentIntegration({ id: 'i', config: stored })
    expect(presented.config.auth_config.password).toBe('__SECRET__')
    expect(JSON.stringify(presented)).not.toContain('S3cret!')
    // An edit that sends the mask back keeps the stored password.
    const kept = resolveSecretPlaceholders(windowsConfig({ mode: 'ntlm', username: 'CONTOSO\\svc', password: '__SECRET__' }), stored)
    expect(decryptSensitiveFields(kept).auth_config.password).toBe('S3cret!')
  })
})
