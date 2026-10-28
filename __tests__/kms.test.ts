import crypto from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeDataKeyId,
  ciphertextKeyId,
  clearDataKeys,
  decryptSecret,
  encryptSecret,
  installDataKeys,
  installEncryptionKey,
  isEncrypted,
} from '@/lib/secret-crypto'
import { decryptSensitiveFields, encryptSensitiveFields } from '@/lib/secret-fields'
import { isCiphertext, containsCiphertext } from '@/lib/secret-format'
import { scrubSecretsForExport } from '@/lib/portability/scrub'
import { findSecretLeaks } from '@/lib/packages/build'
import { createEnvKmsProvider, kekCheckValue } from '@/lib/providers/kms/env'
import { createVaultTransitKmsProvider } from '@/lib/providers/kms/vault-transit'
import { createAwsKmsProvider } from '@/lib/providers/kms/aws-kms'
import { createAzureKeyVaultKmsProvider, type CryptoClientLike } from '@/lib/providers/kms/azure-key-vault'
import { createGcpKmsProvider } from '@/lib/providers/kms/gcp-kms'
import { dataKeyContext, KmsError, type KmsProvider } from '@/lib/providers/kms/types'
import { dataKeyCheckValue, loadDataKeys, resolverFor, unwrapDataKey, type DataKeyRow } from '@/lib/providers/kms/keyring'
import { isBootstrapSetting } from '@/lib/config/instance-settings'

/**
 * KMS envelope encryption (providers phase 14): enc:v1 compatibility, enc:v2
 * with data keys, every KMS provider's wrap / unwrap contract (env; Vault
 * Transit over a fake API and, with KMS_TEST_VAULT_ADDR, a real OpenBao /
 * Vault dev server; AWS KMS with KMS_TEST_AWS_ENDPOINT, e.g. local-kms;
 * Azure Key Vault over a fake CryptographyClient doing real RSA-OAEP; Cloud
 * KMS over a fake REST server), the keyring (check values, wrong KEKs,
 * tampering) and that no key material ever appears in errors or logs.
 * The resumable rewrap and the CLI are in kms-rewrap-db.test.ts.
 */

const KEY_A = Buffer.alloc(32, 1).toString('base64')
const KEY_B = Buffer.alloc(32, 2).toString('base64')
const VAULT_ADDR = process.env.KMS_TEST_VAULT_ADDR
const VAULT_TOKEN = process.env.KMS_TEST_VAULT_TOKEN ?? 'ut-root'
const AWS_ENDPOINT = process.env.KMS_TEST_AWS_ENDPOINT

/** Every printable form of a key's bytes that must never be output. */
function forms(key: Buffer): string[] {
  return [key.toString('base64'), key.toString('hex'), key.toString('base64url')]
}

function expectNoKeyMaterial(text: string, keys: Buffer[]) {
  for (const key of keys) for (const form of forms(key)) expect(text).not.toContain(form)
}

const envBackup = process.env.ENCRYPTION_KEY
beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY_A
  installEncryptionKey(KEY_A)
})
afterEach(() => {
  clearDataKeys()
  if (envBackup === undefined) delete process.env.ENCRYPTION_KEY
  else process.env.ENCRYPTION_KEY = envBackup
})

// ── secret-crypto: v1 compatibility and v2 ──────────────────────────────────

