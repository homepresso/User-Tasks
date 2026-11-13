'use client'

/**
 * Run a contributed action (`target: { action }`) from any surface: menus,
 * row actions, the palette, settings buttons and custom pages. Shows the
 * result as a toast, follows a redirect and refreshes when asked. Actions
 * with `confirm` text ask first (ConfirmDialog, rendered by the caller via
 * `confirmDialog`).
 */

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useJobs } from '@/components/jobs/jobs-provider'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { runExtensionUiAction } from '@/app/actions/extensions'

export interface ExtensionActionRequest {
  extensionId: string
  action: string
  label?: string
  confirm?: string
  objectType?: string | null
  items?: Array<Record<string, unknown>>
  values?: Record<string, unknown>
  settings?: { page: string; values: Record<string, unknown> }
}

export function useExtensionAction() {
  const router = useRouter()
  const jobs = useJobs()
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<ExtensionActionRequest | null>(null)

  const execute = useCallback(async (request: ExtensionActionRequest) => {
    setBusy(true)
    try {
      const result = await runExtensionUiAction(request)
      if (!result.ok) {
        jobs.notify({ tone: 'error', title: request.label ? `${request.label} failed` : 'Action failed', body: result.error })
        return null
      }
      const out = result.data
      if (out.message) jobs.notify({ tone: out.tone === 'danger' || out.tone === 'warning' ? 'error' : out.tone === 'success' ? 'success' : 'info', title: out.message })
      if (out.redirect) router.push(out.redirect)
      else if (out.refresh) router.refresh()
      return out
    } finally {
      setBusy(false)
    }
  }, [jobs, router])

  /** Run now, or ask first when the request has confirm text. */
  const run = useCallback((request: ExtensionActionRequest) => {
    if (request.confirm) setPending(request)
    else void execute(request)
  }, [execute])

  const confirmDialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => { if (!open) setPending(null) }}
      title={pending?.label ?? 'Run action?'}
      description={pending?.confirm ?? ''}
      confirmLabel={pending?.label ?? 'Run'}
      busy={busy}
      onConfirm={async () => {
        const request = pending
        if (!request) return
        await execute(request)
        setPending(null)
      }}
    />
  )

  return { run, execute, busy, confirmDialog }
}
