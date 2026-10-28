'use client'

import { Input } from '@/components/ui/input'
import type { CSSProperties } from 'react'
import { normalizeReferenceInputOptions } from '@/lib/reference-input-utils'

export function ReferenceStaticValueInput({
  input,
  value,
  onChange,
  inputClassName,
  selectClassName,
  selectStyle,
  checkboxLabel = 'Static boolean',
}: {
  input: any
  value: string
  onChange: (value: string) => void
  inputClassName?: string
  selectClassName?: string
  selectStyle?: CSSProperties
  checkboxLabel?: string
}) {
  const type = String(input?.type ?? '').toLowerCase()

  if (Array.isArray(input?.options) && input.options.length > 0) {
    const normalizedOptions = normalizeReferenceInputOptions(input)

    return (
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={selectClassName ?? 'w-full rounded-lg border px-3 py-2 text-[11px]'}
        style={selectStyle}
      >
        <option value="">Select an option...</option>
        {normalizedOptions.map((option: { label: string; value: string }) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }

  if (type === 'boolean' || type === 'bool') {
    return (
      <label
        className={selectClassName ?? 'flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px]'}
        style={selectStyle}
      >
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(event) => onChange(event.target.checked ? 'true' : 'false')}
          className="rounded"
        />
        <span>{checkboxLabel}</span>
      </label>
    )
  }

  if (['number', 'integer', 'float', 'decimal'].includes(type)) {
    return (
      <Input
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={input.default_value || '0'}
        className={inputClassName ?? '!h-8 !text-[11px] font-mono'}
      />
    )
  }

  if (type === 'date' || type === 'datetime' || type === 'timestamp') {
    return (
      <Input
        type={type === 'date' ? 'date' : 'datetime-local'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName ?? '!h-8 !text-[11px] font-mono'}
      />
    )
  }

  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={input.default_value || input.placeholder || 'Enter value'}
      className={inputClassName ?? '!h-8 !text-[11px] font-mono'}
    />
  )
}
