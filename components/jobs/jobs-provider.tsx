'use client'

/**
 * Background jobs in the browser: start a job, follow it, tell the user.
 *
 *   const jobs = useJobs()
 *   jobs.start('config.export', { ids, name }, { effect: 'download' })
 *
 * start() returns at once with the job (a quick job may already be done).
 * The user gets "Preparing your export… we'll let you know when it's ready"
 * and can keep working; the top-bar Jobs indicator shows progress; when the
 * job finishes a popup offers Download (or shows the summary / error with
 * Retry) — on whatever page the user is by then. Jobs that finish after a
 * reload or in another tab arrive as a bell notification instead.
 *
 * Updates come from the realtime provider (user_jobs topic, Supabase
 * Realtime or SSE) with polling as the fallback while a job is active.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ToastCard, ToastViewport } from '@/components/ui/toast'
import { formatBytes as formatByteSize } from '@/lib/format/number'
import { cancelJobAction, getJobAction, listMyJobsAction, markJobSeenAction, retryJobAction, startJobAction, type StartJobInput } from '@/app/actions/user-jobs'
import { unwrapAction } from '@/lib/action-result'
import { useRealtime, useRealtimeUserId } from '@/hooks/use-realtime'
import { isActiveJobStatus, type UserJobView } from '@/lib/user-jobs/types'

export type JobEffect = 'download' | 'change' | 'result'

export interface StartJobOptions {
  /** download: offer the file; change: refresh the page's data; result: the caller reads the result. */
  effect?: JobEffect
  /** Called when the job succeeds (still on this page). */
  onSuccess?: (job: UserJobView) => void
  onFailure?: (job: UserJobView) => void
  /** The caller shows its own progress / result (a dialog): no toasts. */
  quiet?: boolean
  /** No toasts when the job finishes within the request (the caller shows the result inline). */
  quietIfInline?: boolean
  /** Toast text while it runs. */
  pendingMessage?: string
  /** No "working on it" toast (the page already says so); the completion popup still shows. */
  silentStart?: boolean
  input?: StartJobInput['input']
  /** Run in another workspace the user belongs to. */
  tenantId?: string | null
}

interface Toast {
  id: string
  tone: 'info' | 'success' | 'error'
  title: string
  body?: string | null
  job?: UserJobView
  /** ms; 0 = until dismissed. */
  timeout: number
}

export interface JobsApi {
  start(kind: string, params: unknown, options?: StartJobOptions): Promise<UserJobView | null>
  /** Resolves when the job is no longer queued / running. */
  wait(jobId: string): Promise<UserJobView>
  cancel(jobId: string): Promise<void>
  retry(jobId: string): Promise<void>
  jobs: UserJobView[]
  activeCount: number
  panelOpen: boolean
  setPanelOpen(open: boolean): void
  notify(toast: Omit<Toast, 'id' | 'timeout'> & { timeout?: number }): void
}

const JOBS_KEY = ['user-jobs']
const POLL_ACTIVE_MS = 2_000
const POLL_IDLE_MS = 60_000

const JobsContext = createContext<JobsApi | null>(null)

/** Without the provider (tests, pages outside the dashboard): start + wait by polling, no UI. */
const fallbackApi: JobsApi = {
  async start(kind, params, options = {}) {
    const result = await startJobAction({ kind, params, input: options.input, tenantId: options.tenantId })
    if (!result.ok) throw new Error(result.error)
    return result.data
  },
  async wait(jobId) {
    for (;;) {
      const job = unwrapAction(await getJobAction(jobId))
      if (!isActiveJobStatus(job.status)) return job
      await new Promise((resolve) => setTimeout(resolve, POLL_ACTIVE_MS))
    }
  },
  async cancel(jobId) { unwrapAction(await cancelJobAction(jobId)) },
  async retry(jobId) { unwrapAction(await retryJobAction(jobId)) },
  jobs: [],
  activeCount: 0,
  panelOpen: false,
  setPanelOpen: () => undefined,
  notify: () => undefined,
}

export function useJobs(): JobsApi {
  return useContext(JobsContext) ?? fallbackApi
}

/** Window event that opens the Jobs panel (the bell's job notifications). */
export const OPEN_JOBS_PANEL_EVENT = 'usertasks:open-jobs'

export function formatBytes(size: number | null | undefined): string {
  if (!size && size !== 0) return ''
  return formatByteSize(size)
}

