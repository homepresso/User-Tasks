'use client'

/**
 * What a row of the embeddable task list expands to (components/embed/embed-task-list.tsx),
 * loaded only when a row first opens (next/dynamic) — all of it the app's own components and
 * reads, nothing re-implemented:
 *
 *  - details: the task lists' quick panel (TaskDetailPanel: status, priority, due, people,
 *    progress — editable where the app allows — effort, subtasks with tick / add, latest
 *    activity) plus the task page's Comments (ActivityTimeline: read + add) and Attachments;
 *  - process: the run's process graph with step statuses (RuntimeCanvas, the read of the
 *    Home process view `home.runProgress`), read-only and compact, with the steps so far;
 *  - timeline: the task / run history (RunTimeline).
 */

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { TaskDetailPanel } from '@/components/tasks/task-detail-panel'
import { ActivityTimeline } from '@/components/tasks/timeline'
import { TaskAttachmentsTab } from '@/components/tasks/task-attachments-tab'
import { RunTimeline } from '@/components/timeline/run-timeline'
import { RunTaskSteps, runStepBadges } from '@/components/automations/run-task-links'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { PanelSkeleton } from './embed-task-panels-skeleton'
import { listTaskEvents } from '@/app/actions/activity'
import { serverRead } from '@/lib/server-read'
import { overlayFromSafe } from '@/lib/home/progress'
import type { SummaryLookups } from '@/lib/workflow-utils'
import type { WorkflowEdge, WorkflowNode } from '@/lib/workflow-schema'

const RuntimeCanvas = dynamic(() => import('@/components/automations/runtime-canvas').then((m) => m.RuntimeCanvas), {
  ssr: false,
  loading: () => <PanelSkeleton tall />,
})

const NO_LOOKUPS: SummaryLookups = {}

/* ── details ─────────────────────────────────────────────────────────── */

export function EmbedTaskDetails({ taskId, title, readOnly }: { taskId: string; title: string; readOnly: boolean }) {
  const [view, setView] = useState<'comments' | 'attachments'>('comments')
  return (
    <div className="space-y-3" data-embed-task-details={taskId}>
      {/* A closed task's panel reads only: the panel's own server flags (`can`) already refuse edits on it. */}
      <TaskDetailPanel taskId={taskId} title={title} compact />
      <div className="rounded-md border border-border-subtle bg-panel p-3">
        <SegmentedControl
          size="sm" aria-label="Comments or attachments"
          options={[{ value: 'comments', text: 'Comments' }, { value: 'attachments', text: 'Attachments' }]}
          value={view} onValueChange={setView}
        />
        <div className="mt-2">
          {view === 'comments' ? <EmbedTaskComments taskId={taskId} readOnly={readOnly} /> : <TaskAttachmentsTab taskId={taskId} tenantId="" canEdit={!readOnly} />}
        </div>
      </div>
    </div>
  )
}

function EmbedTaskComments({ taskId, readOnly }: { taskId: string; readOnly: boolean }) {
  const { data, isPending } = useQuery({
    queryKey: ['task-events', taskId],
    queryFn: async () => {
      const result = await listTaskEvents(taskId)
      return result.ok ? (result.data as never[]) : []
    },
  })
  if (isPending) return <PanelSkeleton />
  return <div data-embed-task-comments={taskId}><ActivityTimeline events={data ?? []} taskId={taskId} tenantId="" readOnly={readOnly} /></div>
}

/* ── process view ───────────────────────────────────────────────────── */

export function EmbedProcessView({ runId }: { runId: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['home', 'runProgress', runId],
    queryFn: async () => {
      const result = await serverRead('home.runProgress', { id: runId })
      if (result.error) throw new Error(result.error.status === 404 ? 'This process isn’t available to you.' : result.error.message)
      return result.data!
    },
  })
  if (isPending) return <PanelSkeleton tall />
  if (error || !data) return <p className="py-4 text-center text-sm text-fg-muted" role="alert">{(error as Error | null)?.message ?? 'This process isn’t available.'}</p>
  const overlay = overlayFromSafe(data.flow.overlay)
  const tasks = data.tasks ?? []
  return (
    <div className="space-y-3" data-embed-process={runId}>
      <p className="text-xs text-fg-muted"><span className="font-medium text-fg">{data.process.name}</span> · {data.run.status_label}</p>
      <RuntimeCanvas
        nodes={data.flow.nodes as unknown as WorkflowNode[]}
        edges={data.flow.edges as unknown as WorkflowEdge[]}
        overlay={overlay}
        stepDetails={false}
        lookups={NO_LOOKUPS}
        selectedNodeId={null}
        onSelectNode={() => undefined}
        storageScope={`embed-progress:${runId}`}
        markerPrefix={`embed-arrow-${runId.slice(0, 8)}`}
        label="Process progress"
        height="340px"
        nodeAdornments={runStepBadges(tasks)}
      />
      {tasks.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-fg-muted">Steps so far</h4>
          <RunTaskSteps tasks={tasks} />
        </div>
      )}
    </div>
  )
}

/* ── timeline ───────────────────────────────────────────────────────── */

export function EmbedTimeline({ taskId }: { taskId: string }) {
  return <div data-embed-timeline={taskId}><RunTimeline target={{ taskId }} showLinks={false} /></div>
}
