'use client'

import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ReferenceStaticValueInput } from '@/components/shared/reference-static-value-input'
import type { ReportSourceInput } from '@/lib/report-sources'
import {
  buildReferenceInputTemplate,
  getSuggestedReferenceInputValue,
  normalizeReferenceInputPayload,
  type InputJsonValidation,
} from '@/lib/reference-input-utils'

function InputValidationHint({
  validation,
  emptyLabel = 'No inputs configured yet.',
}: {
  validation: InputJsonValidation
  emptyLabel?: string
}) {
  const hasError = Boolean(validation.error)

  return (
    <div
      className="mt-2 rounded-md border px-2 py-1.5 text-[10px]"
      style={{
        borderColor: hasError ? 'var(--status-error)' : 'var(--theme-surface-border)',
        backgroundColor: hasError ? 'var(--status-error-bg)' : 'var(--theme-surface)',
        color: hasError ? 'var(--status-error)' : 'var(--theme-muted-text)',
      }}
    >
      <div className="flex items-center gap-1.5">
        {hasError ? <AlertCircle size={11} /> : <CheckCircle2 size={11} />}
        <span className="font-medium">
          {hasError
            ? validation.error
            : validation.keyCount > 0
              ? `Valid input object with ${validation.keyCount} ${validation.keyCount === 1 ? 'key' : 'keys'}.`
              : emptyLabel}
        </span>
      </div>
    </div>
  )
}

function updateJsonInputFieldValue(
  current: Record<string, any> | undefined,
  input: ReportSourceInput,
  nextValue: any,
) {
  const next = { ...(current ?? {}) }
  next[input.name] = nextValue
  return JSON.stringify(next, null, 2)
}

function removeJsonInputFieldValue(
  current: Record<string, any> | undefined,
  inputName: string,
) {
  const next = { ...(current ?? {}) }
  delete next[inputName]
  return JSON.stringify(next, null, 2)
}

