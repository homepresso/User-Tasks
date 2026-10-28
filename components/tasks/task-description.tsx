'use client'

/**
 * Task descriptions may be HTML (sanitised on write). These render them:
 *   - TaskDescription: the formatted description (sanitised again here —
 *     defence in depth; plain text keeps its line breaks)
 *   - taskDescriptionExcerpt: plain text for list/queue previews
 *   - TaskDescriptionEditor: textarea with an "HTML supported" hint and a
 *     live preview toggle
 */

import { useState, type CSSProperties } from 'react'
import { Eye, Pencil } from 'lucide-react'
import { descriptionToHtml, htmlToPlainText } from '@/lib/html-sanitize'
import { cn } from '@/lib/utils'

export function taskDescriptionExcerpt(value: unknown): string {
  return htmlToPlainText(value)
}

export function TaskDescription({ value, className, style }: { value: string | null | undefined; className?: string; style?: CSSProperties }) {
  const html = descriptionToHtml(value)
  if (!html) return null
  return <div className={cn('task-description', className)} style={style} dangerouslySetInnerHTML={{ __html: html }} />
}

export function TaskDescriptionEditor({
  id, name, defaultValue = '', value: controlled, onChange, rows = 3, placeholder, className, style,
}: {
  id?: string
  name?: string
  defaultValue?: string
  value?: string
  onChange?: (value: string) => void
  rows?: number
  placeholder?: string
  className?: string
  style?: CSSProperties
}) {
  const [own, setOwn] = useState(defaultValue)
  const [preview, setPreview] = useState(false)
  const value = controlled ?? own
  const update = (next: string) => { if (controlled === undefined) setOwn(next); onChange?.(next) }

  return (
    <div>
      {/* The hidden input keeps the value in the form while previewing. */}
      {preview && name && <input type="hidden" name={name} value={value} />}
      {preview ? (
        <div
          className={cn('min-h-[4.5rem] rounded-lg border px-3 py-2 text-sm', className)}
          style={style}
          aria-label="Description preview"
        >
          {value.trim()
            ? <TaskDescription value={value} />
            : <span style={{ color: 'var(--theme-muted-text)' }}>Nothing to preview</span>}
        </div>
      ) : (
        <textarea
          id={id}
          name={name}
          rows={rows}
          value={value}
          onChange={(e) => update(e.target.value)}
          placeholder={placeholder}
          className={className}
          style={style}
        />
      )}
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
        <span>Plain text or HTML (bold, lists, headings, links, tables)</span>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className="inline-flex items-center gap-1 hover:underline"
          style={{ color: 'var(--theme-primary-text)' }}
          aria-pressed={preview}
        >
          {preview ? <><Pencil size={11} /> Edit</> : <><Eye size={11} /> Preview</>}
        </button>
      </div>
    </div>
  )
}
