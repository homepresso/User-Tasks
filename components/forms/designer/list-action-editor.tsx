'use client'

import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import type { DesignerState } from '@/lib/forms/designer-state'
import type { FieldButtonAction } from '@/lib/forms/field-buttons'
import { DISPLAY_FIELD_TYPES } from '@/lib/task-field-schema'
import { designerInputClass as inputClass } from './designer-controls'

/**
 * The row a List action aims at (remove / edit / update a row): the last,
 * the first, the selected row(s) — when the List has selection on — the row
 * of the event ({{event.row_number}}) or a number / expression; plus, for
 * the selection, the message when nothing is selected and (remove / clear)
 * the question asked first.
 */

type Placeholder = { name: string; group: string; label?: string }

const PRESETS = [
  { value: 'last', label: 'The last row' },
  { value: 'first', label: 'The first row' },
  { value: 'selected', label: 'Selected row(s)' },
  { value: '{{event.row_number}}', label: 'The row of the event (a row button / click)' },
]

export function RowTargetEditor({ action, state, placeholders, onChange, fallback }: {
  action: FieldButtonAction
  state: DesignerState
  placeholders: Placeholder[]
  onChange: (next: FieldButtonAction, tag?: string) => void
  fallback: string
}) {
  const list = state.fields.find((f) => f.key === action.list_field)
  const selectable = Boolean(list?.list?.selectable)
  const row = action.row ?? fallback
  const preset = PRESETS.some((p) => p.value === row) ? row : 'custom'
  return (
    <div className="space-y-1" data-row-target>
      <select className={inputClass} aria-label="Which row" value={preset} data-row-target-select
        onChange={(e) => onChange({ ...action, row: e.target.value === 'custom' ? '1' : e.target.value })}>
        {PRESETS.filter((p) => p.value !== 'selected' || selectable || row === 'selected').map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        <option value="custom">A row number or expression…</option>
      </select>
      {preset === 'custom' && (
        <VariableInput value={row} extraVariables={placeholders} placeholder="2, or {{form.row_to_change}}" ariaLabel="Row number" onChange={(v) => onChange({ ...action, row: v || fallback }, 'list-row')} />
      )}
      {row === 'selected' && !selectable && <p className="text-2xs text-danger" role="alert">Turn on Row selection in the List&apos;s properties first.</p>}
      {row === 'selected' && (
        <VariableInput value={action.empty_text ?? ''} extraVariables={placeholders} placeholder="When nothing is selected: Select a row first" ariaLabel="Message when nothing is selected"
          onChange={(v) => onChange({ ...action, empty_text: v || undefined }, 'list-empty')} />
      )}
    </div>
  )
}

export function ConfirmTextEditor({ action, placeholders, onChange }: { action: FieldButtonAction; placeholders: Placeholder[]; onChange: (next: FieldButtonAction, tag?: string) => void }) {
  return (
    <div className="space-y-1" data-confirm-text>
      <label className="flex items-center gap-1.5 text-2xs">
        <input type="checkbox" className="accent-primary" checked={Boolean(action.confirm_text)}
          onChange={(e) => onChange({ ...action, confirm_text: e.target.checked ? (action.type === 'clear_list' ? 'Clear all rows?' : 'Delete {{count}} row(s)?') : undefined })} />
        Ask first
      </label>
      {action.confirm_text && (
        <VariableInput value={action.confirm_text} extraVariables={[{ name: 'count', group: 'This step', label: 'Rows it removes' }, ...placeholders]} placeholder="Delete {{count}} rows?" ariaLabel="Question"
          onChange={(v) => onChange({ ...action, confirm_text: v || undefined }, 'list-confirm')} />
      )}
    </div>
  )
}

/** edit_list_row: which input gets which column of the row ({{row.<column>}}); cancel_list_edit: the inputs it resets. */
export function EditRowEditor({ action, state, placeholders, onChange }: { action: FieldButtonAction; state: DesignerState; placeholders: Placeholder[]; onChange: (next: FieldButtonAction, tag?: string) => void }) {
  const lists = state.fields.filter((f) => f.type === 'list')
  const list = lists.find((f) => f.key === action.list_field)
  const inputs = state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type) && f.type !== 'list')
  const assign = action.assign ?? {}
  return (
    <div className="space-y-1.5" data-edit-row-editor={action.type}>
      <AutocompleteSelect value={action.list_field ?? ''} placeholder="Which List…" options={lists.map((f) => ({ value: f.key, label: f.label || f.key }))} onChange={(v) => onChange({ ...action, list_field: v || undefined })} />
      {action.type === 'edit_list_row' && (
        <>
          <RowTargetEditor action={action} state={state} placeholders={placeholders} onChange={onChange} fallback="{{event.row_number}}" />
          {(list?.list?.columns ?? []).filter((c) => c.type !== 'calculated').map((c) => {
            const input = Object.entries(assign).find(([, t]) => t.replace(/\s/g, '') === `{{row.${c.key}}}`)?.[0] ?? ''
            return (
              <div key={c.key} className="grid grid-cols-[6rem_auto_minmax(0,1fr)] items-center gap-1 text-2xs">
                <span className="truncate">{c.label}</span><span aria-hidden>→</span>
                <AutocompleteSelect value={input} placeholder="Into the input…" clearable options={inputs.map((f) => ({ value: f.key, label: f.label || f.key }))}
                  onChange={(v) => { const next = Object.fromEntries(Object.entries(assign).filter(([, t]) => t.replace(/\s/g, '') !== `{{row.${c.key}}}`)); if (v) next[v] = `{{row.${c.key}}}`; onChange({ ...action, assign: next }) }} />
              </div>
            )
          })}
          <p className="text-2xs text-fg-muted">The row is marked Editing; the next “Add row to list” updates it instead of adding one.</p>
        </>
      )}
      {action.type === 'cancel_list_edit' && (
        <AutocompleteSelect value="" placeholder="+ Reset an input to its default…" options={inputs.filter((f) => !(action.fields ?? []).includes(f.key)).map((f) => ({ value: f.key, label: f.label || f.key }))}
          onChange={(v) => { if (v) onChange({ ...action, fields: [...(action.fields ?? []), v] }) }} />
      )}
      {action.type === 'cancel_list_edit' && (action.fields ?? []).length > 0 && (
        <p className="text-2xs text-fg-muted">Resets: {(action.fields ?? []).map((k) => inputs.find((f) => f.key === k)?.label ?? k).join(', ')}</p>
      )}
    </div>
  )
}

