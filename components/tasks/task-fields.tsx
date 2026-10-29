'use client'

import type { TaskFieldDef } from '@/lib/task-field-schema'
import type { FormLayout } from '@/lib/forms/layout'
import type { FormThemeOverrides } from '@/lib/forms/form-theme'
import { FormRenderer, formatFieldValue } from '@/components/forms/form-renderer'
import { FormThemeScope } from '@/components/forms/form-theme-scope'
import { cn } from '@/lib/utils'
import { lookupItemKey } from '@/lib/forms/lookup'
import { attachmentsCountKey } from '@/lib/forms/attachments'

interface TaskFieldsProps {
  fields: TaskFieldDef[]
  values: Record<string, unknown>
  onChange?: (key: string, value: unknown) => void
  errors?: Record<string, string>
  readOnly?: boolean
  /** Other task data (task.data) shown read-only below the fields — entries already covered by `fields` are skipped. */
  data?: Record<string, unknown> | null
  compact?: boolean
  /** The form designer's grid (task metadata `form_layout`); none → the classic flow. */
  layout?: FormLayout | null
  /** Resolved mini theme (task metadata `form_theme`); none → the workspace theme. */
  theme?: FormThemeOverrides | null
  /** Drawn inside the form's theme, above / below the fields (the form header, its button bar). */
  header?: React.ReactNode
  footer?: React.ReactNode
  /** Frame the form with its theme's page background (task page). */
  page?: boolean
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
}

export function formatTaskValue(value: unknown): string {
  return formatFieldValue(undefined, value)
}

/**
 * User Task `fields` (on their grid and mini theme when the designer set
 * them) plus a read-only key/value list of any other task data. Used by the
 * task detail page and the designer's test runner so both show the same
 * inputs.
 */
export function TaskFields({ fields, values, onChange, errors, readOnly, data, compact, layout, theme, header, footer, page }: TaskFieldsProps) {
  // A lookup's selected item (`<key>_item`) is shown through its field.
  const fieldKeys = new Set(fields.flatMap((f) => (f.type === 'lookup' ? [f.key, lookupItemKey(f.key)] : f.type === 'attachments' ? [f.key, attachmentsCountKey(f.key)] : [f.key])))
  const extraEntries = Object.entries(data ?? {}).filter(([key]) => !fieldKeys.has(key))
  const labelClass = compact ? 'text-[11px]' : 'text-xs'

  if (fields.length === 0 && extraEntries.length === 0) return null

  return (
    <div className="space-y-4">
      {fields.length > 0 && (
        <FormThemeScope overrides={theme} page={page}>
          {header}
          <FormRenderer
            fields={fields}
            layout={layout ?? null}
            values={values}
            onChange={onChange}
            errors={errors}
            readOnly={readOnly}
            compact={compact}
            labelPosition={theme?.label_position}
            density={theme?.density}
          />
          {footer}
        </FormThemeScope>
      )}

      {extraEntries.length > 0 && (
        <dl className={cn('grid gap-x-4 gap-y-2', compact ? 'grid-cols-1' : 'sm:grid-cols-2')}>
          {extraEntries.map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className={cn('font-medium', labelClass)} style={{ color: 'var(--theme-muted-text)' }}>{humanizeKey(key)}</dt>
              <dd className="text-sm break-words" style={{ color: 'var(--theme-card-text)' }}>{formatTaskValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
