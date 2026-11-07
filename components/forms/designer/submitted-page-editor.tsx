'use client'

import { useRef, useState } from 'react'
import { Ban, Upload } from 'lucide-react'
import { VariableInput } from '@/components/automations/variable-input'
import { uploadFormHeaderImage } from '@/app/actions/forms'
import { HEADER_IMAGE_TYPES } from '@/lib/forms/header'
import type { DesignerState } from '@/lib/forms/designer-state'
import { DISPLAY_FIELD_TYPES } from '@/lib/task-field-schema'
import { resolveStorageUrl } from '@/lib/storage/refs'
import { AFTER_SUBMIT_VARIABLES } from '@/lib/forms/variable-catalog'
import {
  SUBMITTED_PAGE_DEFAULTS, SUBMITTED_PAGE_ICONS, SUBMITTED_PAGE_ICON_LABELS, SUBMITTED_PAGE_LIMITS, defaultSubmittedPage, normalizeSubmittedPage, submittedPageProblem,
  type SubmittedPageButton, type SubmittedPageConfig, type SubmittedPageIconColor,
} from '@/lib/forms/submitted-page'
import { SUBMITTED_ICON_COMPONENTS, submittedIconColor } from '@/components/forms/submitted-page-view'
import { DesignerVariableScope } from './designer-variable-scope'
import { designerInputClass as inputClass } from './designer-controls'
import { cn } from '@/lib/utils'


function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-0.5 block text-2xs font-medium text-fg-muted">{children}</label>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-2xs text-fg-muted">{children}</p>
}

function ButtonToggle({ id, title, value, placeholder, onChange }: { id: string; title: string; value: SubmittedPageButton; placeholder: string; onChange: (next: SubmittedPageButton, tag?: string) => void }) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-2xs">
        <input className="accent-primary" type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} data-testid={`${id}-enabled`} />
        {title}
      </label>
      {value.enabled && (
        <input aria-label={`${title} label`} className={inputClass} value={value.label ?? ''} placeholder={placeholder} maxLength={SUBMITTED_PAGE_LIMITS.label}
          onChange={(e) => onChange({ ...value, label: e.target.value || undefined }, `${id}-label`)} data-testid={`${id}-label`} />
      )}
    </div>
  )
}

/**
 * Buttons & header → Submitted page (lib/forms/submitted-page.ts): the
 * switch, the success icon (curated icons, an upload, none) and its colour,
 * heading / subheading / note with the after-submit variables, a summary of
 * chosen answers, and the "Submit another response" / "Close form" buttons.
 */
