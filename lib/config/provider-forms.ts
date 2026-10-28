import { z } from 'zod'
import { AUTH_OPTION_ENV, AUTH_SECRET_OPTIONS } from '@/lib/providers/auth/options'
import { CACHE_OPTION_ENV, CACHE_SECRET_OPTIONS } from '@/lib/providers/cache/options'
import { EMAIL_OPTION_ENV, EMAIL_SECRET_OPTIONS } from '@/lib/providers/email/options'
import { KMS_OPTION_ENV, KMS_SECRET_OPTIONS } from '@/lib/providers/kms/options'
import { SCHEDULER_OPTION_ENV } from '@/lib/providers/scheduler/options'
import { SECRETS_OPTION_ENV, SECRETS_SECRET_OPTIONS } from '@/lib/providers/secrets/options'
import { STORAGE_OPTION_ENV, STORAGE_SECRET_OPTIONS } from '@/lib/providers/storage/options'
import { SECRET_REF_PREFIX } from './secret-refs'
import type { ProviderArea } from './schema'

/**
 * Provider option forms (Settings → Infrastructure). Each provider's
 * `<area>.<option>` settings as typed fields, with a zod schema per field:
 * the page renders the form from this and the server validates every
 * value with the same schema before anything reaches the switch engine.
 *
 * Values travel as strings, exactly like `usertasks-admin switch --set
 * <option>=<value>`, so a switch from the page writes the same settings the
 * CLI would. Credentials (the providers' *_SECRET_OPTIONS) are `secret`
 * fields: stored encrypted (like `--secret`) or as a `secret://` reference,
 * and never sent back to the browser. __tests__/provider-forms.test.ts keeps
 * the fields in step with the providers' option lists.
 */

export type FieldKind = 'text' | 'url' | 'number' | 'boolean' | 'select' | 'json' | 'email'

export interface ProviderField {
  option: string
  label: string
  kind: FieldKind
  help?: string
  placeholder?: string
  /** Must have a value (given, stored or from the environment) for this provider. */
  required?: boolean
  /** A credential: password input, stored encrypted or as a secret:// reference. */
  secret: boolean
  choices?: readonly string[]
  min?: number
  /** Changing it points the provider at a different place (existing data is not moved by a settings change). */
  relocates?: boolean
  /** Only changed through a switch (re-wraps / copies data), not as a plain settings change. */
  switchOnly?: boolean
}

/** Switch-only inputs (the CLI's area flags: --target-url, --map, …). Not stored as settings. */
export interface SwitchFlagField {
  flag: string
  label: string
  kind: FieldKind | 'list' | 'textarea'
  help?: string
  placeholder?: string
  required?: boolean
  /** Never echoed back or put in the printed CLI command (passed as an environment variable instead). */
  secret?: boolean
  choices?: readonly string[]
}

type F = Omit<ProviderField, 'secret'> & { secret?: boolean }

const text = (option: string, label: string, extra: Partial<F> = {}): F => ({ option, label, kind: 'text', ...extra })
const num = (option: string, label: string, extra: Partial<F> = {}): F => ({ option, label, kind: 'number', min: 0, ...extra })
const bool = (option: string, label: string, extra: Partial<F> = {}): F => ({ option, label, kind: 'boolean', ...extra })

const VAULT_CONNECTION: F[] = [
  text('vault_addr', 'Vault address', { kind: 'url', placeholder: 'https://vault.internal:8200', required: true }),
  text('vault_namespace', 'Namespace', { help: 'Vault Enterprise / HCP namespace' }),
  text('vault_auth', 'Auth method', { kind: 'select', choices: ['token', 'approle', 'kubernetes'], help: 'Default: inferred from the credentials given' }),
  text('vault_token', 'Token', { help: 'token auth' }),
  text('vault_role_id', 'AppRole role id'),
  text('vault_secret_id', 'AppRole secret id'),
  text('vault_approle_mount', 'AppRole mount', { placeholder: 'approle' }),
  text('vault_k8s_role', 'Kubernetes role'),
  text('vault_k8s_mount', 'Kubernetes auth mount', { placeholder: 'kubernetes' }),
  text('vault_k8s_token_path', 'Service account token path', { placeholder: '/var/run/secrets/kubernetes.io/serviceaccount/token' }),
]

