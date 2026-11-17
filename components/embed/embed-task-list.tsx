'use client'

/**
 * The embeddable task list (/embed/tasks, lib/embed/task-list.ts) — the app's task lists inside
 * a frame on an approved site (an add-in part today, an SPFx web part later):
 *
 *  - tabs: My tasks · Following · Task tracker (scopes: all / assigned by me / my teams /
 *    my reports — the ones this person has);
 *  - search, filters (status, priority, due, workflow, assignee, unread …), sort and paging,
 *    all on the server (lib/services/embed-tasks.ts); state in the frame's URL;
 *  - each row: unread dot, progress, subtasks, Process view and Timeline icons (expand that
 *    view under the row), an Actions menu (outcomes, accept / decline, claim / unclaim — the
 *    app's actions, with its confirmation and comment rules), and a click anywhere else expands
 *    the quick details (the app's TaskDetailPanel, comments, attachments) with "Open full
 *    task" (the task page in the part's panel). One expansion at a time; Escape collapses.
 *
 * Seamless in a host page: server-rendered first page, no spinners (quiet skeletons), refreshes
 * keep the rows, the frame follows the height (EmbedFrame → usertasks:resize / add-in part).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { ChevronDown, ChevronRight, Filter, History, MoreHorizontal, Workflow, X } from 'lucide-react'
import { actOnEmbedTask, embedTaskFacets, listEmbedTasks, type EmbedTaskAction } from '@/app/actions/embed-tasks'
import type { EmbedTask, EmbedTaskFacets, EmbedTaskList } from '@/lib/services/embed-tasks'
import {
  countLabel, localDueRange, outcomeButtonLabel, PAGE_SIZES, taskListQuery,
  type TaskListOptions, type TaskListSort, type TaskListTab, type TrackerScope,
} from '@/lib/embed/task-list'
import { isTaskEventMessage, postToHost, taskEventMessage } from '@/lib/embed/host-messages'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { StatusBadge } from '@/components/ui/status-badge'
import { PriorityBadge } from '@/components/ui/priority-badge'
import { Textarea } from '@/components/ui/textarea'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { TaskProgressStrip } from '@/components/tasks/task-progress-strip'
import { UnreadDot, unreadTitleClass } from '@/components/tasks/unread-dot'
import { cn } from '@/lib/utils'
import { PanelSkeleton } from './embed-task-panels-skeleton'

// Lazy: loaded when a row first expands (keeps the list itself light).
const EmbedTaskDetails = dynamic(() => import('./embed-task-panels').then((m) => m.EmbedTaskDetails), { ssr: false, loading: () => <PanelSkeleton /> })
const EmbedProcessView = dynamic(() => import('./embed-task-panels').then((m) => m.EmbedProcessView), { ssr: false, loading: () => <PanelSkeleton tall /> })
const EmbedTimeline = dynamic(() => import('./embed-task-panels').then((m) => m.EmbedTimeline), { ssr: false, loading: () => <PanelSkeleton /> })

const TAB_LABELS: Record<TaskListTab, string> = { mine: 'My tasks', following: 'Following', tracker: 'Task tracker' }
const SCOPE_LABELS: Record<TrackerScope, string> = { all: 'All I can see', assigned_by_me: 'Assigned by me', team: 'My teams', reports: 'My reports' }
const VIEW_LABELS = { mine: 'Mine', groups: 'My groups', all: 'All' } as const
const SORT_LABELS: Record<TaskListSort, string> = { due: 'Due date', priority: 'Priority', created: 'Created', updated: 'Updated', completed: 'Completed date', title: 'Title' }
const DONE_LABELS = { any: 'Any time', '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days', custom: 'Custom dates' } as const
const DUE_LABELS = { any: 'Any time', overdue: 'Overdue', today: 'Due today', week: 'Due this week', soon: 'Due soon', custom: 'Custom dates' } as const
/** The task page needs room: the frame grows to at least this while it is open. */
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

type Expanded = { taskId: string; kind: 'details' | 'process' | 'timeline' }
interface Pending { taskId: string; action: EmbedTaskAction; label: string; needsComment: boolean }

