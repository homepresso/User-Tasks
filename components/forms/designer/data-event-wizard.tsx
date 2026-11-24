'use client'

/* eslint-disable @typescript-eslint/no-explicit-any -- server action results are JSON */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown, ArrowUp, Check, CircleAlert, Database, DatabaseZap, ExternalLink, Globe, GripVertical, Plus, Repeat, Sparkles, Flag, TriangleAlert, Trash2, Workflow, Wand2, X,
} from 'lucide-react'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { InlineNotice } from '@/components/ui/inline-notice'
import { AutocompleteSelect, type AutocompleteOption } from '@/components/ui/autocomplete-select'
import { useJobs } from '@/components/jobs/jobs-provider'
import { getDataEventOptions, createDataEventWorkflow } from '@/app/actions/form-data-event'
import { definitionFrom, type DesignerState } from '@/lib/forms/designer-state'
import {
  SYSTEM_COLUMNS, autoMap, autoOrder, compileDirectRule, dataEventSources, fieldColumnFit, formDataEvents, hasErrors, idFeeds, moveStep,
  newStepId, parentPath, planProblems, proposeTable, proposedStep, proposedTarget, sourceChain, suggestParentLink,
  type DataEventColumn, type DataEventDestination, type DataEventField, type DataEventPlan, type DataEventProblem, type DataEventSource,
  type DataEventStep, type DataEventTarget, type DataEventValue, type ProposedTable,
} from '@/lib/forms/data-event'
import { buildDataEventWorkflow, type OutlineLine } from '@/lib/forms/data-event-workflow'
import { validateWorkflow } from '@/lib/workflow-validation'
import { validateWorkflowWiring } from '@/lib/workflow-wiring'
import { TASK_FIELD_TYPE_LABELS, type TaskFieldType } from '@/lib/task-field-schema'
import { cn } from '@/lib/utils'
import { designerInputClass as inputClass } from './designer-controls'

/**
 * "Map to data event" (lib/forms/data-event.ts): offered on the Rules tab
 * while the form has no data event. The wizard asks where the form's data
 * goes — written directly by a rule, or sent to a workflow — then:
 *
 *   1. Destination   2. Targets (tables / API references, once for the form
 *   or for each item of a repeating section / List; new tables from the form
 *   structure for a workflow)   3. Map fields (auto-mapped by name, types
 *   and required columns shown)   4. Order (parent before child, which id
 *   feeds which)   5. Review (the rule, or the workflow outline) → Create.
 *
 * Write directly adds one Before submit rule (and the variables that carry
 * parent ids) to the designer's form — saving the form keeps it. Send to a
 * workflow creates a draft workflow (and any new tables) on the server from
 * the form as last saved (lib/services/form-data-event.ts).
 *
 * Options the person cannot use are hidden (forms.edit, data.view /
 * data.manage_rows / data.create, integrations.view / integrations.test,
 * workflows.create).
 */

type Options = Awaited<ReturnType<typeof getDataEventOptions>> extends { ok: true; data: infer D } | { ok: false } ? D : never

const STEPS = [
  { id: 'destination', label: 'Destination' },
  { id: 'targets', label: 'Targets' },
  { id: 'map', label: 'Map fields' },
  { id: 'order', label: 'Order' },
  { id: 'review', label: 'Review' },
] as const

const muted = 'text-fg-muted'

export function useDataEventOptions(formId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['form-data-event-options', formId ?? null],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const result = await getDataEventOptions(formId ?? null)
      if (!result.ok) throw new Error(result.error)
      return result.data
    },
  })
}

/** The Rules tab's offer: shown only while the form has no data event and the person can use one of the options. */
export function DataEventCallout({ state, formId, formName, onChange }: { state: DesignerState; formId?: string; formName?: string; onChange: (next: DesignerState, tag?: string) => void }) {
  const { data: options } = useDataEventOptions(formId)
  const [open, setOpen] = useState(false)
  const events = useMemo(() => formDataEvents(definitionFrom(state), { boundWorkflows: options?.bound_workflows }), [state, options?.bound_workflows])
  // While the wizard is open it stays mounted (creating the data event hides the offer, not the result).
  if (!options) return null
  const offered = !events.length && (options.destinations.direct || options.destinations.workflow)
  if (!offered && !open) return null
  return (
    <>
      {offered && <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-subtle px-3 py-2" data-testid="data-event-callout">
        <DatabaseZap className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-fg">This form doesn&apos;t save its data anywhere yet</p>
          <p className={cn('text-2xs', muted)}>Map it to a data event: write the answers to data tables or API references, or send them to a workflow.</p>
        </div>
        <Button size="sm" variant="secondary" leadingIcon={<Wand2 />} onClick={() => setOpen(true)} data-testid="data-event-open">Map to data event</Button>
      </div>}
      {open && <DataEventWizard open onClose={() => setOpen(false)} state={state} formId={formId} formName={formName || 'Form'} options={options} onApply={onChange} />}
    </>
  )
}

function fieldTypeLabel(type: string): string {
  return TASK_FIELD_TYPE_LABELS[type as TaskFieldType] ?? type.replace(/_/g, ' ')
}

