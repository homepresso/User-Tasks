'use client'

import type { ChangeEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Save, FlaskConical, Download, Upload, MoreHorizontal, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge, Tag } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { thClass, tdClass, trClass } from '@/components/ui/table'
import { Dialog, DialogBody, DialogContent } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
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
      <PageHeader
        className="mb-2"
        breadcrumbs={[{ label: 'Business rules', href: '/automations/rules' }, { label: name || table.name || 'Business rule' }]}
        title={name || table.name || 'Business rule'}
        description="Model decision logic with custom inputs, outputs, and ordered rule rows."
        actions={
          <>
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            <Button variant="secondary" leadingIcon={<FlaskConical />} onClick={() => setTesterOpen(true)}>
              Test rules
            </Button>
            <Button leadingIcon={<Save />} onClick={handleSave} disabled={saving} loading={saving}>
              Save
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton variant="secondary" label="More actions" icon={<MoreHorizontal />} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem icon={<Download />} onSelect={handleExport}>Export</DropdownMenuItem>
                <DropdownMenuItem icon={<Upload />} onSelect={() => importRef.current?.click()}>Import…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <ConfirmDialog
        open={Boolean(pendingImport)}
        onOpenChange={(open) => { if (!open) setPendingImport(null) }}
        title="Import decision table"
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1.8fr]">
        <div className="space-y-4">
          <Panel title="Details" description="Name and describe the business rule so workflow designers understand what it does.">
            <CardBody className="space-y-4 pt-0">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Description">
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  className="resize-none"
                />
              </Field>
            </CardBody>
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
          <CardBody className="space-y-3 pt-0">
            {rules.length === 0 && (
              <EmptyState
                size="sm"
                icon={GitBranch}
                title="No rules yet"
                description="Add a rule to start mapping conditions to outputs."
                className="rounded-lg border border-dashed border-border"
              />
            )}

            {rules.map((rule, index) => (
              <Card key={rule.id} variant="inset" padding="md" className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="num inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-wash text-2xs font-semibold text-primary-text">
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
                        aria-label={`Rule ${index + 1} name`}
                      />
                    </div>
                    <Checkbox
                      label="Rule enabled"
                      checked={rule.enabled !== false}
                      onChange={(e) => {
                        const next = [...rules]
                        next[index] = { ...rule, enabled: e.target.checked }
                        setRules(next)
                      }}
                    />
                  </div>
                  <IconButton
                    size="sm"
                    variant="danger-ghost"
                    label="Delete rule"
                    icon={<Trash2 />}
                    onClick={() => setRules(rules.filter((candidate) => candidate.id !== rule.id))}
                  />
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-fg-muted">Conditions</p>
                    <Button
                      variant="link"
                      size="sm"
                      leadingIcon={<Plus />}
                      onClick={() => {
                        const next = [...rules]
                        next[index] = {
                          ...rule,
                          conditions: [...(rule.conditions ?? []), { id: crypto.randomUUID(), inputKey: '', operator: 'equals', value: '' }],
                        }
                        setRules(next)
                      }}
                    >
                      Add condition
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {(rule.conditions ?? []).map((condition: any, conditionIndex: number) => {
                      const selectedField = availableInputKeys.find((field) => field.key === condition.inputKey)
                      const compatibilityMessage = getConditionCompatibilityMessage(selectedField?.type, condition.operator)

                      return (
                        <div key={condition.id} className="space-y-1.5">
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
                            <Select
                              value={condition.inputKey ?? ''}
                              onChange={(e) => updateRuleCondition(setRules, rules, index, conditionIndex, { inputKey: e.target.value })}
                              aria-label="Input"
                            >
                              <option value="">Select input…</option>
                              {availableInputKeys.map((field) => (
                                <option key={field.key} value={field.key}>{field.label}</option>
                              ))}
                            </Select>
                            <Select
                              value={condition.operator ?? 'equals'}
                              onChange={(e) => updateRuleCondition(setRules, rules, index, conditionIndex, { operator: e.target.value })}
                              aria-label="Operator"
                            >
                              {OPERATORS.map((operator) => (
                                <option key={operator.value} value={operator.value}>{operator.label}</option>
                              ))}
                            </Select>
                            <Input
                              value={condition.value ?? ''}
                              onChange={(e) => updateRuleCondition(setRules, rules, index, conditionIndex, { value: e.target.value })}
                              placeholder="Comparison value"
                              aria-label="Comparison value"
                              disabled={['is_empty', 'is_not_empty'].includes(condition.operator)}
                            />
                            <IconButton
                              size="sm"
                              variant="danger-ghost"
                              label="Delete condition"
                              icon={<Trash2 />}
                              className="self-center"
                              onClick={() => {
                                const next = [...rules]
                                next[index] = {
                                  ...rule,
                                  conditions: (rule.conditions ?? []).filter((_: any, current: number) => current !== conditionIndex),
                                }
                                setRules(next)
                              }}
                            />
                          </div>

                          {selectedField && (
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <Tag mono>{selectedField.type} input</Tag>
                              {compatibilityMessage ? (
                                <Badge tone="warning" className="h-auto py-0.5 [&>span]:whitespace-normal">
                                  {compatibilityMessage}
                                </Badge>
                              ) : (
                                <span className="text-fg-muted">
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
                  <p className="mb-2 text-xs font-medium text-fg-muted">Outputs</p>
                  <div className="space-y-2">
                    {outputs.length === 0 && (
                      <p className="text-xs text-fg-muted">
                        Define at least one output field on the left to map values here.
                      </p>
                    )}
                    {outputs.map((field) => (
                      <div key={field.id} className="grid grid-cols-1 items-center gap-2 md:grid-cols-[160px_1fr]">
                        <label className="truncate text-ui text-fg">
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
                          aria-label={field.label || field.key || 'Output'}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            ))}

            <Button
              variant="secondary"
              leadingIcon={<Plus />}
              onClick={() => setRules([...rules, createRule()])}
              className="w-full"
            >
              Add rule
            </Button>
          </CardBody>
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
  const noun = title.toLowerCase().slice(0, -1)
  return (
    <Panel title={title} description={description}>
      <div className="overflow-x-auto border-y border-border-subtle">
        <table className="w-full border-collapse text-left text-ui text-fg">
          <thead>
            <tr>
              <th scope="col" className={thClass}>Key</th>
              <th scope="col" className={thClass}>Label</th>
              <th scope="col" className={cn(thClass, 'w-[132px]')}>Type</th>
              <th scope="col" className={cn(thClass, 'w-px')}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => (
              <tr key={field.id} className={trClass}>
                <td className={cn(tdClass, 'py-1.5')}>
                  <Input
                    value={field.key}
                    onChange={(e) => {
                      const next = [...fields]
                      next[index] = { ...field, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }
                      onChange(next)
                    }}
                    placeholder="key_name"
                    aria-label={`${title.slice(0, -1)} key`}
                    className="font-mono"
                  />
                </td>
                <td className={cn(tdClass, 'py-1.5')}>
                  <Input
                    value={field.label}
                    onChange={(e) => {
                      const next = [...fields]
                      next[index] = { ...field, label: e.target.value }
                      onChange(next)
                    }}
                    placeholder="Label"
                    aria-label={`${title.slice(0, -1)} label`}
                  />
                </td>
                <td className={cn(tdClass, 'py-1.5')}>
                  <Select
                    value={field.type}
                    onChange={(e) => {
                      const next = [...fields]
                      next[index] = { ...field, type: e.target.value }
                      onChange(next)
                    }}
                    aria-label={`${title.slice(0, -1)} type`}
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </Select>
                </td>
                <td className={cn(tdClass, 'w-px py-1.5 pl-0')}>
                  <IconButton
                    size="sm"
                    variant="danger-ghost"
                    label={`Delete ${noun}`}
                    icon={<Trash2 />}
                    onClick={() => onChange(fields.length > 1 ? fields.filter((candidate) => candidate.id !== field.id) : [createField()])}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="p-4">
        <Button variant="secondary" size="sm" leadingIcon={<Plus />} onClick={() => onChange([...fields, createField()])}>
          Add {noun}
        </Button>
      </div>
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
    <Card padding="none">
      <CardHeader title={title} description={description} />
      {children}
    </Card>
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        title="Test rules"
        description={`Quickly test ${ruleName} with sample inputs and inspect the matching outputs.`}
      >
        <DialogBody className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-fg">Test inputs</h3>
            {inputs.length === 0 ? (
              <p className="text-sm text-fg-muted">
                Add input fields to this rule before using the tester.
              </p>
            ) : (
              inputs.map((field) => (
                <Field key={field.id} label={<>{field.label || field.key || 'Input'} {field.key ? <span className="font-mono text-2xs font-normal text-fg-muted">({field.key})</span> : ''}</>}>
                  {field.type === 'boolean' ? (
                    <Select
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))}
                    >
                      <option value="">Select…</option>
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </Select>
                  ) : (
                    <Input
                      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                      value={values[field.key] ?? ''}
                      onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))}
                      placeholder={field.key || 'Enter a value'}
                    />
                  )}
                </Field>
              ))
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-fg">Result</h3>
            <Card variant="inset" padding="md" className="space-y-4">
              <div>
                <p className="text-xs font-medium text-fg-muted">Matched rule</p>
                <p className="mt-1 text-sm text-fg">
                  {result.matched ? (result.rule?.label || 'Matched unnamed rule') : 'No matching rule'}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-fg-muted">Outputs</p>
                {outputs.length === 0 ? (
                  <p className="mt-1 text-sm text-fg-muted">No outputs defined yet.</p>
                ) : (
                  <dl className="mt-1 divide-y divide-border-subtle">
                    {outputs.map((field) => (
                      <div key={field.id} className="py-2">
                        <dt className="text-xs text-fg-muted">
                          {field.label || field.key || 'Output'}
                        </dt>
                        <dd className="mt-0.5 text-sm text-fg">
                          {result.outputs?.[field.key] != null && result.outputs?.[field.key] !== ''
                            ? String(result.outputs[field.key])
                            : '—'}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </Card>
          </section>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
