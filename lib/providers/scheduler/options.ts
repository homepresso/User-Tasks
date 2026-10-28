/**
 * Scheduler provider options (`scheduler.<option>` instance settings, or the
 * environment variables below, which win).
 *
 * worker:
 *  - in_process     run the worker inside the Next.js server (default true;
 *                   set false on web replicas when a dedicated worker
 *                   container runs `usertasks worker`)
 *  - database_url   session connection for advisory-lock leader election
 *                   (default DATABASE_URL; must bypass transaction poolers)
 * external (any provider, really — the tick endpoint accepts these whenever
 * they are configured, in addition to the shared cron secret):
 *  - oidc_audience           expected `aud` of Google-signed OIDC ID tokens
 *                            (Cloud Scheduler); default <APP_URL>/api/cron/tick
 *  - oidc_service_accounts   comma-separated service-account emails allowed
 *                            to call (required to accept OIDC tokens)
 *  - entra_tenant_id         Microsoft Entra tenant id (managed identity
 *                            tokens from Azure Container Apps Jobs, Functions,
 *                            Logic Apps)
 *  - entra_audience          comma-separated accepted `aud` values (the app
 *                            registration's application ID URI and/or client id)
 *  - entra_allowed_principals comma-separated object ids (`oid`) or client ids
 *                            (`appid`/`azp`) allowed to call (required)
 *  - cognito_user_pool_id    Amazon Cognito user pool (eu-west-1_AbCdEf) whose
 *                            access tokens may call: an EventBridge API
 *                            destination connection with OAuth client
 *                            credentials against a pool app client
 *  - cognito_allowed_clients comma-separated app client ids allowed to call
 *                            (required)
 *  - cognito_scope           a scope the token must carry (e.g. usertasks/tick)
 *  - cognito_region          region of the pool (default: the pool id's prefix)
 * pg_cron:
 *  - pg_cron_base_url  base URL pg_net calls (default APP_URL); stored in
 *                      Vault by `npm run scheduler -- install-pg-cron`
 */

export const SCHEDULER_OPTION_ENV: Record<string, string> = {
  in_process: 'SCHEDULER_IN_PROCESS',
  database_url: 'SCHEDULER_DATABASE_URL',
  oidc_audience: 'SCHEDULER_OIDC_AUDIENCE',
  oidc_service_accounts: 'SCHEDULER_OIDC_SERVICE_ACCOUNTS',
  entra_tenant_id: 'SCHEDULER_ENTRA_TENANT_ID',
  entra_audience: 'SCHEDULER_ENTRA_AUDIENCE',
  entra_allowed_principals: 'SCHEDULER_ENTRA_ALLOWED_PRINCIPALS',
  cognito_user_pool_id: 'SCHEDULER_COGNITO_USER_POOL_ID',
  cognito_allowed_clients: 'SCHEDULER_COGNITO_ALLOWED_CLIENTS',
  cognito_scope: 'SCHEDULER_COGNITO_SCOPE',
  cognito_region: 'SCHEDULER_COGNITO_REGION',
  pg_cron_base_url: 'SCHEDULER_PG_CRON_BASE_URL',
}

export type SchedulerOptions = Record<string, unknown>

export function schedulerOption(options: SchedulerOptions, name: string): string | undefined {
  const value = options[name]
  if (value === undefined || value === null) return undefined
  const text = String(value).trim()
  return text === '' ? undefined : text
}

/** Comma / whitespace separated list option. */
export function schedulerListOption(options: SchedulerOptions, name: string): string[] {
  const value = options[name]
  const items = Array.isArray(value) ? value.map(String) : (schedulerOption(options, name) ?? '').split(/[\s,]+/)
  return items.map((item) => item.trim()).filter(Boolean)
}

export function schedulerBoolOption(options: SchedulerOptions, name: string, fallback: boolean): boolean {
  const value = options[name]
  if (typeof value === 'boolean') return value
  const text = schedulerOption(options, name)?.toLowerCase()
  if (text === undefined) return fallback
  if (['1', 'true', 'yes', 'on'].includes(text)) return true
  if (['0', 'false', 'no', 'off'].includes(text)) return false
  return fallback
}
