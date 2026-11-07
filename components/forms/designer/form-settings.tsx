'use client'

import { AnonymousStepToggle } from './anonymous-step-toggle'
import { TableChangesEditor } from './table-changes-editor'
import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, Trash2, Upload, X } from 'lucide-react'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { VariableInput } from '@/components/automations/variable-input'
import { serverRead } from '@/lib/server-read'
import { uploadFormHeaderImage } from '@/app/actions/forms'
import {
  allowedActions, BUTTON_LIMITS, FORM_ACTION_LABELS,
  type FormAction, type FormActionType, type FormButton, type FormButtonKind, type FormButtonStyle,
} from '@/lib/forms/buttons'
import { HEADER_IMAGE_TYPES, type FormHeader, type FormHeaderImageSource } from '@/lib/forms/header'
import { lookupItemKey } from '@/lib/forms/lookup'
import type { DesignerState } from '@/lib/forms/designer-state'
import { DISPLAY_FIELD_TYPES } from '@/lib/task-field-schema'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { FORM_STATE_LIMITS, flagKey, isInformationPage, submitPathProblem, type FormStateFlag } from '@/lib/forms/form-state'
import { contextVariableOptions } from '@/lib/forms/form-params'
import { AFTER_SUBMIT_VARIABLES } from '@/lib/forms/variable-catalog'
import { DesignerVariableScope } from './designer-variable-scope'
import { SubmittedPageEditor } from './submitted-page-editor'
import { TaskCompletedEditor } from './task-completed-editor'
import { formActions, withFormAction } from '@/lib/forms/form-actions'
import { FORM_MOTION_LABELS, FORM_MOTION_STYLES, formAnimation, withFormAnimation, type FormMotionStyle } from '@/lib/forms/motion'
import { cn } from '@/lib/utils'
import { designerInputClass as inputClass } from './designer-controls'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow option rows are loose JSON */


function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-2xs text-fg-muted">{children}</p>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-2 border-t pt-3 first:border-t-0 first:pt-0 border-border">
      <legend className="pr-2 text-2xs font-semibold text-fg-muted">{title}</legend>
      {children}
    </fieldset>
  )
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn('h-7 flex-1 rounded border px-1 text-2xs font-medium', value === v ? 'border-primary' : 'border-border', value === v ? 'bg-primary-wash' : '', value === v ? 'text-primary-text' : 'text-fg')}
         >
          {text}
        </button>
      ))}
    </div>
  )
}

/* ── Header ──────────────────────────────────────────────────────────── */

