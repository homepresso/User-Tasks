/**
 * Anonymous forms (client-safe part): the per-form options, the platform
 * limits they must stay within, the workspace switch as the browser sees it,
 * and the designer's readiness report (what an anonymous visitor would NOT
 * get from this form). The server side — tokens, the anonymous context, the
 * allowlist, abuse protection — is lib/services/anonymous-forms.ts.
 */

import { isPlainObject } from '@/lib/utils/guards'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { layoutFormRules, conditionPaths } from './form-rules'
import { allActions, isServerRuleAction } from './field-buttons'
import { normalizeFormButtons } from './buttons'
import { anonymousDynamicSources } from './dynamic-values'

/** Path of an anonymous form page. */
export const ANONYMOUS_PATH_PREFIX = '/p/'

/** A public link token: 32 random bytes, base64url (43 chars). */
export const ANONYMOUS_TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/

/** The honeypot input's name: people never see it; bots fill it in. */
export const HONEYPOT_FIELD = 'contact_website'

/** Platform limits: a form's options are clamped into these. */
export const ANONYMOUS_LIMITS = {
  perIpPerMinute: { min: 1, max: 60, default: 10 },
  dailyCap: { min: 1, max: 10_000, default: 500 },
  minFillSeconds: { min: 0, max: 120, default: 3 },
  maxUploadMb: { min: 1, max: 4, default: 2 },
  maxFiles: { min: 1, max: 10, default: 3 },
  /** Request body of a submission (JSON). */
  submitBodyBytes: 256_000,
  /** Requests to a form's lookups / tables / server steps per IP per minute. */
  readsPerIpPerMinute: 60,
  /** Data table pages and lookup results served to anonymous visitors. */
  maxPageSize: 25,
  maxLookupResults: 20,
  /** A rendered page's ticket is good for this long. */
  ticketMaxAgeMs: 24 * 60 * 60 * 1000,
} as const

/** File types an anonymous visitor may upload (also within the field's own list). */
export const ANONYMOUS_UPLOAD_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'csv'] as const

export interface AnonymousFormSettings {
  /** Submissions per IP per minute (this form). */
  per_ip_per_minute: number
  /** Anonymous submissions per rolling 24 hours (this form). */
  daily_cap: number
  /** Seconds between opening the page and submitting (bots submit instantly). */
  min_fill_seconds: number
  /** Attachments fields accept anonymous uploads. */
  uploads: boolean
  max_upload_mb: number
  /** Files per submission (all fields). */
  max_files: number
  /** Let search engines index the page (default: noindex). */
  allow_indexing: boolean
  /**
   * "Allow friendly public link": visitors who are not signed in may also open
   * the form at /form/<system name> on the workspace address (default off — a
   * system name is guessable, the /p/ token is not).
   */
  allow_friendly_link: boolean
}

export const DEFAULT_ANONYMOUS_SETTINGS: AnonymousFormSettings = {
  per_ip_per_minute: ANONYMOUS_LIMITS.perIpPerMinute.default,
  daily_cap: ANONYMOUS_LIMITS.dailyCap.default,
  min_fill_seconds: ANONYMOUS_LIMITS.minFillSeconds.default,
  uploads: false,
  max_upload_mb: ANONYMOUS_LIMITS.maxUploadMb.default,
  max_files: ANONYMOUS_LIMITS.maxFiles.default,
  allow_indexing: false,
  allow_friendly_link: false,
}

function clampInt(value: unknown, range: { min: number; max: number; default: number }): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  if (!Number.isFinite(n)) return range.default
  return Math.min(range.max, Math.max(range.min, Math.round(n)))
}

/** Stored / submitted options → clean options (unknown keys dropped, numbers clamped to the platform limits). */
export function normalizeAnonymousSettings(raw: unknown): AnonymousFormSettings {
  const src = isPlainObject(raw) ? raw : {}
  return {
    per_ip_per_minute: clampInt(src.per_ip_per_minute, ANONYMOUS_LIMITS.perIpPerMinute),
    daily_cap: clampInt(src.daily_cap, ANONYMOUS_LIMITS.dailyCap),
    min_fill_seconds: clampInt(src.min_fill_seconds, ANONYMOUS_LIMITS.minFillSeconds),
    uploads: src.uploads === true,
    max_upload_mb: clampInt(src.max_upload_mb, ANONYMOUS_LIMITS.maxUploadMb),
    max_files: clampInt(src.max_files, ANONYMOUS_LIMITS.maxFiles),
    allow_indexing: src.allow_indexing === true,
    allow_friendly_link: src.allow_friendly_link === true,
  }
}

export type CaptchaProvider = 'turnstile' | 'hcaptcha'

/** The workspace's anonymous-forms settings as admins and the designer see them (never the secret). */
export interface AnonymousWorkspaceView {
  enabled: boolean
  captcha: { provider: CaptchaProvider | null; site_key: string | null; has_secret: boolean }
}

/* ── Designer readiness ──────────────────────────────────────────────── */