/** Start the browser download of a finished job's file. */
export function downloadJobFile(job: Pick<UserJobView, 'download_url' | 'result'>) {
  if (!job.download_url) return
  const link = document.createElement('a')
  link.href = job.download_url
  link.download = job.result?.file?.filename ?? ''
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const userId = useRealtimeUserId()
  const [toasts, setToasts] = useState<Toast[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const [liveStatus, setLiveStatus] = useState<string>('connecting')

  /** Jobs started in this tab: how to react when they finish. */
  const watched = useRef(new Map<string, StartJobOptions>())
  const waiters = useRef(new Map<string, Array<(job: UserJobView) => void>>())
  const lastStatus = useRef(new Map<string, string>())
  const mountedAt = useRef(0)
  const initialised = useRef(false)

  const query = useQuery({
    queryKey: JOBS_KEY,
    queryFn: async () => unwrapAction(await listMyJobsAction({ limit: 30 })),
    refetchInterval: (q) => {
      const data = q.state.data as UserJobView[] | undefined
      const active = (data ?? []).some((job) => isActiveJobStatus(job.status)) || waiters.current.size > 0
      // Realtime pushes changes; polling is the fallback while something runs.
      return active ? (liveStatus === 'live' ? POLL_ACTIVE_MS * 2 : POLL_ACTIVE_MS) : POLL_IDLE_MS
    },
    refetchOnWindowFocus: true,
  })
  const jobs = useMemo(() => query.data ?? [], [query.data])

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: JOBS_KEY }), [queryClient])

  useRealtime('user_jobs', userId ? { column: 'user_id', value: userId } : null, () => { void refresh() }, {
    onStatus: (status) => setLiveStatus(status),
  })

  const dismiss = useCallback((id: string) => setToasts((current) => current.filter((t) => t.id !== id)), [])
  const notify = useCallback<JobsApi['notify']>((toast) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setToasts((current) => [...current.filter((t) => !(toast.job && t.job?.id === toast.job.id)), { ...toast, id, timeout: toast.timeout ?? 0 }].slice(-6))
  }, [])

  const finished = useCallback((job: UserJobView, inline = false) => {
    const options = watched.current.get(job.id)
    watched.current.delete(job.id)
    for (const resolve of waiters.current.get(job.id) ?? []) resolve(job)
    waiters.current.delete(job.id)
    if (job.status === 'succeeded') {
      options?.onSuccess?.(job)
      if (options && options.effect !== 'download') router.refresh()
    } else {
      options?.onFailure?.(job)
    }
    if (options?.quiet || (inline && options?.quietIfInline)) return
    if (job.status === 'cancelled') {
      notify({ tone: 'info', title: `${job.title} was cancelled`, job })
    } else {
      notify({
        // Failures stay until dismissed; results follow the toast timing (the Jobs panel keeps them).
        tone: job.status === 'succeeded' ? 'success' : 'error',
        title: job.status === 'succeeded' ? (job.downloadable ? `${job.title} is ready` : `${job.title}: done`) : `${job.title} failed`,
        body: job.status === 'succeeded' ? job.result?.summary ?? null : job.error,
        job,
      })
    }
    // The popup was seen: the bell item for it need not stay unread.
    void markJobSeenAction(job.id).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))
  }, [notify, queryClient, router])

  useEffect(() => { mountedAt.current = Date.now() }, [])

  // Detect transitions out of queued / running.
  useEffect(() => {
    if (!query.data) return
    for (const job of query.data) {
      const previous = lastStatus.current.get(job.id)
      lastStatus.current.set(job.id, job.status)
      if (isActiveJobStatus(job.status)) continue
      const wasActive = previous ? isActiveJobStatus(previous) : false
      // A job from another tab that finished while this one is open also gets the popup.
      const finishedHere = !previous && initialised.current && job.finished_at && new Date(job.finished_at).getTime() > mountedAt.current
      // Reacting to fetched data (a toast, callbacks), outside this render pass.
      if (wasActive || finishedHere || (watched.current.has(job.id) && !previous)) queueMicrotask(() => finished(job))
    }
    initialised.current = true
  }, [query.data, finished])

  // The bell's job notifications open the panel.
  useEffect(() => {
    const open = () => setPanelOpen(true)
    window.addEventListener(OPEN_JOBS_PANEL_EVENT, open)
    return () => window.removeEventListener(OPEN_JOBS_PANEL_EVENT, open)
  }, [])

  const start = useCallback<JobsApi['start']>(async (kind, params, options = {}) => {
    const result = await startJobAction({ kind, params, input: options.input, tenantId: options.tenantId })
    if (!result.ok) {
      if (!options.quiet) notify({ tone: 'error', title: 'Could not start', body: result.error })
      throw new Error(result.error)
    }
    const job = result.data
    watched.current.set(job.id, options)
    queryClient.setQueryData<UserJobView[]>(JOBS_KEY, (current) => [job, ...(current ?? []).filter((j) => j.id !== job.id)])
    if (isActiveJobStatus(job.status)) {
      lastStatus.current.set(job.id, job.status)
      if (!options.quiet && !options.silentStart) {
        notify({
          tone: 'info',
          title: options.pendingMessage ?? (options.effect === 'download' ? 'Preparing your download…' : `${job.title}…`),
          body: "We'll let you know when it's ready. You can keep working.",
          job,
        })
      }
      void refresh()
    } else {
      lastStatus.current.set(job.id, job.status)
      finished(job, true)
    }
    return job
  }, [finished, notify, queryClient, refresh])

  const wait = useCallback<JobsApi['wait']>((jobId) => {
    const known = (queryClient.getQueryData<UserJobView[]>(JOBS_KEY) ?? []).find((job) => job.id === jobId)
    if (known && !isActiveJobStatus(known.status)) return Promise.resolve(known)
    return new Promise<UserJobView>((resolve) => {
      waiters.current.set(jobId, [...(waiters.current.get(jobId) ?? []), resolve])
      void refresh()
    })
  }, [queryClient, refresh])

  const cancel = useCallback<JobsApi['cancel']>(async (jobId) => {
    const result = await cancelJobAction(jobId)
    if (!result.ok) notify({ tone: 'error', title: 'Could not cancel', body: result.error })
    void refresh()
  }, [notify, refresh])

  const retry = useCallback<JobsApi['retry']>(async (jobId) => {
    const previous = watched.current.get(jobId)
    const result = await retryJobAction(jobId)
    if (!result.ok) {
      notify({ tone: 'error', title: 'Could not retry', body: result.error })
      return
    }
    const job = result.data
    watched.current.set(job.id, { effect: previous?.effect ?? (jobs.find((j) => j.id === jobId)?.result?.file ? 'download' : 'change'), onSuccess: previous?.onSuccess })
    lastStatus.current.set(job.id, job.status)
    notify({ tone: 'info', title: `Retrying ${job.title}…`, body: "We'll let you know when it's ready.", job })
    void refresh()
  }, [jobs, notify, refresh])

  const activeCount = jobs.filter((job) => isActiveJobStatus(job.status)).length
  const api = useMemo<JobsApi>(() => ({ start, wait, cancel, retry, jobs, activeCount, panelOpen, setPanelOpen, notify }), [start, wait, cancel, retry, jobs, activeCount, panelOpen, notify])

  return (
    <JobsContext.Provider value={api}>
      {children}
      <JobToasts toasts={toasts} jobs={jobs} onDismiss={dismiss} onRetry={(id) => void retry(id)} onOpenPanel={() => setPanelOpen(true)} />
    </JobsContext.Provider>
  )
}