function HeaderEditor({ header, onChange, placeholders }: { header: FormHeader; onChange: (next: FormHeader, tag?: string) => void; placeholders: Array<{ name: string; group: string; label?: string }> }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const set = (patch: Partial<FormHeader>, tag?: string) => onChange({ ...header, ...patch }, tag)

  async function upload(file: File) {
    setUploadError(null)
    if (file.size > 1024 * 1024) { setUploadError('The image must be 1 MB or smaller'); return }
    setUploading(true)
    try {
      const data = new FormData()
      data.set('file', file)
      const result = await uploadFormHeaderImage(data)
      if (!result.ok) { setUploadError(result.error); return }
      set({ image: 'upload', image_url: result.data.ref ?? result.data.url })
    } finally {
      setUploading(false)
    }
  }

  return (
    <Section title="Header">
      <label className="flex items-center gap-1.5 text-2xs">
        <input className="accent-primary" type="checkbox" checked={header.enabled} onChange={(e) => set({ enabled: e.target.checked })} data-testid="header-enabled" />
        Show a header above the fields
      </label>
      {header.enabled && (
        <>
          <div>
            <Label>Image</Label>
            <Segmented<FormHeaderImageSource> label="Header image" value={header.image}
              options={[['default', 'UserTasks'], ['workspace_logo', 'Workspace logo'], ['upload', 'Upload'], ['none', 'None']]}
              onChange={(v) => (v === 'upload' && !header.image_url ? fileRef.current?.click() : set({ image: v }))} />
            <input ref={fileRef} type="file" accept={HEADER_IMAGE_TYPES.join(',')} className="sr-only" aria-label="Upload a header image" data-testid="header-upload"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
            {header.image === 'upload' && header.image_url && (
              <div className="mt-1 flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- uploaded header image (own storage) */}
                <img src={resolveStorageUrl(header.image_url) ?? header.image_url} alt="Header image" className="h-8 w-auto max-w-[120px] rounded border object-contain border-border" />
                <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => fileRef.current?.click()}>
                  <Upload size={11} /> Replace
                </button>
              </div>
            )}
            {uploading && <Hint>Uploading…</Hint>}
            {uploadError && <p className="mt-1 text-2xs text-danger" role="alert">{uploadError}</p>}
            <Hint>PNG, JPEG, SVG or WebP up to 1 MB.</Hint>
          </div>
          {header.image !== 'none' && (
            <div>
              <Label htmlFor="form-header-image-alt">Image description (alt text)</Label>
              <input id="form-header-image-alt" className="h-8 w-full rounded-md border px-2 text-xs border-border bg-input text-fg" value={header.image_alt ?? ''} placeholder="Empty = decorative"
                onChange={(e) => set({ image_alt: e.target.value || undefined }, 'header-image-alt')} data-testid="header-image-alt" />
            </div>
          )}
          <div>
            <Label>Title</Label>
            <VariableInput value={header.title ?? ''} extraVariables={placeholders} placeholder="e.g. Customer complaint — {{task_data.customer}}"
              onChange={(v) => set({ title: v || undefined }, 'header-title')} />
          </div>
          <div>
            <Label>Subtitle</Label>
            <VariableInput value={header.subtitle ?? ''} extraVariables={placeholders} placeholder="Optional"
              onChange={(v) => set({ subtitle: v || undefined }, 'header-subtitle')} />
          </div>
          <div>
            <Label>Alignment</Label>
            <Segmented label="Header alignment" value={header.align ?? 'left'} options={[['left', 'Left'], ['center', 'Centre']]} onChange={(v) => set({ align: v })} />
          </div>
          <label className="flex items-center gap-1.5 text-2xs">
            <input className="accent-primary" type="checkbox" checked={header.banner === true} onChange={(e) => set({ banner: e.target.checked || undefined })} />
            Banner colour from the form theme
          </label>
        </>
      )}
    </Section>
  )
}

/* ── Buttons ─────────────────────────────────────────────────────────── */

const KIND_LABELS: Record<FormButtonKind, string> = { submit: 'Submit', cancel: 'Cancel', draft: 'Save draft', outcome: 'Outcome' }

function newButtonId(buttons: FormButton[], kind: FormButtonKind): string {
  let id: string = kind
  for (let i = 2; buttons.some((b) => b.id === id); i++) id = `${kind}_${i}`
  return id
}

