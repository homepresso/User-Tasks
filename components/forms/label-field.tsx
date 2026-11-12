'use client'

import { useEffect, useMemo, useRef } from 'react'
import { FormattedCellView } from './data-table-cell'
import { useFormRules } from './form-rules-runtime'
import {
  LABEL_LIMITS, LabelCascade, computeLabelValues, formatLabelValue, inferLabelFormat, isLabel, sameLabelValue,
  type LabelFieldConfig,
} from '@/lib/forms/label-field'
import { layoutFormRules } from '@/lib/forms/form-rules'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { cn } from '@/lib/utils'

/**
 * A Label field on a live form (lib/forms/label-field.ts): display text,
 * never an input. Dynamic labels (an expression, or a rule writes them)
 * are a polite live region so screen readers hear the new value.
 */

const SIZE: Record<NonNullable<LabelFieldConfig['size']>, string> = { sm: 'text-sm', md: 'text-base', lg: 'text-xl', xl: 'text-3xl' }

export function LabelDisplay({ field, fields, value, id, dynamic, locale }: {
  field: TaskFieldDef
  /** The form's fields: a label with no format of its own defaults to currency when it adds up currency values (inferLabelFormat). */
  fields?: readonly TaskFieldDef[]
  value: unknown
  id: string
  dynamic: boolean
  locale?: string
}) {
  const config = field.label_config
  const inferred = useMemo(() => (config?.format || !fields ? null : inferLabelFormat(field, fields as never)), [config?.format, field, fields])
  const cell = formatLabelValue(config, value, { locale, inferred })
  const align = config?.align ?? (cell.empty ? undefined : cell.align)
  const size = SIZE[config?.size ?? 'md']
  const captionId = `${id}-label`
  const body = (
    <>
      {!cell.empty && cell.prefix && <span className="mr-0.5" data-label-prefix>{cell.prefix}</span>}
      <FormattedCellView cell={cell} wrap />
      {!cell.empty && cell.suffix && <span className="ml-1" data-label-suffix>{cell.suffix}</span>}
    </>
  )
  const valueClass = cn('block min-h-[1.5em] break-words tabular-nums', size, config?.emphasis === 'strong' && 'font-semibold', config?.emphasis === 'muted' ? 'text-fg-muted' : 'text-fg')
  const valueStyle: React.CSSProperties = { textAlign: align }
  return (
    <div data-label-field={field.key} data-label-empty={cell.empty || undefined}>
      {field.label && (
        <p id={captionId} className={cn('mb-1 text-xs font-medium', config?.hide_caption && 'sr-only', 'text-fg-muted')} style={{ textAlign: align }}>
          {field.label}
        </p>
      )}
      {dynamic
        ? <output id={id} aria-labelledby={field.label ? captionId : undefined} aria-live="polite" aria-atomic="true" className={valueClass} style={valueStyle} data-label-value>{body}</output>
        : <p id={id} aria-labelledby={field.label ? captionId : undefined} className={valueClass} style={valueStyle} data-label-value>{body}</p>}
      {field.help_text && <p className="mt-1 text-2xs text-fg-muted" style={{ textAlign: align }}>{field.help_text}</p>}
    </div>
  )
}

/**
 * Keeps a live form's Label values current and dispatches "Label changes":
 *
 *  - labels with an expression are worked out from the values (in their
 *    dependency order) and written into the form's values when they differ,
 *    so rules, other labels and the submission see them;
 *  - every label's value is watched (expression, rule, parameter alike);
 *    once a change settles (LABEL_LIMITS.debounceMs) its "Label changes"
 *    rules run with {{event.value}} / {{event.previous_value}};
 *  - a chain of label rules changing labels runs at most LABEL_LIMITS.chain
 *    rounds (LabelCascade), then stops with a console warning.
 */
export function LabelValues({ fields, layout, values, onChange }: {
  fields: TaskFieldDef[]
  layout: unknown
  values: Record<string, unknown>
  onChange?: (key: string, value: unknown) => void
}) {
  const rules = useFormRules()
  const labels = useMemo(() => fields.filter(isLabel), [fields])
  const computed = useMemo(() => computeLabelValues(fields, values), [fields, values])
  const hasLabelRules = useMemo(() => layoutFormRules(layout).some((r) => r.event === 'label_change' && !r.disabled), [layout])
  const onChangeRef = useRef(onChange)
  const rulesRef = useRef(rules)
  const valuesRef = useRef(values)
  useEffect(() => { onChangeRef.current = onChange; rulesRef.current = rules; valuesRef.current = values })

  // Expressions → values.
  useEffect(() => {
    for (const [key, { value }] of Object.entries(computed)) {
      if (!sameLabelValue(valuesRef.current[key], value)) onChangeRef.current?.(key, value)
    }
  }, [computed])

  // "Label changes": watch, settle, dispatch (bounded).
  const cascade = useRef<LabelCascade | null>(null)
  const prev = useRef<Record<string, unknown> | null>(null)
  const pending = useRef(new Map<string, { value: unknown; previous: unknown; chained: boolean }>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => {
    cascade.current ??= new LabelCascade()
    const now: Record<string, unknown> = {}
    for (const l of labels) now[l.key] = computed[l.key] ? computed[l.key].value : (values[l.key] ?? null)
    // What the form opens with is not a change.
    if (!prev.current) { prev.current = now; return }
    for (const l of labels) {
      const before = prev.current[l.key]
      const after = now[l.key]
      if (sameLabelValue(before, after)) continue
      const queued = pending.current.get(l.key)
      pending.current.set(l.key, { value: after, previous: queued ? queued.previous : before, chained: Boolean(queued?.chained) || cascade.current.note() })
    }
    prev.current = now
    if (!pending.current.size) return
    if (!hasLabelRules) { pending.current.clear(); return }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      const batch = [...pending.current].filter(([, p]) => !sameLabelValue(p.value, p.previous))
      pending.current.clear()
      const api = rulesRef.current
      const gate = cascade.current!
      if (!batch.length || !api) return
      if (!gate.begin(batch.some(([, p]) => p.chained))) {
        console.warn(`[forms] "Label changes" rules stopped after ${LABEL_LIMITS.chain} rounds: they keep changing labels (${batch.map(([k]) => k).join(', ')}).`)
        return
      }
      void (async () => {
        try {
          for (const [key, p] of batch) await api.run({ type: 'label_change', target: key, context: { field: key, value: p.value, previous: p.previous } })
        } finally {
          gate.end()
        }
      })()
    }, LABEL_LIMITS.debounceMs)
  })
  return null
}
