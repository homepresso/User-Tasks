'use client'

import { ExternalLink } from 'lucide-react'
import { urlLink } from '@/lib/forms/link-field'
import { isPeopleList } from '@/lib/forms/people-field'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { RichTextView } from './rich-text-field'
import { TextListView } from './text-list-field'
import { PeopleValueView } from './people-field'

/** Read-only URL: "link text ↗" (url_config) — only http(s) / mailto become links; anything else shows as text. */
export function UrlLinkView({ field, value, values }: { field: Pick<TaskFieldDef, 'url_config'>; value: unknown; values?: Record<string, unknown> | null }) {
  const link = urlLink(field, value, values)
  if (!link) return <p className="text-sm text-fg">—</p>
  if (!link.href) return <p className="text-sm break-words text-fg">{link.text}</p>
  return (
    <p className="text-sm break-words text-fg">
      <a href={link.href} {...(link.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})} data-url-link
        className="inline-flex max-w-full items-baseline gap-1 font-medium text-primary-text underline underline-offset-2 hover:no-underline">
        <span className="break-words">{link.text}</span>
        {link.newTab && <><ExternalLink size={12} aria-hidden className="shrink-0 self-center" /><span className="sr-only"> (opens in a new tab)</span></>}
      </a>
    </p>
  )
}

/** Whether ControlValueView draws this field's read-only value. */
export function hasControlValueView(field: TaskFieldDef): boolean {
  return field.type === 'rich_text' || field.type === 'text_list' || field.type === 'url' || isPeopleList(field)
}

/** Read-only value of a rich text, text list, URL or people-list field (submissions, task views, Home). */
export function ControlValueView({ field, value, values }: { field: TaskFieldDef; value: unknown; values?: Record<string, unknown> | null }) {
  if (field.type === 'rich_text') return <RichTextView value={value} />
  if (field.type === 'text_list') return <TextListView value={value} config={field.text_list} />
  if (field.type === 'url') return <UrlLinkView field={field} value={value} values={values} />
  if (isPeopleList(field)) return <PeopleValueView value={value} />
  return null
}
