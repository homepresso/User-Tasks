/**
 * The form sign-in page: what a visitor sees when a form link
 * (/f/<id>, /form/<system name>) needs them to sign in. One design per
 * workspace, stored in tenants.settings.forms.sign_in (no table of its own;
 * Settings → Forms → Form sign-in page, REST /workspace/form-sign-in-page,
 * MCP form_sign_in_page_get / _update, `usertasks form-sign-in-page`).
 *
 * Pure and isomorphic: the settings card, the page, the service and the API
 * schema all use it. Every field is safe to show to a visitor who isn't
 * signed in — the page is rendered on the server from exactly these fields
 * plus the workspace's name.
 */

export const SIGN_IN_DESIGN_COUNT = 10

export interface SignInDesign {
  id: number
  key: string
  name: string
  description: string
}

/** The ten designs (components/forms/sign-in/form-sign-in-layout.tsx draws them). */
export const SIGN_IN_DESIGNS: readonly SignInDesign[] = [
  { id: 1, key: 'centered', name: 'UserTasks', description: 'The default: the UserTasks sign-in look, a brand panel beside a clean form.' },
  { id: 2, key: 'split', name: 'Split screen', description: 'Your brand on a coloured panel, sign-in beside it.' },
  { id: 3, key: 'minimal', name: 'Minimal', description: 'No card: a clean column on white.' },
  { id: 4, key: 'gradient', name: 'Gradient', description: 'A card over a gradient of your accent colour.' },
  { id: 5, key: 'rail', name: 'Brand rail', description: 'A slim coloured rail with your logo down the side.' },
  { id: 6, key: 'glass', name: 'Glass', description: 'A frosted card over a full-bleed pattern.' },
  { id: 7, key: 'banner', name: 'Top banner', description: 'A coloured banner with the card overlapping it.' },
  { id: 8, key: 'dark', name: 'Dark elegant', description: 'Dark, quiet and premium, with an accent glow.' },
  { id: 9, key: 'soft', name: 'Soft shapes', description: 'Friendly pastel shapes behind a rounded card.' },
  { id: 10, key: 'compact', name: 'Compact', description: 'Small and tight: made for forms embedded in a page.' },
]

export const SIGN_IN_LIMITS = {
  heading: 80,
  subheading: 300,
  button_label: 40,
  footer_text: 300,
  support_link_label: 60,
  support_link_url: 500,
} as const

export interface FormSignInSettings {
  /** 1–10 (SIGN_IN_DESIGNS). */
  design: number
  /** An upload in this workspace's logos storage (logos/<tenant>/form-sign-in.<ext>), or null for the workspace name. */
  logo_url: string | null
  heading: string
  subheading: string
  button_label: string
  /** Small print under the form; empty for none. */
  footer_text: string
  /** Optional help link under the form (https: or mailto:). */
  support_link_label: string
  support_link_url: string | null
  /** #rrggbb; null is the UserTasks default (ink). Ignored while use_workspace_theme is on. */
  accent_color: string | null
  /**
   * Draw the page in the workspace theme (colours, surfaces, text, radius,
   * fonts, light / dark mode and canvas) instead of the UserTasks defaults
   * and the accent colour. The design, logo and wording still apply.
   */
  use_workspace_theme: boolean
}

export const DEFAULT_SIGN_IN_SETTINGS: FormSignInSettings = Object.freeze({
  design: 1,
  logo_url: null,
  heading: 'Sign in to continue',
  subheading: 'This form is for members of the workspace. Sign in to open it.',
  button_label: 'Sign in',
  footer_text: '',
  support_link_label: '',
  support_link_url: null,
  accent_color: null,
  use_workspace_theme: false,
}) as FormSignInSettings

/** The UserTasks accent (the brand ink, the default theme's primary) when the setting gives none. */
export const PLATFORM_ACCENT = '#17150f'

const HEX_RE = /^#[0-9a-f]{6}$/i

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isSignInDesign(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= SIGN_IN_DESIGN_COUNT
}

export function signInDesign(id: number): SignInDesign {
  return SIGN_IN_DESIGNS.find((d) => d.id === id) ?? SIGN_IN_DESIGNS[0]
}

/** A support link: https:// (or http:// on a local install) or mailto:, nothing else. */
export function isSupportLinkUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > SIGN_IN_LIMITS.support_link_url) return false
  if (/[\s<>"'`]/.test(value)) return false
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(value)) return true
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

/** Plain text: control characters dropped, whitespace trimmed. */
function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : ''
}

/**
 * The stored setting, normalised (lenient: anything invalid falls back to
 * its default, so a bad stored value never breaks the page). Logo URLs are
 * checked by the service when written; here only the shape is kept.
 */