const STORAGE_MAPPING: F[] = [
  text('bucket', 'Single bucket', { help: 'One bucket / container for everything; objects live under <logical bucket>/<key>. May include a key prefix (bucket/prefix).', relocates: true }),
  text('bucket_prefix', 'Bucket name prefix', { help: 'Physical name = prefix + logical name (task-files, logos, brand-fonts)', relocates: true }),
  text('bucket_map', 'Bucket map', { kind: 'json', placeholder: '{"logos": "acme-logos", "task-files": "acme-files/prod"}', relocates: true }),
  text('public_base_url', 'Public base URL', { kind: 'url', help: 'Serve public objects from the store / a CDN ({bucket} is replaced). Default: through the app at /files' }),
]

const COMMON: Partial<Record<ProviderArea, F[]>> = {
  email: [
    text('from', 'From address', { kind: 'email', placeholder: 'UserTasks <noreply@example.com>', help: 'Sender of every email' }),
    text('reply_to', 'Reply-to address', { kind: 'email' }),
  ],
  cache: [
    text('key_prefix', 'Key prefix', { placeholder: 'usertasks:', help: 'Shared stores only' }),
    num('invalidation_check_ms', 'Invalidation check (ms)', { placeholder: '1000', help: "How often other processes' cache invalidations are looked for" }),
  ],
  kms: [
    num('refresh_seconds', 'Data key refresh (s)', { placeholder: '60', help: 'How often running processes look for new data keys' }),
    num('activation_seconds', 'Activation delay (s)', { placeholder: '120', help: 'Delay before a rotated data key is used for new ciphertext' }),
  ],
  secrets: [
    text('name_prefix', 'Name prefix', { placeholder: 'usertasks/', help: 'Prepended to every secret name' }),
    num('cache_ttl_seconds', 'Cache TTL (s)', { placeholder: '300' }),
    text('encryption_key_name', 'ENCRYPTION_KEY name', { placeholder: 'encryption_key', help: 'Where ENCRYPTION_KEY is looked up in the store' }),
  ],
  auth: [
    text('sso_providers', 'Identity providers', { kind: 'json', placeholder: '[{"id": "entra", "type": "oidc", "issuer": "…", "clientId": "…", "clientSecret": "secret://entra_client_secret"}]', help: 'OIDC / SAML IdPs (JSON). Client secrets may be secret:// references.' }),
    bool('allow_signup', 'Anyone may sign up', { help: 'Default off: only invited emails' }),
    bool('require_email_confirmation', 'Require email confirmation', { help: 'Default on' }),
    num('session_idle_hours', 'Session idle timeout (hours)', { placeholder: '168' }),
    num('session_max_days', 'Session lifetime (days)', { placeholder: '30' }),
    num('lockout_threshold', 'Failed sign-ins before lockout', { placeholder: '10', min: 1 }),
    num('lockout_minutes', 'Lockout (minutes)', { placeholder: '15' }),
    num('password_min_length', 'Minimum password length', { placeholder: '8', min: 6 }),
  ],
  scheduler: [
    text('oidc_audience', 'OIDC audience', { help: 'Expected aud of Google-signed ID tokens (Cloud Scheduler)' }),
    text('oidc_service_accounts', 'OIDC service accounts', { help: 'Comma-separated service-account emails allowed to call the tick' }),
    text('entra_tenant_id', 'Entra tenant id'),
    text('entra_audience', 'Entra audience', { help: 'Comma-separated accepted aud values' }),
    text('entra_allowed_principals', 'Entra allowed principals', { help: 'Comma-separated object ids / client ids allowed to call' }),
    text('cognito_user_pool_id', 'Cognito user pool', { placeholder: 'eu-west-1_AbCdEf', help: 'Amazon Cognito pool whose client-credentials tokens may call the tick' }),
    text('cognito_allowed_clients', 'Cognito allowed clients', { help: 'Comma-separated app client ids allowed to call' }),
    text('cognito_scope', 'Cognito scope', { placeholder: 'usertasks/tick', help: 'A scope the token must carry' }),
    text('cognito_region', 'Cognito region', { help: "Default: the pool id's prefix" }),
  ],
}

