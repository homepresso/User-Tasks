'use client'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { resolveRuleTemplate } from '@/lib/forms/form-rules'
import type { FormLayout } from '@/lib/forms/layout'
import {
  addItem, addItemLabel, canAddItem, canRemoveItem, describeRepeatingValue, innerFormLayout, isItemKey, itemScopeValues, itemTitle, maxItems, moveItem, newItem,
  removeItem, repeatingDerivedValues, repeatingItems, repeatingTotalKey, singularLabel,
} from '@/lib/forms/repeating-section'
import type { TaskFieldDef } from '@/lib/task-field-schema'

/**
 * A repeating section (lib/forms/repeating-section.ts): one card per item —
 * a fieldset whose legend is the item's title, with Collapse, Move up / down
 * and Remove (confirmed when the author asked) — the inner controls on their
 * own grid (one column on phones), then Add and the totals.
 *
 * Each item is the form renderer again (`Renderer`, passed in by
 * components/forms/form-renderer.tsx), scoped to the item: its values are
 * the form's with the item's over them plus `item` / `row` / `parent`, its
 * rules are the inner layout's (per item), its errors the item's paths
 * (`expenses[1].amount` → `amount`). A change to an inner control writes
 * the item; a change a rule makes to a form field goes to the form.
 */

export interface ItemRendererProps {
  fields: TaskFieldDef[]
  layout: FormLayout
  values: Record<string, unknown>
  onChange?: (key: string, value: unknown) => void
  errors?: Record<string, string>
  readOnly?: boolean
  singleColumn?: boolean
  compact?: boolean
  idPrefix: string
}

export type ItemRenderer = (props: ItemRendererProps) => React.ReactNode

let idCounter = 0
const nextItemId = () => `i${(idCounter += 1).toString(36)}`

/** Stable React keys for items (kept beside the value, never in it): follow adds, removes and moves made here; appended for items a rule added. */
function useItemIds(count: number) {
  const ids = useRef<string[]>([])
  if (ids.current.length < count) ids.current = [...ids.current, ...Array.from({ length: count - ids.current.length }, nextItemId)]
  if (ids.current.length > count) ids.current = ids.current.slice(0, count)
  return ids
}

/** The errors of item `index` below the section key (`expenses[1].amount` → `amount`). */
export function itemErrors(errors: Record<string, string> | undefined, key: string, index: number): Record<string, string> {
  const prefix = `${key}[${index}].`
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(errors ?? {})) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v
  return out
}

function formatTotal(field: TaskFieldDef | undefined, fn: string, value: number | null): string {
  if (value === null) return '—'
  if (fn !== 'count' && field?.type === 'currency') {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: field.currency ?? 'USD' }).format(value) } catch { /* plain below */ }
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value)
}

function Totals({ field, items }: { field: TaskFieldDef; items: Record<string, unknown>[] }) {
  const config = field.repeating_section
  if (!config?.totals?.length) return null
  const derived = repeatingDerivedValues(field.key, config, items)
  return (
    <dl className="flex flex-wrap justify-end gap-x-5 gap-y-1 text-xs" data-repeating-totals>
      {config.totals.map((t) => {
        const inner = config.fields.find((f) => f.key === t.field)
        const label = t.label ?? `${t.fn === 'sum' ? 'Total' : t.fn === 'avg' ? 'Average' : 'Count'} ${(inner?.label ?? t.field).toLowerCase()}`
        return (
          <div key={`${t.field}-${t.fn}`} className="flex items-baseline gap-1.5">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="font-semibold tabular-nums text-fg">{formatTotal(inner, t.fn, derived[repeatingTotalKey(field.key, t)] ?? null)}</dd>
          </div>
        )
      })}
    </dl>
  )
}

