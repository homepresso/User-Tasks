'use client'

import { useState } from 'react'
import { logManualEffort } from '@/app/actions/task-effort'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Clock, Plus, Check } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

interface ManualEffortEntryProps {
  taskId: string
  tenantId: string
}

export function ManualEffortEntry({ taskId }: ManualEffortEntryProps) {
  const [open, setOpen] = useState(false)
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [saving, setSaving] = useState(false)
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
    setSaving(false)
    setSaved(true)
    setHours('')
    setMinutes('')
    setNotes('')
    setOpen(false)
    setTimeout(() => setSaved(false), 3000)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed
          border-gray-200 dark:border-gray-700 py-3 px-4
          hover:border-[color:var(--theme-accent)] hover:bg-[color:var(--theme-primary-light)]/50 dark:hover:border-[color:var(--theme-primary)] dark:hover:bg-[color:var(--theme-accent-light)]
          transition-all group"
      >
        <Clock size={16} className="text-gray-400 group-hover:text-[color:var(--theme-card-text)] transition-colors" />
        <span className="text-sm font-medium text-gray-500 group-hover:text-[color:var(--theme-card-text)] transition-colors">
          {saved ? '✓ Effort logged!' : 'Log Effort'}
        </span>
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit}
      className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3"
      style={{ backgroundColor: 'var(--theme-card-bg)' }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Clock size={16} style={{ color: 'var(--theme-primary-text)' }} />
        <p className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>
          Log Effort
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--theme-muted-text)' }}>
            Hours
          </label>
          <Input
            type="number"
            step="0.5"
            min="0"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="0"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--theme-muted-text)' }}>
            Minutes
          </label>
          <Input
            type="number"
            step="5"
            min="0"
            max="59"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="0"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--theme-muted-text)' }}>
            Date
          </label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--theme-muted-text)' }}>
          Notes <span style={{ color: 'var(--theme-muted-text)' }}>(optional)</span>
        </label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What did you work on?"
        />
      </div>

      {error && (
        <p className="text-xs" style={{ color: 'var(--theme-danger)' }}>{error}</p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving || (!hours && !minutes)}>
          {saving ? 'Saving...' : (
            <>
              <Check size={14} className="mr-1" />
              Log Effort
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