describe('enc:v1 compatibility', () => {
  // Produced by the pre-KMS code with KEY_A: must decrypt forever, with or without data keys.
  const legacy = (() => {
    const iv = Buffer.alloc(12, 9)
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(KEY_A, 'base64'), iv)
    const ct = Buffer.concat([cipher.update('hunter2', 'utf8'), cipher.final()])
    return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`
  })()

  it('existing ciphertext decrypts with no action, before and after data keys exist', () => {
    expect(decryptSecret(legacy)).toBe('hunter2')
    installDataKeys([{ id: 1, key: crypto.randomBytes(32), activatesAt: 0 }])
    expect(decryptSecret(legacy)).toBe('hunter2')
    expect(decryptSensitiveFields({ nested: { password: legacy } })).toEqual({ nested: { password: 'hunter2' } })
  })

  it('without data keys new values are still enc:v1 (the default is unchanged)', () => {
    const value = encryptSecret('s3cret')
    expect(value.startsWith('enc:v1:')).toBe(true)
    expect(ciphertextKeyId(value)).toEqual({ version: 1 })
    expect(decryptSecret(value)).toBe('s3cret')
  })
})

describe('enc:v2 with data keys', () => {
  it('encrypts with the newest active key, decrypts by key id, keeps bootstrap values on v1', () => {
    const k1 = crypto.randomBytes(32)
    const k2 = crypto.randomBytes(32)
    const k3 = crypto.randomBytes(32)
    installDataKeys([{ id: 1, key: k1, activatesAt: 0 }, { id: 2, key: k2, activatesAt: 0 }, { id: 3, key: k3, activatesAt: Date.now() + 60_000 }])
    expect(activeDataKeyId()).toBe(2) // #3 isn't active yet
    const value = encryptSecret('top secret')
    expect(value).toMatch(/^enc:v2:2:/)
    expect(isEncrypted(value) && isCiphertext(value) && containsCiphertext(`{"x":"${value}"}`)).toBe(true)
    expect(decryptSecret(value)).toBe('top secret')
    expect(decryptSecret(encryptSecret('older', { keyId: 1 }))).toBe('older')
    expect(encryptSecret('kms creds', { bootstrap: true })).toMatch(/^enc:v1:/)
    expect(encryptSecret(value)).toBe(value) // idempotent
    const fields = encryptSensitiveFields({ api_key: 'k', url: 'https://x' })
    expect(fields.api_key).toMatch(/^enc:v2:2:/)
    expect(decryptSensitiveFields(fields)).toEqual({ api_key: 'k', url: 'https://x' })
  })

  it('a ciphertext moved to another key id fails authentication; an unknown id says so without key material', () => {
    const k1 = crypto.randomBytes(32)
    installDataKeys([{ id: 1, key: k1, activatesAt: 0 }, { id: 2, key: k1, activatesAt: 0 }])
    const value = encryptSecret('x', { keyId: 1 })
    // Same key bytes under id 2, but the id is authenticated data.
    expect(() => decryptSecret(value.replace('enc:v2:1:', 'enc:v2:2:'))).toThrow()
    const error = (() => { try { decryptSecret(value.replace('enc:v2:1:', 'enc:v2:9:')); return null } catch (e) { return e as Error } })()
    expect(error?.message).toMatch(/data key 9 is not loaded/)
    expectNoKeyMaterial(String(error?.stack), [k1])
  })

  it('export scrubbing and package leak detection recognise enc:v2 too', () => {
    installDataKeys([{ id: 4, key: crypto.randomBytes(32), activatesAt: 0 }])
    const value = encryptSecret('x')
    expect(scrubSecretsForExport({ notes: value })).toEqual({ notes: '__SECRET__' })
    expect(findSecretLeaks([{ path: 'rows.ndjson', content: `{"a":"${value}"}` }])).toEqual(['rows.ndjson (encrypted value in rows)'])
  })

  it('the KMS and secret-store settings are bootstrap settings (enc:v1 only)', () => {
    expect(isBootstrapSetting('kms.vault_token')).toBe(true)
    expect(isBootstrapSetting('secrets.vault_token')).toBe(true)
    expect(isBootstrapSetting('secrets.smtp_password')).toBe(false) // a db secret-store value
    expect(isBootstrapSetting('email.smtp_password')).toBe(false)
  })
})

// ── provider contract ───────────────────────────────────────────────────────

function providerContract(name: string, make: () => Promise<KmsProvider> | KmsProvider, opts: { binds?: boolean } = {}) {
  describe(`${name} KMS provider`, () => {
    let provider: KmsProvider
    beforeAll(async () => { provider = await make() })

    it('wraps and unwraps a data key; the wrapped form reveals nothing of it', async () => {
      const dek = crypto.randomBytes(32)
      const wrapped = await provider.wrap(dek, dataKeyContext(7))
      expect(wrapped.kekRef).toBeTruthy()
      expectNoKeyMaterial(JSON.stringify(wrapped), [dek])
      expect((await provider.unwrap(wrapped, dataKeyContext(7))).equals(dek)).toBe(true)
    })

    it('refuses to unwrap under another key id (context binding)', async () => {
      const dek = crypto.randomBytes(32)
      const wrapped = await provider.wrap(dek, dataKeyContext(1))
      const error = await provider.unwrap(wrapped, dataKeyContext(2)).then(() => null, (e: Error) => e)
      expect(error).toBeInstanceOf(Error)
      expectNoKeyMaterial(`${error?.message} ${error?.stack}`, [dek])
      if (opts.binds) expect(error).toBeInstanceOf(KmsError)
    })

    it('describes its key without secrets', () => {
      expect(provider.describe()).toMatch(/\w/)
    })
  })
}

providerContract('env', () => createEnvKmsProvider(), { binds: true })

describe('env KMS provider specifics', () => {
  it('a data key wrapped with another ENCRYPTION_KEY is reported as such', async () => {
    const provider = createEnvKmsProvider()
    const wrapped = await provider.wrap(crypto.randomBytes(32), dataKeyContext(1))
    expect(wrapped.kekRef).toBe(`env:${kekCheckValue(Buffer.from(KEY_A, 'base64'))}`)
    installEncryptionKey(KEY_B)
    await expect(provider.unwrap(wrapped, dataKeyContext(1))).rejects.toThrow(/different ENCRYPTION_KEY/)
  })

  it('needs ENCRYPTION_KEY', async () => {
    const provider = createEnvKmsProvider({ key: () => null })
    await expect(provider.wrap(crypto.randomBytes(32), 'x')).rejects.toThrow(/ENCRYPTION_KEY/)
  })
})

/** Fake Vault Transit: real AES-GCM inside, token check, errors like Vault's. */
function fakeTransit() {
  const key = crypto.randomBytes(32)
  const calls: string[] = []
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`)
    const headers = init.headers as Record<string, string>
    if (headers['X-Vault-Token'] !== 'good-token') return Response.json({ errors: ['permission denied'] }, { status: 403 })
    const body = JSON.parse(String(init.body))
    if (url.endsWith('/transit/encrypt/app')) {
      const iv = crypto.randomBytes(12)
      const c = crypto.createCipheriv('aes-256-gcm', key, iv)
      const ct = Buffer.concat([c.update(Buffer.from(body.plaintext, 'base64')), c.final(), c.getAuthTag()])
      return Response.json({ data: { ciphertext: `vault:v1:${Buffer.concat([iv, ct]).toString('base64')}` } })
    }
    if (url.endsWith('/transit/decrypt/app')) {
      const raw = Buffer.from(String(body.ciphertext).replace('vault:v1:', ''), 'base64')
      const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
      d.setAuthTag(raw.subarray(raw.length - 16))
      const pt = Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()])
      return Response.json({ data: { plaintext: pt.toString('base64') } })
    }
    return Response.json({ errors: ['no handler'] }, { status: 404 })
  }) as unknown as typeof fetch
  return { fetch: fetchFn, calls }
}