/* ── Editable table rules (lib/forms/row-rules.ts) ───────────────────── */

const ROW_PRESETS = [
  { value: 'current', label: 'The current row (the last New row, or one a rule made current)' },
  { value: 'selected', label: 'The selected row(s) (a Data table: the row last clicked)' },
  { value: '{{event.row_number}}', label: 'The row of the event' },
  { value: 'all_pending', label: 'Every pending row' },
]

type RowsFieldDef = DesignerState['fields'][number]

function rowColumns(f: RowsFieldDef | undefined): Array<{ key: string; label: string; read_only?: boolean; type?: string; hidden?: boolean }> {
  if (!f) return []
  if (f.type === 'list') return (f.list?.columns ?? []).filter((c) => c.type !== 'calculated')
  return (f.data_table?.columns ?? []).map((c) => ({ key: c.key, label: c.label, read_only: c.read_only, type: c.type, hidden: c.hidden }))
}

/**
 * New row / Set row values / Commit / Discard / Revert / Delete / Refresh on
 * a List or an editable Data table: the field, which row, the columns'
 * values, Stage vs Save now, the question first.
 */
export function RowActionEditor({ action, state, placeholders, onChange }: { action: FieldButtonAction; state: DesignerState; placeholders: Placeholder[]; onChange: (next: FieldButtonAction, tag?: string) => void }) {
  const choices = state.fields.filter((f) => (action.type === 'refresh_table' ? false : f.type === 'list') || (f.type === 'data_table' && f.data_table?.mode === 'edit'))
  const field = choices.find((f) => f.key === action.field)
  const columns = rowColumns(field)
  const values = action.values ?? {}
  const isTable = field?.type === 'data_table'
  const row = action.row ?? (action.type === 'delete_row' ? 'selected' : 'current')
  const preset = action.row_key ? 'key' : ROW_PRESETS.some((p) => p.value === row) ? row : 'custom'
  const rowPlaceholders = [
    ...columns.map((c) => ({ name: `row.${c.key}`, group: 'This row', label: c.label })),
    ...(field ? [{ name: `${field.key}_current_row`, group: 'This row', label: 'The current row' }] : []),
    ...placeholders,
  ]
  const setValue = (key: string, v: string) => { const next = { ...values }; if (v) next[key] = v; else delete next[key]; onChange({ ...action, values: Object.keys(next).length ? next : action.type === 'set_row_values' ? {} : undefined }, `row-val-${key}`) }
  return (
    <div className="space-y-1.5" data-row-action-editor={action.type}>
      <AutocompleteSelect value={action.field ?? ''} placeholder={choices.length ? (action.type === 'refresh_table' ? 'Which Data table…' : 'Which List or Data table…') : 'Add a List or an editable Data table first'}
        options={choices.map((f) => ({ value: f.key, label: `${f.label || f.key} (${f.type === 'list' ? 'List' : 'Data table'})` }))} onChange={(v) => onChange({ ...action, field: v || undefined })} />
      {action.type === 'new_row' && field && (
        <>
          <select className={inputClass} aria-label="Where the row goes" value={action.position ?? 'end'} onChange={(e) => onChange({ ...action, position: e.target.value as FieldButtonAction['position'] })}>
            <option value="end">At the end</option>
            <option value="start">At the top</option>
            {!isTable && <option value="after_selected">After the selected row</option>}
          </select>
          <p className="text-2xs font-medium">Values (besides each column&apos;s default)</p>
          {columns.map((c) => (
            <div key={c.key} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-1 text-2xs">
              <span className="truncate">{c.label}{c.read_only ? ' 🔒' : ''}</span>
              <VariableInput value={values[c.key] ?? ''} extraVariables={placeholders} placeholder="The column's default" ariaLabel={`New row ${c.label}`} onChange={(v) => setValue(c.key, v)} />
            </div>
          ))}
          <select className={inputClass} aria-label="Focus a column" value={action.focus_column ?? ''} onChange={(e) => onChange({ ...action, focus_column: e.target.value || undefined })}>
            <option value="">Don&apos;t move the focus</option>
            {columns.map((c) => <option key={c.key} value={c.key}>Focus {c.label}</option>)}
          </select>
          <p className="text-2xs text-fg-muted">The row is pending (“New”) and becomes the current row: {`{{form.${field.key}_current_row.<column>}}`}, {`{{form.${field.key}_current_index}}`}.</p>
        </>
      )}
      {action.type !== 'new_row' && action.type !== 'refresh_table' && field && (
        <div className="space-y-1" data-row-target>
          <select className={inputClass} aria-label="Which row" value={preset} data-row-target-select
            onChange={(e) => {
              const v = e.target.value
              if (v === 'key') onChange({ ...action, row: undefined, row_key: '{{event.key}}' })
              else onChange({ ...action, row_key: undefined, row: v === 'custom' ? '1' : v })
            }}>
            {ROW_PRESETS.filter((p) => p.value !== 'all_pending' || action.type === 'commit_row' || action.type === 'discard_row').map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            <option value="custom">A row number or expression…</option>
            <option value="key">A row by its key…</option>
          </select>
          {preset === 'custom' && <VariableInput value={row} extraVariables={placeholders} placeholder="2, or {{form.row_to_change}}" ariaLabel="Row number" onChange={(v) => onChange({ ...action, row: v || 'current' }, 'row-number')} />}
          {preset === 'key' && <VariableInput value={action.row_key ?? ''} extraVariables={placeholders} placeholder={isTable ? '{{event.key}}, {{form.order_id}}' : 'The List’s key column value'} ariaLabel="Row key" onChange={(v) => onChange({ ...action, row_key: v || undefined }, 'row-key')} />}
          {preset === 'key' && !isTable && !field.list?.key_column && <p className="text-2xs text-danger" role="alert">Choose the List&apos;s key column in its properties first.</p>}
          {(row === 'selected' || preset === 'key') && (
            <VariableInput value={action.empty_text ?? ''} extraVariables={placeholders} placeholder="When there is no such row: Select a row first" ariaLabel="Message when there is no row"
              onChange={(v) => onChange({ ...action, empty_text: v || undefined }, 'row-empty')} />
          )}
        </div>
      )}
      {action.type === 'set_row_values' && field && (
        <div className="space-y-1" data-row-values>
          {columns.map((c) => (
            <div key={c.key} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-1 text-2xs">
              <span className="truncate" title={c.read_only ? 'Read-only when editing: only a new row before its first commit takes it' : undefined}>{c.label}{c.read_only ? ' 🔒' : ''}</span>
              <VariableInput value={values[c.key] ?? ''} extraVariables={rowPlaceholders} placeholder="{{form.x}}, {{=qty * price}} — empty: unchanged" ariaLabel={`Set ${c.label}`} onChange={(v) => setValue(c.key, v)} />
            </div>
          ))}
          {columns.some((c) => c.read_only && values[c.key]) && (
            <p className="text-2xs text-(--status-blocked)" role="note" data-row-readonly-warning>
              {columns.filter((c) => c.read_only && values[c.key]).map((c) => c.label).join(', ')}: read-only when editing — ignored on existing rows; a new row takes it before its first commit.
            </p>
          )}
          <p className="text-2xs text-fg-muted">The row turns pending (“Edited”) until a Commit row; values that don&apos;t fit a column stop the rule.</p>
        </div>
      )}
      {(action.type === 'commit_row' || action.type === 'delete_row') && field && (
        <>
          {isTable ? (
            <div className="flex gap-1" role="radiogroup" aria-label="Stage or save now">
              {([['stage', action.type === 'commit_row' ? 'Stage (saved with the form)' : 'Stage the delete'], ['save_now', action.type === 'commit_row' ? 'Save to the table now' : 'Delete from the table now']] as const).map(([v, t]) => (
                <button key={v} type="button" role="radio" aria-checked={(action.commit_mode ?? 'stage') === v} className={inputClass}
                  onClick={() => onChange({ ...action, commit_mode: v === 'save_now' ? 'save_now' : undefined, open_access: v === 'save_now' ? action.open_access : undefined })}>{t}</button>
              ))}
            </div>
          ) : <p className="text-2xs text-fg-muted">A List&apos;s rows are kept with the submission.</p>}
          {isTable && action.commit_mode === 'save_now' && (
            <label className="flex items-center gap-1.5 text-2xs">
              <input type="checkbox" className="accent-primary" checked={action.open_access === true} onChange={(e) => onChange({ ...action, open_access: e.target.checked || undefined })} />
              Everyone who fills the form in may write (otherwise their own Manage rows permission is needed)
            </label>
          )}
          {action.type === 'commit_row' && <p className="text-2xs text-fg-muted">Checks the row (required, types, bounds). If it fails, its cells show why and the “If it fails” steps run. {isTable && action.commit_mode === 'save_now' ? '{{result.id}} is the saved row\'s id.' : ''}</p>}
          {action.type === 'delete_row' && <ConfirmTextEditor action={action} placeholders={placeholders} onChange={onChange} />}
        </>
      )}
      {action.type === 'discard_row' && <p className="text-2xs text-fg-muted">A new row goes; an edited row is put back as it was at its last commit.</p>}
      {action.type === 'revert_row' && <p className="text-2xs text-fg-muted">An edited row goes back to its last commit; a new row back to its defaults.</p>}
      {action.type === 'refresh_table' && field && (
        <label className="flex items-center gap-1.5 text-2xs">
          <input type="checkbox" className="accent-primary" checked={action.keep_pending === 'ask'} onChange={(e) => onChange({ ...action, keep_pending: e.target.checked ? 'ask' : undefined })} />
          Ask whether to drop pending rows first (otherwise they are kept)
        </label>
      )}
    </div>
  )
}
