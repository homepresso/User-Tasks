/**
 * Text list fields (`type: 'text_list'`): a list of short text items the
 * person adds one per line — InfoPath's bulleted / numbered / plain list
 * (components/forms/text-list-field.tsx).
 *
 * Stored value: string[] (items trimmed, blanks dropped; [] when empty).
 * Coercion takes an array, a JSON array text, or newline-separated text
 * (an API / workflow / imported default).
 *
 * Config `text_list`: { style?: 'bulleted' (default) | 'numbered' | 'plain',
 * min_items?, max_items? (default 50, at most 500), item_max_length?
 * (default 500, at most 5000) }. Required = at least one item.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'

export type TextListStyle = 'bulleted' | 'numbered' | 'plain'
export const TEXT_LIST_STYLES: TextListStyle[] = ['bulleted', 'numbered', 'plain']
export const TEXT_LIST_STYLE_LABELS: Record<TextListStyle, string> = { bulleted: 'Bulleted', numbered: 'Numbered', plain: 'Plain' }

export interface TextListConfig {
  style?: TextListStyle
  min_items?: number
  /** Default 50, at most 500. */
  max_items?: number
  /** Characters per item: default 500, at most 5000. */
  item_max_length?: number
}

export const TEXT_LIST_DEFAULT_MAX_ITEMS = 50
export const TEXT_LIST_MAX_ITEMS = 500
export const TEXT_LIST_DEFAULT_ITEM_LENGTH = 500
export const TEXT_LIST_MAX_ITEM_LENGTH = 5000

function whole(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  return Math.min(Math.max(Math.floor(n), min), max)
}

export function normalizeTextListConfig(raw: unknown): TextListConfig {
  const out: TextListConfig = {}
  if (!isPlainObject(raw)) return out
  if (raw.style === 'numbered' || raw.style === 'plain' || raw.style === 'bulleted') out.style = raw.style
  const min = whole(raw.min_items, 0, TEXT_LIST_MAX_ITEMS)
  const max = whole(raw.max_items, 1, TEXT_LIST_MAX_ITEMS)
  const length = whole(raw.item_max_length, 1, TEXT_LIST_MAX_ITEM_LENGTH)
  if (min) out.min_items = min
  if (max !== undefined) out.max_items = max
  if (length !== undefined) out.item_max_length = length
  return out
}

export function textListLimits(config: TextListConfig | undefined): { min: number; max: number; itemMax: number } {
  return {
    min: config?.min_items ?? 0,
    max: config?.max_items ?? TEXT_LIST_DEFAULT_MAX_ITEMS,
    itemMax: config?.item_max_length ?? TEXT_LIST_DEFAULT_ITEM_LENGTH,
  }
}

export function textListConfigProblem(config: TextListConfig | undefined): string | null {
  const { min, max } = textListLimits(config)
  return min > max ? 'Minimum items is greater than maximum items' : null
}

/** Whether a value has a shape a text list can take (array of scalars, text, or nothing). */
export function isTextListShape(value: unknown): boolean {
  if (value === null || value === undefined || typeof value === 'string') return true
  return Array.isArray(value) && value.every((v) => v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v))
}

/** Any input → the items (trimmed, blanks dropped). */
export function textListItems(value: unknown): string[] {
  let list: unknown[] = []
  if (Array.isArray(value)) list = value
  else if (typeof value === 'string') {
    const s = value.trim()
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s)
        if (Array.isArray(parsed)) list = parsed
      } catch { /* newline text */ }
    }
    if (!list.length) list = s.split(/\r?\n/)
  } else if (typeof value === 'number' || typeof value === 'boolean') list = [value]
  return list
    .filter((v) => v !== null && v !== undefined && typeof v !== 'object')
    .map((v) => String(v).trim())
    .filter(Boolean)
}

/** A problem with a submitted value; null when fine. */
export function textListValueError(field: { label: string; text_list?: TextListConfig }, value: unknown, required: boolean): string | null {
  if (!isTextListShape(value)) return `${field.label} must be a list of text items`
  const items = textListItems(value)
  const { min, max, itemMax } = textListLimits(field.text_list)
  if (!items.length) return required ? `${field.label} is required` : null
  if (items.length < min) return `${field.label}: add at least ${min} item${min === 1 ? '' : 's'}`
  if (items.length > max) return `${field.label}: at most ${max} item${max === 1 ? '' : 's'}`
  const long = items.findIndex((item) => item.length > itemMax)
  if (long >= 0) return `${field.label}: item ${long + 1} is longer than ${itemMax} characters`
  return null
}

/** The marker in front of item `index` (0-based). */
export function textListMarker(style: TextListStyle | undefined, index: number): string {
  if (style === 'numbered') return `${index + 1}.`
  if (style === 'plain') return ''
  return '•'
}

/** The items as text, one per line with their markers (summaries, e-mails). */
export function textListText(value: unknown, style?: TextListStyle): string {
  return textListItems(value).map((item, i) => (style === 'plain' ? item : `${textListMarker(style, i)} ${item}`)).join('\n')
}
