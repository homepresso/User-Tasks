/**
 * Secret stores (lib/providers/secrets), `secret://` reference resolution
 * (lib/config/secret-refs.ts) and the ENCRYPTION_KEY bootstrap.
 *
 * Cloud stores run against mocked clients / fetch. Real backends, when
 * configured:
 *  - HashiCorp Vault dev server: SECRETS_TEST_VAULT_ADDR (+ SECRETS_TEST_VAULT_TOKEN, default "root"), e.g.
 *      docker run -d -p 18200:8200 -e VAULT_DEV_ROOT_TOKEN_ID=ut-root -e VAULT_DEV_LISTEN_ADDRESS=0.0.0.0:8200 hashicorp/vault:1.17
 *  - Supabase Vault: EVENT_STREAM_DB_URL (local stack), like the other DB tests.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { dbCapabilities } from './helpers/db-capabilities'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEnvSecretStore, envName } from '@/lib/providers/secrets/env'
import { createHashicorpVaultSecretStore } from '@/lib/providers/secrets/hashicorp-vault'
import { createAzureKeyVaultSecretStore, keyVaultName } from '@/lib/providers/secrets/azure-key-vault'
import { createGcpSecretManagerStore, gcpEndpointOptions, gcpSecretVersionName } from '@/lib/providers/secrets/gcp-secret-manager'
import { createAwsSecretsManagerStore } from '@/lib/providers/secrets/aws-secrets-manager'
import { createSupabaseVaultSecretStore } from '@/lib/providers/secrets/supabase-vault'
import { dbSecretKey } from '@/lib/providers/secrets/db'
import { resolveSecretStore, SecretStoreError } from '@/lib/providers/secrets'
import { ConfigError } from '@/lib/config/schema'
import { clearSecretCache, parseSecretRef, resolveSecretRef, resolveSecretRefs, secretTtlMs, type SecretSource } from '@/lib/config/secret-refs'

const SECRET_VALUE = 'sup3r-s3cret-value'

describe('secret references', () => {
  beforeEach(() => clearSecretCache())

  it('parses names and fields', () => {
    expect(parseSecretRef('secret://smtp_password')).toEqual({ name: 'smtp_password' })
    expect(parseSecretRef('secret://usertasks/smtp#password')).toEqual({ name: 'usertasks/smtp', field: 'password' })
    expect(() => parseSecretRef('secret://')).toThrow(ConfigError)
  })

  it('resolves references with a TTL cache and leaves other options alone', async () => {
    let now = 1_000
    const get = vi.fn(async (name: string) => (name === 'key' ? SECRET_VALUE : undefined))
    const store: SecretSource = { id: 'test', get }
    expect(await resolveSecretRef('secret://key', store, { ttlMs: 60_000, now: () => now })).toBe(SECRET_VALUE)
    now += 30_000
    expect(await resolveSecretRef('secret://key', store, { ttlMs: 60_000, now: () => now })).toBe(SECRET_VALUE)
    expect(get).toHaveBeenCalledTimes(1)
    now += 31_000
    await resolveSecretRef('secret://key', store, { ttlMs: 60_000, now: () => now })
    expect(get).toHaveBeenCalledTimes(2) // expired: rotation is picked up

    const options = await resolveSecretRefs('storage', { region: 'eu', secret_access_key: 'secret://key', n: 3 }, store)
    expect(options).toEqual({ region: 'eu', secret_access_key: SECRET_VALUE, n: 3 })
  })

  it('reads JSON fields, or native fields when the store has them', async () => {
    const json: SecretSource = { id: 'json', get: async () => JSON.stringify({ user: 'u', password: SECRET_VALUE }) }
    expect(await resolveSecretRef('secret://smtp#password', json)).toBe(SECRET_VALUE)
    const plain: SecretSource = { id: 'plain', get: async () => 'not-json' }
    await expect(resolveSecretRef('secret://x#f', plain)).rejects.toThrow(/not a JSON object/)
    const native: SecretSource = { id: 'native', get: async () => 'x', getField: async (_n, f) => (f === 'password' ? SECRET_VALUE : undefined) }
    expect(await resolveSecretRef('secret://smtp#password', native)).toBe(SECRET_VALUE)
  })

  it('fails clearly on a missing secret or a store error, never leaking values, and caches failures briefly', async () => {
    let now = 0
    const get = vi.fn(async (name: string) => {
      if (name === 'broken') throw new Error('connect ECONNREFUSED 10.0.0.1:8200')
      return undefined
    })
    const store: SecretSource = { id: 'hashicorp_vault', get }
    await expect(resolveSecretRefs('email', { smtp_password: 'secret://missing' }, store)).rejects.toThrow(
      'email.smtp_password: secret "missing" was not found in the hashicorp_vault secret store',
    )
    await expect(resolveSecretRef('secret://broken', store, { label: 'storage.secret_access_key', now: () => now })).rejects.toThrow(
      /storage\.secret_access_key: secret "broken" could not be read from the hashicorp_vault secret store: connect ECONNREFUSED/,
    )
    await expect(resolveSecretRef('secret://broken', store, { now: () => now })).rejects.toThrow(ConfigError)
    expect(get.mock.calls.filter(([n]) => n === 'broken')).toHaveLength(1) // cached failure
    now += 11_000
    await expect(resolveSecretRef('secret://broken', store, { now: () => now })).rejects.toThrow()
    expect(get.mock.calls.filter(([n]) => n === 'broken')).toHaveLength(2)
  })

  it('cache TTL comes from secrets.cache_ttl_seconds', () => {
    expect(secretTtlMs({})).toBe(300_000)
    expect(secretTtlMs({ cache_ttl_seconds: '60' })).toBe(60_000)
    expect(secretTtlMs({ cache_ttl_seconds: 0 })).toBe(0)
  })
})

describe('getProviderConfig resolves secret:// options from the configured store', () => {
  const ORIGINAL = { ...process.env }
  beforeEach(() => {
    vi.resetModules()
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[key]
  })
  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  it('env store: S3 secret key from another variable; missing ref is a ConfigError without values', async () => {
    process.env.STORAGE_PROVIDER = 's3'
    process.env.S3_SECRET_ACCESS_KEY = 'secret://minio_secret'
    process.env.MINIO_SECRET = SECRET_VALUE
    const { getProviderConfig } = await import('@/lib/config')
    const { clearSecretCache: clear } = await import('@/lib/config/secret-refs')
    clear()
    expect((await getProviderConfig('storage')).options.secret_access_key).toBe(SECRET_VALUE)
    delete process.env.MINIO_SECRET
    clear()
    const error = await getProviderConfig('storage').catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('storage.secret_access_key: secret "minio_secret" was not found in the env secret store')
  })

  it('the secrets area itself is not resolved (the store must be reachable first)', async () => {
    process.env.SECRETS_PROVIDER = 'hashicorp_vault'
    process.env.VAULT_TOKEN = 'secret://elsewhere'
    const { getProviderConfig } = await import('@/lib/config')
    expect((await getProviderConfig('secrets')).options.vault_token).toBe('secret://elsewhere')
  })
})

// ── Stores ───────────────────────────────────────────────────────────────────

describe('env store', () => {
  const ORIGINAL = { ...process.env }
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'ut-secrets-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  it('reads exact and UPPER_SNAKE names, *_FILE and a secrets directory', async () => {
    process.env.UT_TEST_PLAIN = 'a'
    process.env['ut-exact'] = 'exact'
    await writeFile(path.join(dir, 'smtp-file'), `${SECRET_VALUE}\n`)
    process.env.UT_TEST_VIA_FILE_FILE = path.join(dir, 'smtp-file')
    await writeFile(path.join(dir, 'mounted_key'), 'from-dir\n')
    const store = createEnvSecretStore({ files_dir: dir })
    expect(envName('ut.test-plain')).toBe('UT_TEST_PLAIN')
    expect(await store.get('ut.test-plain')).toBe('a')
    expect(await store.get('ut-exact')).toBe('exact')
    expect(await store.get('ut_test_via_file')).toBe(SECRET_VALUE)
    expect(await store.get('mounted_key')).toBe('from-dir')
    expect(await store.get('nothing_here')).toBeUndefined()
    await expect(store.get('../etc/passwd')).rejects.toThrow(SecretStoreError)
  })
})

describe('db store', () => {
  it('maps names to secrets.<name> settings and reserves option names', () => {
    expect(dbSecretKey('SMTP-Password')).toBe('secrets.smtp_password')
    expect(() => dbSecretKey('vault_addr')).toThrow(/option name/)
    expect(() => dbSecretKey('9bad')).toThrow(SecretStoreError)
  })

  it('reads the decrypted instance setting', async () => {
    vi.resetModules()
    vi.doMock('@/lib/config/instance-settings', () => ({ loadInstanceSettings: async () => new Map([['secrets.smtp_password', SECRET_VALUE]]) }))
    const { createDbSecretStore } = await import('@/lib/providers/secrets/db')
    expect(await createDbSecretStore().get('smtp-password')).toBe(SECRET_VALUE)
    expect(await createDbSecretStore().get('other')).toBeUndefined()
    vi.doUnmock('@/lib/config/instance-settings')
  })
})

/** Fake Vault HTTP API: KV v2 reads, AppRole and Kubernetes logins. */
function fakeVault(opts: { leaseSeconds?: number } = {}) {
  const tokens = new Set(['root-token'])
  const kv: Record<string, Record<string, unknown>> = {
    'secret/data/app/smtp': { user: 'mailer', password: SECRET_VALUE },
    'secret/data/app/single': { value: 'only-value' },
    'secret/data/app/onekey': { apikey: 'k-1' },
  }
  const calls: Array<{ url: string; headers: Record<string, string>; body?: unknown }> = []
  let logins = 0
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = init.headers as Record<string, string>
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, headers, body })
    const path = url.replace('http://vault.test/v1/', '')
    if (path === 'auth/approle/login') {
      if (body.role_id !== 'role-1' || body.secret_id !== 'sid-1') return Response.json({ errors: ['invalid role or secret ID'] }, { status: 400 })
      const token = `approle-${++logins}`
      tokens.add(token)
      return Response.json({ auth: { client_token: token, lease_duration: opts.leaseSeconds ?? 3600 } })
    }
    if (path === 'auth/kubernetes/login') {
      if (body.role !== 'usertasks' || body.jwt !== 'k8s-jwt') return Response.json({ errors: ['permission denied'] }, { status: 403 })
      const token = `k8s-${++logins}`
      tokens.add(token)
      return Response.json({ auth: { client_token: token, lease_duration: 600 } })
    }
    if (!tokens.has(headers['X-Vault-Token'])) return Response.json({ errors: ['permission denied'] }, { status: 403 })
    if (!(path in kv)) return Response.json({ errors: [] }, { status: 404 })
    return Response.json({ data: { data: kv[path], metadata: { version: 1 } } })
  })
  return { fetch: fetchMock as unknown as typeof fetch, calls, tokens, revoke: (t: string) => tokens.delete(t), logins: () => logins }
}

