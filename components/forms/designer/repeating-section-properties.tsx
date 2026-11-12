'use client'

import { useState } from 'react'
import { ListChecks, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent } from '@/components/ui/dialog'
import { sectionView, type DesignerField, type DesignerState } from '@/lib/forms/designer-state'
import {
  REPEATING_LIMITS, maxItems, repeatingCountKey, repeatingTotalKey, singularLabel, type RepeatingSectionConfig, type RepeatingSectionTotal,
} from '@/lib/forms/repeating-section'
import { LIST_TOTAL_FNS, LIST_TOTAL_FN_LABELS } from '@/lib/forms/list-field'
import { isDisplayField } from '@/lib/task-field-schema'
import { cn } from '@/lib/utils'
import { designerInputClass as inputClass } from './designer-controls'
import { RulesPanel } from './rules-panel'

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function num(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined
}

const NUMERIC = new Set(['number', 'currency', 'rating', 'slider', 'nps', 'csat'])

/**
 * A repeating section's settings (lib/forms/repeating-section.ts): the Add
 * button's text, each card's title, min / max / starting items, remove /
 * reorder / collapse / confirm, totals, and the rules that run in each item
 * (the rules panel on the section's inner form). Its controls are placed on
 * the section's own grid in the canvas.
 */
export function RepeatingSectionProperties({ state, field, onPatch }: {
  /** The designer state the section sits in (the form, or the section holding it). */
  state: DesignerState
  field: DesignerField
  onPatch: (config: RepeatingSectionConfig, tag?: string) => void
}) {
  const config: RepeatingSectionConfig = field.repeating_section ?? { fields: [] }
  const [rulesOpen, setRulesOpen] = useState(false)
  const id = (name: string) => `rs-${field._id}-${name}`
  const set = (patch: Partial<RepeatingSectionConfig>, tag?: string) => {
    const next = { ...config, ...patch } as Record<string, unknown>
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
    onPatch(next as unknown as RepeatingSectionConfig, tag)
  }
  const valueFields = config.fields.filter((f) => !isDisplayField(f) && f.type !== 'label')
  const totals = config.totals ?? []
  const setTotals = (next: RepeatingSectionTotal[]) => set({ totals: next.length ? next : undefined })
  const view = sectionView(state, field._id)
  const ruleCount = config.layout?.rules?.length ?? 0
  const singular = singularLabel(field.label || 'Item')
  const toggle = (key: 'allow_remove' | 'allow_reorder' | 'collapsible' | 'confirm_remove', label: string, defaultOn: boolean) => {
    const on = defaultOn ? config[key] !== false : config[key] === true
    return (
      <label className="flex items-center gap-1.5 text-2xs">
        <input className="accent-primary" type="checkbox" checked={on} onChange={(e) => set({ [key]: defaultOn ? (e.target.checked ? undefined : false) : (e.target.checked || undefined) })} data-rs-setting={key} />
        {label}
      </label>
    )
  }

  return (
    <fieldset className="min-w-0 space-y-3 border-t border-border pt-3" data-repeating-properties>
      <legend className="pr-2 text-2xs font-semibold text-fg-muted">Repeating section</legend>
      <p className="text-2xs text-fg-muted">
        Drag controls into the section on the canvas — each item repeats them. {config.fields.length} control{config.fields.length === 1 ? '' : 's'} in each item.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor={id('add')}>Add button</Label>
          <input id={id('add')} className={inputClass} value={config.add_label ?? ''} placeholder={`Add ${singular.toLowerCase()}`} maxLength={REPEATING_LIMITS.addLabel}
            onChange={(e) => set({ add_label: e.target.value || undefined }, `rs-add-${field._id}`)} />
        </div>
        <div>
          <Label htmlFor={id('title')}>Item title</Label>
          <input id={id('title')} className={inputClass} value={config.item_title ?? ''} placeholder={`${singular} {{index}}`} maxLength={REPEATING_LIMITS.title}
            onChange={(e) => set({ item_title: e.target.value || undefined }, `rs-title-${field._id}`)} aria-describedby={id('title-hint')} />
        </div>
      </div>
      <p id={id('title-hint')} className="-mt-2 text-2xs text-fg-muted">
        Title placeholders: <code className="text-primary-text">{'{{index}}'}</code> (1, 2, 3…) and <code className="text-primary-text">{'{{item.<key>}}'}</code>{valueFields[0] ? <> — e.g. <code className="text-primary-text">{`{{item.${valueFields[0].key}}}`}</code></> : null}.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label htmlFor={id('min')}>Min items</Label>
          <input id={id('min')} type="number" min={1} className={inputClass} value={config.min_items ?? ''} onChange={(e) => set({ min_items: num(e.target.value) })} />
        </div>
        <div>
          <Label htmlFor={id('max')}>Max items</Label>
          <input id={id('max')} type="number" min={1} max={REPEATING_LIMITS.items} className={inputClass} value={config.max_items ?? ''} placeholder={String(REPEATING_LIMITS.defaultMaxItems)}
            onChange={(e) => set({ max_items: num(e.target.value) === undefined ? undefined : Math.min(REPEATING_LIMITS.items, num(e.target.value)!) })} />
        </div>
        <div>
          <Label htmlFor={id('start')}>Start with</Label>
          <input id={id('start')} type="number" min={1} max={maxItems(config)} className={inputClass} value={config.start_items ?? ''} placeholder="0"
            onChange={(e) => set({ start_items: num(e.target.value) })} />
        </div>
      </div>
      {config.min_items !== undefined && config.max_items !== undefined && config.min_items > config.max_items && <p className="text-2xs text-danger">Min items is greater than max items.</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {toggle('allow_remove', 'People can remove items', true)}
        {toggle('confirm_remove', 'Ask before removing', false)}
        {toggle('allow_reorder', 'People can reorder items', true)}
        {toggle('collapsible', 'Items can collapse', true)}
      </div>

      <div>
        <Label>Totals under the items</Label>
        <div className="space-y-1">
          {totals.map((total, i) => (
            <div key={i} className="flex items-center gap-1">
              <select aria-label={`Total ${i + 1} function`} className={cn(inputClass, 'w-24 flex-none')} value={total.fn}
                onChange={(e) => setTotals(totals.map((t, j) => (j === i ? { ...t, fn: e.target.value as RepeatingSectionTotal['fn'] } : t)))}>
                {LIST_TOTAL_FNS.map((fn) => <option key={fn} value={fn}>{LIST_TOTAL_FN_LABELS[fn]}</option>)}
              </select>
              <select aria-label={`Total ${i + 1} control`} className={cn(inputClass, 'flex-1')} value={total.field}
                onChange={(e) => setTotals(totals.map((t, j) => (j === i ? { ...t, field: e.target.value } : t)))}>
                {valueFields.filter((f) => total.fn === 'count' || NUMERIC.has(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
              </select>
              <button type="button" className="rounded p-0.5" aria-label={`Remove total ${i + 1}`} onClick={() => setTotals(totals.filter((_, j) => j !== i))}><X size={11} /></button>
            </div>
          ))}
          {valueFields.some((f) => NUMERIC.has(f.type)) && totals.length < REPEATING_LIMITS.totals && (
            <button type="button" className="text-2xs font-medium text-primary-text" onClick={() => setTotals([...totals, { field: valueFields.find((f) => NUMERIC.has(f.type))!.key, fn: 'sum' }])} data-rs-add-total>
              + Add a total
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <Button size="sm" variant="secondary" leadingIcon={<ListChecks />} onClick={() => setRulesOpen(true)} disabled={!view} data-rs-rules>
          Rules for each item{ruleCount ? ` (${ruleCount})` : ''}
        </Button>
        <p className="text-2xs text-fg-muted">
          Run in every item: show / hide, required, read only, styles, errors, set values. Read the item with <code className="text-primary-text">{'{{item.<key>}}'}</code>, the form with <code className="text-primary-text">{'{{form.<key>}}'}</code>{field.key ? '' : ''}.
        </p>
      </div>

      <p className="text-2xs text-fg-muted">
        Downstream: a list of items — loop over <code className="text-primary-text">{`{{form.${field.key}}}`}</code> and use <code className="text-primary-text">{'{{item.<key>}}'}</code>; <code className="text-primary-text">{`{{form.${repeatingCountKey(field.key)}}}`}</code>
        {totals.map((t) => <span key={`${t.fn}${t.field}`}>, <code className="text-primary-text">{`{{form.${repeatingTotalKey(field.key, t)}}}`}</code></span>)}. List rules (Add row, Set row values…) accept it as their List.
      </p>

      {rulesOpen && view && (
        <Dialog open onOpenChange={(open) => { if (!open) setRulesOpen(false) }}>
          <DialogContent size="xl" title={`Rules for each ${singular.toLowerCase()}`} description={`They run in every item of ${field.label || field.key}, with {{item.<key>}} the item.`}>
            <DialogBody className="max-h-[70vh] overflow-y-auto">
              <RulesPanel
                state={view}
                onChange={(next) => set({ layout: { rows: next.layout.rows, ...(next.layout.sections?.length ? { sections: next.layout.sections } : {}), ...(next.layout.rules?.length ? { rules: next.layout.rules } : {}) } }, `rs-rules-${field._id}`)}
              />
            </DialogBody>
          </DialogContent>
        </Dialog>
      )}
    </fieldset>
  )
}
