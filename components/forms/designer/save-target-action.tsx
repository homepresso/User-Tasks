'use client'

/**
 * The "Save to …" step of a Save / outcome button's rule (action type
 * save_target) — the write to the record the form is bound to, shown and
 * edited like any other step:
 *
 *   - what it writes to (the provider's name for it, e.g. SharePoint list
 *     "Requests") and the operation (the default for the form, or create a
 *     new record / update the opened one);
 *   - what happens on a conflict (the record changed since the form
 *     opened): refuse, or overwrite;
 *   - the provider's own options (e.g. a library form uploading the file);
 *   - the field → column mapping: the binding's one mapping
 *     (layout.data_target.config, the same as Form settings → Connected to),
 *     edited through the provider (describe / bind);
 *   - columns set from an expression ({{user.email}}, a fixed value,
 *     {{form.x}} …), resolved on the server.
 *
 * The run time does exactly this (lib/services/form-submissions.ts): with
 * the binding's `writes: 'rules'`, a button without this step writes nothing.
 */

import { createContext, useContext } from 'react'
import { AlertTriangle, Plus, X } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import type { FormAction } from '@/lib/forms/buttons'
import type { DesignerState } from '@/lib/forms/designer-state'
import { DataTargetPanel, useTargetDescription } from './data-target-panel'

/** The saved form and the designer state (FormSettings provides it): the step edits the binding's mapping. */
export const SaveTargetContext = createContext<{ formId: string; state: DesignerState; onChange: (next: DesignerState, tag?: string) => void } | null>(null)

export function SaveTargetActionEditor({ action, onChange, placeholders }: {
  action: FormAction
  onChange: (next: FormAction, tag?: string) => void
  placeholders: Array<{ name: string; group: string; label?: string }>
}) {
  const scope = useContext(SaveTargetContext)
  const { data } = useTargetDescription(scope?.formId ?? null, scope?.state ?? ({ fields: [], layout: {} } as never))
  const d = data?.description ?? null
  const save = d?.save ?? null
  if (!scope) return <p className="text-2xs text-fg-muted">Save the form first: the step needs its connection.</p>
  const writable = (d?.sourceFields ?? []).filter((s) => !s.readOnly && s.fieldTypes.length)
  const values = action.values ?? {}
  const setValues = (next: Record<string, string>, tag?: string) => {
    const out = { ...action }
    if (Object.keys(next).length) out.values = next
    else delete out.values
    onChange(out, tag)
  }
  const unusedForExpr = writable.filter((s) => !(s.key in values))
  return (
    <div className="space-y-2 text-2xs" data-save-target-editor>
      <p className="font-medium text-fg">{save?.label ?? d?.title ?? `Save to ${data?.label ?? 'the connected record'}`}</p>
      {save && save.operations.length > 0 && (
        <div>
          <p className="text-fg-muted">What it does</p>
          <AutocompleteSelect value={action.operation ?? ''} options={save.operations.map((o) => ({ value: o.value, label: o.label, hint: o.help ?? undefined }))}
            onChange={(v) => { const next = { ...action }; if (v === 'create' || v === 'update') next.operation = v; else delete next.operation; onChange(next) }} />
        </div>
      )}
      {save?.conflict && (
        <div>
          <p className="text-fg-muted">If someone changed it since the form opened</p>
          <AutocompleteSelect value={action.conflict ?? 'refuse'} options={[{ value: 'refuse', label: 'Stop and ask the person to reload (keeps their change safe)' }, { value: 'overwrite', label: 'Overwrite their change' }]}
            onChange={(v) => { const next = { ...action }; if (v === 'overwrite') next.conflict = 'overwrite'; else delete next.conflict; onChange(next) }} />
        </div>
      )}
      {(save?.options ?? []).map((o) => {
        const value = typeof action.options?.[o.key] === 'boolean' ? action.options[o.key] === true : o.value
        return (
          <label key={o.key} className="flex items-start gap-1.5">
            <input type="checkbox" className="mt-0.5 accent-primary" checked={value}
              onChange={(e) => {
                const options = { ...(action.options ?? {}) }
                if (e.target.checked === o.value) delete options[o.key]
                else options[o.key] = e.target.checked
                const next = { ...action }
                if (Object.keys(options).length) next.options = options
                else delete next.options
                onChange(next)
              }} />
            <span>{o.label}{o.help && <span className="block text-fg-muted">{o.help}</span>}</span>
          </label>
        )
      })}
      <div className="rounded border border-border p-2">
        {/* The binding's one mapping: the same as Form settings → Connected to. */}
        <DataTargetPanel formId={scope.formId} state={scope.state} onChange={scope.onChange} compact />
      </div>
      <div data-save-target-values>
        <p className="mb-1 font-medium text-fg">Set from an expression</p>
        {Object.entries(values).map(([source, template]) => {
          const col = (d?.sourceFields ?? []).find((s) => s.key === source)
          return (
            <div key={source} className="mb-1 grid grid-cols-[1fr_1.4fr_auto] items-center gap-1" data-save-target-value={source}>
              <span className="truncate" title={col?.typeLabel}>{col?.label ?? source}</span>
              <VariableInput value={template} extraVariables={placeholders} placeholder="{{user.email}} or a fixed value"
                onChange={(v) => setValues({ ...values, [source]: v }, `save-value-${source}`)} />
              <button type="button" aria-label={`Stop setting ${col?.label ?? source}`} className="rounded p-0.5" onClick={() => { const next = { ...values }; delete next[source]; setValues(next) }}><X size={11} /></button>
            </div>
          )
        })}
        {unusedForExpr.length > 0 && (
          <AutocompleteSelect value="" placeholder="+ Set a column from an expression…"
            options={unusedForExpr.map((s) => ({ value: s.key, label: `${s.label} (${s.typeLabel})` }))}
            onChange={(v) => { if (v) setValues({ ...values, [v]: '' }) }} />
        )}
        <p className="mt-1 text-fg-muted">Fields on the form map above; an expression sets a column without a field — {'{{user.email}}'}, {'{{today}}'}, {'{{form.<field>}}'} or a fixed value. Resolved on the server when the form is saved. Read-only columns can't be set on this record.</p>
      </div>
      {(d?.sourceFields ?? []).some((s) => s.required && !s.readOnly) && action.operation === 'create' && (
        <p className="flex gap-1 text-fg"><AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden />Creating a new record needs every required column (see the warnings above).</p>
      )}
    </div>
  )
}

/** Shown when a designer removes the step: the form stops writing. */
export const SAVE_TARGET_REMOVE_WARNING = 'Without this step the form no longer writes to the connected record — submissions are only stored in UserTasks. Remove it?'

export function SaveTargetAddHint({ label }: { label: string | null }) {
  return <p className="flex items-center gap-1 text-2xs text-fg-muted"><Plus size={10} aria-hidden />This button doesn&apos;t save to {label ?? 'the connected record'}: add the &quot;Save to …&quot; step to write it.</p>
}
