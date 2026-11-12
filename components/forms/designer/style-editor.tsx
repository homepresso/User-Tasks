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
import {
  TEXT_COLOR_LABELS, TEXT_COLOR_TOKENS, TEXT_FONTS, TEXT_FONT_KEYS, TEXT_SIZE_LABELS, TEXT_SIZE_PRESETS, describeTextStyle, normalizeTextColor, normalizeTextSize,
  normalizeTextStyle, textStyleProps, type ControlTextStyle, type TextFont, type TextSizePreset, type TextStyle,
} from '@/lib/forms/text-style'
import { CELL_RULE_LIMIT, type ListCellRule } from '@/lib/forms/conditional-style'

/** Size, font and colour pickers (whitelisted values only — lib/forms/text-style.ts). */
export function FontPickers({ value, onChange, idBase }: { value: Pick<TextStyle, 'size' | 'font' | 'color'>; onChange: (patch: Pick<TextStyle, 'size' | 'font' | 'color'>) => void; idBase: string }) {
  const preset = value.size && (TEXT_SIZE_PRESETS as readonly string[]).includes(value.size) ? value.size : value.size ? 'px' : ''
  const hex = value.color?.startsWith('#') ? value.color : ''
  return (
    <div className="grid grid-cols-3 gap-1" data-font-pickers>
      <label className="block text-2xs" htmlFor={`${idBase}-size`}>Size
        <select id={`${idBase}-size`} className={inputClass} value={preset} data-text-size
          onChange={(e) => onChange({ ...value, size: e.target.value === 'px' ? '14px' : e.target.value || undefined })}>
          <option value="">Default</option>
          {TEXT_SIZE_PRESETS.map((s) => <option key={s} value={s}>{TEXT_SIZE_LABELS[s as TextSizePreset]}</option>)}
          <option value="px">Exact (px)</option>
        </select>
        {preset === 'px' && (
          <input type="number" min={8} max={48} step={0.5} className={inputClass} aria-label="Font size in pixels" value={parseFloat(value.size ?? '14')} data-text-size-px
            onChange={(e) => onChange({ ...value, size: normalizeTextSize(`${e.target.value}px`) ?? value.size })} />
        )}
      </label>
      <label className="block text-2xs" htmlFor={`${idBase}-font`}>Font
        <select id={`${idBase}-font`} className={inputClass} value={value.font ?? ''} data-text-font onChange={(e) => onChange({ ...value, font: (e.target.value || undefined) as TextFont | undefined })}>
          <option value="">Theme default</option>
          {TEXT_FONT_KEYS.map((f) => <option key={f} value={f}>{TEXT_FONTS[f].label}</option>)}
        </select>
      </label>
      <label className="block text-2xs" htmlFor={`${idBase}-color`}>Colour
        <select id={`${idBase}-color`} className={inputClass} value={hex ? 'hex' : value.color ?? ''} data-text-color
          onChange={(e) => onChange({ ...value, color: e.target.value === 'hex' ? (hex || '#1f4e79') : e.target.value || undefined })}>
          <option value="">Default</option>
          {TEXT_COLOR_TOKENS.map((t) => <option key={t} value={t}>{TEXT_COLOR_LABELS[t]}</option>)}
          <option value="hex">Custom colour…</option>
        </select>
        {hex && (
          <span className="mt-0.5 flex items-center gap-1">
            <input type="color" aria-label="Custom text colour" value={hex} className="h-7 w-8 cursor-pointer rounded border border-border" data-text-color-hex
              onChange={(e) => onChange({ ...value, color: normalizeTextColor(e.target.value) ?? value.color })} />
            <code className="text-2xs">{hex}</code>
          </span>
        )}
      </label>
    </div>
  )
}

/** A control's text style (its label or its value): size, font, colour, bold / italic / underline, with a preview. */
export function TextStyleControls({ style, onChange, idBase, sample = 'Sample text' }: { style: TextStyle | undefined; onChange: (next: TextStyle | undefined) => void; idBase: string; sample?: string }) {
  const current = style ?? {}
  const set = (patch: Partial<TextStyle>) => onChange(normalizeTextStyle({ ...current, ...patch }))
  return (
    <div className="space-y-1" data-text-style-controls>
      <FontPickers value={current} idBase={idBase} onChange={(patch) => set(patch)} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {(['bold', 'italic', 'underline'] as const).map((flag) => (
          <label key={flag} className="flex items-center gap-1 text-2xs" htmlFor={`${idBase}-${flag}`}>
            <input id={`${idBase}-${flag}`} type="checkbox" className="accent-primary" checked={Boolean(current[flag])} onChange={(e) => set({ [flag]: e.target.checked || undefined })} />
            {flag === 'bold' ? 'Bold' : flag === 'italic' ? 'Italic' : 'Underline'}
          </label>
        ))}
        <span className="ml-auto rounded border border-border px-1.5 py-0.5 text-sm" {...textStyleProps(style)} data-text-style-preview>{sample}</span>
      </div>
    </div>
  )
}

