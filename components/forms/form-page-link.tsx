'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { serverRead } from '@/lib/server-read'
import { formPagePath } from '@/lib/forms/workflow-start-form'
import { publicFormPageUrl } from '@/lib/forms/form-page-url'
import type { WorkflowFormEntries } from '@/lib/services/workflow-start-form'
import { FormQrButton } from './form-qr-dialog'

/**
 * A form page URL (/f/<id>, absolute: the public app URL) with Copy link,
 * Open form and QR code — the workflow page "Form link" panel, list rows,
 * the Form submitted trigger settings and the form page of a start form.
 */
export function FormPageLink({ formId, compact = false }: { formId: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false)
  const url = publicFormPageUrl(formId)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" data-form-page-link={formId}>
      <code className={`min-w-0 basis-full break-all rounded px-1.5 py-0.5 font-mono ${compact ? 'text-[10px]' : 'text-[11px]'} select-all`}
        style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)' }} title={url}>
        {url}
      </code>
      <button type="button" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium hover:opacity-80"
        style={{ color: copied ? 'var(--theme-success)' : 'var(--theme-primary-text)' }}
        onClick={async (e) => {
          e.preventDefault(); e.stopPropagation()
          try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
        }}
        aria-label="Copy the form link" data-copy-form-link>
        {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy link'}
      </button>
      <a href={formPagePath(formId)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium hover:opacity-80" style={{ color: 'var(--theme-primary-text)' }}>
        <ExternalLink size={11} /> Open form
      </a>
      <FormQrButton formId={formId} compact />
    </div>
  )
}

export function useWorkflowFormEntries(workflowId: string, enabled = true) {
  return useQuery({
    queryKey: ['workflow-form-entries', workflowId],
    enabled,
    staleTime: 30_000,
    queryFn: async () => (await serverRead('automations.workflowForms', { workflow_id: workflowId })).data as WorkflowFormEntries | null,
  })
}
