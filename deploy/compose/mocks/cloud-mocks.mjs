// Stand-ins for the cloud services that have no official (or free)
// emulator, for the reference-profile smoke tests (docs/deployment-profiles.md).
// Dependency-free; the app reaches them through its real SDKs:
//
//   Azure  managed identity token endpoint (IDENTITY_ENDPOINT, as on Container
//          Apps), Key Vault secrets and keys (wrapKey / unwrapKey, for
//          KMS_PROVIDER=azure_key_vault; HTTPS on :8443, reached as
//          <vault>.vault.azure.net through a network alias; the SDK only sends
//          bearer tokens over TLS), Communication Services Email (send + poll),
//          Entra ID OIDC discovery, Azure Monitor Logs Ingestion (log export).
//   Google metadata server (GCE_METADATA_HOST: Application Default
//          Credentials, as on Cloud Run), Secret Manager (REST, the client's
//          HTTP/1.1 mode), Cloud KMS encrypt / decrypt (KMS_PROVIDER=gcp_kms),
//          Google OIDC discovery, Cloud Logging entries:write (log export).
//   AWS    ECS container credentials (AWS_CONTAINER_CREDENTIALS_FULL_URI over
//          HTTPS, as the ECS task role), SES v2 SendEmail (not in LocalStack's
//          community edition; AWS_ENDPOINT_URL_SESV2), Cognito user pool OIDC
//          discovery. Everything else AWS comes from LocalStack.
//
//   GET /_mock/ses    the SES v2 messages received
//   GET /_mock/logs   the log entries received (Azure Monitor rows, Cloud
//                     Logging entries), newest last
//
// Never use outside tests: tokens are not checked beyond being present, and
// the "KMS" keys are AES-256-GCM under a key derived from MOCK_KMS_SECRET.
//
//   MOCK_SECRETS    JSON {"name": "value"} served by Key Vault and Secret Manager
//   MOCK_KMS_SECRET seed of the mock key-encryption key (keep it stable: data
//                   keys wrapped under one seed don't unwrap under another)
//   MOCK_CERT_DIR   directory with server.pem + server-key.pem (enables :8443)

import { createServer as createHttp } from 'node:http'
import { createServer as createHttps } from 'node:https'
import { readFileSync, existsSync } from 'node:fs'
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'

const SECRETS = JSON.parse(process.env.MOCK_SECRETS || '{}')
const HTTP_PORT = Number(process.env.MOCK_HTTP_PORT || 8080)
const HTTPS_PORT = Number(process.env.MOCK_HTTPS_PORT || 8443)
const CERT_DIR = process.env.MOCK_CERT_DIR || '/certs'
const PUBLIC_HOST = process.env.MOCK_PUBLIC_HOST || `mocks:${HTTP_PORT}`

const KMS_KEY = createHash('sha256').update(`usertasks-mock-kms:${process.env.MOCK_KMS_SECRET || 'local'}`).digest()
const KMS_VERSION = '00000000000000000000000000000001'

/** AES-256-GCM "wrap": iv(12) | tag(16) | ciphertext, bound to the key name (and AAD). */
function kmsSeal(plaintext, keyName, aad = Buffer.alloc(0)) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KMS_KEY, iv)
  cipher.setAAD(Buffer.concat([Buffer.from(keyName), aad]))
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body])
}

function kmsOpen(sealed, keyName, aad = Buffer.alloc(0)) {
  const decipher = createDecipheriv('aes-256-gcm', KMS_KEY, sealed.subarray(0, 12))
  decipher.setAAD(Buffer.concat([Buffer.from(keyName), aad]))
  decipher.setAuthTag(sealed.subarray(12, 28))
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()])
}

