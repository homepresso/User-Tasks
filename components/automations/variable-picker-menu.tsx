'use client'

import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { PICKER_TYPE_LABELS, sampleText, type PickerRow } from '@/lib/variable-picker'
import { floatingSurfaceClass } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * The variable picker's list (VariableInput): grouped entries with their
 * readable label, the `{{path}}` beneath, a type badge and a sample value.
 * A row / object entry folds its columns under it ("Selected row ›").
 * ARIA listbox; the combobox is the editor (typed `{{`) or the search box
 * (the {x} button). Options are never focused: the combobox points at the
 * active one with aria-activedescendant.
 */

export function optionId(listboxId: string, index: number): string {
  return `${listboxId}-opt-${index}`
}

export function VariablePickerMenu({ listboxId, rows, active, onActive, onPick, onToggle, note, query, search, position, empty }: {
  listboxId: string
  rows: PickerRow[]
  active: number
  onActive: (index: number) => void
  onPick: (index: number) => void
  onToggle: (path: string) => void
  note?: string
  query: string
  /** The {x} button's search box (absent when the editor drives the query). */
  search?: React.ReactNode
  position: { left: number; top: number; width: number }
  empty: string
}) {
  const groups: Array<{ group: string; start: number; rows: PickerRow[] }> = []
  rows.forEach((row, i) => {
    const last = groups[groups.length - 1]
    if (last && last.group === row.group) last.rows.push(row)
    else groups.push({ group: row.group, start: i, rows: [row] })
  })
  return (
    <div
      className={cn('absolute z-50 overflow-hidden border border-border', floatingSurfaceClass)}
      style={{ left: position.left, top: position.top, width: position.width }}
      data-variable-picker
      onMouseDown={(e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault() }}
    >
      {search && (
        <div className="flex items-center gap-1.5 border-b border-border-subtle px-2.5 py-1.5">
          <Search size={14} aria-hidden className="shrink-0 text-fg-muted" />
          {search}
        </div>
      )}
      {note && <p className="border-b border-border-subtle px-2.5 py-1.5 text-xs text-fg-muted" data-variable-picker-note>{note}</p>}
      <div id={listboxId} role="listbox" aria-label="Variables" className="max-h-72 overflow-y-auto p-1">
        {rows.length === 0 && <p className="px-2 py-2 text-xs text-fg-muted" role="presentation">{empty}{query ? ` for “${query}”` : ''}</p>}
        {groups.map((g) => (
          <div key={`${g.group}-${g.start}`} role="group" aria-labelledby={`${listboxId}-g-${g.start}`}>
            <div id={`${listboxId}-g-${g.start}`} role="presentation" className="sticky top-0 z-[1] bg-elevated px-2 pb-1 pt-2 text-xs font-medium text-fg-muted">
              {g.group}
            </div>
            {g.rows.map((row, j) => {
              const index = g.start + j
              const isActive = index === active
              const item = row.item
              const sample = row.kind === 'whole' ? undefined : item.sample
              return (
                <div
                  key={`${row.kind}-${item.path}-${index}`}
                  id={optionId(listboxId, index)}
                  role="option"
                  aria-selected={isActive}
                  data-variable-option={row.kind === 'whole' ? `${item.path}#whole` : item.path}
                  className={cn('flex min-h-8 cursor-pointer items-start gap-1.5 rounded-md px-2 py-1 text-ui text-fg', isActive && 'bg-subtle')}
                  style={{ paddingLeft: 8 + row.depth * 14 }}
                  onMouseEnter={() => onActive(index)}
                  onMouseDown={(e) => { e.preventDefault(); onPick(index) }}
                >
                  {row.expandable ? (
                    <button type="button" tabIndex={-1} aria-hidden className="mt-0.5 shrink-0 rounded-sm text-fg-muted hover:bg-muted hover:text-fg" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(item.path) }}>
                      {row.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  ) : <span className="w-3.5 shrink-0" aria-hidden />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="truncate font-medium">{row.kind === 'whole' ? `Insert the whole ${item.type === 'row' ? 'row' : 'value'}` : item.label}</span>
                      {row.expandable && !row.expanded && <span className="shrink-0 text-2xs text-fg-subtle">pick a column ›</span>}
                    </span>
                    {!item.plain && <code className="block truncate font-mono text-2xs text-fg-muted">{`{{${item.path}}}`}</code>}
                    {item.hint && row.kind === 'item' && isActive && <span className="block text-2xs text-fg-muted">{item.hint}</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5">
                    {!item.plain && <span className="text-2xs text-fg-subtle" data-variable-type={item.type}>{PICKER_TYPE_LABELS[item.type]}</span>}
                    {sample !== undefined && <span className="max-w-[7rem] truncate font-mono text-2xs text-fg-muted" title={sampleText(sample)} data-variable-sample>= {sampleText(sample)}</span>}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <p className="border-t border-border-subtle px-2.5 py-1 text-2xs text-fg-subtle" aria-hidden>
        ↑↓ move · Enter / Tab insert · → columns · Esc close
      </p>
    </div>
  )
}
