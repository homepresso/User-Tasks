'use client'

/**
 * The embeddable task list (/embed/tasks, lib/embed/task-list.ts): the
 * signed-in person's tasks inside a frame on an approved site, with the row
 * actions the app offers (outcome buttons, Accept / Decline, Claim /
 * Unclaim) and the task page itself in a dialog (/embed/task/<id>) or a new
 * tab. Seamless in a host page: the first page is server-rendered, nothing
 * shows "Loading…", refreshes keep the rows in place, the height follows the
 * content (EmbedFrame → usertasks:resize / the add-in part message).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { actOnEmbedTask, listEmbedTasks, type EmbedTaskAction } from '@/app/actions/embed-tasks'
import type { EmbedTask, EmbedTaskList } from '@/lib/services/embed-tasks'
import { outcomeAsksComment, outcomeButtonLabel, type TaskListOptions } from '@/lib/embed/task-list'
import { isTaskEventMessage, postToHost, taskEventMessage } from '@/lib/embed/host-messages'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatusBadge } from '@/components/ui/status-badge'
import { PriorityBadge } from '@/components/ui/priority-badge'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

const VIEW_LABELS = { mine: 'Mine', groups: 'My groups', all: 'All' } as const
/** The dialog needs room: the frame grows to at least this while it is open. */
const DIALOG_MIN_HEIGHT = 680

function dueText(due: string | null): string | null {
  if (!due) return null
  const d = new Date(due)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000)
  if (diff === 0) return 'Due today'
  if (diff === 1) return 'Due tomorrow'
  if (diff === -1) return 'Due yesterday'
  return `Due ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })}`
}

interface Pending { taskId: string; kind: 'outcome' | 'decline'; outcome?: string }