providerContract('vault_transit (fake API)', () => {
  const vault = fakeTransit()
  return createVaultTransitKmsProvider({ vault_addr: 'http://vault.test', vault_token: 'good-token', vault_transit_key: 'app' }, { fetch: vault.fetch })
}, { binds: true })

describe('vault_transit errors', () => {
  it('a denied token fails with Vault\'s reason and never the token; config errors name the variable', async () => {
    const vault = fakeTransit()
    const provider = createVaultTransitKmsProvider({ vault_addr: 'http://vault.test', vault_token: 'bad-token-value', vault_transit_key: 'app' }, { fetch: vault.fetch })
    const error = await provider.wrap(crypto.randomBytes(32), 'x').catch((e: Error) => e)
    expect(String(error)).toMatch(/encrypt with key "app" failed \(403\): permission denied/)
    expect(String(error)).not.toContain('bad-token-value')
    await expect(createVaultTransitKmsProvider({ vault_addr: 'http://v', vault_token: 't' }).wrap(crypto.randomBytes(32), 'x')).rejects.toThrow(/VAULT_TRANSIT_KEY/)
    await expect(createVaultTransitKmsProvider({ vault_transit_key: 'k', vault_token: 't' }).wrap(crypto.randomBytes(32), 'x')).rejects.toThrow(/KMS_PROVIDER=vault_transit requires VAULT_ADDR/)
  })
})

