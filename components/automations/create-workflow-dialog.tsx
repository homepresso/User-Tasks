'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import { createWorkflow } from '@/app/actions/automations'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { BusyBar } from '@/components/ui/busy-bar'
import { Plus } from 'lucide-react'

const TRIGGER_TYPE_OPTIONS = [
  { value: 'task_created', label: 'When a task is created' },
  { value: 'task_received', label: 'When a task is received (in queue)' },
  { value: 'task_submitted', label: 'When a task is submitted (accepted)' },
  { value: 'task_updated', label: 'When a task is updated' },
  { value: 'task_completed', label: 'When a task is completed' },
  { value: 'task_rejected', label: 'When a task is rejected' },
  { value: 'workflow_error', label: 'When a workflow fails' },
  { value: 'retention_policy_review', label: 'When a policy review becomes due' },
  { value: 'retention_policy_executed', label: 'When a policy action is executed' },
  { value: 'data_table_event', label: 'When a data table row changes' },
  { value: 'form_submitted', label: 'When a form is submitted' },
  { value: 'middleware_received', label: 'Middleware webhook with response' },
  { value: 'schedule', label: 'On a schedule' },
  { value: 'webhook_received', label: 'When a webhook is received' },
  { value: 'esign_event', label: 'When an e-signature envelope changes' },
]

export function CreateWorkflowDialog() {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [triggerType, setTriggerType] = useState('task_created')
  // React 19 renders state set inside a form action only when the action ends,
  // so `saving` alone can't stop a second click: guard synchronously too.
  const submittingRef = useRef(false)

  // The shell's "+ New" menu and ⌘K link to /automations?new=1: open the dialog, then drop the param.
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    setOpen(true) // eslint-disable-line react-hooks/set-state-in-effect -- one-shot deep link
    const next = new URLSearchParams(searchParams.toString())
    next.delete('new')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [searchParams, router, pathname])

  async function handleSubmit(formData: FormData) {
    if (submittingRef.current) return
    submittingRef.current = true
    setError(null)
    setSaving(true)
    try {
      // Creation + revalidate + redirect into the builder takes a few seconds —
      // the dialog stays open showing progress until navigation unmounts it.
      await createWorkflow(formData)
      setOpen(false)
    } catch (err) {
      // A successful server action ends in redirect(), which throws internally
      // and is handled by Next — only reset on real failures.
      if (err && typeof err === 'object' && String((err as any).digest ?? '').startsWith('NEXT_REDIRECT')) throw err
      setError('Could not create the workflow. Please try again.')
      setSaving(false)
      submittingRef.current = false
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button leadingIcon={<Plus />}>New workflow</Button>
      </DialogTrigger>
      <DialogContent size="md" title="New workflow">
        <form action={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-4">
            <Field label="Name">
              <Input name="name" required placeholder="e.g. Auto-assign high priority tasks" />
            </Field>
            {/* Hidden input keeps the form-submitted trigger_type field intact */}
            <input type="hidden" name="trigger_type" value={triggerType} />
            <Field label="Trigger">
              <Select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} options={TRIGGER_TYPE_OPTIONS} />
            </Field>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          </DialogBody>
          <SubmitRow saving={saving} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Uses the form's own pending state, which React 19 shows while the action runs. */
function SubmitRow({ saving }: { saving: boolean }) {
  const { pending } = useFormStatus()
  const busy = pending || saving
  return (
    <>
      {busy && <div className="px-6 pb-4"><BusyBar label="Creating your workflow and opening the builder…" /></div>}
      <DialogFooter>
        <DialogClose asChild><Button type="button" variant="secondary" disabled={busy}>Cancel</Button></DialogClose>
        <Button type="submit" loading={busy}>{busy ? 'Creating…' : 'Create workflow'}</Button>
      </DialogFooter>
    </>
  )
}
