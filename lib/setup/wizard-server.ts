import type { InstanceConfig } from '@/lib/config'
import type { InfrastructureViewer } from '@/lib/admin/instance-admins'
import type { ActionResult } from '@/lib/admin/infrastructure-switching'
import type { HostCheck } from '@/lib/install/egress-server'
import type { SsoIdpConfig } from '@/lib/providers/auth/sso/config'
import type { SsoCheckResult } from '@/lib/providers/auth/sso/check'
import { hostsForOptions } from '@/lib/install/egress'
import {
  EMAIL_CHOICES, WIZARD_STATE_SETTING, emailAddressSchema, idpFromForm, isStepId, markStep, parseProgress, parseStoredIdps, upsertIdp,
  type IdpFormInput, type StepStatus, type WizardProgress,
} from './wizard-model'

/**
 * Server side of the setup wizard's actions, with dependencies passed in
 * (app/actions/setup-wizard.ts binds the real ones; tests pass fakes).
 *
 * Every call re-checks instance-admin access first: after the first admin
 * exists the wizard is theirs alone (before that, /setup and its setup code
 * guard step 1). Changes go through the same engine as Settings →
 * Infrastructure and `usertasks-admin switch` (saveSettings / applySwitch:
 * the switch log, backups, rollback, the UI switching gate, secrets stored
 * encrypted and never sent back). Every "Test" is rate limited and checks
 * the hosts it would contact against the egress policy (SSRF).
 */

export interface WizardDeps {
  canView: (user: InfrastructureViewer | null | undefined) => Promise<boolean>
  /** true = allowed. */
  rateLimit: (key: string, max: number) => Promise<boolean>
  readSetting: (key: string) => Promise<unknown>
  writeSetting: (key: string, value: unknown, updatedBy: string | null) => Promise<void>
  /** The instance config as stored (secret:// references unresolved). */
  config: () => Promise<InstanceConfig>
  /** The email provider's options with secret:// references resolved (to test it). */
  checkHosts: (hosts: string[]) => Promise<HostCheck>
  checkIdp: (idp: SsoIdpConfig, origin: string) => Promise<SsoCheckResult>
  sendTestEmail: (to: string) => Promise<Array<{ name: string; status: string; detail: string }>>
  saveSettings: (user: InfrastructureViewer, input: unknown) => Promise<ActionResult<{ saved?: boolean; passed?: boolean; lines?: string[] }>>
  applySwitch: (user: InfrastructureViewer, input: unknown) => Promise<ActionResult<{ lines?: string[]; mode?: string }>>
  appUrl: () => string
}

type Failure = { ok: false; error: string; fieldErrors?: Record<string, string>; allowEntry?: string | null; lines?: string[] }
type Result<T = object> = ({ ok: true } & T) | Failure

const DENIED = { ok: false as const, error: 'Only instance administrators can use the setup wizard.' }
const RATE_LIMITED = { ok: false as const, error: 'Too many tests in a row: wait a minute and try again.' }

async function admin<R extends { ok: boolean }>(user: InfrastructureViewer | null | undefined, deps: WizardDeps, fn: (user: InfrastructureViewer) => Promise<R>): Promise<R | Failure> {
  if (!user || !(await deps.canView(user))) return DENIED
  try {
    return await fn(user)
  } catch (error) {
    console.error(`[setup-wizard] ${(error as Error).stack ?? error}`)
    return { ok: false, error: `Something went wrong: ${(error as Error).message}` }
  }
}

function blocked(check: HostCheck): Failure | null {
  if (check.ok) return null
  const reason = check.reason.replace(/^Connection to \S+ is not allowed: /, '')
  return {
    ok: false,
    error: `${check.host} can't be tested from this page: ${reason}`,
    allowEntry: check.allowEntry,
  }
}

export async function loadProgress(deps: Pick<WizardDeps, 'readSetting'>): Promise<WizardProgress> {
  return parseProgress(await deps.readSetting(WIZARD_STATE_SETTING).catch(() => null))
}

