'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { serverRead } from '@/lib/server-read'
import { renderableRows, type FormLayout } from '@/lib/forms/layout'
import { lookupItemKey } from '@/lib/forms/lookup'
import { LookupField, lookupDisplayValue } from './lookup-field'
import { AttachmentList, AttachmentsField } from './attachments-field'
import { attachmentNames } from '@/lib/forms/attachments'
import { isDisplayField, isFieldVisible, optionLabel, type TaskFieldDef } from '@/lib/task-field-schema'
import { cn } from '@/lib/utils'

/**
 * The assignee's form: User Task fields on the designer's grid (or, without
 * a layout, the classic two-column flow every existing task uses). Shared by
 * the task screen, the designer's live preview and the test runner, so what
 * the designer shows is exactly what the assignee sees. Rows collapse to one
 * column below the `sm` breakpoint (phones) or when `singleColumn` is set.
 *
 * Read-only mode shows formatted values (completed tasks, viewers).
 */

export interface FormRendererProps {
  fields: TaskFieldDef[]
  layout?: FormLayout | null
  values: Record<string, unknown>
  onChange?: (key: string, value: unknown) => void
  errors?: Record<string, string>
  readOnly?: boolean
  compact?: boolean
  /** Force one column (designer mobile preview). */
  singleColumn?: boolean
  labelPosition?: 'top' | 'left'
  density?: 'compact' | 'comfortable'
  /** Prefix for input ids (several renderers on one page). */
  idPrefix?: string
}

// Static class names so Tailwind generates them.
const SM_COLS = ['', 'sm:grid-cols-1', 'sm:grid-cols-2', 'sm:grid-cols-3', 'sm:grid-cols-4']
const SM_SPAN = ['', 'sm:col-span-1', 'sm:col-span-2', 'sm:col-span-3', 'sm:col-span-4']

export function formatFieldValue(field: TaskFieldDef | undefined, value: unknown, people?: Map<string, string>): string {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return '—'
  if (field?.type === 'attachments') return attachmentNames(value) || '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map((v) => (field ? optionLabel(field, String(v)) : String(v))).join(', ')
  if (field?.type === 'currency' && typeof value === 'number') {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: field.currency ?? 'USD' }).format(value)
    } catch { return String(value) }
  }
  if (field?.type === 'datetime') {
    const d = new Date(String(value))
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
  }
  if (field?.type === 'user') return people?.get(String(value)) ?? String(value)
  if (field && (field.type === 'choice')) return optionLabel(field, String(value))
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function dateValue(value: unknown): string {
  const s = text(value)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s
}

/** ISO → the value a datetime-local input shows (local time, minutes). */
function dateTimeLocalValue(value: unknown): string {
  const s = text(value)
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isChecked(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return ['true', '1', 'yes', 'on'].includes(String(value ?? '').toLowerCase())
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.trim()) return value.split(',').map((v) => v.trim()).filter(Boolean)
  return []
}