const SPECIFIC: Partial<Record<ProviderArea, Record<string, F[]>>> = {
  email: {
    resend: [text('resend_api_key', 'Resend API key', { required: true })],
    smtp: [
      text('smtp_host', 'SMTP host', { required: true, placeholder: 'smtp.example.com' }),
      num('smtp_port', 'Port', { placeholder: '587 (465 with implicit TLS)', min: 1 }),
      bool('smtp_secure', 'Implicit TLS (port 465)'),
      text('smtp_starttls', 'STARTTLS', { kind: 'select', choices: ['required', 'opportunistic', 'off'], help: 'Default opportunistic' }),
      text('smtp_user', 'Username'),
      text('smtp_password', 'Password'),
      bool('smtp_tls_reject_unauthorized', 'Verify the TLS certificate', { help: 'Default on' }),
      text('smtp_tls_servername', 'TLS server name'),
      text('smtp_name', 'EHLO host name'),
    ],
    ses: [
      text('ses_region', 'Region', { placeholder: 'eu-west-1' }),
      text('ses_access_key_id', 'Access key id', { help: 'Default: the AWS credential chain (IAM role)' }),
      text('ses_secret_access_key', 'Secret access key'),
      text('ses_configuration_set', 'Configuration set'),
    ],
    azure_communication: [
      text('acs_connection_string', 'Connection string', { help: 'Or the endpoint below with Entra ID (managed identity)' }),
      text('acs_endpoint', 'Endpoint', { kind: 'url', placeholder: 'https://<resource>.communication.azure.com' }),
    ],
    microsoft_graph: [
      text('graph_tenant_id', 'Tenant id', { help: 'Client credentials, or none of the three for managed identity' }),
      text('graph_client_id', 'Client id'),
      text('graph_client_secret', 'Client secret'),
      text('graph_sender', 'Sender mailbox', { kind: 'email', help: 'Default: the from address' }),
      text('graph_endpoint', 'Graph endpoint', { kind: 'url', help: 'National clouds' }),
    ],
    gmail: [
      text('gmail_service_account_json', 'Service account key (JSON)', { help: 'Default: Application Default Credentials' }),
      text('gmail_sender', 'Sender (Workspace user)', { kind: 'email', help: 'Default: the from address' }),
    ],
    console: [text('console_dir', 'Write messages to directory', { help: 'Each message as an .eml file (optional; default: log only)' })],
  },
  storage: {
    local: [text('local_root', 'Root directory', { required: true, placeholder: '/var/lib/usertasks/files', relocates: true })],
    s3: [
      text('endpoint', 'Endpoint', { kind: 'url', placeholder: 'http://minio:9000', help: 'Empty for AWS S3' }),
      text('region', 'Region', { placeholder: 'us-east-1' }),
      text('access_key_id', 'Access key id', { help: 'Default: the AWS credential chain (IAM role)' }),
      text('secret_access_key', 'Secret access key'),
      bool('force_path_style', 'Path-style URLs', { help: 'MinIO, Ceph' }),
      ...STORAGE_MAPPING,
    ],
    azure_blob: [
      text('azure_connection_string', 'Connection string', { help: 'Or an account name with a key, a SAS token or managed identity' }),
      text('azure_account_name', 'Account name'),
      text('azure_account_key', 'Account key'),
      text('azure_sas_token', 'SAS token'),
      text('azure_endpoint', 'Blob endpoint', { kind: 'url' }),
      ...STORAGE_MAPPING,
    ],
    gcs: [
      text('gcs_project_id', 'Project id'),
      text('gcs_credentials_json', 'Service account key (JSON)', { help: 'Default: workload identity / ADC' }),
      text('gcs_endpoint', 'API endpoint', { kind: 'url' }),
      ...STORAGE_MAPPING,
    ],
  },
  cache: {
    redis: [
      text('redis_url', 'Redis URL', { kind: 'url', placeholder: 'rediss://cache.internal:6380', required: true }),
      text('redis_username', 'Username'),
      text('redis_password', 'Password'),
      num('redis_db', 'Database number'),
      text('redis_auth', 'Auth', { kind: 'select', choices: ['password', 'entra', 'gcp_iam', 'aws_iam'], help: 'Default password' }),
      bool('redis_tls', 'Force TLS'),
      text('redis_tls_ca_file', 'CA file'),
      text('redis_tls_servername', 'TLS server name'),
      bool('redis_tls_reject_unauthorized', 'Verify the TLS certificate', { help: 'Default on' }),
      text('redis_entra_scope', 'Entra scope', { placeholder: 'https://redis.azure.com/.default' }),
      num('redis_command_timeout_ms', 'Command timeout (ms)', { placeholder: '2000' }),
      text('redis_aws_cache_name', 'AWS cache name', { help: 'aws_iam: the ElastiCache / MemoryDB cache (or cluster) name' }),
      text('redis_aws_region', 'AWS region', { help: 'aws_iam (default AWS_REGION)' }),
      text('redis_aws_service', 'AWS service', { kind: 'select', choices: ['elasticache', 'memorydb'], help: 'aws_iam (default elasticache)' }),
      bool('redis_aws_serverless', 'ElastiCache Serverless', { help: 'aws_iam' }),
    ],
  },
  secrets: {
    env: [text('files_dir', 'Secret files directory', { placeholder: '/run/secrets', help: 'Also read <dir>/<name> (Docker / Kubernetes secret mounts)' })],
    supabase_vault: [text('database_url', 'Database URL', { help: 'Default DATABASE_URL' })],
    hashicorp_vault: [...VAULT_CONNECTION, text('vault_mount', 'KV v2 mount', { placeholder: 'secret' })],
    azure_key_vault: [text('azure_key_vault_url', 'Key Vault URL', { kind: 'url', placeholder: 'https://<vault>.vault.azure.net', required: true })],
    gcp_secret_manager: [
      text('gcp_project_id', 'Project id', { help: 'Default GOOGLE_CLOUD_PROJECT' }),
      text('gcp_credentials_json', 'Service account key (JSON)', { help: 'Default: workload identity / ADC' }),
      text('gcp_endpoint', 'Endpoint', { kind: 'url' }),
    ],
    aws_secrets_manager: [text('aws_region', 'Region', { help: 'Default AWS_REGION' }), text('aws_endpoint', 'Endpoint', { kind: 'url' })],
  },
  kms: {
    vault_transit: [
      text('vault_transit_key', 'Transit key name', { required: true, switchOnly: true }),
      text('vault_transit_mount', 'Transit mount', { placeholder: 'transit', switchOnly: true }),
      ...VAULT_CONNECTION,
    ],
    aws_kms: [
      text('aws_kms_key_id', 'Key id / ARN / alias', { required: true, switchOnly: true }),
      text('aws_region', 'Region', { help: 'Default AWS_REGION' }),
      text('aws_endpoint', 'Endpoint', { kind: 'url', help: 'VPC endpoint or a local KMS' }),
    ],
    azure_key_vault: [
      text('azure_key_id', 'Key URL', { kind: 'url', required: true, switchOnly: true, placeholder: 'https://<vault>.vault.azure.net/keys/<name>' }),
      text('azure_key_algorithm', 'Algorithm', { kind: 'select', choices: ['RSA-OAEP-256', 'RSA-OAEP', 'A256KW'], switchOnly: true }),
    ],
    gcp_kms: [
      text('gcp_kms_key_name', 'Key name', { required: true, switchOnly: true, placeholder: 'projects/…/locations/…/keyRings/…/cryptoKeys/…' }),
      text('gcp_credentials_json', 'Service account key (JSON)', { help: 'Default: workload identity / ADC' }),
      text('gcp_kms_endpoint', 'Endpoint', { kind: 'url' }),
    ],
  },
  scheduler: {
    worker: [
      bool('in_process', 'Run inside the web server', { help: 'Default on; off on web replicas when a dedicated worker container runs' }),
      text('database_url', 'Leader election database URL', { help: 'Session connection (default DATABASE_URL; must bypass transaction poolers)' }),
    ],
    pg_cron: [text('pg_cron_base_url', 'Base URL pg_net calls', { kind: 'url', help: 'Default APP_URL; stored in Vault when the jobs are installed' })],
  },
}

