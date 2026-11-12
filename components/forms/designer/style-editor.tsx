'use client'

import { Plus, X } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { cn } from '@/lib/utils'
import {
  ROW_STYLE_LIMIT, STYLE_FLAGS, STYLE_FLAG_LABELS, STYLE_TONES, STYLE_TONE_LABELS, describeStyle, normalizeConditionalStyle, styleAttributes,
  type ConditionalStyle, type ListRowStyle, type StyleFlag,
} from '@/lib/forms/conditional-style'
import type { DesignerState } from '@/lib/forms/designer-state'
import type { DataTableConditionGroup } from '@/lib/forms/data-table'
import type { ListColumn } from '@/lib/forms/list-field'
import { actionStyle, type FieldButtonAction } from '@/lib/forms/field-buttons'
import { ToneIcon } from '../conditional-style'
import { GroupEditor } from './data-table-properties'
import { designerInputClass as inputClass } from './designer-controls'

/**
 * Conditional styling in the designer (lib/forms/conditional-style.ts): the
 * tone and switches with a live preview chip (shared), the set_style rule
 * action's targets, and a List's "Row styles".
 */

/** The tone swatches, the switches and a live preview of the style. */
export function StyleControls({ style, onChange, idBase }: { style: ConditionalStyle | null | undefined; onChange: (next: ConditionalStyle | undefined) => void; idBase: string }) {
  const current: ConditionalStyle = style ?? {}
  const set = (patch: Partial<ConditionalStyle>) => onChange(normalizeConditionalStyle({ ...current, ...patch }) ?? undefined)
  const tone = current.tone
  return (
    <div className="space-y-1.5" data-style-controls>
      <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-1">
        {STYLE_TONES.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={tone === t} title={STYLE_TONE_LABELS[t]}
            onClick={() => set({ tone: t, ...(STYLE_FLAGS.some((f) => current[f]) ? {} : { background: true, text: true }) })}
            className={cn('inline-flex h-7 items-center gap-1 rounded border px-1.5 text-2xs font-medium', tone === t ? 'border-primary ring-1 ring-primary' : 'border-border')}
            data-style-tone={t}>
            <span aria-hidden className="size-3 rounded-sm" {...styleAttributes({ tone: t, background: true, border: true })} />
            {STYLE_TONE_LABELS[t].replace(/ \(.*\)$/, '')}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
        {STYLE_FLAGS.map((flag: StyleFlag) => (
          <label key={flag} className="flex items-center gap-1.5 text-2xs" htmlFor={`${idBase}-${flag}`}>
            <input id={`${idBase}-${flag}`} type="checkbox" className="accent-primary" checked={Boolean(current[flag])}
              onChange={(e) => set({ [flag]: e.target.checked || undefined })} data-style-flag={flag} />
            {STYLE_FLAG_LABELS[flag]}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-2xs text-fg-muted">Preview</span>
        {style
          ? (
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs" {...styleAttributes(style)} data-cs-box="" data-style-preview>
              {style.icon && <ToneIcon tone={style.tone ?? 'neutral'} size={12} />}
              <span data-cs-value>USD 1,250.00</span>
            </span>
          )
          : <span className="text-2xs italic text-fg-muted" data-style-preview="none">Choose a colour or an emphasis</span>}
      </div>
      {style && (style.background || style.text || style.border) && !style.icon && !style.bold && (
        <p className="text-2xs text-fg-muted" data-style-a11y-hint>Don&apos;t rely on colour alone: turn on the icon (or bold) so everyone can see the change.</p>
      )}
    </div>
  )
}

/** The set_style rule action: the fields / sections it styles, and the style. */
export function SetStyleEditor({ action, state, onChange, idBase }: { action: FieldButtonAction; state: DesignerState; onChange: (next: FieldButtonAction, tag?: string) => void; idBase: string }) {
  const options = [
    ...(state.layout.sections ?? []).map((s) => ({ target: `section:${s.key}`, label: `Section: ${s.title || s.key}`, hint: 'Section' })),
    ...state.fields.filter((f) => f.type === 'heading').map((f) => ({ target: `section:${f.key}`, label: `Heading section: ${f.label || f.key}`, hint: 'Section' })),
    ...state.fields.filter((f) => f.type !== 'divider' && f.type !== 'button').map((f) => ({ target: `field:${f.key}`, label: f.label || f.key, hint: 'Field' })),
  ]
  const chosen = action.targets ?? []
  const style = actionStyle(action)
  return (
    <>
      <AutocompleteSelect value="" placeholder="+ Add a field or section…" options={options.filter((o) => !chosen.includes(o.target)).map((o) => ({ value: o.target, label: o.label, hint: o.hint }))}
        onChange={(v) => { if (v) onChange({ ...action, targets: [...chosen, v] }) }} />
      <ul className="space-y-1">
        {chosen.map((t) => (
          <li key={t} className="flex items-center gap-1 text-2xs" data-target={t}><span className="flex-1 truncate">{options.find((o) => o.target === t)?.label ?? `${t} (missing)`}</span>
            <button type="button" className="rounded p-0.5" aria-label={`Remove ${options.find((o) => o.target === t)?.label ?? t}`} onClick={() => onChange({ ...action, targets: chosen.filter((x) => x !== t) })}><X size={10} /></button></li>
        ))}
      </ul>
      <StyleControls style={style} idBase={idBase} onChange={(next) => onChange({ ...action, style: next })} />
      <p className="text-2xs text-fg-muted">Styled while the condition holds, back to normal when it doesn&apos;t. Several rules on one field combine (the later rule wins per setting). Presentation only — it never changes what is submitted. Colours follow the theme and stay readable in light and dark.</p>
    </>
  )
}

/** A List's row styles (any level): a condition per row and the style of the row or of one column's cell. */
export function RowStylesEditor({ items, onChange, subjects, columns, idBase, tagBase }: {
  items: ListRowStyle<DataTableConditionGroup>[]
  onChange: (next: ListRowStyle<DataTableConditionGroup>[] | undefined, tag?: string) => void
  subjects: Array<{ value: string; label: string }>
  columns: ListColumn[]
  idBase: string
  tagBase: string
}) {
  const placeholders = subjects.map((s) => ({ name: s.value, group: s.value.startsWith('row.') ? 'This row' : s.value.startsWith('parent.') ? 'Parent row' : s.value.startsWith('user.') ? 'Current user' : 'This form', label: s.label }))
  const set = (next: ListRowStyle<DataTableConditionGroup>[], tag?: string) => onChange(next.length ? next : undefined, tag)
  return (
    <div className="space-y-1" data-list-row-styles>
      <p className="text-2xs font-semibold text-fg-muted">Row styles (colour a row or a cell when the condition holds)</p>
      {items.map((s, i) => (
        <div key={i} className="space-y-1 rounded border border-border p-1.5" data-list-row-style={i}>
          <div className="flex items-center gap-1">
            <span className="text-2xs font-medium text-fg-muted">Style when</span>
            <span className="truncate text-2xs text-fg-muted">— {describeStyle(s.style)}</span>
            <button type="button" className="ml-auto rounded p-0.5" aria-label={`Remove row style ${i + 1}`} onClick={() => set(items.filter((_, j) => j !== i))}><X size={11} /></button>
          </div>
          <GroupEditor group={s.if} depth={0} columns={subjects} placeholders={placeholders}
            onChange={(next, tag) => (next ? set(items.map((x, j) => (j === i ? { ...x, if: next } : x)), tag ? `${tagBase}-rsif-${i}-${tag}` : undefined) : set(items.filter((_, j) => j !== i)))} />
          <label className="block text-2xs">Style
            <select className={inputClass} value={s.column ?? ''} onChange={(e) => set(items.map((x, j) => (j === i ? (e.target.value ? { ...x, column: e.target.value } : { if: x.if, style: x.style }) : x)))} data-list-row-style-column>
              <option value="">The whole row</option>
              {columns.filter((c) => c.type !== 'list').map((c) => <option key={c.key} value={c.key}>Only the {c.label} cell</option>)}
            </select>
          </label>
          <StyleControls style={s.style} idBase={`${idBase}-rs${i}`} onChange={(next) => { if (next) set(items.map((x, j) => (j === i ? { ...x, style: next } : x)), `${tagBase}-rs-${i}`) }} />
        </div>
      ))}
      {items.length < ROW_STYLE_LIMIT && (
        <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" disabled={!subjects.length}
          onClick={() => set([...items, { if: { match: 'all', conditions: [{ column: subjects[0]?.value ?? '', operator: 'is_set' }] }, style: { tone: 'warning', background: true, text: true, icon: true } }])} data-list-add-row-style>
          <Plus size={11} /> Add row style
        </button>
      )}
    </div>
  )
}