describe('hashicorp_vault store (fake API)', () => {
  it('token auth: reads value / only key / named field; 404 is undefined; several keys need a field', async () => {
    const vault = fakeVault()
    const store = createHashicorpVaultSecretStore({ vault_addr: 'http://vault.test/', vault_token: 'root-token', vault_namespace: 'team-a' }, { fetch: vault.fetch })
    expect(await store.get('app/single')).toBe('only-value')
    expect(await store.get('app/onekey')).toBe('k-1')
    expect(await store.getField!('app/smtp', 'password')).toBe(SECRET_VALUE)
    expect(await store.get('app/missing')).toBeUndefined()
    await expect(store.get('app/smtp')).rejects.toThrow(/several keys \(user, password\)/)
    expect(vault.calls[0].url).toBe('http://vault.test/v1/secret/data/app/single')
    expect(vault.calls[0].headers['X-Vault-Namespace']).toBe('team-a')
  })

  it('wrong token: a SecretStoreError without the token or values', async () => {
    const vault = fakeVault()
    const store = createHashicorpVaultSecretStore({ vault_addr: 'http://vault.test', vault_token: 'bad-token' }, { fetch: vault.fetch })
    const error = await store.get('app/single').catch((e: Error) => e)
    expect(error).toBeInstanceOf(SecretStoreError)
    expect((error as Error).message).toMatch(/403/)
    expect((error as Error).message).not.toContain('bad-token')
  })

  it('AppRole: logs in once, reuses the token, renews before the lease ends and after a revoke', async () => {
    let now = 0
    const vault = fakeVault({ leaseSeconds: 120 })
    const store = createHashicorpVaultSecretStore({ vault_addr: 'http://vault.test', vault_role_id: 'role-1', vault_secret_id: 'sid-1' }, { fetch: vault.fetch, now: () => now })
    expect(await store.get('app/single')).toBe('only-value')
    expect(await store.get('app/single')).toBe('only-value')
    expect(vault.logins()).toBe(1)
    now += 100_000 // past lease - 30 s
    await store.get('app/single')
    expect(vault.logins()).toBe(2)
    vault.revoke('approle-2')
    expect(await store.get('app/single')).toBe('only-value') // 403 → login again → retry
    expect(vault.logins()).toBe(3)
    const bad = createHashicorpVaultSecretStore({ vault_addr: 'http://vault.test', vault_role_id: 'role-1', vault_secret_id: 'wrong' }, { fetch: vault.fetch })
    await expect(bad.get('app/single')).rejects.toThrow(/approle login failed \(400\)/)
  })

  it('Kubernetes auth reads the service-account token', async () => {
    const vault = fakeVault()
    const readFile = vi.fn(async () => 'k8s-jwt\n')
    const store = createHashicorpVaultSecretStore({ vault_addr: 'http://vault.test', vault_k8s_role: 'usertasks' }, { fetch: vault.fetch, readFile })
    expect(await store.get('app/single')).toBe('only-value')
    expect(readFile).toHaveBeenCalledWith('/var/run/secrets/kubernetes.io/serviceaccount/token')
  })

  it('unreachable or unconfigured Vault fails clearly', async () => {
    const down = createHashicorpVaultSecretStore({ vault_addr: 'http://vault.test', vault_token: 't' }, { fetch: (async () => { throw new Error('connect ECONNREFUSED') }) as unknown as typeof fetch })
    await expect(down.get('x')).rejects.toThrow(/Vault unreachable at http:\/\/vault.test: connect ECONNREFUSED/)
    await expect(createHashicorpVaultSecretStore({ vault_token: 't' }).get('x')).rejects.toThrow(/VAULT_ADDR/)
    expect(() => createHashicorpVaultSecretStore({ vault_addr: 'x', vault_auth: 'ldap' })).toThrow(/VAULT_AUTH_METHOD/)
  })
})

