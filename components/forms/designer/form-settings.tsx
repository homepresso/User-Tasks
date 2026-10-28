'use client'

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

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow option rows are loose JSON */

const inputClass = 'h-8 w-full rounded-md border px-2 text-xs outline-none focus-visible:ring-2'
const inputStyle: React.CSSProperties = {
  borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-topbar)', color: 'var(--theme-topbar-text)',
  ['--tw-ring-color' as string]: 'var(--theme-primary)',
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>{children}</label>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{children}</p>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2 border-t pt-3 first:border-t-0 first:pt-0" style={{ borderColor: 'var(--theme-surface-border)' }}>
      <legend className="pr-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>{title}</legend>
      {children}
    </fieldset>
  )
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className="h-7 flex-1 rounded border px-1 text-[10px] font-medium"
          style={value === v
            ? { backgroundColor: 'var(--theme-primary)', borderColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }
            : { borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
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
      <label className="flex items-center gap-1.5 text-[11px]">
        <input type="checkbox" checked={header.enabled} onChange={(e) => set({ enabled: e.target.checked })} style={{ accentColor: 'var(--theme-primary)' }} data-testid="header-enabled" />
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
                <img src={resolveStorageUrl(header.image_url) ?? header.image_url} alt="Header image" className="h-8 w-auto max-w-[120px] rounded border object-contain" style={{ borderColor: 'var(--theme-surface-border)' }} />
                <button type="button" className="flex items-center gap-1 text-[10px] font-medium" style={{ color: 'var(--theme-primary-text)' }} onClick={() => fileRef.current?.click()}>
                  <Upload size={11} /> Replace
                </button>
              </div>
            )}
            {uploading && <Hint>Uploading…</Hint>}
            {uploadError && <p className="mt-1 text-[10px]" role="alert" style={{ color: 'var(--status-blocked)' }}>{uploadError}</p>}
            <Hint>PNG, JPEG, SVG or WebP up to 1 MB.</Hint>
          </div>
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
          <label className="flex items-center gap-1.5 text-[11px]">
            <input type="checkbox" checked={header.banner === true} onChange={(e) => set({ banner: e.target.checked || undefined })} style={{ accentColor: 'var(--theme-primary)' }} />
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