/** Mark a step done or skipped (Skip / Continue). */
export async function markStepAs(user: InfrastructureViewer | null | undefined, step: unknown, status: unknown, deps: WizardDeps): Promise<Result<{ progress: WizardProgress }>> {
  return admin(user, deps, async (viewer) => {
    if (!isStepId(step) || (status !== 'done' && status !== 'skipped')) return { ok: false, error: 'Unknown step' }
    const progress = markStep(await loadProgress(deps), step, status as StepStatus)
    await deps.writeSetting(WIZARD_STATE_SETTING, progress, viewer.id)
    return { ok: true, progress }
  })
}

/** Stored identity providers (raw, secrets included: server only). */
async function storedIdps(deps: WizardDeps): Promise<{ list: Array<Record<string, unknown>>; authProvider: string; pinned: boolean }> {
  const config = await deps.config()
  const auth = config.providers.auth
  return { list: parseStoredIdps(auth.options.sso_providers), authProvider: auth.id, pinned: Boolean(process.env.AUTH_SSO_PROVIDERS?.trim()) }
}

function signInRefusal(authProvider: string, pinned: boolean): string | null {
  if (authProvider === 'supabase') return 'Sign-in runs on Supabase Auth here: set up SSO in your Supabase project, or move sign-in to built-in first (Services → Sign-in → Change…).'
  if (pinned) return 'Identity providers are set by the AUTH_SSO_PROVIDERS environment variable on this server: change them there and restart UserTasks.'
  return null
}

/** Check an identity provider's configuration (OIDC discovery and keys, SAML metadata): nothing saved, no sign-in. */
export async function testIdpAs(user: InfrastructureViewer | null | undefined, input: unknown, deps: WizardDeps): Promise<Result<{ result: SsoCheckResult }>> {
  return admin(user, deps, async (viewer) => {
    if (!(await deps.rateLimit(`setup-wizard:test:${viewer.id}`, 10))) return RATE_LIMITED
    const form = (input ?? {}) as IdpFormInput
    const { list } = await storedIdps(deps)
    const built = idpFromForm(form, list.find((x) => x.id === form.id?.trim().toLowerCase()) ?? null)
    if (!built.ok) return { ok: false, error: 'Some values need attention.', fieldErrors: built.errors }
    const refused = blocked(await deps.checkHosts(hostsForOptions('auth', { sso_providers: JSON.stringify([built.raw]) })))
    if (refused) return refused
    try {
      return { ok: true, result: await deps.checkIdp(built.idp, deps.appUrl()) }
    } catch (error) {
      return { ok: true, result: { id: built.idp.id, type: built.idp.type, ok: false, detail: (error as Error).message, warnings: [] } }
    }
  })
}

/** Add or update an identity provider (auth.sso_providers, through the settings engine: switch log, rollback, encrypted). */
export async function saveIdpAs(user: InfrastructureViewer | null | undefined, input: unknown, deps: WizardDeps): Promise<Result<{ id: string }>> {
  return admin(user, deps, async (viewer) => {
    const { list, authProvider, pinned } = await storedIdps(deps)
    const refusal = signInRefusal(authProvider, pinned)
    if (refusal) return { ok: false, error: refusal }
    const form = (input ?? {}) as IdpFormInput
    const built = idpFromForm(form, list.find((x) => x.id === form.id?.trim().toLowerCase()) ?? null)
    if (!built.ok) return { ok: false, error: 'Some values need attention.', fieldErrors: built.errors }
    const next = upsertIdp(list, built.raw)
    const res = await deps.saveSettings(viewer, { area: 'auth', values: { sso_providers: JSON.stringify(next) }, dryRun: false })
    if (!res.ok) return res
    if (res.saved === false) return { ok: false, error: (res.lines ?? []).filter((l) => /fail|error/i.test(l)).slice(-2).join(' ') || 'The checks failed: nothing was saved.' }
    return { ok: true, id: built.idp.id }
  })
}