/** Option → environment variable, per area (the providers' *_OPTION_ENV). */
export const OPTION_ENV: Partial<Record<ProviderArea, Record<string, string>>> = {
  auth: AUTH_OPTION_ENV,
  cache: CACHE_OPTION_ENV,
  email: EMAIL_OPTION_ENV,
  kms: KMS_OPTION_ENV,
  scheduler: SCHEDULER_OPTION_ENV,
  secrets: SECRETS_OPTION_ENV,
  storage: STORAGE_OPTION_ENV,
}

const SECRET_OPTIONS: Partial<Record<ProviderArea, Set<string>>> = {
  auth: AUTH_SECRET_OPTIONS,
  cache: CACHE_SECRET_OPTIONS,
  email: EMAIL_SECRET_OPTIONS,
  kms: KMS_SECRET_OPTIONS,
  secrets: SECRETS_SECRET_OPTIONS,
  storage: STORAGE_SECRET_OPTIONS,
}

/** The form fields of one provider: the area's common options, then the provider's own. */
export function providerFields(area: ProviderArea, id: string): ProviderField[] {
  const fields = [...(COMMON[area] ?? []), ...(SPECIFIC[area]?.[id] ?? [])]
  return fields.map((field) => ({ ...field, secret: SECRET_OPTIONS[area]?.has(field.option) ?? false }))
}

