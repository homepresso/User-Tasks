'use client'

import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import type { FieldButtonAction } from '@/lib/forms/field-buttons'
import { FORM_PARAM_TYPE_LABELS, layoutFormVariables } from '@/lib/forms/form-params'
import { cn } from '@/lib/utils'


/**
 * The "Set a variable" rule action (lib/forms/field-buttons.ts): which
 * variable, and set it (to a value: the event's row / item, a field, an
 * expression), clear it or reset it to its initial value. Variables are
 * declared on the Data tab.
 */
export function SetVariableEditor({ action, layout, rowPaths, placeholders, onChange }: {
  action: FieldButtonAction
  layout: unknown
  /** {{event.row.<column>}} / {{event.item.fields.<field>}} paths of the rule's event. */
  rowPaths: string[]
  placeholders: Array<{ name: string; group: string; label?: string }>
  onChange: (next: FieldButtonAction, tag?: string) => void
}) {
  const variables = layoutFormVariables(layout)
  const mode = action.variable_mode ?? 'set'
  const chosen = variables.find((v) => v.name === action.variable)
  if (!variables.length) {
    return <p className="text-2xs text-fg-muted">Declare a variable on the Data tab first.</p>
  }
  return (
    <div className="space-y-1.5" data-set-variable>
      <AutocompleteSelect value={action.variable ?? ''} placeholder="Variable…"
        options={variables.map((v) => ({ value: v.name, label: v.label ?? v.name, hint: FORM_PARAM_TYPE_LABELS[v.type] }))}
        onChange={(v) => onChange({ ...action, variable: v || undefined })} />
      <div className="flex gap-1" role="radiogroup" aria-label="Set, clear or reset">
        {([['set', 'Set to'], ['clear', 'Clear'], ['reset', 'Reset']] as const).map(([v, t]) => (
          <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => onChange({ ...action, variable_mode: v, ...(v === 'set' ? {} : { value: undefined }) })}
            className={cn('h-7 flex-1 rounded border px-1 text-2xs font-medium', mode === v ? 'border-primary' : 'border-border', mode === v ? 'bg-primary-wash' : '', mode === v ? 'text-primary-text' : '')}
           >{t}</button>
        ))}
      </div>
      {mode === 'set' && (
        <>
          {rowPaths.length > 0 && (
            <AutocompleteSelect value={/^\{\{(event\.[\w.]+)\}\}$/.exec(action.value ?? '')?.[1] ?? ''} placeholder="From the row / item…"
              options={[
                ...(rowPaths.some((p) => p.startsWith('event.row.')) && chosen?.type === 'object' ? [{ value: 'event.row', label: 'The whole row', hint: 'row' }] : []),
                ...rowPaths.map((p) => ({ value: p, label: p.replace(/^event\.(row|item\.fields)\./, ''), hint: p.startsWith('event.row') ? 'row column' : 'item field' })),
              ]}
              onChange={(v) => onChange({ ...action, value: v ? `{{${v}}}` : '' })} />
          )}
          <VariableInput value={action.value ?? ''} extraVariables={placeholders} placeholder="{{event.row.CustomerID}}, {{field}}, {{=UPPER(field)}}"
            onChange={(v) => onChange({ ...action, value: v }, 'set-variable-value')} />
        </>
      )}
      <p className="text-2xs text-fg-muted">
        {mode === 'reset' ? 'Back to its initial value (Data tab).' : mode === 'clear' ? 'Empty until something sets it again.' : 'Converted to the variable\'s type. Data tables and lookups that read it query again.'}
      </p>
    </div>
  )
}