const VAULT_ADDR = process.env.SECRETS_TEST_VAULT_ADDR
const VAULT_ROOT = process.env.SECRETS_TEST_VAULT_TOKEN ?? 'root'

describe.skipIf(!VAULT_ADDR)('hashicorp_vault store (real Vault dev server)', () => {
  const run = `ut-${randomBytes(4).toString('hex')}`
  const api = (path: string, init: RequestInit = {}) =>
    fetch(`${VAULT_ADDR}/v1/${path}`, { ...init, headers: { 'X-Vault-Token': VAULT_ROOT, 'content-type': 'application/json', ...(init.headers ?? {}) } })

  beforeAll(async () => {
    await api(`secret/data/${run}/smtp`, { method: 'POST', body: JSON.stringify({ data: { user: 'mailer', password: SECRET_VALUE } }) })
    await api(`secret/data/${run}/key`, { method: 'POST', body: JSON.stringify({ data: { value: 'v1' } }) })
    await api('sys/auth/approle', { method: 'POST', body: JSON.stringify({ type: 'approle' }) }) // 400 when already enabled
    await api(`sys/policies/acl/${run}`, { method: 'PUT', body: JSON.stringify({ policy: `path "secret/data/${run}/*" { capabilities = ["read"] }` }) })
    await api(`auth/approle/role/${run}`, { method: 'POST', body: JSON.stringify({ token_policies: [run], token_ttl: '5m' }) })
  })

  afterAll(async () => {
    await api(`secret/metadata/${run}/smtp`, { method: 'DELETE' })
    await api(`secret/metadata/${run}/key`, { method: 'DELETE' })
    await api(`auth/approle/role/${run}`, { method: 'DELETE' })
    await api(`sys/policies/acl/${run}`, { method: 'DELETE' })
  })

  it('reads KV v2 with the token', async () => {
    const store = resolveSecretStore('hashicorp_vault', { vault_addr: VAULT_ADDR, vault_token: VAULT_ROOT, name_prefix: `${run}/` })
    expect(await store.getField!('smtp', 'password')).toBe(SECRET_VALUE)
    expect(await store.get('key')).toBe('v1')
    expect(await store.get('missing')).toBeUndefined()
  })

  it('reads with AppRole and only within its policy, and picks up rotation after the TTL', async () => {
    const roleId = ((await (await api(`auth/approle/role/${run}/role-id`)).json()) as { data: { role_id: string } }).data.role_id
    const secretId = ((await (await api(`auth/approle/role/${run}/secret-id`, { method: 'POST' })).json()) as { data: { secret_id: string } }).data.secret_id
    const store = resolveSecretStore('hashicorp_vault', { vault_addr: VAULT_ADDR, vault_role_id: roleId, vault_secret_id: secretId, name_prefix: `${run}/` })
    clearSecretCache()
    expect(await resolveSecretRef('secret://smtp#password', store, { ttlMs: 0 })).toBe(SECRET_VALUE)
    await api(`secret/data/${run}/key`, { method: 'POST', body: JSON.stringify({ data: { value: 'v2' } }) })
    expect(await resolveSecretRef('secret://key', store, { ttlMs: 0 })).toBe('v2')
    const outside = resolveSecretStore('hashicorp_vault', { vault_addr: VAULT_ADDR, vault_role_id: roleId, vault_secret_id: secretId })
    await expect(outside.get('other/thing')).rejects.toThrow(/403/)
  })
})