export function parseFormSignInSettings(raw: unknown): FormSignInSettings {
  const src = isObject(raw) ? raw : {}
  const text = (key: keyof typeof SIGN_IN_LIMITS & keyof FormSignInSettings, fallback: string) => {
    const v = clean(src[key])
    return v && v.length <= SIGN_IN_LIMITS[key] ? v : fallback
  }
  const optionalText = (key: 'footer_text' | 'support_link_label') => {
    const v = clean(src[key])
    return v.length <= SIGN_IN_LIMITS[key] ? v : ''
  }
  const logo = typeof src.logo_url === 'string' && src.logo_url.length > 0 && src.logo_url.length <= 500 ? src.logo_url : null
  return {
    design: isSignInDesign(src.design) ? src.design : DEFAULT_SIGN_IN_SETTINGS.design,
    logo_url: logo,
    heading: text('heading', DEFAULT_SIGN_IN_SETTINGS.heading),
    subheading: text('subheading', DEFAULT_SIGN_IN_SETTINGS.subheading),
    button_label: text('button_label', DEFAULT_SIGN_IN_SETTINGS.button_label),
    footer_text: optionalText('footer_text'),
    support_link_label: optionalText('support_link_label'),
    support_link_url: isSupportLinkUrl(src.support_link_url) ? src.support_link_url : null,
    accent_color: typeof src.accent_color === 'string' && HEX_RE.test(src.accent_color) ? src.accent_color.toLowerCase() : null,
    use_workspace_theme: src.use_workspace_theme === true,
  }
}

/** tenants.settings → the form sign-in page settings (settings.forms.sign_in). */
export function signInSettingsFromTenantSettings(settings: unknown): FormSignInSettings {
  const forms = isObject(settings) && isObject(settings.forms) ? settings.forms : {}
  return parseFormSignInSettings((forms as Record<string, unknown>).sign_in)
}

const KEYS = Object.keys(DEFAULT_SIGN_IN_SETTINGS) as Array<keyof FormSignInSettings>

/**
 * Why a change (PATCH: only the keys to change) can't be saved, or null.
 * Strict, unlike parseFormSignInSettings: the API and the settings card say
 * what is wrong instead of quietly dropping it. `logo_url` is checked
 * against the workspace's storage by the service.
 */
export function formSignInInputProblem(input: unknown): string | null {
  if (!isObject(input)) return 'Settings must be an object.'
  for (const key of Object.keys(input)) {
    if (!(KEYS as string[]).includes(key)) return `Unknown setting "${key}".`
  }
  const v = input as Partial<Record<keyof FormSignInSettings, unknown>>
  if (v.design !== undefined && !isSignInDesign(v.design)) return `design must be a whole number from 1 to ${SIGN_IN_DESIGN_COUNT}.`
  const required: Array<['heading' | 'button_label', string]> = [['heading', 'Heading'], ['button_label', 'Button label']]
  for (const [key, label] of required) {
    if (v[key] === undefined) continue
    if (typeof v[key] !== 'string' || !clean(v[key])) return `${label} can't be empty.`
    if (clean(v[key]).length > SIGN_IN_LIMITS[key]) return `${label} must be at most ${SIGN_IN_LIMITS[key]} characters.`
  }
  const optional: Array<['subheading' | 'footer_text' | 'support_link_label', string]> = [['subheading', 'Subheading'], ['footer_text', 'Footer text'], ['support_link_label', 'Support link label']]
  for (const [key, label] of optional) {
    if (v[key] === undefined) continue
    if (typeof v[key] !== 'string') return `${label} must be text.`
    if (clean(v[key]).length > SIGN_IN_LIMITS[key]) return `${label} must be at most ${SIGN_IN_LIMITS[key]} characters.`
  }
  if (v.support_link_url !== undefined && v.support_link_url !== null && v.support_link_url !== '' && !isSupportLinkUrl(v.support_link_url)) {
    return 'Support link must be an https:// or mailto: address.'
  }
  if (v.accent_color !== undefined && v.accent_color !== null && v.accent_color !== '' && !(typeof v.accent_color === 'string' && HEX_RE.test(v.accent_color))) {
    return 'Accent colour must be a hex colour like #4f46e5.'
  }
  if (v.use_workspace_theme !== undefined && typeof v.use_workspace_theme !== 'boolean') return 'use_workspace_theme must be true or false.'
  if (v.logo_url !== undefined && v.logo_url !== null && v.logo_url !== '' && (typeof v.logo_url !== 'string' || v.logo_url.length > 500)) {
    return 'logo_url must be an uploaded logo.'
  }
  return null
}

/** Apply a validated change to the current settings ('' clears the optional ones). */
export function applyFormSignInPatch(current: FormSignInSettings, input: Record<string, unknown>): FormSignInSettings {
  const next: Record<string, unknown> = { ...current }
  for (const key of KEYS) {
    if (input[key] === undefined) continue
    const value = input[key]
    next[key] = value === '' && (key === 'logo_url' || key === 'support_link_url' || key === 'accent_color') ? null : value
  }
  return parseFormSignInSettings(next)
}

