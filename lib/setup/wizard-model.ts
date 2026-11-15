import { z } from 'zod'
import { OIDC_PRESETS, SAML_PRESETS, SsoIdpSchema, type SsoIdpConfig } from '@/lib/providers/auth/sso/schema'

/**
 * The setup wizard (/settings/setup) model, pure so the client components
 * and the tests share it: the steps, the saved progress (instance setting
 * `instance.setup_wizard`), and the sign-in step's identity provider form.
 */

export const WIZARD_STEPS = [
  { id: 'account', title: 'Admin account', summary: 'The setup code and the first admin account.' },
  { id: 'organisation', title: 'Your organisation', summary: 'Its name, sign-in name and web address.' },
  { id: 'services', title: 'Services', summary: 'Where data, files, email and background jobs run.' },
  { id: 'sign-in', title: 'Sign-in and SSO', summary: 'Let people sign in with Microsoft, AD FS or another identity provider.' },
  { id: 'email', title: 'Email', summary: 'How invitations and notifications are sent.' },
  { id: 'team', title: 'Invite your team', summary: 'Send the first invitations.' },
  { id: 'done', title: 'Done', summary: 'A health summary and where to go next.' },
] as const

export type WizardStepId = (typeof WIZARD_STEPS)[number]['id']
export type StepStatus = 'done' | 'skipped'

export const WIZARD_STEP_IDS = WIZARD_STEPS.map((s) => s.id) as WizardStepId[]
export const WIZARD_STATE_SETTING = 'instance.setup_wizard'

export interface WizardProgress {
  steps: Partial<Record<WizardStepId, StepStatus>>
  finishedAt: string | null
}

export function isStepId(value: unknown): value is WizardStepId {
  return typeof value === 'string' && (WIZARD_STEP_IDS as string[]).includes(value)
}

/** The stored progress (any shape tolerated: unknown entries dropped). */
export function parseProgress(raw: unknown): WizardProgress {
  let value = raw
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { value = null }
  }
  const obj = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const steps: WizardProgress['steps'] = {}
  const rawSteps = obj.steps && typeof obj.steps === 'object' ? (obj.steps as Record<string, unknown>) : {}
  for (const [id, status] of Object.entries(rawSteps)) {
    if (isStepId(id) && (status === 'done' || status === 'skipped')) steps[id] = status
  }
  return { steps, finishedAt: typeof obj.finishedAt === 'string' ? obj.finishedAt : null }
}

export function markStep(progress: WizardProgress, step: WizardStepId, status: StepStatus, now = new Date()): WizardProgress {
  const steps = { ...progress.steps, [step]: status }
  // "Done" closes the wizard; a skipped step stays skipped (Settings → Infrastructure has the same panels).
  return { steps, finishedAt: step === 'done' ? progress.finishedAt ?? now.toISOString() : progress.finishedAt }
}

/** The first step not done or skipped (the account is done once anyone can open the wizard). */
export function nextStep(progress: WizardProgress): WizardStepId {
  return WIZARD_STEP_IDS.find((id) => id !== 'account' && !progress.steps[id]) ?? 'done'
}

export function stepAfter(step: WizardStepId): WizardStepId {
  const i = WIZARD_STEP_IDS.indexOf(step)
  return WIZARD_STEP_IDS[Math.min(i + 1, WIZARD_STEP_IDS.length - 1)]
}

export function stepBefore(step: WizardStepId): WizardStepId {
  const i = WIZARD_STEP_IDS.indexOf(step)
  return WIZARD_STEP_IDS[Math.max(i - 1, 1)]
}

// ── Sign-in step: identity provider form ────────────────────────────────────

/** The choices the form offers, in plain words. Each maps to an SSO preset. */
export const IDP_KINDS = [
  { id: 'entra', label: 'Microsoft Entra ID (Azure AD, Microsoft 365)', type: 'oidc', preset: 'entra' },
  { id: 'adfs', label: 'AD FS (Active Directory Federation Services)', type: 'saml', preset: 'adfs' },
  { id: 'okta', label: 'Okta', type: 'oidc', preset: 'okta' },
  { id: 'keycloak', label: 'Keycloak', type: 'oidc', preset: 'keycloak' },
  { id: 'google', label: 'Google Workspace', type: 'oidc', preset: 'google' },
  { id: 'oidc', label: 'Other OpenID Connect provider', type: 'oidc', preset: 'generic' },
  { id: 'saml', label: 'Other SAML 2.0 provider', type: 'saml', preset: 'generic' },
] as const
export type IdpKind = (typeof IDP_KINDS)[number]['id']

