'use client'

import { useState } from 'react'
import { Plus, Trash2, Variable, ChevronDown, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { CountBadge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
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
        aria-expanded={expanded}
        className="mb-2 flex w-full items-center gap-1.5 rounded-sm text-left text-fg-muted hover:text-fg"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Variable size={14} aria-hidden="true" />
        <span className="flex-1 text-xs font-medium">Workflow variables</span>
        <CountBadge count={variables.length} />
      </button>

      {expanded && (
        <div className="space-y-2">
          <p className="text-xs text-fg-muted">
            Define variables that can be passed into this workflow via webhooks or triggers. Use as{' '}
            <code className="font-mono text-2xs text-fg">{'{{name}}'}</code> in any field.
            They are also the inputs of the <span className="font-medium text-fg">Run</span> dialog and API/CLI starts.
          </p>

          {variables.map((v) => (
            <Card
              key={v.id}
              variant="inset"
              padding="sm"
              className="space-y-1.5"
            >
              <div className="flex items-center gap-1.5">
                <Input
                  value={v.name}
                  onChange={(e) => updateVariable(v.id, 'name', e.target.value)}
                  placeholder="variable_name"
                  size="sm"
                  aria-label="Variable name"
                  className="flex-1 font-mono"
                />
                <Select
                  value={v.type === 'array' && v.format === 'attachments' ? 'attachments' : v.type}
                  onChange={(e) => {
                    // Files: a list of uploads (its limits are set in the start form designer).
                    if (e.target.value === 'attachments') onChange(variables.map((x) => (x.id === v.id ? { ...x, type: 'array', format: 'attachments', defaultValue: '' } : x)))
                    else onChange(variables.map((x) => (x.id === v.id ? { ...x, type: e.target.value as UserVariable['type'], ...(x.format === 'attachments' ? { format: undefined, attachments: undefined } : {}) } : x)))
                  }}
                  size="sm"
                  aria-label="Variable type"
                  wrapperClassName="w-auto shrink-0"
                >
                  <option value="string">String</option>
                  <option value="number">Number</option>
                  <option value="boolean">Boolean</option>
                  <option value="object">Object</option>
                  <option value="attachments">Files</option>
                </Select>
                <IconButton
                  size="sm"
                  variant="danger-ghost"
                  label="Remove variable"
                  icon={<Trash2 />}
                  onClick={() => removeVariable(v.id)}
                />
              </div>
              <Input
                value={v.defaultValue}
                onChange={(e) => updateVariable(v.id, 'defaultValue', e.target.value)}
                placeholder="Default value"
                size="sm"
              />
              <Input
                value={v.description}
                onChange={(e) => updateVariable(v.id, 'description', e.target.value)}
                placeholder="Description (optional)"
                size="sm"
              />
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={Boolean(v.required)}
                  onChange={(e) => updateVariable(v.id, 'required', e.target.checked)}
                  label="Required input"
                  className="shrink-0 text-xs"
                />
                {v.type === 'string' && (
                  <Select
                    value={v.format ?? 'text'}
                    onChange={(e) => updateVariable(v.id, 'format', e.target.value)}
                    aria-label="Input format"
                    size="sm"
                    wrapperClassName="flex-1 min-w-0"
                  >
                    <option value="text">Text</option>
                    <option value="date">Date</option>
                    <option value="datetime">Date &amp; time</option>
                    <option value="email">Email</option>
                    <option value="url">URL</option>
                    <option value="select">Choice list</option>
                  </Select>
                )}
              </div>
              {v.type === 'string' && v.format === 'select' && (
                <Input
                  value={v.options ?? ''}
                  onChange={(e) => updateVariable(v.id, 'options', e.target.value)}
                  placeholder="Choices, comma separated"
                  size="sm"
                />
              )}
            </Card>
          ))}

          <Button
            size="sm"
            variant="secondary"
            onClick={addVariable}
            className="w-full"
            leadingIcon={<Plus />}
          >
            Add variable
          </Button>
        </div>
      )}
    </div>
  )
}