export interface AnonymousReadiness {
  /** {{user.*}} placeholders (or rule conditions on user.*): empty for anonymous visitors. */
  user_placeholders: boolean
  /** Lookups / Data tables: whether "Allow anonymous read" is on. */
  sources: Array<{ key: string; label: string; kind: 'lookup' | 'data_table' | 'dynamic'; allowed: boolean; prop?: string }>
  /** Server steps (rules, in-form buttons, bar buttons, After submit): whether "Allow for anonymous" is on. */
  server_actions: Array<{ where: string; type: string; allowed: boolean }>
  /** Attachments fields (need the form's "Allow uploads"). */
  attachments: Array<{ key: string; label: string }>
  /** Custom controls asking for lookup / files / reports / network: those capabilities are off for anonymous visitors. */
  controls: Array<{ key: string; label: string; capabilities: string[] }>
  /** People pickers: anonymous visitors can't search the directory. */
  people: Array<{ key: string; label: string }>
}

function label(field: TaskFieldDef): string {
  return field.label || field.key
}

/** What an anonymous visitor would not get from this saved form (the designer's warnings). */
export function anonymousReadiness(def: { fields: TaskFieldDef[]; layout?: unknown; buttons?: unknown; header?: unknown }): AnonymousReadiness {
  const out: AnonymousReadiness = { user_placeholders: false, sources: [], server_actions: [], attachments: [], controls: [], people: [] }
  const text = JSON.stringify([def.fields, def.layout ?? null, def.buttons ?? null, def.header ?? null])
  out.user_placeholders = /\{\{\s*user\./.test(text) || layoutFormRules(def.layout).some((r) => conditionPaths(r.if).some((p) => p.startsWith('user.')))
  for (const field of def.fields) {
    if (field.type === 'lookup' && field.lookup) out.sources.push({ key: field.key, label: label(field), kind: 'lookup', allowed: field.lookup.anonymous_read === true })
    if (field.type === 'data_table' && field.data_table) out.sources.push({ key: field.key, label: label(field), kind: 'data_table', allowed: field.data_table.anonymous_read === true })
    // Dynamic properties from a data table / API reference (lib/forms/dynamic-values.ts): each binding's own switch.
    for (const s of anonymousDynamicSources([field])) out.sources.push({ key: field.key, label: label(field), kind: 'dynamic', allowed: s.allowed, prop: s.prop })
    if (field.type === 'attachments') out.attachments.push({ key: field.key, label: label(field) })
    if (field.type === 'user') out.people.push({ key: field.key, label: label(field) })
    if (field.type === 'custom') {
      const caps = field.custom?.capabilities ?? []
      if (caps.length) out.controls.push({ key: field.key, label: label(field), capabilities: [...caps] })
    }
    if (field.type === 'button' && field.button) {
      for (const a of allActions(field.button.actions)) {
        if (isServerRuleAction(a)) out.server_actions.push({ where: `Button "${label(field)}"`, type: a.type, allowed: a.allow_anonymous === true })
      }
    }
  }
  for (const rule of layoutFormRules(def.layout)) {
    if (rule.disabled) continue
    for (const a of allActions(rule.then)) {
      if (isServerRuleAction(a)) out.server_actions.push({ where: `Rule "${rule.name || rule.id}"`, type: a.type, allowed: a.allow_anonymous === true })
    }
  }
  for (const button of normalizeFormButtons(def.buttons ?? null)) {
    for (const a of button.actions ?? []) {
      if (a.type === 'start_workflow' || a.type === 'apply_table_changes') out.server_actions.push({ where: `"${button.label}" button`, type: a.type, allowed: a.allow_anonymous === true })
    }
  }
  return out
}

/** The readiness report as plain warnings (designer, docs, API). */
export function anonymousWarnings(r: AnonymousReadiness, settings: Pick<AnonymousFormSettings, 'uploads'>): string[] {
  const out: string[] = []
  if (r.user_placeholders) out.push('{{user.*}} placeholders resolve to empty for anonymous visitors.')
  for (const s of r.sources.filter((x) => !x.allowed)) {
    out.push(s.kind === 'dynamic'
      ? `"${s.label}": the source of its dynamic ${s.prop ?? 'property'} is not readable by anonymous visitors, so it resolves empty: turn on "Allow anonymous read" on that binding.`
      : `"${s.label}" (${s.kind === 'lookup' ? 'lookup' : 'Data table'}) shows nothing to anonymous visitors: turn on "Allow anonymous read" on the field.`)
  }
  for (const s of r.sources.filter((x) => x.allowed)) out.push(s.kind === 'dynamic' ? `"${s.label}": the source of its dynamic ${s.prop ?? 'property'} is readable by anyone with the link (its declared columns, within its filter).` : `"${s.label}" is readable by anyone with the link (its declared columns, within its filters).`)
  for (const a of r.server_actions.filter((x) => !x.allowed)) out.push(`${a.where}: "${a.type}" is skipped for anonymous visitors (tick "Allow for anonymous" to run it).`)
  for (const a of r.server_actions.filter((x) => x.allowed)) out.push(`${a.where}: "${a.type}" runs for anyone with the link.`)
  if (r.attachments.length && !settings.uploads) out.push(`Uploads are off: ${r.attachments.map((a) => `"${a.label}"`).join(', ')} can't take files from anonymous visitors.`)
  for (const c of r.controls) out.push(`Custom control "${c.label}" runs without its ${c.capabilities.join(', ')} capabilities for anonymous visitors.`)
  for (const p of r.people) out.push(`People picker "${p.label}" can't search your directory for anonymous visitors.`)
  return out
}

/** The public link of a token. */
export function anonymousFormPath(token: string): string {
  return `${ANONYMOUS_PATH_PREFIX}${token}`
}
