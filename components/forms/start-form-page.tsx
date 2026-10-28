'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FileUp, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { usePermissions } from '@/lib/permissions-context'
import { publishStartFormPage, syncStartFormPage, unpublishStartFormPage } from '@/app/actions/form-pages'
import type { StartFormPageInfo } from '@/lib/services/form-pages'
import { FormPageLink, useWorkflowFormEntries } from '@/components/automations/workflow-form-links'

/**
 * "Publish as form page" for a workflow's START form (lib/services/form-pages):
 * a reusable form whose Submit starts this workflow with the fields mapped
 * to its inputs. The workflow itself is unchanged (Run, API and CLI starts
 * keep working). Once published: the page link (Copy / Open / QR), the sync
 * state ("Start form changed — update form page?"), and Unpublish.
 */
export function StartFormPagePanel({ workflowId, info, compact = false }: { workflowId: string; info: StartFormPageInfo; compact?: boolean }) {
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const [confirm, setConfirm] = useState<'overwrite' | 'unpublish' | null>(null)
  const canPublish = can('forms.edit') && can('workflows.activate')
  const canUnpublish = can('forms.delete')
  const page = info.page

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['workflow-form-entries', workflowId] }),
    queryClient.invalidateQueries({ queryKey: ['forms-library'] }),
    queryClient.invalidateQueries({ queryKey: ['form'] }),
  ])

  async function act(run: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, success: string) {
    setBusy(true); setMessage(null)
    try {
      const result = await run()
      setMessage(result.ok ? { tone: 'success', text: success } : { tone: 'error', text: result.error })
      await refresh()
    } finally { setBusy(false); setConfirm(null) }
  }

  if (!page && !info.eligible) return null
  const muted = { color: 'var(--theme-muted-text)' }
  const text = compact ? 'text-[10px]' : 'text-xs'

  return (
    <div className={`space-y-1.5 ${text}`} data-start-form-page={page ? page.status : 'unpublished'} onClick={(e) => e.stopPropagation()}>
      {page ? (
        <>
          <p className="font-medium" style={{ color: 'var(--theme-card-text)' }}>
            Published as form page: <span className="font-mono" style={{ color: 'var(--theme-primary-text)' }}>{page.path}</span>
          </p>
          <p style={muted}>{page.form_name} · v{page.version}</p>
          <FormPageLink formId={page.form_id} compact={compact} />
          {(page.status === 'start_form_changed' || page.status === 'both_changed') && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5" style={{ borderColor: 'var(--theme-warning)', backgroundColor: 'var(--theme-surface)' }} data-start-form-changed>
              <AlertTriangle size={12} style={{ color: 'var(--theme-warning)' }} aria-hidden />
              <span className="flex-1" style={{ color: 'var(--theme-card-text)' }}>
                Start form changed — update form page?
                {page.status === 'both_changed' && <span style={muted}> The form page was also edited; updating replaces those edits.</span>}
              </span>
              {canPublish && (
                <Button type="button" size="sm" variant="outline" className="!h-6 !px-2 !text-[11px]" disabled={busy} data-sync-form-page
                  onClick={() => (page.status === 'both_changed' ? setConfirm('overwrite') : void act(() => syncStartFormPage(workflowId), 'Form page updated (new form version)'))}>
                  <RefreshCw size={11} /> Update form page
                </Button>
              )}
            </div>
          )}
          {page.status === 'form_edited' && (
            <p style={muted} data-form-page-edited>
              The form page was edited in the Forms library (fields, layout, theme or input mapping); it keeps those edits.
              {canPublish && <> <button type="button" className="underline underline-offset-2" style={{ color: 'var(--theme-primary-text)' }} onClick={() => setConfirm('overwrite')}>Reset it to the start form</button></>}
            </p>
          )}
          {!info.workflow_active && <p style={{ color: 'var(--theme-warning)' }}>The workflow is inactive: submissions can&apos;t start runs until it is activated.</p>}
          {canUnpublish && (
            <button type="button" className="inline-flex items-center gap-1 text-[10px] font-medium hover:opacity-80" style={{ color: 'var(--status-blocked)' }} disabled={busy} onClick={() => setConfirm('unpublish')} data-unpublish-form-page>
              <Trash2 size={11} /> Unpublish
            </button>
          )}
        </>
      ) : (
        <>
          <p style={muted}>
            Give this start form a shareable page: a reusable form whose Submit starts this workflow with the fields mapped to its inputs, as the person who submits. Run, API and CLI starts keep working.
          </p>
          {info.skipped.length > 0 && <p style={{ color: 'var(--theme-warning)' }}>Left off the page (names a form can&apos;t map): {info.skipped.join(', ')}</p>}
          <Button type="button" size="sm" variant="outline" className={compact ? '!h-7 !text-[11px]' : '!h-7 !text-xs'} disabled={busy || !canPublish} data-publish-form-page
            title={canPublish ? 'Create a reusable form from the start form' : "Needs the 'forms.edit' and 'workflows.activate' permissions"}
            onClick={() => void act(() => publishStartFormPage(workflowId), 'Published as a form page')}>
            <FileUp size={12} /> {busy ? 'Publishing…' : 'Publish as form page'}
          </Button>
        </>
      )}
      {message && <p role="status" style={{ color: message.tone === 'error' ? 'var(--status-blocked)' : 'var(--theme-success)' }}>{message.text}</p>}
      <ConfirmDialog
        open={confirm === 'overwrite'}
        onOpenChange={(open) => { if (!open) setConfirm(null) }}
        title="Replace the form page's edits?"
        description="The form page's fields, layout, theme and input mapping were edited since it was published. Updating copies the start form over them (a new form version; earlier versions are kept). Its header, labels and success screen stay as they are."
        confirmLabel="Update form page"
        busy={busy}
        onConfirm={() => act(() => syncStartFormPage(workflowId, true), 'Form page updated from the start form')}
      />
      <ConfirmDialog
        open={confirm === 'unpublish'}
        onOpenChange={(open) => { if (!open) setConfirm(null) }}
        title="Unpublish the form page?"
        description={page ? `"${page.form_name}", its versions and its submissions are deleted, and ${page.path} stops working. A form that a workflow step still uses can't be deleted. The workflow and its start form are not changed.` : ''}
        confirmLabel="Unpublish"
        destructive
        busy={busy}
        onConfirm={() => act(() => unpublishStartFormPage(workflowId), 'Form page unpublished')}
      />
    </div>
  )
}

/** The panel with its data (designer: start form settings, trigger node settings). */
export function StartFormPageSection({ workflowId }: { workflowId: string }) {
  const { data } = useWorkflowFormEntries(workflowId)
  const info = data?.start_form_page
  if (!info || (!info.page && !info.eligible)) return null
  return (
    <div className="space-y-1 rounded-lg p-2.5" style={{ backgroundColor: 'var(--theme-surface)' }} data-testid="start-form-page-section">
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>Form page</p>
      <StartFormPagePanel workflowId={workflowId} info={info} compact />
      <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Follows the start form of the published version: publish the workflow, then update the page.</p>
    </div>
  )
}
