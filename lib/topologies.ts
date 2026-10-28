/**
 * Deployment topologies: which service runs each infrastructure area, and
 * where. Pure data shared by the topology diagrams (components/topology), the
 * docs `::topology <id>` directive and the /deploy-anywhere marketing page.
 *
 * Provider names follow docs/infrastructure.md and the provider catalogue
 * (lib/admin/catalogue.ts); cache, KMS and the newer log destinations follow
 * the providers plan (phases 13–15). Keep the prose guides in
 * docs/topologies/*.md in step with this file.
 */

export type AreaId =
  | 'database'
  | 'auth'
  | 'storage'
  | 'realtime'
  | 'scheduler'
  | 'email'
  | 'secrets'
  | 'kms'
  | 'cache'
  | 'logs'
  | 'directory'

/** Where a group of services runs. `app` = built into UserTasks itself. */
export type Vendor = 'supabase' | 'aws' | 'azure' | 'gcp' | 'saas' | 'network' | 'app'

export interface AreaDef {
  id: AreaId
  label: string
  /** Instance variable that picks the provider (logs and directory sync are per workspace). */
  variable: string | null
  /** Docs page in the "Choosing services" section. */
  docs: string
  summary: string
  /** Provider options as shown on the website (text only, no logos). */
  options: Array<{ name: string; onPrem?: boolean; aws?: boolean; azure?: boolean; gcp?: boolean }>
}

