import {
  BootstrapConfigSchema,
  ConfigError,
  PROVIDER_AREAS,
  PROVIDER_ENV,
  ProviderOverridesSchema,
  type BootstrapConfig,
  type ProviderOverrides,
} from './schema'

/**
 * Bootstrap config: environment variables only, read on every call.
 *
 * Lookups go through `readEnv(name)` (a dynamic key) on purpose: Next.js
 * inlines literal `process.env.NEXT_PUBLIC_*` reads at build time, which
 * would freeze the Supabase URL/keys into the bundle. Dynamic reads see the
 * runtime environment, so one Docker image works for any project.
 *
 * Not cached: parsing a handful of strings is cheap, and tests (and the
 * DB-backed suites) set process.env at runtime and expect the next call to
 * see it — exactly as the ad-hoc process.env reads this replaces did.
 *
 * Unprefixed runtime names win; the NEXT_PUBLIC_* names stay supported so
 * existing deployments (Vercel, older .env files) keep working unchanged.
 */

export function readEnv(name: string): string | undefined {
  return process.env[name]
}

/** First variable that is set and non-empty. */
function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = readEnv(name)
    if (value !== undefined && value !== '') return value
  }
  return undefined
}

export function getBootstrapConfig(): BootstrapConfig {
  return BootstrapConfigSchema.parse({
    databaseUrl: firstEnv('DATABASE_URL'),
    supabase: {
      url: firstEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'),
      anonKey: firstEnv('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      serviceRoleKey: firstEnv('SUPABASE_SERVICE_ROLE_KEY'),
    },
    jwtSecret: firstEnv('SUPABASE_JWT_SECRET'),
    encryptionKey: firstEnv('ENCRYPTION_KEY'),
    appUrl: firstEnv('APP_URL', 'NEXT_PUBLIC_APP_URL'),
    deploymentMode: readEnv('DEPLOYMENT_MODE')?.trim().toLowerCase() === 'cloud' ? 'cloud' : 'self_hosted',
    processorSecret: readEnv('WORKFLOW_PROCESSOR_SECRET') ?? readEnv('CRON_SECRET'),
    cronSecret: readEnv('CRON_SECRET'),
    ssoMicrosoft: firstEnv('SSO_MICROSOFT', 'NEXT_PUBLIC_SSO_MICROSOFT') === '1',
  })
}

/** Provider ids set in the environment. Throws ConfigError on an unknown id. */
export function getEnvProviderOverrides(): ProviderOverrides {
  const raw = Object.fromEntries(
    PROVIDER_AREAS.map((area) => [area, readEnv(PROVIDER_ENV[area])?.trim().toLowerCase() || undefined]),
  )
  const parsed = ProviderOverridesSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const area = String(issue?.path[0] ?? '')
    throw new ConfigError(`${PROVIDER_ENV[area as keyof typeof PROVIDER_ENV] ?? area}: unknown provider "${raw[area]}"`)
  }
  return parsed.data
}

// ── Typed getters for the values call sites used to read ad hoc ──────────────

export function supabaseUrl(): string | undefined {
  return getBootstrapConfig().supabase.url
}

export function supabaseAnonKey(): string | undefined {
  return getBootstrapConfig().supabase.anonKey
}

export function supabaseServiceRoleKey(): string | undefined {
  return getBootstrapConfig().supabase.serviceRoleKey
}

/** Direct Postgres connection string (DATABASE_URL). */
export function databaseUrl(): string | undefined {
  return getBootstrapConfig().databaseUrl
}

/** Supabase JWT secret (SUPABASE_JWT_SECRET), when configured. */
export function supabaseJwtSecret(): string | undefined {
  return getBootstrapConfig().jwtSecret
}

/** Configured public origin exactly as set (may be undefined or untrimmed). */
export function configuredAppUrl(): string | undefined {
  return getBootstrapConfig().appUrl
}

/** Configured origin, or the local default every internal kick used before. */
export function appUrlOrLocalhost(): string {
  return configuredAppUrl() || 'http://localhost:3000'
}

/** Shared secret for internal service endpoints (WORKFLOW_PROCESSOR_SECRET ?? CRON_SECRET). */
export function processorSecret(): string | undefined {
  return getBootstrapConfig().processorSecret
}
