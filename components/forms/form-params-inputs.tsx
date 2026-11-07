'use client'

import { useId } from 'react'
import { FORM_PARAMS_KEY, FORM_PARAM_TYPE_LABELS, layoutFormParams, parseFormParams, type FormParam } from '@/lib/forms/form-params'
import { isPlainObject } from '@/lib/utils/guards'
import { cn } from '@/lib/utils'

/**
 * The form's parameters as inputs, for an embedding context that passes
 * them itself — the Run dialog and the Test runner starting a workflow from
 * a reusable form. Values are kept with the form's values under
 * FORM_PARAMS_KEY (as text; the form and the server parse and validate
 * them). Nothing renders for a form without parameters.
 */
export function FormParamsInputs({ layout, values, onChange, disabled }: {
  layout: unknown
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  disabled?: boolean
}) {
  const id = useId()
  const params = layoutFormParams(layout)
  if (!params.length) return null
  const raw = isPlainObject(values[FORM_PARAMS_KEY]) ? values[FORM_PARAMS_KEY] as Record<string, unknown> : {}
  const parsed = parseFormParams(params, raw)
  const text = (p: FormParam) => {
    const v = raw[p.name]
    return v === undefined || v === null ? '' : Array.isArray(v) ? v.join(', ') : String(v)
  }
  const set = (name: string, value: string) => {
    const next = { ...raw }
    if (value.trim()) next[name] = value
    else delete next[name]
    onChange(FORM_PARAMS_KEY, next)
  }
  return (
    <fieldset className="mb-3 rounded-lg border px-3 py-2 border-border" data-form-params-inputs>
      <legend className="px-1 text-xs font-medium text-fg-muted">Form parameters</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {params.map((p) => {
          const inputId = `${id}-${p.name}`
          const error = parsed.errors[p.name] ?? (parsed.missing.includes(p.name) ? 'Required' : null)
          return (
            <div key={p.name}>
              <label htmlFor={inputId} className="block text-2xs font-medium text-fg-muted">
                {p.label ?? p.name}{p.required && <span className="text-(--status-blocked)" aria-hidden> *</span>}
                <span className="ml-1 font-normal opacity-70">{FORM_PARAM_TYPE_LABELS[p.type]}</span>
              </label>
              {p.type === 'boolean' ? (
                <select id={inputId} disabled={disabled} value={text(p)} onChange={(e) => set(p.name, e.target.value)}
                  className="mt-0.5 w-full rounded-md border px-2 py-1 text-sm border-border bg-input text-fg">
                  <option value="">{p.default ? `Default (${p.default})` : '—'}</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <input id={inputId} disabled={disabled} type={p.type === 'date' ? 'date' : p.type === 'number' ? 'number' : 'text'} value={text(p)}
                  placeholder={p.default ?? (p.type === 'text_list' ? 'a, b, c' : '')} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined}
                  onChange={(e) => set(p.name, e.target.value)}
                  className={cn('mt-0.5 w-full rounded-md border px-2 py-1 text-sm bg-input text-fg', error ? 'border-(--status-blocked)' : 'border-border')} />
              )}
              {error && <p id={`${inputId}-error`} className="mt-0.5 text-2xs text-(--status-blocked)">{error}</p>}
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