export function BarActionEditor({ action, onChange, onRemove, workflows, placeholders, fields }: {
  fields: DesignerState['fields']
  action: FormAction
  onChange: (next: FormAction, tag?: string) => void
  onRemove: () => void
  workflows: any[]
  placeholders: Array<{ name: string; group: string; label?: string }>
}) {
  const workflow = workflows.find((w) => w.id === action.workflow_id)
  const inputs: string[] = Array.isArray(workflow?.user_variables) ? workflow.user_variables.map((v: any) => String(v?.name ?? '')).filter(Boolean) : []
  return (
    <div className="space-y-1.5 rounded border p-2 border-border" data-action-type={action.type}>
      <div className="flex items-center gap-1">
        <p className="flex-1 text-2xs font-semibold">{FORM_ACTION_LABELS[action.type]}</p>
        <button type="button" className="rounded p-0.5" aria-label={`Remove ${FORM_ACTION_LABELS[action.type]}`} onClick={onRemove}><X size={11} /></button>
      </div>
      {action.type === 'message' && (
        <VariableInput value={action.text ?? ''} extraVariables={placeholders} placeholder="Thanks {{name}} — we got it."
          onChange={(v) => onChange({ ...action, text: v }, 'action-text')} />
      )}
      {action.type === 'success_screen' && (
        <>
          <Hint>This button&apos;s own screen; it takes precedence over the form&apos;s Submitted page.</Hint>
          <input aria-label="Success title" className={inputClass} value={action.title ?? ''} placeholder="Thank you" onChange={(e) => onChange({ ...action, title: e.target.value }, 'action-title')} />
          <VariableInput value={action.text ?? ''} extraVariables={placeholders} multiline rows={2} placeholder="We'll be in touch. Reference: {{run_reference}}"
            onChange={(v) => onChange({ ...action, text: v || undefined }, 'action-body')} />
          <AutocompleteSelect value={action.screen_button ?? 'submit_another'}
            options={[{ value: 'submit_another', label: '"Submit another" button' }, { value: 'close', label: '"Close" button' }, { value: 'link', label: 'A link button' }, { value: 'none', label: 'No button' }]}
            onChange={(v) => onChange({ ...action, screen_button: (v || 'submit_another') as FormAction['screen_button'] })} />
          {action.screen_button && action.screen_button !== 'none' && (
            <input aria-label="Button label" className={inputClass} value={action.screen_button_label ?? ''} placeholder="Button label (optional)" onChange={(e) => onChange({ ...action, screen_button_label: e.target.value || undefined }, 'action-sb')} />
          )}
          {action.screen_button === 'link' && (
            <input aria-label="Link address" className={inputClass} value={action.url ?? ''} placeholder="/tasks or an allowed https:// address" onChange={(e) => onChange({ ...action, url: e.target.value }, 'action-url')} />
          )}
        </>
      )}
      {action.type === 'start_workflow' && (
        <>
          <AutocompleteSelect value={action.workflow_id ?? ''} placeholder="Choose a workflow…"
            options={workflows.map((w) => ({ value: String(w.id), label: String(w.name), hint: w.is_active ? undefined : 'inactive' }))}
            onChange={(v) => onChange({ ...action, workflow_id: v || undefined, workflow_name: workflows.find((w) => w.id === v)?.name, inputs: undefined })} />
          {action.workflow_id && (
            <div className="space-y-1">
              {inputs.length === 0 && <Hint>The workflow declares no inputs — map values with any name it reads.</Hint>}
              {inputs.map((name) => (
                <div key={name}>
                  <p className="font-mono text-2xs">{name}</p>
                  <VariableInput value={action.inputs?.[name] ?? ''} extraVariables={placeholders} placeholder="{{field}}"
                    onChange={(v) => {
                      const next = { ...(action.inputs ?? {}) }
                      if (v) next[name] = v
                      else delete next[name]
                      onChange({ ...action, inputs: Object.keys(next).length ? next : undefined }, `action-in-${name}`)
                    }} />
                </div>
              ))}
              <Hint>Runs on the server, queued, for the person who submits. Later texts can show {'{{run_reference}}'}.</Hint>
            </div>
          )}
        </>
      )}
      {action.type === 'redirect' && (
        <>
          <input aria-label="Redirect address" className={inputClass} value={action.url ?? ''} placeholder="/tasks or an allowed https:// address" onChange={(e) => onChange({ ...action, url: e.target.value }, 'action-url')} />
          <Hint>App pages (/…) or addresses on the allow list.</Hint>
        </>
      )}
      {action.type === 'close' && <Hint>Closes the form (the standalone page shows that it is closed).</Hint>}
      {action.type === 'apply_table_changes' && (
        <>
          <TableChangesEditor config={action.table_changes} fields={fields} onChange={(table_changes, tag) => onChange({ ...action, table_changes }, tag)} />
          <Hint>Runs on the server after the submission is stored, for the person who submits.</Hint>
        </>
      )}
      {(action.type === 'start_workflow' || action.type === 'apply_table_changes') && (
        <AnonymousStepToggle checked={action.allow_anonymous === true} onChange={(v) => onChange({ ...action, allow_anonymous: v || undefined })} />
      )}
    </div>
  )
}