/** Fields a step may read: its own source's, and the form's. */
function allowedFields(sources: DataEventSource[], source: string): Array<DataEventField & { from: string }> {
  const form = sources.find((s) => s.key === '')
  const own = source ? sources.find((s) => s.key === source) : undefined
  return [...(own?.fields ?? []).map((f) => ({ ...f, from: own!.label })), ...(form?.fields ?? []).map((f) => ({ ...f, from: 'The form' }))]
}

function encode(v: DataEventValue | undefined): string {
  if (!v) return ''
  return v.kind === 'field' ? `f:${v.key}` : v.kind === 'parent' ? `p:${v.step}` : 't:'
}

export function DataEventWizard({ open, onClose, state, formId, formName = 'Form', options, onApply }: {
  open: boolean
  onClose: () => void
  state: DesignerState
  formId?: string
  formName?: string
  options: Options
  onApply: (next: DesignerState, tag?: string) => void
}) {
  const jobs = useJobs()
  const queryClient = useQueryClient()
  const def = useMemo(() => definitionFrom(state), [state])
  const sources = useMemo(() => dataEventSources(def.fields, 'The form'), [def.fields])
  const [stepIndex, setStepIndex] = useState(0)
  const [destination, setDestination] = useState<DataEventDestination | null>(options.destinations.direct ? 'direct' : options.destinations.workflow && formId ? 'workflow' : null)
  const [steps, setSteps] = useState<DataEventStep[]>([])
  const [newTables, setNewTables] = useState<ProposedTable[]>([])
  const [openAccess, setOpenAccess] = useState(false)
  const [workflowName, setWorkflowName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ id: string; name: string; tables: Array<{ id: string; name: string }> } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const p = options.permissions
  const targets: DataEventTarget[] = useMemo(() => {
    const tables = destination === 'direct' ? (p.write_tables ? options.tables : []) : options.tables
    const refs = destination === 'direct' ? (p.call_references ? options.references : []) : options.references
    return [...tables, ...refs, ...newTables.map(proposedTarget)]
  }, [destination, options, p, newTables])
  const plan: DataEventPlan = useMemo(() => ({ destination: destination ?? 'direct', steps, ...(openAccess && destination === 'direct' ? { open_access: true } : {}), ...(workflowName.trim() ? { workflow_name: workflowName.trim() } : {}) }), [destination, steps, openAccess, workflowName])
  const problems = useMemo(() => (destination ? planProblems(plan, sources, targets) : []), [plan, sources, targets, destination])
  const errors = problems.filter((x) => x.severity === 'error')

  const targetOf = (s: DataEventStep) => targets.find((t) => t.kind === s.target.kind && t.id === s.target.id)
  const sourceLabel = (key: string) => (key ? sources.find((s) => s.key === key)?.label ?? key : 'the form')
  const childSources = sources.filter((s) => s.depth > 0 && (destination === 'workflow' || s.depth === 1))

  /** A new step for a target: auto-mapped, linked to the parent step of its source. */
  function addStep(target: DataEventTarget, source: string) {
    setSteps((current) => {
      const id = newStepId(current)
      const fields = allowedFields(sources, source)
      let step: DataEventStep = { id, target: { kind: target.kind, id: target.id, name: target.name, ...(target.integration_id ? { integration_id: target.integration_id } : {}), ...(target.new_table ? { new_table: true } : {}) }, source, map: {} }
      // The parent link first (a lookup / parent id column), then the fields by name.
      const chain = sourceChain(sources, source).map((s) => s.key).filter((k) => k !== source)
      const parent = [...current].reverse().find((s) => chain.includes(s.source))
      if (parent && source) step = { ...step, map: suggestParentLink(step, parent, [...targets, target]) }
      return [...current, { ...step, map: autoMap(fields, target.columns, step.map) }]
    })
  }

  function addNewTable(sourceKey: string) {
    const source = sources.find((s) => s.key === sourceKey)
    if (!source) return
    const table = proposeTable(source, formName)
    setNewTables((t) => [...t.filter((x) => x.source !== sourceKey), table])
    setSteps((current) => {
      const chain = sourceChain(sources, sourceKey).map((s) => s.key).filter((k) => k !== sourceKey)
      const parent = [...current].reverse().find((s) => chain.includes(s.source))
      return [...current, proposedStep(table, source, newStepId(current), parent)]
    })
  }

  function updateStep(id: string, patch: Partial<DataEventStep>) {
    setSteps((current) => current.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  function removeStep(id: string) {
    setSteps((current) => current.filter((s) => s.id !== id).map((s) => ({ ...s, map: Object.fromEntries(Object.entries(s.map).filter(([, v]) => !(v.kind === 'parent' && v.step === id))) })))
    const step = steps.find((s) => s.id === id)
    if (step?.target.new_table) setNewTables((t) => t.filter((x) => `new:${x.source || 'form'}` !== step.target.id))
  }

  function changeSource(step: DataEventStep, source: string) {
    const target = targetOf(step)
    const allowed = new Set(allowedFields(sources, source).map((f) => f.key))
    const kept = Object.fromEntries(Object.entries(step.map).filter(([, v]) => v.kind !== 'field' || allowed.has(v.key)))
    updateStep(step.id, { source, map: target ? autoMap(allowedFields(sources, source), target.columns, kept) : kept })
  }

  const canNext = (() => {
    if (stepIndex === 0) return Boolean(destination)
    if (stepIndex === 1) return steps.length > 0
    if (stepIndex === 3) return !problems.some((x) => x.severity === 'error' && /must run after|does not hold/.test(x.message))
    return true
  })()

  async function create() {
    if (!destination || hasErrors(problems)) return
    setError(null)
    if (destination === 'direct') {
      const existingRules = (state.layout.rules ?? []).map((r) => r.id)
      const existingVars = (state.layout.variables ?? []).map((v) => v.name)
      const { rule, variables } = compileDirectRule(plan, sources, { ruleIds: existingRules, variables: existingVars, formName })
      onApply({ ...state, layout: { ...state.layout, rules: [...(state.layout.rules ?? []), rule], variables: [...(state.layout.variables ?? []), ...variables] } }, 'data-event')
      jobs.notify({ tone: 'success', title: `Added the rule "${rule.name}"`, body: 'Save the form to keep it.' })
      onClose()
      return
    }
    if (!formId) return
    setBusy(true)
    try {
      const result = await createDataEventWorkflow({ form_id: formId, plan, new_tables: newTables })
      if (!result.ok) { setError(result.error); return }
      setCreated({ id: result.data.workflow.id, name: result.data.workflow.name, tables: result.data.tables })
      await queryClient.invalidateQueries({ queryKey: ['form-data-event-options', formId] })
      jobs.notify({ tone: 'success', title: `Created the draft workflow "${result.data.workflow.name}"` })
    } finally {
      setBusy(false)
    }
  }

  const title = created ? 'Workflow created' : 'Map to data event'
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent size="xl" title={title} hideHeader className="max-h-[calc(100dvh-48px)]" data-testid="data-event-wizard">
        <DialogHeader title={title} description={created ? undefined : 'Choose where this form\'s data goes when it is submitted.'} />
        {!created && <Stepper index={stepIndex} onPick={(i) => { if (i <= stepIndex || (i === stepIndex + 1 && canNext)) setStepIndex(i) }} reachable={(i) => i <= stepIndex || (i === stepIndex + 1 && canNext)} />}
        <DialogBody className="space-y-4">
          {created ? (
            <CreatedView created={created} />
          ) : stepIndex === 0 ? (
            <DestinationStep value={destination} onChange={(d) => { setDestination(d); setSteps([]); setNewTables([]) }} options={options} formId={formId} />
          ) : stepIndex === 1 ? (
            <TargetsStep
              destination={destination!} steps={steps} targets={targets} sources={sources} childSources={childSources} options={options}
              newTables={newTables} onAdd={addStep} onAddNew={addNewTable} onRemove={removeStep} onSource={changeSource} sourceLabel={sourceLabel}
              onIdPath={(id, path) => updateStep(id, { id_path: path || undefined })}
            />
          ) : stepIndex === 2 ? (
            <MapStep steps={steps} targets={targets} sources={sources} problems={problems} onMap={(id, map) => updateStep(id, { map })} sourceLabel={sourceLabel} />
          ) : stepIndex === 3 ? (
            <OrderStep steps={steps} problems={problems} dragging={dragging} setDragging={setDragging}
              onReorder={setSteps} onAuto={() => setSteps(autoOrder(steps, sources))} sourceLabel={sourceLabel} />
          ) : (
            <ReviewStep destination={destination!} plan={plan} sources={sources} targets={targets} problems={problems} def={def} formId={formId} formName={formName}
              openAccess={openAccess} setOpenAccess={setOpenAccess} workflowName={workflowName} setWorkflowName={setWorkflowName}
              onEdit={(id) => { setStepIndex(2); requestAnimationFrame(() => document.querySelector(`[data-map-step="${id}"]`)?.scrollIntoView({ block: 'start' })) }}
              onRemove={removeStep} options={options} />
          )}
          {error && <InlineNotice tone="danger" message={error} />}
        </DialogBody>
        <DialogFooter>
          {created ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              {stepIndex === 4 && errors.length > 0 && <span className="mr-auto text-xs text-danger" role="status">{errors.length} problem{errors.length === 1 ? '' : 's'} to fix first</span>}
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              {stepIndex > 0 && <Button variant="secondary" onClick={() => setStepIndex(stepIndex - 1)}>Back</Button>}
              {stepIndex < 4
                ? <Button onClick={() => setStepIndex(stepIndex + 1)} disabled={!canNext} data-testid="data-event-next">Next</Button>
                : <Button onClick={() => void create()} disabled={hasErrors(problems) || busy} loading={busy} leadingIcon={<Sparkles />} data-testid="data-event-create">
                    {destination === 'workflow' ? 'Create draft workflow' : 'Add the rule'}
                  </Button>}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stepper({ index, onPick, reachable }: { index: number; onPick: (i: number) => void; reachable: (i: number) => boolean }) {
  return (
    <nav aria-label="Wizard steps" className="px-6 pt-3 max-sm:px-4">
      <ol className="flex gap-1">
        {STEPS.map((s, i) => (
          <li key={s.id} className="min-w-0 flex-1">
            <button type="button" onClick={() => onPick(i)} disabled={!reachable(i)} aria-current={i === index ? 'step' : undefined}
              className={cn('flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-60',
                i === index ? 'bg-primary-wash font-medium text-primary-text' : muted)}>
              <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border text-2xs', i < index ? 'border-success bg-success text-[color:var(--theme-on-success)]' : i === index ? 'border-primary' : 'border-border')}>
                {i < index ? <Check className="size-3" aria-hidden /> : i + 1}
              </span>
              <span className="truncate max-sm:hidden">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function ChoiceCard({ selected, disabled, onSelect, icon, title, children, testId }: { selected: boolean; disabled?: boolean; onSelect: () => void; icon: React.ReactNode; title: string; children: React.ReactNode; testId: string }) {
  return (
    <label className={cn('flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-[color:var(--ds-focus-ring,var(--theme-primary))]',
      selected ? 'border-primary bg-primary-wash' : 'border-border hover:bg-subtle', disabled && 'cursor-not-allowed opacity-60')} data-testid={testId}>
      <input type="radio" name="data-event-destination" className="sr-only" checked={selected} disabled={disabled} onChange={onSelect} />
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-md', selected ? 'bg-primary text-primary-fg' : 'bg-subtle text-fg-muted')} aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className={cn('mt-0.5 block text-xs', muted)}>{children}</span>
      </span>
      {selected && <Check className="size-4 shrink-0 text-primary-text" aria-hidden />}
    </label>
  )
}

function DestinationStep({ value, onChange, options, formId }: { value: DataEventDestination | null; onChange: (d: DataEventDestination) => void; options: Options; formId?: string }) {
  const { destinations, permissions } = options
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm text-fg">Where should the form&apos;s data go?</legend>
      {destinations.direct && (
        <ChoiceCard selected={value === 'direct'} onSelect={() => onChange('direct')} icon={<Database className="size-4" />} title="Write directly to a table or API reference" testId="data-event-direct">
          A rule writes the answers when the form is submitted — the parent record first, then a row for each item of a repeating section or List, linked by the parent&apos;s new id.
          {!permissions.write_tables && ' (API references only: writing tables needs the Manage rows permission.)'}
          {!permissions.call_references && permissions.write_tables && ' (Data tables only: calling API references needs the Test integrations permission.)'}
        </ChoiceCard>
      )}
      {destinations.workflow && (
        <ChoiceCard selected={value === 'workflow'} disabled={!formId} onSelect={() => onChange('workflow')} icon={<Workflow className="size-4" />} title="Send to a workflow" testId="data-event-workflow">
          A draft workflow starts when the form is submitted, with an insert step for each record and a loop for each repeating section or List — built from the form, reviewed here before it is created.
          {!formId && ' Save the form to the Forms library first.'}
        </ChoiceCard>
      )}
    </fieldset>
  )
}

function TargetsStep({ destination, steps, targets, sources, childSources, options, newTables, onAdd, onAddNew, onRemove, onSource, sourceLabel, onIdPath }: {
  destination: DataEventDestination
  steps: DataEventStep[]
  targets: DataEventTarget[]
  sources: DataEventSource[]
  childSources: DataEventSource[]
  options: Options
  newTables: ProposedTable[]
  onAdd: (target: DataEventTarget, source: string) => void
  onAddNew: (source: string) => void
  onRemove: (id: string) => void
  onSource: (step: DataEventStep, source: string) => void
  sourceLabel: (key: string) => string
  onIdPath: (id: string, path: string) => void
}) {
  const used = new Set(steps.map((s) => s.source))
  const nextSource = !used.has('') ? '' : childSources.find((s) => !used.has(s.key))?.key ?? ''
  const [source, setSource] = useState(nextSource)
  const existing = targets.filter((t) => !t.new_table)
  const pickOptions: AutocompleteOption[] = [
    ...existing.filter((t) => t.kind === 'table').map((t) => ({ value: `table:${t.id}`, label: t.name, hint: `Data table · ${t.columns.filter((c) => !SYSTEM_COLUMNS.has(c.key)).length} columns` })),
    ...existing.filter((t) => t.kind === 'reference').sort((a, b) => Number(Boolean(b.writes)) - Number(Boolean(a.writes))).map((t) => ({ value: `reference:${t.id}`, label: t.name, hint: `API reference${t.writes ? ' · Writes data' : ''} · ${t.columns.length} input${t.columns.length === 1 ? '' : 's'}` })),
  ]
  const sourceOptions: AutocompleteOption[] = [{ value: '', label: 'Once for the form' }, ...childSources.map((s) => ({ value: s.key, label: `For each item of ${s.label}`, hint: s.kind === 'list' ? 'List' : 'Repeating section' }))]
  const canCreate = destination === 'workflow' && options.permissions.create_tables
  const unmade = sources.filter((s) => (s.depth === 0 || childSources.includes(s)) && !newTables.some((t) => t.source === s.key))
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg">Pick the {options.permissions.view_tables ? 'data tables' : ''}{options.permissions.view_tables && options.permissions.view_references ? ' and ' : ''}{options.permissions.view_references ? 'API references' : ''} to write, and whether each runs once or for every item of a repeating section / List.</p>
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3" data-testid="data-event-add">
        <div className="min-w-[14rem] flex-1">
          <span id="de-target-label" className="mb-0.5 block text-2xs font-semibold text-fg-muted">Table or API reference</span>
          <AutocompleteSelect value="" labelledBy="de-target-label" placeholder={pickOptions.length ? 'Search tables and references…' : 'Nothing to pick'} options={pickOptions} disabled={!pickOptions.length}
            onChange={(v) => { const [kind, id] = v.split(':'); const t = existing.find((x) => x.kind === kind && x.id === id); if (t) onAdd(t, source) }} dataAttrs={{ 'data-testid': 'data-event-target-picker' }} />
        </div>
        <div className="min-w-[12rem]">
          <span id="de-source-label" className="mb-0.5 block text-2xs font-semibold text-fg-muted">Runs</span>
          <AutocompleteSelect value={source} labelledBy="de-source-label" options={sourceOptions} onChange={setSource} dataAttrs={{ 'data-testid': 'data-event-source-picker' }} />
        </div>
      </div>
      {canCreate && unmade.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-2xs font-semibold text-fg-muted">Or create a new table from the form structure</p>
          <div className="flex flex-wrap gap-1.5">
            {unmade.map((s) => (
              <Button key={s.key || 'form'} size="sm" variant="secondary" leadingIcon={<Plus />} onClick={() => onAddNew(s.key)} data-testid={`data-event-new-table-${s.key || 'form'}`}>
                {s.depth === 0 ? 'Table for the form' : `Table for ${s.label}`}
              </Button>
            ))}
          </div>
        </div>
      )}
      {steps.length === 0 ? (
        <p className={cn('rounded-md border border-dashed border-border p-4 text-center text-xs', muted)}>Nothing picked yet.</p>
      ) : (
        <ol className="space-y-2" aria-label="Targets">
          {steps.map((s, i) => {
            const target = targets.find((t) => t.kind === s.target.kind && t.id === s.target.id)
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2" data-target-step={s.id}>
                <span className="grid size-6 place-items-center rounded-full bg-subtle text-2xs font-semibold text-fg-muted" aria-hidden>{i + 1}</span>
                {s.target.kind === 'table' ? <Database className="size-4 text-fg-muted" aria-hidden /> : <Globe className="size-4 text-fg-muted" aria-hidden />}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{s.target.name}</span>
                {s.target.new_table && <Badge tone="info">New table</Badge>}
                {target?.writes && <Badge tone="warning">Writes data</Badge>}
                {s.target.new_table ? (
                  <span className={cn('text-xs', muted)}>{s.source ? `For each item of ${sourceLabel(s.source)}` : 'Once for the form'}</span>
                ) : (
                  <div className="w-56">
                    <AutocompleteSelect value={s.source} options={sourceOptions} onChange={(v) => onSource(s, v)} dataAttrs={{ 'aria-label': `When ${s.target.name} runs` } as any} />
                  </div>
                )}
                {s.target.kind === 'reference' && (
                  <label className="flex items-center gap-1 text-2xs text-fg-muted">
                    New record id at
                    <input className={cn(inputClass, 'w-24')} value={s.id_path ?? ''} placeholder="id" onChange={(e) => onIdPath(s.id, e.target.value.trim())} aria-label={`Response path of the id ${s.target.name} returns`} />
                  </label>
                )}
                <Button size="icon-sm" variant="ghost" onClick={() => onRemove(s.id)} aria-label={`Remove ${s.target.name}`}><Trash2 /></Button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function FitIcon({ level, note }: { level: 'ok' | 'warn' | 'bad'; note?: string }) {
  if (level === 'ok') return <Check className="size-3.5 text-success" aria-label="Types match" />
  return (
    <span className={cn('inline-flex items-center gap-1 text-2xs', level === 'bad' ? 'text-danger' : 'text-warning')}>
      {level === 'bad' ? <CircleAlert className="size-3.5" aria-hidden /> : <TriangleAlert className="size-3.5" aria-hidden />}
      {note}
    </span>
  )
}

function MapStep({ steps, targets, sources, problems, onMap, sourceLabel }: { steps: DataEventStep[]; targets: DataEventTarget[]; sources: DataEventSource[]; problems: DataEventProblem[]; onMap: (id: string, map: Record<string, DataEventValue>) => void; sourceLabel: (key: string) => string }) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-fg">Map form fields to columns{steps.some((s) => s.target.kind === 'reference') ? ' and inputs' : ''}. Matching names are mapped for you; check the types.</p>
      {steps.map((s, i) => {
        const target = targets.find((t) => t.kind === s.target.kind && t.id === s.target.id)
        const columns = (target?.columns ?? []).filter((c) => !SYSTEM_COLUMNS.has(c.key))
        const fields = allowedFields(sources, s.source)
        const earlier = steps.slice(0, i)
        const unmappedRequired = columns.filter((c) => c.required && !(c.key in s.map))
        const fieldOptions: AutocompleteOption[] = [
          ...fields.map((f) => ({ value: `f:${f.key}`, label: f.label, hint: `${f.from} · ${fieldTypeLabel(f.type)}` })),
          ...earlier.map((e) => ({ value: `p:${e.id}`, label: `New id of ${e.target.name}`, hint: `Step ${steps.indexOf(e) + 1}${e.source ? ` · each item of ${sourceLabel(e.source)}` : ''}` })),
          { value: 't:', label: 'A fixed value…', hint: 'Text or a placeholder' },
        ]
        return (
          <section key={s.id} className="space-y-2" aria-labelledby={`de-map-${s.id}`} data-map-step={s.id}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`de-map-${s.id}`} className="text-sm font-semibold text-fg">{i + 1}. {s.target.name}</h3>
              <span className={cn('text-xs', muted)}>{s.source ? `for each item of ${sourceLabel(s.source)}` : 'once for the form'}</span>
              {target && <Button size="sm" variant="ghost" className="ml-auto" leadingIcon={<Wand2 />} onClick={() => onMap(s.id, autoMap(fields, target.columns, s.map))}>Auto-map</Button>}
            </div>
            {unmappedRequired.length > 0 && <InlineNotice tone="warning" message={`Required ${s.target.kind === 'table' ? 'columns' : 'inputs'} without a value: ${unmappedRequired.map((c) => c.label).join(', ')}`} />}
            {!columns.length ? <p className={cn('text-xs', muted)}>{s.target.kind === 'reference' ? 'This reference declares no inputs.' : 'This table has no columns.'}</p> : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-subtle text-left text-2xs uppercase tracking-wide text-fg-muted">
                    <tr><th scope="col" className="px-2 py-1.5 font-semibold">{s.target.kind === 'table' ? 'Column' : 'Input'}</th><th scope="col" className="px-2 py-1.5 font-semibold">Value</th><th scope="col" className="px-2 py-1.5 font-semibold">Fit</th></tr>
                  </thead>
                  <tbody>
                    {columns.map((c) => <MapRow key={c.key} step={s} column={c} value={s.map[c.key]} fields={fields} steps={steps} targets={targets} options={fieldOptions} problems={problems}
                      onChange={(v) => { const next = { ...s.map }; if (v) next[c.key] = v; else delete next[c.key]; onMap(s.id, next) }} />)}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function MapRow({ step, column, value, fields, steps, targets, options, onChange }: {
  step: DataEventStep; column: DataEventColumn; value: DataEventValue | undefined; fields: DataEventField[]; steps: DataEventStep[]; targets: DataEventTarget[]; options: AutocompleteOption[]; problems: DataEventProblem[]
  onChange: (v: DataEventValue | null) => void
}) {
  const field = value?.kind === 'field' ? fields.find((f) => f.key === value.key) : undefined
  const fit = field ? fieldColumnFit(field.type, column.type) : null
  const labelId = `de-col-${step.id}-${column.key}`
  return (
    <tr className="border-t border-border-subtle align-top" data-map-column={column.key}>
      <td className="px-2 py-1.5">
        <span id={labelId} className="font-medium text-fg">{column.label}</span>{column.required && <span className="text-danger" aria-label="required"> *</span>}
        <span className={cn('block text-2xs', muted)}>{column.type}{column.type === 'lookup' ? ' (links a row)' : ''}</span>
      </td>
      <td className="px-2 py-1.5">
        <div className="flex min-w-[14rem] items-center gap-1">
          <div className="min-w-0 flex-1">
            <AutocompleteSelect value={encode(value)} labelledBy={labelId} placeholder="Not mapped" clearable options={options}
              onChange={(v) => {
                if (!v) return onChange(null)
                const [kind, rest] = [v.slice(0, 1), v.slice(2)]
                if (kind === 'f') return onChange({ kind: 'field', key: rest })
                if (kind === 'p') { const parent = steps.find((s) => s.id === rest); return onChange(parent ? { kind: 'parent', step: rest, path: parentPath(column, parent, targets) } : null) }
                return onChange({ kind: 'text', value: value?.kind === 'text' ? value.value : '' })
              }} />
          </div>
          {value?.kind === 'text' && <input className={cn(inputClass, 'w-36')} value={value.value} onChange={(e) => onChange({ kind: 'text', value: e.target.value })} aria-label={`Fixed value for ${column.label}`} placeholder="Value" />}
        </div>
      </td>
      <td className="px-2 py-1.5">
        {fit ? <FitIcon level={fit.level} note={fit.note} /> : value?.kind === 'parent' ? <span className="inline-flex items-center gap-1 text-2xs text-info"><Flag className="size-3.5" aria-hidden />id</span> : column.required ? <span className="text-2xs text-warning">Needed</span> : null}
      </td>
    </tr>
  )
}

function OrderStep({ steps, problems, dragging, setDragging, onReorder, onAuto, sourceLabel }: {
  steps: DataEventStep[]; problems: DataEventProblem[]; dragging: string | null; setDragging: (id: string | null) => void
  onReorder: (steps: DataEventStep[]) => void; onAuto: () => void; sourceLabel: (key: string) => string
}) {
  const feeds = idFeeds(steps)
  const orderProblems = problems.filter((x) => x.severity === 'error' && /must run after|does not hold/.test(x.message))
  const name = (id: string) => steps.find((s) => s.id === id)?.target.name ?? id
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-fg">Steps run top to bottom. Write a parent record before the records that use its id.</p>
        <Button size="sm" variant="secondary" leadingIcon={<Sparkles />} onClick={onAuto} data-testid="data-event-auto-order">Parents first</Button>
      </div>
      <ol className="space-y-1.5" aria-label="Order">
        {steps.map((s, i) => {
          const into = feeds.filter((f) => f.to === s.id)
          const out = feeds.filter((f) => f.from === s.id)
          return (
            <li key={s.id} draggable onDragStart={() => setDragging(s.id)} onDragEnd={() => setDragging(null)}
              onDragOver={(e) => { e.preventDefault() }}
              onDrop={(e) => { e.preventDefault(); if (!dragging || dragging === s.id) return; const from = steps.findIndex((x) => x.id === dragging); const next = [...steps]; const [moved] = next.splice(from, 1); next.splice(i, 0, moved); onReorder(next); setDragging(null) }}
              className={cn('flex items-start gap-2 rounded-md border px-2 py-2', dragging === s.id ? 'border-primary bg-primary-wash' : 'border-border', orderProblems.some((x) => x.step === s.id) && 'border-danger')} data-order-step={s.id}>
              <GripVertical className="mt-1 size-4 shrink-0 cursor-grab text-fg-muted" aria-hidden />
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-subtle text-2xs font-semibold text-fg-muted" aria-hidden>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{s.target.name} <span className={cn('font-normal', muted)}>· {s.source ? `each item of ${sourceLabel(s.source)}` : 'once'}</span></p>
                {into.map((f) => <p key={`${f.from}-${f.column}`} className="text-2xs text-info">← {f.column} = new id of {name(f.from)} ({f.path})</p>)}
                {out.length > 0 && <p className={cn('text-2xs', muted)}>Its new id feeds {[...new Set(out.map((f) => name(f.to)))].join(', ')}</p>}
              </div>
              <div className="flex shrink-0 gap-0.5">
                <Button size="icon-sm" variant="ghost" disabled={i === 0} onClick={() => onReorder(moveStep(steps, s.id, -1))} aria-label={`Move ${s.target.name} up`}><ArrowUp /></Button>
                <Button size="icon-sm" variant="ghost" disabled={i === steps.length - 1} onClick={() => onReorder(moveStep(steps, s.id, 1))} aria-label={`Move ${s.target.name} down`}><ArrowDown /></Button>
              </div>
            </li>
          )
        })}
      </ol>
      {orderProblems.length > 0 && (
        <div role="status" className="space-y-1">
          {orderProblems.map((x, i) => <InlineNotice key={i} tone="danger" message={x.message} />)}
        </div>
      )}
    </div>
  )
}

const OUTLINE_ICON: Record<OutlineLine['kind'], React.ReactNode> = {
  trigger: <Flag className="size-3.5" aria-hidden />, insert: <Database className="size-3.5" aria-hidden />, call: <Globe className="size-3.5" aria-hidden />,
  loop: <Repeat className="size-3.5" aria-hidden />, set: <Plus className="size-3.5" aria-hidden />, end: <Check className="size-3.5" aria-hidden />,
}

function ReviewStep({ destination, plan, sources, targets, problems, def, formId, formName, openAccess, setOpenAccess, workflowName, setWorkflowName, onEdit, onRemove }: {
  destination: DataEventDestination; plan: DataEventPlan; sources: DataEventSource[]; targets: DataEventTarget[]; problems: DataEventProblem[]
  def: ReturnType<typeof definitionFrom>; formId?: string; formName: string; options: Options
  openAccess: boolean; setOpenAccess: (v: boolean) => void; workflowName: string; setWorkflowName: (v: string) => void
  onEdit: (stepId: string) => void; onRemove: (stepId: string) => void
}) {
  const workflow = useMemo(() => (destination === 'workflow' ? buildDataEventWorkflow(plan, { id: formId ?? 'form', name: formName, fields: def.fields }, sources, targets) : null), [destination, plan, formId, formName, def.fields, sources, targets])
  const check = useMemo(() => {
    if (!workflow) return null
    const v = validateWorkflow(workflow.nodes as any, workflow.trigger_type)
    const w = validateWorkflowWiring({ nodes: workflow.nodes, edges: workflow.edges }).filter((x) => x.severity !== 'info')
    return { errors: v.totalErrors, warnings: w.length }
  }, [workflow])
  const rule = useMemo(() => (destination === 'direct' ? compileDirectRule(plan, sources) : null), [destination, plan, sources])
  return (
    <div className="space-y-4">
      {destination === 'direct' && rule && (
        <>
          <p className="text-sm text-fg">This rule is added to the form. It runs <strong>before the form is submitted</strong>, step by step:</p>
          <ol className="space-y-1.5 rounded-md border border-border p-3" aria-label="Rule steps">
            <li className="flex items-center gap-2 text-xs font-medium text-fg"><Flag className="size-3.5 text-fg-muted" aria-hidden />When: Before submit — {rule.rule.name}</li>
            {plan.steps.map((s, i) => {
              const out = rule.variables.filter((v) => v.name.startsWith(`${s.id}_`))
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-2 pl-4 text-xs text-fg" data-review-step={s.id}>
                  {s.target.kind === 'table' ? <Database className="size-3.5 text-fg-muted" aria-hidden /> : <Globe className="size-3.5 text-fg-muted" aria-hidden />}
                  <span>{i + 1}. {s.target.kind === 'table' ? 'Add a row to' : 'Call'} <strong>{s.target.name}</strong>{s.source ? <> for each item of {sources.find((x) => x.key === s.source)?.label}</> : null}</span>
                  {out.map((v) => <code key={v.name} className="rounded bg-subtle px-1 font-mono text-2xs">→ {`{{var.${v.name}}}`}</code>)}
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onEdit(s.id)}>Edit</Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => onRemove(s.id)} aria-label={`Remove ${s.target.name}`}><X /></Button>
                  </span>
                </li>
              )
            })}
          </ol>
          <Checkbox checked={openAccess} onChange={(e) => setOpenAccess(e.target.checked)} label="Let everyone who fills in the form write these rows"
            description="Off: each person needs the Manage rows permission on the tables. On: the rule's own tables and columns are written for anyone who can submit the form (audited)." />
          <p className={cn('text-xs', muted)}>Save the form afterwards to keep the rule. You can change it any time on the Rules tab.</p>
        </>
      )}
      {destination === 'workflow' && workflow && (
        <>
          <div>
            <label htmlFor="de-workflow-name" className="mb-0.5 block text-2xs font-semibold text-fg-muted">Workflow name</label>
            <input id="de-workflow-name" className={cn(inputClass, 'w-full max-w-md')} value={workflowName} placeholder={workflow.name} onChange={(e) => setWorkflowName(e.target.value)} />
          </div>
          <div className="rounded-md border border-border p-3" data-testid="data-event-outline">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-fg-muted">Workflow outline</p>
            <ol className="space-y-1" aria-label="Workflow outline">
              {workflow.outline.map((line) => (
                <li key={line.node} className="flex items-center gap-2 text-xs text-fg" style={{ paddingLeft: `${line.depth * 1.25}rem` }} data-outline-kind={line.kind}>
                  <span className="text-fg-muted">{OUTLINE_ICON[line.kind]}</span>
                  <span className="min-w-0 flex-1">{line.text}</span>
                  {line.step && (line.kind === 'insert' || line.kind === 'call') && (
                    <span className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onEdit(line.step!)}>Edit</Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => onRemove(line.step!)} aria-label={`Remove ${line.text}`}><X /></Button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
          {check && (
            <p className={cn('flex items-center gap-1.5 text-xs', check.errors || check.warnings ? 'text-warning' : 'text-success')} role="status">
              {check.errors || check.warnings ? <TriangleAlert className="size-3.5" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
              {check.errors || check.warnings ? `${check.errors} validation error${check.errors === 1 ? '' : 's'}, ${check.warnings} wiring warning${check.warnings === 1 ? '' : 's'}` : 'Validates, no wiring warnings'}
            </p>
          )}
          <p className={cn('text-xs', muted)}>Created as a <strong>draft</strong> from the form as last saved — save your form changes first. Publish it in the workflow designer when you are ready.</p>
        </>
      )}
      <ProblemList problems={problems} />
    </div>
  )
}

function ProblemList({ problems }: { problems: DataEventProblem[] }) {
  if (!problems.length) return null
  return (
    <div className="space-y-1" role="status" aria-label="Problems">
      {problems.map((x, i) => (
        <p key={i} className={cn('flex items-start gap-1.5 text-xs', x.severity === 'error' ? 'text-danger' : 'text-warning')}>
          {x.severity === 'error' ? <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
          <span className="text-fg">{x.message}</span>
        </p>
      ))}
    </div>
  )
}

function CreatedView({ created }: { created: { id: string; name: string; tables: Array<{ id: string; name: string }> } }) {
  return (
    <div className="space-y-3">
      <InlineNotice tone="success" title={`"${created.name}" is ready as a draft`} message="It starts when this form is submitted once you publish it." />
      <ul className="space-y-1 text-sm">
        <li><Link className="inline-flex items-center gap-1 text-primary-text underline-offset-2 hover:underline" href={`/automations/${created.id}`} target="_blank" rel="noopener noreferrer"><Workflow className="size-4" aria-hidden />Open the workflow<ExternalLink className="size-3" aria-hidden /></Link></li>
        {created.tables.map((t) => (
          <li key={t.id}><Link className="inline-flex items-center gap-1 text-primary-text underline-offset-2 hover:underline" href={`/data/${t.id}`} target="_blank" rel="noopener noreferrer"><Database className="size-4" aria-hidden />{t.name}<ExternalLink className="size-3" aria-hidden /></Link></li>
        ))}
      </ul>
    </div>
  )
}
