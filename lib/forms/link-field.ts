/**
 * URL fields' link display (`url_config`) — InfoPath's hyperlink with
 * display text. The value stays the URL string (unchanged); read-only views,
 * submissions and summaries show "link text ↗" instead of the raw address.
 *
 * Config `url_config`: {
 *   text_field?: the key of a text field on the form holding the link text,
 *   link_text?: static link text (used when there is no text_field value),
 *   new_tab?: open in a new tab (default true; rel="noopener noreferrer"),
 * }. Without either text the URL itself is shown.
 *
 * Links: http, https and mailto only — the value is validated against these
 * (lib/task-field-schema.ts) and an href is only ever built from one of them
 * (safeLinkHref: entities / control characters removed first), so
 * javascript:, data: and the like never become a link.
 *
 * Pure and isomorphic.
 */

import { safeLinkHref } from '@/lib/html-sanitize'
import { isPlainObject } from '@/lib/utils/guards'

export interface UrlFieldConfig {
  /** Key of a text field whose value is the link text. */
  text_field?: string
  /** Static link text (when the text field is empty or not set). */
  link_text?: string
  /** Open in a new tab (default true). */
  new_tab?: boolean
}

export const URL_LINK_SCHEMES: readonly string[] = ['https', 'http', 'mailto']

const KEY_RE = /^[a-z0-9][a-z0-9_]{0,63}$/
const TEXT_SOURCE_TYPES = new Set(['text', 'textarea', 'label', 'choice', 'email', 'phone'])

export function normalizeUrlConfig(raw: unknown): UrlFieldConfig | undefined {
  if (!isPlainObject(raw)) return undefined
  const out: UrlFieldConfig = {}
  const key = typeof raw.text_field === 'string' ? raw.text_field.trim() : ''
  if (KEY_RE.test(key)) out.text_field = key
  const text = typeof raw.link_text === 'string' ? raw.link_text.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
  if (text) out.link_text = text
  if (raw.new_tab === false) out.new_tab = false
  else if (raw.new_tab === true) out.new_tab = true
  return Object.keys(out).length ? out : undefined
}

/** A designer problem: the text field must be another text field of the form. */
export function urlConfigProblem(selfKey: string, config: UrlFieldConfig | undefined, fields: Array<{ key: string; type: string }>): string | null {
  const key = config?.text_field
  if (!key) return null
  if (key === selfKey) return 'The link text field must be another field'
  const source = fields.find((f) => f.key === key)
  if (!source) return `Link text: "${key}" is not a field of this form`
  if (!TEXT_SOURCE_TYPES.has(source.type)) return `Link text: "${key}" is not a text field`
  return null
}

/** Whether a URL value uses an allowed scheme (http, https, mailto). */
export function isAllowedUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return URL_LINK_SCHEMES.includes(url.protocol.replace(/:$/, ''))
  } catch {
    return false
  }
}

export interface LinkView {
  /** null: not a safe link (shown as text only). */
  href: string | null
  text: string
  newTab: boolean
}

/** How a URL value is shown: its safe href, the link text, new tab or not. Null when there is no value. */
export function urlLink(field: { url_config?: UrlFieldConfig }, value: unknown, values?: Record<string, unknown> | null): LinkView | null {
  const url = typeof value === 'string' ? value.trim() : ''
  if (!url) return null
  const config = field.url_config
  const fromField = config?.text_field ? values?.[config.text_field] : undefined
  const text = (typeof fromField === 'string' || typeof fromField === 'number' ? String(fromField).trim() : '') || config?.link_text || url
  return { href: safeLinkHref(url, URL_LINK_SCHEMES), text: text.slice(0, 500), newTab: config?.new_tab !== false }
}

/** The link as text: "Link text (https://…)" when the text differs from the URL. */
export function urlLinkText(field: { url_config?: UrlFieldConfig }, value: unknown, values?: Record<string, unknown> | null): string {
  const link = urlLink(field, value, values)
  if (!link) return ''
  const url = String(value).trim()
  return link.text === url ? url : `${link.text} (${url})`
}