/* ── Colours ─────────────────────────────────────────────────────────── */

function channel(hex: string, i: number): number {
  return parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
}

function luminance(hex: string): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(channel(hex, 0)) + 0.7152 * lin(channel(hex, 1)) + 0.0722 * lin(channel(hex, 2))
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/** Mix a hex colour towards black (amount < 0) or white (amount > 0). */
export function shade(hex: string, amount: number): string {
  const target = amount < 0 ? 0 : 255
  const t = Math.min(Math.abs(amount), 1)
  const out = [0, 1, 2].map((i) => Math.round(channel(hex, i) * 255 + (target - channel(hex, i) * 255) * t))
  return `#${out.map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

export interface SignInColors {
  /** The accent (buttons, panels). */
  accent: string
  /** Text on the accent: white or ink, whichever reads better. */
  onAccent: string
  /** The accent as text / links on white (darkened until it reaches 4.5:1). */
  accentInk: string
  /** The accent as text on a dark (#0b0f19) background (lightened until 4.5:1). */
  accentOnDark: string
  /** A deeper tone for gradients. */
  accentDeep: string
}

const INK = '#111827'
const DARK_BG = '#0b0f19'

/** The colours a design uses, from the accent, every pairing legible (WCAG AA). */
export function signInColors(accent: string | null | undefined, fallback: string = PLATFORM_ACCENT): SignInColors {
  const base = typeof accent === 'string' && HEX_RE.test(accent) ? accent.toLowerCase() : HEX_RE.test(fallback) ? fallback.toLowerCase() : PLATFORM_ACCENT
  const onAccent = contrast(base, '#ffffff') >= contrast(base, INK) ? '#ffffff' : INK
  let ink = base
  for (let i = 1; i <= 10 && contrast(ink, '#ffffff') < 4.5; i++) ink = shade(base, -i / 10)
  let onDark = base
  for (let i = 1; i <= 10 && contrast(onDark, DARK_BG) < 4.5; i++) onDark = shade(base, i / 10)
  return { accent: base, onAccent, accentInk: ink, accentOnDark: onDark, accentDeep: shade(base, -0.45) }
}

/* ── The return path ─────────────────────────────────────────────────── */

/** The sign-in page of form links (app/form-login). */
export const FORM_LOGIN_PATH = '/form-login'

/**
 * Where /form-login may send someone back to: a form link on this same
 * host — /f/<id> or /form/<system name>, with its query — and nothing else.
 * Anything absolute, protocol-relative, backslashed, with control
 * characters or pointing elsewhere in the app is refused (null).
 */
export function sanitizeFormReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const p = raw.trim()
  if (!p || p.length > 2000) return null
  if (!/^\/(?![/\\])/.test(p)) return null
  if (/[\u0000-\u001F\u007F\\]/.test(p) || p.includes('://')) return null
  if (!/^\/(?:f|form)\/[A-Za-z0-9._~%-]+(?:\?[^#]*)?$/.test(p)) return null
  // No dot segments after decoding (/f/%2e%2e).
  try {
    const decoded = decodeURIComponent(p.split('?')[0])
    if (/(^|\/)\.\.?(\/|$)/.test(decoded) || decoded.includes('/', 3 + (decoded.startsWith('/form/') ? 3 : 0))) return null
  } catch {
    return null
  }
  return p
}

/** /form-login?redirect=<form path>[&embed=1]. */
export function formLoginUrl(returnPath: string, options: { embed?: boolean } = {}): string {
  const safe = sanitizeFormReturnPath(returnPath)
  const params = new URLSearchParams()
  if (safe) params.set('redirect', safe)
  if (options.embed) params.set('embed', '1')
  const qs = params.toString()
  return qs ? `${FORM_LOGIN_PATH}?${qs}` : FORM_LOGIN_PATH
}

/** The form id of a /f/<uuid> return path (to find its workspace), else null. */
export function formIdOfReturnPath(path: string | null): string | null {
  const m = /^\/f\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?|$)/i.exec(path ?? '')
  return m ? m[1].toLowerCase() : null
}

/** The sign-in page's message for an `?error=` code (server and client safe). */
const ERROR_MESSAGES: Record<string, string> = {
  auth_callback_error: 'Sign-in could not be completed. Please try again.',
  sso_failed: 'Single sign-on failed. Please try again, or contact your administrator.',
  sso_unavailable: 'That sign-in option is not available.',
  no_invite: "You don't have an invitation to this organisation. Ask an admin to invite you.",
}

export function signInErrorMessage(code: string | null | undefined): string | null {
  return code ? ERROR_MESSAGES[code] ?? null : null
}