if (VAULT_ADDR) {
  const transitKey = `ut-${crypto.randomUUID().slice(0, 8)}`
  providerContract('vault_transit (real server)', async () => {
    await fetch(`${VAULT_ADDR}/v1/sys/mounts/transit`, { method: 'POST', headers: { 'X-Vault-Token': VAULT_TOKEN }, body: JSON.stringify({ type: 'transit' }) })
    await fetch(`${VAULT_ADDR}/v1/transit/keys/${transitKey}`, { method: 'POST', headers: { 'X-Vault-Token': VAULT_TOKEN }, body: '{}' })
    return createVaultTransitKmsProvider({ vault_addr: VAULT_ADDR, vault_token: VAULT_TOKEN, vault_transit_key: transitKey })
  }, { binds: true })

  describe('vault_transit key rotation (real server)', () => {
    it('data keys wrapped with an older key version keep unwrapping after `transit/keys/<k>/rotate`', async () => {
      const provider = createVaultTransitKmsProvider({ vault_addr: VAULT_ADDR, vault_token: VAULT_TOKEN, vault_transit_key: transitKey })
      const dek = crypto.randomBytes(32)
      const old = await provider.wrap(dek, dataKeyContext(1))
      await fetch(`${VAULT_ADDR}/v1/transit/keys/${transitKey}/rotate`, { method: 'POST', headers: { 'X-Vault-Token': VAULT_TOKEN } })
      const fresh = await provider.wrap(dek, dataKeyContext(1))
      expect(old.wrapped.startsWith('vault:v1:')).toBe(true)
      expect(fresh.wrapped.startsWith('vault:v2:')).toBe(true)
      expect((await provider.unwrap(old, dataKeyContext(1))).equals(dek)).toBe(true)
    })
  })
}

if (AWS_ENDPOINT) {
  providerContract('aws_kms (local KMS)', async () => {
    const { KMSClient, CreateKeyCommand } = await import('@aws-sdk/client-kms')
    const client = new KMSClient({ endpoint: AWS_ENDPOINT, region: 'eu-west-2', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } })
    const { KeyMetadata } = await client.send(new CreateKeyCommand({}))
    process.env.AWS_ACCESS_KEY_ID ??= 'test'
    process.env.AWS_SECRET_ACCESS_KEY ??= 'test'
    return createAwsKmsProvider({ aws_kms_key_id: KeyMetadata!.Arn, aws_region: 'eu-west-2', aws_endpoint: AWS_ENDPOINT })
  })
}

