'use client'

import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, X } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import { serverRead } from '@/lib/server-read'
import { findCell, pageGrid, setCellSpan } from '@/lib/forms/layout'
import { keyProblemFor, type DesignerField, type DesignerState } from '@/lib/forms/designer-state'
import { LookupProperties } from './lookup-properties'
import { AttachmentsProperties } from './attachments-properties'
import { CustomControlProperties } from './custom-control-properties'
import { ButtonProperties } from './button-properties'
import { DataTableProperties } from './data-table-properties'
import { LabelProperties } from './label-properties'
import { SurveyProperties } from './survey-properties'
import { isSurveyType, surveyFieldDefaults } from '@/lib/forms/survey/controls'
import { DesignerVariableScope } from './designer-variable-scope'
import { DynamicProp } from './dynamic-value-editor'
import { fieldPropType } from '@/lib/forms/dynamic-values'
import { AUTOCOMPLETE_LABELS } from '@/lib/forms/autocomplete'
import { cn } from '@/lib/utils'
import { designerInputClass as inputClass } from './designer-controls'
import {
  DISPLAY_FIELD_TYPES, TASK_FIELD_TYPE_LABELS, VISIBLE_WHEN_OPERATORS, isDisplayField,
  type TaskFieldDef, type TaskFieldType, type VisibleWhen, type VisibleWhenOperator,
} from '@/lib/task-field-schema'

const TEXT_LIKE = new Set<TaskFieldType>(['text', 'textarea', 'email', 'phone', 'url'])
const OPERATOR_LABELS: Record<VisibleWhenOperator, string> = {
  equals: 'equals', not_equals: 'does not equal', contains: 'contains', is_set: 'has a value', is_not_set: 'is empty',
}


