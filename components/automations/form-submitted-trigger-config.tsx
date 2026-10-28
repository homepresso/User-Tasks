'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { FormPageLink } from './workflow-form-links'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { serverRead } from '@/lib/server-read'
import { normalizeFormButtons, isSubmittingButton } from '@/lib/forms/buttons'
import { normalizeTaskFields, valueFields } from '@/lib/task-field-schema'
import { lookupItemKey } from '@/lib/forms/lookup'

/* eslint-disable @typescript-eslint/no-explicit-any -- node config is free-form JSON */

/**
 * "Form submitted" trigger settings: the reusable form (its fields are
 * cached on the node so the data picker can type {{form.<key>}}; refreshed
 * whenever the form changed) and, optionally, the buttons / outcomes that
 * start a run.
 */
export function FormSubmittedTriggerConfig({ config, onBatchUpdate }: { config: Record<string, any>; onBatchUpdate: (patch: Record<string, unknown>) => void }) {
  const { data: forms = [] } = useQuery({
    queryKey: ['forms-library', 'trigger-picker'],
    staleTime: 30_000,
    queryFn: async () => ((await serverRead('forms.list')).data?.forms ?? []) as any[],
  })
  const formId = typeof config.form_id === 'string' ? config.form_id : ''
  const { data: form, refetch, isFetching } = useQuery({
    queryKey: ['forms-library', 'form', formId],
    enabled: Boolean(formId),
    queryFn: async () => (await serverRead('forms.get', { id: formId })).data as any,
  })

  // Keep the cached copy of the fields (and the name) in step with the form.
  useEffect(() => {
    if (!form) return
    const fields = normalizeTaskFields(form.fields)
    if (JSON.stringify(fields) !== JSON.stringify(config.fields ?? []) || form.name !== config.form_name || form.version !== config.form_cached_version) {
      onBatchUpdate({ fields, form_name: form.name, form_cached_version: form.version })
    }
  }, [form, config.fields, config.form_name, config.form_cached_version, onBatchUpdate])

  const buttons = form ? normalizeFormButtons(form.buttons).filter(isSubmittingButton) : []
  const selected: string[] = Array.isArray(config.button_ids) ? config.button_ids : []
  const fields = valueFields(normalizeTaskFields(config.fields))

  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()} data-testid="form-submitted-config">
      <div>
        <label className="mb-1 block text-xs font-medium">Form</label>
        <AutocompleteSelect
          value={formId}
          placeholder="Choose a reusable form…"
          options={forms.map((f) => ({ value: String(f.id), label: String(f.name), hint: `v${f.version} · ${f.field_count} field${f.field_count === 1 ? '' : 's'}` }))}
          onChange={(value) => onBatchUpdate({ form_id: value || undefined, form_name: forms.find((f) => f.id === value)?.name, button_ids: undefined, fields: undefined, form_cached_version: undefined })}
        />
        {formId && (
          <div className="mt-1.5 space-y-1">
            <p className="text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Form page (people start this workflow here)</p>
            <FormPageLink formId={formId} compact />
          </div>
        )}
        {formId && (
          <div className="mt-1 flex items-center gap-3 text-[10px]">
            <button type="button" onClick={() => void refetch()} className="inline-flex items-center gap-1" style={{ color: 'var(--theme-muted-text)' }} disabled={isFetching}>
              <RefreshCw size={10} /> Refresh fields
            </button>
          </div>
        )}
      </div>
      {buttons.length > 1 && (
        <div>
          <label className="mb-1 block text-xs font-medium">Only when submitted with</label>
          <div className="flex flex-wrap gap-1.5">
            {buttons.map((b) => {
              const on = selected.includes(b.id)
              return (
                <button key={b.id} type="button" role="checkbox" aria-checked={on}
                  onClick={() => onBatchUpdate({ button_ids: on ? selected.filter((x) => x !== b.id) : [...selected, b.id] })}
                  className="rounded-full border px-2.5 py-0.5 text-[11px]"
                  style={on ? { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : { borderColor: 'var(--theme-surface-border)' }}>
                  {b.label}
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>None selected: any submission starts a run.</p>
        </div>
      )}
      {fields.length > 0 && (
        <div className="rounded-md border p-2 text-[10px]" style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}>
          <p className="mb-1 font-semibold uppercase tracking-wider">Available downstream</p>
          <ul className="space-y-0.5 font-mono">
            {fields.flatMap((f) => [
              <li key={f.key}>{`{{form.${f.key}}}`}</li>,
              ...(f.type === 'lookup' ? [<li key={`${f.key}-item`}>{`{{form.${lookupItemKey(f.key)}}}`}</li>] : []),
            ])}
            <li>{'{{submitted_by_name}} {{submitted_at}} {{form_button}}'}</li>
          </ul>
        </div>
      )}
    </div>
  )
}
