'use client'

/**
 * The editor's variables panel: the template's own variables (declare label,
 * type, sample, required), the built-in ones grouped (Task, Workflow, Form,
 * Person, Links, Workspace) and a sample form's fields. Click inserts
 * `{{name}}` at the cursor of the last focused field (HTML, Design text,
 * subject, plain text); drag drops it where it lands.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, GripVertical, Plus, Search, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { BUILTIN_EMAIL_VARIABLES, EMAIL_VARIABLE_GROUPS, EMAIL_VARIABLE_TYPES, humanizeVariableName, type EmailTemplateVariable, type EmailVariableDeclaration, type EmailVariableType } from '@/lib/email-editor/variables'
import { cn } from '@/lib/utils'

export interface EmailVariablesPanelProps {
  /** Variables the template uses / declares (templateVariables()). */
  variables: EmailTemplateVariable[]
  declarations: EmailVariableDeclaration[]
  onDeclarationsChange(next: EmailVariableDeclaration[]): void
  onInsert(token: string): void
  /** Fields of the chosen sample form. */
  formFields?: Array<{ key: string; label: string }>
  formName?: string | null
  className?: string
}

function VariableChip({ name, label, description, onInsert, tone }: { name: string; label: string; description?: string; onInsert(token: string): void; tone?: 'warning' }) {
  const token = `{{${name}}}`
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', token); e.dataTransfer.effectAllowed = 'copy' }}
      onClick={() => onInsert(token)}
      title={description ? `${description}\nClick to insert, or drag into the editor` : 'Click to insert, or drag into the editor'}
      className={cn(
        'group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
        tone === 'warning' && 'bg-warning-wash',
      )}
      data-variable={name}
    >
      <GripVertical size={12} className="shrink-0 text-fg-subtle opacity-0 group-hover:opacity-100" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-fg">{label}</span>
        <code className="block truncate text-2xs text-fg-muted">{token}</code>
      </span>
    </button>
  )
}

