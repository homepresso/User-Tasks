/**
 * Anonymous forms: a reusable form filled in by visitors who are not signed
 * in, through an unguessable public link (/p/<token>).
 *
 * Threat model (docs/forms.md "Anonymous forms" has the long version):
 *  - The visitor is untrusted and unauthenticated. The ONLY thing they hold
 *    is the link token (32 random bytes, base64url). Form ids never appear
 *    in the link, so forms can't be enumerated; a wrong, rotated or disabled
 *    token, a form whose anonymous mode is off, or a workspace whose
 *    "Allow anonymous forms" switch is off all answer the same 404.
 *  - Everything is decided on the server from the SAVED form and its
 *    form_anonymous_access row (service role, explicit tenant filters):
 *    the tenant is the form's, the actor is nobody (actorId null, authKind
 *    'anonymous'), the permissions are forms.submit alone. Nothing the
 *    request carries (form ids, field definitions, __form_state, params,
 *    variables, control state) can widen that: every endpoint resolves the
 *    token first and the services re-check `ctx.anonymous.formId`.
 *  - Allowlist of operations (lib/services/anonymous-forms.ts callers in
 *    app/api/public/forms/[token]/*): render this form; submit it; lookup /
 *    Data table reads ONLY for fields with "Allow anonymous read"; server
 *    steps (API calls, table changes, start workflow) ONLY when ticked
 *    "Allow for anonymous"; uploads ONLY when the form allows them (strict
 *    size / type / count limits, a per-visit upload key). Everything else
 *    (reports, the tile proxy, custom-control capabilities, people search,
 *    drafts, favourites, Home) is not reachable.
 *  - Abuse: per-IP-per-form and per-form-daily limits (the shared cache
 *    provider and Postgres), a honeypot input, a signed render ticket that
 *    enforces a minimum fill time, optional Turnstile / hCaptcha (only when
 *    an admin configured it; never a third-party call otherwise), body size
 *    caps, idempotency keys, and an HMAC'd, truncated IP plus a cut user
 *    agent on each anonymous submission for abuse review.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { supabaseServiceRoleKey } from '@/lib/config/bootstrap'
import {
  ANONYMOUS_LIMITS, ANONYMOUS_TOKEN_RE, DEFAULT_ANONYMOUS_SETTINGS, HONEYPOT_FIELD, anonymousFormPath, anonymousReadiness, anonymousWarnings,
  normalizeAnonymousSettings, type AnonymousFormSettings, type AnonymousReadiness, type AnonymousWorkspaceView, type CaptchaProvider,
} from '@/lib/forms/anonymous'
import { lookupItemKey, lookupLabelKey } from '@/lib/forms/lookup'
import { attachmentsCountKey } from '@/lib/forms/attachments'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'
import { requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, SECRET_PLACEHOLDER, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- form_anonymous_access is not in the generated types */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Injected for tests: the clock, the captcha verifier's fetch, the service client. */
export const anonymousDeps = {
  now: () => Date.now(),
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  serviceClient: async (): Promise<AnySupabaseClient> => (await import('@/lib/cron-auth')).createServiceClient() as AnySupabaseClient,
}

/* ── Secrets, tokens, hashes ─────────────────────────────────────────── */

function serverKey(): Buffer {
  // ENCRYPTION_KEY when set; otherwise the service-role key (lib/config), which every configured server has.
  const base = process.env.ENCRYPTION_KEY || supabaseServiceRoleKey() || ''
  if (!base) throw new ServiceError('internal', 'Anonymous forms need a server secret (ENCRYPTION_KEY)')
  return createHmac('sha256', base).update('usertasks:anonymous-forms:v1').digest()
}

/** A new public link token: 32 random bytes, base64url (43 characters). */
export function newAnonymousToken(): string {
  return randomBytes(32).toString('base64url')
}

/** The visitor's IP as stored and rate-limited: an HMAC (server secret), 16 hex chars. Never the IP itself. */
export function hashIp(ip: string): string {
  return createHmac('sha256', serverKey()).update(`ip:${ip.trim().toLowerCase()}`).digest('hex').slice(0, 16)
}

/** sha256 of a per-visit upload key (the browser keeps the key; the server keeps the hash). */
export function uploadSessionOf(key: unknown): string | null {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(key)) return null
  return createHash('sha256').update(key).digest('hex')
}

