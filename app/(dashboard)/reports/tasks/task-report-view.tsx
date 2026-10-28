'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ReportMetricRow } from '@/components/reports/report-metric-row'
import { ReportChart } from '@/components/reports/lazy-charts'
import { ReportDataTable } from '@/components/reports/report-data-table'
import { ReportExportButton } from '@/components/reports/report-export'
import { ReportDateFilter, getDateFrom } from '@/components/reports/report-filters'

interface Props {
  allTasks: any[]
  completedRecent: any[]
  effortRecords: any[]
  overdueTasks: any[]
  recentCompleted: any[]
  userMap: Record<string, string>
}

export function TaskReportView({ allTasks, completedRecent, effortRecords, overdueTasks, recentCompleted, userMap }: Props) {
  const [days, setDays] = useState(30)

  const dateFrom = getDateFrom(days)
  const tasks = useMemo(() => {
    if (!dateFrom) return allTasks
    return allTasks.filter(t => new Date(t.created_at) >= dateFrom)
  }, [allTasks, dateFrom])

  const total = tasks.length
  const completed = tasks.filter(t => t.status === 'completed').length
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0

  // Avg completion time (days)
  const completedWithDates = tasks.filter(t => t.status === 'completed' && t.completed_at && t.created_at)
  const avgCompletionDays = completedWithDates.length > 0
    ? (completedWithDates.reduce((sum, t) => sum + (new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()), 0) / completedWithDates.length / 86400000).toFixed(1)
    : '—'

  const overdueRate = total > 0 ? Math.round((overdueTasks.length / total) * 100) : 0

  // Status distribution
  const statusCounts = ['todo', 'in_progress', 'blocked', 'completed', 'cancelled'].map(s => ({
    name: s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    value: tasks.filter(t => t.status === s).length,
  })).filter(s => s.value > 0)

  // Completion trend (weekly for 12 weeks)
  const weeklyCompleted = useMemo(() => {
    const weeks: { name: string; completed: number }[] = []
    const now = new Date()
    for (let i = 11; i >= 0; i--) {
      const weekEnd = new Date(now)
      weekEnd.setDate(weekEnd.getDate() - i * 7)
      const weekStart = new Date(weekEnd)
      weekStart.setDate(weekStart.getDate() - 7)
      const count = completedRecent.filter(t => {
        const d = new Date(t.completed_at)
        return d >= weekStart && d < weekEnd
      }).length
      const label = `${weekStart.getDate()}/${weekStart.getMonth() + 1}`
      weeks.push({ name: label, completed: count })
    }
    return weeks
  }, [completedRecent])

  // Priority breakdown
  const priorityCounts = ['critical', 'high', 'medium', 'low', 'none'].map(p => ({
    name: p.charAt(0).toUpperCase() + p.slice(1),
    value: tasks.filter(t => (t.priority ?? 'none') === p).length,
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
  const overdueBuckets = useMemo(() => {
    const buckets = [
      { name: '1-3 days', min: 1, max: 3, count: 0 },
      { name: '4-7 days', min: 4, max: 7, count: 0 },
      { name: '8-14 days', min: 8, max: 14, count: 0 },
      { name: '15+ days', min: 15, max: 9999, count: 0 },
    ]
    const now = new Date()
    overdueTasks.forEach(t => {
      const daysLate = Math.floor((now.getTime() - new Date(t.due_date).getTime()) / 86400000)
      const bucket = buckets.find(b => daysLate >= b.min && daysLate <= b.max)
      if (bucket) bucket.count++
    })
    return buckets.map(b => ({ name: b.name, value: b.count }))
  }, [overdueTasks])

  // Assignee leaderboard
  const assigneeLeaderboard = useMemo(() => {
    const counts = new Map<string, number>()
    tasks.filter(t => t.status === 'completed' && t.assignee_id).forEach(t => {
      counts.set(t.assignee_id, (counts.get(t.assignee_id) ?? 0) + 1)
    })
    return [...counts.entries()]
      .map(([id, count]) => ({ name: userMap[id] ?? id.slice(0, 8), value: count }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
  }, [tasks, userMap])

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/reports" className="p-1.5 rounded-lg hover:bg-[var(--theme-surface)] transition-colors" style={{ color: 'var(--theme-muted-text)' }}>
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>Task Analytics</h1>
        </div>
        <div className="flex items-center gap-3">
          <ReportDateFilter days={days} onDaysChange={setDays} />
          <ReportExportButton data={recentCompleted} columns={exportColumns} filename="task-report" />
        </div>
      </div>

      <ReportMetricRow metrics={[
        { label: 'Total Tasks', value: total },
        { label: 'Completion Rate', value: `${completionRate}%`, subtitle: `${completed} completed` },
        { label: 'Avg Completion', value: `${avgCompletionDays}d`, subtitle: 'Created to completed' },
        { label: 'Overdue Rate', value: `${overdueRate}%`, subtitle: `${overdueTasks.length} overdue` },
      ]} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ReportChart type="pie" data={statusCounts} title="Status Distribution" />
        <ReportChart type="line" data={weeklyCompleted} xKey="name" yKeys={['completed']} title="Completion Trend (12 weeks)" />
        <ReportChart type="bar" data={priorityCounts} xKey="name" yKeys={['value']} title="Priority Breakdown" />
        <ReportChart type="bar" data={overdueBuckets} xKey="name" yKeys={['value']} title="Overdue by Severity" />
        {effortScatter.length > 0 && (
          <ReportChart type="scatter" data={effortScatter} xKey="estimated" yKeys={['actual']} title="Effort: Estimated vs Actual (minutes)" />
        )}
        {assigneeLeaderboard.length > 0 && (
          <ReportChart type="bar" data={assigneeLeaderboard} xKey="name" yKeys={['value']} title="Top Assignees (Completed)" />
        )}
      </div>

      <ReportDataTable
        title="Recently Completed Tasks"
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