export function SubmittedPageEditor({ state, onChange, taskForm }: {
  state: DesignerState
  onChange: (next: DesignerState, tag?: string) => void
  /** Task forms: the page is not shown (completing a task moves on). */
  taskForm?: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const stored = normalizeSubmittedPage(state.layout.submitted_page)
  const page = stored ?? { ...defaultSubmittedPage(), enabled: false }
  const write = (next: SubmittedPageConfig | null, tag?: string) => {
    const layout = { ...state.layout }
    if (next) layout.submitted_page = next
    else delete layout.submitted_page
    onChange({ ...state, layout }, tag)
  }
  const set = (patch: Partial<SubmittedPageConfig>, tag?: string) => write({ ...page, ...patch }, tag)

  async function upload(file: File) {
    setUploadError(null)
    if (file.size > 1024 * 1024) { setUploadError('The image must be 1 MB or smaller'); return }
    setUploading(true)
    try {
      const data = new FormData()
      data.set('file', file)
      const result = await uploadFormHeaderImage(data)
      if (!result.ok) { setUploadError(result.error); return }
      set({ icon: 'upload', icon_url: result.data.ref ?? result.data.url })
    } finally {
      setUploading(false)
    }
  }

  if (taskForm) {
    return <Hint>Task forms don&apos;t show a Submitted page: completing a task moves on. Use a button&apos;s &quot;Show success screen&quot; step for a message.</Hint>
  }

  const valueFields = state.fields.filter((f) => !DISPLAY_FIELD_TYPES.has(f.type))
  const color = page.icon_color ?? 'success'
  const problem = submittedPageProblem(page)
  return (
    <div className="space-y-2" data-testid="submitted-page-editor">
      <label className="flex items-start gap-1.5 text-2xs">
        <input type="checkbox" className="mt-0.5 accent-primary" checked={page.enabled} data-testid="submitted-page-enabled"
          onChange={(e) => (e.target.checked ? write({ ...(stored ?? defaultSubmittedPage()), enabled: true }) : stored ? write({ ...stored, enabled: false }) : undefined)} />
        <span><span className="font-medium">Show a submitted page</span> — replace the form with a confirmation once it is sent.</span>
      </label>
      {!page.enabled && <Hint>Off: the form stays open, cleared, with its messages (or does what its buttons say).</Hint>}
      {page.enabled && (
        <DesignerVariableScope state={state} context={{ kind: 'bar' }} extras={AFTER_SUBMIT_VARIABLES}>
        <div className="space-y-2">
          <div>
            <Label>Success icon</Label>
            <div className="grid grid-cols-7 gap-1" role="radiogroup" aria-label="Success icon">
              {SUBMITTED_PAGE_ICONS.map((name) => {
                const Icon = SUBMITTED_ICON_COMPONENTS[name]
                const on = page.icon === name
                return (
                  <button key={name} type="button" role="radio" aria-checked={on} aria-label={SUBMITTED_PAGE_ICON_LABELS[name]} title={SUBMITTED_PAGE_ICON_LABELS[name]}
                    className="flex h-8 items-center justify-center rounded border" data-submitted-icon-option={name}
                    style={on ? { borderColor: 'var(--theme-primary)', backgroundColor: 'var(--theme-primary-light)', color: submittedIconColor(color) } : { borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                    onClick={() => set({ icon: name, icon_color: color })}>
                    <Icon size={15} aria-hidden />
                  </button>
                )
              })}
              <button type="button" role="radio" aria-checked={page.icon === 'upload'} aria-label="Upload an image" title="Upload an image" data-submitted-icon-option="upload"
                className={cn('flex h-8 items-center justify-center rounded border', page.icon === 'upload' ? 'border-primary' : 'border-border', page.icon === 'upload' ? 'bg-primary-wash' : '', page.icon === 'upload' ? '' : 'text-fg')}
                onClick={() => (page.icon_url ? set({ icon: 'upload' }) : fileRef.current?.click())}>
                <Upload size={15} aria-hidden />
              </button>
              <button type="button" role="radio" aria-checked={page.icon === 'none'} aria-label="No icon" title="No icon" data-submitted-icon-option="none"
                className={cn('flex h-8 items-center justify-center rounded border', page.icon === 'none' ? 'border-primary' : 'border-border', page.icon === 'none' ? 'bg-primary-wash' : '', page.icon === 'none' ? '' : 'text-fg')}
                onClick={() => set({ icon: 'none' })}>
                <Ban size={15} aria-hidden />
              </button>
            </div>
            <input ref={fileRef} type="file" accept={HEADER_IMAGE_TYPES.join(',')} className="sr-only" aria-label="Upload a success image" data-testid="submitted-page-upload"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
            {uploading && <Hint>Uploading…</Hint>}
            {uploadError && <p className="mt-1 text-2xs text-danger" role="alert">{uploadError}</p>}
          </div>
          {page.icon === 'upload' && page.icon_url && (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- uploaded success image (own storage) */}
                <img src={resolveStorageUrl(page.icon_url) ?? page.icon_url} alt="Success image" className="h-8 w-auto max-w-[120px] rounded border object-contain border-border" />
                <button type="button" className="flex items-center gap-1 text-2xs font-medium text-primary-text" onClick={() => fileRef.current?.click()}>
                  <Upload size={11} /> Replace
                </button>
              </div>
              <Label htmlFor="submitted-page-icon-alt">Image description (alt text)</Label>
              <input id="submitted-page-icon-alt" className={inputClass} value={page.icon_alt ?? ''} placeholder="Empty = decorative" maxLength={SUBMITTED_PAGE_LIMITS.alt}
                onChange={(e) => set({ icon_alt: e.target.value || undefined }, 'submitted-icon-alt')} data-testid="submitted-page-icon-alt" />
              <Hint>PNG, JPEG, SVG or WebP up to 1 MB.</Hint>
            </div>
          )}
          {page.icon !== 'upload' && page.icon !== 'none' && (
            <div>
              <Label>Icon colour</Label>
              <div className="flex items-center gap-1" role="radiogroup" aria-label="Icon colour">
                {([['success', 'Success'], ['primary', 'Primary']] as const).map(([v, text]) => (
                  <button key={v} type="button" role="radio" aria-checked={color === v} onClick={() => set({ icon_color: v })}
                    className={cn('h-7 flex-1 rounded border px-1 text-2xs font-medium', color === v ? 'border-primary' : 'border-border', color === v ? 'bg-primary-wash' : '', color === v ? 'text-primary-text' : 'text-fg')}
                   >
                    {text}
                  </button>
                ))}
                <label className={cn('flex h-7 flex-1 items-center justify-center gap-1 rounded border px-1 text-2xs font-medium', color.startsWith('#') ? 'border-primary' : 'border-border', color.startsWith('#') ? 'bg-primary-wash' : '', color.startsWith('#') ? 'text-primary-text' : 'text-fg')}
                 >
                  <input type="color" aria-label="Custom icon colour" className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0" value={color.startsWith('#') ? color : '#16A34A'}
                    onChange={(e) => set({ icon_color: e.target.value.toUpperCase() as SubmittedPageIconColor }, 'submitted-icon-color')} data-testid="submitted-page-icon-color" />
                  Custom
                </label>
              </div>
              <Hint>Success and Primary follow the form theme (light and dark).</Hint>
            </div>
          )}
          <div>
            <Label>Heading</Label>
            <VariableInput value={page.heading ?? ''} placeholder={SUBMITTED_PAGE_DEFAULTS.heading} ariaLabel="Submitted page heading"
              onChange={(v) => set({ heading: v || undefined }, 'submitted-heading')} />
          </div>
          <div>
            <Label>Subheading</Label>
            <VariableInput value={page.subheading ?? ''} multiline rows={2} placeholder="Your reference is {{submission_id}}." ariaLabel="Submitted page subheading"
              onChange={(v) => set({ subheading: v || undefined }, 'submitted-subheading')} />
            <Hint>Answers ({'{{form.name}}'}), parameters ({'{{param.x}}'}), variables ({'{{var.x}}'}), {'{{submission_id}}'} and {'{{run_reference}}'}.</Hint>
          </div>
          {valueFields.length > 0 && (
            <details className="rounded border px-2 py-1.5 border-border" open={Boolean(page.summary_fields?.length)}>
              <summary className="cursor-pointer text-2xs font-medium">Summary of answers{page.summary_fields?.length ? ` (${page.summary_fields.length})` : ''}</summary>
              <div className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
                {valueFields.map((f) => {
                  const on = page.summary_fields?.includes(f.key) ?? false
                  return (
                    <label key={f._id} className="flex items-center gap-1.5 text-2xs">
                      <input type="checkbox" className="accent-primary" checked={on} data-summary-field={f.key}
                        disabled={!on && (page.summary_fields?.length ?? 0) >= SUBMITTED_PAGE_LIMITS.summary}
                        onChange={(e) => {
                          const keys = new Set(page.summary_fields ?? [])
                          if (e.target.checked) keys.add(f.key)
                          else keys.delete(f.key)
                          // Keep the form's order.
                          const ordered = valueFields.map((x) => x.key).filter((k) => keys.has(k))
                          set({ summary_fields: ordered.length ? ordered : undefined })
                        }} />
                      <span className="truncate">{f.label || f.key}</span>
                    </label>
                  )
                })}
              </div>
              <Hint>Shown as a short list under the subheading (empty answers are left out).</Hint>
            </details>
          )}
          <div>
            <Label>Note</Label>
            <VariableInput value={page.note ?? ''} multiline rows={2} placeholder="Optional — e.g. what happens next" ariaLabel="Submitted page note"
              onChange={(v) => set({ note: v || undefined }, 'submitted-note')} />
          </div>
          <div className="space-y-1.5">
            <Label>Buttons</Label>
            <ButtonToggle id="submitted-another" title="Submit another response" value={page.submit_another} placeholder={SUBMITTED_PAGE_DEFAULTS.submit_another}
              onChange={(next, tag) => set({ submit_another: next }, tag)} />
            <ButtonToggle id="submitted-close" title="Close form" value={page.close} placeholder={SUBMITTED_PAGE_DEFAULTS.close}
              onChange={(next, tag) => set({ close: next }, tag)} />
            <Hint>Submit another opens a fresh form (link parameters kept). Close goes back to the dashboard, or closes the dialog the form is in.</Hint>
          </div>
          <Hint>A button&apos;s Redirect, Close form or its own success screen takes precedence. Messages and After-submit rules still run.</Hint>
          {problem && <p className="text-2xs text-danger" role="alert" data-testid="submitted-page-problem">{problem}</p>}
        </div>
        </DesignerVariableScope>
      )}
    </div>
  )
}
