'use client'

import type { ChangeEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, Plus, Trash2, Save, FlaskConical, X, Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { updateDecisionTable } from '@/app/actions/business-rules'
import { evaluateDecisionTable } from '@/lib/decision-table-engine'

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'date', label: 'Date' },
] as const

const OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Does not contain' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with', label: 'Ends with' },
  { value: 'greater_than', label: 'Greater than' },
  { value: 'greater_than_or_equal', label: 'Greater than or equal' },
  { value: 'less_than', label: 'Less than' },
  { value: 'less_than_or_equal', label: 'Less than or equal' },
  { value: 'is_empty', label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' },
] as const

const NUMERIC_OPERATORS = new Set([
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
])

const TEXT_OPERATORS = new Set([
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
])

function createField() {
  return { id: crypto.randomUUID(), key: '', label: '', type: 'text' }
}

function createRule() {
  return {
    id: crypto.randomUUID(),
    label: '',
    enabled: true,
    conditions: [{ id: crypto.randomUUID(), inputKey: '', operator: 'equals', value: '' }],
    outputs: {},
  }
}

function normalizeFields(fields: any[] | undefined) {
  if (!Array.isArray(fields) || fields.length === 0) return [createField()]
  return fields.map((field) => ({
    id: field.id || crypto.randomUUID(),
    key: field.key ?? '',
    label: field.label ?? '',
    type: field.type ?? 'text',
  }))
}

function normalizeRules(rules: any[] | undefined) {
  if (!Array.isArray(rules)) return []
  return rules.map((rule) => ({
    id: rule.id || crypto.randomUUID(),
    label: rule.label ?? '',
    enabled: rule.enabled !== false,
    conditions: Array.isArray(rule.conditions) && rule.conditions.length > 0
      ? rule.conditions.map((condition: any) => ({
          id: condition.id || crypto.randomUUID(),
          inputKey: condition.inputKey ?? '',
          operator: condition.operator ?? 'equals',
          value: condition.value ?? '',
        }))
      : [{ id: crypto.randomUUID(), inputKey: '', operator: 'equals', value: '' }],
    outputs: rule.outputs ?? {},
  }))
}

