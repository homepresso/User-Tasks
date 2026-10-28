'use client'

import { useState, useEffect, useRef } from 'react'
import { logTimerEntry } from '@/app/actions/task-effort'
import { Button } from '@/components/ui/button'
import { Play, Pause, Square, Clock } from 'lucide-react'
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
  }

  function formatTime(secs: number): string {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const isActive = running || elapsed > 0

  return (
    <div
      className="fixed bottom-6 right-6 z-40 rounded-2xl shadow-2xl border overflow-hidden"
      style={{
        backgroundColor: 'var(--theme-card-bg)',
        borderColor: running ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
        boxShadow: running ? `0 0 20px var(--theme-primary)30` : undefined,
      }}
    >
      <div className="px-4 py-3 flex items-center gap-3">
        {/* Timer display */}
        <div className="flex items-center gap-2">
          <Clock size={16} style={{ color: running ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}
            className={running ? 'animate-pulse' : ''} />
          <span className="text-lg font-mono font-bold tabular-nums" style={{ minWidth: '60px' }}>
            {formatTime(elapsed)}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          {!isActive && (
            <Button size="sm" onClick={handleStart} className="!rounded-full !w-8 !h-8 !p-0">
              <Play size={14} />
            </Button>
          )}
          {running && (
            <Button size="sm" variant="outline" onClick={handlePause} className="!rounded-full !w-8 !h-8 !p-0">
              <Pause size={14} />
            </Button>
          )}
          {!running && elapsed > 0 && (
            <Button size="sm" onClick={handleResume} className="!rounded-full !w-8 !h-8 !p-0">
              <Play size={14} />
            </Button>
          )}
          {elapsed > 0 && (
            <Button size="sm" variant="outline" onClick={handleStop} disabled={saving}
              className="!rounded-full !w-8 !h-8 !p-0" style={{ color: 'var(--theme-danger)' }}>
              <Square size={12} />
            </Button>
          )}
        </div>

        {saved && (
          <span className="text-[10px] font-medium" style={{ color: 'var(--theme-success)' }}>Saved!</span>
        )}
        {error && (
          <span className="text-[10px] font-medium max-w-[160px] truncate" title={error} style={{ color: 'var(--theme-danger)' }}>{error}</span>
        )}
      </div>
    </div>
  )
}