/** Every option any provider of the area has a field for. */
export function areaFieldOptions(area: ProviderArea): Set<string> {
  return new Set([...(COMMON[area] ?? []), ...Object.values(SPECIFIC[area] ?? {}).flat()].map((f) => f.option))
}

const FLAGS: Partial<Record<ProviderArea, SwitchFlagField[]>> = {
  db: [
    { flag: 'target-url', label: 'Target database URL', kind: 'url', secret: true, placeholder: 'postgres://usertasks:…@db.internal:5432/usertasks?sslmode=require', help: 'A PostgreSQL 15+ database (empty, or one this switch prepared). Or fill in host, database and user below instead.' },
    { flag: 'target-host', label: 'Host', kind: 'text', placeholder: 'db.internal' },
    { flag: 'target-port', label: 'Port', kind: 'number', placeholder: '5432' },
    { flag: 'target-database', label: 'Database', kind: 'text', placeholder: 'usertasks' },
    { flag: 'target-user', label: 'User', kind: 'text', placeholder: 'usertasks', help: 'Should own the target database (CREATE DATABASE … OWNER this role); the test lists the SQL a DBA runs otherwise' },
    { flag: 'target-password', label: 'Password', kind: 'text', secret: true, placeholder: 'password or secret://name', help: 'Not needed with token auth' },
    { flag: 'target-sslmode', label: 'TLS', kind: 'select', choices: ['disable', 'require', 'verify-full'], help: 'verify-full checks the server certificate (give its CA below unless it is publicly trusted)' },
    { flag: 'target-ca', label: 'CA certificate (PEM)', kind: 'textarea', placeholder: '-----BEGIN CERTIFICATE-----', help: 'Or a path to a PEM file on the server' },
    { flag: 'target-auth', label: 'Authentication', kind: 'select', choices: ['password', 'azure', 'gcp', 'aws'], help: 'Token auth as with DATABASE_AUTH (Entra ID, Cloud SQL IAM, RDS IAM — region from the host or DATABASE_AWS_REGION, RDS CA bundle): the user is the identity, no password' },
    { flag: 'prepare-only', label: 'Prepare an empty database only (bootstrap and migrations, no data)', kind: 'boolean' },
  ],
  auth: [{ flag: 'map', label: 'Identity mapping', kind: 'text', placeholder: 'google=oidc:google,azure=oidc:entra', help: 'Link Supabase OAuth identities to your identity providers by subject' }],
  storage: [
    { flag: 'bucket', label: 'Only these buckets', kind: 'list', placeholder: 'task-files,logos', help: 'Default: every app bucket' },
    { flag: 'prefix', label: 'Only keys under', kind: 'text' },
    { flag: 'overwrite', label: 'Replace objects that already exist with different content', kind: 'boolean' },
  ],
  scheduler: [
    { flag: 'base-url', label: 'Base URL for pg_cron', kind: 'url', help: 'pg_cron only (default the pg_cron_base_url setting, else APP_URL)' },
    { flag: 'no-secrets', label: 'Keep the existing Vault secrets', kind: 'boolean' },
  ],
  email: [{ flag: 'test-to', label: 'Send a test message to', kind: 'email', placeholder: 'you@example.com' }],
}

