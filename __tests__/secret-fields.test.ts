import { afterEach, describe, expect, it, vi } from 'vitest'

// secret-crypto caches the parsed ENCRYPTION_KEY in module scope, so each
// test group re-imports fresh modules after setting/clearing the env var.
const TEST_KEY = Buffer.alloc(32, 7).toString('base64')

async function loadWithKey(key: string | undefined) {
  vi.resetModules()
  if (key === undefined) delete process.env.ENCRYPTION_KEY
  else process.env.ENCRYPTION_KEY = key
  const crypto = await import('@/lib/secret-crypto')
  const fields = await import('@/lib/secret-fields')
  return { ...crypto, ...fields }
}

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY
  vi.resetModules()
})

describe('isSensitiveKey', () => {
  it('flags credential-ish keys', async () => {
    const { isSensitiveKey } = await loadWithKey(undefined)
    for (const key of [
      'password', 'db_password', 'secret', 'client_secret', 'secret_access_key',
      'secret_key', 'app_secret', 'entra_client_secret', 'token', 'access_token',
      'api_token', 'auth_token', 'bot_token', 'sas_token', 'refresh_token',
      'api_key', 'key_value', 'private_key', 'account_key', 'service_account',
      'service_account_json',
    ]) {
      expect(isSensitiveKey(key), key).toBe(true)
    }
  })

  it('leaves non-secret config keys alone', async () => {
    const { isSensitiveKey } = await loadWithKey(undefined)
    for (const key of [
      'base_url', 'auth_type', 'key_name', 'username', 'email', 'host', 'port',
      'database', 'client_id', 'headers', 'webhook_url', 'impersonate_email',
      'account_sid', 'access_key_id', 'api_key_header', 'app_key', 'region',
      'bucket', '_executor', 'scopes', 'add_to', 'tags',
    ]) {
      expect(isSensitiveKey(key), key).toBe(false)
    }
  })
})

describe('encryptSensitiveFields / decryptSensitiveFields (with ENCRYPTION_KEY)', () => {
  it('encrypts only sensitive values, deeply, and round-trips back', async () => {
    const { encryptSensitiveFields, decryptSensitiveFields, isEncrypted } = await loadWithKey(TEST_KEY)
    const config = {
      base_url: 'https://api.example.com',
      auth_type: 'bearer',
      auth_config: { token: 'tok-123', key_name: 'X-API-Key' },
      db_config: { host: 'db.internal', port: 5432, username: 'svc', password: 'hunter2', ssl: false },
      headers: { 'X-Trace': 'abc' },
    }

    const encrypted = encryptSensitiveFields(config)

    // Sensitive values encrypted
    expect(isEncrypted(encrypted.auth_config.token)).toBe(true)
    expect(isEncrypted(encrypted.db_config.password)).toBe(true)
    // Non-secret values untouched
    expect(encrypted.base_url).toBe('https://api.example.com')
    expect(encrypted.auth_config.key_name).toBe('X-API-Key')
    expect(encrypted.db_config.username).toBe('svc')
    expect(encrypted.db_config.port).toBe(5432)
    expect(encrypted.db_config.ssl).toBe(false)
    expect(encrypted.headers['X-Trace']).toBe('abc')
    // Input not mutated
    expect(config.auth_config.token).toBe('tok-123')

    const decrypted = decryptSensitiveFields(encrypted)
    expect(decrypted).toEqual(config)
  })

  it('is idempotent — re-encrypting an already-encrypted payload does not double-encrypt', async () => {
    const { encryptSensitiveFields, decryptSensitiveFields } = await loadWithKey(TEST_KEY)
    const once = encryptSensitiveFields({ credentials: { api_key: 'sk-live-1' } })
    const twice = encryptSensitiveFields(once)
    expect(twice).toEqual(once)
    expect(decryptSensitiveFields(twice).credentials.api_key).toBe('sk-live-1')
  })

  it('encrypts every nested string under a sensitive parent key (service accounts)', async () => {
    const { encryptSensitiveFields, decryptSensitiveFields, isEncrypted } = await loadWithKey(TEST_KEY)
    const creds = {
      service_account: { client_email: 'a@b.iam.gserviceaccount.com', private_key: '-----BEGIN KEY-----' },
      impersonate_email: 'user@example.com',
    }
    const encrypted = encryptSensitiveFields(creds)
    expect(isEncrypted(encrypted.service_account.client_email)).toBe(true)
    expect(isEncrypted(encrypted.service_account.private_key)).toBe(true)
    expect(encrypted.impersonate_email).toBe('user@example.com')
    expect(decryptSensitiveFields(encrypted)).toEqual(creds)
  })

  it('handles arrays, null, undefined, and non-object scalars', async () => {
    const { encryptSensitiveFields, decryptSensitiveFields, isEncrypted } = await loadWithKey(TEST_KEY)
    expect(encryptSensitiveFields(null)).toBeNull()
    expect(encryptSensitiveFields(undefined)).toBeUndefined()
    expect(decryptSensitiveFields(null)).toBeNull()

    const withArray = encryptSensitiveFields({
      items: [{ token: 't1' }, { name: 'plain' }] as Array<Record<string, string>>,
    })
    expect(isEncrypted(withArray.items[0].token)).toBe(true)
    expect(withArray.items[1].name).toBe('plain')
    expect(decryptSensitiveFields(withArray).items[0].token).toBe('t1')
  })

  it('skips empty-string secrets (encryptSecret passthrough)', async () => {
    const { encryptSensitiveFields } = await loadWithKey(TEST_KEY)
    const encrypted = encryptSensitiveFields({ auth_config: { token: '' } })
    expect(encrypted.auth_config.token).toBe('')
  })

  it('decrypt tolerates legacy plaintext rows and mixed payloads', async () => {
    const { encryptSensitiveFields, decryptSensitiveFields, encryptSecret } = await loadWithKey(TEST_KEY)
    const mixed = {
      auth_config: {
        token: encryptSecret('new-secret'), // encrypted
        password: 'legacy-plaintext',       // legacy, never encrypted
      },
    }
    const decrypted = decryptSensitiveFields(mixed)
    expect(decrypted.auth_config.token).toBe('new-secret')
    expect(decrypted.auth_config.password).toBe('legacy-plaintext')

    // decrypt is also idempotent on already-decrypted output
    expect(decryptSensitiveFields(decrypted)).toEqual(decrypted)

    // and full encrypt→decrypt of the mixed object restores plaintext everywhere
    expect(decryptSensitiveFields(encryptSensitiveFields(mixed)).auth_config.password).toBe('legacy-plaintext')
  })

  it('decrypts enc:v1: strings even under non-sensitive keys (renamed/legacy keys)', async () => {
    const { encryptSecret, decryptSensitiveFields } = await loadWithKey(TEST_KEY)
    const payload = { renamed_field: encryptSecret('still-recoverable') }
    expect(decryptSensitiveFields(payload).renamed_field).toBe('still-recoverable')
  })
})

describe('without ENCRYPTION_KEY (no-op passthrough)', () => {
  it('encryptSensitiveFields leaves values as plaintext', async () => {
    const { encryptSensitiveFields } = await loadWithKey(undefined)
    const config = { auth_config: { token: 'tok-123' } }
    expect(encryptSensitiveFields(config)).toEqual(config)
  })

  it('decryptSensitiveFields passes plaintext through', async () => {
    const { decryptSensitiveFields } = await loadWithKey(undefined)
    const config = { auth_config: { token: 'tok-123' }, db_config: { password: 'pw' } }
    expect(decryptSensitiveFields(config)).toEqual(config)
  })
})
