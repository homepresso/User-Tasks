'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { serverRead } from '@/lib/server-read'
import { isPaged, renderableRows, type FormLayout, type FormPage } from '@/lib/forms/layout'
import { FormPagesProvider, FormTabBar, StepIndicator, StepNav, useFormPager, type FormPager } from './form-pages'
import { PageIcon } from './page-icons'
import { lookupItemKey, lookupLabelKey } from '@/lib/forms/lookup'
import { LookupField, lookupDisplayValue } from './lookup-field'
import { AttachmentList, AttachmentsField } from './attachments-field'
import { CustomControlField } from './custom-control-field'
import { ControlPrewarm, ControlReadyBoundary } from './control-ready'
import { DataTableField, DataTableValueView } from './data-table-field'
import { describeDataTableValue } from '@/lib/forms/data-table'
import { formatCustomValue } from '@/lib/forms/custom-controls/field'
import { attachmentNames } from '@/lib/forms/attachments'
import { hiddenFieldKeysForValues, holdsFiles, isDisplayField, isFieldVisible, isRuleMet, optionLabel, type TaskFieldDef } from '@/lib/task-field-schema'
import { estimatePartHeight } from '@/lib/forms/lazy-load'
import { LazyLoadController, LazyPartPlaceholder, LazyPartsProvider, LazyReveal, useLazyParts, useLazyState } from './lazy-parts'
import { FORM_STATE_KEY, applyCollapsed, readFormState, sectionRowFieldKeys, stateHiddenFieldKeys, stateRuleFlag, withFormState } from '@/lib/forms/form-state'
import { isSectionIncluded, sectionBlocks, sectionIncludedKey, sectionRuleHiddenFieldKeys } from '@/lib/forms/sections'
import { FormSectionBlock } from './form-section'
import { CONTROLS_KEY, withFormContext } from '@/lib/forms/form-params'
import { layoutPages, layoutSectionControls, reportControl, withControlState } from '@/lib/forms/rule-variables'
import { resolveHeaderText } from '@/lib/forms/header'
import { FieldButtonCell } from './field-button'
import { FormLevelError, FormRulesScope, useFormRules } from './form-rules-runtime'
import { FormMessagesScope } from './form-messages'
import { alwaysRuleEffects, ruleHiddenFieldKeys } from '@/lib/forms/form-rules'
import { useFormRuntime } from './form-runtime'
import { DynamicStatusProvider, useDynamicFields, useDynamicStatus } from './dynamic-fields'
import { LabelDisplay, LabelValues } from './label-field'
import { computeLabelValues, isDynamicLabel, tablesReadByLabels } from '@/lib/forms/label-field'
import { cn } from '@/lib/utils'
import { formatSurveyValue, isSurveyType } from '@/lib/forms/survey/controls'
import { SurveyAnswerView, SurveyFieldControl } from './survey/survey-controls'
import { FormEnteringScope, MotionContainerScope, motionAttrs, staggerStyle, useCellMotion, useExitingKeys, useFormMotion } from './form-motion'
import { FORM_MOTION_TIMING, staggerIndex, travelDirection, type TravelDirection } from '@/lib/forms/motion'

/**
 * The assignee's form: User Task fields on the designer's grid (or, without
 * a layout, the classic two-column flow every existing task uses). Shared by
 * the task screen, the designer's live preview and the test runner, so what
 * the designer shows is exactly what the assignee sees. Rows collapse to one
 * column below the `sm` breakpoint (phones) or when `singleColumn` is set.
 *
 * Read-only mode shows formatted values (completed tasks, viewers).
 *
 * A layout with pages (steps / tabs, lib/forms/layout.ts) renders the
 * stepper or tab bar and the current page (components/forms/form-pages.tsx;
 * the surface's FormPagesProvider, else one of its own). Read-only, every
 * shown page is stacked under its title.
 *
 * In-form buttons (field type `button`, components/forms/field-button.tsx)
 * and the form state they set (lib/forms/form-state.ts): an element shows
 * when no button hid it AND its rule holds (state flags included) AND its
 * page shows. Read-only views ignore button hides and show a field a state
 * rule would hide when it has a value (nothing answered is lost from view);
 * buttons are not drawn there.
 */

export interface FormRendererProps {
  fields: TaskFieldDef[]
  layout?: FormLayout | null
  values: Record<string, unknown>
  onChange?: (key: string, value: unknown) => void
  errors?: Record<string, string>
  readOnly?: boolean
  compact?: boolean
  /** Force one column (designer mobile preview). */
  singleColumn?: boolean
  labelPosition?: 'top' | 'left'
  density?: 'compact' | 'comfortable'
  /** Prefix for input ids (several renderers on one page). */
  idPrefix?: string
  /** Internal: the whole form's layout when `layout` is one page's grid (button targets, pages). */
  fullLayout?: FormLayout | null
}

// Static class names so Tailwind generates them.
const SM_COLS = ['', 'sm:grid-cols-1', 'sm:grid-cols-2', 'sm:grid-cols-3', 'sm:grid-cols-4']
const SM_SPAN = ['', 'sm:col-span-1', 'sm:col-span-2', 'sm:col-span-3', 'sm:col-span-4']