/** Text styling of a field / List column: the label (List: the header) and the value (List: the cells). */
export function ControlTextStyleEditor({ value, onChange, idBase, labelName = 'Label', valueName = 'Value' }: {
  value: ControlTextStyle | undefined
  onChange: (next: ControlTextStyle | undefined, tag?: string) => void
  idBase: string
  labelName?: string
  valueName?: string
}) {
  const set = (part: 'label' | 'value', next: TextStyle | undefined) => {
    const out: ControlTextStyle = { ...(value ?? {}) }
    if (next) out[part] = next
    else delete out[part]
    onChange(out.label || out.value ? out : undefined, `${idBase}-${part}`)
  }
  return (
    <details className="rounded border border-border p-1.5" data-text-style-editor open={Boolean(value)}>
      <summary className="cursor-pointer text-2xs font-semibold text-fg-muted">Text style{value ? ` — ${[value.label ? `${labelName.toLowerCase()}: ${describeTextStyle(value.label)}` : '', value.value ? `${valueName.toLowerCase()}: ${describeTextStyle(value.value)}` : ''].filter(Boolean).join('; ')}` : ''}</summary>
      <div className="mt-1 space-y-2">
        <div><p className="text-2xs font-medium">{labelName}</p><TextStyleControls style={value?.label} idBase={`${idBase}-l`} sample={labelName} onChange={(next) => set('label', next)} /></div>
        <div><p className="text-2xs font-medium">{valueName}</p><TextStyleControls style={value?.value} idBase={`${idBase}-v`} sample="USD 1,250.00" onChange={(next) => set('value', next)} /></div>
        <p className="text-2xs text-fg-muted">Fonts fall back to safe web fonts; custom colours are adjusted to stay readable in light and dark mode.</p>
      </div>
    </details>
  )
}

/** A List's cell rules (any level): hide or lock one column's cell in the rows where the condition holds. */
export function CellRulesEditor({ items, onChange, subjects, columns, tagBase }: {
  items: ListCellRule<DataTableConditionGroup>[]
  onChange: (next: ListCellRule<DataTableConditionGroup>[] | undefined, tag?: string) => void
  subjects: Array<{ value: string; label: string }>
  columns: ListColumn[]
  tagBase: string
}) {
  const placeholders = subjects.map((s) => ({ name: s.value, group: s.value.startsWith('row.') ? 'This row' : s.value.startsWith('parent.') ? 'Parent row' : s.value.startsWith('user.') ? 'Current user' : 'This form', label: s.label }))
  const set = (next: ListCellRule<DataTableConditionGroup>[], tag?: string) => onChange(next.length ? next : undefined, tag)
  const effect = (r: ListCellRule<DataTableConditionGroup>) => (r.hide && r.read_only ? 'both' : r.hide ? 'hide' : 'read_only')
  return (
    <div className="space-y-1" data-list-cell-rules>
      <p className="text-2xs font-semibold text-fg-muted">Cell rules (hide or lock one cell in the rows where the condition holds)</p>
      {items.map((r, i) => (
        <div key={i} className="space-y-1 rounded border border-border p-1.5" data-list-cell-rule={i}>
          <div className="flex items-center gap-1">
            <span className="text-2xs font-medium text-fg-muted">When</span>
            <button type="button" className="ml-auto rounded p-0.5" aria-label={`Remove cell rule ${i + 1}`} onClick={() => set(items.filter((_, j) => j !== i))}><X size={11} /></button>
          </div>
          <GroupEditor group={r.if} depth={0} columns={subjects} placeholders={placeholders}
            onChange={(next, tag) => (next ? set(items.map((x, j) => (j === i ? { ...x, if: next } : x)), tag ? `${tagBase}-crif-${i}-${tag}` : undefined) : set(items.filter((_, j) => j !== i)))} />
          <div className="grid grid-cols-2 gap-1">
            <label className="block text-2xs">Then
              <select className={inputClass} value={effect(r)} data-list-cell-rule-effect
                onChange={(e) => set(items.map((x, j) => (j === i ? { if: x.if, column: x.column, ...(e.target.value !== 'read_only' ? { hide: true } : {}), ...(e.target.value !== 'hide' ? { read_only: true } : {}) } : x)))}>
                <option value="hide">Hide the cell</option>
                <option value="read_only">Make the cell read only</option>
                <option value="both">Hide and lock the cell</option>
              </select>
            </label>
            <label className="block text-2xs">Cell
              <select className={inputClass} value={r.column} data-list-cell-rule-column onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, column: e.target.value } : x)))}>
                {columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
          </div>
        </div>
      ))}
      {items.length < CELL_RULE_LIMIT && (
        <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" disabled={!subjects.length || !columns.length}
          onClick={() => set([...items, { if: { match: 'all', conditions: [{ column: subjects[0]?.value ?? '', operator: 'is_set' }] }, column: columns[0]?.key ?? '', read_only: true }])} data-list-add-cell-rule>
          <Plus size={11} /> Add cell rule
        </button>
      )}
      {items.length > 0 && <p className="text-2xs text-fg-muted">A hidden cell is empty (the column stays); it is not required or checked. A read-only cell shows its value, is not required, and the server keeps the value it had when the form opened (rows matched by the key column; without one, by position while the row count is unchanged). To hide a whole column, add a form rule that hides the column.</p>}
    </div>
  )
}

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
      <FontPickers value={{ size: current.size, font: current.font, color: current.color }} idBase={`${idBase}-font`} onChange={(patch) => set({ size: patch.size, font: patch.font, color: patch.color })} />
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