export interface IdpFormInput {
  kind: IdpKind
  /** Short id used in URLs (lowercase letters, digits, - and _). */
  id: string
  /** Button label on the sign-in page. */
  name?: string
  tenantId?: string
  domain?: string
  baseUrl?: string
  realm?: string
  issuer?: string
  metadataUrl?: string
  clientId?: string
  /** Blank keeps the stored secret (editing an existing provider). */
  clientSecret?: string
  allowedDomains?: string
  defaultOrg?: string
  defaultRole?: string
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/**
 * The form → an auth.sso_providers entry, validated with the SSO schema.
 * `existing` is the stored entry with the same id (its client secret is kept
 * when the form leaves it blank).
 */
export function idpFromForm(input: IdpFormInput, existing?: Record<string, unknown> | null): { ok: true; idp: SsoIdpConfig; raw: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const kind = IDP_KINDS.find((k) => k.id === input.kind)
  if (!kind) return { ok: false, errors: { kind: 'Choose an identity provider' } }
  const errors: Record<string, string> = {}
  const id = text(input.id)?.toLowerCase()
  if (!id || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id)) errors.id = 'Use lowercase letters, digits, - and _ (up to 40), starting with a letter or digit'
  const raw: Record<string, unknown> = { id, type: kind.type, preset: kind.preset }
  if (text(input.name)) raw.name = text(input.name)
  const need = (field: keyof IdpFormInput, message: string) => {
    const value = text(input[field])
    if (!value) errors[field] = message
    else raw[field] = value
  }
  if (kind.type === 'oidc') {
    if (kind.preset === 'entra') need('tenantId', 'Enter the directory (tenant) id or your verified domain')
    if (kind.preset === 'okta') need('domain', 'Enter your Okta domain, e.g. acme.okta.com')
    if (kind.preset === 'keycloak') { need('baseUrl', 'Enter the Keycloak address, e.g. https://sso.example.com'); need('realm', 'Enter the realm') }
    if (kind.preset === 'generic') need('issuer', 'Enter the issuer URL (its /.well-known/openid-configuration must load)')
    need('clientId', 'Enter the client (application) id')
    const secret = text(input.clientSecret) ?? (typeof existing?.clientSecret === 'string' ? existing.clientSecret : undefined)
    if (secret) raw.clientSecret = secret
  } else {
    need('metadataUrl', kind.preset === 'adfs' ? 'Enter the federation metadata URL, e.g. https://adfs.example.com/FederationMetadata/2007-06/FederationMetadata.xml' : 'Enter the IdP metadata URL')
  }
  const domains = text(input.allowedDomains)?.split(/[\s,]+/).filter(Boolean)
  if (domains?.length) raw.allowedDomains = domains
  if (text(input.defaultOrg)) raw.defaultOrg = text(input.defaultOrg)
  if (text(input.defaultRole)) raw.defaultRole = text(input.defaultRole)
  if (Object.keys(errors).length) return { ok: false, errors }
  const parsed = SsoIdpSchema.safeParse(raw)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors[String(issue.path[0] ?? 'kind')] ??= issue.message
    return { ok: false, errors }
  }
  return { ok: true, idp: parsed.data, raw }
}

/** What the page may show of a stored entry: no secrets. */
export interface IdpSummary {
  id: string
  type: 'oidc' | 'saml'
  preset: string
  name: string | null
  kind: IdpKind
  /** Where it signs in (issuer / tenant / base URL / metadata URL). */
  where: string | null
  clientId: string | null
  hasSecret: boolean
  /** secret:// reference name, when the secret is one. */
  secretRef: string | null
  allowedDomains: string[]
  defaultOrg: string | null
  defaultRole: string | null
  /** The form's values (secret excluded), for editing. */
  form: Omit<IdpFormInput, 'clientSecret'>
}

export function kindOf(type: string, preset: string): IdpKind {
  return IDP_KINDS.find((k) => k.type === type && k.preset === preset)?.id ?? (type === 'saml' ? 'saml' : 'oidc')
}

/** Stored auth.sso_providers (JSON text or array) → raw entries (tolerant). */
export function parseStoredIdps(value: unknown): Array<Record<string, unknown>> {
  let list = value
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch { return [] }
  }
  return Array.isArray(list) ? list.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && typeof (x as Record<string, unknown>).id === 'string') : []
}

export function summariseIdp(raw: Record<string, unknown>): IdpSummary {
  const s = (k: string) => (typeof raw[k] === 'string' && raw[k] ? (raw[k] as string) : null)
  const type = raw.type === 'saml' ? 'saml' : 'oidc'
  const preset = s('preset') ?? 'generic'
  const kind = kindOf(type, preset)
  const secret = s('clientSecret')
  const domains = Array.isArray(raw.allowedDomains) ? raw.allowedDomains.map(String) : typeof raw.allowedDomains === 'string' ? raw.allowedDomains.split(/[\s,]+/).filter(Boolean) : []
  return {
    id: String(raw.id), type, preset, kind, name: s('name'),
    where: s('issuer') ?? (s('tenantId') ? `tenant ${s('tenantId')}` : null) ?? (s('baseUrl') ? `${s('baseUrl')}${s('realm') ? ` (realm ${s('realm')})` : ''}` : null) ?? s('domain') ?? s('metadataUrl'),
    clientId: s('clientId'), hasSecret: Boolean(secret), secretRef: secret?.startsWith('secret://') ? secret : null,
    allowedDomains: domains, defaultOrg: s('defaultOrg'), defaultRole: s('defaultRole'),
    form: {
      kind, id: String(raw.id), name: s('name') ?? undefined, tenantId: s('tenantId') ?? undefined, domain: s('domain') ?? undefined,
      baseUrl: s('baseUrl') ?? undefined, realm: s('realm') ?? undefined, issuer: s('issuer') ?? undefined, metadataUrl: s('metadataUrl') ?? undefined,
      clientId: s('clientId') ?? undefined, allowedDomains: domains.join(', ') || undefined, defaultOrg: s('defaultOrg') ?? undefined, defaultRole: s('defaultRole') ?? undefined,
    },
  }
}

