'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

/** Click to edit; Enter or blur saves, Escape cancels. Shows the value as text otherwise. */
export function InlineText({ value, onSave, disabled, label, maxLength = 200, placeholder = '—', className }: {
  value: string
  onSave: (value: string) => Promise<boolean | void>
  disabled?: boolean
  label: string
  maxLength?: number
  placeholder?: string
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)

  async function commit() {
    const next = draft.trim()
    if (next === value.trim()) { setEditing(false); return }
    setSaving(true)
    const ok = await onSave(next)
    setSaving(false)
    if (ok !== false) setEditing(false)
  }

  if (editing && !disabled) {
    return (
      <input
        autoFocus
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit() }
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className="w-full rounded border border-border bg-panel px-1.5 py-0.5 text-sm text-fg"
      />
    )
  }
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${label}: ${value || 'empty'}${disabled ? '' : ' (edit)'}`}
      onClick={() => { setDraft(value); setEditing(true) }}
      className={cn('block w-full truncate rounded px-1 py-0.5 text-left text-sm', !disabled && 'hover:bg-subtle', !value && 'text-fg-subtle', className)}
    >
      {value || placeholder}
    </button>
  )
}