describe('azure_key_vault store (mocked client)', () => {
  it('maps names, returns values, treats 404 as missing and wraps other errors', async () => {
    const getSecret = vi.fn(async (name: string) => {
      if (name === 'smtp-password') return { value: SECRET_VALUE }
      if (name === 'boom') throw Object.assign(new Error('Forbidden by policy'), { statusCode: 403 })
      throw Object.assign(new Error('not found'), { statusCode: 404, code: 'SecretNotFound' })
    })
    const store = createAzureKeyVaultSecretStore({ azure_key_vault_url: 'https://kv.vault.azure.net' }, { client: { getSecret } })
    expect(keyVaultName('usertasks/smtp_password')).toBe('usertasks-smtp-password')
    expect(await store.get('smtp_password')).toBe(SECRET_VALUE)
    expect(await store.get('nope')).toBeUndefined()
    await expect(store.get('boom')).rejects.toThrow('Azure Key Vault: Forbidden by policy')
    await expect(createAzureKeyVaultSecretStore({}).get('x')).rejects.toThrow(/AZURE_KEY_VAULT_URL/)
  })
})

describe('gcp_secret_manager store (mocked client)', () => {
  it('reads the latest or a pinned version; NOT_FOUND is missing', async () => {
    const accessSecretVersion = vi.fn(async ({ name }: { name: string }) => {
      if (name.includes('/secrets/smtp-password/')) return [{ payload: { data: Buffer.from(SECRET_VALUE) } }] as [{ payload: { data: Uint8Array } }]
      throw Object.assign(new Error('5 NOT_FOUND: Secret not found'), { code: 5 })
    })
    const store = createGcpSecretManagerStore({ gcp_project_id: 'proj' }, { client: { accessSecretVersion } })
    expect(await store.get('smtp_password'.replace('_', '-'))).toBe(SECRET_VALUE)
    expect(accessSecretVersion).toHaveBeenCalledWith({ name: 'projects/proj/secrets/smtp-password/versions/latest' })
    expect(await store.get('absent')).toBeUndefined()
    expect(gcpSecretVersionName('k@3', 'p')).toBe('projects/p/secrets/k/versions/3')
    expect(gcpSecretVersionName('projects/x/secrets/y/versions/1', undefined)).toBe('projects/x/secrets/y/versions/1')
    expect(() => gcpSecretVersionName('k', undefined)).toThrow(/GCP_SECRET_MANAGER_PROJECT/)
  })

  it('REST mode: HTTP 404 / status NOT_FOUND is missing; other errors throw without the value', async () => {
    const accessSecretVersion = vi.fn(async ({ name }: { name: string }) => {
      if (name.includes('/secrets/rest404/')) throw Object.assign(new Error('{"error":{"code":404}}'), { code: 404 })
      if (name.includes('/secrets/status/')) throw Object.assign(new Error('not found'), { status: 'NOT_FOUND' })
      throw Object.assign(new Error('7 PERMISSION_DENIED'), { code: 7 })
    })
    const store = createGcpSecretManagerStore({ gcp_project_id: 'proj' }, { client: { accessSecretVersion } })
    expect(await store.get('rest404')).toBeUndefined()
    expect(await store.get('status')).toBeUndefined()
    await expect(store.get('denied')).rejects.toThrow(/Google Secret Manager: .*PERMISSION_DENIED/)
  })

  it('gcp_endpoint: regional https endpoints keep gRPC; http test doubles use REST mode; bad values are refused', () => {
    expect(gcpEndpointOptions(undefined)).toEqual({})
    expect(gcpEndpointOptions('https://secretmanager.europe-west1.rep.googleapis.com')).toEqual({ apiEndpoint: 'secretmanager.europe-west1.rep.googleapis.com', port: 443 })
    expect(gcpEndpointOptions('secretmanager.me-central2.rep.googleapis.com')).toEqual({ apiEndpoint: 'secretmanager.me-central2.rep.googleapis.com', port: 443 })
    expect(gcpEndpointOptions('http://mocks:8080')).toEqual({ apiEndpoint: 'mocks', port: 8080, fallback: true, protocol: 'http' })
    expect(() => gcpEndpointOptions('ftp://x')).toThrow(/http\(s\) URL/)
    expect(() => gcpEndpointOptions('http://')).toThrow(/not a valid URL/)
  })
})

