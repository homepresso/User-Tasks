'use client'

import { useState } from 'react'
import { Plus, Trash2, Variable, ChevronDown, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { UserVariable } from './workflow-builder'

interface UserVariablesEditorProps {
  variables: UserVariable[]
  onChange: (variables: UserVariable[]) => void
}

export function UserVariablesEditor({ variables, onChange }: UserVariablesEditorProps) {
  const [expanded, setExpanded] = useState(true)

  function addVariable() {
    onChange([
      ...variables,
      {
        id: crypto.randomUUID(),
        name: '',
        type: 'string',
        defaultValue: '',
        description: '',
      },
    ])
  }

  function updateVariable(id: string, field: keyof UserVariable, value: string | boolean) {
    onChange(
      variables.map((v) => {
        if (v.id !== id) return v
        if (field === 'name' && typeof value === 'string') {
          // Sanitize variable name: allow letters, numbers, underscores
          value = value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+/, '')
        }
        return { ...v, [field]: value }
      })
    )
  }

  function removeVariable(id: string) {
    onChange(variables.filter((v) => v.id !== id))
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-left mb-2"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Variable size={14} style={{ color: 'var(--theme-primary-text)' }} />
        <span className="text-xs font-semibold flex-1">Workflow Variables</span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
        >
          {variables.length}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2">
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--theme-muted-text)' }}>
            Define variables that can be passed into this workflow via webhooks or triggers. Use as{' '}
            <code className="font-mono" style={{ color: 'var(--theme-primary-text)' }}>{'{{name}}'}</code> in any field.
            They are also the inputs of the <strong>Run</strong> dialog and API/CLI starts.
          </p>

          {variables.map((v) => (
            <div
              key={v.id}
              className="rounded-lg border p-2.5 space-y-1.5"
              style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}
            >
              <div className="flex items-center gap-1.5">
                <Input
                  value={v.name}
                  onChange={(e) => updateVariable(v.id, 'name', e.target.value)}
                  placeholder="variable_name"
                  className="!text-xs !h-7 font-mono flex-1"
                />
                <select
                  value={v.type}
                  onChange={(e) => updateVariable(v.id, 'type', e.target.value)}
                  className="text-[10px] h-7 rounded-md border px-1.5"
                  style={{
                    borderColor: 'var(--theme-surface-border)',
                    backgroundColor: 'var(--theme-card-bg)',
                    color: 'var(--theme-card-text)',
                  }}
                >
                  <option value="string">String</option>
                  <option value="number">Number</option>
                  <option value="boolean">Boolean</option>
                  <option value="object">Object</option>
                </select>
                <button
                  onClick={() => removeVariable(v.id)}
                  className="p-1 rounded hover:text-red-500 shrink-0"
                  style={{ color: 'var(--theme-muted-text)' }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <Input
                value={v.defaultValue}
                onChange={(e) => updateVariable(v.id, 'defaultValue', e.target.value)}
                placeholder="Default value"
                className="!text-xs !h-7"
              />
              <Input
                value={v.description}
                onChange={(e) => updateVariable(v.id, 'description', e.target.value)}
                placeholder="Description (optional)"
                className="!text-xs !h-7"
              />
              <div className="flex items-center gap-1.5">
                <label className="flex items-center gap-1 text-[10px] shrink-0" style={{ color: 'var(--theme-muted-text)' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(v.required)}
                    onChange={(e) => updateVariable(v.id, 'required', e.target.checked)}
                  />
                  Required input
                </label>
                {v.type === 'string' && (
                  <select
                    value={v.format ?? 'text'}
                    onChange={(e) => updateVariable(v.id, 'format', e.target.value)}
                    aria-label="Input format"
                    className="text-[10px] h-7 rounded-md border px-1.5 flex-1 min-w-0"
                    style={{
                      borderColor: 'var(--theme-surface-border)',
                      backgroundColor: 'var(--theme-card-bg)',
                      color: 'var(--theme-card-text)',
                    }}
                  >
                    <option value="text">Text</option>
                    <option value="date">Date</option>
                    <option value="datetime">Date &amp; time</option>
                    <option value="email">Email</option>
                    <option value="url">URL</option>
                    <option value="select">Choice list</option>
                  </select>
                )}
              </div>
              {v.type === 'string' && v.format === 'select' && (
                <Input
                  value={v.options ?? ''}
                  onChange={(e) => updateVariable(v.id, 'options', e.target.value)}
                  placeholder="Choices, comma separated"
                  className="!text-xs !h-7"
                />
              )}
            </div>
          ))}

          <Button
            size="sm"
            variant="outline"
            onClick={addVariable}
            className="w-full !text-xs !h-7"
          >
            <Plus size={12} className="mr-1" /> Add Variable
          </Button>
        </div>
      )}
    </div>
  )
}
