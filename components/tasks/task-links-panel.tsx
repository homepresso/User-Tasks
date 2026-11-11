'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, Plus, X } from 'lucide-react'
import { serverQuery, serverRead } from '@/lib/server-read'
import { addTaskDependency, removeTaskDependency } from '@/app/actions/task-dependencies'
import { Badge, StatusPill } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { IconButton } from '@/components/ui/icon-button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { SearchInput } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Task detail panel: blocking dependencies in both directions. "Blocked" is
 * derived — shown here and as badges in lists; completion shows a
 * warn-with-override. `readOnly` (an invited viewer): the links only.
 */
export function TaskLinksPanel({ taskId, readOnly = false }: { taskId: string; readOnly?: boolean }) {
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
    <Card padding="none" data-task-dependencies>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Dependencies
            {openBlockers.length > 0 && (
              <Badge tone="danger"><Lock className="size-3" aria-hidden /> Blocked by {openBlockers.length}</Badge>
            )}
          </span>
        }
      />
      <div className="space-y-3 px-4 pb-4">
        {!readOnly && <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="secondary" leadingIcon={<Plus />} aria-pressed={depPickerFor === 'blockedBy'}
            onClick={() => { setDepPickerFor(depPickerFor === 'blockedBy' ? null : 'blockedBy') }}>
            Blocked by
          </Button>
          <Button size="sm" variant="secondary" leadingIcon={<Plus />} aria-pressed={depPickerFor === 'blocks'}
            onClick={() => { setDepPickerFor(depPickerFor === 'blocks' ? null : 'blocks') }}>
            Blocks
          </Button>
        </div>}

        {error && <InlineNotice tone="danger">{error}</InlineNotice>}

        {depPickerFor && !readOnly && (
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
          <p className="text-ui text-fg-muted">
            {readOnly ? 'No blocking dependencies.' : 'Standalone task — add blocking dependencies if it waits on other work.'}
          </p>
        )}

        {(deps?.blockedBy?.length ?? 0) > 0 && (
          <DepList
            label="Blocked by"
            items={deps!.blockedBy}
            onRemove={readOnly ? undefined : (id) => run(() => removeTaskDependency(taskId, id))}
          />
        )}
        {(deps?.blocks?.length ?? 0) > 0 && (
          <DepList
            label="Blocks"
            items={deps!.blocks}
            onRemove={readOnly ? undefined : (id) => run(() => removeTaskDependency(id, taskId))}
          />
        )}
      </div>
    </Card>
  )
}

function DepList({ label, items, onRemove }: {
  label: string
  items: Array<{ id: string; title: string; status: string }>
  onRemove?: (id: string) => void
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-fg-muted">{label}</p>
      <ul className="space-y-0.5">
        {items.map((t) => {
          const done = ['completed', 'cancelled'].includes(t.status)
          return (
            <li key={t.id} className="group/dep flex min-h-8 items-center gap-2 text-ui">
              <Link href={`/tasks/${t.id}`} className={cn('min-w-0 flex-1 truncate text-fg hover:underline', done && 'text-fg-muted line-through')}>
                {t.title}
              </Link>
              <StatusPill status={t.status} />
              {onRemove && <IconButton size="sm" label="Remove link" icon={<X />} onClick={() => onRemove(t.id)} />}
            </li>
          )
        })}
      </ul>
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
    <Card variant="inset" padding="sm">
      <SearchInput autoFocus value={search} onValueChange={setSearch} placeholder="Search tasks…" aria-label="Search tasks" className="mb-1" />
      <div className="max-h-40 space-y-0.5 overflow-y-auto">
        {results.map((r: any) => (
          <button key={r.id} type="button" disabled={busy}
            onClick={async () => { setBusy(true); try { await onPick(r.id) } finally { setBusy(false) } }}
            className="block w-full truncate rounded-md px-2 py-1.5 text-left text-ui text-fg hover:bg-muted disabled:opacity-50">
            {r.label}
          </button>
        ))}
        {results.length === 0 && <p className="px-2 py-1 text-ui text-fg-muted">No matches</p>}
      </div>
    </Card>
  )
}
