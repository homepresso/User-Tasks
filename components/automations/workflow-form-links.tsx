'use client'

import { useEffect, useRef, useState } from 'react'
import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WorkflowFormEntries } from '@/lib/services/workflow-start-form'
import { FormPageLink, useWorkflowFormEntries } from '@/components/forms/form-page-link'
import { StartFormPagePanel } from '@/components/forms/start-form-page'

export { FormPageLink, useWorkflowFormEntries }

/**
 * The page links of the forms that start a workflow: its "Form submitted"
 * trigger's form, every form whose button "Start workflow" action starts
 * it, and the form page of its START form (lib/services/workflow-start-form
 * getWorkflowFormEntries). Each shows the /f/<id> URL with Copy link, Open
 * form and QR code. A workflow with a start form opens from Run (or the
 * API); "Publish as form page" gives it a page too (lib/services/form-pages).
 */

export function hasFormEntries(entries: WorkflowFormEntries | null | undefined): boolean {
  return Boolean(entries && (entries.trigger || entries.buttons.length || entries.start_form || entries.start_form_page?.page))
}

/** The list (trigger form, button forms, start form note). */
export function WorkflowFormLinks({ entries, workflowId }: { entries: WorkflowFormEntries; workflowId: string }) {
  return (
    <div className="space-y-2.5 text-xs" data-workflow-form-links>
      {entries.trigger && (
        <div className="space-y-1">
          <p className="font-medium" style={{ color: 'var(--theme-card-text)' }}>
            Starts when <span style={{ color: 'var(--theme-primary-text)' }}>{entries.trigger.form_name ?? 'the form'}</span> is submitted
            {entries.trigger.button_ids.length > 0 && <span className="font-normal" style={{ color: 'var(--theme-muted-text)' }}> (buttons: {entries.trigger.button_ids.join(', ')})</span>}
          </p>
          {entries.trigger.exists
            ? <FormPageLink formId={entries.trigger.form_id} />
            : <p style={{ color: 'var(--theme-warning)' }}>The trigger&apos;s form no longer exists.</p>}
        </div>
      )}
      {entries.buttons.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium" style={{ color: 'var(--theme-card-text)' }}>Started by a form button</p>
          {entries.buttons.map((b) => (
            <div key={`${b.form_id}-${b.button_label}`} className="space-y-0.5">
              <p style={{ color: 'var(--theme-muted-text)' }}>{b.form_name} › “{b.button_label}”</p>
              <FormPageLink formId={b.form_id} compact />
            </div>
          ))}
        </div>
      )}
      {(entries.start_form || entries.start_form_page?.page) && (
        <div className="space-y-1.5" data-start-form-entry>
          <p className="font-medium" style={{ color: 'var(--theme-card-text)' }}>Start form</p>
          <p style={{ color: 'var(--theme-muted-text)' }}>
            Opens from <strong>Run</strong> (and API / CLI starts) with the workflow inputs.
          </p>
          {entries.start_form_page && <StartFormPagePanel workflowId={workflowId} info={entries.start_form_page} />}
        </div>
      )}
    </div>
  )
}

/** "Form link" button with a small panel of the links (workflow page header, list rows). */
export function WorkflowFormLinkButton({ workflowId, compact = false, className }: { workflowId: string; compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  // The header asks up front (hidden when nothing starts the workflow); list rows ask on click.
  const { data: entries, isLoading } = useWorkflowFormEntries(workflowId, !compact || open)
  useEffect(() => {
    if (!open) return
    // A dialog opened from the panel (QR code, confirmations) is portalled outside it: clicks there keep the panel open.
    const inDialog = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('.dialog-content, .dialog-overlay, [data-form-qr-dialog]'))
    const dialogOpen = () => Boolean(document.querySelector('.dialog-content[data-state="open"]'))
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !inDialog(e.target)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !dialogOpen()) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  if (!compact && !hasFormEntries(entries)) return null
  return (
    <div ref={ref} className={`relative ${className ?? ''}`} onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
      <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-label={compact ? 'Form link' : undefined}
        title="The form page that starts this workflow" data-workflow-form-link-button
        className={compact ? '!h-7 !px-2 !text-[11px]' : '!h-7 !text-xs'}
        onClick={(e) => {
          // A fixed panel under the button, kept inside the window (list cards sit anywhere).
          const r = e.currentTarget.getBoundingClientRect()
          const width = Math.min(416, window.innerWidth * 0.9)
          setPos({ top: r.bottom + 4, left: Math.max(8, r.left + width <= window.innerWidth - 8 ? r.left : r.right - width) })
          setOpen((o) => !o)
        }}>
        <Link2 size={12} /> {compact ? '' : 'Form link'}
      </Button>
      {open && pos && (
        <div role="dialog" aria-label="Forms that start this workflow"
          className="fixed z-40 w-[min(26rem,90vw)] rounded-lg border p-3 shadow-lg"
          style={{ top: pos.top, left: pos.left, backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
          {isLoading ? <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>Loading…</p>
            : entries && hasFormEntries(entries) ? <WorkflowFormLinks entries={entries} workflowId={workflowId} />
            : <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>No form starts this workflow.</p>}
        </div>
      )}
    </div>
  )
}