/** A render ticket: when the page was served, signed for this form (minimum fill time, replay window). */
export function issueTicket(formId: string, at: number = anonymousDeps.now()): string {
  const sig = createHmac('sha256', serverKey()).update(`ticket:${formId}:${at}`).digest('base64url').slice(0, 32)
  return `${at.toString(36)}.${sig}`
}

/** The ticket's age in ms, or null when it is forged, for another form, from the future or too old. */
export function ticketAge(formId: string, ticket: unknown, now: number = anonymousDeps.now()): number | null {
  if (typeof ticket !== 'string' || ticket.length > 80) return null
  const [rawAt, sig] = ticket.split('.')
  const at = parseInt(rawAt ?? '', 36)
  if (!Number.isFinite(at) || !sig) return null
  const expected = Buffer.from(issueTicket(formId, at).split('.')[1])
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  const age = now - at
  if (age < -5_000 || age > ANONYMOUS_LIMITS.ticketMaxAgeMs) return null
  return Math.max(0, age)
}

/* ── Workspace settings (tenants.settings.forms.anonymous) ───────────── */

interface StoredWorkspace {
  enabled: boolean
  captcha: { provider: CaptchaProvider | null; site_key: string | null; secret: string | null }
}

function parseWorkspace(settings: unknown): StoredWorkspace {
  const forms = isPlainObject(settings) && isPlainObject(settings.forms) ? settings.forms : {}
  const raw = isPlainObject(forms.anonymous) ? forms.anonymous : {}
  const captcha = isPlainObject(raw.captcha) ? raw.captcha : {}
  const provider = captcha.provider === 'turnstile' || captcha.provider === 'hcaptcha' ? captcha.provider : null
  return {
    enabled: raw.enabled === true,
    captcha: {
      provider,
      site_key: provider && typeof captcha.site_key === 'string' && captcha.site_key ? captcha.site_key : null,
      secret: provider && typeof captcha.secret === 'string' && captcha.secret ? captcha.secret : null,
    },
  }
}

function presentWorkspace(w: StoredWorkspace): AnonymousWorkspaceView {
  return { enabled: w.enabled, captcha: { provider: w.captcha.provider, site_key: w.captcha.site_key, has_secret: Boolean(w.captcha.secret) } }
}

async function readWorkspace(db: AnySupabaseClient, tenantId: string): Promise<StoredWorkspace> {
  const { data } = await (db as any).from('tenants').select('settings').eq('id', tenantId).maybeSingle()
  return parseWorkspace(data?.settings)
}

/** The workspace switch and bot protection (never the secret). Any member: the designer shows whether anonymous forms are allowed. */
export async function getAnonymousWorkspaceSettings(ctx: ServiceContext): Promise<AnonymousWorkspaceView> {
  const db = await serviceRoleClient(ctx)
  return presentWorkspace(await readWorkspace(db, ctx.tenantId))
}

export interface AnonymousWorkspaceInput {
  enabled?: boolean
  captcha?: { provider?: CaptchaProvider | null; site_key?: string | null; secret?: string | null } | null
}

/**
 * Settings → Forms → "Allow anonymous forms" (settings.edit): the switch and
 * the optional bot protection. The secret is write-only: '' or the
 * placeholder keeps the stored one; it is stored encrypted. Turning the
 * switch off stops every anonymous link of the workspace at once. Audited.
 */