/** At most this many toasts show; older ones collapse into a count. */
const MAX_VISIBLE_TOASTS = 3

function JobToasts({ toasts, jobs, onDismiss, onRetry, onOpenPanel }: {
  toasts: Toast[]
  jobs: UserJobView[]
  onDismiss: (id: string) => void
  onRetry: (jobId: string) => void
  onOpenPanel: () => void
}) {
  const visible = toasts.slice(-MAX_VISIBLE_TOASTS)
  const hidden = toasts.length - visible.length
  return (
    <ToastViewport className="max-md:bottom-24" aria-label="Notifications">
      {hidden > 0 && (
        <button type="button" onClick={() => toasts.slice(0, hidden).forEach((t) => onDismiss(t.id))}
          className="rounded-full bg-elevated px-2.5 py-1 text-xs font-medium text-fg-muted shadow-elev-2 hover:text-fg">
          {hidden} more · Clear
        </button>
      )}
      {visible.map((toast) => (
        <JobToast key={toast.id} toast={toast} live={toast.job ? jobs.find((j) => j.id === toast.job!.id) ?? toast.job : undefined} onDismiss={onDismiss} onRetry={onRetry} onOpenPanel={onOpenPanel} />
      ))}
    </ToastViewport>
  )
}

/** ms before a toast leaves (§3.14): 5s, 8s with an action; 0 = stays (running jobs, errors). */
export function toastTimeout(toast: Pick<Toast, 'tone' | 'timeout'>, { running, hasAction }: { running: boolean; hasAction: boolean }): number {
  if (running || toast.tone === 'error') return 0
  if (toast.timeout > 0) return toast.timeout
  return hasAction ? 8_000 : 5_000
}

