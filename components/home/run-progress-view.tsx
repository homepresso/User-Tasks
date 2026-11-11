"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useQuery } from "@tanstack/react-query"
import { ExternalLink, Eye, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { IconButton } from "@/components/ui/icon-button"
import { PageHeader } from "@/components/ui/page-header"
import { floatingSurfaceClass } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { PageSkeleton } from "@/components/ui/page-skeleton"
import { serverRead } from "@/lib/server-read"
import { overlayFromSafe } from "@/lib/home/progress"
import type { SummaryLookups } from "@/lib/workflow-utils"
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow-schema"
import { FollowButton, HOME_QUERY_KEY, ProgressPill, When } from "./shared"
import { SubmissionDialog } from "./submission-dialog"
import { TimelineButton } from "@/components/timeline/timeline-sheet"
import { RunStepTasks, RunTaskOpenLink, RunTaskSteps, RunWaitingChip, runStepBadges } from "@/components/automations/run-task-links"

const RuntimeCanvas = dynamic(() => import("@/components/automations/runtime-canvas").then((m) => m.RuntimeCanvas), {
  loading: () => <PageSkeleton variant="detail" />,
})

/** No lookups: the progress view never loads workspace records for card summaries. */
const NO_LOOKUPS: SummaryLookups = {}

/**
 * "Process view" for a run someone may follow (their submission's, their own,
 * one they have a task in): the diagram with completed and current steps,
 * step names, who has each task and when. No configs, outputs, variables or
 * form values — the read (home.runProgress) never sends them.
 */
export function RunProgressView({ runId }: { runId: string }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [viewing, setViewing] = useState(false)
  const { data, isPending, error } = useQuery({
    queryKey: [...HOME_QUERY_KEY, "runProgress", runId],
    queryFn: async () => {
      const result = await serverRead("home.runProgress", { id: runId })
      if (result.error) throw new Error(result.error.status === 404 ? "This process isn’t available to you." : result.error.message)
      return result.data!
    },
    refetchInterval: 30_000,
  })
  const overlay = useMemo(() => (data ? overlayFromSafe(data.flow.overlay) : undefined), [data])

  if (isPending) return <PageSkeleton variant="detail" />
  if (error || !data) {
    return (
      <EmptyState variant="error" title="This process isn’t available" description={(error as Error | null)?.message ?? "Not found"}
        action={{ label: "Back to Home", href: "/home" }} />
    )
  }

  const tasks = data.tasks ?? []
  const waiting = tasks.filter((t) => t.open)
  const stepsAt = selected && !tasks.some((t) => t.node_id === selected) ? data.steps.filter((s) => s.node_id === selected) : []
  const selectedName = selected ? data.flow.nodes.find((n) => n.id === selected)?.label : null
  const selectedStatus = selected ? overlay?.nodes[selected]?.status : null

  return (
    <div className="space-y-4" data-run-progress={runId}>
      <PageHeader
        className="mb-0"
        breadcrumbs={[{ label: "Home", href: "/home" }, { label: data.process.name }]}
        title={data.process.name}
        badge={<ProgressPill status={data.run.status} />}
        description={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span data-progress-label className="text-fg">{data.run.status_label}</span>
          <span>· started <When at={data.run.started_at} /></span>
          <span>· updated <When at={data.run.updated_at} /></span>
          {data.submission && <span>· started by your submission of <span className="font-medium text-fg">{data.submission.form_name}</span> · <When at={data.submission.submitted_at} /></span>}
        </span>}
        actions={<>
          {data.submission && <Button size="sm" variant="ghost" leadingIcon={<Eye />} onClick={() => setViewing(true)}>View submission</Button>}
          <TimelineButton target={{ runId }} />
          <FollowButton runId={runId} following={data.following} />
          {data.can_view_full && (
            <Button size="sm" variant="secondary" asChild><Link href={`/automations/runs/${runId}`}><ExternalLink className="size-3.5" aria-hidden /> Full run view</Link></Button>
          )}
        </>}
      />
      {waiting.length > 0 && <RunWaitingChip tasks={waiting} />}
      {data.stages.length > 0 && (
        <Card padding="md">
          <ul className="grid gap-2 sm:grid-cols-2" data-current-stages>
            {data.stages.map((s, i) => (
              <li key={`${s.node_id}-${i}`} className="rounded-md bg-subtle px-3 py-2 text-ui">
                <p className="flex items-center gap-2 font-medium text-fg">
                  <span className="min-w-0 flex-1 truncate">Now: {s.name}</span>
                  {waiting.filter((t) => t.node_id === s.node_id).map((t) => <RunTaskOpenLink key={t.id} task={t} showWaitingText={false} />)}
                </p>
                <p className="text-xs text-fg-muted">
                  With {s.assignees.length ? s.assignees.map((a) => a.name).join(", ") : s.team ? `the ${s.team} team` : "no one (an automatic step)"}
                  {s.since ? <> · since <When at={s.since} /></> : null}
                  {s.due_date ? <> · due <When at={s.due_date} /></> : null}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="relative">
        <RuntimeCanvas
          nodes={data.flow.nodes as unknown as WorkflowNode[]}
          edges={data.flow.edges as unknown as WorkflowEdge[]}
          overlay={overlay}
          stepDetails={false}
          lookups={NO_LOOKUPS}
          selectedNodeId={selected}
          onSelectNode={setSelected}
          storageScope={`progress:${runId}`}
          markerPrefix="progress-arrow"
          label="Process progress"
          height="min(70vh, 640px)"
          nodeAdornments={runStepBadges(tasks)}
        />
        {selected && (
          <div role="dialog" aria-label={`Step: ${selectedName ?? ""}`} className={cn(floatingSurfaceClass, "absolute right-3 top-14 z-30 max-h-[calc(100%-72px)] w-80 max-w-[calc(100%-24px)] overflow-y-auto border border-border p-3 text-xs")} data-progress-step>
            <div className="flex items-center gap-2">
              <p className="flex-1 truncate font-medium">{selectedName}</p>
              <IconButton size="sm" label="Close" icon={<X />} onClick={() => setSelected(null)} />
            </div>
            <p className="mt-1 text-fg-muted">{selectedStatus === "completed" ? "Done" : selectedStatus === "waiting" || selectedStatus === "running" ? "In progress" : selectedStatus === "failed" ? "Stopped here" : selectedStatus === "skipped" ? "Skipped" : "Not reached"}</p>
            <div className="mt-2"><RunStepTasks tasks={tasks} nodeId={selected} /></div>
            {stepsAt.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {stepsAt.map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.assignees.join(", ") || (s.team ? `${s.team} team` : "Unassigned")}</span>
                    <span className="text-fg-muted"> · {s.status === "completed" ? <>done <When at={s.completed_at} /></> : s.status === "skipped" ? "closed" : <>since <When at={s.started_at} /></>}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {tasks.length > 0 ? (
        <Card padding="md">
          <h2 className="mb-2 text-base font-semibold text-fg">Steps so far</h2>
          <div data-progress-steps><RunTaskSteps tasks={tasks} onFocusStep={setSelected} /></div>
        </Card>
      ) : data.steps.length > 0 && (
        <Card padding="md">
          <h2 className="mb-2 text-base font-semibold text-fg">Steps so far</h2>
          <ol className="space-y-1.5 text-ui" data-progress-steps>
            {data.steps.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className={cn("inline-block size-2 rounded-full", s.status === "completed" ? "bg-success" : s.status === "current" ? "bg-warning" : "bg-fg-subtle")} aria-hidden />
                <span className="font-medium text-fg">{s.name}</span>
                <span className="text-xs text-fg-muted">
                  {s.assignees.join(", ") || (s.team ? `${s.team} team` : "")} · {s.status === "completed" ? <>completed <When at={s.completed_at} /></> : s.status === "skipped" ? "closed" : <>waiting since <When at={s.started_at} /></>}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}
      {data.submission && (
        <SubmissionDialog submission={viewing ? { id: data.submission.id, form_id: data.submission.form_id, form_name: data.submission.form_name } : null} onClose={() => setViewing(false)} />
      )}
    </div>
  )
}