function ActionEditor({ action, onChange, onRemove, workflows, placeholders }: {
  action: FormAction
  onChange: (next: FormAction, tag?: string) => void
  onRemove: () => void
  workflows: any[]
  placeholders: Array<{ name: string; group: string; label?: string }>
}) {
  const workflow = workflows.find((w) => w.id === action.workflow_id)
  const inputs: string[] = Array.isArray(workflow?.user_variables) ? workflow.user_variables.map((v: any) => String(v?.name ?? '')).filter(Boolean) : []
  return (
    <div className="space-y-1.5 rounded border p-2" style={{ borderColor: 'var(--theme-surface-border)' }} data-action-type={action.type}>
      <div className="flex items-center gap-1">
        <p className="flex-1 text-[11px] font-semibold">{FORM_ACTION_LABELS[action.type]}</p>
        <button type="button" className="rounded p-0.5" aria-label={`Remove ${FORM_ACTION_LABELS[action.type]}`} onClick={onRemove}><X size={11} /></button>
      </div>
      {action.type === 'message' && (
        <VariableInput value={action.text ?? ''} extraVariables={placeholders} placeholder="Thanks {{name}} — we got it."
          onChange={(v) => onChange({ ...action, text: v }, 'action-text')} />
      )}
      {action.type === 'success_screen' && (
        <>
          <input aria-label="Success title" className={inputClass} style={inputStyle} value={action.title ?? ''} placeholder="Thank you" onChange={(e) => onChange({ ...action, title: e.target.value }, 'action-title')} />
          <VariableInput value={action.text ?? ''} extraVariables={placeholders} multiline rows={2} placeholder="We'll be in touch. Reference: {{run_reference}}"
            onChange={(v) => onChange({ ...action, text: v || undefined }, 'action-body')} />
          <AutocompleteSelect value={action.screen_button ?? 'submit_another'}
            options={[{ value: 'submit_another', label: '"Submit another" button' }, { value: 'close', label: '"Close" button' }, { value: 'link', label: 'A link button' }, { value: 'none', label: 'No button' }]}
            onChange={(v) => onChange({ ...action, screen_button: (v || 'submit_another') as FormAction['screen_button'] })} />
          {action.screen_button && action.screen_button !== 'none' && (
            <input aria-label="Button label" className={inputClass} style={inputStyle} value={action.screen_button_label ?? ''} placeholder="Button label (optional)" onChange={(e) => onChange({ ...action, screen_button_label: e.target.value || undefined }, 'action-sb')} />
          )}
          {action.screen_button === 'link' && (
            <input aria-label="Link address" className={inputClass} style={inputStyle} value={action.url ?? ''} placeholder="/tasks or an allowed https:// address" onChange={(e) => onChange({ ...action, url: e.target.value }, 'action-url')} />
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
                  <p className="font-mono text-[10px]">{name}</p>
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
          <input aria-label="Redirect address" className={inputClass} style={inputStyle} value={action.url ?? ''} placeholder="/tasks or an allowed https:// address" onChange={(e) => onChange({ ...action, url: e.target.value }, 'action-url')} />
          <Hint>App pages (/…) or addresses on the allow list.</Hint>
        </>
      )}
      {action.type === 'close' && <Hint>Closes the form (the standalone page shows that it is closed).</Hint>}
    </div>
  )
}

function ButtonEditor({ button, index, count, outcomes, problem, onChange, onMove, onRemove, workflows, placeholders }: {
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
  const available = allowedActions(button.kind).filter((t) => !(button.actions ?? []).some((a) => a.type === t) || t === 'message' || t === 'start_workflow')
  return (
    <div className="space-y-2 rounded-lg border p-2.5" style={{ borderColor: problem ? 'var(--status-blocked)' : 'var(--theme-surface-border)' }} data-button-editor={button.id}>
      <div className="flex items-center gap-1">
        <p className="flex-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>{KIND_LABELS[button.kind]} button</p>
        <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={index === 0} aria-label={`Move ${button.label} left`} onClick={() => onMove(-1)}><ArrowUp size={11} /></button>
        <button type="button" className="rounded p-0.5 disabled:opacity-30" disabled={index === count - 1} aria-label={`Move ${button.label} right`} onClick={() => onMove(1)}><ArrowDown size={11} /></button>
        {onRemove && <button type="button" className="rounded p-0.5" aria-label={`Remove ${button.label}`} onClick={onRemove}><Trash2 size={11} /></button>}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-1">
        <div>
          <Label htmlFor={id('label')}>Label</Label>
          <input id={id('label')} className={inputClass} style={inputStyle} value={button.label} maxLength={BUTTON_LIMITS.label} onChange={(e) => onChange({ ...button, label: e.target.value }, `label-${button.id}`)} />
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
            <input aria-label="Outcome" className={inputClass} style={inputStyle} value={button.outcome ?? ''} onChange={(e) => onChange({ ...button, outcome: e.target.value }, `outcome-${button.id}`)} />
          )}
        </div>
      )}
      {button.kind === 'cancel' && (
        <label className="flex items-center gap-1.5 text-[11px]">
          <input type="checkbox" checked={button.hidden === true} onChange={(e) => onChange({ ...button, hidden: e.target.checked || undefined })} style={{ accentColor: 'var(--theme-primary)' }} />
          Hide this button
        </label>
      )}
      {!button.hidden && (
        <div className="space-y-1.5">
          <Label>After a click</Label>
          {button.kind === 'cancel' && !(button.actions ?? []).length && <Hint>Discards the values (asking first when something was typed).</Hint>}
          {(button.kind === 'submit' || button.kind === 'outcome') && !(button.actions ?? []).length && <Hint>Validates and submits. Add what happens next.</Hint>}
          {(button.actions ?? []).map((action, i) => (
            <ActionEditor key={i} action={action} workflows={workflows} placeholders={placeholders}
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
                    : { type }
                onChange({ ...button, actions: [...(button.actions ?? []), action] })
              }} />
          )}
        </div>
      )}
      {problem && <p className="text-[10px]" role="alert" style={{ color: 'var(--status-blocked)' }}>{problem}</p>}
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
  ]
  const buttons = state.buttons
  const setButtons = (next: FormButton[], tag?: string) => onChange({ ...state, buttons: next }, tag)
  const add = (kind: FormButtonKind) => {
    const outcome = kind === 'outcome' ? (outcomes ?? []).find((o) => !buttons.some((b) => b.kind === 'outcome' && b.outcome === o)) ?? 'Approved' : undefined
    const button: FormButton = { id: newButtonId(buttons, kind), label: outcome ?? KIND_LABELS[kind], kind, style: kind === 'cancel' || kind === 'draft' ? 'secondary' : kind === 'outcome' && /reject|decline|deny/i.test(outcome ?? '') ? 'danger' : 'primary', ...(outcome ? { outcome } : {}) }
    setButtons([...buttons, button])
  }
  return (
    <div className="space-y-4 text-xs" data-testid="form-settings">
      <HeaderEditor header={state.header} placeholders={placeholders} onChange={(header, tag) => onChange({ ...state, header }, tag)} />
      <Section title="Buttons">
        <Hint>Placement (left, right or full width) comes from the form theme.</Hint>
        <div className="space-y-2">
          {buttons.map((button, i) => (
            <ButtonEditor key={button.id} button={button} index={i} count={buttons.length} outcomes={outcomes} problem={problems[button.id]} workflows={workflows} placeholders={placeholders}
              onChange={(next, tag) => setButtons(buttons.map((b, j) => (j === i ? next : b)), tag)}
              onMove={(delta) => { const next = [...buttons]; const [b] = next.splice(i, 1); next.splice(Math.max(0, Math.min(next.length, i + delta)), 0, b); setButtons(next) }}
              onRemove={buttons.filter((b) => b.kind === 'submit' || b.kind === 'outcome').length > 1 || (button.kind !== 'submit' && button.kind !== 'outcome') ? () => setButtons(buttons.filter((_, j) => j !== i)) : undefined} />
          ))}
        </div>
        {buttons.length < BUTTON_LIMITS.buttons && (
          <div className="flex flex-wrap gap-1">
            {(['outcome', 'submit', ...(showDraft ? ['draft'] : []), 'cancel'] as FormButtonKind[])
              .filter((k) => !((k === 'cancel' || k === 'draft') && buttons.some((b) => b.kind === k)))
              .map((kind) => (
                <button key={kind} type="button" className="flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-medium" style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-primary-text)' }} onClick={() => add(kind)} data-add-button={kind}>
                  <Plus size={11} /> {kind === 'outcome' ? 'Outcome button' : `${KIND_LABELS[kind]} button`}
                </button>
              ))}
          </div>
        )}
      </Section>
    </div>
  )
}
