/**
 * The Helm chart's provider option table (deploy/helm/usertasks/files/
 * provider-options.json): for each provider area, the `<AREA>_PROVIDER`
 * variable, the provider ids, and every option name → environment variable,
 * taken from the providers' own option maps so the chart can't drift from
 * the code. Options the code treats as secrets are listed too: the chart
 * refuses them in plain values (they belong in the Secret, or as secret://
 * references). It also writes the `providers` part of the chart's
 * values.schema.json from the same table.
 *
 *   npx tsx scripts/helm-options.ts           write the file
 *   npx tsx scripts/helm-options.ts --check   exit 1 when it is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PROVIDER_AREAS, PROVIDER_ENV, PROVIDER_IDS, type ProviderArea } from '../lib/config/schema'
import { AUTH_OPTION_ENV, AUTH_SECRET_OPTIONS } from '../lib/providers/auth/options'
import { CACHE_OPTION_ENV, CACHE_SECRET_OPTIONS } from '../lib/providers/cache/options'
import { EMAIL_OPTION_ENV, EMAIL_SECRET_OPTIONS } from '../lib/providers/email/options'
import { KMS_OPTION_ENV, KMS_SECRET_OPTIONS } from '../lib/providers/kms/options'
import { SCHEDULER_OPTION_ENV } from '../lib/providers/scheduler/options'
import { SECRETS_OPTION_ENV, SECRETS_SECRET_OPTIONS } from '../lib/providers/secrets/options'
import { STORAGE_OPTION_ENV, STORAGE_SECRET_OPTIONS } from '../lib/providers/storage/options'

export const HELM_OPTIONS_FILE = path.resolve(__dirname, '../deploy/helm/usertasks/files/provider-options.json')
export const HELM_SCHEMA_FILE = path.resolve(__dirname, '../deploy/helm/usertasks/values.schema.json')

/** Environment-only settings (no instance-setting option in the code) the chart also exposes per area. */
const CHART_EXTRAS: Record<ProviderArea, Record<string, string>> = {
  db: {
    url: 'DATABASE_URL',
    migration_url: 'MIGRATION_DATABASE_URL',
    auth: 'DATABASE_AUTH',
    pool_max: 'DATABASE_POOL_MAX',
    max_rows: 'DB_MAX_ROWS',
    migrations_dir: 'MIGRATIONS_DIR',
    supabase_url: 'SUPABASE_URL',
    supabase_anon_key: 'SUPABASE_ANON_KEY',
    supabase_service_role_key: 'SUPABASE_SERVICE_ROLE_KEY',
    supabase_jwt_secret: 'SUPABASE_JWT_SECRET',
  },
  auth: { database_url: 'AUTH_DATABASE_URL', database_pool_max: 'AUTH_DATABASE_POOL_MAX', cookie_secure: 'AUTH_COOKIE_SECURE' },
  storage: {},
  realtime: { database_url: 'REALTIME_DATABASE_URL', supabase_db_url: 'SUPABASE_DB_URL' },
  scheduler: { tick_concurrency: 'CRON_TICK_CONCURRENCY' },
  email: {},
  secrets: {},
  cache: {},
  kms: {},
}

const CHART_EXTRA_SECRETS: Partial<Record<ProviderArea, string[]>> = {
  db: ['supabase_service_role_key', 'supabase_jwt_secret'],
}

const CODE: Record<ProviderArea, { env: Record<string, string>; secret: Set<string> }> = {
  db: { env: {}, secret: new Set() },
  auth: { env: AUTH_OPTION_ENV, secret: AUTH_SECRET_OPTIONS },
  storage: { env: STORAGE_OPTION_ENV, secret: STORAGE_SECRET_OPTIONS },
  realtime: { env: {}, secret: new Set() },
  scheduler: { env: SCHEDULER_OPTION_ENV, secret: new Set() },
  email: { env: EMAIL_OPTION_ENV, secret: EMAIL_SECRET_OPTIONS },
  secrets: { env: SECRETS_OPTION_ENV, secret: SECRETS_SECRET_OPTIONS },
  cache: { env: CACHE_OPTION_ENV, secret: CACHE_SECRET_OPTIONS },
  kms: { env: KMS_OPTION_ENV, secret: KMS_SECRET_OPTIONS },
}

export function helmProviderOptions() {
  const areas: Record<string, { env: string; ids: readonly string[]; options: Record<string, string>; secretOptions: string[] }> = {}
  for (const area of PROVIDER_AREAS) {
    const options = { ...CODE[area].env, ...CHART_EXTRAS[area] }
    areas[area] = {
      env: PROVIDER_ENV[area],
      ids: PROVIDER_IDS[area],
      options: Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b))),
      secretOptions: [...CODE[area].secret, ...(CHART_EXTRA_SECRETS[area] ?? [])].sort(),
    }
  }
  return { generatedBy: 'scripts/helm-options.ts', areas }
}

export function renderHelmOptions(): string {
  return `${JSON.stringify(helmProviderOptions(), null, 2)}\n`
}

/** values.schema.json with its `providers` section regenerated from the table. */
export function renderHelmSchema(current: string): string {
  const schema = JSON.parse(current)
  const providers: Record<string, unknown> = {}
  for (const [area, spec] of Object.entries(helmProviderOptions().areas)) {
    providers[area] = {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['', ...spec.ids], description: `${spec.env} (empty: the app default)` },
        options: {
          type: 'object',
          properties: Object.fromEntries(Object.entries(spec.options).map(([name, env]) => [name, { description: env, type: ['string', 'number', 'boolean', 'array', 'object'] }])),
          additionalProperties: false,
          description: `${area} provider options by instance-setting name`,
        },
      },
      additionalProperties: false,
    }
  }
  schema.properties.providers = { type: 'object', properties: providers, additionalProperties: false }
  return `${JSON.stringify(schema, null, 2)}\n`
}

if (typeof require !== 'undefined' && require.main === module) {
  const outputs = [
    { file: HELM_OPTIONS_FILE, text: renderHelmOptions() },
    { file: HELM_SCHEMA_FILE, text: renderHelmSchema(readFileSync(HELM_SCHEMA_FILE, 'utf8')) },
  ]
  if (process.argv.includes('--check')) {
    for (const { file, text } of outputs) {
      let current = ''
      try { current = readFileSync(file, 'utf8') } catch { /* missing */ }
      if (current !== text) {
        console.error(`${path.relative(process.cwd(), file)} is out of date: run npx tsx scripts/helm-options.ts`)
        process.exit(1)
      }
    }
    console.log('Helm provider options and schema are up to date.')
  } else {
    for (const { file, text } of outputs) {
      writeFileSync(file, text)
      console.log(`Wrote ${path.relative(process.cwd(), file)}`)
    }
  }
}
