import { readEnv } from '@/lib/config/bootstrap'
import { secretOption, type SecretStoreOptions } from './options'
import { SecretStoreError, describeError, loadSecretsSdk, type SecretStore } from './types'

/**
 * Google Secret Manager (@google-cloud/secret-manager, an optional
 * dependency) with Application Default Credentials: workload identity on
 * GKE / Cloud Run's service account, GOOGLE_APPLICATION_CREDENTIALS, or
 * gcp_credentials_json. The identity needs roles/secretmanager.secretAccessor.
 *
 * gcp_endpoint (GCP_SECRET_MANAGER_ENDPOINT) points the client at another
 * endpoint: a regional one (https://secretmanager.<region>.rep.googleapis.com,
 * for data residency), Private Service Connect, or an http:// test double
 * (HTTP/1.1 REST mode; the reference GCP profile's mock).
 *
 * A name is a secret id in gcp_project_id (latest version), `name@<version>`
 * for a pinned version, or a full `projects/<p>/secrets/<s>/versions/<v>`.
 */

type AccessClient = { accessSecretVersion(request: { name: string }): Promise<[{ payload?: { data?: Uint8Array | string | null } | null }]> }

export interface GcpSecretManagerDeps {
  client?: AccessClient
}

export function gcpSecretVersionName(name: string, project: string | undefined): string {
  if (name.startsWith('projects/')) return name
  if (!project) throw new SecretStoreError('SECRETS_PROVIDER=gcp_secret_manager requires GCP_SECRET_MANAGER_PROJECT (or GOOGLE_CLOUD_PROJECT)')
  const [id, version = 'latest'] = name.split('@')
  const secretId = id.replace(/[^A-Za-z0-9_-]+/g, '-')
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(secretId) || !/^(latest|\d+)$/.test(version)) throw new SecretStoreError(`Invalid Secret Manager name "${name.slice(0, 80)}"`)
  return `projects/${project}/secrets/${secretId}/versions/${version}`
}

/** Client options for gcp_endpoint (pure; exported for tests). */
export function gcpEndpointOptions(endpoint: string | undefined): Record<string, unknown> {
  if (!endpoint) return {}
  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`)
  } catch {
    throw new SecretStoreError('GCP_SECRET_MANAGER_ENDPOINT is not a valid URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new SecretStoreError('GCP_SECRET_MANAGER_ENDPOINT must be an http(s) URL')
  const port = url.port ? Number(url.port) : url.protocol === 'http:' ? 80 : 443
  // gRPC needs TLS; a plain-http endpoint is only reachable in REST mode.
  return { apiEndpoint: url.hostname, port, ...(url.protocol === 'http:' ? { fallback: true, protocol: 'http' } : {}) }
}

export function createGcpSecretManagerStore(options: SecretStoreOptions, deps: GcpSecretManagerDeps = {}): SecretStore {
  const project = secretOption(options, 'gcp_project_id') ?? readEnv('GOOGLE_CLOUD_PROJECT') ?? readEnv('GCLOUD_PROJECT')
  const prefix = secretOption(options, 'name_prefix') ?? ''
  const credentialsJson = secretOption(options, 'gcp_credentials_json')
  const endpoint = secretOption(options, 'gcp_endpoint')
  let client: AccessClient | undefined = deps.client
  return {
    id: 'gcp_secret_manager',
    onPrem: false,
    async get(name) {
      const versionName = gcpSecretVersionName(name.startsWith('projects/') ? name : `${prefix}${name}`, project)
      if (!client) {
        const { SecretManagerServiceClient } = await loadSecretsSdk('@google-cloud/secret-manager', 'gcp_secret_manager', () => import('@google-cloud/secret-manager'))
        let credentials: Record<string, unknown> | undefined
        if (credentialsJson) {
          try {
            credentials = JSON.parse(credentialsJson)
          } catch {
            throw new SecretStoreError('GCP_SECRET_MANAGER_CREDENTIALS_JSON is not valid JSON')
          }
        }
        const endpointOptions = gcpEndpointOptions(endpoint)
        client = new SecretManagerServiceClient({ ...(credentials ? { credentials, projectId: project } : {}), ...endpointOptions }) as unknown as AccessClient
      }
      try {
        const [version] = await client.accessSecretVersion({ name: versionName })
        const data = version.payload?.data
        if (data === undefined || data === null) return undefined
        const value = typeof data === 'string' ? data : Buffer.from(data).toString('utf8')
        return value === '' ? undefined : value
      } catch (error) {
        const { code, status } = error as { code?: number; status?: string }
        // NOT_FOUND: gRPC code 5, or HTTP 404 in REST mode.
        if (code === 5 || code === 404 || status === 'NOT_FOUND') return undefined
        throw new SecretStoreError(`Google Secret Manager: ${describeError(error)}`)
      }
    },
  }
}