export async function setAnonymousWorkspaceSettings(ctx: ServiceContext, input: AnonymousWorkspaceInput): Promise<AnonymousWorkspaceView> {
  requirePerm(ctx, 'settings.edit')
  if (!isPlainObject(input)) throw ServiceError.validation('Settings must be an object')
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('tenants').select('id, settings').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workspace not found')
  const before = parseWorkspace(data.settings)
  const next: StoredWorkspace = { enabled: before.enabled, captcha: { ...before.captcha } }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw ServiceError.validation('enabled must be true or false')
    next.enabled = input.enabled
  }
  if (input.captcha !== undefined) {
    if (input.captcha !== null && !isPlainObject(input.captcha)) throw ServiceError.validation('captcha must be an object')
    const c = input.captcha as NonNullable<AnonymousWorkspaceInput['captcha']> | null
    if (c === null || c.provider === null) {
      next.captcha = { provider: null, site_key: null, secret: null }
    } else {
      const provider = c.provider ?? next.captcha.provider
      if (provider !== 'turnstile' && provider !== 'hcaptcha') throw ServiceError.validation('captcha.provider must be turnstile or hcaptcha')
      const siteKey = c.site_key === undefined ? next.captcha.site_key : typeof c.site_key === 'string' ? c.site_key.trim() : ''
      if (!siteKey || !/^[A-Za-z0-9_.-]{4,200}$/.test(siteKey)) throw ServiceError.validation('captcha.site_key is required (letters, digits, - _ .)')
      let secret = provider === next.captcha.provider ? next.captcha.secret : null
      if (typeof c.secret === 'string' && c.secret.trim() && c.secret !== SECRET_PLACEHOLDER) {
        if (c.secret.length > 500) throw ServiceError.validation('captcha.secret is too long')
        const { encryptSecret } = await import('@/lib/secret-crypto')
        secret = encryptSecret(c.secret.trim())
      }
      if (!secret) throw ServiceError.validation('captcha.secret is required')
      next.captcha = { provider, site_key: siteKey, secret }
    }
  }
  const settings = isPlainObject(data.settings) ? { ...data.settings } : {}
  const forms = isPlainObject(settings.forms) ? { ...settings.forms } : {}
  forms.anonymous = next
  settings.forms = forms
  const { error: writeError } = await (db as any).from('tenants').update({ settings }).eq('id', ctx.tenantId)
  if (writeError) throw dbError(writeError)
  const shown = { before: presentWorkspace(before), after: presentWorkspace(next) }
  if (JSON.stringify(shown.before) !== JSON.stringify(shown.after)) {
    await audit(ctx, {
      objectType: 'workspace', objectId: ctx.tenantId, action: before.enabled !== next.enabled ? 'toggle' : 'update',
      summary: before.enabled !== next.enabled ? (next.enabled ? 'Allowed anonymous forms' : 'Turned off anonymous forms (every public form link stops)') : 'Updated the anonymous forms bot protection',
      diff: { 'forms.anonymous': shown },
    })
  }
  return presentWorkspace(next)
}

/* ── Form settings (form_anonymous_access) ───────────────────────────── */

export interface FormAnonymousAccess {
  form_id: string
  enabled: boolean
  /** The public link token (null until anonymous responses were first turned on). */
  token: string | null
  /** The public link's path (/p/<token>); null without a token. */
  path: string | null
  settings: AnonymousFormSettings
  /** The workspace's "Allow anonymous forms" switch. */
  workspace_enabled: boolean
  /** Bot protection configured for the workspace. */
  captcha: CaptchaProvider | null
  /** Live: anonymous visitors can open the link now. */
  live: boolean
  readiness: AnonymousReadiness
  warnings: string[]
  token_rotated_at: string | null
}