/** Replace (or add) one entry, keeping the order. */
export function upsertIdp(list: Array<Record<string, unknown>>, entry: Record<string, unknown>): Array<Record<string, unknown>> {
  const i = list.findIndex((x) => x.id === entry.id)
  if (i === -1) return [...list, entry]
  const next = [...list]
  next[i] = entry
  return next
}

export const SUPPORTED_PRESETS = { oidc: OIDC_PRESETS, saml: SAML_PRESETS }

/** Redirect URIs to register at the IdP for an entry. */
export function idpRedirects(appUrl: string, idp: { id: string; type: 'oidc' | 'saml' }): Array<{ label: string; value: string }> {
  const base = appUrl.replace(/\/+$/, '')
  return idp.type === 'oidc'
    ? [{ label: 'Redirect URI', value: `${base}/auth/sso/${idp.id}/callback` }]
    : [
      { label: 'Identifier (entity id) / metadata', value: `${base}/auth/saml/${idp.id}/metadata` },
      { label: 'Reply URL (ACS)', value: `${base}/auth/saml/${idp.id}/acs` },
    ]
}

// ── Email step ──────────────────────────────────────────────────────────────

/** The email choices the step offers (each is an email provider, SMTP presets fill host / port / TLS). */
export const EMAIL_CHOICES = [
  { id: 'm365', label: 'Microsoft 365 / Exchange Online', provider: 'smtp', defaults: { smtp_host: 'smtp.office365.com', smtp_port: '587', smtp_starttls: 'required' } },
  { id: 'smtp', label: 'Your mail server (SMTP, on-premises Exchange)', provider: 'smtp', defaults: { smtp_port: '587', smtp_starttls: 'opportunistic' } },
  { id: 'resend', label: 'Resend', provider: 'resend', defaults: {} },
  { id: 'azure_communication', label: 'Azure Communication Services', provider: 'azure_communication', defaults: {} },
  { id: 'ses', label: 'Amazon SES', provider: 'ses', defaults: {} },
  { id: 'console', label: 'Not yet: just log emails (testing only)', provider: 'console', defaults: {} },
] as const
export type EmailChoiceId = (typeof EMAIL_CHOICES)[number]['id']

export const emailAddressSchema = z.string().trim().toLowerCase().regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Enter an email address')

/** "a@x.com, b@y.com\nc@z.com" → addresses (deduped) and the invalid parts. */
export function parseInviteList(raw: string): { emails: string[]; invalid: string[] } {
  const parts = String(raw ?? '').split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean)
  const emails: string[] = []
  const invalid: string[] = []
  for (const part of parts) {
    const parsed = emailAddressSchema.safeParse(part)
    if (parsed.success) { if (!emails.includes(parsed.data)) emails.push(parsed.data) } else invalid.push(part)
  }
  return { emails, invalid }
}

/** The address people should use vs. the one configured (APP_URL). */
export interface AddressCheck {
  configured: string | null
  opened: string | null
  status: 'ok' | 'warn' | 'fail'
  messages: string[]
}

export function checkAddress(configured: string | null | undefined, opened: string | null | undefined): AddressCheck {
  const messages: string[] = []
  const conf = configured?.trim().replace(/\/+$/, '') || null
  const open = opened?.trim().replace(/\/+$/, '') || null
  let status: AddressCheck['status'] = 'ok'
  const isLocal = (u: string) => /^https?:\/\/(localhost|127\.|\[::1\])/i.test(u)
  if (!conf) {
    status = 'fail'
    messages.push('APP_URL is not set. Links in emails (invitations, password resets) need it: set APP_URL to the address people open, then restart UserTasks.')
  } else {
    if (open && conf.toLowerCase() !== open.toLowerCase()) {
      status = 'warn'
      messages.push(`You opened ${open}, but APP_URL is ${conf}. Links in emails and SSO redirects use APP_URL: if people should use ${open}, change APP_URL and restart.`)
    }
    if (/^http:\/\//i.test(conf) && !isLocal(conf)) {
      status = 'warn'
      messages.push('The address uses plain http on a network: passwords and sign-in cookies travel unencrypted. Put HTTPS in front (a reverse proxy or the installer\'s HTTPS option).')
    }
    if (isLocal(conf)) messages.push('APP_URL is a local address: fine on this computer, but other people can\'t open it. Change it to the server\'s name when you share UserTasks.')
  }
  if (!messages.length) messages.push(`People open UserTasks at ${conf}.`)
  return { configured: conf, opened: open, status, messages }
}