export const AREAS: AreaDef[] = [
  {
    id: 'database', label: 'Database', variable: 'DB_PROVIDER', docs: '/docs/services/database',
    summary: 'Supabase, or any PostgreSQL 15+ with the same row-level security.',
    options: [
      { name: 'Supabase Postgres' },
      { name: 'PostgreSQL 15+', onPrem: true, aws: true, azure: true, gcp: true },
      { name: 'RDS / Aurora', aws: true },
      { name: 'Azure Flexible Server', azure: true },
      { name: 'Cloud SQL / AlloyDB', gcp: true },
    ],
  },
  {
    id: 'auth', label: 'Auth', variable: 'AUTH_PROVIDER', docs: '/docs/services/auth',
    summary: 'Supabase Auth, built-in passwords, or OIDC / SAML single sign-on.',
    options: [
      { name: 'Supabase Auth' },
      { name: 'Built-in', onPrem: true, aws: true, azure: true, gcp: true },
      { name: 'OIDC: Entra ID, Okta, Google, Keycloak, Cognito…', onPrem: true, aws: true, azure: true, gcp: true },
      { name: 'SAML: AD FS, Entra ID, Okta…', onPrem: true, azure: true, gcp: true },
    ],
  },
  {
    id: 'storage', label: 'File storage', variable: 'STORAGE_PROVIDER', docs: '/docs/services/storage',
    summary: 'Supabase Storage, local disk / NFS, S3 and MinIO, Azure Blob or Cloud Storage.',
    options: [
      { name: 'Supabase Storage' },
      { name: 'Local disk / NFS', onPrem: true },
      { name: 'S3 / MinIO / Ceph', onPrem: true, aws: true },
      { name: 'Azure Blob Storage', azure: true },
      { name: 'Google Cloud Storage', gcp: true },
    ],
  },
  {
    id: 'realtime', label: 'Realtime', variable: 'REALTIME_PROVIDER', docs: '/docs/services/realtime',
    summary: 'Supabase Realtime, or built-in Server-Sent Events on LISTEN/NOTIFY.',
    options: [
      { name: 'Supabase Realtime' },
      { name: 'Built-in SSE', onPrem: true, aws: true, azure: true, gcp: true },
    ],
  },
  {
    id: 'scheduler', label: 'Scheduler', variable: 'SCHEDULER_PROVIDER', docs: '/docs/services/scheduler',
    summary: 'pg_cron in the database, the built-in worker, or any external cron.',
    options: [
      { name: 'pg_cron' },
      { name: 'Built-in worker', onPrem: true, aws: true, azure: true, gcp: true },
      { name: 'OS cron / Kubernetes CronJob', onPrem: true },
      { name: 'EventBridge (cron secret)', aws: true },
      { name: 'Container Apps Job (Entra)', azure: true },
      { name: 'Cloud Scheduler (OIDC)', gcp: true },
    ],
  },
  {
    id: 'email', label: 'Email', variable: 'EMAIL_PROVIDER', docs: '/docs/services/email',
    summary: 'Resend, any SMTP relay, Amazon SES, Azure Communication Services, Microsoft 365 or Gmail.',
    options: [
      { name: 'Resend' },
      { name: 'SMTP relay', onPrem: true, aws: true, azure: true, gcp: true },
      { name: 'Amazon SES', aws: true },
      { name: 'Azure Communication Services', azure: true },
      { name: 'Microsoft 365 (Graph)', azure: true },
      { name: 'Gmail API', gcp: true },
    ],
  },
  {
    id: 'secrets', label: 'Secrets', variable: 'SECRETS_PROVIDER', docs: '/docs/services/secrets',
    summary: 'Environment and mounted files, encrypted in Postgres, Vault / OpenBao, or your cloud’s secret store.',
    options: [
      { name: 'Environment / files', onPrem: true, aws: true, azure: true, gcp: true },
      { name: 'HashiCorp Vault / OpenBao', onPrem: true },
      { name: 'AWS Secrets Manager', aws: true },
      { name: 'Azure Key Vault', azure: true },
      { name: 'Google Secret Manager', gcp: true },
    ],
  },
  {
    id: 'kms', label: 'KMS', variable: 'KMS_PROVIDER', docs: '/docs/services/kms',
    summary: 'Envelope encryption of stored credentials with a key that never leaves your KMS.',
    options: [
      { name: 'ENCRYPTION_KEY', onPrem: true, aws: true, azure: true, gcp: true },
      { name: 'Vault / OpenBao Transit', onPrem: true },
      { name: 'AWS KMS', aws: true },
      { name: 'Azure Key Vault keys / Managed HSM', azure: true },
      { name: 'Google Cloud KMS', gcp: true },
    ],
  },
  {
    id: 'cache', label: 'Cache', variable: 'CACHE_PROVIDER', docs: '/docs/services/cache',
    summary: 'Rate limits and invalidations shared by every replica: memory, Postgres or Redis / Valkey.',
    options: [
      { name: 'In-process memory', onPrem: true, aws: true, azure: true, gcp: true },
      { name: 'PostgreSQL', onPrem: true, aws: true, azure: true, gcp: true },
      { name: 'Valkey / Redis', onPrem: true },
      { name: 'ElastiCache / MemoryDB (IAM auth)', aws: true },
      { name: 'Azure Cache for Redis', azure: true },
      { name: 'Memorystore', gcp: true },
    ],
  },
  {
    id: 'logs', label: 'Log export', variable: null, docs: '/docs/services/logs',
    summary: 'One event stream per workspace, shipped to the log platform you already run.',
    options: [
      { name: 'Splunk HEC' },
      { name: 'Datadog' },
      { name: 'OpenTelemetry', onPrem: true, aws: true },
      { name: 'Syslog (RFC 5424)', onPrem: true },
      { name: 'Webhook', onPrem: true },
      { name: 'Azure Monitor / Event Hubs', azure: true },
      { name: 'Cloud Logging / Pub/Sub', gcp: true },
      { name: 'CloudWatch Logs', aws: true },
    ],
  },
  {
    id: 'directory', label: 'Directory sync', variable: null, docs: '/docs/services/directory-sync',
    summary: 'Users and groups from your directory, pulled on a schedule or pushed over SCIM.',
    options: [
      { name: 'LDAP / Active Directory', onPrem: true, aws: true },
      { name: 'SCIM 2.0', onPrem: true, aws: true, azure: true, gcp: true },
      { name: 'Microsoft Entra ID', azure: true },
      { name: 'Google Workspace', gcp: true },
      { name: 'Okta' },
    ],
  },
]

export const AREA_LABEL: Record<AreaId, string> = Object.fromEntries(AREAS.map((area) => [area.id, area.label])) as Record<AreaId, string>