const emails = []
const operations = new Map()
const logs = []
const sesMessages = []
const MAX_LOGS = 1000
const keepLogs = (kind, items) => {
  for (const item of items) logs.push({ kind, receivedAt: new Date().toISOString(), ...item })
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS)
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function oidcDiscovery(issuer) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/keys`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'email', 'profile'],
  }
}

async function handle(req, res, scheme) {
  const url = new URL(req.url, `http://${req.headers.host || PUBLIC_HOST}`)
  const path = url.pathname

  if (path === '/healthz') return json(res, 200, { ok: true })

  // ── Azure: managed identity (App Service / Container Apps protocol) ──
  if (path === '/msi/token') {
    if (!req.headers['x-identity-header']) return json(res, 400, { error: 'missing X-IDENTITY-HEADER' })
    const resource = url.searchParams.get('resource') || url.searchParams.get('scope') || ''
    return json(res, 200, {
      access_token: `mock-azure-token-${randomUUID()}`,
      expires_on: String(Math.floor(Date.now() / 1000) + 3600),
      resource,
      token_type: 'Bearer',
    })
  }

  // ── Azure: Key Vault secrets (HTTPS listener) ──
  const kv = path.match(/^\/secrets\/([A-Za-z0-9-]+)(?:\/[A-Za-z0-9]*)?\/?$/)
  if (kv && req.method === 'GET') {
    const auth = req.headers.authorization || ''
    if (!auth.startsWith('Bearer ')) {
      return json(res, 401, { error: { code: 'Unauthorized', message: 'AKV10000: Request is missing a Bearer token.' } }, {
        'www-authenticate': 'Bearer authorization="https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000", resource="https://vault.azure.net"',
      })
    }
    const name = kv[1]
    if (!(name in SECRETS)) return json(res, 404, { error: { code: 'SecretNotFound', message: `A secret with (name/id) ${name} was not found in this key vault.` } })
    return json(res, 200, {
      value: SECRETS[name],
      id: `https://${req.headers.host}/secrets/${name}/0123456789abcdef0123456789abcdef`,
      attributes: { enabled: true, created: 1700000000, updated: 1700000000, recoveryLevel: 'Recoverable' },
    })
  }

  // ── Azure: Key Vault keys (wrapKey / unwrapKey; HTTPS listener) ──
  // /keys/<name>[/<version>]/wrapkey|unwrapkey (the operation), or /keys/<name>[/<version>] (get).
  const key = path.match(/^\/keys\/([A-Za-z0-9-]+)(?:\/([A-Za-z0-9]*))?\/(wrapkey|unwrapkey)\/?$/) ??
    path.match(/^\/keys\/([A-Za-z0-9-]+)(?:\/([A-Za-z0-9]*))?()\/?$/)
  if (key) {
    const auth = req.headers.authorization || ''
    if (!auth.startsWith('Bearer ')) {
      return json(res, 401, { error: { code: 'Unauthorized', message: 'AKV10000: Request is missing a Bearer token.' } }, {
        'www-authenticate': 'Bearer authorization="https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000", resource="https://vault.azure.net"',
      })
    }
    const [, name, , op] = key
    // No "get" permission (as with the Crypto Service Encryption User role): the SDK falls back to remote wrap/unwrap.
    if (!op) return json(res, 403, { error: { code: 'Forbidden', message: 'The user, group or application does not have keys get permission.' } })
    if (req.method !== 'POST') return json(res, 405, { error: { code: 'MethodNotAllowed' } })
    const body = JSON.parse((await readBody(req)) || '{}')
    const kid = `https://${req.headers.host}/keys/${name}/${KMS_VERSION}`
    try {
      const input = Buffer.from(String(body.value || ''), 'base64url')
      const out = op === 'wrapkey' ? kmsSeal(input, `azure:${name}:${body.alg}`) : kmsOpen(input, `azure:${name}:${body.alg}`)
      return json(res, 200, { kid, value: out.toString('base64url') })
    } catch {
      return json(res, 400, { error: { code: 'BadParameter', message: 'The parameter is incorrect (unwrap failed).' } })
    }
  }

  // ── Azure: Communication Services Email ──
  if (path === '/emails:send' && req.method === 'POST') {
    const message = JSON.parse((await readBody(req)) || '{}')
    const id = randomUUID()
    emails.push({ id, ...message, receivedAt: new Date().toISOString() })
    operations.set(id, 'Succeeded')
    const apiVersion = url.searchParams.get('api-version') || '2023-03-31'
    return json(res, 202, { id, status: 'Running' }, {
      'operation-location': `${scheme}://${req.headers.host}/emails/operations/${id}?api-version=${apiVersion}`,
      'retry-after': '0',
    })
  }
  const op = path.match(/^\/emails\/operations\/([0-9a-f-]+)$/)
  if (op) return json(res, 200, { id: op[1], status: operations.get(op[1]) || 'Failed' })
  if (path === '/_mock/emails') return json(res, 200, emails)

  // ── Entra ID / Google OIDC discovery (doctor fetches it) ──
  const entra = path.match(/^\/entra\/([^/]+)\/v2\.0\/\.well-known\/openid-configuration$/)
  if (entra) return json(res, 200, oidcDiscovery(`http://${req.headers.host}/entra/${entra[1]}/v2.0`))
  if (path === '/google/.well-known/openid-configuration') return json(res, 200, oidcDiscovery(`http://${req.headers.host}/google`))
  if (/\/keys$/.test(path)) return json(res, 200, { keys: [] })

  // ── Google: metadata server ──
  if (path.startsWith('/computeMetadata/v1')) {
    const headers = { 'metadata-flavor': 'Google' }
    const rest = path.slice('/computeMetadata/v1'.length).replace(/\/+$/, '')
    if (rest === '/instance/service-accounts/default/token') {
      return json(res, 200, { access_token: `mock-gcp-token-${randomUUID()}`, expires_in: 3600, token_type: 'Bearer' }, headers)
    }
    const text = {
      '': 'instance/\nproject/\n',
      '/instance': 'service-accounts/\n',
      '/project/project-id': process.env.MOCK_GCP_PROJECT || 'usertasks-local',
      '/project/numeric-project-id': '123456789012',
      '/instance/service-accounts/default/email': 'usertasks@usertasks-local.iam.gserviceaccount.com',
      '/instance/service-accounts/default/scopes': 'https://www.googleapis.com/auth/cloud-platform',
      '/universe/universe-domain': 'googleapis.com',
      '/universe/universe_domain': 'googleapis.com',
    }[rest]
    if (text === undefined) { res.writeHead(404, headers); return res.end('not found') }
    res.writeHead(200, { 'content-type': 'text/plain', ...headers })
    return res.end(text)
  }

  // ── Google: Secret Manager (REST) ──
  const sm = path.match(/^\/v1\/projects\/([^/]+)\/secrets\/([^/]+)\/versions\/([^/:]+):access$/)
  if (sm) {
    if (!(req.headers.authorization || '').startsWith('Bearer ')) return json(res, 401, { error: { code: 401, status: 'UNAUTHENTICATED', message: 'missing token' } })
    const [, project, secret, version] = sm
    if (!(secret in SECRETS)) return json(res, 404, { error: { code: 404, status: 'NOT_FOUND', message: `Secret [projects/${project}/secrets/${secret}] not found or has no versions.` } })
    return json(res, 200, {
      name: `projects/${project}/secrets/${secret}/versions/${version === 'latest' ? '1' : version}`,
      payload: { data: Buffer.from(String(SECRETS[secret])).toString('base64') },
    })
  }

  // ── Google: Cloud KMS (REST cryptoKeys.encrypt / decrypt) ──
  const ckms = path.match(/^\/v1\/(projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/:]+):(encrypt|decrypt)$/)
  if (ckms && req.method === 'POST') {
    if (!(req.headers.authorization || '').startsWith('Bearer ')) return json(res, 401, { error: { code: 401, status: 'UNAUTHENTICATED', message: 'missing token' } })
    const [, name, op] = ckms
    const body = JSON.parse((await readBody(req)) || '{}')
    const aad = Buffer.from(String(body.additionalAuthenticatedData || ''), 'base64')
    try {
      if (op === 'encrypt') {
        const sealed = kmsSeal(Buffer.from(String(body.plaintext || ''), 'base64'), `gcp:${name}`, aad)
        return json(res, 200, { name: `${name}/cryptoKeyVersions/1`, ciphertext: sealed.toString('base64') })
      }
      const plain = kmsOpen(Buffer.from(String(body.ciphertext || ''), 'base64'), `gcp:${name}`, aad)
      return json(res, 200, { plaintext: plain.toString('base64') })
    } catch {
      return json(res, 400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Decryption failed: the ciphertext is invalid.' } })
    }
  }

  // ── Azure Monitor: Logs Ingestion API (data collection rule stream) ──
  const dcr = path.match(/^\/dataCollectionRules\/(dcr-[0-9a-f]{32})\/streams\/([A-Za-z0-9_-]+)$/)
  if (dcr && req.method === 'POST') {
    if (!(req.headers.authorization || '').startsWith('Bearer ')) return json(res, 401, { error: { code: 'InvalidToken', message: 'missing bearer token' } })
    const rows = JSON.parse((await readBody(req)) || '[]')
    if (!Array.isArray(rows)) return json(res, 400, { error: { code: 'InvalidPayload', message: 'expected an array' } })
    keepLogs('azure_monitor', rows.map((row) => ({ dcr: dcr[1], stream: dcr[2], row })))
    res.writeHead(204)
    return res.end()
  }

  // ── Google: Cloud Logging entries.write ──
  if (path === '/v2/entries:write' && req.method === 'POST') {
    if (!(req.headers.authorization || '').startsWith('Bearer ')) return json(res, 401, { error: { code: 401, status: 'UNAUTHENTICATED', message: 'missing token' } })
    const body = JSON.parse((await readBody(req)) || '{}')
    keepLogs('gcp_logging', (body.entries ?? []).map((entry) => ({ logName: body.logName, entry })))
    return json(res, 200, {})
  }
  if (path === '/_mock/logs') return json(res, 200, logs)

  // ── AWS: ECS container credentials (the task role) ──
  if (path === '/ecs/credentials') {
    const expected = process.env.MOCK_ECS_AUTH_TOKEN
    if (expected && req.headers.authorization !== expected) return json(res, 401, { message: 'bad authorization token' })
    return json(res, 200, {
      AccessKeyId: 'ASIALOCALTASKROLE01',
      SecretAccessKey: `mock-task-role-secret-${randomUUID()}`,
      Token: `mock-session-token-${randomUUID()}`,
      Expiration: new Date(Date.now() + 3_600_000).toISOString(),
      RoleArn: 'arn:aws:iam::123456789012:role/usertasks-task',
    })
  }

  // ── AWS: SES v2 SendEmail (REST JSON; SigV4-signed by the SDK, not checked) ──
  if (path === '/v2/email/outbound-emails' && req.method === 'POST') {
    if (!/^AWS4-HMAC-SHA256 Credential=/.test(req.headers.authorization || '')) return json(res, 403, { message: 'Missing Authentication Token' })
    const message = JSON.parse((await readBody(req)) || '{}')
    const id = randomUUID()
    sesMessages.push({ MessageId: id, receivedAt: new Date().toISOString(), ...message })
    return json(res, 200, { MessageId: id })
  }
  if (path === '/_mock/ses') return json(res, 200, sesMessages)

  // ── AWS: Cognito user pool OIDC discovery (doctor fetches it) ──
  const cognito = path.match(/^\/cognito\/([a-z0-9-]+_[0-9A-Za-z]+)\/\.well-known\/openid-configuration$/)
  if (cognito) return json(res, 200, oidcDiscovery(`http://${req.headers.host}/cognito/${cognito[1]}`))

  json(res, 404, { error: `mock: no route for ${req.method} ${path}` })
}

const serve = (scheme) => (req, res) => {
  handle(req, res, scheme).catch((error) => json(res, 500, { error: String(error?.message || error) }))
}

createHttp(serve('http')).listen(HTTP_PORT, () => console.log(`cloud mocks: http on :${HTTP_PORT}`))
if (existsSync(`${CERT_DIR}/server.pem`)) {
  createHttps({ cert: readFileSync(`${CERT_DIR}/server.pem`), key: readFileSync(`${CERT_DIR}/server-key.pem`) }, serve('https'))
    .listen(HTTPS_PORT, () => console.log(`cloud mocks: https on :${HTTPS_PORT}`))
}