function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-2 border-t pt-3 border-border">
      <legend className="pr-2 text-2xs font-semibold text-fg-muted">{title}</legend>
      {children}
    </fieldset>
  )
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export function FieldProperties({ state, field, allowedTypes, onPatch, onChangeState, onRemove, onDuplicate, onConvertToSection }: {
  state: DesignerState
  field: DesignerField
  allowedTypes: TaskFieldType[]
  onPatch: (patch: Partial<TaskFieldDef>, tag?: string) => void
  onChangeState: (next: DesignerState) => void
  onRemove: () => void
  onDuplicate: () => void
  /** Headings: turn the heading and the rows under it into a real section (lib/forms/sections.ts). */
  onConvertToSection?: () => void
}) {
  const id = (name: string) => `fp-${field._id}-${name}`
  const display = isDisplayField(field)
  // A Label (lib/forms/label-field.ts): display text — no input properties (placeholder, required, read-only, validation).
  const isLabelField = field.type === 'label'
  const keyProblem = keyProblemFor(state, field._id)
  const at = findCell(state.layout, field.key)
  const row = at ? pageGrid(state.layout, at.page).rows[at.row] : null
  const span = at && row ? row.cells[at.index].span : 1
  const otherFields = state.fields.filter((f) => f._id !== field._id && !DISPLAY_FIELD_TYPES.has(f.type))
  const flags = (state.layout.state?.flags ?? []).map((f) => f.key)
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
        <p className="flex-1 text-2xs font-semibold text-fg-muted">{TASK_FIELD_TYPE_LABELS[field.type]}</p>
        <button type="button" onClick={onDuplicate} className="rounded p-1" aria-label="Duplicate field" title="Duplicate"><Copy size={12} /></button>
        <button type="button" onClick={onRemove} className="rounded p-1" aria-label="Remove field" title="Remove (Delete)"><Trash2 size={12} /></button>
      </div>

      {field.type !== 'divider' && (field.type === 'heading' || field.type === 'button' ? (
        <div>
          <Label htmlFor={id('label')}>{field.type === 'heading' ? 'Heading text' : isLabelField ? 'Caption' : 'Label'}</Label>
          {field.type === 'heading'
            // A heading's text and description fill placeholders (lib/forms/header.ts resolveHeaderText).
            ? <VariableInput value={field.label} ariaLabel="Heading text" placeholder="e.g. Orders for {{param.customer}}" onChange={(v) => onPatch({ label: v }, `label-${field._id}`)} />
            : <input id={id('label')} className={inputClass} value={field.label} onChange={(e) => onPatch({ label: e.target.value }, `label-${field._id}`)} />}
        </div>
      ) : (
        <DynamicProp state={state} field={field} prop="label" label={isLabelField ? 'Caption' : 'Label'} expects="string" onPatch={onPatch} htmlFor={id('label')}>
          <input id={id('label')} className={inputClass} value={field.label} onChange={(e) => onPatch({ label: e.target.value }, `label-${field._id}`)} />
        </DynamicProp>
      ))}

      {!display && (
        <div>
          <Label htmlFor={id('key')}>Key {field._keyLocked ? '' : <span className="font-normal">(from the label)</span>}</Label>
          <input
            id={id('key')}
            className={`${inputClass} font-mono`}
            value={field.key}
            aria-invalid={Boolean(keyProblem)}
            aria-describedby={id('key-hint')}
            onChange={(e) => onPatch({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64) }, `key-${field._id}`)}
          />
          <p id={id('key-hint')} className={cn('mt-1 text-2xs', keyProblem ? 'text-danger' : 'text-fg-muted')}>
            {keyProblem ?? <>Downstream: <code className="text-primary-text">{`{{task_data.${field.key}}}`}</code></>}
          </p>
        </div>
      )}

      {!display && field.type !== 'custom' && !isLabelField && (
        <div>
          <Label>Type</Label>
          <AutocompleteSelect
            value={field.type}
            options={allowedTypes.filter((t) => !DISPLAY_FIELD_TYPES.has(t) && t !== 'custom' && t !== 'label').map((t) => ({ value: t, label: TASK_FIELD_TYPE_LABELS[t] }))}
            onChange={(value) => {
              const type = (value || 'text') as TaskFieldType
              const patch: Partial<TaskFieldDef> = { type }
              if ((type === 'choice' || type === 'multi_choice') && !(field.options ?? []).length) patch.options = ['Option 1', 'Option 2']
              if (type === 'lookup' && !field.lookup) patch.lookup = { source: 'table' }
              if (type === 'attachments' && !field.attachments) patch.attachments = { max_files: 10, max_file_mb: 10, types: ['any'] }
              if (type === 'data_table' && !field.data_table) patch.data_table = { source: 'table', mode: 'display', columns: [] }
              // A survey control: its own starting scale / options (the choices' options are kept when they fit).
              if (isSurveyType(type)) {
                const defaults = structuredClone(surveyFieldDefaults(type))
                Object.assign(patch, { survey: undefined, min: undefined, max: undefined }, defaults)
                if (defaults.options && (field.options ?? []).length >= 2 && type !== 'likert' && type !== 'matrix' && type !== 'yes_no_maybe') patch.options = field.options
              }
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
                className={cn('h-7 flex-1 rounded border text-2xs font-medium', span === n ? 'border-primary' : 'border-border', span === n ? 'bg-primary-wash' : '', span === n ? 'text-primary-text' : 'text-fg')}
              >
                {n === row.columns ? 'Full' : `${n} / ${row.columns}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {field.type === 'heading' && (
        <div>
          <Label htmlFor={id('help')}>Description</Label>
          <VariableInput value={field.help_text ?? ''} multiline rows={2} ariaLabel="Description" placeholder="Optional — {{field}} or {{param.x}} allowed" onChange={(v) => onPatch({ help_text: v || undefined }, `help-${field._id}`)} />
        </div>
      )}
      {!display && (
        <DynamicProp state={state} field={field} prop="help_text" label="Help text" expects="string" onPatch={onPatch} htmlFor={id('help')}>
          <textarea id={id('help')} rows={2} className="w-full rounded-md border px-2 py-1 text-xs" value={field.help_text ?? ''} onChange={(e) => onPatch({ help_text: e.target.value || undefined }, `help-${field._id}`)} />
        </DynamicProp>
      )}

      {!display && !isLabelField && !isSurveyType(field.type) && field.type !== 'boolean' && field.type !== 'multi_choice' && field.type !== 'attachments' && field.type !== 'custom' && !(field.type === 'choice' && field.display === 'radio') && (
        fieldPropType(field, 'placeholder') ? (
          <DynamicProp state={state} field={field} prop="placeholder" label="Placeholder" expects="string" onPatch={onPatch} htmlFor={id('placeholder')}>
            <input id={id('placeholder')} className={inputClass} value={field.placeholder ?? ''} onChange={(e) => onPatch({ placeholder: e.target.value || undefined }, `ph-${field._id}`)} />
          </DynamicProp>
        ) : (
          <div>
            <Label htmlFor={id('placeholder')}>Placeholder</Label>
            <input id={id('placeholder')} className={inputClass} value={field.placeholder ?? ''} onChange={(e) => onPatch({ placeholder: e.target.value || undefined }, `ph-${field._id}`)} />
          </div>
        )
      )}

      {(TEXT_LIKE.has(field.type) || field.type === 'date' || field.type === 'number') && (
        <div>
          <Label htmlFor={id('autocomplete')}>Autocomplete (input purpose)</Label>
          <select id={id('autocomplete')} className={inputClass} value={field.autocomplete ?? ''} onChange={(e) => onPatch({ autocomplete: e.target.value || undefined })} data-testid="field-autocomplete">
            <option value="">None</option>
            {field.autocomplete && !(field.autocomplete in AUTOCOMPLETE_LABELS) && <option value={field.autocomplete}>{field.autocomplete}</option>}
            {Object.entries(AUTOCOMPLETE_LABELS).map(([token, label]) => <option key={token} value={token}>{label} ({token})</option>)}
          </select>
        </div>
      )}

      {!display && !isLabelField && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {field.dynamic?.required ? null : (
            <label className="flex items-center gap-1.5 text-2xs">
              <input className="accent-primary" type="checkbox" checked={field.required === true} onChange={(e) => onPatch({ required: e.target.checked || undefined })} />
              Required
            </label>
          )}
          {field.type !== 'attachments' && (
            <label className="flex items-center gap-1.5 text-2xs">
              <input className="accent-primary" type="checkbox" checked={field.read_only === true} onChange={(e) => onPatch({ read_only: e.target.checked || undefined })} />
              Read-only (shows the default)
            </label>
          )}
        </div>
      )}

      {!display && !isLabelField && (
        <DynamicProp state={state} field={field} prop="required" label="Required when (dynamic)" expects="boolean" onPatch={onPatch}>
          <p className="text-2xs text-fg-muted">Static: the Required box above. Dynamic: a yes / no expression or source.</p>
        </DynamicProp>
      )}

      {!display && field.type !== 'attachments' && field.type !== 'custom' && field.type !== 'data_table' && field.type !== 'matrix' && field.type !== 'ranking' && !(isLabelField && field.label_config?.expression) && (
        <DynamicProp state={state} field={field} prop="default" label={isLabelField ? 'Default value (until a rule sets it)' : 'Default value'} expects={fieldPropType(field, 'default') ?? 'string'} onPatch={onPatch}>
          {field.type === 'boolean' ? (
            <AutocompleteSelect
              value={field.default ?? ''}
              options={[{ value: '', label: 'Unticked' }, { value: 'true', label: 'Ticked' }]}
              onChange={(value) => onPatch({ default: value || undefined })}
            />
          ) : (
            <DesignerVariableScope state={state} context={{ kind: 'default' }}>
              <VariableInput
                value={field.default ?? ''}
                ariaLabel="Default value"
                onChange={(value) => onPatch({ default: value || undefined }, `default-${field._id}`)}
                placeholder={field.type === 'multi_choice' ? 'A, B — {{variables}} allowed' : 'Optional — {{variables}} allowed'}
              />
            </DesignerVariableScope>
          )}
        </DynamicProp>
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
                className={cn('h-7 flex-1 rounded border text-2xs font-medium capitalize', (field.display ?? 'dropdown') === mode ? 'border-primary' : 'border-border', (field.display ?? 'dropdown') === mode ? 'bg-primary-wash' : '', (field.display ?? 'dropdown') === mode ? 'text-primary-text' : 'text-fg')}
              >
                {mode === 'radio' ? 'Radio buttons' : 'Dropdown'}
              </button>
            ))}
          </div>
        </div>
      )}

      {isSurveyType(field.type) && <SurveyProperties field={field} onPatch={onPatch} />}

      {field.type === 'custom' && (
        <CustomControlProperties state={state} field={field} onPatch={onPatch} />
      )}

      {field.type === 'attachments' && (
        <AttachmentsProperties field={field} onPatch={(attachments, tag) => onPatch({ attachments }, tag)} />
      )}

      {isLabelField && (
        <LabelProperties state={state} field={field} onPatch={(label_config, tag) => onPatch({ label_config }, tag)} />
      )}

      {field.type === 'data_table' && (
        <DataTableProperties state={state} field={field} onPatch={(data_table, tag) => onPatch({ data_table }, tag)} />
      )}

      {field.type === 'lookup' && (
        <LookupProperties state={state} field={field} onPatch={(lookup, tag) => onPatch({ lookup }, tag)} />
      )}

      {isChoice && (
        <Section title="Options">
          <DynamicProp state={state} field={field} prop="options" label="Where the options come from" expects="options" onPatch={onPatch}>
          <div className="space-y-1">
            {options.map((option, i) => (
              <div key={i} className="flex items-center gap-1">
                <input aria-label={`Option ${i + 1} value`} className={`${inputClass} font-mono`} value={option} placeholder="value"
                  onChange={(e) => {
                    const next = [...options]
                    const label = labels[option]
                    next[i] = e.target.value
                    const nextLabels = { ...labels }
                    delete nextLabels[option]
                    if (label) nextLabels[e.target.value] = label
                    setOptions(next, nextLabels)
                  }} />
                <input aria-label={`Option ${i + 1} label`} className={inputClass} value={labels[option] ?? ''} placeholder="label (optional)"
                  onChange={(e) => setOptions(options, { ...labels, [option]: e.target.value })} />
                <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={i === 0} aria-label={`Move option ${i + 1} up`} onClick={() => { const next = [...options]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; setOptions(next) }}><ArrowUp size={11} /></button>
                <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={i === options.length - 1} aria-label={`Move option ${i + 1} down`} onClick={() => { const next = [...options]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; setOptions(next) }}><ArrowDown size={11} /></button>
                <button type="button" className="rounded p-0.5" aria-label={`Remove option ${i + 1}`} onClick={() => setOptions(options.filter((_, j) => j !== i))}><X size={11} /></button>
              </div>
            ))}
            <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => setOptions([...options, `Option ${options.length + 1}`])}>
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
            {field.options_source && <p className="mt-1 text-2xs text-fg-muted">The options above are the preview and the fallback if the table is empty. For a filtered, sorted or live list, switch to Dynamic.</p>}
          </div>
          </DynamicProp>
        </Section>
      )}

      {!display && (field.type === 'number' || field.type === 'currency' || field.type === 'multi_choice' || TEXT_LIKE.has(field.type) || field.type === 'date' || field.type === 'datetime') && (
        <Section title="Validation">
          {(field.type === 'number' || field.type === 'currency' || field.type === 'multi_choice') && (
            <div className="grid grid-cols-2 gap-1">
              <DynamicProp state={state} field={field} prop="min" label={field.type === 'multi_choice' ? 'Choose at least' : 'Minimum'} expects="number" onPatch={onPatch} htmlFor={id('min')}>
                <input id={id('min')} type="number" className={inputClass} value={field.min ?? ''} onChange={(e) => onPatch({ min: numberOrUndefined(e.target.value) }, `min-${field._id}`)} />
              </DynamicProp>
              <DynamicProp state={state} field={field} prop="max" label={field.type === 'multi_choice' ? 'Choose at most' : 'Maximum'} expects="number" onPatch={onPatch} htmlFor={id('max')}>
                <input id={id('max')} type="number" className={inputClass} value={field.max ?? ''} onChange={(e) => onPatch({ max: numberOrUndefined(e.target.value) }, `max-${field._id}`)} />
              </DynamicProp>
            </div>
          )}
          {field.type === 'currency' && (
            <div>
              <Label htmlFor={id('currency')}>Currency (ISO code)</Label>
              <input id={id('currency')} className={`${inputClass} font-mono`} maxLength={3} value={field.currency ?? ''} onChange={(e) => onPatch({ currency: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') || undefined }, `cur-${field._id}`)} />
            </div>
          )}
          {TEXT_LIKE.has(field.type) && (
            <>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <Label htmlFor={id('minlen')}>Min length</Label>
                  <input id={id('minlen')} type="number" min={0} className={inputClass} value={field.min_length ?? ''} onChange={(e) => onPatch({ min_length: numberOrUndefined(e.target.value) }, `minl-${field._id}`)} />
                </div>
                <div>
                  <Label htmlFor={id('maxlen')}>Max length</Label>
                  <input id={id('maxlen')} type="number" min={0} className={inputClass} value={field.max_length ?? ''} onChange={(e) => onPatch({ max_length: numberOrUndefined(e.target.value) }, `maxl-${field._id}`)} />
                </div>
              </div>
              <div>
                <Label htmlFor={id('pattern')}>Pattern (regular expression)</Label>
                <input id={id('pattern')} className={`${inputClass} font-mono`} placeholder="e.g. ^[A-Z]{3}-\d{4}$" value={field.pattern ?? ''} onChange={(e) => onPatch({ pattern: e.target.value || undefined }, `pat-${field._id}`)} />
              </div>
              {field.pattern && (
                <div>
                  <Label htmlFor={id('patmsg')}>Message when it doesn&apos;t match</Label>
                  <input id={id('patmsg')} className={inputClass} value={field.pattern_message ?? ''} onChange={(e) => onPatch({ pattern_message: e.target.value || undefined }, `patm-${field._id}`)} />
                </div>
              )}
            </>
          )}
          {(field.type === 'date' || field.type === 'datetime') && (
            <div className="grid grid-cols-2 gap-1">
              <DynamicProp state={state} field={field} prop="min_date" label="Earliest" expects="date" onPatch={onPatch} htmlFor={id('mind')}>
                <input id={id('mind')} type="date" className={inputClass} value={field.min_date?.slice(0, 10) ?? ''} onChange={(e) => onPatch({ min_date: e.target.value || undefined })} />
              </DynamicProp>
              <DynamicProp state={state} field={field} prop="max_date" label="Latest" expects="date" onPatch={onPatch} htmlFor={id('maxd')}>
                <input id={id('maxd')} type="date" className={inputClass} value={field.max_date?.slice(0, 10) ?? ''} onChange={(e) => onPatch({ max_date: e.target.value || undefined })} />
              </DynamicProp>
            </div>
          )}
        </Section>
      )}

      {field.type === 'button' && (
        <ButtonProperties state={state} field={field} onPatch={onPatch} onChangeState={onChangeState} />
      )}

      {field.type === 'heading' && onConvertToSection && (
        <div className="rounded-md border p-2 text-2xs border-border">
          <p className="text-fg-muted">A heading only titles the rows under it. A section groups them: collapsible, optional, one target for rules.</p>
          <button type="button" onClick={onConvertToSection} className="mt-1.5 rounded border px-2 py-1 text-xs font-medium border-border text-primary-text" data-convert-heading>
            Convert heading to section
          </button>
        </div>
      )}

      {(otherFields.length > 0 || flags.length > 0) && (
        <Section title="Visible when">
          <VisibleWhenEditor
            rule={field.visible_when}
            fields={otherFields}
            flags={flags}
            onChange={(visible_when, tag) => onPatch({ visible_when }, tag ? `vw-${field._id}` : undefined)}
          />
          <p className="text-2xs text-fg-muted">Hidden fields are not required and are skipped by validation.</p>
        </Section>
      )}
    </div>
  )
}

/** The "Visible when" rule builder (a field's, or a step's / tab's). */
export function VisibleWhenEditor({ rule, fields, flags = [], onChange, emptyLabel = 'Always' }: {
  rule: VisibleWhen | undefined
  /** Fields the rule can test. */
  fields: Array<Pick<TaskFieldDef, 'key' | 'label'>>
  /** Form state flags (state.<flag>, set by in-form buttons). */
  flags?: string[]
  emptyLabel?: string
  /** `typing`: the value input changed (one undo step while typing). */
  onChange: (rule: VisibleWhen | undefined, typing?: boolean) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-1">
      <AutocompleteSelect
        value={rule?.field ?? ''}
        placeholder={emptyLabel}
        clearable
        options={[
          ...fields.map((f) => ({ value: f.key, label: f.label || f.key })),
          ...flags.map((flag) => ({ value: `state.${flag}`, label: `state.${flag}`, hint: 'form state' })),
        ]}
        onChange={(value) => onChange(value
          ? value.startsWith('state.') ? { field: value, operator: 'equals', value: 'true' } : { field: value, operator: rule?.operator ?? 'equals', value: rule?.value ?? '' }
          : undefined)}
      />
      <AutocompleteSelect
        value={rule?.operator ?? 'equals'}
        disabled={!rule}
        options={VISIBLE_WHEN_OPERATORS.map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
        onChange={(value) => rule && onChange({ ...rule, operator: (value || 'equals') as VisibleWhenOperator })}
      />
      <input
        aria-label="Value to compare"
        className={inputClass}
        disabled={!rule || rule.operator === 'is_set' || rule.operator === 'is_not_set'}
        value={rule?.value ?? ''}
        onChange={(e) => rule && onChange({ ...rule, value: e.target.value }, true)}
      />
    </div>
  )
}