export function formatFieldValue(field: TaskFieldDef | undefined, value: unknown, people?: Map<string, string>): string {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return '—'
  if (field?.type === 'attachments') return attachmentNames(value) || '—'
  if (field?.type === 'custom') return formatCustomValue(field.custom, value)
  if (field?.type === 'data_table') return describeDataTableValue(field.data_table, value)
  if (field && isSurveyType(field.type)) return formatSurveyValue(field, value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map((v) => (field ? optionLabel(field, String(v)) : String(v))).join(', ')
  if (field?.type === 'currency' && typeof value === 'number') {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: field.currency ?? 'USD' }).format(value)
    } catch { return String(value) }
  }
  if (field?.type === 'datetime') {
    const d = new Date(String(value))
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
  }
  if (field?.type === 'user') return people?.get(String(value)) ?? String(value)
  if (field && (field.type === 'choice')) return optionLabel(field, String(value))
  if (typeof value === 'object') {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function dateValue(value: unknown): string {
  const s = text(value)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s
}

/** ISO → the value a datetime-local input shows (local time, minutes). */
function dateTimeLocalValue(value: unknown): string {
  const s = text(value)
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isChecked(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return ['true', '1', 'yes', 'on'].includes(String(value ?? '').toLowerCase())
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.trim()) return value.split(',').map((v) => v.trim()).filter(Boolean)
  return []
}

function usePeople(enabled: boolean) {
  return useQuery({
    queryKey: ['form-person-options'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => (await serverRead('tasks.redirectUsers')).data ?? [],
  })
}

const INPUT_TYPE: Partial<Record<TaskFieldDef['type'], string>> = {
  text: 'text', email: 'email', phone: 'tel', url: 'url', number: 'number', currency: 'number', date: 'date', datetime: 'datetime-local',
}

/** Options from a data table / API that are loading or failed: a disabled control that says so. */
function OptionsUnavailable({ id, status, describedBy }: { id: string; status: { loading?: boolean; error?: string }; describedBy?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <select id={id} disabled aria-describedby={describedBy} aria-busy={status.loading || undefined} data-dynamic-options={status.loading ? 'loading' : 'error'}
        className="h-10 w-full rounded-lg border px-3 text-sm opacity-60 border-border bg-input text-fg-muted">
        <option>{status.loading ? 'Loading options…' : "Couldn't load options"}</option>
      </select>
      {status.error && <p className="text-2xs text-fg-muted" role="status">{status.error}</p>}
    </div>
  )
}

/**
 * A control a rule made read only (Make read only / editable): looks like
 * itself on a quiet background with a dashed border — not the greyed-out
 * disabled look — and stays focusable so the value can be selected and
 * copied.
 */
const READ_ONLY_CONTROL = 'bg-subtle border-dashed hover:border-input-border cursor-default'

/** A read-only text box showing a value (dropdowns, people, autocompletes made read only by a rule). */
function ReadOnlyText({ id, value, describedBy, labelledBy }: { id: string; value: string; describedBy?: string; labelledBy?: string }) {
  return (
    <Input id={id} type="text" readOnly aria-readonly value={value} aria-describedby={describedBy} aria-labelledby={labelledBy}
      className={READ_ONLY_CONTROL} data-read-only="" />
  )
}

function FieldControl({ field, value, onChange, error, id, people, values, setValue, reportRows, locked = false }: {
  field: TaskFieldDef
  value: unknown
  onChange: (value: unknown) => void
  error?: string
  id: string
  people: Array<{ id: string; display_name: string | null; email: string | null }>
  values: Record<string, unknown>
  setValue: (key: string, value: unknown) => void
  /** Data tables: report the loaded rows (a Label's expression reads them). */
  reportRows?: boolean
  /** Read only by a rule: the value shows (and is submitted) but can't be changed here. */
  locked?: boolean
}) {
  const invalid = Boolean(error)
  const optionsStatus = useDynamicStatus(field.key, 'options')
  const describedBy = [field.help_text ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  const common = {
    id,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
    'aria-required': (field.required && !locked) || undefined,
    disabled: field.read_only,
    autoComplete: field.autocomplete,
    style: invalid ? { borderColor: 'var(--status-blocked)' } as React.CSSProperties : undefined,
    ...(locked ? { readOnly: true, 'aria-readonly': true, 'data-read-only': '' } : {}),
  }
  // Survey controls (components/forms/survey/survey-controls.tsx): their own read-only handling.
  if (isSurveyType(field.type)) {
    return <SurveyFieldControl field={field} value={value} onChange={onChange} id={id} describedBy={describedBy} invalid={invalid} disabled={field.read_only} readOnly={locked} />
  }
  // Read only by a rule: pointer and keyboard toggles are swallowed (focus and selection stay).
  const swallow = locked ? { onClick: (e: React.MouseEvent) => e.preventDefault() } : {}
  if (locked) {
    switch (field.type) {
      case 'choice':
        if (field.display === 'radio') break
        return <ReadOnlyText id={id} value={text(value) ? optionLabel(field, text(value)) : ''} describedBy={describedBy} labelledBy={`${id}-label`} />
      case 'user': {
        const person = people.find((p) => p.id === text(value))
        return <ReadOnlyText id={id} value={person ? person.display_name || person.email || person.id : text(value)} describedBy={describedBy} labelledBy={`${id}-label`} />
      }
      case 'lookup': {
        const shown = lookupDisplayValue(field, value, values[lookupItemKey(field.key)], values[lookupLabelKey(field.key)])
        return <ReadOnlyText id={id} value={shown === '—' ? '' : shown} describedBy={describedBy} labelledBy={`${id}-label`} />
      }
      default:
        break
    }
  }
  switch (field.type) {
    case 'custom':
      return (
        <CustomControlField
          field={field}
          value={value}
          onChange={onChange}
          values={values}
          id={id}
          describedBy={describedBy}
          invalid={invalid}
          error={error}
          disabled={field.read_only}
          readOnly={field.read_only || locked}
        />
      )
    case 'data_table':
      return (
        <DataTableField
          field={field}
          value={value}
          values={values}
          onChange={onChange}
          onControl={(patch) => setValue(CONTROLS_KEY, reportControl(values, field.key, patch))}
          reportRows={reportRows}
          id={id}
          describedBy={describedBy}
          invalid={invalid}
          disabled={field.read_only || locked}
        />
      )
    case 'attachments':
      return (
        <AttachmentsField
          field={field}
          value={value}
          onChange={onChange}
          id={id}
          describedBy={describedBy}
          invalid={invalid}
          disabled={field.read_only || locked}
        />
      )
    case 'lookup':
      return (
        <LookupField
          field={field}
          value={value}
          item={values[lookupItemKey(field.key)]}
          label={values[lookupLabelKey(field.key)]}
          values={values}
          onChange={onChange}
          onItem={(item) => setValue(lookupItemKey(field.key), item)}
          onLabel={(label) => setValue(lookupLabelKey(field.key), label)}
          onFill={(patch) => { for (const [key, v] of Object.entries(patch)) setValue(key, v) }}
          id={id}
          describedBy={describedBy}
          invalid={invalid}
          disabled={field.read_only}
          placeholder={field.placeholder}
        />
      )
    case 'textarea':
      return (
        <textarea
          {...common}
          rows={4}
          value={text(value)}
          placeholder={field.placeholder}
          maxLength={field.max_length}
          onChange={(e) => { if (!locked) onChange(e.target.value) }}
          className={cn('flex w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-60 bg-input text-fg', invalid ? 'border-(--status-blocked)' : 'border-border', locked && READ_ONLY_CONTROL)}
        />
      )
    case 'boolean':
      return (
        <label htmlFor={id} className={cn('flex items-center gap-2 text-sm min-h-10', locked ? 'cursor-default' : 'cursor-pointer')} {...(locked ? { 'data-read-only': '' } : {})}>
          <input
            id={id}
            type="checkbox"
            checked={isChecked(value)}
            disabled={field.read_only}
            aria-describedby={describedBy}
            aria-readonly={locked || undefined}
            onChange={(e) => { if (!locked) onChange(e.target.checked) }}
            {...swallow}
            className="h-4 w-4 accent-primary"
          />
          <span className="text-fg">
            {field.label}
            {field.required && !locked && <span className="ml-0.5 text-(--status-blocked)">*</span>}
          </span>
        </label>
      )
    case 'choice':
      if (optionsStatus && (optionsStatus.loading || optionsStatus.error)) return <OptionsUnavailable id={id} status={optionsStatus} describedBy={describedBy} />
      if (field.display === 'radio') {
        return (
          <div role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={describedBy} aria-readonly={locked || undefined} {...(locked ? { 'data-read-only': '' } : {})} className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
            {(field.options ?? []).map((option) => (
              <label key={option} className={cn('flex items-center gap-1.5 text-sm text-fg', locked ? 'cursor-default' : 'cursor-pointer')}>
                <input className="accent-primary"
                  type="radio"
                  name={id}
                  value={option}
                  checked={text(value) === option}
                  disabled={field.read_only}
                  onChange={() => { if (!locked) onChange(option) }}
                  {...swallow}
                />
                {optionLabel(field, option)}
              </label>
            ))}
          </div>
        )
      }
      return (
        <AutocompleteSelect
          value={text(value)}
          onChange={(next) => onChange(next)}
          options={(field.options ?? []).map((option) => ({ value: option, label: optionLabel(field, option) }))}
          placeholder={field.placeholder || 'Select…'}
          clearable={!field.required}
          disabled={field.read_only}
          size="md"
          id={id} labelledBy={`${id}-label`} describedBy={describedBy} invalid={invalid}
        />
      )
    case 'multi_choice': {
      if (optionsStatus && (optionsStatus.loading || optionsStatus.error)) return <OptionsUnavailable id={id} status={optionsStatus} describedBy={describedBy} />
      const selected = asList(value)
      return (
        <div role="group" aria-labelledby={`${id}-label`} aria-describedby={describedBy} {...(locked ? { 'data-read-only': '' } : {})} className="flex flex-wrap gap-1.5 pt-1">
          {(field.options ?? []).map((option) => {
            const on = selected.includes(option)
            return (
              <button
                key={option}
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-readonly={locked || undefined}
                disabled={field.read_only}
                onClick={() => { if (!locked) onChange(on ? selected.filter((v) => v !== option) : [...selected, option]) }}
                className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-60', locked && 'cursor-default border-dashed')}
                style={on
                  ? { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }
                  : { borderColor: invalid ? 'var(--status-blocked)' : 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
              >
                {optionLabel(field, option)}
              </button>
            )
          })}
        </div>
      )
    }
    case 'user':
      return (
        <AutocompleteSelect
          value={text(value)}
          onChange={(next) => onChange(next)}
          options={people.map((p) => ({ value: p.id, label: p.display_name || p.email || p.id, hint: p.display_name && p.email ? p.email : undefined }))}
          placeholder={field.placeholder || 'Choose a person…'}
          clearable={!field.required}
          disabled={field.read_only}
          size="md"
          id={id} labelledBy={`${id}-label`} describedBy={describedBy} invalid={invalid}
        />
      )
    default: {
      const type = INPUT_TYPE[field.type] ?? 'text'
      const shown = field.type === 'date' ? dateValue(value) : field.type === 'datetime' ? dateTimeLocalValue(value) : text(value)
      const input = (
        <Input
          {...common}
          type={type}
          inputMode={field.type === 'currency' ? 'decimal' : undefined}
          step={field.type === 'currency' ? '0.01' : field.type === 'number' ? 'any' : undefined}
          min={field.type === 'date' ? field.min_date?.slice(0, 10) : field.min}
          max={field.type === 'date' ? field.max_date?.slice(0, 10) : field.max}
          minLength={field.min_length}
          maxLength={field.max_length}
          value={shown}
          placeholder={field.placeholder}
          className={locked ? READ_ONLY_CONTROL : undefined}
          onChange={(e) => {
            if (locked) return
            if (field.type === 'datetime') {
              const d = new Date(e.target.value)
              onChange(e.target.value && !Number.isNaN(d.getTime()) ? d.toISOString() : e.target.value)
            } else onChange(e.target.value)
          }}
        />
      )
      if (field.type !== 'currency') return input
      return (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium text-fg-muted">{field.currency ?? 'USD'}</span>
          <div className="[&_input]:pl-12">{input}</div>
        </div>
      )
    }
  }
}

function FieldCell({ field, value, onChange, error, readOnly, labelClass, labelLeft, idPrefix, peopleMap, people, singleColumn, values, fields, fullLayout, locked = false }: {
  /** Read only by a rule (Make read only / editable): shown as a read-only control, still submitted. */
  locked?: boolean
  fields: TaskFieldDef[]
  fullLayout: FormLayout | null | undefined
  singleColumn?: boolean
  values: Record<string, unknown>
  field: TaskFieldDef
  value: unknown
  onChange?: (key: string, value: unknown) => void
  error?: string
  readOnly: boolean
  labelClass: string
  labelLeft: boolean
  idPrefix: string
  peopleMap: Map<string, string>
  people: Array<{ id: string; display_name: string | null; email: string | null }>
}) {
  const id = `${idPrefix}${field.key}`
  if (field.type === 'heading') {
    return (
      <div className="pt-2">
        <h3 className="text-sm font-semibold text-fg">{field.label.includes('{{') ? resolveHeaderText(field.label, values) : field.label}</h3>
        {field.help_text && <p className="mt-0.5 text-xs text-fg-muted">{field.help_text.includes('{{') ? resolveHeaderText(field.help_text, values) : field.help_text}</p>}
      </div>
    )
  }
  if (field.type === 'divider') return <hr className="my-1 border-t border-border" aria-hidden />
  if (field.type === 'label') {
    // Display text (lib/forms/label-field.ts): an expression's live value; else what rules / the default put in the values.
    const live = field.label_config?.expression && (readOnly ? value === undefined : true) ? computeLabelValues(fields, values)[field.key]?.value : undefined
    const shown = live !== undefined ? live : value !== undefined ? value : field.default ?? null
    return <LabelDisplay field={field} value={shown} id={id} dynamic={!readOnly && isDynamicLabel(field, fullLayout)} />
  }
  if (field.type === 'button') {
    if (readOnly) return null
    return <FieldButtonCell field={field} fields={fields} layout={fullLayout} values={values} onChange={onChange} idPrefix={idPrefix} disabled={field.read_only} />
  }

  const label = (
    <label id={`${id}-label`} htmlFor={id} className={cn('block font-medium', labelClass, labelLeft ? 'sm:pt-2.5' : 'mb-1', 'text-fg-muted')}>
      {field.label}
      {field.required && !readOnly && !locked && <span className="ml-0.5 text-(--status-blocked)" aria-hidden>*</span>}
    </label>
  )
  const help = field.help_text ? <p id={`${id}-help`} className="mt-1 text-2xs text-fg-muted">{field.help_text}</p> : null

  if (readOnly && field.type === 'data_table') {
    // A read-only table shows its live rows (where the surface can query them); select / edit tables show the stored value.
    return (
      <div>
        {label}
        {field.data_table?.mode === 'display'
          ? <DataTableField field={field} value={null} values={values} onChange={() => {}} id={id} disabled />
          : <DataTableValueView field={field} value={value} />}
      </div>
    )
  }

  if (readOnly) {
    return (
      <div className={cn(labelLeft && 'sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-3')}>
        {label}
        {holdsFiles(field)
          ? <div className="text-sm text-fg"><AttachmentList value={value} /></div>
          : isSurveyType(field.type) ? <SurveyAnswerView field={field} value={value} />
          : <p className="text-sm break-words whitespace-pre-wrap text-fg">{field.type === 'lookup' ? lookupDisplayValue(field, value, values[lookupItemKey(field.key)], values[lookupLabelKey(field.key)]) : formatFieldValue(field, value, peopleMap)}</p>}
      </div>
    )
  }

  const control = <FieldControl field={field} value={value} onChange={(v) => onChange?.(field.key, v)} error={error} id={id} people={people} values={values} setValue={(key, v) => onChange?.(key, v)} reportRows={field.type === 'data_table' && tablesReadByLabels(fields).has(field.key)} locked={locked} />
  const errorLine = error ? <p id={`${id}-error`} role="alert" className="mt-1 text-2xs text-(--status-blocked)">{error}</p> : null
  if (field.type === 'boolean') {
    // Aligned with the inputs beside it on wider screens; no gap when the row collapses to one column.
    return <div className={cn(!labelLeft && !singleColumn && 'sm:pt-5')}>{control}{help}{errorLine}</div>
  }
  if (labelLeft && field.type !== 'data_table') {
    return (
      <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-3">
        {label}
        <div>{control}{help}{errorLine}</div>
      </div>
    )
  }
  return <div>{label}{control}{help}{errorLine}</div>
}

export function FormRenderer(rawProps: FormRendererProps) {
  const pager = useFormPager()
  // Parameters and variables ({{param.x}}, {{var.x}}): defaults and initial values filled in (lib/forms/form-params.ts).
  // …and the controls' live state ({{control.<key>.*}}: selections, last clicked row, the current step — lib/forms/rule-variables.ts).
  const stepId = pager?.currentId ?? null
  const values = useMemo(() => {
    const ctx = withFormContext(rawProps.layout, rawProps.values)
    const pages = layoutPages(rawProps.layout)
    const reported = (ctx[CONTROLS_KEY] && typeof ctx[CONTROLS_KEY] === 'object' ? ctx[CONTROLS_KEY] : {}) as Record<string, unknown>
    const withStep = pages.length && stepId ? { ...ctx, [CONTROLS_KEY]: { ...reported, form: { step_id: stepId } } } : ctx
    const out = withControlState(rawProps.fields, withStep, pages, layoutSectionControls(rawProps.layout))
    return out === withStep && withStep === ctx ? ctx : out
  }, [rawProps.layout, rawProps.values, rawProps.fields, stepId])
  const editable = !rawProps.readOnly && Boolean(rawProps.onChange)
  // When to load (lib/forms/lazy-load.ts): parts not loaded yet mount nothing and resolve no bound property but defaults.
  const lazy = useLazyState(rawProps.layout, rawProps.values, rawProps.onChange, editable)
  // Dynamic properties (lib/forms/dynamic-values.ts): bound options, bounds, texts and control props resolved.
  const dynamic = useDynamicFields(rawProps.fields, values, rawProps.readOnly ? undefined : rawProps.onChange, editable, lazy.deferred)
  const props = values === rawProps.values && dynamic.fields === rawProps.fields ? rawProps : { ...rawProps, values, fields: dynamic.fields }
  const body = <LazyPartsProvider value={lazy.api}><DynamicStatusProvider value={dynamic.status}><FormRendererBody {...props} /></DynamicStatusProvider></LazyPartsProvider>
  // Form animations (lib/forms/motion.ts): the form's first load, for the fields' entrance.
  return editable ? <FormEnteringScope>{body}</FormEnteringScope> : body
}

function FormRendererBody(props: FormRendererProps) {
  const pager = useFormPager()
  const lazy = useLazyParts()
  const { layout } = props
  const editable = !props.readOnly && Boolean(props.onChange)
  // Form rules run on editable views of a form that has them (lib/forms/form-rules.ts); banners and
  // questions (rules' and Buttons') go through the message centre — forms with neither are unchanged.
  const withRules = (inner: React.ReactNode) => {
    // Labels (lib/forms/label-field.ts): expressions kept current, "Label changes" dispatched (inside the rules scope).
    const labelled = editable && props.fields.some((f) => f.type === 'label')
      ? <><LabelValues fields={props.fields} layout={layout} values={props.values} onChange={props.onChange} />{inner}</>
      : inner
    // When to load: steps / tabs opened, submits and errors load their parts; "Section / tab loaded" dispatched.
    const node = editable && lazy && (!isPaged(layout) || pager)
      ? <><LazyLoadController fields={props.fields} layout={layout} values={props.values} errors={pager ? pager.errors : props.errors} isHidden={hiddenLookup(props.fields, props.values, layout)} />{labelled}</>
      : labelled
    const ruled = editable && layout?.rules?.length
      ? <FormRulesScope fields={props.fields} layout={layout} values={props.values} onChange={props.onChange} idPrefix={props.idPrefix ?? 'task-field-'}>{node}</FormRulesScope>
      : node
    return editable && (layout?.rules?.length || props.fields.some((f) => f.type === 'button'))
      ? <FormMessagesScope>{ruled}</FormMessagesScope>
      : ruled
  }
  if (!isPaged(layout)) return withRules(<FormGrid {...props} />)
  if (!editable) return <StackedPages {...props} layout={layout} />
  if (!pager) {
    return (
      <FormPagesProvider fields={props.fields} layout={layout} values={props.values} errors={props.errors} idPrefix={props.idPrefix ?? 'task-field-'}>
        <FormRenderer {...props} />
      </FormPagesProvider>
    )
  }
  return withRules(<PagedForm {...props} pager={pager} />)
}

/** "Is this field hidden?" for the lazy-load controller, computed once on first use. */
function hiddenLookup(fields: TaskFieldDef[], values: Record<string, unknown>, layout: FormLayout | null | undefined): (key: string) => boolean {
  let hidden: Set<string> | null = null
  return (key) => (hidden ??= hiddenFieldKeysForValues(fields, values, layout)).has(key)
}

/** Whether any field on the page shows for these values (buttons and button hides aside in read-only views). */
function pageHasContent(page: FormPage, fields: TaskFieldDef[], values: Record<string, unknown>, layout?: FormLayout | null, readOnly?: boolean): boolean {
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const visible = fieldVisibility(fields, layout, values, Boolean(readOnly))
  return page.rows.some((row) => row.cells.some((c) => byKey.has(c.field_key) && !(readOnly && byKey.get(c.field_key)!.type === 'button') && visible(byKey.get(c.field_key)!)))
}

function hasValue(v: unknown): boolean {
  return !(v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0))
}

/**
 * Who shows: no button hid it, its rule holds (state flags included).
 * Read-only: button hides are ignored and a state-ruled field with a value shows.
 */
function fieldVisibility(fields: TaskFieldDef[], layout: FormLayout | null | undefined, values: Record<string, unknown>, readOnly: boolean): (field: TaskFieldDef) => boolean {
  const scope = withFormState(layout, values)
  const hidden = readOnly ? new Set<string>() : stateHiddenFieldKeys(layout, fields, scope)
  // "Always" rules: recomputed from the values (read-only views too, like Visible when).
  for (const key of ruleHiddenFieldKeys(layout, fields, scope)) hidden.add(key)
  // A section's own Visible when (lib/forms/sections.ts).
  for (const key of sectionRuleHiddenFieldKeys(layout, scope, isRuleMet)) hidden.add(key)
  return (field) => {
    if (hidden.has(field.key)) return false
    if (readOnly && field.visible_when && stateRuleFlag(field.visible_when.field)) return hasValue(values[field.key]) || isRuleMet(field.visible_when, scope)
    return isFieldVisible(field, scope)
  }
}

function PageTitle({ page, level = 'h2', id, children }: { page: Pick<FormPage, 'title' | 'description' | 'icon'>; level?: 'h2' | 'h3'; id?: string; children?: React.ReactNode }) {
  const Heading = level
  return (
    <div className="mb-3 flex items-start gap-2" data-page-heading>
      <div className="min-w-0 flex-1">
        <Heading id={id} tabIndex={id ? -1 : undefined} className={cn('flex items-center gap-1.5 font-semibold outline-none', level === 'h2' ? 'text-base' : 'text-sm', 'text-fg')}>
          <PageIcon icon={page.icon} size={level === 'h2' ? 16 : 14} />
          {page.title}
        </Heading>
        {page.description && <p className="mt-0.5 whitespace-pre-wrap text-xs text-fg-muted">{page.description}</p>}
      </div>
      {children}
    </div>
  )
}

/** Read-only paged form (completed tasks, viewers, phones' read-only views): every shown page stacked under its title. */
function StackedPages(props: FormRendererProps & { layout: FormLayout }) {
  // Read-only: pages a button hid still show (their answers stay visible).
  const scope = withFormState(props.layout, props.values)
  const pages = (props.layout.pages ?? [])
    .filter((page) => (page.visible_when && stateRuleFlag(page.visible_when.field)) || isRuleMet(page.visible_when, scope))
    .filter((page) => pageHasContent(page, props.fields, props.values, props.layout, true))
  return (
    <div className="flex flex-col gap-5" data-form-pages="stacked">
      {pages.map((page) => (
        <section key={page.id} aria-label={page.title} data-page={page.id}>
          <PageTitle page={page} level="h3" />
          <FormGrid {...props} fullLayout={props.layout} layout={{ rows: page.rows }} />
        </section>
      ))}
    </div>
  )
}

/** The current step / tab, with the stepper or tab bar (and Back / Next unless the surface's FormStepActions draws them). */
function PagedForm(props: FormRendererProps & { pager: FormPager }) {
  const { pager, idPrefix = 'task-field-' } = props
  const steps = pager.mode === 'steps'
  const onChange = (key: string, value: unknown) => { pager.clearError(key); props.onChange?.(key, value) }
  const grid = { ...props, errors: pager.errors, onChange }
  const lazy = useLazyParts()
  // When to load: a lazy step / tab shows a placeholder until it loads ("when first shown": as it opens).
  const lazyPage = pager.current && lazy?.parts.has(`page:${pager.current.id}`) ? `page:${pager.current.id}` : null
  // Form animations: the new step / tab slides in from the way the person is going.
  const motion = useFormMotion(props.layout)
  const shownId = pager.isReview ? '__review' : pager.currentId
  const [travel, setTravel] = useState<{ id: string | null; dir: TravelDirection }>({ id: shownId, dir: 'none' })
  if (travel.id !== shownId) {
    const order = [...pager.pages.map((p) => p.id), '__review']
    setTravel({ id: shownId, dir: travelDirection(order, travel.id, shownId) })
  }
  const fmPage = motion.on && travel.dir !== 'none' ? travel.dir : undefined
  let body: React.ReactNode = null
  if (pager.isReview) {
    const pages = pager.pages.filter((page) => pageHasContent(page, props.fields, props.values, props.layout))
    body = (
      <div key="__review" data-form-review data-fm-page={fmPage}>
        <h2 id={`${idPrefix}page-heading`} tabIndex={-1} className="mb-3 text-base font-semibold outline-none text-fg">{pager.settings.review_title}</h2>
        <div className="flex flex-col gap-4">
          {pages.map((page) => (
            <section key={page.id} className="rounded-lg border p-3 border-border" aria-label={page.title} data-review-page={page.id}>
              <PageTitle page={page} level="h3">
                <button type="button" onClick={() => pager.goTo(page.id)} className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium underline-offset-2 hover:underline text-primary-text" aria-label={`Edit ${page.title}`} data-review-edit={page.id}>
                  Edit
                </button>
              </PageTitle>
              <FormGrid {...props} readOnly fullLayout={props.layout} layout={{ rows: page.rows }} errors={pager.errors} />
            </section>
          ))}
        </div>
      </div>
    )
  } else if (pager.current) {
    const page = pager.current
    body = (
      <div
        role={steps ? undefined : 'tabpanel'}
        id={steps ? undefined : `${idPrefix}panel-${page.id}`}
        aria-labelledby={steps ? undefined : `${idPrefix}tab-${page.id}`}
        tabIndex={steps ? undefined : 0}
        key={page.id}
        className="outline-none"
        data-page={page.id}
        data-fm-page={fmPage}
      >
        {steps
          ? <PageTitle page={page} id={`${idPrefix}page-heading`} />
          : page.description ? <p className="mb-3 whitespace-pre-wrap text-xs text-fg-muted">{page.description}</p> : null}
        {lazyPage && !lazy?.loaded.has(lazyPage)
          ? <LazyPartPlaceholder target={lazyPage} title={page.title} rows={page.rows.length} height={estimatePartHeight(page.rows, new Map(props.fields.map((f) => [f.key, f])))} />
          : lazyPage
            ? <LazyReveal target={lazyPage}><FormGrid {...grid} fullLayout={props.layout} layout={{ rows: page.rows }} /></LazyReveal>
            : <FormGrid {...grid} fullLayout={props.layout} layout={{ rows: page.rows }} />}
      </div>
    )
  }
  // Controls on the other steps / tabs: their frames warm up in the background.
  const later = new Set(pager.pages.filter((page) => page.id !== pager.currentId).flatMap((page) => page.rows.flatMap((row) => row.cells.map((c) => c.field_key))))
  // …not those of parts that have not loaded (unless the part preloads, once the form is idle).
  const warm = (key: string) => !lazy?.unloaded.has(key) || (lazy.idle && [...lazy.parts.values()].some((p) => p.preload && p.fieldKeys.includes(key)))
  const laterControls = props.fields.filter((f) => f.type === 'custom' && later.has(f.key) && warm(f.key))
  return (
    <div data-form-pages={pager.mode} data-current-page={pager.currentId} {...motionAttrs(motion.level)}>
      {steps ? <StepIndicator pager={pager} vertical={props.singleColumn || props.compact} /> : <FormTabBar pager={pager} />}
      {body}
      {laterControls.length > 0 && <ControlPrewarm fields={laterControls} />}
      {steps && !pager.hasActions && <StepNav pager={pager} />}
    </div>
  )
}

/** A form part: held back until its custom controls have painted (components/forms/control-ready.tsx). */
function FormGrid(props: FormRendererProps) {
  return props.fields.some((f) => f.type === 'custom')
    ? <ControlReadyBoundary><FormGridBody {...props} /></ControlReadyBoundary>
    : <FormGridBody {...props} />
}

function FormGridBody({ fields, layout, fullLayout, values: rawValues, onChange: rawOnChange, errors: rawErrors, readOnly, compact, singleColumn, labelPosition = 'top', density = 'comfortable', idPrefix = 'task-field-' }: FormRendererProps) {
  const disabled = Boolean(readOnly || !rawOnChange)
  const whole = fullLayout ?? layout
  const runtime = useFormRuntime()
  const rules = useFormRules()
  // When to load (lib/forms/lazy-load.ts): read-only grids (the review step, completed tasks) load everything.
  const lazyApi = useLazyParts()
  const lazy = disabled ? null : lazyApi
  // An in-form Validate's errors (single page; the pager merges them on paged forms).
  const errors = runtime && Object.keys(runtime.errors).length ? { ...(rawErrors ?? {}), ...runtime.errors } : rawErrors
  const fieldKeys = useMemo(() => new Set(fields.map((f) => f.key)), [fields])
  const onChange = rawOnChange && (runtime || rules)
    ? (key: string, value: unknown) => {
      runtime?.clearError(key)
      const previous = rawValues[key]
      rawOnChange(key, value)
      // Form rules: "Field value changes" (value fields only; not the state, items or labels).
      if (rules && fieldKeys.has(key) && previous !== value) rules.notifyChange(key, value, previous)
    }
    : rawOnChange
  const values = useMemo(() => withFormState(whole, rawValues), [whole, rawValues])
  const labelClass = compact ? 'text-2xs' : 'text-xs'
  const needsPeople = fields.some((f) => f.type === 'user')
  const { data: people = [] } = usePeople(needsPeople)
  const peopleMap = useMemo(() => new Map(people.map((p) => [p.id, p.display_name || p.email || p.id])), [people])
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields])
  const visibleRule = useMemo(() => fieldVisibility(fields, whole, rawValues, disabled), [fields, whole, rawValues, disabled])
  const visible = (field: TaskFieldDef) => !(disabled && field.type === 'button') && visibleRule(field)
  // Form animations (lib/forms/motion.ts): editable forms only. A field a rule hides stays a moment to collapse out.
  const motion = useFormMotion(whole)
  const fmOn = motion.on && !disabled
  const shownKeys = (layout ? renderableRows(layout, true).flatMap((row) => row.cells.map((c) => c.field_key)) : fields.map((f) => f.key))
    .filter((k) => byKey.has(k) && visible(byKey.get(k)!))
  const exiting = useExitingKeys(shownKeys, fmOn, FORM_MOTION_TIMING.expressive.fieldMs)
  const kept = (field: TaskFieldDef) => visible(field) || exiting.has(field.key)
  const stagger = (position: number) => (fmOn ? staggerIndex(position, fields.length, motion.level) : undefined)
  // Disabled by a rule (Enable / disable, Always rules): the control is read-only, its value kept.
  const ruled = (field: TaskFieldDef) => (rules?.disabledKeys.has(field.key) && !field.read_only ? { ...field, read_only: true } : field)
  // Read only by a rule (Make read only / editable — the control, its section, step / tab or the whole form):
  // not greyed out like disabled; a disabled or Read-only field keeps its own look.
  const locked = (field: TaskFieldDef) => Boolean(rules?.readOnlyKeys.has(field.key)) && !field.read_only && !rules?.disabledKeys.has(field.key)
  const gap = density === 'compact' ? 'gap-2' : 'gap-3'
  const labelLeft = labelPosition === 'left' && !singleColumn
  // Sections (lib/forms/sections.ts): read-only views collapse locally; live forms keep it in the form state (rules can collapse too).
  const [localCollapsed, setLocalCollapsed] = useState<Set<string>>(() => new Set((whole?.sections ?? []).filter((s) => s.collapsible && s.collapsed).map((s) => `section:${s.key}`)))

  // Form rules: "Field gets focus" / "Field loses focus" (focus entering / leaving the cell).
  const focusEvents = (key: string) => (rules && !disabled && byKey.has(key) && !isDisplayField(byKey.get(key)!) ? {
    onFocus: (e: React.FocusEvent<HTMLDivElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) rules.dispatch({ type: 'focus', target: key, context: { field: key, value: rawValues[key] } }) },
    onBlur: (e: React.FocusEvent<HTMLDivElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) rules.dispatch({ type: 'blur', target: key, context: { field: key, value: rawValues[key] } }) },
  } : {})

  const cell = (field: TaskFieldDef) => (
    <FieldCell
      field={ruled(field)}
      locked={locked(field)}
      value={values[field.key]}
      onChange={onChange}
      error={errors?.[field.key]}
      readOnly={disabled}
      labelClass={labelClass}
      labelLeft={labelLeft}
      idPrefix={idPrefix}
      peopleMap={peopleMap}
      people={people}
      singleColumn={singleColumn || compact}
      values={values}
      fields={fields}
      fullLayout={whole}
    />
  )

  if (layout) {
    const sections = new Map((whole?.sections ?? []).map((s) => [s.key, s]))
    const rows = renderableRows(layout, true)
      .map((row) => ({ ...row, cells: row.cells.filter((c) => byKey.has(c.field_key) && kept(byKey.get(c.field_key)!)) }))
      .filter((row) => row.cells.length > 0 || (row.section !== undefined && sections.has(row.section)))
    const renderRow = (row: (typeof rows)[number], r: number) => (
      <div key={r} className={cn('grid grid-cols-1', gap, !singleColumn && SM_COLS[row.columns])} data-columns={row.columns}>
        {row.cells.map((c) => (
          <MotionCell key={c.field_key} on={fmOn} index={stagger(r)} exiting={exiting.has(c.field_key)} id={`${idPrefix}cell-${c.field_key}`} className={cn('min-w-0', !singleColumn && SM_SPAN[c.span])} {...focusEvents(c.field_key)}>
            {cell(byKey.get(c.field_key)!)}
          </MotionCell>
        ))}
      </div>
    )
    const scope = values
    const state = readFormState(whole, rawValues)
    const ruleHidden = sections.size ? alwaysRuleEffects(whole, scope).hidden : new Set<string>()
    const collapsedSet = disabled ? localCollapsed : new Set(state.collapsed ?? [])
    const sectionShown = (key: string) => {
      const s = sections.get(key)!
      if (!disabled && state.hidden.includes(`section:${key}`)) return false
      if (ruleHidden.has(`section:${key}`)) return false
      return !s.visible_when || isRuleMet(s.visible_when, scope)
    }
    const toggle = (key: string) => {
      const target = `section:${key}`
      if (disabled) { setLocalCollapsed((prev) => { const next = new Set(prev); if (next.has(target)) next.delete(target); else next.add(target); return next }); return }
      rawOnChange?.(FORM_STATE_KEY, applyCollapsed(state, 'toggle', [target]))
    }
    // A section whose every control a rule made read only: no Add / Remove either (its inclusion is a value too).
    const sectionLocked = (key: string) => {
      if (!rules?.readOnlyKeys.size) return false
      const keys = sectionRowFieldKeys(whole, key).filter((k) => byKey.has(k) && !isDisplayField(byKey.get(k)!) && byKey.get(k)!.type !== 'label')
      return keys.length > 0 && keys.every((k) => rules.readOnlyKeys.has(k))
    }
    const include = (key: string, yes: boolean) => {
      rawOnChange?.(sectionIncludedKey(key), yes)
      rules?.dispatch({ type: 'section_change', target: key, context: { section: key, included: yes } })
      if (yes) requestAnimationFrame(() => (document.getElementById(`${idPrefix}section-${key}`)?.querySelector('input, select, textarea, button') as HTMLElement | null)?.focus())
    }
    return (
      <MotionContainerScope entering>
      <div className={cn('flex flex-col', density === 'compact' ? 'gap-2' : 'gap-3')} data-form-layout="grid" {...(fmOn ? motionAttrs(motion.level) : {})}>
        <FormLevelError errors={errors} />
        {sectionBlocks(rows).map((block) => {
          const section = block.section ? sections.get(block.section) : undefined
          if (!section) return block.rows.filter((row) => row.cells.length > 0).map((row, i) => renderRow(row, block.start + i))
          if (!sectionShown(section.key)) return null
          const included = isSectionIncluded(section, rawValues)
          const filled = block.rows.filter((row) => row.cells.length > 0)
          if (!filled.length && !section.optional) return null
          return (
            <FormSectionBlock
              key={`section-${section.key}`}
              section={section}
              idPrefix={idPrefix}
              included={included}
              collapsed={collapsedSet.has(`section:${section.key}`)}
              readOnly={disabled}
              hasError={filled.some((row) => row.cells.some((c) => errors?.[c.field_key]))}
              onToggle={() => toggle(section.key)}
              onInclude={disabled || sectionLocked(section.key) ? undefined : (yes) => include(section.key, yes)}
            >
              {(() => {
                const target = `section:${section.key}`
                const part = lazy?.parts.get(target)
                const inner = (
                  <div className={cn('flex flex-col', density === 'compact' ? 'gap-2' : 'gap-3')}>
                    {filled.map((row, i) => renderRow(row, block.start + i))}
                  </div>
                )
                if (!part || !lazy) return inner
                // Not loaded: a placeholder; "when first shown" loads it as it scrolls into view (or is expanded).
                if (!lazy.loaded.has(target)) return <LazyPartPlaceholder target={target} title={section.title} rows={filled.length} height={estimatePartHeight(filled, byKey, density === 'compact' ? 8 : 12)} onVisible={part.load === 'visible' ? () => lazy.load([target]) : undefined} />
                return <LazyReveal target={target}>{inner}</LazyReveal>
              })()}
            </FormSectionBlock>
          )
        })}
      </div>
      </MotionContainerScope>
    )
  }

  // Classic flow (no layout): two columns on wider screens, long fields full width.
  return (
    <MotionContainerScope entering>
    <div className={cn('grid', gap, compact || singleColumn ? 'grid-cols-1' : 'sm:grid-cols-2')} {...(fmOn ? motionAttrs(motion.level) : {})}>
      <div className="sm:col-span-2 empty:hidden"><FormLevelError errors={errors} /></div>
      {fields.filter(kept).map((field, i) => {
        const wide = !compact && !singleColumn && (field.type === 'text' || field.type === 'textarea' || isDisplayField(field) || field.type === 'multi_choice' || field.type === 'attachments' || field.type === 'data_table' || field.type === 'matrix' || field.type === 'likert' || field.type === 'nps' || field.type === 'ranking' || field.type === 'image_choice' || (field.type === 'custom' && Boolean(field.custom?.size?.full_width)))
        return (
          <MotionCell key={field.key} on={fmOn} index={stagger(Math.floor(i / 2))} exiting={exiting.has(field.key)} id={`${idPrefix}cell-${field.key}`} className={cn('min-w-0', wide && !disabled && 'sm:col-span-2', wide && disabled && isDisplayField(field) && 'sm:col-span-2')} {...focusEvents(field.key)}>
            {cell(field)}
          </MotionCell>
        )
      })}
    </div>
    </MotionContainerScope>
  )
}

/**
 * A grid cell with its animation (components/forms/form-motion.tsx), fixed
 * when it mounts: enters (staggered) on the form's first load, reveals when
 * a rule shows it later, collapses out when a rule hides it (inert then:
 * no focus, not announced).
 */
function MotionCell({ on, index, exiting, children, ...rest }: React.HTMLAttributes<HTMLDivElement> & { on: boolean; index: number | undefined; exiting: boolean }) {
  const mode = useCellMotion(on)
  const fm = exiting ? 'exit' : mode === 'enter' ? (index === undefined ? undefined : 'enter') : mode ?? undefined
  return (
    <div {...rest} data-fm={fm} style={fm === 'enter' ? staggerStyle(index) : undefined} inert={exiting || undefined} aria-hidden={exiting || undefined}>
      {children}
    </div>
  )
}