export function EmbedTaskList({ initialOptions, initial, keep }: {
  initialOptions: TaskListOptions
  initial: EmbedTaskList | null
  /** Host parameters kept on links back here (ut_org, SenderId …). */
  keep: Record<string, string>
}) {
  const [options, setOptions] = useState(initialOptions)
  const [list, setList] = useState<EmbedTaskList | null>(initial)
  const [error, setError] = useState<string | null>(initial ? null : 'Your tasks could not be loaded.')
  const [refreshing, startRefresh] = useTransition()
  const [search, setSearch] = useState(initialOptions.q)
  const [busy, setBusy] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [comment, setComment] = useState('')
  const [rowMessage, setRowMessage] = useState<{ taskId: string; text: string; tone: 'ok' | 'error' } | null>(null)
  const [dialog, setDialog] = useState<{ taskId: string; title: string } | null>(null)
  const dialogFrame = useRef<HTMLIFrameElement | null>(null)
  const first = useRef(true)

  const load = useCallback((next: TaskListOptions) => {
    startRefresh(async () => {
      const result = await listEmbedTasks(next)
      if (result.ok) { setList(result.data); setError(null) } else setError(result.error)
    })
  }, [])

  // Options change → reload (not on the first render: the server sent page one).
  useEffect(() => {
    if (first.current) { first.current = false; return }
    load(options)
  }, [options, load])

  // Search: debounced.
  useEffect(() => {
    if (search === options.q) return
    const t = window.setTimeout(() => setOptions((o) => ({ ...o, q: search, page: 1 })), 300)
    return () => window.clearTimeout(t)
  }, [search, options.q])

  // A task opened in a new tab: refresh when the person comes back.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(options) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [options, load])

  // The dialog's task page reports completion / close (same origin, our own frame only).
  useEffect(() => {
    if (!dialog) return
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== dialogFrame.current?.contentWindow || !isTaskEventMessage(event.data)) return
      if (event.data.event === 'close' || event.data.event === 'completed') {
        const done = event.data.event === 'completed'
        setDialog(null)
        if (done) { setRowMessage({ taskId: event.data.task_id, text: 'Done', tone: 'ok' }); postToHost(taskEventMessage('completed', event.data.task_id)) }
        load(options)
      } else if (event.data.event === 'changed') load(options)
    }
    window.addEventListener('message', onMessage)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setDialog(null); load(options) } }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('message', onMessage); window.removeEventListener('keydown', onKey) }
  }, [dialog, options, load])

  const act = async (task: EmbedTask, action: EmbedTaskAction) => {
    setBusy(task.id)
    setRowMessage(null)
    try {
      const result = await actOnEmbedTask(task.id, action)
      if (!result.ok) { setRowMessage({ taskId: task.id, text: result.error, tone: 'error' }); return }
      setPending(null); setComment('')
      setRowMessage({ taskId: task.id, text: result.data.done, tone: 'ok' })
      postToHost(taskEventMessage(action.kind === 'outcome' ? 'completed' : 'changed', task.id))
      load(options)
    } finally {
      setBusy(null)
    }
  }

  const openTask = (task: EmbedTask) => {
    if (options.open === 'tab') { window.open(`/tasks/${encodeURIComponent(task.id)}`, '_blank', 'noopener'); return }
    setDialog({ taskId: task.id, title: task.title })
  }

  const tasks = list?.tasks ?? []
  const total = list?.total ?? 0
  const from = total ? (options.page - 1) * options.size + 1 : 0
  const to = Math.min(total, options.page * options.size)
  const emptyText = useMemo(() => {
    const what = options.status === 'completed' ? 'No completed tasks' : options.due === 'overdue' ? 'Nothing overdue' : options.due === 'soon' ? 'Nothing due soon' : 'No open tasks'
    const scope = options.scopeLabel ? ` for ${options.scopeLabel}` : ''
    return options.q ? `No tasks match “${options.q}”${scope}.` : `${what}${scope}. You're all caught up.`
  }, [options])

  return (
    <div className="ut-embed-fade relative text-sm" style={dialog ? { minHeight: DIALOG_MIN_HEIGHT } : undefined} data-embed-task-list data-refreshing={refreshing || undefined}>
      <style>{'@keyframes ut-embed-fade{from{opacity:0}to{opacity:1}}.ut-embed-fade{animation:ut-embed-fade .18s ease-out both}'}</style>
      {options.title && <h2 className="mb-2 text-base font-semibold text-fg">{options.title}</h2>}
      {options.filters && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SegmentedControl
            size="sm" aria-label="Whose tasks"
            options={(['mine', 'groups', 'all'] as const).map((v) => ({ value: v, text: VIEW_LABELS[v] }))}
            value={options.view} onValueChange={(view) => setOptions((o) => ({ ...o, view, page: 1 }))}
          />
          {options.allowCompleted && (
            <SegmentedControl
              size="sm" aria-label="Open or completed"
              options={[{ value: 'open', text: 'Open' }, { value: 'completed', text: 'Completed' }]}
              value={options.status} onValueChange={(status) => setOptions((o) => ({ ...o, status, page: 1 }))}
            />
          )}
          {options.status === 'open' && (
            <SegmentedControl
              size="sm" aria-label="Due"
              options={[{ value: 'any', text: 'Any time' }, { value: 'soon', text: 'Due soon' }, { value: 'overdue', text: 'Overdue' }]}
              value={options.due} onValueChange={(due) => setOptions((o) => ({ ...o, due, page: 1 }))}
            />
          )}
          <div className="ml-auto w-52 max-w-full"><SearchInput size="sm" value={search} onValueChange={setSearch} placeholder="Search tasks" aria-label="Search tasks" /></div>
        </div>
      )}

      {error && !list ? (
        <p className="rounded-md border border-border px-3 py-6 text-center text-fg-muted" role="alert">{error}</p>
      ) : (
        <ul className={cn('divide-y divide-border border-y border-border transition-opacity duration-150', refreshing && 'opacity-60')} aria-busy={refreshing || undefined}>
          {tasks.length === 0 && <li className="px-1 py-6 text-center text-fg-muted">{emptyText}</li>}
          {tasks.map((task) => {
            const due = dueText(task.due_date)
            const message = rowMessage?.taskId === task.id ? rowMessage : null
            const asking = pending?.taskId === task.id ? pending : null
            const rowBusy = busy === task.id
            return (
              <li key={task.id} className={cn('px-1', options.compact ? 'py-1.5' : 'py-2.5')} data-task-row={task.id}>
                <div className={cn('flex gap-3', options.compact ? 'items-center' : 'items-start')}>
                  <div className="min-w-0 flex-1">
                    <button type="button" className="block max-w-full truncate text-left font-medium text-fg hover:text-primary-text hover:underline" onClick={() => openTask(task)}>
                      {task.title || 'Untitled task'}
                    </button>
                    {!options.compact && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                        {task.process && <span className="truncate">{task.process.name}{task.stage ? ` · ${task.stage}` : ''}</span>}
                        {task.team && !task.process && <span>{task.team}</span>}
                        {due && <span className={cn(task.overdue && 'font-medium text-danger')} data-overdue={task.overdue || undefined}>{task.overdue ? `Overdue · ${due.replace(/^Due /, '')}` : due}</span>}
                        <PriorityBadge priority={task.priority} />
                        {task.actions.includes('accept') ? <span className="font-medium text-info">Waiting for you to accept</span>
                          : task.actions.includes('claim') ? <span className="font-medium text-info">Unclaimed{task.team ? ` · ${task.team}` : ''}</span>
                            : <StatusBadge status={task.status} />}
                        {task.outcome && options.status === 'completed' && <span>Outcome: {task.outcome.replace(/[_-]+/g, ' ')}</span>}
                      </div>
                    )}
                    {options.compact && due && task.overdue && <span className="text-xs font-medium text-danger">Overdue</span>}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {task.actions.includes('accept') && <Button size="sm" disabled={rowBusy} onClick={() => act(task, { kind: 'accept' })}>Accept</Button>}
                    {task.actions.includes('decline') && <Button size="sm" variant="secondary" disabled={rowBusy} onClick={() => { setPending({ taskId: task.id, kind: 'decline' }); setComment('') }}>Decline</Button>}
                    {task.actions.includes('claim') && <Button size="sm" disabled={rowBusy} onClick={() => act(task, { kind: 'claim' })}>Claim</Button>}
                    {task.actions.includes('outcome') && task.outcomes.map((outcome, i) => (
                      <Button
                        key={outcome} size="sm" variant={i === 0 ? 'primary' : 'secondary'} disabled={rowBusy}
                        onClick={() => {
                          if (outcomeAsksComment(outcome)) { setPending({ taskId: task.id, kind: 'outcome', outcome }); setComment(''); return }
                          void act(task, { kind: 'outcome', outcome })
                        }}
                      >{outcomeButtonLabel(outcome)}</Button>
                    ))}
                    {task.actions.includes('unclaim') && <Button size="sm" variant="ghost" disabled={rowBusy} onClick={() => act(task, { kind: 'unclaim' })}>Unclaim</Button>}
                    {!task.actions.includes('outcome') && !task.actions.includes('accept') && !task.actions.includes('claim') && (
                      <Button size="sm" variant="secondary" disabled={rowBusy} onClick={() => openTask(task)}>Open</Button>
                    )}
                  </div>
                </div>
                {asking && (
                  <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-subtle p-2">
                    <label className="text-xs font-medium text-fg" htmlFor={`c-${task.id}`}>
                      {asking.kind === 'decline' ? 'Why are you declining? (required)' : `Comment for ${outcomeButtonLabel(asking.outcome ?? '')} (optional)`}
                    </label>
                    <Textarea id={`c-${task.id}`} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
                      <Button
                        size="sm" disabled={rowBusy || (asking.kind === 'decline' && !comment.trim())}
                        onClick={() => act(task, asking.kind === 'decline' ? { kind: 'decline', comment } : { kind: 'outcome', outcome: asking.outcome ?? 'completed', comment })}
                      >{asking.kind === 'decline' ? 'Decline' : outcomeButtonLabel(asking.outcome ?? '')}</Button>
                    </div>
                  </div>
                )}
                {message && <p className={cn('mt-1 text-xs', message.tone === 'error' ? 'text-danger' : 'text-success')} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {total > options.size && (
        <div className="mt-2 flex items-center justify-between text-xs text-fg-muted">
          <span>{from}–{to} of {total}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={options.page <= 1} onClick={() => setOptions((o) => ({ ...o, page: o.page - 1 }))}>Previous</Button>
            <Button size="sm" variant="ghost" disabled={to >= total} onClick={() => setOptions((o) => ({ ...o, page: o.page + 1 }))}>Next</Button>
          </div>
        </div>
      )}
      {error && list && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}

      {dialog && (
        <div className="absolute inset-0 z-50 flex flex-col overflow-hidden rounded-md border border-border bg-panel shadow-elev-3" role="dialog" aria-modal="true" aria-label={dialog.title}>
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="truncate font-medium">{dialog.title}</span>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant="ghost" asChild><a href={`/tasks/${encodeURIComponent(dialog.taskId)}`} target="_blank" rel="noopener">Open in a new tab</a></Button>
              <Button size="sm" variant="ghost" aria-label="Close" onClick={() => { setDialog(null); load(options) }}>Close</Button>
            </div>
          </div>
          <iframe
            ref={dialogFrame}
            title={dialog.title}
            src={`/embed/task/${encodeURIComponent(dialog.taskId)}?${new URLSearchParams({ ...(keep.ut_org ? { ut_org: keep.ut_org } : {}), in: 'dialog' }).toString()}`}
            className="min-h-0 w-full flex-1 border-0 bg-transparent"
          />
        </div>
      )}
    </div>
  )
}
