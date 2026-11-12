'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { textListItems, textListLimits, textListMarker, type TextListConfig } from '@/lib/forms/text-list'
import { controlClass } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Text list (lib/forms/text-list.ts): one input per item, drawn with the
 * field's marker (bulleted / numbered / plain). Enter adds the next item,
 * Backspace on an empty item removes it, ↑ / ↓ move between items and
 * Alt+↑ / Alt+↓ (or the buttons) move an item. Changes are announced to
 * screen readers. Blank items are dropped when the value is stored.
 */
export function TextListField({ value, onChange, id, label, labelledBy, describedBy, invalid, disabled, readOnly, config, placeholder }: {
  value: unknown
  onChange: (items: string[]) => void
  id: string
  label: string
  labelledBy?: string
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
  readOnly?: boolean
  config?: TextListConfig
  placeholder?: string
}) {
  const raw = Array.isArray(value) ? value.map((v) => (v === null || v === undefined ? '' : String(v))) : textListItems(value)
  const items = raw.length ? raw : ['']
  const { max, itemMax } = textListLimits(config)
  const style = config?.style ?? 'bulleted'
  const inputs = useRef<Array<HTMLInputElement | null>>([])
  // The item to focus once the list has re-rendered (after adding, removing or moving one).
  const focusAt = useRef<{ index: number; caret?: 'end' } | null>(null)
  const setFocusAt = (next: { index: number; caret?: 'end' }) => { focusAt.current = next }
  const [announcement, setAnnouncement] = useState('')
  const editable = !disabled && !readOnly
  const filled = items.filter((s) => s.trim()).length

  useEffect(() => {
    const want = focusAt.current
    if (!want) return
    const el = inputs.current[want.index]
    if (!el) return
    focusAt.current = null
    el.focus()
    if (want.caret === 'end') el.setSelectionRange(el.value.length, el.value.length)
  })

  const set = (next: string[], message?: string) => {
    onChange(next)
    if (message) setAnnouncement(message)
  }
  const insertAfter = (index: number) => {
    if (items.length >= max) { setAnnouncement(`At most ${max} items`); return }
    const next = [...items.slice(0, index + 1), '', ...items.slice(index + 1)]
    set(next, `Item ${index + 2} added`)
    setFocusAt({ index: index + 1 })
  }
  const remove = (index: number) => {
    if (items.length <= 1) { set([''], 'Item cleared'); setFocusAt({ index: 0 }); return }
    const next = items.filter((_, i) => i !== index)
    set(next, `Item ${index + 1} removed`)
    setFocusAt({ index: Math.max(0, index - 1), caret: 'end' })
  }
  const move = (index: number, by: -1 | 1) => {
    const to = index + by
    if (to < 0 || to >= items.length) return
    const next = [...items]
    ;[next[index], next[to]] = [next[to], next[index]]
    set(next, `Moved to position ${to + 1} of ${items.length}`)
    setFocusAt({ index: to })
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (!editable) return
    if (e.key === 'Enter') { e.preventDefault(); insertAfter(index) }
    else if (e.key === 'Backspace' && items[index] === '' && items.length > 1) { e.preventDefault(); remove(index) }
    else if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); move(index, -1) }
    else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); move(index, 1) }
    else if (e.key === 'ArrowUp' && index > 0) { e.preventDefault(); setFocusAt({ index: index - 1, caret: 'end' }) }
    else if (e.key === 'ArrowDown' && index < items.length - 1) { e.preventDefault(); setFocusAt({ index: index + 1, caret: 'end' }) }
  }

  const ListTag = style === 'numbered' ? 'ol' : 'ul'
  const iconButton = 'inline-flex size-9 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-subtle hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent'

  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} data-text-list={style} {...(readOnly ? { 'data-read-only': '' } : {})}>
      <ListTag className="space-y-1.5" role="list">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {style !== 'plain' && <span aria-hidden className="w-6 shrink-0 text-right text-sm tabular-nums text-fg-muted">{textListMarker(style, i)}</span>}
            <input
              ref={(el) => { inputs.current[i] = el }}
              id={i === 0 ? id : `${id}-${i}`}
              type="text"
              value={item}
              maxLength={itemMax}
              placeholder={i === 0 ? placeholder : undefined}
              disabled={disabled}
              readOnly={readOnly}
              aria-readonly={readOnly || undefined}
              aria-label={`${label}, item ${i + 1} of ${items.length}`}
              aria-invalid={(invalid && !item.trim() && filled === 0) || item.length > itemMax || undefined}
              aria-keyshortcuts="Enter Backspace Alt+ArrowUp Alt+ArrowDown"
              onChange={(e) => { if (editable) set(items.map((v, j) => (j === i ? e.target.value : v))) }}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(controlClass, 'h-10 min-w-0 flex-1 px-3', invalid && 'border-danger', readOnly && 'border-dashed bg-subtle')}
            />
            {editable && (
              <span className="flex shrink-0 items-center">
                <button type="button" className={iconButton} aria-label={`Move item ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} aria-hidden /></button>
                <button type="button" className={iconButton} aria-label={`Move item ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} aria-hidden /></button>
                <button type="button" className={iconButton} aria-label={`Remove item ${i + 1}`} disabled={items.length === 1 && !item} onClick={() => remove(i)}><X size={14} aria-hidden /></button>
              </span>
            )}
          </li>
        ))}
      </ListTag>
      {editable && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <button type="button" onClick={() => insertAfter(items.length - 1)} disabled={items.length >= max}
            className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary-text hover:bg-primary-wash disabled:opacity-50">
            <Plus size={14} aria-hidden /> Add item
          </button>
          <span className="text-2xs tabular-nums text-fg-muted">{filled} / {max}</span>
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </div>
  )
}

/** Read-only: the items with the field's markers. */
export function TextListView({ value, config }: { value: unknown; config?: TextListConfig }) {
  const items = textListItems(value)
  if (!items.length) return <p className="text-sm text-fg">—</p>
  const style = config?.style ?? 'bulleted'
  const ListTag = style === 'numbered' ? 'ol' : 'ul'
  return (
    <ListTag role="list" data-text-list-value={style}
      className={cn('space-y-0.5 text-sm text-fg break-words', style === 'numbered' ? 'list-decimal pl-6' : style === 'bulleted' ? 'list-disc pl-5' : 'list-none')}>
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ListTag>
  )
}
