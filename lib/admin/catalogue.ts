import { DEFAULT_PROVIDERS, PROVIDER_IDS, type ProviderArea, type ProviderId } from '@/lib/config/schema'

/**
 * Provider catalogue (plan: provider catalogue + Azure / Google Cloud
 * compatibility), shared by `usertasks-admin providers list`, `status` and
 * Settings → Infrastructure. One entry per provider id in PROVIDER_IDS;
 * __tests__/admin-catalogue.test.ts keeps the two (and each provider's own
 * `onPrem` flag) in step.
 *
 *  - onPrem   runs fully on-premises / air-gapped (no SaaS, no outbound internet)
 *  - aws      first-class AWS option (native service or IAM role)
 *  - azure    first-class Azure option (native service or managed identity)
 *  - gcp      first-class Google Cloud option
 *  - requiresSupabase  needs a Supabase project (API or Supabase-only SQL)
 *  - switch   what `usertasks-admin switch <area> --to <id>` does for it
 */

export type SwitchSupport = 'data' | 'config' | 'none'

export interface ProviderCatalogueEntry {
  area: ProviderArea
  id: string
  label: string
  onPrem: boolean
  aws: boolean
  azure: boolean
  gcp: boolean
  requiresSupabase: boolean
  /** data: the switch copies / converts data; config: validated config change only. */
  switch: SwitchSupport
  capabilities: string[]
  /** Anchor in docs/infrastructure.md. */
  docs: string
}

/** CLI spelling of each area (`database` reads better than `db`). */
export const AREA_LABELS: Record<ProviderArea, string> = {
  db: 'Database',
  auth: 'Auth',
  storage: 'Storage',
  realtime: 'Realtime',
  scheduler: 'Scheduler',
  email: 'Email',
  secrets: 'Secrets',
  cache: 'Cache',
  kms: 'KMS',
}

const AREA_ALIASES: Record<string, ProviderArea> = { database: 'db', db: 'db' }

/** `database` / `db` → db; other areas as named. Null when unknown. */
export function parseArea(value: string | undefined): ProviderArea | null {
  if (!value) return null
  const key = value.trim().toLowerCase()
  if (AREA_ALIASES[key]) return AREA_ALIASES[key]
  return (Object.keys(PROVIDER_IDS) as ProviderArea[]).includes(key as ProviderArea) ? (key as ProviderArea) : null
}

export function areaName(area: ProviderArea): string {
  return area === 'db' ? 'database' : area
}

type Entry = Omit<ProviderCatalogueEntry, 'area' | 'docs'> & { docs?: string }

const E = (id: string, label: string, flags: Partial<Entry> & Pick<Entry, 'onPrem' | 'switch' | 'capabilities'>): Entry => ({
  id,
  label,
  aws: false,
  azure: false,
  gcp: false,
  requiresSupabase: false,
  ...flags,
})