async function loadFormRow(db: AnySupabaseClient, tenantId: string, formId: string) {
  if (!UUID_RE.test(formId)) throw ServiceError.notFound('Form not found')
  const { data, error } = await (db as any).from('forms').select('id, name, fields, layout, buttons, header').eq('id', formId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Form not found')
  return data as Record<string, any>
}

async function loadAccessRow(db: AnySupabaseClient, tenantId: string, formId: string) {
  const { data, error } = await (db as any).from('form_anonymous_access').select('form_id, tenant_id, token, enabled, settings, token_rotated_at').eq('form_id', formId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw dbError(error)
  return (data ?? null) as Record<string, any> | null
}

async function present(db: AnySupabaseClient, tenantId: string, form: Record<string, any>, row: Record<string, any> | null): Promise<FormAnonymousAccess> {
  const workspace = await readWorkspace(db, tenantId)
  const settings = normalizeAnonymousSettings(row?.settings)
  const def = normalizeFormDefinition(form)
  const readiness = anonymousReadiness({ fields: def.fields, layout: def.layout, buttons: def.buttons, header: def.header })
  const enabled = row?.enabled === true
  return {
    form_id: String(form.id),
    enabled,
    token: row?.token ?? null,
    path: row?.token ? anonymousFormPath(row.token) : null,
    settings,
    workspace_enabled: workspace.enabled,
    captcha: workspace.captcha.secret ? workspace.captcha.provider : null,
    live: enabled && workspace.enabled && Boolean(row?.token),
    readiness,
    warnings: anonymousWarnings(readiness, settings),
    token_rotated_at: row?.token_rotated_at ?? null,
  }
}

/** A form's anonymous link and options (forms.view: the designer, the form's URL / QR panel). */
export async function getFormAnonymousAccess(ctx: ServiceContext, formId: string): Promise<FormAnonymousAccess> {
  requirePerm(ctx, 'forms.view')
  const db = await serviceRoleClient(ctx)
  const form = await loadFormRow(db, ctx.tenantId, formId)
  return present(db, ctx.tenantId, form, await loadAccessRow(db, ctx.tenantId, formId))
}

export interface FormAnonymousInput {
  enabled?: boolean
  settings?: Partial<AnonymousFormSettings> | null
}

/**
 * Turn a form's anonymous responses on / off and set its options
 * (forms.edit; turning ON also needs the workspace switch). The first time
 * it is turned on a link token is made. Turning it off stops the link at
 * once (the token is kept, so turning it back on restores the same link —
 * regenerate to revoke it). Audited.
 */
export async function setFormAnonymousAccess(ctx: ServiceContext, formId: string, input: FormAnonymousInput): Promise<FormAnonymousAccess> {
  requirePerm(ctx, 'forms.edit')
  if (!isPlainObject(input)) throw ServiceError.validation('Settings must be an object')
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw ServiceError.validation('enabled must be true or false')
  if (input.settings !== undefined && input.settings !== null && !isPlainObject(input.settings)) throw ServiceError.validation('settings must be an object')
  const db = await serviceRoleClient(ctx)
  const form = await loadFormRow(db, ctx.tenantId, formId)
  const row = await loadAccessRow(db, ctx.tenantId, formId)
  const before = { enabled: row?.enabled === true, settings: normalizeAnonymousSettings(row?.settings) }
  const enabled = input.enabled ?? before.enabled
  if (enabled && !before.enabled) {
    const workspace = await readWorkspace(db, ctx.tenantId)
    if (!workspace.enabled) throw ServiceError.forbidden('Anonymous forms are turned off for this workspace: an admin can allow them in Settings → Forms')
  }
  const settings = input.settings ? normalizeAnonymousSettings({ ...before.settings, ...input.settings }) : before.settings
  const now = new Date(anonymousDeps.now()).toISOString()
  if (row) {
    const { error } = await (db as any).from('form_anonymous_access').update({ enabled, settings, updated_by: ctx.actorId, updated_at: now }).eq('form_id', formId).eq('tenant_id', ctx.tenantId)
    if (error) throw dbError(error)
  } else if (enabled || input.settings) {
    const { error } = await (db as any).from('form_anonymous_access').insert({
      form_id: formId, tenant_id: ctx.tenantId, token: newAnonymousToken(), enabled, settings, created_by: ctx.actorId, updated_by: ctx.actorId,
    })
    if (error) throw dbError(error)
  }
  const changed = before.enabled !== enabled || JSON.stringify(before.settings) !== JSON.stringify(settings)
  if (changed) {
    await audit(ctx, {
      objectType: 'form', objectId: formId, action: before.enabled !== enabled ? 'toggle' : 'update',
      summary: before.enabled !== enabled
        ? (enabled ? `Allowed anonymous responses to form "${form.name}" (public link)` : `Turned off anonymous responses to form "${form.name}" (the public link stops)`)
        : `Updated the anonymous response options of form "${form.name}"`,
      diff: { anonymous: { before, after: { enabled, settings } } },
    })
  }
  return present(db, ctx.tenantId, form, await loadAccessRow(db, ctx.tenantId, formId))
}

/** A new link token (forms.edit): every earlier link of the form stops working at once. Audited. */
export async function regenerateFormAnonymousToken(ctx: ServiceContext, formId: string): Promise<FormAnonymousAccess> {
  requirePerm(ctx, 'forms.edit')
  const db = await serviceRoleClient(ctx)
  const form = await loadFormRow(db, ctx.tenantId, formId)
  const row = await loadAccessRow(db, ctx.tenantId, formId)
  const token = newAnonymousToken()
  const now = new Date(anonymousDeps.now()).toISOString()
  if (row) {
    const { error } = await (db as any).from('form_anonymous_access').update({ token, token_rotated_at: now, updated_by: ctx.actorId, updated_at: now }).eq('form_id', formId).eq('tenant_id', ctx.tenantId)
    if (error) throw dbError(error)
  } else {
    const { error } = await (db as any).from('form_anonymous_access').insert({ form_id: formId, tenant_id: ctx.tenantId, token, enabled: false, settings: DEFAULT_ANONYMOUS_SETTINGS, created_by: ctx.actorId, updated_by: ctx.actorId })
    if (error) throw dbError(error)
  }
  await audit(ctx, { objectType: 'form', objectId: formId, action: 'regenerate_link', summary: `Regenerated the public link of form "${form.name}" (earlier links stop working)` })
  return present(db, ctx.tenantId, form, await loadAccessRow(db, ctx.tenantId, formId))
}

/* ── Resolving a public link ─────────────────────────────────────────── */

export interface ResolvedAnonymousForm {
  formId: string
  tenantId: string
  settings: AnonymousFormSettings
  captcha: { provider: CaptchaProvider; site_key: string; secret: string } | null
}

/**
 * The form behind a public link, or null — for a malformed, unknown or
 * rotated token, a form whose anonymous responses are off, or a workspace
 * whose switch is off (callers answer every case with the same 404).
 */
export async function resolveAnonymousForm(token: unknown): Promise<ResolvedAnonymousForm | null> {
  if (typeof token !== 'string' || !ANONYMOUS_TOKEN_RE.test(token)) return null
  const db = await anonymousDeps.serviceClient()
  const { data: row } = await (db as any).from('form_anonymous_access').select('form_id, tenant_id, token, enabled, settings').eq('token', token).maybeSingle()
  if (!row || row.enabled !== true) return null
  // Constant-time confirmation of the (already indexed) match.
  const a = Buffer.from(String(row.token)); const b = Buffer.from(token)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const workspace = await readWorkspace(db, String(row.tenant_id))
  if (!workspace.enabled) return null
  const { data: form } = await (db as any).from('forms').select('id').eq('id', row.form_id).eq('tenant_id', row.tenant_id).maybeSingle()
  if (!form) return null
  let captcha: ResolvedAnonymousForm['captcha'] = null
  if (workspace.captcha.provider && workspace.captcha.site_key && workspace.captcha.secret) {
    captcha = { provider: workspace.captcha.provider, site_key: workspace.captcha.site_key, secret: workspace.captcha.secret }
  }
  return { formId: String(row.form_id), tenantId: String(row.tenant_id), settings: normalizeAnonymousSettings(row.settings), captcha }
}

/**
 * The dedicated, minimal server context of one anonymous visitor of one
 * resolved link: the form's tenant, no actor, forms.submit only, the
 * service client (every query is tenant-filtered; the services check
 * ctx.anonymous.formId and the per-source / per-action allow flags).
 */
export async function anonymousContext(resolved: ResolvedAnonymousForm, visitor: { ip: string; uploadKey?: unknown }): Promise<ServiceContext> {
  const db = await anonymousDeps.serviceClient()
  return {
    db, supabase: db,
    tenantId: resolved.tenantId,
    actorId: null,
    permissions: new Set(['forms.submit']),
    authKind: 'anonymous',
    source: 'anonymous',
    anonymous: {
      formId: resolved.formId,
      ipHash: hashIp(visitor.ip),
      uploadSession: uploadSessionOf(visitor.uploadKey),
      uploads: { enabled: resolved.settings.uploads, maxBytes: resolved.settings.max_upload_mb * 1024 * 1024, maxFiles: resolved.settings.max_files },
    },
  }
}

/* ── The page payload ────────────────────────────────────────────────── */

export interface AnonymousFormPage {
  form: Awaited<ReturnType<typeof import('./form-submissions').getSubmittableForm>>
  options: Pick<AnonymousFormSettings, 'min_fill_seconds' | 'uploads' | 'max_upload_mb' | 'max_files' | 'allow_indexing'>
  captcha: { provider: CaptchaProvider; site_key: string } | null
  ticket: string
  /** Trusted custom controls of this form (inline rendering), by tag. */
  trusted_controls: string[]
}

/**
 * What /p/<token> renders: the saved form as its own page draws it
 * (definition, resolved theme, buttons, header), the visitor-facing options,
 * the captcha site key (public by design) and a fresh render ticket.
 * Nothing else of the workspace: no users, no navigation, no settings.
 */
export async function getAnonymousFormPage(resolved: ResolvedAnonymousForm): Promise<AnonymousFormPage> {
  const ctx = await anonymousContext(resolved, { ip: 'render' })
  const { getSubmittableForm } = await import('./form-submissions')
  const form = await getSubmittableForm(ctx, resolved.formId)
  const tags = [...new Set(form.fields.filter((f) => f.type === 'custom' && f.custom?.tag).map((f) => f.custom!.tag))]
  let trusted: string[] = []
  if (tags.length) {
    const { data } = await (ctx.supabase as any).from('form_controls').select('tag, trusted, enabled').eq('tenant_id', ctx.tenantId).in('tag', tags)
    trusted = ((data ?? []) as any[]).filter((r) => r.trusted === true && r.enabled !== false).map((r) => String(r.tag))
  }
  const s = resolved.settings
  return {
    form,
    options: { min_fill_seconds: s.min_fill_seconds, uploads: s.uploads, max_upload_mb: s.max_upload_mb, max_files: s.max_files, allow_indexing: s.allow_indexing },
    captcha: resolved.captcha ? { provider: resolved.captcha.provider, site_key: resolved.captcha.site_key } : null,
    ticket: issueTicket(resolved.formId),
    trusted_controls: trusted,
  }
}

/* ── The allowlist: values an anonymous submission may carry ─────────── */

/**
 * The submitted values an anonymous visitor may send: values of fields
 * whose source they can't read (a lookup / Data table without "Allow
 * anonymous read", a custom control answering lookups), people pickers, and
 * attachments when uploads are off are dropped BEFORE any validation — so
 * the server never checks a crafted value against a source the visitor
 * can't see (no existence oracle). Required ones then fail as "required".
 */
export function anonymousSubmittableValues(fields: TaskFieldDef[], values: Record<string, unknown>, uploads: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values }
  const drop = (key: string) => {
    delete out[key]; delete out[lookupItemKey(key)]; delete out[lookupLabelKey(key)]; delete out[attachmentsCountKey(key)]
  }
  for (const field of fields) {
    if (field.type === 'lookup' && field.lookup?.anonymous_read !== true) drop(field.key)
    else if (field.type === 'data_table' && field.data_table?.anonymous_read !== true) drop(field.key)
    else if (field.type === 'user') drop(field.key)
    else if (field.type === 'attachments' && !uploads) drop(field.key)
    else if (field.type === 'custom' && (field.lookup || field.custom?.value_type === 'files')) drop(field.key)
    // Options from a data table / API without "Allow anonymous read": the visitor gets none, so no value is judged against them.
    else if (field.dynamic?.options && field.dynamic.options.kind !== 'expr' && field.dynamic.options.anonymous_read !== true) drop(field.key)
  }
  return out
}

/* ── Abuse protection ────────────────────────────────────────────────── */

export function rateLimitedError(retryAfterMs: number, message = 'Too many submissions — wait a moment and try again'): ServiceError {
  return new ServiceError('rate_limited', message, { details: { retry_after_ms: retryAfterMs } })
}

/** Reads / steps of a public form (lookups, tables, rule steps, uploads): per IP per form. */
export async function limitAnonymousReads(ctx: ServiceContext): Promise<void> {
  if (!ctx.anonymous) return
  const { rateLimit } = await import('@/lib/rate-limit')
  const hit = await rateLimit(`anon-read:${ctx.anonymous.formId}:${ctx.anonymous.ipHash}`, { max: ANONYMOUS_LIMITS.readsPerIpPerMinute, windowMs: 60_000 })
  if (!hit.ok) throw rateLimitedError(hit.retryAfterMs, 'Too many requests — wait a moment and try again')
}

const CAPTCHA_VERIFY: Record<CaptchaProvider, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  hcaptcha: 'https://api.hcaptcha.com/siteverify',
}

