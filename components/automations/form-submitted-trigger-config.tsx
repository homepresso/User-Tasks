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
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

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
        <label className="mb-1 block text-xs font-medium text-fg">Form</label>
        <AutocompleteSelect
          value={formId}
          placeholder="Choose a reusable form…"
          options={forms.map((f) => ({ value: String(f.id), label: String(f.name), hint: `v${f.version} · ${f.field_count} field${f.field_count === 1 ? '' : 's'}` }))}
          onChange={(value) => onBatchUpdate({ form_id: value || undefined, form_name: forms.find((f) => f.id === value)?.name, button_ids: undefined, fields: undefined, form_cached_version: undefined })}
        />
        {formId && (
          <div className="mt-1.5 space-y-1">
            <p className="text-xs text-fg-muted">Form page (people start this workflow here)</p>
            <FormPageLink formId={formId} compact />
          </div>
        )}
        {formId && (
          <div className="mt-1 flex items-center gap-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching} className="-ml-2 text-fg-muted" leadingIcon={<RefreshCw size={14} className={isFetching ? 'animate-spin' : undefined} />}>
              Refresh fields
            </Button>
          </div>
        )}
      </div>
      {buttons.length > 1 && (
        <div>
          <label className="mb-1 block text-xs font-medium text-fg">Only when submitted with</label>
          <div className="flex flex-wrap gap-1.5">
            {buttons.map((b) => {
              const on = selected.includes(b.id)
              return (
                <button key={b.id} type="button" role="checkbox" aria-checked={on}
                  onClick={() => onBatchUpdate({ button_ids: on ? selected.filter((x) => x !== b.id) : [...selected, b.id] })}
                  className={cn('rounded-full border px-2.5 py-0.5 text-xs transition-colors', on ? 'border-primary bg-primary-wash font-medium text-primary-text' : 'border-border text-fg-muted hover:bg-subtle hover:text-fg')}>
                  {b.label}
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-xs text-fg-muted">None selected: any submission starts a run.</p>
        </div>
      )}
      {fields.length > 0 && (
        <Card variant="inset" padding="sm" className="text-fg-muted">
          <p className="mb-1 text-xs font-medium">Available downstream</p>
          <ul className="space-y-0.5 font-mono text-2xs">
            {fields.flatMap((f) => [
              <li key={f.key}>{`{{form.${f.key}}}`}</li>,
              ...(f.type === 'lookup' ? [<li key={`${f.key}-item`}>{`{{form.${lookupItemKey(f.key)}}}`}</li>] : []),
            ])}
            <li>{'{{submitted_by_name}} {{submitted_at}} {{form_button}}'}</li>
          </ul>
        </Card>
      )}
    </div>
  )
}
