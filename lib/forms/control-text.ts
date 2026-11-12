/**
 * Plain-text display of the rich text, text list, linked URL and people-list
 * values (lib/forms/rich-text.ts, text-list.ts, link-field.ts,
 * people-field.ts) — one place for every text surface: formatted values,
 * submissions, Home task details, the timeline, CSV, the Agent's summary.
 *
 * Returns null for any other field (the caller formats it as before).
 * Pure and isomorphic.
 */

import { richTextPlainText, type RichTextConfig } from './rich-text'
import { textListText, type TextListConfig } from './text-list'
import { urlLinkText, type UrlFieldConfig } from './link-field'
import { isPeopleList, peopleText, type UserFieldConfig } from './people-field'

interface ControlField {
  type: string
  rich_text?: RichTextConfig
  text_list?: TextListConfig
  url_config?: UrlFieldConfig
  user_config?: UserFieldConfig
}

export function controlValueText(field: ControlField | undefined, value: unknown, options: { values?: Record<string, unknown> | null; names?: ReadonlyMap<string, string>; csv?: boolean } = {}): string | null {
  if (!field) return null
  if (field.type === 'rich_text') return richTextPlainText(value)
  // CSV: one item per line without markers (a spreadsheet cell); elsewhere with the field's markers.
  if (field.type === 'text_list') return textListText(value, options.csv ? 'plain' : field.text_list?.style)
  if (field.type === 'url' && field.url_config && !options.csv) return urlLinkText(field, value, options.values)
  if (isPeopleList(field)) return peopleText(value, options.names)
  return null
}