export function DecisionTableEditor({ table }: { table: any }) {
  const router = useRouter()
  const importRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(table.name ?? '')
  const [description, setDescription] = useState(table.description ?? '')
  const [inputs, setInputs] = useState<any[]>(normalizeFields(table.inputs))
  const [outputs, setOutputs] = useState<any[]>(normalizeFields(table.outputs))
  const [rules, setRules] = useState<any[]>(normalizeRules(table.rules))
  const [saving, setSaving] = useState(false)
  const [testerOpen, setTesterOpen] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [pendingImport, setPendingImport] = useState<{ name: string; description: string; inputs: any[]; outputs: any[]; rules: any[] } | null>(null)

  const availableInputKeys = useMemo(
    () => inputs
      .map((field) => ({ key: field.key, label: field.label || field.key, type: field.type }))
      .filter((field) => field.key),
    [inputs],
  )

  async function handleSave() {
    setSaving(true)
    try {
      await updateDecisionTable(table.id, { name, description, inputs, outputs, rules })
      router.refresh()
    } catch (err: any) {
      setNotice({ tone: 'error', message: err.message ?? 'Failed to save business rule' })
    }
    setSaving(false)
  }

  function handleExport() {
    const exportData = {
      version: 1,
      type: 'decision_table',
      exportedAt: new Date().toISOString(),
      decisionTable: {
        name,
        description,
        inputs,
        outputs,
        rules,
      },
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `decision-table-${(name || table.name || 'rule').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string)
        const imported = parsed.decisionTable ?? parsed.decision_table ?? parsed
        if (!Array.isArray(imported.inputs) || !Array.isArray(imported.outputs) || !Array.isArray(imported.rules)) {
          setNotice({ tone: 'error', message: 'Invalid decision table file. Expected inputs, outputs, and rules arrays.' })
          return
        }
        setPendingImport({
          name: imported.name ?? file.name.replace(/\.json$/, ''),
          description: imported.description ?? '',
          inputs: normalizeFields(imported.inputs),
          outputs: normalizeFields(imported.outputs),
          rules: normalizeRules(imported.rules),
        })
      } catch {
        setNotice({ tone: 'error', message: 'Failed to parse decision table file. Ensure it is valid JSON.' })
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="space-y-4">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <ConfirmDialog
        open={Boolean(pendingImport)}
        onOpenChange={(open) => { if (!open) setPendingImport(null) }}
        title="Import Decision Table"
        description={`Import decision table "${pendingImport?.name ?? 'this file'}"? This will replace the current design.`}
        confirmLabel="Import"
        busy={false}
        onConfirm={async () => {
          if (!pendingImport) return
          setName(pendingImport.name)
          setDescription(pendingImport.description)
          setInputs(pendingImport.inputs)
          setOutputs(pendingImport.outputs)
          setRules(pendingImport.rules)
          setPendingImport(null)
        }}
      />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link href="/automations/rules" className="inline-flex items-center gap-1 text-xs hover:underline" style={{ color: 'var(--theme-primary-text)' }}>
            <ArrowLeft size={12} /> Back to business rules
          </Link>
          <h1 className="text-2xl font-semibold mt-2" style={{ color: 'var(--theme-card-text)' }}>Business Rule Designer</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            Model decision logic with custom inputs, outputs, and ordered rule rows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download size={14} className="mr-1" /> Export
          </Button>
          <Button variant="outline" onClick={() => importRef.current?.click()}>
            <Upload size={14} className="mr-1" /> Import
          </Button>
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <Button variant="outline" onClick={() => setTesterOpen(true)}>
            <FlaskConical size={14} className="mr-1" /> Test Rules
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save size={14} className="mr-1" /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1.8fr] gap-4">
        <div className="space-y-4">
          <Panel title="Details" description="Name and describe the business rule so workflow designers understand what it does.">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border px-3 py-2 text-sm resize-none"
                  style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                />
              </div>
            </div>
          </Panel>

          <FieldBuilder
            title="Inputs"
            description="Inputs are values the workflow sends into this decision table."
            fields={inputs}
            onChange={setInputs}
          />

          <FieldBuilder
            title="Outputs"
            description="Outputs are values returned when a rule matches."
            fields={outputs}
            onChange={setOutputs}
          />
        </div>

        <Panel title="Rules" description="Rules run top to bottom. The first enabled rule whose conditions all match wins.">
          <div className="space-y-4">
            {rules.length === 0 && (
              <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm" style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}>
                No rules yet. Add a rule to start mapping conditions to outputs.
              </div>
            )}

            {rules.map((rule, index) => (
              <div key={rule.id} className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full text-[10px] font-bold"
                        style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                        {index + 1}
                      </span>
                      <Input
                        value={rule.label ?? ''}
                        onChange={(e) => {
                          const next = [...rules]
                          next[index] = { ...rule, label: e.target.value }
                          setRules(next)
                        }}
                        placeholder={`Rule ${index + 1}`}
                        className="!h-8"
                      />
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                      <input
                        type="checkbox"
                        checked={rule.enabled !== false}
                        onChange={(e) => {
                          const next = [...rules]
                          next[index] = { ...rule, enabled: e.target.checked }
                          setRules(next)
                        }}
                      />
                      Rule enabled
                    </label>
                  </div>
                  <button
                    onClick={() => setRules(rules.filter((candidate) => candidate.id !== rule.id))}
                    className="p-1.5 rounded hover:bg-red-50"
                    title="Delete rule"
                  >
                    <Trash2 size={13} className="text-red-400" />
                  </button>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>Conditions</p>
                    <button
                      onClick={() => {
                        const next = [...rules]
                        next[index] = {
                          ...rule,
                          conditions: [...(rule.conditions ?? []), { id: crypto.randomUUID(), inputKey: '', operator: 'equals', value: '' }],
                        }
                        setRules(next)
                      }}
                      className="text-[11px] hover:underline"
                      style={{ color: 'var(--theme-primary-text)' }}
                    >
                      + Add condition
                    </button>
                  </div>
                  <div className="space-y-2">
                    {(rule.conditions ?? []).map((condition: any, conditionIndex: number) => {
                      const selectedField = availableInputKeys.find((field) => field.key === condition.inputKey)
                      const compatibilityMessage = getConditionCompatibilityMessage(selectedField?.type, condition.operator)

                      return (
                        <div key={condition.id} className="space-y-1.5">
                          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-2">
                            <select
                              value={condition.inputKey ?? ''}
                              onChange={(e) => updateRuleCondition(setRules, rules, index, conditionIndex, { inputKey: e.target.value })}
                              className="rounded-lg border px-3 py-2 text-xs"
                              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                            >
                              <option value="">Select input…</option>
                              {availableInputKeys.map((field) => (
                                <option key={field.key} value={field.key}>{field.label}</option>
                              ))}
                            </select>
                            <select
                              value={condition.operator ?? 'equals'}
                              onChange={(e) => updateRuleCondition(setRules, rules, index, conditionIndex, { operator: e.target.value })}
                              className="rounded-lg border px-3 py-2 text-xs"
                              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                            >
                              {OPERATORS.map((operator) => (
                                <option key={operator.value} value={operator.value}>{operator.label}</option>
                              ))}
                            </select>
                            <Input
                              value={condition.value ?? ''}
                              onChange={(e) => updateRuleCondition(setRules, rules, index, conditionIndex, { value: e.target.value })}
                              placeholder="Comparison value"
                              disabled={['is_empty', 'is_not_empty'].includes(condition.operator)}
                            />
                            <button
                              onClick={() => {
                                const next = [...rules]
                                next[index] = {
                                  ...rule,
                                  conditions: (rule.conditions ?? []).filter((_: any, current: number) => current !== conditionIndex),
                                }
                                setRules(next)
                              }}
                              className="px-2 rounded hover:bg-red-50"
                              title="Delete condition"
                            >
                              <Trash2 size={13} className="text-red-400" />
                            </button>
                          </div>

                          {selectedField && (
                            <div className="flex items-center gap-2 text-[11px]">
                              <span
                                className="inline-flex items-center rounded-full px-2 py-0.5 font-medium"
                                style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-muted-text)', border: '1px solid var(--theme-surface-border)' }}
                              >
                                {selectedField.type} input
                              </span>
                              {compatibilityMessage ? (
                                <span
                                  className="rounded-full px-2 py-0.5 font-medium"
                                  style={{ backgroundColor: 'color-mix(in srgb, #F59E0B 14%, transparent)', color: '#B45309' }}
                                >
                                  {compatibilityMessage}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--theme-muted-text)' }}>
                                  This operator matches the selected input type.
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--theme-card-text)' }}>Outputs</p>
                  <div className="space-y-2">
                    {outputs.length === 0 && (
                      <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                        Define at least one output field on the left to map values here.
                      </p>
                    )}
                    {outputs.map((field) => (
                      <div key={field.id} className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-2 items-center">
                        <label className="text-xs font-medium" style={{ color: 'var(--theme-muted-text)' }}>
                          {field.label || field.key || 'Output'}
                        </label>
                        <Input
                          value={rule.outputs?.[field.key] ?? ''}
                          onChange={(e) => {
                            const next = [...rules]
                            next[index] = {
                              ...rule,
                              outputs: { ...(rule.outputs ?? {}), [field.key]: e.target.value },
                            }
                            setRules(next)
                          }}
                          placeholder={`Value for ${field.key || 'output'}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            <Button
              variant="outline"
              onClick={() => setRules([...rules, createRule()])}
              className="w-full"
            >
              <Plus size={14} className="mr-1" /> Add Rule
            </Button>
          </div>
        </Panel>
      </div>

      <DecisionTableTesterDialog
        open={testerOpen}
        onOpenChange={setTesterOpen}
        inputs={inputs}
        outputs={outputs}
        rules={rules}
        ruleName={name || table.name || 'Business Rule'}
      />
    </div>
  )
}

function FieldBuilder({
  title,
  description,
  fields,
  onChange,
}: {
  title: string
  description: string
  fields: any[]
  onChange: (fields: any[]) => void
}) {
  return (
    <Panel title={title} description={description}>
      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={field.id} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_auto] gap-2">
            <Input
              value={field.key}
              onChange={(e) => {
                const next = [...fields]
                next[index] = { ...field, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }
                onChange(next)
              }}
              placeholder="key_name"
            />
            <Input
              value={field.label}
              onChange={(e) => {
                const next = [...fields]
                next[index] = { ...field, label: e.target.value }
                onChange(next)
              }}
              placeholder="Label"
            />
            <select
              value={field.type}
              onChange={(e) => {
                const next = [...fields]
                next[index] = { ...field, type: e.target.value }
                onChange(next)
              }}
              className="rounded-lg border px-3 py-2 text-xs"
              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
            >
              {FIELD_TYPES.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
            <button
              onClick={() => onChange(fields.length > 1 ? fields.filter((candidate) => candidate.id !== field.id) : [createField()])}
              className="px-2 rounded hover:bg-red-50"
              title={`Delete ${title.toLowerCase().slice(0, -1)}`}
            >
              <Trash2 size={13} className="text-red-400" />
            </button>
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={() => onChange([...fields, createField()])} className="mt-3">
        <Plus size={13} className="mr-1" /> Add {title.slice(0, -1)}
      </Button>
    </Panel>
  )
}

function Panel({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
      <div className="mb-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>{title}</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>{description}</p>
      </div>
      {children}
    </section>
  )
}

function updateRuleCondition(
  setRules: (rules: any[]) => void,
  rules: any[],
  ruleIndex: number,
  conditionIndex: number,
  updates: Record<string, any>,
) {
  const next = [...rules]
  const rule = next[ruleIndex]
  const conditions = [...(rule.conditions ?? [])]
  conditions[conditionIndex] = { ...conditions[conditionIndex], ...updates }
  next[ruleIndex] = { ...rule, conditions }
  setRules(next)
}

function getConditionCompatibilityMessage(type: string | undefined, operator: string | undefined) {
  if (!type || !operator) return null

  if (NUMERIC_OPERATORS.has(operator) && type === 'text') {
    return 'This is a text input. Switch it to number if you want strict numeric comparison.'
  }

  if (NUMERIC_OPERATORS.has(operator) && type === 'boolean') {
    return 'Boolean inputs do not compare well with greater/less than operators.'
  }

  if (TEXT_OPERATORS.has(operator) && type === 'number') {
    return 'This is a number input. Text operators may be confusing here.'
  }

  if (TEXT_OPERATORS.has(operator) && type === 'date') {
    return 'This is a date input. Use before/after style comparisons via less/greater than instead.'
  }

  if (TEXT_OPERATORS.has(operator) && type === 'boolean') {
    return 'Boolean inputs usually work better with equals or not equals.'
  }

  if (NUMERIC_OPERATORS.has(operator) && type === 'date') {
    return 'Date comparisons are supported, but make sure both values are real dates.'
  }

  return null
}

function DecisionTableTesterDialog({
  open,
  onOpenChange,
  inputs,
  outputs,
  rules,
  ruleName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  inputs: any[]
  outputs: any[]
  rules: any[]
  ruleName: string
}) {
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) setValues({})
  }, [open])

  const result = useMemo(() => {
    return evaluateDecisionTable(inputs as any, rules as any, values)
  }, [inputs, rules, values])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 dialog-overlay" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(48rem,92vw)] rounded-2xl shadow-xl dialog-content"
          style={{ backgroundColor: 'var(--theme-card-bg)' }}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <div>
              <Dialog.Title className="text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>
                Test Rules
              </Dialog.Title>
              <Dialog.Description className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                Quickly test {ruleName} with sample inputs and inspect the matching outputs.
              </Dialog.Description>
            </div>
            <Dialog.Close className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
              <X size={18} />
            </Dialog.Close>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-4 p-6 max-h-[75vh] overflow-y-auto">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Test Inputs</h3>
              {inputs.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
                  Add input fields to this rule before using the tester.
                </p>
              ) : (
                inputs.map((field) => (
                  <div key={field.id}>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--theme-muted-text)' }}>
                      {field.label || field.key || 'Input'} {field.key ? `(${field.key})` : ''}
                    </label>
                    {field.type === 'boolean' ? (
                      <select
                        value={values[field.key] ?? ''}
                        onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                      >
                        <option value="">Select…</option>
                        <option value="true">True</option>
                        <option value="false">False</option>
                      </select>
                    ) : (
                      <Input
                        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                        value={values[field.key] ?? ''}
                        onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))}
                        placeholder={field.key || 'Enter a value'}
                      />
                    )}
                  </div>
                ))
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Result</h3>
              <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>Matched Rule</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--theme-card-text)' }}>
                    {result.matched ? (result.rule?.label || 'Matched unnamed rule') : 'No matching rule'}
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>Outputs</p>
                  {outputs.length === 0 ? (
                    <p className="text-sm mt-1" style={{ color: 'var(--theme-muted-text)' }}>No outputs defined yet.</p>
                  ) : (
                    <div className="space-y-2 mt-2">
                      {outputs.map((field) => (
                        <div key={field.id} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                          <p className="text-[11px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>
                            {field.label || field.key || 'Output'}
                          </p>
                          <p className="text-sm mt-1" style={{ color: 'var(--theme-card-text)' }}>
                            {result.outputs?.[field.key] != null && result.outputs?.[field.key] !== ''
                              ? String(result.outputs[field.key])
                              : '—'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
