'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Lock, Plus, X } from 'lucide-react'
import { serverQuery, serverRead } from '@/lib/server-read'
import { addTaskDependency, removeTaskDependency } from '@/app/actions/task-dependencies'

/**
 * Task detail panel: blocking dependencies in both directions. "Blocked" is
 * derived — shown here and as badges in lists; completion shows a
 * warn-with-override.
 */
export function TaskLinksPanel({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient()
  const [depPickerFor, setDepPickerFor] = useState<'blockedBy' | 'blocks' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: deps } = useQuery({
    queryKey: ['task-deps', taskId],
    queryFn: () => serverQuery('tasks.dependencies', { taskId }),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['task-deps', taskId] })
  }

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try { await fn(); refresh() } catch (e: any) { setError(e?.message ?? 'Action failed') }
  }

  const openBlockers = (deps?.blockedBy ?? []).filter((t) => !['completed', 'cancelled'].includes(t.status))
  const hasAnything = (deps?.blockedBy?.length ?? 0) > 0 || (deps?.blocks?.length ?? 0) > 0

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>
          <Link2 size={14} style={{ color: 'var(--theme-primary-text)' }} /> Dependencies
          {openBlockers.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ backgroundColor: 'var(--status-blocked-bg)', color: 'var(--status-blocked)' }}>
              <Lock size={10} /> Blocked by {openBlockers.length}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={() => { setDepPickerFor(depPickerFor === 'blockedBy' ? null : 'blockedBy') }}
            className="rounded-lg border px-2 py-1 text-[11px] font-medium hover:opacity-80"
            style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
            <Plus size={11} className="mr-1 inline" /> Blocked by
          </button>
          <button onClick={() => { setDepPickerFor(depPickerFor === 'blocks' ? null : 'blocks') }}
            className="rounded-lg border px-2 py-1 text-[11px] font-medium hover:opacity-80"
            style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
            <Plus size={11} className="mr-1 inline" /> Blocks
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-xs" style={{ color: 'var(--status-blocked)' }}>{error}</p>}

      {depPickerFor && (
        <TaskPicker
          excludeTaskId={taskId}
          onPick={async (id) => {
            if (depPickerFor === 'blockedBy') await run(() => addTaskDependency(taskId, id))
            else await run(() => addTaskDependency(id, taskId))
            setDepPickerFor(null)
          }}
        />
      )}

      {!hasAnything && !depPickerFor && (
        <p className="mt-2 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
          Standalone task — add blocking dependencies if it waits on other work.
        </p>
      )}

      {(deps?.blockedBy?.length ?? 0) > 0 && (
        <DepList
          label="Blocked by"
          items={deps!.blockedBy}
          onRemove={(id) => run(() => removeTaskDependency(taskId, id))}
        />
      )}
      {(deps?.blocks?.length ?? 0) > 0 && (
        <DepList
          label="Blocks"
          items={deps!.blocks}
          onRemove={(id) => run(() => removeTaskDependency(id, taskId))}
        />
      )}
    </div>
  )
}

function DepList({ label, items, onRemove }: {
  label: string
  items: Array<{ id: string; title: string; status: string }>
  onRemove: (id: string) => void
}) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>{label}</p>
      <div className="space-y-1">
        {items.map((t) => {
          const done = ['completed', 'cancelled'].includes(t.status)
          return (
            <div key={t.id} className="flex items-center gap-2 text-xs">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: done ? 'var(--status-done)' : 'var(--status-blocked)' }} />
              <Link href={`/tasks/${t.id}`} className={`min-w-0 flex-1 truncate hover:underline ${done ? 'line-through opacity-60' : ''}`}
                style={{ color: 'var(--theme-card-text)' }}>
                {t.title}
              </Link>
              <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{t.status}</span>
              <button onClick={() => onRemove(t.id)} className="rounded p-0.5 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }} title="Remove link">
                <X size={11} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TaskPicker({ excludeTaskId, onPick }: {
  excludeTaskId: string
  onPick: (id: string) => void | Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: results = [] } = useQuery({
    queryKey: ['task-dependency-picker', excludeTaskId, search],
    queryFn: async () => (await serverRead('tasks.dependencyCandidates', { excludeTaskId, search })).data ?? [],
  })

  return (
    <div className="mt-3 rounded-lg border p-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search tasks…"
        className="mb-1 w-full rounded-lg border px-3 py-1.5 text-sm outline-none"
        style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
      />
      <div className="max-h-40 space-y-0.5 overflow-y-auto">
        {results.map((r: any) => (
          <button key={r.id} disabled={busy}
            onClick={async () => { setBusy(true); try { await onPick(r.id) } finally { setBusy(false) } }}
            className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--theme-row-highlight)] disabled:opacity-50"
            style={{ color: 'var(--theme-card-text)' }}>
            {r.label}
          </button>
        ))}
        {results.length === 0 && <p className="px-2 py-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>No matches.</p>}
      </div>
    </div>
  )
}
