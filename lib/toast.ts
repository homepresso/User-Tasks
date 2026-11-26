import { JOBS_TOAST_EVENT, type JobsToastDetail } from '@/lib/user-jobs/types'

/**
 * A toast in the app's toaster (components/jobs/jobs-provider listens) from
 * anywhere on the client — the themed, announced replacement for alert().
 * Errors use role=alert in the toaster, so screen readers hear them.
 */
export function toast(detail: JobsToastDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<JobsToastDetail>(JOBS_TOAST_EVENT, { detail }))
}

export const toastError = (title: string, body?: string | null) => toast({ tone: 'error', title, body: body ?? null })