describe('aws_kms (fake client)', () => {
  it('sends the data-key id as encryption context and decrypts with the recorded key', async () => {
    const sent: Array<Record<string, unknown>> = []
    class Encrypt { constructor(public input: Record<string, unknown>) {} }
    class Decrypt { constructor(public input: Record<string, unknown>) {} }
    const client = {
      async send(command: { input: Record<string, unknown> }) {
        sent.push({ kind: command.constructor.name, ...command.input })
        if (command instanceof Encrypt) return { CiphertextBlob: Buffer.from(`blob:${(command.input.Plaintext as Buffer).toString('hex')}`), KeyId: 'arn:aws:kms:eu-west-1:1:key/abc' }
        const blob = Buffer.from(command.input.CiphertextBlob as Buffer).toString()
        return { Plaintext: Buffer.from(blob.slice(5), 'hex') }
      },
    }
    const provider = createAwsKmsProvider({ aws_kms_key_id: 'alias/usertasks' }, { client, EncryptCommand: Encrypt as never, DecryptCommand: Decrypt as never })
    const dek = crypto.randomBytes(32)
    const wrapped = await provider.wrap(dek, dataKeyContext(3))
    expect(wrapped.kekRef).toBe('arn:aws:kms:eu-west-1:1:key/abc')
    expect((await provider.unwrap(wrapped, dataKeyContext(3))).equals(dek)).toBe(true)
    expect(sent[0]).toMatchObject({ kind: 'Encrypt', KeyId: 'alias/usertasks', EncryptionContext: { usertasks: 'usertasks:data-key:3' } })
    expect(sent[1]).toMatchObject({ kind: 'Decrypt', KeyId: 'arn:aws:kms:eu-west-1:1:key/abc', EncryptionContext: { usertasks: 'usertasks:data-key:3' } })
    await expect(createAwsKmsProvider({}).wrap(dek, 'x')).rejects.toThrow(/AWS_KMS_KEY_ID/)
  })
})