/** Server-side captcha check (only called when an admin configured one). */
export async function verifyCaptcha(captcha: NonNullable<ResolvedAnonymousForm['captcha']>, response: unknown, ip: string): Promise<boolean> {
  if (typeof response !== 'string' || !response || response.length > 4096) return false
  const { decryptSecret } = await import('@/lib/secret-crypto')
  const body = new URLSearchParams({ secret: decryptSecret(captcha.secret), response, ...(ip && ip !== 'unknown' ? { remoteip: ip } : {}) })
  try {
    const res = await anonymousDeps.fetch(CAPTCHA_VERIFY[captcha.provider], {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(5_000),
    })
    const json = await res.json().catch(() => null) as { success?: boolean } | null
    return res.ok && json?.success === true
  } catch {
    return false
  }
}

export interface AnonymousSubmitBody {
  values?: Record<string, unknown> | null
  button_id?: string | null
  idempotency_key?: string | null
  params?: Record<string, unknown> | null
  variables?: Record<string, unknown> | null
  ticket?: string | null
  captcha?: string | null
  upload_key?: string | null
  /** The honeypot (HONEYPOT_FIELD): must be empty. */
  hp?: string | null
}

export interface AnonymousVisitor { ip: string; userAgent: string | null }

/**
 * Submit a public form link: resolve the token (404 otherwise), honeypot
 * (a bot gets a plain "Submitted." and nothing is stored), the render
 * ticket's minimum fill time, the captcha when configured, the per-IP and
 * per-form daily limits, then the ordinary submission pipeline as the
 * anonymous context (source 'anonymous', submitted_by null, the IP hash and
 * user agent kept for abuse review). The "Form submitted" trigger runs
 * normally, started via 'anonymous' with no user.
 */