describe('aws_secrets_manager store (mocked client)', () => {
  it('reads SecretString with a prefix; ResourceNotFound is missing; JSON fields via refs', async () => {
    const send = vi.fn(async (command: { input: { SecretId: string } }) => {
      if (command.input.SecretId === 'prod/smtp') return { SecretString: JSON.stringify({ password: SECRET_VALUE }) }
      throw Object.assign(new Error('Secrets Manager can’t find the specified secret.'), { name: 'ResourceNotFoundException' })
    })
    class Cmd { constructor(public input: { SecretId: string }) {} }
    const store = createAwsSecretsManagerStore({ name_prefix: 'prod/' }, { client: { send } as never, GetSecretValueCommand: Cmd })
    clearSecretCache()
    expect(await resolveSecretRef('secret://smtp#password', store)).toBe(SECRET_VALUE)
    expect(await store.get('missing')).toBeUndefined()
  })
})

const DB_URL = process.env.EVENT_STREAM_DB_URL
const CAPS = await dbCapabilities()

describe.skipIf(!DB_URL || !CAPS?.vault)('supabase_vault store (local DB)', () => {
  const name = `ut_secret_test_${randomBytes(4).toString('hex')}`
  const db = new Client({ connectionString: DB_URL })
  beforeAll(async () => {
    await db.connect()
    await db.query('SELECT vault.create_secret($1, $2)', [SECRET_VALUE, name])
  })
  afterAll(async () => {
    await db.query('DELETE FROM vault.secrets WHERE name = $1', [name])
    await db.end()
  })

  it('reads vault.decrypted_secrets by name', async () => {
    const store = createSupabaseVaultSecretStore({ database_url: DB_URL })
    expect(await store.get(name)).toBe(SECRET_VALUE)
    expect(await store.get(`${name}_missing`)).toBeUndefined()
    await expect(createSupabaseVaultSecretStore({ database_url: 'postgresql://x:y@127.0.0.1:1/z' }).get(name)).rejects.toThrow(/Supabase Vault/)
  })
})