export function RepeatingSectionField({ field, value, onChange, formValues, onFormChange, errors, error, id, idPrefix, readOnly = false, disabled = false, narrow, compact, Renderer, defaultCollapsed = false }: {
  /** Summaries (submission views): the cards start collapsed — the count and the titles, expandable. */
  defaultCollapsed?: boolean
  field: TaskFieldDef
  value: unknown
  /** The section's new items. */
  onChange?: (items: Record<string, unknown>[]) => void
  /** The form's values (the item scope's base). */
  formValues: Record<string, unknown>
  /** A form field a rule inside an item changed. */
  onFormChange?: (key: string, value: unknown) => void
  /** Every error of the form (the items' paths are picked out). */
  errors?: Record<string, string>
  /** The section's own error (min / max items, the summary). */
  error?: string
  id: string
  idPrefix: string
  readOnly?: boolean
  /** Read only by a rule / the field: items show, nothing changes. */
  disabled?: boolean
  narrow?: boolean
  compact?: boolean
  Renderer: ItemRenderer
}) {
  const config = field.repeating_section
  const items = useMemo(() => repeatingItems(value), [value])
  const ids = useItemIds(items.length)
  const latest = useRef(items)
  useLayoutEffect(() => { latest.current = items }, [items])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(defaultCollapsed ? ids.current : []))
  const [confirming, setConfirming] = useState<number | null>(null)
  const [announce, setAnnounce] = useState('')
  const editable = !readOnly && !disabled && Boolean(onChange)
  const layout = useMemo(() => innerFormLayout(config), [config])
  const singular = singularLabel(field.label).toLowerCase()
  const parent = formValues.item && typeof formValues.item === 'object' && !Array.isArray(formValues.item) ? formValues.item as Record<string, unknown> : null

  const commit = (next: Record<string, unknown>[]) => {
    latest.current = next
    onChange?.(next)
  }
  const focusItem = (itemId: string) => requestAnimationFrame(() => {
    const body = document.getElementById(`${id}-item-${itemId}-body`)
    const target = body?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable=true], button:not([disabled])')
    ;(target ?? document.getElementById(`${id}-item-${itemId}-title`))?.focus()
  })
  const add = () => {
    const current = latest.current
    if (!canAddItem(config, current.length)) return
    const item = newItem(config, (text) => resolveRuleTemplate(text, { values: formValues }))
    const itemId = nextItemId()
    ids.current = [...ids.current.slice(0, current.length), itemId]
    commit(addItem(config, current, item))
    setAnnounce(`${singularLabel(field.label)} ${current.length + 1} added`)
    focusItem(itemId)
  }
  const remove = (index: number) => {
    const current = latest.current
    const next = removeItem(config, current, index, field.required)
    if (next === current) return
    ids.current = ids.current.filter((_, i) => i !== index)
    commit(next)
    setAnnounce(`${itemTitle(field, current[index] ?? {}, index)} removed`)
    // Focus stays in the section: the item that took its place, else the one before, else Add.
    const to = ids.current[Math.min(index, ids.current.length - 1)]
    requestAnimationFrame(() => (to ? document.getElementById(`${id}-item-${to}-title`) : document.getElementById(`${id}-add`))?.focus())
  }
  const move = (index: number, delta: number) => {
    const current = latest.current
    const next = moveItem(config, current, index, delta)
    if (next === current) return
    const order = [...ids.current]
    const [moved] = order.splice(index, 1)
    order.splice(index + delta, 0, moved)
    ids.current = order
    commit(next)
    setAnnounce(`${itemTitle(field, current[index] ?? {}, index)} moved to position ${index + delta + 1}`)
    requestAnimationFrame(() => document.getElementById(`${id}-item-${moved}-${delta < 0 ? 'up' : 'down'}`)?.focus())
  }
  const changeItem = (index: number) => (key: string, v: unknown) => {
    if (!isItemKey(config, key)) { onFormChange?.(key, v); return }
    const current = latest.current
    if (!current[index] || current[index][key] === v) return
    commit(current.map((item, i) => (i === index ? { ...item, [key]: v } : item)))
  }
  const toggle = (itemId: string) => setCollapsed((prev) => { const next = new Set(prev); if (next.has(itemId)) next.delete(itemId); else next.add(itemId); return next })

  const required = field.required && !readOnly && !disabled
  const removable = editable && canRemoveItem(config, items.length, field.required)
  const reorder = editable && config?.allow_reorder !== false && items.length > 1
  const collapsible = config?.collapsible !== false
  const max = maxItems(config)
  const describedBy = [field.help_text ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined

  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy} data-repeating-section={field.key} className="min-w-0">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
        <span id={`${id}-label`} className={cn('font-medium text-fg-muted', compact ? 'text-2xs' : 'text-xs')}>
          {field.label}
          {required && <span className="ml-0.5 text-(--status-blocked)" aria-hidden>*</span>}
        </span>
        <span className="text-2xs text-fg-subtle" data-repeating-count>{items.length ? describeRepeatingValue(items, field) : readOnly ? '' : `No ${field.label.toLowerCase()} yet`}</span>
      </div>
      {field.help_text && <p id={`${id}-help`} className="-mt-1 mb-1.5 text-2xs text-fg-muted">{field.help_text}</p>}
      {readOnly && !items.length ? <p className="text-sm text-fg">—</p> : null}
      {items.length > 0 && (
        <ol className="flex list-none flex-col gap-3 p-0">
          {items.map((item, i) => {
            const itemId = ids.current[i] ?? `idx-${i}`
            const title = itemTitle(field, item, i)
            const own = itemErrors(errors, field.key, i)
            const hasErrors = Object.keys(own).length > 0
            const isCollapsed = collapsible && collapsed.has(itemId)
            const bodyId = `${id}-item-${itemId}-body`
            return (
              <li key={itemId} className="min-w-0">
                <fieldset
                  id={`${id}-item-${itemId}`}
                  className={cn('min-w-0 rounded-lg border bg-panel', hasErrors ? 'border-(--status-blocked)' : 'border-border')}
                  data-repeating-item={i}
                  aria-describedby={hasErrors ? `${id}-item-${itemId}-errors` : undefined}
                >
                  <legend className="float-left flex w-full min-w-0 items-center gap-1 border-b border-border px-2 py-1.5">
                    {collapsible && (
                      <IconButton size="sm" variant="ghost" icon={isCollapsed ? <ChevronRight /> : <ChevronDown />} label={`${isCollapsed ? 'Expand' : 'Collapse'} ${title}`}
                        aria-expanded={!isCollapsed} aria-controls={bodyId} onClick={() => toggle(itemId)} data-item-tool="collapse" />
                    )}
                    <span id={`${id}-item-${itemId}-title`} tabIndex={-1} className="min-w-0 flex-1 truncate px-1 text-ui font-medium text-fg outline-none">{title}</span>
                    {hasErrors && <span id={`${id}-item-${itemId}-errors`} className="shrink-0 text-2xs font-medium text-(--status-blocked)">{Object.keys(own).length === 1 ? '1 problem' : `${Object.keys(own).length} problems`}</span>}
                    {reorder && (
                      <>
                        <IconButton id={`${id}-item-${itemId}-up`} size="sm" variant="ghost" icon={<ArrowUp />} label={`Move ${title} up`} disabled={i === 0} onClick={() => move(i, -1)} data-item-tool="up" />
                        <IconButton id={`${id}-item-${itemId}-down`} size="sm" variant="ghost" icon={<ArrowDown />} label={`Move ${title} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)} data-item-tool="down" />
                      </>
                    )}
                    {removable && (
                      <IconButton size="sm" variant="danger-ghost" icon={<Trash2 />} label={`Remove ${title}`} onClick={() => (config?.confirm_remove ? setConfirming(i) : remove(i))} data-item-tool="remove" />
                    )}
                  </legend>
                  <div id={bodyId} hidden={isCollapsed} className="clear-both p-3" data-repeating-item-body>
                    <Renderer
                      fields={config?.fields ?? []}
                      layout={layout}
                      values={itemScopeValues(formValues, item, parent)}
                      onChange={editable ? changeItem(i) : undefined}
                      errors={own}
                      readOnly={readOnly || disabled || !onChange}
                      singleColumn={narrow}
                      compact={compact}
                      idPrefix={`${idPrefix}${field.key}-${itemId}-`}
                    />
                  </div>
                </fieldset>
              </li>
            )
          })}
        </ol>
      )}
      {(editable || (config?.totals?.length && items.length > 0)) && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {editable && (
            <Button id={`${id}-add`} type="button" variant="secondary" size="sm" leadingIcon={<Plus />} onClick={add} disabled={!canAddItem(config, items.length)} data-repeating-add>
              {addItemLabel(field)}
            </Button>
          )}
          {editable && !canAddItem(config, items.length) && <span className="text-2xs text-fg-muted">At most {max} {max === 1 ? singular : field.label.toLowerCase()}</span>}
          <div className="ml-auto"><Totals field={field} items={items} /></div>
        </div>
      )}
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-2xs text-(--status-blocked)">{error}</p>}
      <p className="sr-only" aria-live="polite">{announce}</p>
      {confirming !== null && (
        <ConfirmDialog
          open
          onOpenChange={(open) => { if (!open) setConfirming(null) }}
          title={`Remove ${itemTitle(field, items[confirming] ?? {}, confirming)}?`}
          description={`What was entered in this ${singular} is removed from the form.`}
          confirmLabel={`Remove ${singular}`}
          destructive
          onConfirm={() => { const at = confirming; setConfirming(null); remove(at) }}
        />
      )}
    </div>
  )
}
