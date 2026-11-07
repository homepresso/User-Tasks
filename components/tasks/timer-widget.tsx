'use client'

import { useState, useEffect, useRef } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { logTimerEntry } from '@/app/actions/task-effort'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Play, Pause, Square } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

interface TimerWidgetProps {
  taskId: string
  tenantId: string
}

export function TimerWidget({ taskId }: TimerWidgetProps) {
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0) // seconds
  const [startTime, setStartTime] = useState<Date | null>(null)
  const [saving, setSaving] = useState(false)
  // Synchronous guard: a double click on Stop would log the time twice.
  const stopGuard = useSubmitGuard()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setElapsed(prev => prev + 1)
      }, 1000)
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running])

  function handleStart() {
    setStartTime(new Date())
    setRunning(true)
    setSaved(false)
    setError(null)
  }

  function handlePause() {
    setRunning(false)
  }

  function handleResume() {
    setRunning(true)
  }

  async function handleStop() {
    await stopGuard.run(async () => {
      setRunning(false)
      if (elapsed < 5) return // Don't save less than 5 seconds

      setSaving(true)
      // Records the timer entry, adds it to the task's actual effort and logs
      // it on the activity timeline (lib/services/task-effort).
      const result = await logTimerEntry(taskId, { elapsedSeconds: elapsed, startedAt: startTime?.toISOString() ?? null })
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
      setElapsed(0)
      setStartTime(null)
      setTimeout(() => setSaved(false), 3000)
    })
  }

  function formatTime(secs: number): string {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const isActive = running || elapsed > 0

  // Lives in the Effort card header: "Start timer", then the elapsed time with pause / resume and stop.
  return (
    <div className="flex items-center gap-1" data-task-timer data-running={running || undefined}>
      {isActive && (
        <span className={cn('num mr-1 inline-flex items-center gap-1.5 font-mono text-ui font-medium', running ? 'text-fg' : 'text-fg-muted')} aria-live="off">
          <span aria-hidden className={cn('size-1.5 rounded-full', running ? 'animate-pulse bg-primary' : 'bg-fg-subtle')} />
          {formatTime(elapsed)}
        </span>
      )}
      {!isActive && (
        <Button size="sm" variant="secondary" onClick={handleStart} leadingIcon={<Play />} data-timer-start>
          Start timer
        </Button>
      )}
      {running && <IconButton size="sm" variant="secondary" label="Pause timer" icon={<Pause />} onClick={handlePause} />}
      {!running && elapsed > 0 && <IconButton size="sm" variant="secondary" label="Resume timer" icon={<Play />} onClick={handleResume} />}
      {elapsed > 0 && (
        <IconButton size="sm" variant="secondary" label="Stop and log time" icon={<Square />} onClick={handleStop} loading={saving} className="text-danger" />
      )}
      {saved && <span className="text-xs font-medium text-success" role="status">Time logged</span>}
      {error && (
        <Tooltip content={error}>
          <span className="max-w-[160px] truncate text-xs font-medium text-danger" role="alert" tabIndex={0}>{error}</span>
        </Tooltip>
      )}
    </div>
  )
}