export function EmbedTaskList({ initialOptions, initial, keep }: {
  initialOptions: TaskListOptions
  initial: EmbedTaskList | null
  /** Host parameters kept on the frame URL (ut_org, SenderId …). */
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
  const [expanded, setExpanded] = useState<Expanded | null>(null)
  const [dialog, setDialog] = useState<{ taskId: string; title: string } | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [facets, setFacets] = useState<EmbedTaskFacets | null>(null)
  /** Keyset paging: the cursor of every page reached so far (index = page - 1). */
  const [cursors, setCursors] = useState<Array<string | null>>([initialOptions.cursor])
  const dialogFrame = useRef<HTMLIFrameElement | null>(null)
  const first = useRef(true)

  const load = useCallback((next: TaskListOptions) => {
    startRefresh(async () => {
      const result = await listEmbedTasks(next)
      if (result.ok) { setList(result.data); setError(null) } else setError(result.error)
    })
  }, [])

  // Options change → reload (not on the first render: the server sent page one) and keep the state in the frame URL.
  useEffect(() => {
    if (first.current) { first.current = false; return }
    load(options)
    try { window.history.replaceState(null, '', `${window.location.pathname}?${taskListQuery(options, keep)}`) } catch { /* sandboxed */ }
  }, [options, load, keep])

  const set = useCallback((patch: Partial<TaskListOptions>) => {
    setOptions((o) => ({ ...o, page: 1, cursor: null, ...patch }))
    setCursors([null])
    setExpanded(null)
    // A row's "Done" belongs to the view it happened in.
    setRowMessage(null); setPending(null)
  }, [])
  /** Completed: newest completed first by default; back to open: due date. */
  const setStatus = (status: TaskListOptions['status']) => set(status === 'open' ? { status, sort: options.sort === 'completed' ? 'due' : options.sort, dir: options.sort === 'completed' ? 'asc' : options.dir, done: 'any' } : { status, ...(options.status === 'open' ? { sort: 'completed' as const, dir: 'desc' as const } : {}) })
  const nextPage = () => {
    if (list?.nextCursor) {
      const c = list.nextCursor
      setCursors((cs) => [...cs.slice(0, options.page), c])
      setOptions((o) => ({ ...o, page: o.page + 1, cursor: c }))
    } else setOptions((o) => ({ ...o, page: o.page + 1, cursor: null }))
    setExpanded(null)
  }
  const prevPage = () => {
    setOptions((o) => ({ ...o, page: Math.max(1, o.page - 1), cursor: o.sort === 'title' ? null : cursors[Math.max(0, o.page - 2)] ?? null }))
    setExpanded(null)
  }

  // A host default of "due today / this week" arrives without the window: the browser computes it (its own time zone).
  useEffect(() => {
    if ((options.due === 'today' || options.due === 'week') && !options.dueFrom) set(localDueRange(options.due))
  }, [options.due, options.dueFrom, set])

  // Search: debounced.
  useEffect(() => {
    if (search === options.q) return
    const t = window.setTimeout(() => set({ q: search }), 300)
    return () => window.clearTimeout(t)
  }, [search, options.q, set])

  // A task opened in a new tab: refresh when the person comes back.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load(options) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [options, load])

  // Filter choices: when the filter menu first opens.
  useEffect(() => {
    if (!filtersOpen || facets) return
    void embedTaskFacets().then((r) => { if (r.ok) setFacets(r.data) })
  }, [filtersOpen, facets])

  // The task page panel reports completion / close (same origin, our own frame only).
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

  const openFull = useCallback((taskId: string, title: string) => {
    if (options.open === 'tab') { window.open(`/tasks/${encodeURIComponent(taskId)}`, '_blank', 'noopener'); return }
    setDialog({ taskId, title })
  }, [options.open])

  const toggle = (taskId: string, kind: Expanded['kind']) => setExpanded((e) => (e && e.taskId === taskId && e.kind === kind ? null : { taskId, kind }))

  // Links inside the app's panels: the task → the part's task panel; the process view → that row's process; other app pages → a new tab.
  const onLinkCapture = (e: React.MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return
    let url: URL
    try { url = new URL(a.href, window.location.href) } catch { return }
    if (url.origin !== window.location.origin || url.pathname.startsWith('/embed/') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/attachments/') || url.pathname.startsWith('/files/')) return
    e.preventDefault()
    const task = /^\/tasks\/([0-9a-f-]{36})$/i.exec(url.pathname)
    if (task && url.search === '') { openFull(task[1], a.textContent?.trim() || 'Task'); return }
    const run = /^\/(?:home|automations)\/runs\/([0-9a-f-]{36})$/i.exec(url.pathname)
    const row = run && list?.tasks.find((t) => t.run_id === run[1])
    if (row) { setExpanded({ taskId: row.id, kind: 'process' }); return }
    window.open(url.toString(), '_blank', 'noopener')
  }

  const tasks = list?.tasks ?? []
  const total = list?.total ?? 0
  const from = total ? (options.page - 1) * options.size + 1 : 0
  const to = Math.min(total, options.page * options.size)
  const hasNext = options.sort === 'title' ? tasks.length === options.size && (list?.capped || to < total) : Boolean(list?.nextCursor)
  const scopes = list?.scopes ?? []
  const filterCount = (options.done !== 'any' ? 1 : 0) + options.priority.length + (options.due !== 'any' ? 1 : 0) + (options.wf ? 1 : 0)
    + (options.assignee ? 1 : 0) + (options.unread ? 1 : 0) + (options.tab === 'mine' && options.view !== 'mine' ? 1 : 0)
  const emptyText = useMemo(() => {
    if (options.tab === 'tracker' && !scopes.length && list) return 'The Task tracker shows tasks of your teams or reports. You don’t have any yet.'
    const scope = options.scopeLabel ? ` for ${options.scopeLabel}` : ''
    if (options.q) return `No tasks match “${options.q}”${scope}.`
    if (filterCount) return `No tasks match these filters${scope}.`
    if (options.tab === 'following') return 'You aren’t following any open tasks.'
    return `${options.status === 'completed' ? 'No completed tasks' : 'No open tasks'}${scope}. You're all caught up.`
  }, [options, filterCount, scopes.length, list])
  const showAssignee = options.tab !== 'mine' || options.view !== 'mine'

  return (
    <div className="ut-embed-fade relative text-sm" style={dialog ? { minHeight: DIALOG_MIN_HEIGHT } : undefined} onClickCapture={onLinkCapture}
      data-embed-task-list data-tab={options.tab} data-refreshing={refreshing || undefined}>
      <style>{'@keyframes ut-embed-fade{from{opacity:0}to{opacity:1}}.ut-embed-fade{animation:ut-embed-fade .18s ease-out both}'
        + '.ut-expand{display:grid;grid-template-rows:0fr;transition:grid-template-rows .2s ease-out}.ut-expand[data-open]{grid-template-rows:1fr}.ut-expand>div{overflow:hidden}'
        + '@media (prefers-reduced-motion:reduce){.ut-expand{transition:none}.ut-embed-fade{animation:none}}'}</style>
      {options.title && <h2 className="mb-2 text-base font-semibold text-fg">{options.title}</h2>}

      {options.tabs.length > 1 && (
        <div role="tablist" aria-label="Task lists" className="mb-2 flex gap-1 border-b border-border">
          {options.tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={options.tab === t} data-embed-tab={t}
              className={cn('-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors', options.tab === t ? 'border-primary text-fg' : 'border-transparent text-fg-muted hover:text-fg')}
              onClick={() => set({ tab: t, wf: null, assignee: null })}>{TAB_LABELS[t]}</button>
          ))}
        </div>
      )}

      {options.filters && (
        <div className="mb-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[10rem] flex-1"><SearchInput size="sm" value={search} onValueChange={setSearch} placeholder="Search title, ID, workflow, requester" aria-label="Search tasks" /></div>
            {options.allowCompleted && (
              <SegmentedControl size="sm" aria-label="Open or completed" data-embed-status
                options={[{ value: 'open', text: 'Open' }, { value: 'completed', text: 'Completed' }, { value: 'any', text: 'All' }]}
                value={options.status} onValueChange={setStatus} />
            )}
            {options.tab === 'tracker' && scopes.length > 1 && (
              <select aria-label="Which tasks" className="h-8 rounded-md border border-border bg-panel px-2 text-xs" value={list?.scope ?? ''} onChange={(e) => set({ scope: e.target.value as TrackerScope })}>
                {scopes.map((s) => <option key={s} value={s}>{SCOPE_LABELS[s]}</option>)}
              </select>
            )}
            <Button size="sm" variant={filterCount ? 'primary' : 'secondary'} leadingIcon={<Filter />} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)} data-embed-filters-toggle>
              Filters{filterCount ? ` · ${filterCount}` : ''}
            </Button>
            <select aria-label="Sort by" className="h-8 rounded-md border border-border bg-panel px-2 text-xs" value={options.sort} onChange={(e) => set({ sort: e.target.value as TaskListSort })}>
              {(Object.keys(SORT_LABELS) as TaskListSort[]).map((s) => <option key={s} value={s}>Sort: {SORT_LABELS[s]}</option>)}
            </select>
            <Button size="sm" variant="ghost" aria-label={options.dir === 'asc' ? 'Ascending (change to descending)' : 'Descending (change to ascending)'} onClick={() => set({ dir: options.dir === 'asc' ? 'desc' : 'asc' })}>
              {options.dir === 'asc' ? '↑' : '↓'}
            </Button>
          </div>
          {filtersOpen && (
            <div className="grid gap-3 rounded-md border border-border bg-subtle p-3 sm:grid-cols-2" data-embed-filters>
              {options.tab === 'mine' && (
                <FilterField label="Whose tasks">
                  <SegmentedControl size="sm" aria-label="Whose tasks" options={(['mine', 'groups', 'all'] as const).map((v) => ({ value: v, text: VIEW_LABELS[v] }))} value={options.view} onValueChange={(view) => set({ view })} />
                </FilterField>
              )}
              {options.status !== 'open' && (
                <FilterField label="Completed">
                  <select aria-label="Completed" className="h-8 w-full rounded-md border border-border bg-panel px-2 text-xs" value={options.done} onChange={(e) => set({ done: e.target.value as TaskListOptions['done'], doneFrom: null, doneTo: null })}>
                    {(Object.keys(DONE_LABELS) as Array<keyof typeof DONE_LABELS>).map((d) => <option key={d} value={d}>{DONE_LABELS[d]}</option>)}
                  </select>
                  {options.done === 'custom' && (
                    <div className="mt-1 flex gap-1">
                      <input type="date" aria-label="Completed from" className="h-8 min-w-0 flex-1 rounded-md border border-border bg-panel px-2 text-xs" defaultValue={options.doneFrom?.slice(0, 10) ?? ''}
                        onChange={(e) => set({ done: 'custom', doneFrom: e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null, doneTo: options.doneTo })} />
                      <input type="date" aria-label="Completed to" className="h-8 min-w-0 flex-1 rounded-md border border-border bg-panel px-2 text-xs"
                        onChange={(e) => set({ done: 'custom', doneFrom: options.doneFrom, doneTo: e.target.value ? new Date(new Date(`${e.target.value}T00:00:00`).getTime() + 86_400_000).toISOString() : null })} />
                    </div>
                  )}
                </FilterField>
              )}
              <FilterField label="Priority">
                <div className="flex flex-wrap gap-1">
                  {['critical', 'high', 'medium', 'low'].map((p) => {
                    const on = options.priority.includes(p)
                    return <button key={p} type="button" aria-pressed={on} onClick={() => set({ priority: on ? options.priority.filter((x) => x !== p) : [...options.priority, p] })}
                      className={cn('rounded-full border px-2 py-0.5 text-xs capitalize', on ? 'border-primary bg-primary-wash text-fg' : 'border-border text-fg-muted')}>{p}</button>
                  })}
                </div>
              </FilterField>
              <FilterField label="Due">
                <select aria-label="Due" className="h-8 w-full rounded-md border border-border bg-panel px-2 text-xs" value={options.due}
                  onChange={(e) => {
                    const due = e.target.value as TaskListOptions['due']
                    set(due === 'today' || due === 'week' ? { due, ...localDueRange(due) } : { due, dueFrom: null, dueTo: null })
                  }}>
                  {(Object.keys(DUE_LABELS) as Array<keyof typeof DUE_LABELS>).map((d) => <option key={d} value={d}>{DUE_LABELS[d]}</option>)}
                </select>
                {options.due === 'custom' && (
                  <div className="mt-1 flex gap-1">
                    <input type="date" aria-label="Due from" className="h-8 min-w-0 flex-1 rounded-md border border-border bg-panel px-2 text-xs" defaultValue={options.dueFrom?.slice(0, 10) ?? ''}
                      onChange={(e) => set({ dueFrom: e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null })} />
                    <input type="date" aria-label="Due to" className="h-8 min-w-0 flex-1 rounded-md border border-border bg-panel px-2 text-xs" defaultValue={options.dueTo ? new Date(new Date(options.dueTo).getTime() - 86_400_000).toISOString().slice(0, 10) : ''}
                      onChange={(e) => set({ dueTo: e.target.value ? new Date(new Date(`${e.target.value}T00:00:00`).getTime() + 86_400_000).toISOString() : null })} />
                  </div>
                )}
              </FilterField>
              <FilterField label="Workflow">
                <select aria-label="Workflow" className="h-8 w-full rounded-md border border-border bg-panel px-2 text-xs" value={options.wf ?? ''} onChange={(e) => set({ wf: e.target.value || null })}>
                  <option value="">Any workflow</option>
                  {(facets?.workflows ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </FilterField>
              {showAssignee && (
                <FilterField label="Assignee">
                  <select aria-label="Assignee" className="h-8 w-full rounded-md border border-border bg-panel px-2 text-xs" value={options.assignee ?? ''} onChange={(e) => set({ assignee: e.target.value || null })}>
                    <option value="">Anyone</option>
                    {(facets?.assignees ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </FilterField>
              )}
              <FilterField label="Read state">
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={options.unread} onChange={(e) => set({ unread: e.target.checked })} /> Unread only</label>
              </FilterField>
              <div className="flex items-end justify-end gap-2 sm:col-span-2">
                {filterCount > 0 && <Button size="sm" variant="ghost" onClick={() => set({ done: 'any', doneFrom: null, doneTo: null, priority: [], due: 'any', dueFrom: null, dueTo: null, wf: null, assignee: null, unread: false, view: 'mine' })}>Clear filters</Button>}
                <Button size="sm" variant="secondary" onClick={() => setFiltersOpen(false)}>Done</Button>
              </div>
            </div>
          )}
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
            const open = expanded?.taskId === task.id ? expanded.kind : null
            const rowBusy = busy === task.id
            const menu = actionItems(task)
            const regionId = `ut-x-${task.id}`
            return (
              <li key={task.id} className={cn('px-1', open && 'bg-subtle/60')} data-task-row={task.id}
                onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setExpanded(null) } }}>
                <div className={cn('flex gap-2', options.compact ? 'items-center py-1.5' : 'items-start py-2.5')}>
                  <div role="button" tabIndex={0} aria-expanded={open === 'details'} aria-controls={regionId} data-row-expand
                    className="min-w-0 flex-1 cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => toggle(task.id, 'details')}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(task.id, 'details') } }}>
                    <div className="flex min-w-0 items-center gap-1.5">
                      {open === 'details' ? <ChevronDown className="size-3.5 shrink-0 text-fg-muted" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0 text-fg-muted" aria-hidden />}
                      <UnreadDot unread={task.unread} />
                      <span className={cn('truncate text-fg', unreadTitleClass(task.unread) || 'font-medium')}>{task.title || 'Untitled task'}</span>
                    </div>
                    {!options.compact && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-5 text-xs text-fg-muted">
                        {task.process && <span className="truncate">{task.process.name}{task.stage ? ` · ${task.stage}` : ''}</span>}
                        {showAssignee && <span>{task.assignee_name ?? (task.team ? `${task.team} team` : 'Unassigned')}</span>}
                        {/* Local-time text (the browser's time zone may differ from the server's): no hydration mismatch over it. */}
                        {due && task.status !== 'completed' && <span suppressHydrationWarning className={cn(task.overdue && 'font-medium text-danger')} data-overdue={task.overdue || undefined}>{task.overdue ? `Overdue · ${due.replace(/^Due /, '')}` : due}</span>}
                        <PriorityBadge priority={task.priority} />
                        {task.actions.includes('accept') ? <span className="font-medium text-info">Waiting for you to accept</span>
                          : task.actions.includes('claim') ? <span className="font-medium text-info">Unclaimed{task.team ? ` · ${task.team}` : ''}</span>
                            : <StatusBadge status={task.status} />}
                        {task.subtasks.total > 0 && <span data-subtasks>{task.subtasks.done}/{task.subtasks.total} subtasks</span>}
                        {task.status === 'completed' && <span suppressHydrationWarning data-completed>Completed{task.completed_at ? ` ${new Date(task.completed_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}{task.outcome ? ` · ${task.outcome.replace(/[_-]+/g, ' ')}` : ''}</span>}
                      </div>
                    )}
                    {!options.compact && (task.progress_pct > 0 || task.subtasks.total > 0) && <TaskProgressStrip value={task.progress_pct} className="mt-1 max-w-56 pl-5" />}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {task.run_id && (
                      <Button size="icon-sm" variant={open === 'process' ? 'secondary' : 'ghost'} aria-label={`Process view: ${task.title}`} aria-expanded={open === 'process'} aria-controls={regionId}
                        title="Process view" onClick={() => toggle(task.id, 'process')} data-row-process><Workflow /></Button>
                    )}
                    <Button size="icon-sm" variant={open === 'timeline' ? 'secondary' : 'ghost'} aria-label={`Timeline: ${task.title}`} aria-expanded={open === 'timeline'} aria-controls={regionId}
                      title="Timeline" onClick={() => toggle(task.id, 'timeline')} data-row-timeline><History /></Button>
                    <RowActionsMenu
                      title={task.title} busy={rowBusy} items={menu}
                      onPick={(m) => {
                        // Outcomes and Decline: the app asks first (its outcome dialog / a required reason); the others act at once.
                        if (m.action.kind === 'outcome' || m.action.kind === 'decline') { setComment(''); setPending({ taskId: task.id, action: m.action, label: m.label, needsComment: m.needsComment }) }
                        else void act(task, m.action)
                      }}
                      onOpenFull={() => openFull(task.id, task.title)}
                    />
                  </div>
                </div>

                {asking && (
                  <div className="mb-2 flex flex-col gap-2 rounded-md border border-border bg-panel p-2" data-row-confirm>
                    <label className="text-xs font-medium text-fg" htmlFor={`c-${task.id}`}>
                      {asking.label}: {asking.needsComment ? 'add a reason (required)' : 'add a comment (optional)'}
                    </label>
                    <Textarea id={`c-${task.id}`} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
                      <Button size="sm" disabled={rowBusy || (asking.needsComment && !comment.trim())}
                        onClick={() => act(task, withComment(asking.action, comment))}>{asking.label}</Button>
                    </div>
                  </div>
                )}
                {message && <p className={cn('mb-1 pl-5 text-xs', message.tone === 'error' ? 'text-danger' : 'text-success')} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}

                <div id={regionId} className="ut-expand" data-open={open ? '' : undefined} role="region" aria-label={open ? `${open === 'details' ? 'Details' : open === 'process' ? 'Process view' : 'Timeline'}: ${task.title}` : undefined}>
                  <div>
                    {open && (
                      <div className="mb-3 rounded-md border border-border bg-panel p-3" data-row-expanded={open}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-fg-muted">{open === 'details' ? 'Details' : open === 'process' ? 'Process view' : 'Timeline'}</span>
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openFull(task.id, task.title)} data-row-open-full>Open full task</Button>
                            <Button size="icon-sm" variant="ghost" aria-label="Collapse" onClick={() => setExpanded(null)}><X /></Button>
                          </div>
                        </div>
                        {open === 'details' && <EmbedTaskDetails taskId={task.id} title={task.title} readOnly={task.status === 'completed' || task.status === 'cancelled'} />}
                        {open === 'process' && task.run_id && <EmbedProcessView runId={task.run_id} />}
                        {open === 'timeline' && <EmbedTimeline taskId={task.id} />}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span data-embed-count>{total ? `${from}–${to} of ${countLabel(total, Boolean(list?.capped))}` : ''}</span>
        <div className="flex items-center gap-1">
          <select aria-label="Rows per page" className="h-7 rounded-md border border-border bg-panel px-1 text-xs" value={options.size} onChange={(e) => set({ size: Number(e.target.value) })}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}
          </select>
          <Button size="sm" variant="ghost" disabled={options.page <= 1} onClick={prevPage}>Previous</Button>
          <Button size="sm" variant="ghost" disabled={!hasNext} onClick={nextPage}>Next</Button>
        </div>
      </div>
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

type MenuItem = ReturnType<typeof actionItems>[number]
/** About one menu row (px) — to tell whether the list fits above the button. */
const MENU_ROW_PX = 34
/** Longer lists scroll (and the frame still grows to the menu's maximum). */
const MENU_SCROLL_AFTER = 12

/**
 * The row's Actions menu inside a frame: it never clips. It opens upward when there is more room above and the
 * whole list fits there, otherwise downward without collision shifting — the frame grows to show it (EmbedFrame
 * measures open menus) and shrinks back when it closes. Short lists never scroll.
 */
function RowActionsMenu({ title, busy, items, onPick, onOpenFull }: {
  title: string; busy: boolean; items: MenuItem[]; onPick: (item: MenuItem) => void; onOpenFull: () => void
}) {
  const trigger = useRef<HTMLButtonElement | null>(null)
  const [side, setSide] = useState<'top' | 'bottom'>('bottom')
  const count = items.length + 1
  return (
    <DropdownMenu onOpenChange={(open) => {
      if (!open || !trigger.current) return
      const r = trigger.current.getBoundingClientRect()
      const needed = Math.min(count, MENU_SCROLL_AFTER) * MENU_ROW_PX + 16
      const above = r.top
      const below = window.innerHeight - r.bottom
      setSide(above >= needed && above > below ? 'top' : 'bottom')
    }}>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} size="sm" variant={items.length ? 'secondary' : 'ghost'} disabled={busy} trailingIcon={<MoreHorizontal />} aria-label={`Actions: ${title}`} data-row-actions>Actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={side} avoidCollisions={false} data-row-actions-menu
        className={count > MENU_SCROLL_AFTER + 1 ? 'max-h-[30rem]' : 'max-h-none overflow-visible'}>
        {items.map((m) => <DropdownMenuItem key={m.label} onSelect={() => onPick(m)}>{m.label}</DropdownMenuItem>)}
        <DropdownMenuItem onSelect={onOpenFull}>Open full task</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 space-y-1"><div className="text-xs font-medium text-fg-muted">{label}</div>{children}</div>
}

/** The Actions menu: the app's actions this person may take on the row (the server re-checks every one). */
function actionItems(task: EmbedTask): Array<{ label: string; action: EmbedTaskAction; needsComment: boolean }> {
  const out: Array<{ label: string; action: EmbedTaskAction; needsComment: boolean }> = []
  if (task.actions.includes('accept')) out.push({ label: 'Accept', action: { kind: 'accept' }, needsComment: false })
  if (task.actions.includes('decline')) out.push({ label: 'Decline', action: { kind: 'decline', comment: '' }, needsComment: true })
  if (task.actions.includes('claim')) out.push({ label: 'Claim', action: { kind: 'claim' }, needsComment: false })
  if (task.actions.includes('outcome')) for (const o of task.outcomes) out.push({ label: outcomeButtonLabel(o), action: { kind: 'outcome', outcome: o }, needsComment: false })
  if (task.actions.includes('unclaim')) out.push({ label: 'Unclaim', action: { kind: 'unclaim' }, needsComment: false })
  return out
}

function withComment(action: EmbedTaskAction, comment: string): EmbedTaskAction {
  if (action.kind === 'decline') return { kind: 'decline', comment }
  if (action.kind === 'outcome') return { ...action, comment: comment.trim() || null }
  return action
}

