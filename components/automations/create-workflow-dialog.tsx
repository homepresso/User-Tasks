'use client'

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { createWorkflow } from '@/app/actions/automations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { BusyBar } from '@/components/ui/busy-bar'
import { Loader2, Plus, X } from 'lucide-react'

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
]

export function CreateWorkflowDialog() {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [triggerType, setTriggerType] = useState('task_created')

  async function handleSubmit(formData: FormData) {
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
      setError('Could not create the automation. Please try again.')
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button size="sm"><Plus size={16} className="mr-1" /> New Automation</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(28rem,92vw)] rounded-lg p-6 shadow-xl" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">New Automation</Dialog.Title>
            <Dialog.Close><X size={18} /></Dialog.Close>
          </div>
          <form action={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <Input name="name" required placeholder="e.g. Auto-assign high priority tasks" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Trigger</label>
              {/* Hidden input keeps the form-submitted trigger_type field intact */}
              <input type="hidden" name="trigger_type" value={triggerType} />
              <AutocompleteSelect
                value={triggerType}
                onChange={setTriggerType}
                options={TRIGGER_TYPE_OPTIONS}
                size="md"
              />
            </div>
            {error && <p role="alert" className="text-sm" style={{ color: 'var(--theme-danger)' }}>{error}</p>}
            {saving && <BusyBar label="Creating your automation and opening the builder…" />}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild><Button type="button" variant="outline" disabled={saving}>Cancel</Button></Dialog.Close>
              <Button type="submit" disabled={saving}>
                {saving ? (<><Loader2 size={14} className="mr-1.5 animate-spin" /> Creating…</>) : 'Create'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
