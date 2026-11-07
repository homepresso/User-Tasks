'use client'

import { useState } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { logManualEffort } from '@/app/actions/task-effort'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Clock, Plus, Check } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

interface ManualEffortEntryProps {
  taskId: string
  tenantId?: string
  /** After an entry is saved (the task lists' detail panel refreshes itself). */
  onLogged?: (minutes: number) => void
}

export function ManualEffortEntry({ taskId, onLogged }: ManualEffortEntryProps) {
  const [open, setOpen] = useState(false)
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [saving, setSaving] = useState(false)
  // Synchronous guard: a double click / Enter would log the effort twice.
  const logGuard = useSubmitGuard()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  function buildEntryTimestamp(dateValue: string) {
    if (!dateValue) return new Date().toISOString()
    const now = new Date()
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`
    return new Date(`${dateValue}T${time}`).toISOString()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await logGuard.run(async () => {
      const h = parseFloat(hours || '0')
      const m = parseFloat(minutes || '0')
      const totalMinutes = Math.round(h * 60 + m)
      if (totalMinutes <= 0) return

      setSaving(true)
      setError(null)
      // Records the entry, adds it to the task's actual effort and logs it on
      // the activity timeline (lib/services/task-effort).
      const result = await logManualEffort(taskId, {
        hours: h,
        minutes: m,
        notes: notes || null,
        logDate: date || null,
        entryAt: buildEntryTimestamp(date),
      })
      if (!result.ok) {
        setSaving(false)
        setError(result.error)
        return
      }

      queryClient.invalidateQueries({ queryKey: ['task-tree', taskId] })
      queryClient.invalidateQueries({ queryKey: ['task-detail', taskId] })
      queryClient.invalidateQueries({ queryKey: ['effort-entries', taskId] })
      onLogged?.(totalMinutes)
      setSaving(false)
      setSaved(true)
      setHours('')
      setMinutes('')
      setNotes('')
      setOpen(false)
      setTimeout(() => setSaved(false), 3000)
    })
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} leadingIcon={<Plus />} data-log-effort>
          Log effort
        </Button>
        {saved && <span className="text-xs font-medium text-success" role="status">Effort logged</span>}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" data-log-effort-form>
      <p className="flex items-center gap-2 text-ui font-semibold text-fg">
        <Clock className="size-4 text-fg-muted" aria-hidden />
        Log effort
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Hours">
          <Input type="number" step="0.5" min="0" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="0" autoFocus />
        </Field>
        <Field label="Minutes">
          <Input type="number" step="5" min="0" max="59" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>

      <Field label="Notes" optional>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you work on?" />
      </Field>

      {error && <InlineNotice tone="danger">{error}</InlineNotice>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={saving} disabled={!hours && !minutes} leadingIcon={<Check />}>
          {saving ? 'Saving…' : 'Log effort'}
        </Button>
      </div>
    </form>
  )
}
