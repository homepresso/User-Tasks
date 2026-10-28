import type { DocPageDef } from '../types'

/**
 * "Deploy anywhere": the topology guide and the per-area service guides.
 * The prose lives in docs/topologies/*.md and docs/services/*.md (readable on
 * GitHub too); diagrams are `<!-- ::topology <id> -->` directives in those files,
 * hidden on GitHub and rendered from lib/topologies.ts here.
 */

const include = (file: string) => `
::include ${file}
`

export const TOPOLOGY_PAGES: DocPageDef[] = [
  {
    slug: 'topologies',
    title: 'Choose your topology',
    description: 'Start on Supabase, our recommended platform, with zero extra configuration, and move any area with usertasks-admin switch whenever you\'re ready: a decision guide to Supabase only, hybrid, single cloud (AWS, Azure, Google Cloud), multi-cloud and on-premises, with the rules for what can mix.',
    body: include('docs/topologies/README.md'),
  },
  {
    slug: 'topologies/supabase',
    title: 'Supabase only',
    description: 'The default and recommended topology: one Supabase project for the database, auth, storage, realtime and pg_cron, Resend for email, nothing else to run.',
    body: include('docs/topologies/supabase.md'),
  },
  {
    slug: 'topologies/hybrid',
    title: 'Hybrid: Supabase plus your cloud',
    description: 'Keep the Supabase database and move files, email, secrets, keys or sign-in to AWS, Google Cloud or Azure — three worked examples with switch commands.',
    body: include('docs/topologies/hybrid.md'),
  },
  {
    slug: 'topologies/aws',
    title: 'Single cloud: AWS',
    description: 'Everything on AWS: ECS on Fargate or App Runner, RDS or Aurora PostgreSQL, Cognito or any OIDC IdP, S3, SES, Secrets Manager, AWS KMS, ElastiCache and an EventBridge tick — which parts are native and which are compatible.',
    body: include('docs/topologies/aws.md'),
  },
  {
    slug: 'topologies/azure',
    title: 'Single cloud: Azure',
    description: 'The Azure reference profile: Container Apps, Flexible Server with Entra auth, Entra ID sign-in, Blob Storage, a Container Apps Job tick, Communication Services, Key Vault secrets and keys, Azure Cache for Redis and Azure Monitor.',
    body: include('docs/topologies/azure.md'),
  },
  {
    slug: 'topologies/google-cloud',
    title: 'Single cloud: Google Cloud',
    description: 'The Google Cloud reference profile: Cloud Run, Cloud SQL with IAM auth, Google sign-in, Cloud Storage, a Cloud Scheduler OIDC tick, an SMTP relay, Secret Manager, Cloud KMS, Memorystore and Cloud Logging.',
    body: include('docs/topologies/google-cloud.md'),
  },
  {
    slug: 'topologies/multi-cloud',
    title: 'Multi-cloud',
    description: 'Areas across several clouds and SaaS vendors — a worked example (Azure database, Google Cloud Storage, Okta, Resend, Datadog) and the rules for latency, egress and where secrets live.',
    body: include('docs/topologies/multi-cloud.md'),
  },
  {
    slug: 'topologies/on-premises',
    title: 'On-premises and air-gapped',
    description: 'Everything inside your network with no outbound internet: PostgreSQL and PgBouncer, built-in auth with Keycloak or AD FS, MinIO, SSE, the worker, SMTP, Vault Transit, Valkey, syslog and LDAP.',
    body: include('docs/topologies/on-premises.md'),
  },
]

export const SERVICE_PAGES: DocPageDef[] = [
  {
    slug: 'services',
    title: 'Choosing each service',
    description: 'Every infrastructure area and its options — database, auth, storage, realtime, scheduler, email, secrets, KMS, cache, log export and directory sync — with on-premises, AWS, Azure and Google Cloud support.',
    body: include('docs/services/README.md'),
  },
  {
    slug: 'services/database',
    title: 'Database',
    description: 'Supabase Postgres or any PostgreSQL 15+ (RDS, Aurora, Flexible Server, Cloud SQL, AlloyDB, Neon, on-premises) with the same row-level security; when to move it and the rules for poolers.',
    body: include('docs/services/database.md'),
  },
  {
    slug: 'services/auth',
    title: 'Auth',
    description: 'Supabase Auth, built-in passwords, or OIDC and SAML single sign-on with Entra ID, Okta, Google, Keycloak, AD FS or Cognito — and what an auth switch means for users.',
    body: include('docs/services/auth.md'),
  },
  {
    slug: 'services/storage',
    title: 'File storage',
    description: 'Supabase Storage, local disk or NFS, S3 and MinIO, Azure Blob Storage or Google Cloud Storage; storage:// references, public files and switching without downtime.',
    body: include('docs/services/storage.md'),
  },
  {
    slug: 'services/realtime',
    title: 'Realtime',
    description: 'Supabase Realtime or built-in Server-Sent Events over LISTEN/NOTIFY, which works with any database and any number of app instances.',
    body: include('docs/services/realtime.md'),
  },
  {
    slug: 'services/scheduler',
    title: 'Scheduler',
    description: 'pg_cron, the built-in worker or an external tick (OS cron, Kubernetes, EventBridge, Container Apps Jobs, Cloud Scheduler) — which fits which host.',
    body: include('docs/services/scheduler.md'),
  },
  {
    slug: 'services/email',
    title: 'Email',
    description: 'Resend, SMTP, Amazon SES, Azure Communication Services, Microsoft 365 or the Gmail API, and how sign-in emails follow the auth provider.',
    body: include('docs/services/email.md'),
  },
  {
    slug: 'services/secrets',
    title: 'Secrets',
    description: 'Environment and mounted files, encrypted in Postgres, Supabase Vault, HashiCorp Vault / OpenBao, AWS Secrets Manager, Azure Key Vault or Google Secret Manager, with secret:// references.',
    body: include('docs/services/secrets.md'),
  },
  {
    slug: 'services/kms',
    title: 'KMS',
    description: 'Envelope encryption of stored credentials with ENCRYPTION_KEY, Vault Transit, AWS KMS, Azure Key Vault keys or Google Cloud KMS; rotation and rewrap.',
    body: include('docs/services/kms.md'),
  },
  {
    slug: 'services/cache',
    title: 'Cache',
    description: 'In-process memory, PostgreSQL or Redis / Valkey (ElastiCache, Azure Cache for Redis, Memorystore) for rate limits and invalidations shared by every replica.',
    body: include('docs/services/cache.md'),
  },
  {
    slug: 'services/logs',
    title: 'Log export',
    description: 'Per-workspace log destinations — Splunk, Datadog, OpenTelemetry, webhooks, syslog, Azure Monitor, Event Hubs, Cloud Logging and Pub/Sub — and which fits each topology.',
    body: include('docs/services/logs.md'),
  },
  {
    slug: 'services/directory-sync',
    title: 'Directory sync',
    description: 'Entra ID, Okta, LDAP / Active Directory, Google Workspace or inbound SCIM 2.0 per workspace, and LDAP bind login with built-in auth.',
    body: include('docs/services/directory-sync.md'),
  },
]