function JobToast({ toast, live, onDismiss, onRetry, onOpenPanel }: {
  toast: Toast
  live?: UserJobView
  onDismiss: (id: string) => void
  onRetry: (jobId: string) => void
  onOpenPanel: () => void
}) {
  const running = toast.tone === 'info' && !!live && isActiveJobStatus(live.status)
  const job = toast.job
  // One action per toast: the file, a retry, or the Jobs panel.
  const action = toast.tone === 'success' && job?.downloadable
    ? { label: `Download${job.result?.file ? ` (${formatBytes(job.result.file.size)})` : ''}`, onClick: () => { downloadJobFile(job); onDismiss(toast.id) }, testId: 'job-toast-download' }
    : toast.tone === 'error' && job?.retryable
      ? { label: 'Retry', onClick: () => { onRetry(job.id); onDismiss(toast.id) }, testId: 'job-toast-retry' }
      : job
        ? { label: 'View jobs', onClick: () => { onOpenPanel(); onDismiss(toast.id) }, testId: 'job-toast-jobs' }
        : null
  const timeout = toastTimeout(toast, { running, hasAction: !!action })
  const [paused, setPaused] = useState(false)
  const remaining = useRef(timeout)
  useEffect(() => { remaining.current = timeout }, [timeout])
  useEffect(() => {
    if (!timeout || paused) return
    const startedAt = Date.now()
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(1_000, remaining.current - (Date.now() - startedAt))
    }
  }, [toast.id, timeout, paused, onDismiss])

  const progress = running && live && live.progress > 0 ? ` · ${Math.round(live.progress)}%` : ''
  return (
    <div data-testid={`job-toast-${toast.tone}`} data-action={action?.testId}>
      <ToastCard
        tone={running ? 'running' : toast.tone === 'error' ? 'danger' : toast.tone === 'success' ? 'success' : 'info'}
        title={toast.title}
        description={toast.body || progress ? `${toast.body ?? ''}${progress}`.replace(/^ · /, '') : undefined}
        action={action ?? undefined}
        onDismiss={() => onDismiss(toast.id)}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      />
    </div>
  )
}

export type InlineJobOutcome =
  | { status: 'done'; job: UserJobView; counts: Record<string, number> }
  | { status: 'background'; job: UserJobView }
  | { status: 'failed'; error: string }

/**
 * Run a bulk action as a job and tell the caller how it went right away:
 * `done` (finished within the request: show the result inline, no toast),
 * `background` (still running: the toast / popup / Jobs panel take over) or
 * `failed`. `onSuccess` also runs when a background job finishes later.
 */
export async function runInlineJob(jobs: JobsApi, kind: string, params: unknown, options: Omit<StartJobOptions, 'quietIfInline'> = {}): Promise<InlineJobOutcome> {
  try {
    const job = await jobs.start(kind, params, { effect: 'change', ...options, quietIfInline: true })
    if (!job) return { status: 'failed', error: 'Could not start' }
    if (job.status === 'failed' || job.status === 'cancelled') return { status: 'failed', error: job.error ?? `The job was ${job.status}` }
    if (job.status === 'succeeded') return { status: 'done', job, counts: job.result?.counts ?? {} }
    return { status: 'background', job }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : 'Could not start' }
  }
}

/**
 * Bulk delete as a `bulk.delete` job, shaped like the old bulk server
 * actions: resolves with `{ queued }` when it finished within the request,
 * `{ background: true }` when it continues in the background (the toast and
 * popup report it), and throws when it failed.
 */
export async function bulkDeleteWithJob(jobs: JobsApi, type: string, ids: string[], onSuccess?: () => void): Promise<{ queued: number; blocked: number; background: boolean }> {
  const outcome = await runInlineJob(jobs, 'bulk.delete', { type, ids }, { onSuccess })
  if (outcome.status === 'failed') throw new Error(outcome.error)
  if (outcome.status === 'background') return { queued: 0, blocked: 0, background: true }
  return { queued: outcome.counts.queued ?? outcome.counts.deleted ?? 0, blocked: outcome.counts.blocked ?? 0, background: false }
}