const CATALOGUE: Record<ProviderArea, Entry[]> = {
  db: [
    E('supabase', 'Supabase Postgres (PostgREST)', { onPrem: false, requiresSupabase: true, switch: 'data', capabilities: ['rls', 'postgrest'] }),
    E('postgres', 'PostgreSQL 15+ (in-process pg-query)', {
      onPrem: true, aws: true, azure: true, gcp: true, switch: 'data',
      capabilities: ['rls', 'pgbouncer_transaction_mode', 'rds_iam_auth', 'rds_proxy', 'entra_token_auth', 'cloud_sql_iam_auth'],
    }),
  ],
  auth: [
    E('supabase', 'Supabase Auth', { onPrem: false, requiresSupabase: true, switch: 'data', capabilities: ['password', 'oauth_google', 'oauth_microsoft'] }),
    E('builtin', 'Built-in (users and bcrypt in Postgres)', { onPrem: true, aws: true, azure: true, gcp: true, switch: 'data', capabilities: ['password', 'email_confirmation', 'password_reset', 'sso'] }),
    E('oidc', 'OpenID Connect SSO', { onPrem: true, aws: true, azure: true, gcp: true, switch: 'data', capabilities: ['sso', 'jit_provisioning', 'keycloak', 'entra_id', 'google', 'cognito'] }),
    E('saml', 'SAML 2.0 SSO', { onPrem: true, aws: true, azure: true, gcp: true, switch: 'data', capabilities: ['sso', 'jit_provisioning', 'adfs', 'entra_id', 'google_workspace'] }),
  ],
  storage: [
    E('supabase', 'Supabase Storage', { onPrem: false, requiresSupabase: true, switch: 'data', capabilities: ['public_urls', 'signed_urls'] }),
    E('local', 'Local disk / NFS / SMB', { onPrem: true, switch: 'data', capabilities: ['files_route', 'signed_urls'] }),
    E('s3', 'S3 and S3-compatible (MinIO, Ceph, R2)', { onPrem: true, aws: true, switch: 'data', capabilities: ['public_base_url', 'signed_urls', 'iam_roles'] }),
    E('azure_blob', 'Azure Blob Storage', { onPrem: false, azure: true, switch: 'data', capabilities: ['managed_identity', 'sas', 'signed_urls'] }),
    E('gcs', 'Google Cloud Storage', { onPrem: false, gcp: true, switch: 'data', capabilities: ['workload_identity', 'v4_signed_urls'] }),
  ],
  realtime: [
    E('supabase', 'Supabase Realtime', { onPrem: false, requiresSupabase: true, switch: 'config', capabilities: ['postgres_changes'] }),
    E('sse', 'Built-in Server-Sent Events (LISTEN/NOTIFY)', { onPrem: true, aws: true, azure: true, gcp: true, switch: 'config', capabilities: ['listen_notify', 'polling_fallback'] }),
  ],
  scheduler: [
    E('pg_cron', 'pg_cron + pg_net (database)', { onPrem: true, switch: 'data', capabilities: ['database_jobs', 'vault_secrets'] }),
    E('worker', 'Built-in worker (advisory-lock leader)', { onPrem: true, aws: true, azure: true, gcp: true, switch: 'data', capabilities: ['in_process', 'dedicated_container', 'leader_election'] }),
    E('external', 'External cron calling /api/cron/tick', {
      onPrem: true, aws: true, azure: true, gcp: true, switch: 'data',
      capabilities: ['os_cron', 'kubernetes_cronjob', 'eventbridge_scheduler', 'cloud_scheduler_oidc', 'entra_managed_identity'],
    }),
  ],
  email: [
    E('resend', 'Resend', { onPrem: false, switch: 'config', capabilities: ['api'] }),
    E('smtp', 'SMTP relay (Exchange, Postfix, …)', { onPrem: true, switch: 'config', capabilities: ['starttls', 'auth'] }),
    E('ses', 'Amazon SES', { onPrem: false, aws: true, switch: 'config', capabilities: ['iam_roles'] }),
    E('azure_communication', 'Azure Communication Services Email', { onPrem: false, azure: true, switch: 'config', capabilities: ['managed_identity'] }),
    E('microsoft_graph', 'Microsoft 365 (Graph sendMail)', { onPrem: false, azure: true, switch: 'config', capabilities: ['app_registration'] }),
    E('gmail', 'Gmail API (Google Workspace)', { onPrem: false, gcp: true, switch: 'config', capabilities: ['domain_wide_delegation'] }),
    E('console', 'Console (log only)', { onPrem: true, switch: 'config', capabilities: ['development'] }),
  ],
  secrets: [
    E('env', 'Environment / mounted files', { onPrem: true, aws: true, azure: true, gcp: true, switch: 'config', capabilities: ['docker_secrets', 'kubernetes_secrets'] }),
    E('db', 'Encrypted in Postgres (instance_settings)', { onPrem: true, switch: 'config', capabilities: ['encryption_key'] }),
    E('supabase_vault', 'Supabase Vault', { onPrem: true, requiresSupabase: true, switch: 'config', capabilities: ['pgsodium'] }),
    E('hashicorp_vault', 'HashiCorp Vault / OpenBao', { onPrem: true, switch: 'config', capabilities: ['kv_v2', 'approle', 'kubernetes_auth'] }),
    E('azure_key_vault', 'Azure Key Vault', { onPrem: false, azure: true, switch: 'config', capabilities: ['managed_identity'] }),
    E('gcp_secret_manager', 'Google Secret Manager', { onPrem: false, gcp: true, switch: 'config', capabilities: ['workload_identity'] }),
    E('aws_secrets_manager', 'AWS Secrets Manager', { onPrem: false, aws: true, switch: 'config', capabilities: ['iam_roles'] }),
  ],
  cache: [
    E('memory', 'In-process memory (single instance)', { onPrem: true, aws: true, azure: true, gcp: true, switch: 'config', capabilities: ['per_instance'] }),
    E('postgres', 'PostgreSQL (UNLOGGED table in the app database)', { onPrem: true, aws: true, azure: true, gcp: true, switch: 'config', capabilities: ['shared', 'no_extra_service'] }),
    E('redis', 'Redis / Valkey (KeyDB, Dragonfly, ElastiCache, Azure Cache, Memorystore)', {
      onPrem: true, aws: true, azure: true, gcp: true, switch: 'config',
      capabilities: ['shared', 'tls', 'acl_users', 'elasticache_iam_auth', 'entra_token_auth', 'memorystore_iam_auth'],
    }),
  ],
  kms: [
    E('env', 'ENCRYPTION_KEY (environment / secret store)', { onPrem: true, aws: true, azure: true, gcp: true, switch: 'data', capabilities: ['enc_v1', 'envelope'] }),
    E('vault_transit', 'HashiCorp Vault / OpenBao Transit', { onPrem: true, switch: 'data', capabilities: ['envelope', 'key_versions', 'approle', 'kubernetes_auth'] }),
    E('aws_kms', 'AWS KMS', { onPrem: false, aws: true, switch: 'data', capabilities: ['envelope', 'encryption_context', 'iam_roles'] }),
    E('azure_key_vault', 'Azure Key Vault keys / Managed HSM', { onPrem: false, azure: true, switch: 'data', capabilities: ['envelope', 'managed_identity', 'managed_hsm', 'key_versions'] }),
    E('gcp_kms', 'Google Cloud KMS (Cloud HSM / EKM)', { onPrem: false, gcp: true, switch: 'data', capabilities: ['envelope', 'aad', 'workload_identity'] }),
  ],
}

