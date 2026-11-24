import type { ProviderArea } from '@/lib/config/schema'

/**
 * The Infrastructure add-on: what is free in core and what needs the paid
 * extension (`@usertasks-ext/infrastructure`, manifest id `infrastructure`,
 * SKU `infrastructure`, licence feature `infrastructure-separation`).
 *
 *   Core RUNS any configuration. Every runtime provider (database, sign-in,
 *   files, live updates, background jobs, email, secret store, cache, KMS),
 *   the configuration loader, the health checks (doctor), the read-only
 *   Settings → Infrastructure page and `usertasks-admin status|providers|
 *   doctor|history` stay in the open-source core, so an install that was
 *   separated with an earlier release (v0.2.0 / v0.3.0), or by hand, keeps
 *   running and upgrades without a licence.
 *
 *   CHANGING configuration off the standard stack needs the add-on: the
 *   provider switch (test, plan, apply, background runner, data copies),
 *   rollback, the switch log controls, `usertasks-admin switch|rollback`, the
 *   setup wizard's "move off Supabase" section and, at install time, writing a
 *   separated install profile (lib/install/standard-stack.ts).
 *
 * The free standard stacks are the bundled single stacks: a Supabase project
 * (database, sign-in, files and live updates on Supabase) and the bundled
 * all-in-one stack (PostgreSQL, built-in sign-in, files, live updates, worker
 * and cache all installed with UserTasks: the `standalone` Docker Compose
 * profile, the Windows installer's PostgreSQL). Configuring those stacks stays
 * free: email (SMTP relay / Microsoft 365 / Exchange, Resend, or log-only) and
 * sign-in (built-in accounts, OIDC / SAML identity providers, directory
 * sign-in) are settings of the stack, not separation.
 *
 * Pure: imported by client components (upsell cards) and the CLI.
 */

export const INFRASTRUCTURE_EXTENSION_ID = 'infrastructure'
export const INFRASTRUCTURE_FEATURE = 'infrastructure-separation'
export const INFRASTRUCTURE_SKU = 'infrastructure'
export const INFRASTRUCTURE_ADDON_NAME = 'Infrastructure add-on'
/** Owner-approved list price (USD, per deployment, per year; decided 2026-11-23). */
export const INFRASTRUCTURE_PRICE = '$9,000 USD per deployment per year'

/** The separate processing add-on (worker tier, remote runners): a different paid extension. */
export const PROCESSING_EXTENSION_ID = 'processing'
export const PROCESSING_FEATURE = 'processing'
export const PROCESSING_SKU = 'processing-tier'
export const PROCESSING_ADDON_NAME = 'Processing add-on'
/** Owner-approved list price (USD, per deployment, per year). */
export const PROCESSING_PRICE = '$2,500 USD per deployment per year'

/** Where an instance admin gets or installs an add-on. */
export const ADDON_LINKS = {
  extensions: '/settings/extensions',
  licence: '/settings/licence',
  infrastructureDocs: '/docs/self-hosting/infrastructure-add-on',
  processingDocs: '/docs/self-hosting/infrastructure#processing-tier',
  contact: '/contact',
} as const

/**
 * Email transports every standard stack uses: changing between them, and
 * their settings, is free. The API integrations (Amazon SES, Azure
 * Communication Services, Microsoft Graph, Gmail API) need the add-on.
 */
export const FREE_EMAIL_PROVIDERS: readonly string[] = ['smtp', 'resend', 'console']

/** Areas whose current provider's settings can be edited without the add-on (email transport, identity providers). */
export const FREE_SETTINGS_AREAS: readonly ProviderArea[] = ['email', 'auth']

/** A provider switch that stays on the standard stack (free): only email between the standard transports. */
export function isFreeProviderChange(area: ProviderArea, to: string): boolean {
  return area === 'email' && FREE_EMAIL_PROVIDERS.includes(to)
}

/** Editing the current provider's settings in this area is free (email, sign-in). */
export function isFreeSettingsChange(area: ProviderArea, provider: string): boolean {
  if (area === 'email') return FREE_EMAIL_PROVIDERS.includes(provider)
  return area === 'auth'
}

export const ADDON_REQUIRED_CODE = 'addon_required'

/** The refusal core gives for a change that needs the add-on (server actions, API, CLI). */
export function addonRequiredMessage(what = 'Changing infrastructure providers'): string {
  return `${what} needs the ${INFRASTRUCTURE_ADDON_NAME} (a paid extension). This instance keeps running on its current providers. An instance admin can install the add-on and its licence in Settings → Extensions and Settings → Licence (or usertasks-admin licence install).`
}

/** What the add-on does, for upsell cards and CLI messages. */
export const INFRASTRUCTURE_ADDON_POINTS: readonly string[] = [
  'Move the database, sign-in, files, live updates, background jobs, email, secret store, cache or KMS off the standard stack, one service at a time.',
  'Test connection and review the plan before anything changes; data moves (database copy, user accounts, files) run in the background with progress.',
  'Backups before every move, a switch log, and rollback — from Settings → Infrastructure or usertasks-admin switch / rollback.',
  'Install straight onto your own PostgreSQL, S3, Azure Blob, SSO-only sign-in and other separated services.',
]

export const PROCESSING_ADDON_POINTS: readonly string[] = [
  'Run workflow, agent and media processing on separate, scalable worker processes instead of the web app.',
  'Worker health, memory backpressure, graceful drain and Prometheus metrics; designer test runs on workers.',
  'For Docker, Kubernetes (HPA / KEDA), plain PostgreSQL and air-gapped installs.',
]
