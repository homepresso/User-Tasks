'use client'

import { useMemo } from 'react'
import { PageHeader } from '@/components/ui/page-header'
import { ReportMetricRow } from '@/components/reports/report-metric-row'
import { ReportChart } from '@/components/reports/lazy-charts'
import { ReportDataTable } from '@/components/reports/report-data-table'
import { ReportExportButton } from '@/components/reports/report-export'
import { ReportDateFilter } from '@/components/reports/report-filters'
import { OVERDUE_BUCKETS, TASK_PRIORITIES, TASK_STATUSES, type TaskSummary } from '@/lib/reports/task-summary'

interface Props {
  days: number
  onDaysChange: (days: number) => void
  /** Counted in the database for the selected range (lib/reports/task-summary.ts); null while loading. */
  summary: TaskSummary | null
  effortRecords: any[]
  recentCompleted: any[]
  userMap: Record<string, string>
}

const label = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export function TaskReportView({ days, onDaysChange, summary, effortRecords, recentCompleted, userMap }: Props) {
  const total = summary?.total ?? 0
  const completed = summary?.completed ?? 0
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0

  // Avg completion time (days)
  const avgCompletionDays = summary?.avg_completion_ms != null
    ? (summary.avg_completion_ms / 86400000).toFixed(1)
    : '—'

  const overdueCount = summary?.overdue.count ?? 0
  const overdueRate = total > 0 ? Math.round((overdueCount / total) * 100) : 0

  // Status distribution
  const statusCounts = TASK_STATUSES.map(s => ({
    name: label(s),
    value: summary?.status[s] ?? 0,
  })).filter(s => s.value > 0)

  // Completion trend (weekly for 12 weeks)
  const weeklyCompleted = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 12 }, (_, idx) => {
      const i = 11 - idx
      const weekEnd = new Date(now)
      weekEnd.setDate(weekEnd.getDate() - i * 7)
      const weekStart = new Date(weekEnd)
      weekStart.setDate(weekStart.getDate() - 7)
      return { name: `${weekStart.getDate()}/${weekStart.getMonth() + 1}`, completed: summary?.weekly[idx] ?? 0 }
    })
  }, [summary])

  // Priority breakdown
  const priorityCounts = TASK_PRIORITIES.map(p => ({
    name: p.charAt(0).toUpperCase() + p.slice(1),
    value: summary?.priority[p] ?? 0,
  })).filter(p => p.value > 0)

  // Effort accuracy scatter
  const effortScatter = useMemo(() => {
    const taskEffort = new Map<string, { estimated: number; actual: number }>()
    effortRecords.forEach((r: any) => {
      if (!taskEffort.has(r.task_id)) taskEffort.set(r.task_id, { estimated: 0, actual: 0 })
      const e = taskEffort.get(r.task_id)!
      if (r.record_type === 'assigner_estimate') e.estimated += r.minutes
      else if (r.record_type === 'actual' || r.record_type === 'timer_entry') e.actual += r.minutes
    })
    return [...taskEffort.values()].filter(e => e.estimated > 0 && e.actual > 0)
  }, [effortRecords])

  // Overdue by severity
  const overdueBuckets = OVERDUE_BUCKETS.map((b, i) => ({ name: b.name, value: summary?.overdue.buckets[i] ?? 0 }))

  // Assignee leaderboard
  const assigneeLeaderboard = useMemo(() => (summary?.leaderboard ?? [])
    .map(({ assignee_id, count }) => ({ name: userMap[assignee_id] ?? assignee_id.slice(0, 8), value: count })), [summary, userMap])

  const exportColumns = [
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'created_at', label: 'Created' },
    { key: 'completed_at', label: 'Completed' },
    { key: 'assignee_name', label: 'Assignee' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Task analytics' }]}
        title="Task analytics"
        description="Completion, priority and overdue work across every task."
        className="mb-0"
        actions={
          <>
            <ReportDateFilter days={days} onDaysChange={onDaysChange} />
            <ReportExportButton data={recentCompleted} columns={exportColumns} filename="task-report" />
          </>
        }
      />

      <ReportMetricRow metrics={[
        { label: 'Total tasks', value: total },
        { label: 'Completion rate', value: `${completionRate}%`, subtitle: `${completed} completed` },
        { label: 'Avg completion', value: `${avgCompletionDays}d`, subtitle: 'Created to completed' },
        { label: 'Overdue rate', value: `${overdueRate}%`, subtitle: `${overdueCount} overdue` },
      ]} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReportChart type="pie" data={statusCounts} title="Status distribution" />
        <ReportChart type="line" data={weeklyCompleted} xKey="name" yKeys={['completed']} title="Completion Trend (12 weeks)" />
        <ReportChart type="bar" data={priorityCounts} xKey="name" yKeys={['value']} title="Priority breakdown" />
        <ReportChart type="bar" data={overdueBuckets} xKey="name" yKeys={['value']} title="Overdue by severity" />
        {effortScatter.length > 0 && (
          <ReportChart type="scatter" data={effortScatter} xKey="estimated" yKeys={['actual']} title="Effort: Estimated vs Actual (minutes)" />
        )}
        {assigneeLeaderboard.length > 0 && (
          <ReportChart type="bar" data={assigneeLeaderboard} xKey="name" yKeys={['value']} title="Top assignees (completed)" />
        )}
      </div>

      <ReportDataTable
        title="Recently completed tasks"
        columns={[
          { key: 'title', label: 'Title' },
          { key: 'priority', label: 'Priority', render: (v: string) => <span className="capitalize">{v ?? '—'}</span> },
          { key: 'assignee_name', label: 'Assignee' },
          { key: 'created_at', label: 'Created', type: 'date' },
          { key: 'completed_at', label: 'Completed', type: 'date' },
        ]}
        data={recentCompleted}
        rowHref={(row) => row?.id ? `/tasks/${row.id}` : null}
      />
    </div>
  )
}
