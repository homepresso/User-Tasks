"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Clock } from "lucide-react"
import { StatusPill } from "@/components/ui/badge"
import { ProgressBar } from "@/components/ui/progress-bar"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip } from "@/components/ui/tooltip"
import { serverQuery } from "@/lib/server-read"
import { formatAbsolute, formatDay } from "@/lib/format/date"
import { formatCount, formatPercent } from "@/lib/format/number"
import { plural } from "@/lib/format/plural"
import type { HomeTaskDetails } from "@/lib/services/home"
import { HOME_QUERY_KEY } from "./shared"

/** The path that opens a task straight at its form (the task page's form card). */
export function taskFormPath(taskId: string): string {
  return `/tasks/${taskId}#task-form`
}

/**
 * An expanded My tasks row: the task's link, description, key
 * form fields and direct subtasks (title, status, assignee, due, progress).
 * Read only when the row opens (home.taskDetails, same visibility as the list).
 */
export function TaskRowDetails({ taskId, title, id }: { taskId: string; title: string; id: string }) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: [...HOME_QUERY_KEY, "taskDetails", taskId],
    queryFn: async () => (await serverQuery("home.taskDetails", { id: taskId })) as HomeTaskDetails,
    staleTime: 30_000,
  })
  return (
    <div id={id} className="space-y-3 border-t border-border-subtle bg-subtle px-4 py-3 text-ui" data-home-task-details={taskId}>
      {isPending ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading task details">
          <Skeleton className="h-2.5 w-2/3" />
          <Skeleton className="h-2.5 w-1/2" />
          <Skeleton className="h-2.5 w-1/3" />
        </div>
      ) : isError ? (
        <p role="alert" className="text-xs text-danger">{(error as Error)?.message || "This task’s details couldn’t be loaded."}</p>
      ) : (
        <>
          <p className="text-fg-muted">
            {data.description ?? "No description."}{" "}
            <Link href={`/tasks/${taskId}`} className="font-medium text-primary-text hover:underline" aria-label={`Open task: ${title}`}>Open task</Link>
          </p>
          {data.fields.length > 0 && (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 @xl:grid-cols-2 @4xl:grid-cols-3" data-home-task-fields>
              {data.fields.map((f) => (
                <div key={f.key} className="min-w-0">
                  <dt className="text-xs text-fg-muted">{f.label}</dt>
                  <dd className="truncate font-medium text-fg">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {data.total > 0 && <Subtasks details={data} />}
        </>
      )}
    </div>
  )
}

function Subtasks({ details }: { details: HomeTaskDetails }) {
  const pct = details.total ? (details.completed / details.total) * 100 : 0
  return (
    <section aria-label="Subtasks" className="space-y-1.5" data-home-subtasks>
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <span className="font-medium text-fg">Subtasks</span>
        <span className="num">{formatCount(details.completed)} of {plural(details.total, "subtask")} completed</span>
        <ProgressBar value={pct} size="sm" className="w-16" label={`${formatPercent(pct / 100)} of subtasks completed`} />
      </div>
      <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle bg-panel">
        {details.subtasks.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5" data-home-subtask={s.id}>
            <Link href={`/tasks/${s.id}`} className="min-w-0 flex-1 truncate font-medium text-fg hover:underline">{s.title || "Untitled task"}</Link>
            <StatusPill status={s.status} />
            <span className="w-28 truncate text-xs text-fg-muted">{s.assignee ?? "Unassigned"}</span>
            <span className="w-24 text-right text-xs">
              {s.due_date ? (
                <Tooltip content={formatAbsolute(s.due_date)}>
                  <span tabIndex={0} className={s.overdue ? "num inline-flex items-center gap-1 text-danger" : "num text-fg-muted"}>
                    {s.overdue && <Clock className="size-3.5" aria-hidden="true" />}
                    {formatDay(s.due_date)}{s.overdue && <span className="sr-only"> (overdue)</span>}
                  </span>
                </Tooltip>
              ) : <span className="text-fg-subtle">No due date</span>}
            </span>
            <span className="flex w-24 items-center gap-1.5">
              {s.total > 0 ? (
                <>
                  <ProgressBar value={(s.completed / s.total) * 100} size="sm" className="w-12" label={`${s.title}: ${s.completed} of ${s.total} done`} />
                  <span className="num text-xs text-fg-muted">{s.completed}/{s.total}</span>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {details.total > details.subtasks.length && (
        <p className="text-xs text-fg-muted">Showing the first {formatCount(details.subtasks.length)}; the task page lists them all.</p>
      )}
    </section>
  )
}
