"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { QueueActions } from '@/components/automations/queue-actions'
import { QueueList } from '@/components/automations/queue-list'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard, StatGrid } from '@/components/ui/stat-card'
import { formatCount } from '@/lib/format/number'
import { usePermissions } from '@/lib/permissions-context'

type StatTone = 'default' | 'success' | 'warning' | 'danger' | 'info'

export default function QueuePage() {
  const { can } = usePermissions()
  // Full queue for workflows.view_runs; the runs you're involved in (and granted workflows) otherwise.
  const allRuns = can('workflows.view_runs')
  const { data, isLoading } = useQuery({
    queryKey: ['workflow-queue'],
    queryFn: () => serverQuery('automations.queue'),
  })

  if (isLoading && !data) return <PageSkeleton variant="list" />
  if (!data) return <PageSkeleton variant="list" />

  const { counts, jobs, runs, waitingCount, pausedCount } = data
  const statuses = ["pending", "processing", "failed", "completed", "dead"] as const
  const statusLabels: Record<string, string> = { pending: 'Pending', processing: 'Processing', failed: 'Failed', completed: 'Completed', dead: 'Dead' }
  // Tones follow statusTone() (dead jobs are terminal failures → danger); a zero stays neutral.
  const statusTones: Record<string, StatTone> = { pending: 'default', processing: 'info', completed: 'success', failed: 'danger', dead: 'danger' }
  const toneFor = (tone: StatTone, n: number): StatTone => (n > 0 ? tone : 'default')

  return (
    <div>
      <PageHeader
        title="Workflow queue"
        description={allRuns ? "Monitor and manage workflow executions" : "The workflow runs you're involved in, and every run of workflows shared with you"}
        actions={can('workflows.activate') ? <QueueActions /> : undefined}
      />

      <div className="space-y-6">
        <StatGrid>
          {statuses.map((status) => (
            <StatCard key={status} label={statusLabels[status]} value={formatCount(counts[status])} tone={toneFor(statusTones[status], counts[status])} />
          ))}
          <StatCard label="Awaiting" value={formatCount(waitingCount)} tone={toneFor('warning', waitingCount)} hint="Runs waiting for an event, a task or a timer" />
          <StatCard label="Paused" value={formatCount(pausedCount)} tone={toneFor('warning', pausedCount)} />
        </StatGrid>

        <section aria-labelledby="queue-executions">
          <h2 id="queue-executions" className="mb-3 text-base font-semibold text-fg">Executions</h2>
          <QueueList jobs={jobs} runs={runs} />
        </section>
      </div>
    </div>
  )
}
