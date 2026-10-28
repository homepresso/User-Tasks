'use client'

import { Input } from '@/components/ui/input'
import type { SecretValue } from './form-state'

/**
 * A credential field. A stored value is never sent to the browser: it shows
 * as •••• with a Replace control, and is only sent back when replaced.
 */
export function SecretInput({
  value,
  onChange,
  placeholder,
  disabled,
  ariaLabel,
}: {
  value: SecretValue
  onChange: (next: SecretValue) => void
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  if (value.stored && !value.replacing) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="flex h-10 flex-1 items-center rounded-lg border px-3 text-sm tracking-widest"
          style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}
          aria-label={ariaLabel ? `${ariaLabel} (stored)` : 'Stored secret'}
        >
          ••••••••
        </span>
        <button
          type="button"
          className="text-xs font-medium underline underline-offset-2 disabled:opacity-40"
          style={{ color: 'var(--theme-primary-text)' }}
          onClick={() => onChange({ ...value, replacing: true, value: '' })}
          disabled={disabled}
        >
          Replace
        </button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        type="password"
        autoComplete="new-password"
        value={value.value}
        onChange={(e) => onChange({ ...value, value: e.target.value })}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      {value.stored && (
        <button
          type="button"
          className="shrink-0 text-xs font-medium underline underline-offset-2"
          style={{ color: 'var(--theme-muted-text)' }}
          onClick={() => onChange({ ...value, replacing: false, value: '' })}
        >
          Keep current
        </button>
      )}
    </div>
  )
}
