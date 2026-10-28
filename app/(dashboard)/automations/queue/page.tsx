"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Clock, CheckCircle, XCircle, AlertTriangle, RefreshCw } from 'lucide-react'
import { QueueActions } from '@/components/automations/queue-actions'
import { QueueList } from '@/components/automations/queue-list'
import { PageSkeleton } from '@/components/ui/page-skeleton'

export default function QueuePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['workflow-queue'],
    queryFn: () => serverQuery('automations.queue'),
  })

  if (isLoading && !data) return <PageSkeleton variant="list" />
  if (!data) return <PageSkeleton variant="list" />

  const { counts, jobs, runs, waitingCount, pausedCount } = data
  const statuses = ["pending", "processing", "failed", "completed", "dead"] as const
  const statusIcons: Record<string, any> = { pending: Clock, processing: RefreshCw, completed: CheckCircle, failed: XCircle, dead: AlertTriangle }
  const statusColors: Record<string, string> = { pending: "var(--theme-muted-text)", processing: "var(--theme-primary)", completed: "var(--theme-success)", failed: "var(--theme-warning)", dead: "var(--theme-danger)" }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Workflow Queue</h1>
          <p className="text-xs mt-1" style={{ color: "var(--theme-muted-text)" }}>Monitor and manage workflow executions</p>
        </div>
        <QueueActions />
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-7 gap-3">
        {statuses.map((status) => {
          const Icon = statusIcons[status] ?? Clock
          return (
            <Card key={status} className="!p-3">
              <div className="flex items-center gap-2 mb-1">
                <Icon size={14} style={{ color: statusColors[status] }} />
                <p className="text-[10px] font-medium capitalize" style={{ color: "var(--theme-muted-text)" }}>{status}</p>
              </div>
              <p className="text-2xl font-bold">{counts[status]}</p>
            </Card>
          )
        })}
        <Card className="!p-3">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} className="animate-pulse" style={{ color: "var(--theme-warning)" }} />
            <p className="text-[10px] font-medium" style={{ color: "var(--theme-muted-text)" }}>Awaiting</p>
          </div>
          <p className="text-2xl font-bold" style={{ color: "var(--theme-warning)" }}>{waitingCount}</p>
        </Card>
        <Card className="!p-3">
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} style={{ color: "#8B5CF6" }} />
            <p className="text-[10px] font-medium" style={{ color: "var(--theme-muted-text)" }}>Paused</p>
          </div>
          <p className="text-2xl font-bold" style={{ color: "#8B5CF6" }}>{pausedCount}</p>
        </Card>
      </div>

      <Card>
        <h3 className="text-sm font-semibold mb-3">Executions</h3>
        <QueueList jobs={jobs} runs={runs} />
      </Card>
    </div>
  )
}