export function EmailVariablesPanel({ variables, declarations, onDeclarationsChange, onInsert, formFields, formName, className }: EmailVariablesPanelProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({ 'This template': true, Task: true, Links: true })
  const [editing, setEditing] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const q = query.trim().toLowerCase()
  const match = (name: string, label: string) => !q || name.toLowerCase().includes(q) || label.toLowerCase().includes(q)

  const custom = useMemo(() => variables.filter((v) => v.source === 'custom'), [variables])
  const declaredNames = new Set(declarations.map((d) => d.name.toLowerCase()))
  const undeclared = custom.filter((v) => v.used && !declaredNames.has(v.name.toLowerCase()))

  const updateDeclaration = (name: string, patch: Partial<EmailVariableDeclaration>) => {
    const exists = declarations.some((d) => d.name === name)
    const next = exists ? declarations.map((d) => (d.name === name ? { ...d, ...patch } : d)) : [...declarations, { name, ...patch }]
    onDeclarationsChange(next)
  }
  const removeDeclaration = (name: string) => onDeclarationsChange(declarations.filter((d) => d.name !== name))
  const addVariable = () => {
    const name = newName.trim().replace(/\s+/g, '_').replace(/[^\w.]/g, '')
    if (!/^[A-Za-z_][\w.]*$/.test(name) || declaredNames.has(name.toLowerCase())) return
    onDeclarationsChange([...declarations, { name, label: humanizeVariableName(name) }])
    setNewName('')
    setEditing(name)
  }

  const section = (key: string, title: string, count: number, body: React.ReactNode) => (
    <div key={key} className="border-b border-border-subtle py-1.5 last:border-b-0">
      <button type="button" className="flex w-full items-center gap-1 px-1 py-1 text-left text-2xs font-semibold uppercase tracking-wide text-fg-muted hover:text-fg" aria-expanded={!!open[key] || !!q} onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}>
        {open[key] || q ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="flex-1">{title}</span>
        <span className="num font-normal">{count}</span>
      </button>
      {(open[key] || q) && <div className="mt-0.5 space-y-0.5">{body}</div>}
    </div>
  )

  // Custom: used + declared (unused declarations too).
  const customRows = [...custom, ...declarations.filter((d) => !custom.some((v) => v.name.toLowerCase() === d.name.toLowerCase())).map((d) => ({ ...d, label: d.label ?? humanizeVariableName(d.name), type: d.type ?? 'text', source: 'custom' as const, used: false }))]
    .filter((v) => match(v.name, v.label))

  return (
    <div className={cn('flex min-h-0 flex-col', className)} data-email-variables-panel="">
      <div className="border-b border-border-subtle p-2">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search variables" aria-label="Search variables" className="h-8 pl-7 text-xs" />
        </div>
        <p className="mt-1.5 text-2xs text-fg-muted">Click to insert at the cursor, or drag into the editor. Type <code>{'{{'}</code> in the HTML for suggestions.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5">
        {section('This template', 'This template', customRows.length, (
          <>
            {undeclared.length > 0 && !q && (
              <div className="mx-1 mb-1 flex items-start gap-1.5 rounded-md bg-warning-wash p-1.5 text-2xs text-fg" data-unknown-variables="">
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                <span>{undeclared.length === 1 ? '1 variable is' : `${undeclared.length} variables are`} not built in — workflows map {undeclared.length === 1 ? 'it' : 'them'} to a value. Add a label, sample and description to help them (open the row).</span>
              </div>
            )}
            {customRows.length === 0 && <p className="px-2 py-1 text-2xs text-fg-muted">Variables you use that are not built in (e.g. <code>{'{{customer_name}}'}</code>) appear here. Workflows map them to form fields or other values.</p>}
            {customRows.map((v) => {
              const decl = declarations.find((d) => d.name.toLowerCase() === v.name.toLowerCase())
              const isOpen = editing === v.name
              return (
                <div key={v.name} className="rounded-md">
                  <div className="flex items-center gap-0.5">
                    <div className="min-w-0 flex-1"><VariableChip name={v.name} label={v.label} description={v.description} onInsert={onInsert} tone={v.used && !decl ? 'warning' : undefined} /></div>
                    {!v.used && <Badge tone="neutral">unused</Badge>}
                    {v.required && <Badge tone="brand">required</Badge>}
                    <IconButton size="sm" label={isOpen ? 'Close details' : 'Edit details'} icon={isOpen ? <ChevronDown /> : <ChevronRight />} onClick={() => setEditing(isOpen ? null : v.name)} />
                  </div>
                  {isOpen && (
                    <div className="mx-1 mb-2 space-y-1.5 rounded-md bg-subtle p-2" data-variable-details={v.name}>
                      <Input aria-label="Label" placeholder="Label" value={decl?.label ?? v.label} onChange={(e) => updateDeclaration(v.name, { label: e.target.value })} className="h-7 text-xs" />
                      <div className="flex gap-1.5">
                        <Select aria-label="Type" value={decl?.type ?? v.type} onChange={(e) => updateDeclaration(v.name, { type: e.target.value as EmailVariableType })} className="h-7 flex-1 text-xs">
                          {EMAIL_VARIABLE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                        </Select>
                        <Checkbox label="Required" checked={!!decl?.required} onChange={(e) => updateDeclaration(v.name, { required: e.target.checked || undefined })} />
                      </div>
                      <Input aria-label="Sample value" placeholder="Sample value (preview)" value={decl?.sample ?? ''} onChange={(e) => updateDeclaration(v.name, { sample: e.target.value || undefined })} className="h-7 text-xs" />
                      <Input aria-label="Description" placeholder="Description for workflow authors" value={decl?.description ?? ''} onChange={(e) => updateDeclaration(v.name, { description: e.target.value || undefined })} className="h-7 text-xs" />
                      {decl && <Button type="button" size="sm" variant="ghost" leadingIcon={<Trash2 />} onClick={() => { removeDeclaration(v.name); setEditing(null) }}>Remove details</Button>}
                    </div>
                  )}
                </div>
              )
            })}
            <form className="mx-1 mt-1 flex gap-1" onSubmit={(e) => { e.preventDefault(); addVariable() }}>
              <Input aria-label="New variable name" placeholder="new_variable" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-7 flex-1 font-mono text-xs" />
              <IconButton type="submit" size="sm" label="Declare variable" icon={<Plus />} disabled={!newName.trim()} />
            </form>
          </>
        ))}
        {formFields && formFields.length > 0 && section('Form', `Sample form${formName ? ` · ${formName}` : ''}`, formFields.length, (
          formFields.filter((f) => match(`form.${f.key}`, f.label)).map((f) => <VariableChip key={f.key} name={`form.${f.key}`} label={f.label} description="A field of the form that started the run (Form submitted trigger)" onInsert={onInsert} />)
        ))}
        {EMAIL_VARIABLE_GROUPS.map((group) => {
          const rows = BUILTIN_EMAIL_VARIABLES.filter((v) => v.group === group && match(v.name, v.label))
          if (!rows.length) return null
          return section(group, group, rows.length, rows.map((v) => <VariableChip key={v.name} name={v.name} label={v.label} description={`${v.description} — filled automatically`} onInsert={onInsert} />))
        })}
      </div>
    </div>
  )
}