const DOCS_ANCHOR: Record<ProviderArea, string> = {
  db: 'database',
  auth: 'auth',
  storage: 'storage',
  realtime: 'realtime',
  scheduler: 'scheduler',
  email: 'email',
  secrets: 'secrets',
  cache: 'cache',
  kms: 'kms',
}

export const PROVIDER_CATALOGUE: ProviderCatalogueEntry[] = (Object.keys(CATALOGUE) as ProviderArea[]).flatMap((area) =>
  CATALOGUE[area].map((entry) => ({ ...entry, area, docs: entry.docs ?? DOCS_ANCHOR[area] })),
)

export function catalogueEntry<A extends ProviderArea>(area: A, id: ProviderId<A> | string): ProviderCatalogueEntry | null {
  return PROVIDER_CATALOGUE.find((entry) => entry.area === area && entry.id === id) ?? null
}

export interface CatalogueFilter {
  area?: ProviderArea
  onPrem?: boolean
  aws?: boolean
  azure?: boolean
  gcp?: boolean
}

export function filterCatalogue(filter: CatalogueFilter = {}): ProviderCatalogueEntry[] {
  return PROVIDER_CATALOGUE.filter((entry) =>
    (!filter.area || entry.area === filter.area) &&
    (!filter.onPrem || entry.onPrem) &&
    (!filter.aws || entry.aws) &&
    (!filter.azure || entry.azure) &&
    (!filter.gcp || entry.gcp))
}

export function isDefaultProvider(area: ProviderArea, id: string): boolean {
  return DEFAULT_PROVIDERS[area] === id
}

/** Short badge list for an entry: on-prem / AWS / Azure / GCP / Supabase. */
export function catalogueBadges(entry: ProviderCatalogueEntry): string[] {
  return [
    ...(entry.onPrem ? ['on-prem'] : []),
    ...(entry.aws ? ['aws'] : []),
    ...(entry.azure ? ['azure'] : []),
    ...(entry.gcp ? ['gcp'] : []),
    ...(entry.requiresSupabase ? ['supabase'] : []),
    ...(!entry.onPrem && !entry.aws && !entry.azure && !entry.gcp && !entry.requiresSupabase ? ['cloud'] : []),
  ]
}