// ── ENCRYPTION_KEY bootstrap ─────────────────────────────────────────────────

describe('ENCRYPTION_KEY from the secret store', () => {
  const ORIGINAL = { ...process.env }
  const KEY = randomBytes(32).toString('base64')
  beforeEach(() => {
    vi.resetModules()
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_KEY', 'SECRETS_PROVIDER']) delete process.env[key]
  })
  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  const load = async () => {
    const [{ bootstrapEncryptionKey }, crypto] = await Promise.all([import('@/lib/providers/secrets/bootstrap'), import('@/lib/secret-crypto')])
    return { bootstrapEncryptionKey, crypto }
  }

  it('a plain env key is used as is', async () => {
    process.env.ENCRYPTION_KEY = KEY
    const { bootstrapEncryptionKey } = await load()
    expect(await bootstrapEncryptionKey()).toBe('env')
  })

  it('ENCRYPTION_KEY=secret://… is resolved from the store and installed', async () => {
    process.env.ENCRYPTION_KEY = 'secret://app_encryption_key'
    process.env.APP_ENCRYPTION_KEY = KEY
    const { bootstrapEncryptionKey, crypto } = await load()
    expect(() => crypto.encryptSecret('x')).toThrow(/not resolved/) // fails closed before bootstrap
    expect(await bootstrapEncryptionKey()).toBe('secret_ref')
    expect(crypto.decryptSecret(crypto.encryptSecret('hello'))).toBe('hello')
    expect(crypto.encryptSecret('hello')).toMatch(/^enc:v1:/)
  })

  it('an unresolvable reference is fatal, and the message has no value', async () => {
    process.env.ENCRYPTION_KEY = 'secret://absent_key'
    const { bootstrapEncryptionKey } = await load()
    await expect(bootstrapEncryptionKey()).rejects.toThrow('ENCRYPTION_KEY: secret "absent_key" was not found in the env secret store')
  })

  it('unset: looked up in an external store; missing keeps passthrough with a warning; errors are fatal', async () => {
    const { bootstrapEncryptionKey, crypto } = await load()
    const log = vi.fn()
    expect(await bootstrapEncryptionKey({ store: { id: 'hashicorp_vault', onPrem: true, get: async () => undefined }, log })).toBe('none')
    expect(log.mock.calls[0][0]).toMatch(/"encryption_key" was not found in the hashicorp_vault/)
    expect(crypto.encryptSecret('x')).toBe('x')
    await expect(bootstrapEncryptionKey({ store: { id: 'hashicorp_vault', onPrem: true, get: async () => { throw new SecretStoreError('Vault unreachable') } }, log })).rejects.toThrow(/unreachable/)
    expect(await bootstrapEncryptionKey({ store: { id: 'hashicorp_vault', onPrem: true, get: async (n) => (n === 'encryption_key' ? KEY : undefined) }, log })).toBe('secret_store')
    expect(crypto.encryptSecret('x')).toMatch(/^enc:v1:/)
    expect(() => crypto.installEncryptionKey('too-short')).toThrow(/32 bytes/)
  })

  it('env and db stores are never asked (db needs the key itself)', async () => {
    const { bootstrapEncryptionKey } = await load()
    const get = vi.fn()
    expect(await bootstrapEncryptionKey({ store: { id: 'db', onPrem: true, get } })).toBe('none')
    expect(get).not.toHaveBeenCalled()
  })
})

