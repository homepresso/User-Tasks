import { StatusPill } from './badge'

// Task statuses keep their established labels ("To do").
const TASK_LABELS: Record<string, string> = {
  draft: 'Draft',
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

/** Task status pill (unknown statuses render as Draft). Built on StatusPill. */
export function StatusBadge({ status }: { status: string }) {
  const known = status in TASK_LABELS ? status : 'draft'
  return <StatusPill status={known} label={TASK_LABELS[known]} />
}

/** Pill for a workflow or agent run status (unknown statuses render neutral). Built on StatusPill. */
export function RunStatusBadge({ status }: { status: string }) {
  return <StatusPill status={status} />
}
