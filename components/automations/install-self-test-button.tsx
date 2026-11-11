'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FlaskConical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { installKitchenSinkAction } from '@/app/actions/kitchen-sink'

const DESCRIPTION = 'Adds the "Kitchen sink — platform self-test" workflow with its sub-workflow, a scratch data table, a decision table, a form, a test role and a custom action (or updates them if they are already installed). Run it to check every built-in step works — see Docs → Workflows → Platform self-test.'

/**
 * Settings → General (admins): install the kitchen sink self-test through the
 * normal config import, then open the workflow.
 */
export function InstallSelfTestButton({ onInstalled }: { onInstalled?: () => void }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function install() {
    setBusy(true)
    setError(null)
    try {
      const result = await installKitchenSinkAction()
      if (!result.ok) { setError(result.error); return }
      if (result.errors.length) { setError(result.errors.join('; ')); return }
      setOpen(false)
      onInstalled?.()
      if (result.workflow_id) router.push(`/automations/${result.workflow_id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" leadingIcon={<FlaskConical />} onClick={() => { setError(null); setOpen(true) }} data-testid="install-self-test">
        Install self-test
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Install the kitchen sink self-test?"
        description={error ? `Could not install: ${error}` : DESCRIPTION}
        confirmLabel={error ? 'Try again' : 'Install'}
        busy={busy}
        onConfirm={install}
      />
    </>
  )
}