function ButtonEditor({ button, index, count, outcomes, problem, onChange, onMove, onRemove, workflows, placeholders, fields }: {
  fields: DesignerState['fields']
  button: FormButton
  index: number
  count: number
  outcomes?: string[]
  problem?: string
  onChange: (next: FormButton, tag?: string) => void
  onMove: (delta: number) => void
  onRemove?: () => void
  workflows: any[]
  placeholders: Array<{ name: string; group: string; label?: string }>
}) {
  const id = (n: string) => `fb-${button.id}-${n}`
  const available = allowedActions(button.kind).filter((t) => !(button.actions ?? []).some((a) => a.type === t) || t === 'message' || t === 'start_workflow' || t === 'apply_table_changes')
  return (
    <div className={cn('space-y-2 rounded-lg border p-2.5', problem ? 'border-danger' : 'border-border')} data-button-editor={button.id}>
      <div className="flex items-center gap-1">
        <p className="flex-1 text-2xs font-semibold text-fg-muted">{KIND_LABELS[button.kind]} button</p>
        <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={index === 0} aria-label={`Move ${button.label} left`} onClick={() => onMove(-1)}><ArrowUp size={11} /></button>
        <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={index === count - 1} aria-label={`Move ${button.label} right`} onClick={() => onMove(1)}><ArrowDown size={11} /></button>
        {onRemove && <button type="button" className="rounded p-0.5" aria-label={`Remove ${button.label}`} onClick={onRemove}><Trash2 size={11} /></button>}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-1">
        <div>
          <Label htmlFor={id('label')}>Label</Label>
          <input id={id('label')} className={inputClass} value={button.label} maxLength={BUTTON_LIMITS.label} onChange={(e) => onChange({ ...button, label: e.target.value }, `label-${button.id}`)} />
        </div>
        <div className="w-28">
          <Label>Style</Label>
          <AutocompleteSelect value={button.style} options={[{ value: 'primary', label: 'Primary' }, { value: 'secondary', label: 'Secondary' }, { value: 'danger', label: 'Danger' }]}
            onChange={(v) => onChange({ ...button, style: (v || 'primary') as FormButtonStyle })} />
        </div>
      </div>
      {button.kind === 'outcome' && (
        <div>
          <Label>Completes the task with</Label>
          {outcomes?.length ? (
            <AutocompleteSelect value={button.outcome ?? ''} options={outcomes.map((o) => ({ value: o, label: o }))} onChange={(v) => onChange({ ...button, outcome: v })} />
          ) : (
            <input aria-label="Outcome" className={inputClass} value={button.outcome ?? ''} onChange={(e) => onChange({ ...button, outcome: e.target.value }, `outcome-${button.id}`)} />
          )}
        </div>
      )}
      {button.kind === 'cancel' && (
        <label className="flex items-center gap-1.5 text-2xs">
          <input className="accent-primary" type="checkbox" checked={button.hidden === true} onChange={(e) => onChange({ ...button, hidden: e.target.checked || undefined })} />
          Hide this button
        </label>
      )}
      {!button.hidden && (
        <div className="space-y-1.5">
          <Label>After a click</Label>
          {button.kind === 'cancel' && !(button.actions ?? []).length && <Hint>Discards the values (asking first when something was typed).</Hint>}
          {(button.kind === 'submit' || button.kind === 'outcome') && !(button.actions ?? []).length && <Hint>Validates and submits. Add what happens next.</Hint>}
          {(button.actions ?? []).map((action, i) => (
            <BarActionEditor key={i} action={action} workflows={workflows} placeholders={placeholders} fields={fields}
              onChange={(next, tag) => onChange({ ...button, actions: (button.actions ?? []).map((a, j) => (j === i ? next : a)) }, tag ? `${tag}-${button.id}-${i}` : undefined)}
              onRemove={() => onChange({ ...button, actions: (button.actions ?? []).filter((_, j) => j !== i) })} />
          ))}
          {(button.actions ?? []).length < BUTTON_LIMITS.actions && available.length > 0 && (
            <AutocompleteSelect value="" placeholder="+ Add a step…"
              options={available.map((t) => ({ value: t, label: FORM_ACTION_LABELS[t] }))}
              onChange={(v) => {
                if (!v) return
                const type = v as FormActionType
                const action: FormAction = type === 'message' ? { type, text: 'Thank you — your answers were sent.' }
                  : type === 'success_screen' ? { type, title: 'Thank you', screen_button: 'submit_another' }
                    : type === 'apply_table_changes' ? { type, table_changes: { field: '', target: 'table', operation: 'auto' } }
                      : { type }
                onChange({ ...button, actions: [...(button.actions ?? []), action] })
              }} />
          )}
        </div>
      )}
      {problem && <p className="text-2xs text-danger" role="alert">{problem}</p>}
    </div>
  )
}

