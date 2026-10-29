'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, X } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import { serverRead } from '@/lib/server-read'
import { findCell, setCellSpan } from '@/lib/forms/layout'
import { keyProblemFor, type DesignerField, type DesignerState } from '@/lib/forms/designer-state'
import { LookupProperties } from './lookup-properties'
import { AttachmentsProperties } from './attachments-properties'
import {
  DISPLAY_FIELD_TYPES, TASK_FIELD_TYPE_LABELS, VISIBLE_WHEN_OPERATORS, isDisplayField,
  type TaskFieldDef, type TaskFieldType, type VisibleWhenOperator,
} from '@/lib/task-field-schema'

const TEXT_LIKE = new Set<TaskFieldType>(['text', 'textarea', 'email', 'phone', 'url'])
const OPERATOR_LABELS: Record<VisibleWhenOperator, string> = {
  equals: 'equals', not_equals: 'does not equal', contains: 'contains', is_set: 'has a value', is_not_set: 'is empty',
}

const inputClass = 'h-8 w-full rounded-md border px-2 text-xs outline-none focus-visible:ring-2'
const inputStyle: React.CSSProperties = {
  borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)',
  ['--tw-ring-color' as string]: 'var(--theme-primary)',
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>{children}</label>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2 border-t pt-3" style={{ borderColor: 'var(--theme-surface-border)' }}>
      <legend className="pr-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>{title}</legend>
      {children}
    </fieldset>
  )
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export function FieldProperties({ state, field, allowedTypes, onPatch, onChangeState, onRemove, onDuplicate }: {
  state: DesignerState
  field: DesignerField
  allowedTypes: TaskFieldType[]
  onPatch: (patch: Partial<TaskFieldDef>, tag?: string) => void
  onChangeState: (next: DesignerState) => void
  onRemove: () => void
  onDuplicate: () => void
}) {
  const id = (name: string) => `fp-${field._id}-${name}`
  const display = isDisplayField(field)
  const keyProblem = keyProblemFor(state, field._id)
  const at = findCell(state.layout, field.key)
  const row = at ? state.layout.rows[at.row] : null
  const span = at && row ? row.cells[at.index].span : 1
  const otherFields = state.fields.filter((f) => f._id !== field._id && !DISPLAY_FIELD_TYPES.has(f.type))
  const isChoice = field.type === 'choice' || field.type === 'multi_choice'
  const { data: tables = [] } = useQuery({
    queryKey: ['forms-table-columns'],
    enabled: isChoice,
    staleTime: 60_000,
    queryFn: async () => (await serverRead('forms.tableColumns')).data ?? [],
  })
  const options = field.options ?? []
  const labels = field.option_labels ?? {}
  const setOptions = (next: string[], nextLabels: Record<string, string> = labels) => {
    const kept = Object.fromEntries(Object.entries(nextLabels).filter(([value, label]) => next.includes(value) && label && label !== value))
    onPatch({ options: next, option_labels: Object.keys(kept).length ? kept : undefined }, `options-${field._id}`)
  }

  return (
    <div className="space-y-3 text-xs" aria-label={`Properties of ${field.label || 'field'}`}>
      <div className="flex items-center gap-1">
        <p className="flex-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>{TASK_FIELD_TYPE_LABELS[field.type]}</p>
        <button type="button" onClick={onDuplicate} className="rounded p-1" aria-label="Duplicate field" title="Duplicate"><Copy size={12} /></button>
        <button type="button" onClick={onRemove} className="rounded p-1" aria-label="Remove field" title="Remove (Delete)"><Trash2 size={12} /></button>
      </div>

      {field.type !== 'divider' && (
        <div>
          <Label htmlFor={id('label')}>{field.type === 'heading' ? 'Heading text' : 'Label'}</Label>
          <input id={id('label')} className={inputClass} style={inputStyle} value={field.label} onChange={(e) => onPatch({ label: e.target.value }, `label-${field._id}`)} />
        </div>
      )}

      {!display && (
        <div>
          <Label htmlFor={id('key')}>Key {field._keyLocked ? '' : <span className="font-normal">(from the label)</span>}</Label>
          <input
            id={id('key')}
            className={`${inputClass} font-mono`}
            style={{ ...inputStyle, ...(keyProblem ? { borderColor: 'var(--status-blocked)' } : {}) }}
            value={field.key}
            aria-invalid={Boolean(keyProblem)}
            aria-describedby={id('key-hint')}
            onChange={(e) => onPatch({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64) }, `key-${field._id}`)}
          />
          <p id={id('key-hint')} className="mt-1 text-[10px]" style={{ color: keyProblem ? 'var(--status-blocked)' : 'var(--theme-muted-text)' }}>
            {keyProblem ?? <>Downstream: <code style={{ color: 'var(--theme-primary-text)' }}>{`{{task_data.${field.key}}}`}</code></>}
          </p>
        </div>
      )}

      {!display && (
        <div>
          <Label>Type</Label>
          <AutocompleteSelect
            value={field.type}
            options={allowedTypes.filter((t) => !DISPLAY_FIELD_TYPES.has(t)).map((t) => ({ value: t, label: TASK_FIELD_TYPE_LABELS[t] }))}
            onChange={(value) => {
              const type = (value || 'text') as TaskFieldType
              const patch: Partial<TaskFieldDef> = { type }
              if ((type === 'choice' || type === 'multi_choice') && !(field.options ?? []).length) patch.options = ['Option 1', 'Option 2']
              if (type === 'lookup' && !field.lookup) patch.lookup = { source: 'table' }
              if (type === 'attachments' && !field.attachments) patch.attachments = { max_files: 10, max_file_mb: 10, types: ['any'] }
              onPatch(patch)
            }}
          />
        </div>
      )}

      {row && row.columns > 1 && (
        <div>
          <Label>Width</Label>
          <div className="flex gap-1" role="radiogroup" aria-label="Column span">
            {Array.from({ length: row.columns }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={span === n}
                onClick={() => onChangeState({ ...state, layout: setCellSpan(state.layout, field.key, n) })}
                className="h-7 flex-1 rounded border text-[10px] font-medium"
                style={span === n
                  ? { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }
                  : { borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
              >
                {n === row.columns ? 'Full' : `${n} / ${row.columns}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {field.type !== 'divider' && (
        <div>
          <Label htmlFor={id('help')}>{field.type === 'heading' ? 'Description' : 'Help text'}</Label>
          <textarea id={id('help')} rows={2} className="w-full rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-2" style={inputStyle} value={field.help_text ?? ''} onChange={(e) => onPatch({ help_text: e.target.value || undefined }, `help-${field._id}`)} />
        </div>
      )}

      {!display && field.type !== 'boolean' && field.type !== 'multi_choice' && field.type !== 'attachments' && !(field.type === 'choice' && field.display === 'radio') && (
        <div>
          <Label htmlFor={id('placeholder')}>Placeholder</Label>
          <input id={id('placeholder')} className={inputClass} style={inputStyle} value={field.placeholder ?? ''} onChange={(e) => onPatch({ placeholder: e.target.value || undefined }, `ph-${field._id}`)} />
        </div>
      )}

      {!display && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <label className="flex items-center gap-1.5 text-[11px]">
            <input type="checkbox" checked={field.required === true} onChange={(e) => onPatch({ required: e.target.checked || undefined })} style={{ accentColor: 'var(--theme-primary)' }} />
            Required
          </label>
          {field.type !== 'attachments' && (
            <label className="flex items-center gap-1.5 text-[11px]">
              <input type="checkbox" checked={field.read_only === true} onChange={(e) => onPatch({ read_only: e.target.checked || undefined })} style={{ accentColor: 'var(--theme-primary)' }} />
              Read-only (shows the default)
            </label>
          )}
        </div>
      )}

      {!display && field.type !== 'attachments' && (
        <div>
          <Label>Default value</Label>
          {field.type === 'boolean' ? (
            <AutocompleteSelect
              value={field.default ?? ''}
              options={[{ value: '', label: 'Unticked' }, { value: 'true', label: 'Ticked' }]}
              onChange={(value) => onPatch({ default: value || undefined })}
            />
          ) : (
            <VariableInput
              value={field.default ?? ''}
              onChange={(value) => onPatch({ default: value || undefined }, `default-${field._id}`)}
              placeholder={field.type === 'multi_choice' ? 'A, B — {{variables}} allowed' : 'Optional — {{variables}} allowed'}
            />
          )}
        </div>
      )}

      {field.type === 'choice' && (
        <div>
          <Label>Show as</Label>
          <div className="flex gap-1">
            {(['dropdown', 'radio'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={(field.display ?? 'dropdown') === mode}
                onClick={() => onPatch({ display: mode === 'radio' ? 'radio' : undefined })}
                className="h-7 flex-1 rounded border text-[10px] font-medium capitalize"
                style={(field.display ?? 'dropdown') === mode
                  ? { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }
                  : { borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
              >
                {mode === 'radio' ? 'Radio buttons' : 'Dropdown'}
              </button>
            ))}
          </div>
        </div>
      )}

      {field.type === 'attachments' && (
        <AttachmentsProperties field={field} onPatch={(attachments, tag) => onPatch({ attachments }, tag)} />
      )}

      {field.type === 'lookup' && (
        <LookupProperties state={state} field={field} onPatch={(lookup, tag) => onPatch({ lookup }, tag)} />
      )}

      {isChoice && (
        <Section title="Options">
          <div className="space-y-1">
            {options.map((option, i) => (
              <div key={i} className="flex items-center gap-1">
                <input aria-label={`Option ${i + 1} value`} className={`${inputClass} font-mono`} style={inputStyle} value={option} placeholder="value"
                  onChange={(e) => {
                    const next = [...options]
                    const label = labels[option]
                    next[i] = e.target.value
                    const nextLabels = { ...labels }
                    delete nextLabels[option]
                    if (label) nextLabels[e.target.value] = label
                    setOptions(next, nextLabels)
                  }} />
                <input aria-label={`Option ${i + 1} label`} className={inputClass} style={inputStyle} value={labels[option] ?? ''} placeholder="label (optional)"
                  onChange={(e) => setOptions(options, { ...labels, [option]: e.target.value })} />
                <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={i === 0} aria-label={`Move option ${i + 1} up`} onClick={() => { const next = [...options]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; setOptions(next) }}><ArrowUp size={11} /></button>
                <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={i === options.length - 1} aria-label={`Move option ${i + 1} down`} onClick={() => { const next = [...options]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; setOptions(next) }}><ArrowDown size={11} /></button>
                <button type="button" className="rounded p-0.5" aria-label={`Remove option ${i + 1}`} onClick={() => setOptions(options.filter((_, j) => j !== i))}><X size={11} /></button>
              </div>
            ))}
            <button type="button" className="flex items-center gap-1 text-[10px] font-medium" style={{ color: 'var(--theme-primary-text)' }} onClick={() => setOptions([...options, `Option ${options.length + 1}`])}>
              <Plus size={11} /> Add option
            </button>
          </div>
          <div>
            <Label>Or load options from a data table column (when the task is created)</Label>
            <div className="grid grid-cols-2 gap-1">
              <AutocompleteSelect
                value={field.options_source?.table_id ?? ''}
                placeholder="Table…"
                clearable
                options={tables.map((t: { id: string; name: string }) => ({ value: t.id, label: t.name }))}
                onChange={(value) => onPatch({ options_source: value ? { table_id: value, column: tables.find((t: { id: string }) => t.id === value)?.columns?.[0]?.key ?? '' } : undefined })}
              />
              <AutocompleteSelect
                value={field.options_source?.column ?? ''}
                placeholder="Column…"
                disabled={!field.options_source}
                options={(tables.find((t: { id: string }) => t.id === field.options_source?.table_id)?.columns ?? []).map((c: { key: string; label: string }) => ({ value: c.key, label: c.label }))}
                onChange={(value) => field.options_source && onPatch({ options_source: { ...field.options_source, column: value } })}
              />
            </div>
            {field.options_source && <p className="mt-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>The options above are the preview and the fallback if the table is empty.</p>}
          </div>
        </Section>
      )}

      {!display && (field.type === 'number' || field.type === 'currency' || field.type === 'multi_choice' || TEXT_LIKE.has(field.type) || field.type === 'date' || field.type === 'datetime') && (
        <Section title="Validation">
          {(field.type === 'number' || field.type === 'currency' || field.type === 'multi_choice') && (
            <div className="grid grid-cols-2 gap-1">
              <div>
                <Label htmlFor={id('min')}>{field.type === 'multi_choice' ? 'Choose at least' : 'Minimum'}</Label>
                <input id={id('min')} type="number" className={inputClass} style={inputStyle} value={field.min ?? ''} onChange={(e) => onPatch({ min: numberOrUndefined(e.target.value) }, `min-${field._id}`)} />
              </div>
              <div>
                <Label htmlFor={id('max')}>{field.type === 'multi_choice' ? 'Choose at most' : 'Maximum'}</Label>
                <input id={id('max')} type="number" className={inputClass} style={inputStyle} value={field.max ?? ''} onChange={(e) => onPatch({ max: numberOrUndefined(e.target.value) }, `max-${field._id}`)} />
              </div>
            </div>
          )}
          {field.type === 'currency' && (
            <div>
              <Label htmlFor={id('currency')}>Currency (ISO code)</Label>
              <input id={id('currency')} className={`${inputClass} font-mono uppercase`} style={inputStyle} maxLength={3} value={field.currency ?? ''} onChange={(e) => onPatch({ currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') || undefined }, `cur-${field._id}`)} />
            </div>
          )}
          {TEXT_LIKE.has(field.type) && (
            <>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <Label htmlFor={id('minlen')}>Min length</Label>
                  <input id={id('minlen')} type="number" min={0} className={inputClass} style={inputStyle} value={field.min_length ?? ''} onChange={(e) => onPatch({ min_length: numberOrUndefined(e.target.value) }, `minl-${field._id}`)} />
                </div>
                <div>
                  <Label htmlFor={id('maxlen')}>Max length</Label>
                  <input id={id('maxlen')} type="number" min={0} className={inputClass} style={inputStyle} value={field.max_length ?? ''} onChange={(e) => onPatch({ max_length: numberOrUndefined(e.target.value) }, `maxl-${field._id}`)} />
                </div>
              </div>
              <div>
                <Label htmlFor={id('pattern')}>Pattern (regular expression)</Label>
                <input id={id('pattern')} className={`${inputClass} font-mono`} style={inputStyle} placeholder="e.g. ^[A-Z]{3}-\d{4}$" value={field.pattern ?? ''} onChange={(e) => onPatch({ pattern: e.target.value || undefined }, `pat-${field._id}`)} />
              </div>
              {field.pattern && (
                <div>
                  <Label htmlFor={id('patmsg')}>Message when it doesn&apos;t match</Label>
                  <input id={id('patmsg')} className={inputClass} style={inputStyle} value={field.pattern_message ?? ''} onChange={(e) => onPatch({ pattern_message: e.target.value || undefined }, `patm-${field._id}`)} />
                </div>
              )}
            </>
          )}
          {(field.type === 'date' || field.type === 'datetime') && (
            <div className="grid grid-cols-2 gap-1">
              <div>
                <Label htmlFor={id('mind')}>Earliest</Label>
                <input id={id('mind')} type="date" className={inputClass} style={inputStyle} value={field.min_date?.slice(0, 10) ?? ''} onChange={(e) => onPatch({ min_date: e.target.value || undefined })} />
              </div>
              <div>
                <Label htmlFor={id('maxd')}>Latest</Label>
                <input id={id('maxd')} type="date" className={inputClass} style={inputStyle} value={field.max_date?.slice(0, 10) ?? ''} onChange={(e) => onPatch({ max_date: e.target.value || undefined })} />
              </div>
            </div>
          )}
        </Section>
      )}

      {!display && otherFields.length > 0 && (
        <Section title="Visible when">
          <div className="grid grid-cols-3 gap-1">
            <AutocompleteSelect
              value={field.visible_when?.field ?? ''}
              placeholder="Always"
              clearable
              options={otherFields.map((f) => ({ value: f.key, label: f.label || f.key }))}
              onChange={(value) => onPatch({ visible_when: value ? { field: value, operator: field.visible_when?.operator ?? 'equals', value: field.visible_when?.value ?? '' } : undefined })}
            />
            <AutocompleteSelect
              value={field.visible_when?.operator ?? 'equals'}
              disabled={!field.visible_when}
              options={VISIBLE_WHEN_OPERATORS.map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
              onChange={(value) => field.visible_when && onPatch({ visible_when: { ...field.visible_when, operator: (value || 'equals') as VisibleWhenOperator } })}
            />
            <input
              aria-label="Value to compare"
              className={inputClass}
              style={inputStyle}
              disabled={!field.visible_when || field.visible_when.operator === 'is_set' || field.visible_when.operator === 'is_not_set'}
              value={field.visible_when?.value ?? ''}
              onChange={(e) => field.visible_when && onPatch({ visible_when: { ...field.visible_when, value: e.target.value } }, `vw-${field._id}`)}
            />
          </div>
          <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Hidden fields are not required and are skipped by validation.</p>
        </Section>
      )}
    </div>
  )
}