export function switchFlagFields(area: ProviderArea): SwitchFlagField[] {
  return FLAGS[area] ?? []
}

// ── Validation ──────────────────────────────────────────────────────────────

const SECRET_REF = new RegExp(`^${SECRET_REF_PREFIX.replace(/[/:]/g, '\\$&')}[A-Za-z0-9_./#%-]{1,200}$`)
const EMAILISH = /^(?:[^<>]*<\s*[^@\s<>]+@[^@\s<>]+\s*>|[^@\s<>]+@[^@\s<>]+)$/

export function isSecretRefValue(value: string): boolean {
  return SECRET_REF.test(value.trim())
}

/** zod schema for one field's value as typed into the form (always a string). */
export function fieldSchema(field: Pick<ProviderField, 'choices' | 'min' | 'label'> & { kind: SwitchFlagField['kind'] }): z.ZodType<string> {
  const base = z.string().trim().max(20_000, `${field.label} is too long`)
  switch (field.kind) {
    case 'number':
      return base.regex(/^\d+(\.\d+)?$/, `${field.label} must be a number`).refine((v) => Number(v) >= (field.min ?? 0), `${field.label} must be at least ${field.min ?? 0}`)
    case 'boolean':
      return base.toLowerCase().pipe(z.enum(['true', 'false'], { message: `${field.label} must be true or false` }))
    case 'select':
      return base.pipe(z.enum((field.choices ?? []) as [string, ...string[]], { message: `${field.label} must be one of ${(field.choices ?? []).join(', ')}` }))
    case 'url':
      return base.refine((v) => { try { return Boolean(new URL(v).protocol) } catch { return false } }, `${field.label} must be a URL`)
    case 'email':
      return base.regex(EMAILISH, `${field.label} must be an email address (or Name <address>)`)
    case 'textarea':
      return base.min(1, `${field.label} is empty`)
    case 'json':
      return base.refine((v) => { try { JSON.parse(v); return true } catch { return false } }, `${field.label} must be valid JSON`)
    default:
      return base.min(1, `${field.label} is empty`)
  }
}

/**
 * A secret field's input: a new value (stored encrypted) or a secret://
 * reference (stored as given). Either way the value itself is validated
 * with the field's schema only when it isn't a reference.
 */
export function parseFieldValue(field: Pick<ProviderField, 'choices' | 'min' | 'label'> & { kind: SwitchFlagField['kind'] }, raw: string): { ok: true; value: string; ref: boolean } | { ok: false; error: string } {
  const value = raw.trim()
  if (isSecretRefValue(value)) return { ok: true, value, ref: true }
  if (value.startsWith(SECRET_REF_PREFIX)) return { ok: false, error: `${field.label}: invalid secret reference (secret://<name>[#field])` }
  const parsed = fieldSchema(field).safeParse(value)
  return parsed.success ? { ok: true, value: parsed.data, ref: false } : { ok: false, error: parsed.error.issues[0]?.message ?? `${field.label} is invalid` }
}