export function ReferenceInputsEditor({
  title,
  description,
  inputs,
  rawJson,
  onChange,
  validation,
  emptyLabel,
  placeholder,
}: {
  title: string
  description: string
  inputs: ReportSourceInput[]
  rawJson: string
  onChange: (value: string) => void
  validation: InputJsonValidation
  emptyLabel: string
  placeholder: string
}) {
  const [showJsonEditor, setShowJsonEditor] = useState(false)
  const [showPayloadPreview, setShowPayloadPreview] = useState(false)
  const template = useMemo(() => buildReferenceInputTemplate(inputs), [inputs])
  const currentObject = validation.parsed ?? {}
  const missingRequired = useMemo(
    () => new Set(validation.missingRequired ?? []),
    [validation.missingRequired],
  )
  const normalizedPayload = useMemo(
    () => normalizeReferenceInputPayload(validation.parsed, inputs),
    [inputs, validation.parsed],
  )

  const renderField = (input: ReportSourceInput) => {
    const type = String(input.type ?? '').toLowerCase()
    const currentValue = currentObject[input.name]

    if (type === 'boolean' || type === 'bool') {
      return (
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--theme-card-text)' }}>
          <input
            type="checkbox"
            checked={Boolean(currentValue)}
            onChange={(event) => onChange(updateJsonInputFieldValue(currentObject, input, event.target.checked))}
            className="rounded"
          />
          <span>{input.label || input.name}</span>
        </label>
      )
    }

    if (type === 'array' || type === 'object' || type === 'json') {
      return (
        <textarea
          value={currentValue === undefined ? '' : JSON.stringify(currentValue, null, 2)}
          onChange={(event) => {
            const nextRaw = event.target.value.trim()
            if (!nextRaw) {
              onChange(updateJsonInputFieldValue(currentObject, input, type === 'array' ? [] : {}))
              return
            }
            try {
              onChange(updateJsonInputFieldValue(currentObject, input, JSON.parse(nextRaw)))
            } catch {
              onChange(rawJson)
            }
          }}
          className="min-h-[70px] w-full rounded border px-2 py-1.5 text-[11px] font-mono"
          style={{ borderColor: 'var(--theme-surface-border)' }}
          placeholder={type === 'array' ? '[]' : '{}'}
        />
      )
    }

    if (type === 'date' || type === 'datetime' || type === 'timestamp') {
      return (
        <Input
          type={type === 'date' ? 'date' : 'datetime-local'}
          value={currentValue ?? ''}
          onChange={(event) => onChange(updateJsonInputFieldValue(currentObject, input, event.target.value))}
          className="!h-8 !text-xs"
          placeholder={input.placeholder || ''}
        />
      )
    }

    return (
      <ReferenceStaticValueInput
        input={{
          ...input,
          default_value: input.defaultValue,
        }}
        value={
          currentValue === undefined || currentValue === null
            ? ''
            : typeof currentValue === 'string'
              ? currentValue
              : String(currentValue)
        }
        onChange={(nextValue) => {
          if (['number', 'integer', 'float', 'decimal'].includes(type)) {
            onChange(
              updateJsonInputFieldValue(
                currentObject,
                input,
                nextValue === '' ? '' : Number(nextValue),
              ),
            )
            return
          }
          onChange(updateJsonInputFieldValue(currentObject, input, nextValue))
        }}
        inputClassName="!h-8 !text-xs"
        selectClassName="w-full rounded border px-2 py-1.5 text-xs"
      />
    )
  }

  return (
    <div className="space-y-2">
      <div
        className="rounded-md border px-2 py-2 text-[10px]"
        style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}
      >
        <div className="font-medium" style={{ color: 'var(--theme-card-text)' }}>
          {title}
        </div>
        <div className="mt-1" style={{ color: 'var(--theme-muted-text)' }}>
          {description}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {inputs.map((input) => (
            <span
              key={input.name}
              className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium"
              style={{
                backgroundColor: 'var(--theme-card-bg)',
                color: 'var(--theme-muted-text)',
                border: '1px solid var(--theme-surface-border)',
              }}
            >
              {input.name}
              {input.required ? ' *' : ''}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onChange(template)}
          className="mt-2 text-[10px] font-medium text-[color:var(--theme-card-text)] hover:underline"
        >
          Fill starter payload
        </button>
      </div>

      {validation.error ? (
        <div
          className="rounded-md border px-2 py-2 text-[10px]"
          style={{ borderColor: 'var(--status-error)', backgroundColor: 'var(--status-error-bg)', color: 'var(--status-error)' }}
        >
          Fix the JSON below to use the form editor again.
        </div>
      ) : (
        <div className="grid gap-2">
          {inputs.map((input) => {
            const fieldLabel = input.label || input.name
            const isMissing = missingRequired.has(fieldLabel)

            return (
              <div
                key={input.name}
                className="space-y-1 rounded-md border px-2 py-2"
                style={{
                  borderColor: isMissing ? 'var(--status-error)' : 'var(--theme-surface-border)',
                  backgroundColor: isMissing ? 'var(--status-error-bg)' : 'transparent',
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <label
                    className="text-[10px] font-medium"
                    style={{ color: isMissing ? 'var(--status-error)' : 'var(--theme-card-text)' }}
                  >
                    {fieldLabel}
                    {input.required ? ' *' : ''}
                  </label>
                  {input.type ? (
                    <span className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
                      {input.type}
                    </span>
                  ) : null}
                </div>
                {renderField(input)}
                <div className="flex items-center gap-3 text-[10px]">
                  <button
                    type="button"
                    onClick={() => onChange(removeJsonInputFieldValue(currentObject, input.name))}
                    className="font-medium text-[color:var(--theme-card-text)] hover:underline"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(updateJsonInputFieldValue(currentObject, input, getSuggestedReferenceInputValue(input)))}
                    className="font-medium text-[color:var(--theme-card-text)] hover:underline"
                  >
                    Reset to default
                  </button>
                </div>
                {input.description ? (
                  <div className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                    {input.description}
                  </div>
                ) : null}
                {isMissing ? (
                  <div className="text-[10px]" style={{ color: 'var(--status-error)' }}>
                    Required input
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-between">
        <label className="text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>
          Raw JSON
        </label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowPayloadPreview((current) => !current)}
            className="text-[10px] font-medium text-[color:var(--theme-card-text)] hover:underline"
          >
            {showPayloadPreview ? 'Hide payload preview' : 'Show payload preview'}
          </button>
          <button
            type="button"
            onClick={() => setShowJsonEditor((current) => !current)}
            className="text-[10px] font-medium text-[color:var(--theme-card-text)] hover:underline"
          >
            {showJsonEditor ? 'Hide JSON' : 'Show JSON'}
          </button>
        </div>
      </div>
      {showPayloadPreview ? (
        <div
          className="rounded-md border px-2 py-2"
          style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}
        >
          <div className="mb-1 text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>
            Normalized payload
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] font-mono" style={{ color: 'var(--theme-card-text)' }}>
            {JSON.stringify(normalizedPayload ?? {}, null, 2)}
          </pre>
        </div>
      ) : null}
      {showJsonEditor ? (
        <textarea
          value={rawJson}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-[88px] w-full rounded border px-2 py-1.5 text-[11px] font-mono"
          style={{ borderColor: 'var(--theme-surface-border)' }}
          placeholder={placeholder}
        />
      ) : null}

      <InputValidationHint validation={validation} emptyLabel={emptyLabel} />
    </div>
  )
}