export function FormSettings({ state, onChange, outcomes, problems, showDraft }: {
  state: DesignerState
  onChange: (next: DesignerState, tag?: string) => void
  /** The step's outcomes (task forms): outcome buttons pick one. */
  outcomes?: string[]
  problems: Record<string, string>
  /** Offer a Save draft button (task forms). */
  showDraft?: boolean
}) {
  const { data: workflows = [] } = useQuery({
    queryKey: ['form-button-workflows'],
    staleTime: 60_000,
    queryFn: async () => (await serverRead('automations.workflowOptions')).data ?? [],
  })
  const valueFields = state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type))
  const placeholders = [
    ...valueFields.flatMap((f) => [
      { name: f.key, group: 'This form', label: f.label || f.key },
      ...(f.type === 'lookup' ? [{ name: lookupItemKey(f.key), group: 'This form', label: `${f.label || f.key} (selected item)` }] : []),
    ]),
    { name: 'run_reference', group: 'After submit', label: 'Reference of the workflow started' },
    { name: 'submission_id', group: 'After submit', label: 'Submission reference' },
    { name: 'table_changes_summary', group: 'After submit', label: 'Summary of the table changes applied' },
    ...contextVariableOptions(state.layout),
  ]
  const buttons = state.buttons
  const setButtons = (next: FormButton[], tag?: string) => onChange({ ...state, buttons: next }, tag)
  const add = (kind: FormButtonKind) => {
    const outcome = kind === 'outcome' ? (outcomes ?? []).find((o) => !buttons.some((b) => b.kind === 'outcome' && b.outcome === o)) ?? 'Approved' : undefined
    const button: FormButton = { id: newButtonId(buttons, kind), label: outcome ?? KIND_LABELS[kind], kind, style: kind === 'cancel' || kind === 'draft' ? 'secondary' : kind === 'outcome' && /reject|decline|deny/i.test(outcome ?? '') ? 'danger' : 'primary', ...(outcome ? { outcome } : {}) }
    setButtons([...buttons, button])
  }
  const appMode = state.layout.application_mode === true
  const noSubmit = submitPathProblem(state.fields, state.layout, showDraft ? 'task' : 'any')
  return (
    <div className="space-y-4 text-xs" data-testid="form-settings">
      <HeaderEditor header={state.header} placeholders={placeholders} onChange={(header, tag) => onChange({ ...state, header }, tag)} />
      <AppearanceEditor state={state} onChange={onChange} />
      {!showDraft && <FormIconsEditor state={state} onChange={onChange} />}
      <Section title="Application mode">
        <label className="flex items-start gap-1.5 text-2xs">
          <input type="checkbox" className="mt-0.5 accent-primary" checked={appMode} data-testid="application-mode"
            onChange={(e) => {
              const layout = { ...state.layout }
              if (e.target.checked) layout.application_mode = true
              else delete layout.application_mode
              onChange({ ...state, layout })
            }} />
          <span>
            <span className="font-medium">Application mode</span> — hide the Submit and Cancel buttons. Use it for information pages or forms driven by your own buttons.
          </span>
        </label>
 <Hint>The button bar below is not shown on any page. A Button on the form with a Submit action still presses its button, so the behaviours run.</Hint>
        {appMode && !noSubmit && isInformationPage(state.fields, state.layout) && <Hint>No button on the form submits: it is an information page — nothing is validated or sent.</Hint>}
        {noSubmit && <p className="rounded border px-2 py-1.5 text-2xs border-warning text-fg" role="status" data-testid="no-submit-warning">{noSubmit}</p>}
      </Section>
      <FormStateEditor state={state} onChange={onChange} />
      <Section title="Buttons">
        <Hint>Placement (left, right or full width) comes from the form theme.</Hint>
        {/* Behaviours run after the submission is stored: the values, parameters, variables and the run's references. */}
        <DesignerVariableScope state={state} context={{ kind: 'bar' }} extras={AFTER_SUBMIT_VARIABLES}>
        <div className="space-y-2">
          {buttons.map((button, i) => (
            <ButtonEditor key={button.id} button={button} index={i} count={buttons.length} outcomes={outcomes} problem={problems[button.id]} workflows={workflows} placeholders={placeholders} fields={state.fields}
              onChange={(next, tag) => setButtons(buttons.map((b, j) => (j === i ? next : b)), tag)}
              onMove={(delta) => { const next = [...buttons]; const [b] = next.splice(i, 1); next.splice(Math.max(0, Math.min(next.length, i + delta)), 0, b); setButtons(next) }}
              onRemove={buttons.filter((b) => b.kind === 'submit' || b.kind === 'outcome').length > 1 || (button.kind !== 'submit' && button.kind !== 'outcome') ? () => setButtons(buttons.filter((_, j) => j !== i)) : undefined} />
          ))}
        </div>
        </DesignerVariableScope>
        {buttons.length < BUTTON_LIMITS.buttons && (
          <div className="flex flex-wrap gap-1">
            {(['outcome', 'submit', ...(showDraft ? ['draft'] : []), 'cancel'] as FormButtonKind[])
              .filter((k) => !((k === 'cancel' || k === 'draft') && buttons.some((b) => b.kind === k)))
              .map((kind) => (
                <button key={kind} type="button" className="flex items-center gap-1 rounded border px-2 py-1 text-2xs font-medium border-border text-primary-text" onClick={() => add(kind)} data-add-button={kind}>
                  <Plus size={11} /> {kind === 'outcome' ? 'Outcome button' : `${KIND_LABELS[kind]} button`}
                </button>
              ))}
          </div>
        )}
      </Section>
      <Section title="Submitted page">
        <SubmittedPageEditor state={state} onChange={onChange} taskForm={showDraft} />
      </Section>
      {showDraft && (
        <Section title="Task completed screen">
          <TaskCompletedEditor state={state} onChange={onChange} outcomes={outcomes} />
        </Section>
      )}
    </div>
  )
}

