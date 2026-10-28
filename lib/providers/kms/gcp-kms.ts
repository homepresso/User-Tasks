import { kmsOption, type KmsOptions } from './options'
import { describeError, KmsError, type KmsProvider } from './types'

/**
 * gcp_kms: Google Cloud KMS over its REST API (cryptoKeys.encrypt /
 * cryptoKeys.decrypt) with Application Default Credentials from
 * google-auth-library (Cloud Run / GKE workload identity,
 * GOOGLE_APPLICATION_CREDENTIALS, or gcp_credentials_json). Data keys are
 * wrapped under gcp_kms_key_name with the data-key id as additional
 * authenticated data. Cloud KMS encrypts with the key's primary version and
 * finds the right version on decrypt, so rotation (automatic or manual)
 * needs nothing here; `usertasks-admin kms rewrap-keys` moves data keys to
 * the primary version. Cloud HSM and Cloud EKM keys work the same way.
 *
 * The identity needs roles/cloudkms.cryptoKeyEncrypterDecrypter on the key.
 * gcp_kms_endpoint points at a regional / Private Service Connect endpoint
 * (or a test double).
 */

type TokenSource = () => Promise<string>

export interface GcpKmsDeps {
  fetch?: typeof fetch
  token?: TokenSource
}

const KEY_NAME = /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/

function adcTokens(options: KmsOptions): TokenSource {
  const credentialsJson = kmsOption(options, 'gcp_credentials_json')
  let auth: { getAccessToken(): Promise<string | null | undefined> } | null = null
  return async () => {
    if (!auth) {
      const { GoogleAuth } = await import('google-auth-library')
      let credentials: Record<string, unknown> | undefined
      if (credentialsJson) {
        try {
          credentials = JSON.parse(credentialsJson)
        } catch {
          throw new KmsError('GCP_KMS_CREDENTIALS_JSON is not valid JSON')
        }
      }
      auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloudkms'], ...(credentials ? { credentials } : {}) }) as unknown as typeof auth
    }
    const token = await auth!.getAccessToken()
    if (!token) throw new KmsError('Application Default Credentials returned no access token for Cloud KMS')
    return token
  }
}

export function createGcpKmsProvider(options: KmsOptions, deps: GcpKmsDeps = {}): KmsProvider {
  const keyName = kmsOption(options, 'gcp_kms_key_name')
  const endpoint = (kmsOption(options, 'gcp_kms_endpoint') ?? 'https://cloudkms.googleapis.com').replace(/\/+$/, '')
  const doFetch = deps.fetch ?? fetch
  const token = deps.token ?? adcTokens(options)

  async function call(name: string, op: 'encrypt' | 'decrypt', body: Record<string, string>): Promise<Record<string, string>> {
    if (!KEY_NAME.test(name)) throw new KmsError(`Invalid Cloud KMS key name "${name.slice(0, 160)}" (projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>)`)
    let res: Response
    try {
      res = await doFetch(`${endpoint}/v1/${name}:${op}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (error) {
      if (error instanceof KmsError) throw error
      throw new KmsError(`Cloud KMS unreachable at ${endpoint}: ${describeError(error)}`)
    }
    const json = (await res.json().catch(() => null)) as (Record<string, string> & { error?: { message?: string; status?: string } }) | null
    if (!res.ok) throw new KmsError(`Cloud KMS ${op} with ${name} failed (${res.status})${json?.error?.message ? `: ${String(json.error.message).slice(0, 200)}` : ''}`)
    return json ?? {}
  }

  return {
    id: 'gcp_kms',
    onPrem: false,
    describe: () => `Cloud KMS key ${keyName ?? '(GCP_KMS_KEY_NAME not set)'}`,
    async wrap(dek, context) {
      if (!keyName) throw new KmsError('KMS_PROVIDER=gcp_kms requires GCP_KMS_KEY_NAME')
      const out = await call(keyName, 'encrypt', { plaintext: dek.toString('base64'), additionalAuthenticatedData: Buffer.from(context).toString('base64') })
      if (!out.ciphertext) throw new KmsError('Cloud KMS returned no ciphertext')
      // `name` is the key version that encrypted; decrypt takes the key and finds the version.
      return { wrapped: out.ciphertext, kekRef: keyName }
    },
    async unwrap({ wrapped, kekRef }, context) {
      const out = await call(kekRef, 'decrypt', { ciphertext: wrapped, additionalAuthenticatedData: Buffer.from(context).toString('base64') })
      if (!out.plaintext) throw new KmsError('Cloud KMS returned no plaintext')
      return Buffer.from(out.plaintext, 'base64')
    },
  }
}
