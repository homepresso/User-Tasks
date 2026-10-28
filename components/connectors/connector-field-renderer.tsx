"use client"

import { Input } from "@/components/ui/input"
import { Eye, EyeOff } from "lucide-react"
import { useState } from "react"
import type { ConnectorField } from "@/lib/connectors/registry"
import { getConnectorFieldValidationError, getVisibleConnectorFields, isConnectorFieldRequired } from "@/lib/connectors/form-state"

interface FieldRendererProps {
  fields: ConnectorField[]
  values: Record<string, any>
  onChange: (key: string, value: any) => void
}

export function ConnectorFieldRenderer({ fields, values, onChange }: FieldRendererProps) {
  const visibleFields = getVisibleConnectorFields(fields, values)

  return (
    <div className="space-y-3">
      {visibleFields.map(field => (
        <FieldInput
          key={field.key}
          field={field}
          values={values}
          required={isConnectorFieldRequired(field, values)}
          value={values[field.key] ?? field.defaultValue ?? ''}
          onChange={v => onChange(field.key, v)}
        />
      ))}
    </div>
  )
}

function FieldInput({ field, values, required, value, onChange }: { field: ConnectorField; values: Record<string, any>; required: boolean; value: any; onChange: (v: any) => void }) {
  const [showPassword, setShowPassword] = useState(false)
  const error = getConnectorFieldValidationError(field, values)
  const hasError = Boolean(error)

  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>
        {field.label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>

      {field.type === 'select' ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: hasError ? 'var(--theme-danger)' : 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
        >
          <option value="">Select...</option>
          {field.options?.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={5}
          spellCheck={false}
          className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: hasError ? 'var(--theme-danger)' : 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
        />
      ) : field.type === 'password' ? (
        <div className="relative">
          <Input
            type={showPassword ? 'text' : 'password'}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={field.placeholder}
            className="!pr-9 font-mono !text-sm"
            style={hasError ? { borderColor: 'var(--theme-danger)' } : undefined}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 hover:opacity-70"
            style={{ color: 'var(--theme-muted-text)' }}
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      ) : (
        <Input
          type={field.type === 'number' ? 'number' : 'text'}
          value={value}
          onChange={e => {
            if (field.type === 'number') {
              onChange(e.target.value === '' ? '' : Number(e.target.value))
              return
            }
            onChange(e.target.value)
          }}
          placeholder={field.placeholder}
          className="!text-sm"
          style={hasError ? { borderColor: 'var(--theme-danger)' } : undefined}
        />
      )}

      {field.helpText && (
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          {field.helpText}
        </p>
      )}
      {field.setupHint && (
        <p className="text-[10px]" style={{ color: 'var(--theme-card-text)' }}>
          {field.setupHint}
        </p>
      )}
      {field.exampleText && (
        <p className="text-[10px] font-mono" style={{ color: 'var(--theme-muted-text)' }}>
          Example: {field.exampleText}
        </p>
      )}
      {error && (
        <p className="text-[10px]" style={{ color: 'var(--theme-danger)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