/* ── Appearance: animation ───────────────────────────────────────────── */

const MOTION_HINTS: Record<FormMotionStyle, string> = {
  none: 'Nothing moves: the form appears at once.',
  subtle: 'Short fades and small rises (about a third of a second): the card and fields on load, step changes, fields a rule shows or hides, messages and errors.',
  expressive: 'The same moments with more movement: a springier entrance, a wider step slide and the Submitted page icon drawn in.',
}

/** The form's animation style (lib/forms/motion.ts): Subtle unless changed here. */
function AppearanceEditor({ state, onChange }: { state: DesignerState; onChange: (next: DesignerState, tag?: string) => void }) {
  const animation = formAnimation(state.layout)
  const set = (patch: Parameters<typeof withFormAnimation>[1]) => onChange({ ...state, layout: withFormAnimation(state.layout, patch) })
  return (
    <Section title="Appearance">
      <Label>Animation</Label>
      <Segmented<FormMotionStyle> label="Animation style" value={animation.style}
        options={FORM_MOTION_STYLES.map((s) => [s, FORM_MOTION_LABELS[s]])} onChange={(style) => set({ style })} />
      <Hint>{MOTION_HINTS[animation.style]} People who ask their device for reduced motion get fades only. Use <span className="font-medium">Replay animation</span> in Preview to see it.</Hint>
      {animation.style === 'expressive' && (
        <label className="flex items-start gap-1.5 text-2xs">
          <input type="checkbox" className="mt-0.5 accent-primary" checked={animation.confetti} data-testid="form-animation-confetti"
            onChange={(e) => set({ confetti: e.target.checked })} />
          <span><span className="font-medium">Confetti on the Submitted page</span> — a light burst when the page uses the success colour.</span>
        </label>
      )}
    </Section>
  )
}

/* ── Top-right icons ─────────────────────────────────────────────────── */