function usePeople(enabled: boolean) {
  return useQuery({
    queryKey: ['form-person-options'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => (await serverRead('tasks.redirectUsers')).data ?? [],
  })
}

const INPUT_TYPE: Partial<Record<TaskFieldDef['type'], string>> = {
  text: 'text', email: 'email', phone: 'tel', url: 'url', number: 'number', currency: 'number', date: 'date', datetime: 'datetime-local',
}

function FieldControl({ field, value, onChange, error, id, people, values, setValue }: {
  field: TaskFieldDef
  value: unknown
  onChange: (value: unknown) => void
  error?: string
  id: string
  people: Array<{ id: string; display_name: string | null; email: string | null }>
  values: Record<string, unknown>
  setValue: (key: string, value: unknown) => void
}) {
  const invalid = Boolean(error)
  const describedBy = [field.help_text ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  const common = {
    id,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
    'aria-required': field.required || undefined,
    disabled: field.read_only,
    style: invalid ? { borderColor: 'var(--status-blocked)' } : undefined,
  }
  switch (field.type) {
    case 'attachments':
      return (
        <AttachmentsField
          field={field}
          value={value}
          onChange={onChange}
          id={id}
          describedBy={describedBy}
          invalid={invalid}
          disabled={field.read_only}
        />
      )
    case 'lookup':
      return (
        <LookupField
          field={field}
          value={value}
          item={values[lookupItemKey(field.key)]}
          values={values}
          onChange={onChange}
          onItem={(item) => setValue(lookupItemKey(field.key), item)}
          onFill={(patch) => { for (const [key, v] of Object.entries(patch)) setValue(key, v) }}
          id={id}
          describedBy={describedBy}
          invalid={invalid}
          disabled={field.read_only}
          placeholder={field.placeholder}
        />
      )
    case 'textarea':
      return (
        <textarea
          {...common}
          rows={4}
          value={text(value)}
          placeholder={field.placeholder}
          maxLength={field.max_length}
          onChange={(e) => onChange(e.target.value)}
          className="flex w-full rounded-lg border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60"
          style={{ borderColor: invalid ? 'var(--status-blocked)' : 'var(--theme-surface-border)', backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)', ['--tw-ring-color' as string]: 'var(--theme-primary)' }}
        />
      )
    case 'boolean':
      return (
        <label htmlFor={id} className="flex items-center gap-2 text-sm cursor-pointer min-h-10">
          <input
            id={id}
            type="checkbox"
            checked={isChecked(value)}
            disabled={field.read_only}
            aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.checked)}
            style={{ accentColor: 'var(--theme-primary)' }}
            className="h-4 w-4"
          />
          <span style={{ color: 'var(--theme-card-text)' }}>
            {field.label}
            {field.required && <span className="ml-0.5" style={{ color: 'var(--status-blocked)' }}>*</span>}
          </span>
        </label>
      )
    case 'choice':
      if (field.display === 'radio') {
        return (
          <div role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={describedBy} className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
            {(field.options ?? []).map((option) => (
              <label key={option} className="flex items-center gap-1.5 text-sm cursor-pointer" style={{ color: 'var(--theme-card-text)' }}>
                <input
                  type="radio"
                  name={id}
                  value={option}
                  checked={text(value) === option}
                  disabled={field.read_only}
                  onChange={() => onChange(option)}
                  style={{ accentColor: 'var(--theme-primary)' }}
                />
                {optionLabel(field, option)}
              </label>
            ))}
          </div>
        )
      }
      return (
        <AutocompleteSelect
          value={text(value)}
          onChange={(next) => onChange(next)}
          options={(field.options ?? []).map((option) => ({ value: option, label: optionLabel(field, option) }))}
          placeholder={field.placeholder || 'Select…'}
          clearable={!field.required}
          disabled={field.read_only}
          size="md"
        />
      )
    case 'multi_choice': {
      const selected = asList(value)
      return (
        <div role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy} className="flex flex-wrap gap-1.5 pt-1">
          {(field.options ?? []).map((option) => {
            const on = selected.includes(option)
            return (
              <button
                key={option}
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={field.read_only}
                onClick={() => onChange(on ? selected.filter((v) => v !== option) : [...selected, option])}
                className="rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60"
                style={on
                  ? { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }
                  : { borderColor: invalid ? 'var(--status-blocked)' : 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
              >
                {optionLabel(field, option)}
              </button>
            )
          })}
        </div>
      )
    }
    case 'user':
      return (
        <AutocompleteSelect
          value={text(value)}
          onChange={(next) => onChange(next)}
          options={people.map((p) => ({ value: p.id, label: p.display_name || p.email || p.id, hint: p.display_name && p.email ? p.email : undefined }))}
          placeholder={field.placeholder || 'Choose a person…'}
          clearable={!field.required}
          disabled={field.read_only}
          size="md"
        />
      )
    default: {
      const type = INPUT_TYPE[field.type] ?? 'text'
      const shown = field.type === 'date' ? dateValue(value) : field.type === 'datetime' ? dateTimeLocalValue(value) : text(value)
      const input = (
        <Input
          {...common}
          type={type}
          inputMode={field.type === 'currency' ? 'decimal' : undefined}
          step={field.type === 'currency' ? '0.01' : field.type === 'number' ? 'any' : undefined}
          min={field.type === 'date' ? field.min_date?.slice(0, 10) : field.min}
          max={field.type === 'date' ? field.max_date?.slice(0, 10) : field.max}
          minLength={field.min_length}
          maxLength={field.max_length}
          value={shown}
          placeholder={field.placeholder}
          onChange={(e) => {
            if (field.type === 'datetime') {
              const d = new Date(e.target.value)
              onChange(e.target.value && !Number.isNaN(d.getTime()) ? d.toISOString() : e.target.value)
            } else onChange(e.target.value)
          }}
        />
      )
      if (field.type !== 'currency') return input
      return (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium" style={{ color: 'var(--theme-muted-text)' }}>{field.currency ?? 'USD'}</span>
          <div className="[&_input]:pl-12">{input}</div>
        </div>
      )
    }
  }
}

function FieldCell({ field, value, onChange, error, readOnly, labelClass, labelLeft, idPrefix, peopleMap, people, singleColumn, values }: {
  singleColumn?: boolean
  values: Record<string, unknown>
  field: TaskFieldDef
  value: unknown
  onChange?: (key: string, value: unknown) => void
  error?: string
  readOnly: boolean
  labelClass: string
  labelLeft: boolean
  idPrefix: string
  peopleMap: Map<string, string>
  people: Array<{ id: string; display_name: string | null; email: string | null }>
}) {
  const id = `${idPrefix}${field.key}`
  if (field.type === 'heading') {
    return (
      <div className="pt-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>{field.label}</h3>
        {field.help_text && <p className="mt-0.5 text-xs" style={{ color: 'var(--theme-muted-text)' }}>{field.help_text}</p>}
      </div>
    )
  }
  if (field.type === 'divider') return <hr className="my-1 border-t" style={{ borderColor: 'var(--theme-surface-border)' }} aria-hidden />

  const label = (
    <label id={`${id}-label`} htmlFor={id} className={cn('block font-medium', labelClass, labelLeft ? 'sm:pt-2.5' : 'mb-1')} style={{ color: 'var(--theme-muted-text)' }}>
      {field.label}
      {field.required && !readOnly && <span className="ml-0.5" style={{ color: 'var(--status-blocked)' }} aria-hidden>*</span>}
    </label>
  )
  const help = field.help_text ? <p id={`${id}-help`} className="mt-1 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>{field.help_text}</p> : null

  if (readOnly) {
    return (
      <div className={cn(labelLeft && 'sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-3')}>
        {label}
        {field.type === 'attachments'
          ? <div className="text-sm" style={{ color: 'var(--theme-card-text)' }}><AttachmentList value={value} /></div>
          : <p className="text-sm break-words whitespace-pre-wrap" style={{ color: 'var(--theme-card-text)' }}>{field.type === 'lookup' ? lookupDisplayValue(field, value, values[lookupItemKey(field.key)]) : formatFieldValue(field, value, peopleMap)}</p>}
      </div>
    )
  }

  const control = <FieldControl field={field} value={value} onChange={(v) => onChange?.(field.key, v)} error={error} id={id} people={people} values={values} setValue={(key, v) => onChange?.(key, v)} />
  const errorLine = error ? <p id={`${id}-error`} role="alert" className="mt-1 text-[11px]" style={{ color: 'var(--status-blocked)' }}>{error}</p> : null
  if (field.type === 'boolean') {
    // Aligned with the inputs beside it on wider screens; no gap when the row collapses to one column.
    return <div className={cn(!labelLeft && !singleColumn && 'sm:pt-5')}>{control}{help}{errorLine}</div>
  }
  if (labelLeft) {
    return (
      <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-3">
        {label}
        <div>{control}{help}{errorLine}</div>
      </div>
    )
  }
  return <div>{label}{control}{help}{errorLine}</div>
}

export function FormRenderer({ fields, layout, values, onChange, errors, readOnly, compact, singleColumn, labelPosition = 'top', density = 'comfortable', idPrefix = 'task-field-' }: FormRendererProps) {
  const disabled = Boolean(readOnly || !onChange)
  const labelClass = compact ? 'text-[11px]' : 'text-xs'
  const needsPeople = fields.some((f) => f.type === 'user')
  const { data: people = [] } = usePeople(needsPeople)
  const peopleMap = useMemo(() => new Map(people.map((p) => [p.id, p.display_name || p.email || p.id])), [people])
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields])
  const visible = (field: TaskFieldDef) => isFieldVisible(field, values)
  const gap = density === 'compact' ? 'gap-2' : 'gap-3'
  const labelLeft = labelPosition === 'left' && !singleColumn

  const cell = (field: TaskFieldDef) => (
    <FieldCell
      field={field}
      value={values[field.key]}
      onChange={onChange}
      error={errors?.[field.key]}
      readOnly={disabled}
      labelClass={labelClass}
      labelLeft={labelLeft}
      idPrefix={idPrefix}
      peopleMap={peopleMap}
      people={people}
      singleColumn={singleColumn || compact}
      values={values}
    />
  )

  if (layout) {
    const rows = renderableRows(layout)
      .map((row) => ({ ...row, cells: row.cells.filter((c) => byKey.has(c.field_key) && visible(byKey.get(c.field_key)!)) }))
      .filter((row) => row.cells.length > 0)
    return (
      <div className={cn('flex flex-col', density === 'compact' ? 'gap-2' : 'gap-3')} data-form-layout="grid">
        {rows.map((row, r) => (
          <div key={r} className={cn('grid grid-cols-1', gap, !singleColumn && SM_COLS[row.columns])} data-columns={row.columns}>
            {row.cells.map((c) => (
              <div key={c.field_key} className={cn('min-w-0', !singleColumn && SM_SPAN[c.span])}>
                {cell(byKey.get(c.field_key)!)}
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  // Classic flow (no layout): two columns on wider screens, long fields full width.
  return (
    <div className={cn('grid', gap, compact || singleColumn ? 'grid-cols-1' : 'sm:grid-cols-2')}>
      {fields.filter(visible).map((field) => {
        const wide = !compact && !singleColumn && (field.type === 'text' || field.type === 'textarea' || isDisplayField(field) || field.type === 'multi_choice' || field.type === 'attachments')
        return (
          <div key={field.key} className={cn('min-w-0', wide && !disabled && 'sm:col-span-2', wide && disabled && isDisplayField(field) && 'sm:col-span-2')}>
            {cell(field)}
          </div>
        )
      })}
    </div>
  )
}