export async function removeIdpAs(user: InfrastructureViewer | null | undefined, id: unknown, deps: WizardDeps): Promise<Result> {
  return admin(user, deps, async (viewer) => {
    const { list, authProvider, pinned } = await storedIdps(deps)
    const refusal = signInRefusal(authProvider, pinned)
    if (refusal) return { ok: false, error: refusal }
    if (!list.some((x) => x.id === id)) return { ok: false, error: 'No such identity provider' }
    if ((authProvider === 'oidc' || authProvider === 'saml') && list.filter((x) => x.type === authProvider && x.id !== id).length === 0) {
      return { ok: false, error: `Sign-in is ${authProvider.toUpperCase()}-only: removing the last ${authProvider.toUpperCase()} provider would lock everyone out. Add another first, or switch sign-in to built-in.` }
    }
    const next = list.filter((x) => x.id !== id)
    const res = await deps.saveSettings(viewer, next.length ? { area: 'auth', values: { sso_providers: JSON.stringify(next) }, dryRun: false } : { area: 'auth', values: {}, clear: ['sso_providers'], dryRun: false })
    return res.ok ? { ok: true } : res
  })
}

export interface EmailInput {
  choice: string
  values: Record<string, string>
}

/** Change how email is sent: a settings change on the same provider, or a (config-only) email switch. */
export async function saveEmailAs(user: InfrastructureViewer | null | undefined, input: unknown, deps: WizardDeps): Promise<Result<{ switched: boolean; lines: string[] }>> {
  return admin(user, deps, async (viewer) => {
    const raw = (input ?? {}) as Partial<EmailInput>
    const choice = EMAIL_CHOICES.find((c) => c.id === raw.choice)
    if (!choice) return { ok: false, error: 'Choose how to send email' }
    const values: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.values ?? {})) if (typeof v === 'string' && v.trim() !== '' && /^[a-z][a-z0-9_]{0,62}$/.test(k)) values[k] = v
    const config = await deps.config()
    const current = config.providers.email
    if (current.source === 'env') return { ok: false, error: 'The email provider is set by EMAIL_PROVIDER in the environment on this server: change it there (or remove it so this page can manage email) and restart UserTasks.' }
    if (choice.provider === current.id) {
      const res = await deps.saveSettings(viewer, { area: 'email', values, dryRun: false })
      if (!res.ok) return res.error === 'Nothing changed.' ? { ok: true, switched: false, lines: [] } : res
      if (res.saved === false) return { ok: false, error: 'The checks failed: nothing was saved.' }
      return { ok: true, switched: false, lines: res.lines ?? [] }
    }
    const withDefaults = { ...Object.fromEntries(Object.entries(choice.defaults).filter(([k]) => !(k in values) && !current.options[k])), ...values }
    const res = await deps.applySwitch(viewer, { area: 'email', to: choice.provider, values: withDefaults, flags: {} })
    if (!res.ok) return res
    return { ok: true, switched: true, lines: res.lines ?? [] }
  })
}

/** Send a real test message with the email settings in use now. */
export async function sendTestEmailAs(user: InfrastructureViewer | null | undefined, to: unknown, deps: WizardDeps): Promise<Result<{ checks: Array<{ name: string; status: string; detail: string }> }>> {
  return admin(user, deps, async (viewer) => {
    if (!(await deps.rateLimit(`setup-wizard:email:${viewer.id}`, 5))) return RATE_LIMITED
    const address = emailAddressSchema.safeParse(to)
    if (!address.success) return { ok: false, error: 'Enter the address to send the test to.', fieldErrors: { to: 'Enter an email address' } }
    const email = (await deps.config()).providers.email
    const refused = blocked(await deps.checkHosts(hostsForOptions('email', email.options)))
    if (refused) return refused
    const checks = await deps.sendTestEmail(address.data)
    return { ok: true, checks }
  })
}