/** Favourite heart and Save draft in the form's top-right corner (lib/forms/form-actions.ts): on unless turned off here. */
function FormIconsEditor({ state, onChange }: { state: DesignerState; onChange: (next: DesignerState, tag?: string) => void }) {
  const on = formActions(state.layout)
  const toggle = (action: 'favorite' | 'draft', checked: boolean) => onChange({ ...state, layout: withFormAction(state.layout, action, checked) })
  return (
    <Section title="Form icons">
      <label className="flex items-start gap-1.5 text-2xs">
        <input type="checkbox" className="mt-0.5 accent-primary" checked={on.favorite} data-testid="show-favourite-button"
          onChange={(e) => toggle('favorite', e.target.checked)} />
        <span><span className="font-medium">Show favourite button</span> — a heart in the top-right corner adds the form to the person&apos;s favourites (Home, the Forms menu).</span>
      </label>
      <label className="flex items-start gap-1.5 text-2xs">
        <input type="checkbox" className="mt-0.5 accent-primary" checked={on.draft} data-testid="show-save-draft-button"
          onChange={(e) => toggle('draft', e.target.checked)} />
        <span><span className="font-medium">Show save-draft button</span> — saves the person&apos;s answers so far; they are offered back next time (&ldquo;Resume your draft?&rdquo;) until the form is submitted.</span>
      </label>
      <Hint>Shown where people fill the form in: its own page and the Run dialog of a workflow that starts from it. Signed-in people only.</Hint>
    </Section>
  )
}

/* ── Form state flags ────────────────────────────────────────────────── */

/** Declare the yes/no flags in-form buttons set (rules read them as state.<flag>). */
function FormStateEditor({ state, onChange }: { state: DesignerState; onChange: (next: DesignerState, tag?: string) => void }) {
  const flags = state.layout.state?.flags ?? []
  const setFlags = (next: FormStateFlag[], tag?: string) => {
    const layout = { ...state.layout }
    const config = { ...(layout.state ?? {}) }
    if (next.length) config.flags = next
    else delete config.flags
    if (Object.keys(config).length) layout.state = config
    else delete layout.state
    onChange({ ...state, layout }, tag)
  }
  const used = (key: string) => state.fields.some((f) => f.visible_when?.field === `state.${key}` || f.button?.disabled_when?.field === `state.${key}` || f.button?.actions.some((a) => a.flag === key))
    || (state.layout.pages ?? []).some((p) => p.visible_when?.field === `state.${key}`)
  return (
    <Section title="Form state">
      <Hint>Yes/no flags a Button sets (On click → Set a state flag). Fields, sections and steps / tabs show when a flag is on or off: Visible when → <code>state.&lt;flag&gt;</code>.</Hint>
      {flags.map((flag, i) => (
        <div key={i} className="flex items-center gap-1" data-state-flag={flag.key}>
          <input aria-label={`Flag ${i + 1} name`} className={`${inputClass} font-mono`} value={flag.key}
            onChange={(e) => setFlags(flags.map((f, j) => (j === i ? { ...f, key: flagKey(e.target.value) || f.key } : f)), `flag-${i}`)} />
          <label className="flex shrink-0 items-center gap-1 text-2xs">
            <input className="accent-primary" type="checkbox" checked={flag.default === true} onChange={(e) => setFlags(flags.map((f, j) => (j === i ? { ...f, default: e.target.checked || undefined } : f)))} />
            Starts on
          </label>
          <button type="button" className="rounded p-0.5 disabled:opacity-30" aria-label={`Remove flag ${flag.key}`} title={used(flag.key) ? 'In use by a rule or button' : 'Remove'}
            disabled={used(flag.key)} onClick={() => setFlags(flags.filter((_, j) => j !== i))}><X size={11} /></button>
        </div>
      ))}
      {flags.length < FORM_STATE_LIMITS.flags && (
        <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" data-add-flag
          onClick={() => { let n = flags.length + 1; let key = flags.length ? `flag_${n}` : 'show_details'; while (flags.some((f) => f.key === key)) key = `flag_${++n}`; setFlags([...flags, { key }]) }}>
          <Plus size={11} /> Add a state flag
        </button>
      )}
    </Section>
  )
}