export const VENDOR_LABEL: Record<Vendor, string> = {
  supabase: 'Supabase',
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'Google Cloud',
  saas: 'SaaS',
  network: 'Your network',
  app: 'Built in',
}

export interface TopologyItem {
  area: AreaId
  service: string
}

export interface TopologyZone {
  vendor: Vendor
  label: string
  items: TopologyItem[]
}

export interface TopologyDef {
  id: string
  name: string
  /** Where the app (web + worker) runs. */
  hosting: string
  /** Areas served by UserTasks itself. */
  builtIn: TopologyItem[]
  zones: TopologyZone[]
  /** Screen-reader summary of the diagram. */
  desc: string
}

export const TOPOLOGIES: TopologyDef[] = [
  {
    id: 'supabase',
    name: 'Supabase only',
    hosting: 'Any Node.js host or the Docker image',
    builtIn: [
      { area: 'secrets', service: 'Environment' },
      { area: 'kms', service: 'ENCRYPTION_KEY' },
      { area: 'cache', service: 'Memory' },
    ],
    zones: [
      {
        vendor: 'supabase', label: 'Supabase project',
        items: [
          { area: 'database', service: 'Supabase Postgres' },
          { area: 'auth', service: 'Supabase Auth' },
          { area: 'storage', service: 'Supabase Storage' },
          { area: 'realtime', service: 'Supabase Realtime' },
          { area: 'scheduler', service: 'pg_cron + pg_net' },
        ],
      },
      { vendor: 'saas', label: 'Email API', items: [{ area: 'email', service: 'Resend' }] },
    ],
    desc: 'The UserTasks app talks to one Supabase project for the database, auth, storage, realtime and pg_cron scheduling, and to Resend for email. Secrets, the encryption key and the cache are built in.',
  },
  {
    id: 'hybrid-aws',
    name: 'Hybrid: Supabase + AWS',
    hosting: 'Unchanged: wherever the app runs today',
    builtIn: [{ area: 'cache', service: 'Memory or Postgres' }],
    zones: [
      {
        vendor: 'supabase', label: 'Supabase project',
        items: [
          { area: 'database', service: 'Supabase Postgres' },
          { area: 'auth', service: 'Supabase Auth' },
          { area: 'realtime', service: 'Supabase Realtime' },
          { area: 'scheduler', service: 'pg_cron' },
        ],
      },
      {
        vendor: 'aws', label: 'AWS account',
        items: [
          { area: 'storage', service: 'Amazon S3' },
          { area: 'email', service: 'Amazon SES' },
          { area: 'secrets', service: 'Secrets Manager' },
          { area: 'kms', service: 'AWS KMS (optional)' },
        ],
      },
    ],
    desc: 'Supabase keeps the database, auth, realtime and pg_cron. Files move to Amazon S3, email to Amazon SES and provider credentials to AWS Secrets Manager, optionally with AWS KMS envelope encryption.',
  },
  {
    id: 'hybrid-gcp',
    name: 'Hybrid: Supabase + Google Cloud',
    hosting: 'Unchanged, or Cloud Run',
    builtIn: [],
    zones: [
      {
        vendor: 'supabase', label: 'Supabase project',
        items: [
          { area: 'database', service: 'Supabase Postgres' },
          { area: 'auth', service: 'Supabase Auth' },
          { area: 'realtime', service: 'Supabase Realtime' },
        ],
      },
      {
        vendor: 'gcp', label: 'Google Cloud project',
        items: [
          { area: 'storage', service: 'Cloud Storage' },
          { area: 'scheduler', service: 'Cloud Scheduler (OIDC)' },
          { area: 'secrets', service: 'Secret Manager' },
        ],
      },
      { vendor: 'saas', label: 'Email API', items: [{ area: 'email', service: 'Resend' }] },
    ],
    desc: 'Supabase keeps the database, auth and realtime. Files move to Google Cloud Storage, Cloud Scheduler drives the minute tick with an OIDC token, and credentials live in Secret Manager. Email stays on Resend.',
  },
  {
    id: 'hybrid-azure',
    name: 'Hybrid: Supabase + Azure',
    hosting: 'Unchanged, or Azure Container Apps',
    builtIn: [],
    zones: [
      {
        vendor: 'supabase', label: 'Supabase project',
        items: [
          { area: 'database', service: 'Supabase Postgres' },
          { area: 'realtime', service: 'Supabase Realtime' },
          { area: 'scheduler', service: 'pg_cron' },
        ],
      },
      {
        vendor: 'azure', label: 'Azure subscription',
        items: [
          { area: 'auth', service: 'Entra ID (OIDC)' },
          { area: 'storage', service: 'Blob Storage' },
          { area: 'email', service: 'Communication Services' },
          { area: 'secrets', service: 'Key Vault' },
        ],
      },
    ],
    desc: 'Supabase keeps the database, realtime and pg_cron. People sign in with Microsoft Entra ID through built-in auth, files move to Azure Blob Storage, email to Azure Communication Services and credentials to Key Vault.',
  },
  {
    id: 'aws',
    name: 'Single cloud: AWS',
    hosting: 'ECS on Fargate (web + worker), or App Runner with an EventBridge tick',
    builtIn: [
      { area: 'realtime', service: 'SSE' },
      { area: 'scheduler', service: 'Worker' },
    ],
    zones: [
      {
        vendor: 'aws', label: 'AWS account (one region)',
        items: [
          { area: 'database', service: 'RDS / Aurora PostgreSQL (IAM auth)' },
          { area: 'auth', service: 'Built-in + Cognito (OIDC)' },
          { area: 'storage', service: 'Amazon S3' },
          { area: 'email', service: 'Amazon SES' },
          { area: 'secrets', service: 'Secrets Manager' },
          { area: 'kms', service: 'AWS KMS' },
          { area: 'cache', service: 'ElastiCache (Valkey)' },
          { area: 'logs', service: 'CloudWatch Logs' },
        ],
      },
    ],
    desc: 'Everything runs in one AWS account: ECS or App Runner for the app, RDS or Aurora PostgreSQL, Cognito or another OIDC provider next to built-in passwords, S3, SES, Secrets Manager, AWS KMS and ElastiCache. Realtime and scheduling are built into the app.',
  },
  {
    id: 'azure',
    name: 'Single cloud: Azure',
    hosting: 'Azure Container Apps (web, migrate job, tick job)',
    builtIn: [{ area: 'realtime', service: 'SSE' }],
    zones: [
      {
        vendor: 'azure', label: 'Azure subscription (one region)',
        items: [
          { area: 'database', service: 'Flexible Server (Entra auth)' },
          { area: 'auth', service: 'Built-in + Entra ID' },
          { area: 'storage', service: 'Blob Storage' },
          { area: 'scheduler', service: 'Container Apps Job tick' },
          { area: 'email', service: 'Communication Services' },
          { area: 'secrets', service: 'Key Vault' },
          { area: 'kms', service: 'Key Vault key / Managed HSM' },
          { area: 'cache', service: 'Azure Cache for Redis' },
          { area: 'logs', service: 'Azure Monitor / Event Hubs' },
        ],
      },
    ],
    desc: 'The Azure reference profile: Container Apps, PostgreSQL Flexible Server with Entra token auth, built-in auth with Entra ID sign-in, Blob Storage, a Container Apps Job tick, Communication Services email, Key Vault secrets and keys, Azure Cache for Redis and Azure Monitor log export, all with one managed identity.',
  },
  {
    id: 'gcp',
    name: 'Single cloud: Google Cloud',
    hosting: 'Cloud Run (service + migrate job)',
    builtIn: [{ area: 'realtime', service: 'SSE' }],
    zones: [
      {
        vendor: 'gcp', label: 'Google Cloud project (one region)',
        items: [
          { area: 'database', service: 'Cloud SQL (IAM auth)' },
          { area: 'auth', service: 'Built-in + Google' },
          { area: 'storage', service: 'Cloud Storage' },
          { area: 'scheduler', service: 'Cloud Scheduler (OIDC)' },
          { area: 'email', service: 'Workspace SMTP relay' },
          { area: 'secrets', service: 'Secret Manager' },
          { area: 'kms', service: 'Cloud KMS' },
          { area: 'cache', service: 'Memorystore' },
          { area: 'logs', service: 'Cloud Logging / Pub/Sub' },
        ],
      },
    ],
    desc: 'The Google Cloud reference profile: Cloud Run, Cloud SQL with IAM database auth, built-in auth with Google sign-in, Cloud Storage, a Cloud Scheduler OIDC tick, an SMTP relay, Secret Manager, Cloud KMS, Memorystore and Cloud Logging export, all with the service account.',
  },
  {
    id: 'multi-cloud',
    name: 'Multi-cloud',
    hosting: 'Azure Container Apps, next to the database',
    builtIn: [
      { area: 'realtime', service: 'SSE' },
      { area: 'scheduler', service: 'Worker' },
    ],
    zones: [
      {
        vendor: 'azure', label: 'Azure (primary region)',
        items: [
          { area: 'database', service: 'Flexible Server' },
          { area: 'secrets', service: 'Key Vault' },
          { area: 'kms', service: 'Key Vault key' },
          { area: 'cache', service: 'Azure Cache for Redis' },
        ],
      },
      { vendor: 'gcp', label: 'Google Cloud', items: [{ area: 'storage', service: 'Cloud Storage' }] },
      {
        vendor: 'saas', label: 'SaaS',
        items: [
          { area: 'auth', service: 'Okta (OIDC)' },
          { area: 'email', service: 'Resend' },
          { area: 'logs', service: 'Datadog' },
        ],
      },
    ],
    desc: 'The app runs on Azure next to its PostgreSQL database, Key Vault and Redis cache. Files live in Google Cloud Storage, people sign in with Okta, email goes through Resend and logs ship to Datadog.',
  },
  {
    id: 'on-prem',
    name: 'On-premises / air-gapped',
    hosting: 'Docker Compose or Kubernetes on your servers',
    builtIn: [
      { area: 'realtime', service: 'SSE' },
      { area: 'scheduler', service: 'Worker container' },
      { area: 'secrets', service: 'Mounted files' },
    ],
    zones: [
      {
        vendor: 'network', label: 'Your network (no internet)',
        items: [
          { area: 'database', service: 'PostgreSQL + PgBouncer' },
          { area: 'auth', service: 'Built-in + Keycloak / AD FS' },
          { area: 'storage', service: 'MinIO (S3) or NFS' },
          { area: 'email', service: 'SMTP relay' },
          { area: 'kms', service: 'Vault / OpenBao Transit' },
          { area: 'cache', service: 'Valkey' },
          { area: 'logs', service: 'Syslog / Splunk / OTel' },
          { area: 'directory', service: 'LDAP / Active Directory' },
        ],
      },
    ],
    desc: 'Everything runs inside your own network with no outbound internet: PostgreSQL behind PgBouncer, built-in auth with Keycloak or AD FS, MinIO or NFS for files, an SMTP relay, Vault Transit, Valkey, syslog or Splunk for logs and LDAP directory sync. Realtime, scheduling and secrets are built in.',
  },
]

const BY_ID = new Map(TOPOLOGIES.map((topology) => [topology.id, topology]))

export const TOPOLOGY_IDS = TOPOLOGIES.map((topology) => topology.id)

export function getTopology(id: string): TopologyDef | undefined {
  return BY_ID.get(id)
}

/** Copy for the /deploy-anywhere marketing page (page, metadata, OG card, sitemap). */
export const DEPLOY_ANYWHERE = {
  slug: 'deploy-anywhere',
  title: 'Deploy anywhere: Supabase, your cloud, or fully on premises',
  eyebrow: 'Deploy anywhere',
  description: 'Run UserTasks on Supabase, our recommended platform, with zero extra configuration. Whenever you\'re ready, move any infrastructure area — database, auth, storage, email, secrets and more — to AWS, Azure, Google Cloud or your own servers, one checked, reversible switch at a time.',
}