describe('instance settings: credentials must be encrypted or references', () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL }
    vi.doUnmock('@/lib/providers/db')
  })

  it('refuses plaintext credentials and accepts secret:// references and encrypted values', async () => {
    vi.resetModules()
    const upserts: Array<Record<string, unknown>> = []
    vi.doMock('@/lib/providers/db', () => ({
      hasServiceDb: () => true,
      getServiceDb: () => ({ from: () => ({ upsert: async (row: Record<string, unknown>) => (upserts.push(row), { error: null }) }) }),
    }))
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64')
    const { setInstanceSetting } = await import('@/lib/config/instance-settings')
    for (const key of ['email.smtp_password', 'email.resend_api_key', 'storage.secret_access_key', 'secrets.vault_token', 'secrets.smtp_password']) {
      await expect(setInstanceSetting(key, 'plain')).rejects.toThrow(/credential/)
    }
    await setInstanceSetting('email.smtp_password', 'secret://smtp_password')
    await setInstanceSetting('secrets.smtp_password', SECRET_VALUE, { secret: true })
    await setInstanceSetting('secrets.vault_addr', 'https://vault.internal:8200')
    await setInstanceSetting('email.smtp_host', 'mail.internal')
    expect(upserts.map((row) => [row.key, row.secret])).toEqual([
      ['email.smtp_password', false], ['secrets.smtp_password', true], ['secrets.vault_addr', false], ['email.smtp_host', false],
    ])
    expect(String(upserts[1].value)).toMatch(/^enc:v1:/)
    expect(JSON.stringify(upserts)).not.toContain(SECRET_VALUE)
  })
})