export async function submitAnonymousForm(token: string, body: AnonymousSubmitBody, visitor: AnonymousVisitor) {
  const resolved = await resolveAnonymousForm(token)
  if (!resolved) throw ServiceError.notFound('This form is not available')
  const settings = resolved.settings
  const ctx = await anonymousContext(resolved, { ip: visitor.ip, uploadKey: body.upload_key })
  const ipHash = ctx.anonymous!.ipHash
  const { rateLimit } = await import('@/lib/rate-limit')
  const hit = await rateLimit(`anon-submit:${resolved.formId}:${ipHash}`, { max: settings.per_ip_per_minute, windowMs: 60_000 })
  if (!hit.ok) throw rateLimitedError(hit.retryAfterMs)

  if (typeof body.hp === 'string' && body.hp.trim()) {
    console.warn('[anonymous-forms] honeypot filled', { form_id: resolved.formId, ip_hash: ipHash })
    return { honeypot: true as const, submission: { id: crypto.randomUUID(), created_at: new Date(anonymousDeps.now()).toISOString(), form_id: resolved.formId, form_version: null, button_id: null, outcome: null }, effects: { messages: [{ text: 'Submitted.', tone: 'success' as const }] }, runs: [] }
  }
  const age = ticketAge(resolved.formId, body.ticket)
  if (age === null) throw ServiceError.validation('This page has expired — reload it and try again')
  if (age < settings.min_fill_seconds * 1000) throw ServiceError.validation('That was quick — take a moment to check your answers, then submit again')
  if (resolved.captcha && !(await verifyCaptcha(resolved.captcha, body.captcha, visitor.ip))) {
    throw ServiceError.validation('Please complete the verification and try again', { captcha: true })
  }
  const since = new Date(anonymousDeps.now() - 24 * 3_600_000).toISOString()
  const { count } = await (ctx.supabase as any).from('form_submissions').select('id', { count: 'exact', head: true })
    .eq('tenant_id', resolved.tenantId).eq('form_id', resolved.formId).eq('source', 'anonymous').gte('created_at', since)
  if ((count ?? 0) >= settings.daily_cap) throw rateLimitedError(60 * 60_000, 'This form is not taking more responses today — try again later')

  const { submitForm } = await import('./form-submissions')
  const result = await submitForm(ctx, resolved.formId, {
    values: isPlainObject(body.values) ? body.values : {},
    button_id: typeof body.button_id === 'string' ? body.button_id : null,
    idempotency_key: typeof body.idempotency_key === 'string' ? body.idempotency_key : null,
    params: isPlainObject(body.params) ? body.params : null,
    variables: isPlainObject(body.variables) ? body.variables : null,
  }, { source: 'anonymous', anonymousMeta: { ip_hash: ipHash, user_agent: (visitor.userAgent ?? '').slice(0, 120) || null } })
  return result
}

/** The honeypot input's name (the page renders it; tests read it). */
export { HONEYPOT_FIELD }