/** A Key Vault key with real RSA-OAEP-256 and versions, behind the CryptographyClient surface. */
function fakeKeyVault() {
  const versions = new Map<string, crypto.KeyPairKeyObjectResult>()
  const base = 'https://vault.vault.azure.net/keys/usertasks'
  const rotate = () => { const v = crypto.randomUUID().replace(/-/g, ''); versions.set(v, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })); return v }
  let latest = rotate()
  const clientFor = (id: string): CryptoClientLike => ({
    async wrapKey(alg, key) {
      expect(alg).toBe('RSA-OAEP-256')
      const version = id === base ? latest : id.split('/').pop()!
      const pair = versions.get(version)!
      return { result: crypto.publicEncrypt({ key: pair.publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key), keyID: `${base}/${version}` }
    },
    async unwrapKey(alg, encrypted) {
      const version = id.split('/').pop()!
      const pair = versions.get(version)
      if (!pair) throw Object.assign(new Error('KeyNotFound: the key version does not exist'), { statusCode: 404 })
      return { result: crypto.privateDecrypt({ key: pair.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, encrypted) }
    },
  })
  return { base, clientFor, rotate: () => { latest = rotate() } }
}

providerContract('azure_key_vault (fake RSA-OAEP key)', () => {
  const kv = fakeKeyVault()
  return createAzureKeyVaultKmsProvider({ azure_key_id: kv.base }, { client: kv.clientFor })
}, { binds: true })

describe('azure_key_vault specifics', () => {
  it('records the key version that wrapped, so a rotated key keeps unwrapping old data keys', async () => {
    const kv = fakeKeyVault()
    const provider = createAzureKeyVaultKmsProvider({ azure_key_id: kv.base }, { client: kv.clientFor })
    const dek = crypto.randomBytes(32)
    const before = await provider.wrap(dek, dataKeyContext(1))
    expect(before.kekRef).toMatch(new RegExp(`^${kv.base}/[0-9a-f]{32}#RSA-OAEP-256$`))
    kv.rotate()
    const after = await provider.wrap(dek, dataKeyContext(1))
    expect(after.kekRef).not.toBe(before.kekRef)
    expect((await provider.unwrap(before, dataKeyContext(1))).equals(dek)).toBe(true)
    expect(() => createAzureKeyVaultKmsProvider({ azure_key_algorithm: 'ROT13' })).toThrow(/AZURE_KMS_KEY_ALGORITHM/)
    await expect(createAzureKeyVaultKmsProvider({ azure_key_id: 'https://evil.example/secrets/x' }, { client: kv.clientFor }).wrap(dek, 'x')).rejects.toThrow(/Invalid Key Vault key id/)
  })
})

/** Fake Cloud KMS REST: AES-GCM with AAD, bearer token check. */
async function fakeCloudKms(): Promise<{ endpoint: string; close: () => Promise<void>; requests: string[] }> {
  const key = crypto.randomBytes(32)
  const requests: string[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => { body += d })
    req.on('end', () => {
      requests.push(`${req.method} ${req.url}`)
      const send = (status: number, json: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)) }
      if (req.headers.authorization !== 'Bearer good-token') return send(401, { error: { message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } })
      const input = JSON.parse(body)
      const aad = Buffer.from(input.additionalAuthenticatedData ?? '', 'base64')
      if (req.url!.endsWith(':encrypt')) {
        const iv = crypto.randomBytes(12)
        const c = crypto.createCipheriv('aes-256-gcm', key, iv)
        c.setAAD(aad)
        const ct = Buffer.concat([c.update(Buffer.from(input.plaintext, 'base64')), c.final(), c.getAuthTag()])
        return send(200, { name: `${req.url!.slice(4, -8)}/cryptoKeyVersions/1`, ciphertext: Buffer.concat([iv, ct]).toString('base64') })
      }
      try {
        const raw = Buffer.from(input.ciphertext, 'base64')
        const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
        d.setAAD(aad)
        d.setAuthTag(raw.subarray(raw.length - 16))
        return send(200, { plaintext: Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('base64') })
      } catch {
        return send(400, { error: { message: 'Decryption failed: the ciphertext is invalid.', status: 'INVALID_ARGUMENT' } })
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, close: () => new Promise((r) => server.close(() => r())) }
}

describe('gcp_kms (fake REST server)', () => {
  let fake: Awaited<ReturnType<typeof fakeCloudKms>>
  const name = 'projects/p/locations/europe-west1/keyRings/ut/cryptoKeys/data'
  beforeAll(async () => { fake = await fakeCloudKms() })
  afterAll(async () => { await fake.close() })

  it('round trip with the data-key id as AAD; another id fails; bad credentials fail with the reason', async () => {
    const provider = createGcpKmsProvider({ gcp_kms_key_name: name, gcp_kms_endpoint: fake.endpoint }, { token: async () => 'good-token' })
    const dek = crypto.randomBytes(32)
    const wrapped = await provider.wrap(dek, dataKeyContext(5))
    expect(wrapped.kekRef).toBe(name)
    expect(fake.requests[0]).toBe(`POST /v1/${name}:encrypt`)
    expect((await provider.unwrap(wrapped, dataKeyContext(5))).equals(dek)).toBe(true)
    await expect(provider.unwrap(wrapped, dataKeyContext(6))).rejects.toThrow(/Decryption failed/)
    const denied = createGcpKmsProvider({ gcp_kms_key_name: name, gcp_kms_endpoint: fake.endpoint }, { token: async () => 'stolen-token' })
    const error = await denied.wrap(dek, 'x').catch((e: Error) => e)
    expect(String(error)).toMatch(/failed \(401\): Request had invalid authentication credentials/)
    expect(String(error)).not.toContain('stolen-token')
    await expect(createGcpKmsProvider({ gcp_kms_key_name: 'projects/p/keys/x' }, { token: async () => 't' }).wrap(dek, 'x')).rejects.toThrow(/Invalid Cloud KMS key name/)
  })
})

// ── keyring ─────────────────────────────────────────────────────────────────

async function rowFor(provider: KmsProvider, id: number, dek: Buffer, activatesAt = new Date(0)): Promise<DataKeyRow> {
  const wrapped = await provider.wrap(dek, dataKeyContext(id))
  return { id, provider: provider.id, kek_ref: wrapped.kekRef, wrapped_key: wrapped.wrapped, check_value: dataKeyCheckValue(dek), created_at: new Date(), activates_at: activatesAt }
}

describe('keyring', () => {
  it('loads and verifies data keys; a wrong check value, an unknown provider or a swapped row is refused', async () => {
    const env = createEnvKmsProvider()
    const k1 = crypto.randomBytes(32)
    const k2 = crypto.randomBytes(32)
    const r1 = await rowFor(env, 1, k1)
    const r2 = await rowFor(env, 2, k2)
    const bad = { ...(await rowFor(env, 3, crypto.randomBytes(32))), check_value: dataKeyCheckValue(k1) }
    const foreign = { ...r1, id: 4, provider: 'aws_kms' }
    const swapped = { ...r2, id: 5 } // r2's wrapped key under another id
    const result = await loadDataKeys([r1, r2, bad, foreign, swapped], resolverFor(env))
    expect(result.loaded).toEqual([1, 2])
    expect(result.failures.map((f) => f.id)).toEqual([3, 4, 5])
    expect(result.failures[0].error).toMatch(/check value mismatch/)
    expect(result.failures[1].error).toMatch(/aws_kms KMS provider, which is not configured/)
    expect(result.failures[2].error).toMatch(/failed authentication/)
    expectNoKeyMaterial(JSON.stringify(result), [k1, k2])
    expect(decryptSecret(encryptSecret('v', { keyId: 2 }))).toBe('v')
    expect((await unwrapDataKey(r1, resolverFor(env))).equals(k1)).toBe(true)
  })
})

describe('bootstrapKms', () => {
  const log = vi.fn()
  afterEach(async () => {
    log.mockReset()
    delete process.env.KMS_PROVIDER
    const { stopKmsRefresh } = await import('@/lib/providers/kms/bootstrap')
    stopKmsRefresh()
  })

  it('default (env, no data keys): nothing changes, a missing schema is silent', async () => {
    const { bootstrapKms } = await import('@/lib/providers/kms/bootstrap')
    expect(await bootstrapKms({ source: { list: async () => [] }, log, refresh: false })).toEqual({ provider: 'env', keys: [], active: null })
    expect(await bootstrapKms({ source: { list: async () => { throw new Error('Could not find the function public.app_kms_data_keys in the schema cache') } }, log, refresh: false })).toMatchObject({ keys: [] })
    expect(log).not.toHaveBeenCalled()
    expect(encryptSecret('x')).toMatch(/^enc:v1:/)
  })

  it('installs data keys; an unwrappable active key refuses startup, an old one only warns', async () => {
    const { bootstrapKms } = await import('@/lib/providers/kms/bootstrap')
    const env = createEnvKmsProvider()
    const k1 = crypto.randomBytes(32)
    const k2 = crypto.randomBytes(32)
    const r1 = await rowFor(env, 1, k1)
    const r2 = await rowFor(env, 2, k2)
    const result = await bootstrapKms({ source: { list: async () => [{ ...r1, check_value: 'nope' }, r2] }, log, refresh: false })
    expect(result).toMatchObject({ keys: [2], active: 2 })
    expect(log.mock.calls.join(' ')).toMatch(/data key 1 could not be unwrapped/)
    expectNoKeyMaterial(log.mock.calls.join(' '), [k1, k2])
    clearDataKeys()
    await expect(bootstrapKms({ source: { list: async () => [r1, { ...r2, check_value: 'nope' }] }, log, refresh: false })).rejects.toThrow(/active data key 2 could not be unwrapped/)
  })

  it('a KMS provider other than env fails closed', async () => {
    const { bootstrapKms } = await import('@/lib/providers/kms/bootstrap')
    process.env.KMS_PROVIDER = 'aws_kms'
    await expect(bootstrapKms({ source: { list: async () => { throw new Error('connection refused') } }, log, refresh: false })).rejects.toThrow(/KMS_PROVIDER=aws_kms: the data keys could not be read/)
    installEncryptionKey(KEY_A)
    await expect(bootstrapKms({ source: { list: async () => [] }, log, refresh: false })).resolves.toMatchObject({ keys: [] })
    expect(log.mock.calls.join(' ')).toMatch(/no data key yet/)
  })
})
