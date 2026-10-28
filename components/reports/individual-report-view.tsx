'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  GitBranch,
  TimerReset,
  Workflow,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { ReportMetricRow } from '@/components/reports/report-metric-row'
import { formatRelativeDate } from '@/lib/utils'
import { PersonalActivityTimeline } from '@/components/reports/personal-activity-timeline'
import { useWorkspaceTheme, useThemeChartColors } from '@/components/providers/theme-provider'
import type { ThemePalette } from '@/lib/theme/schema'

interface Props {
  assignedTasks: any[]
  completedTasks: any[]
  escalations: any[]
  lifecycleEvents: any[]
}

/** Real colour strings for Recharts (which can't resolve CSS variables). */
function statusFill(status: string, palette: ThemePalette): string {
  switch (status) {
    case 'in_progress': return palette.status.info
    case 'blocked': return palette.status.progress
    case 'completed': return palette.status.done
    case 'escalated': return palette.status.blocked
    default: return palette.status.todo
  }
}

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`
  return `${(ms / 86_400_000).toFixed(1)}d`
}

function startOfWeek(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + diff)
  return d
}

function formatWeekLabel(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatFullDateTime(date: string | Date) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date))
}

export function IndividualReportView({ assignedTasks, completedTasks, escalations, lifecycleEvents }: Props) {
  const now = Date.now()
  const { palette } = useWorkspaceTheme()
  const chartColors = useThemeChartColors()

  const completedTaskMap = useMemo(
    () => new Map((completedTasks ?? []).map((task) => [task.id, task])),
    [completedTasks]
  )

  const allInvolvedTasks = useMemo(() => {
    const merged = new Map<string, any>()
    for (const task of assignedTasks ?? []) merged.set(task.id, task)
    for (const task of completedTasks ?? []) merged.set(task.id, task)
    return [...merged.values()]
  }, [assignedTasks, completedTasks])

  const analytics = useMemo(() => {
    const activeStatuses = new Set(['todo', 'in_progress', 'blocked', 'escalated'])
    const outstanding = (assignedTasks ?? []).filter((task) => task.status !== 'completed')
    const overdue = outstanding.filter((task) => task.due_date && new Date(task.due_date).getTime() < now)
    const dueSoon = outstanding.filter((task) => {
      if (!task.due_date) return false
      const due = new Date(task.due_date).getTime()
      return due >= now && due <= now + 3 * 86_400_000
    })
    const completed30d = (completedTasks ?? []).filter((task) => {
      if (!task.completed_at) return false
      return new Date(task.completed_at).getTime() >= now - 30 * 86_400_000
    })
    const workflowTasks = allInvolvedTasks.filter((task) => task.is_workflow_task)
    const openEscalations = (escalations ?? []).filter((entry) => !entry.task?.completed_at)

    const completedDurations = (completedTasks ?? [])
      .map((task) => {
        const start = task.started_at ?? task.created_at
        if (!start || !task.completed_at) return null
        return new Date(task.completed_at).getTime() - new Date(start).getTime()
      })
      .filter((value): value is number => typeof value === 'number' && value > 0)

    const onTimeEligible = (completedTasks ?? []).filter((task) => task.completed_at && task.due_date)
    const onTimeCount = onTimeEligible.filter((task) => new Date(task.completed_at).getTime() <= new Date(task.due_date).getTime()).length

    const effortVariance = (completedTasks ?? [])
      .map((task) => {
        const estimate = Number(task.estimated_effort_assignee ?? task.estimated_effort_assigner ?? 0)
        const actual = Number(task.actual_effort ?? 0)
        if (estimate <= 0 || actual <= 0) return null
        return Math.abs(actual - estimate) / estimate
      })
      .filter((value): value is number => typeof value === 'number')

    const weeklyMap = new Map<string, { label: string; created: number; completed: number }>()
    for (let offset = 11; offset >= 0; offset--) {
      const bucketDate = startOfWeek(new Date(now - offset * 7 * 86_400_000))
      const key = bucketDate.toISOString()
      weeklyMap.set(key, { label: formatWeekLabel(bucketDate), created: 0, completed: 0 })
    }
    for (const task of allInvolvedTasks) {
      if (task.created_at) {
        const key = startOfWeek(new Date(task.created_at)).toISOString()
        if (weeklyMap.has(key)) weeklyMap.get(key)!.created += 1
      }
      if (task.completed_at) {
        const key = startOfWeek(new Date(task.completed_at)).toISOString()
        if (weeklyMap.has(key)) weeklyMap.get(key)!.completed += 1
      }
    }

    const statusRows = Object.entries(
      (assignedTasks ?? []).reduce<Record<string, number>>((acc, task) => {
        acc[task.status] = (acc[task.status] ?? 0) + 1
        return acc
      }, {})
    ).map(([status, count]) => ({
      name: status.replace(/_/g, ' '),
      value: count,
      fill: statusFill(status, palette),
    }))

    const workflowRows = Object.values(
      workflowTasks.reduce<Record<string, {
        name: string
        total: number
        active: number
        completed: number
      }>>((acc, task) => {
        // Native workflow tasks link via workflow_id; ingested tasks via their
        // external workflow source.
        const sourceId = task.workflow_id ?? task.workflow_source_id ?? 'unknown'
        const name = task.workflow?.name ?? task.workflow_source?.display_name ?? 'Workflow task'
        if (!acc[sourceId]) {
          acc[sourceId] = { name, total: 0, active: 0, completed: 0 }
        }
        acc[sourceId].total += 1
        if (activeStatuses.has(task.status)) acc[sourceId].active += 1
        if (task.status === 'completed') acc[sourceId].completed += 1
        return acc
      }, {})
    )
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)

    const attentionTasks = [...outstanding]
      .sort((a, b) => {
        const dueA = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY
        const dueB = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY
        if (dueA !== dueB) return dueA - dueB
        return (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99)
      })
      .slice(0, 8)

    const recentCompleted = [...(completedTasks ?? [])]
      .sort((a, b) => new Date(b.completed_at ?? 0).getTime() - new Date(a.completed_at ?? 0).getTime())
      .slice(0, 8)

    const timelineEvents = (lifecycleEvents ?? [])
      .map((event) => ({
        id: event.id,
        timestamp: event.created_at,
        eventType: event.event_type,
        taskId: event.task_id,
        taskTitle: event.task?.title ?? 'Task event',
        taskStatus: event.task?.status ?? null,
        summary: event.metadata?.comment
          ? `Commented on ${event.task?.title ?? 'a task'}`
          : `${String(event.event_type).replace(/_/g, ' ')}${event.task?.title ? ` · ${event.task.title}` : ''}`,
        metadata: event.metadata ?? {},
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    const timelineMap = new Map<string, { label: string; total: number; completed: number; started: number; escalated: number; redirected: number; commented: number }>()
    for (let offset = 13; offset >= 0; offset--) {
      const date = new Date(now - offset * 86_400_000)
      const key = date.toISOString().split('T')[0]
      timelineMap.set(key, {
        label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        total: 0,
        completed: 0,
        started: 0,
        escalated: 0,
        redirected: 0,
        commented: 0,
      })
    }
    for (const event of timelineEvents) {
      const key = new Date(event.timestamp).toISOString().split('T')[0]
      const bucket = timelineMap.get(key)
      if (!bucket) continue
      bucket.total += 1
      if (event.eventType === 'completed') bucket.completed += 1
      if (event.eventType === 'started') bucket.started += 1
      if (event.eventType === 'escalated') bucket.escalated += 1
      if (event.eventType === 'redirected' || event.eventType === 'reassigned' || event.eventType === 'delegated') bucket.redirected += 1
      if (event.eventType === 'comment_added') bucket.commented += 1
    }

    return {
      outstandingCount: outstanding.length,
      completed30dCount: completed30d.length,
      overdueCount: overdue.length,
      dueSoonCount: dueSoon.length,
      workflowTaskCount: workflowTasks.length,
      openEscalationsCount: openEscalations.length,
      avgCompletionMs: completedDurations.length > 0
        ? completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length
        : 0,
      onTimeRate: onTimeEligible.length > 0 ? Math.round((onTimeCount / onTimeEligible.length) * 100) : 0,
      avgEffortVariancePct: effortVariance.length > 0
        ? Math.round((effortVariance.reduce((sum, value) => sum + value, 0) / effortVariance.length) * 100)
        : null,
      weeklyTrend: [...weeklyMap.values()],
      statusRows,
      workflowRows,
      attentionTasks,
      recentCompleted,
      openEscalations: openEscalations.slice(0, 6),
      timelineEvents,
      timelineChart: [...timelineMap.values()],
    }
  }, [assignedTasks, completedTasks, escalations, lifecycleEvents, allInvolvedTasks, now, palette])

  return (
    <div className="space-y-6">
      <ReportMetricRow
        metrics={[
          { label: 'Outstanding', value: analytics.outstandingCount, subtitle: analytics.overdueCount > 0 ? `${analytics.overdueCount} overdue` : 'on your plate now' },
          { label: 'Completed (30d)', value: analytics.completed30dCount, subtitle: 'tasks you closed recently' },
          { label: 'Workflow Tasks', value: analytics.workflowTaskCount, subtitle: 'workflow-driven work items' },
          { label: 'Open Escalations', value: analytics.openEscalationsCount, subtitle: analytics.openEscalationsCount > 0 ? 'need attention' : 'nothing waiting' },
          { label: 'Avg Cycle Time', value: formatDuration(analytics.avgCompletionMs), subtitle: analytics.onTimeRate > 0 ? `${analytics.onTimeRate}% on time` : 'builds as due dates are used' },
        ]}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="!p-4 xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold">Throughput Trend</h3>
              <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                Created versus completed work across the last 12 weeks.
              </p>
            </div>
            <span className="text-[10px] px-2 py-1 rounded-full" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
              12 week view
            </span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={analytics.weeklyTrend}>
              <defs>
                <linearGradient id="individualCreatedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColors[0]} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={chartColors[0]} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="individualCompletedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColors[1]} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={chartColors[1]} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-surface-border)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--theme-muted-text)' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--theme-muted-text)' }} />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  backgroundColor: 'var(--theme-card-bg)',
                  border: '1px solid var(--theme-surface-border)',
                  color: 'var(--theme-card-text)',
                }}
              />
              <Area type="monotone" dataKey="created" stroke={chartColors[0]} strokeWidth={2} fill="url(#individualCreatedGradient)" />
              <Area type="monotone" dataKey="completed" stroke={chartColors[1]} strokeWidth={2} fill="url(#individualCompletedGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card className="!p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold">Current Workload</h3>
              <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                Your currently assigned tasks by status.
              </p>
            </div>
            <Activity size={15} style={{ color: 'var(--theme-primary-text)' }} />
          </div>
          {analytics.statusRows.length === 0 ? (
            <p className="text-xs py-16 text-center" style={{ color: 'var(--theme-muted-text)' }}>
              No assigned tasks yet.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={analytics.statusRows} layout="vertical" margin={{ left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-surface-border)" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--theme-muted-text)' }} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: 'var(--theme-muted-text)' }} />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    backgroundColor: 'var(--theme-card-bg)',
                    border: '1px solid var(--theme-surface-border)',
                    color: 'var(--theme-card-text)',
                  }}
                />
                <Bar dataKey="value" radius={[0, 5, 5, 0]}>
                  {analytics.statusRows.map((row, index) => (
                    <Cell key={index} fill={row.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="!p-4 xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold">Workflows You’re Involved In</h3>
              <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                Workflow-generated tasks you’ve touched, grouped by source.
              </p>
            </div>
            <Workflow size={15} style={{ color: 'var(--theme-primary-text)' }} />
          </div>
          {analytics.workflowRows.length === 0 ? (
            <p className="text-xs py-10 text-center" style={{ color: 'var(--theme-muted-text)' }}>
              No workflow-driven tasks have involved you yet.
            </p>
          ) : (
            <div className="space-y-3">
              {analytics.workflowRows.map((row) => (
                <div key={row.name} className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{row.name}</p>
                      <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                        {row.total} tasks touched
                      </p>
                    </div>
                    <div className="flex gap-2 text-[10px]">
                      <span className="px-2 py-1 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--status-info) 12%, transparent)', color: 'var(--status-info)' }}>
                        {row.active} active
                      </span>
                      <span className="px-2 py-1 rounded-full" style={{ backgroundColor: 'var(--theme-accent-light)', color: 'var(--theme-primary-text)' }}>
                        {row.completed} completed
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="!p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold">Performance Signals</h3>
              <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                Timing and reliability indicators from your completed work.
              </p>
            </div>
            <TimerReset size={15} style={{ color: 'var(--theme-primary-text)' }} />
          </div>
          <div className="space-y-3">
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>On-time rate</p>
              <p className="text-2xl font-semibold mt-1">{analytics.onTimeRate}%</p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>Based on completed tasks that had due dates.</p>
            </div>
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>Due soon</p>
              <p className="text-2xl font-semibold mt-1">{analytics.dueSoonCount}</p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>Outstanding tasks due in the next 3 days.</p>
            </div>
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>Effort variance</p>
              <p className="text-2xl font-semibold mt-1">
                {analytics.avgEffortVariancePct == null ? '—' : `${analytics.avgEffortVariancePct}%`}
              </p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                Average difference between estimate and actual effort when both exist.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="!p-4 xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold">Personal Activity Map</h3>
              <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                A daily map of the work events recorded against your activity.
              </p>
            </div>
            <Clock3 size={15} style={{ color: 'var(--theme-primary-text)' }} />
          </div>
          {analytics.timelineChart.every((row) => row.total === 0) ? (
            <p className="text-xs py-16 text-center" style={{ color: 'var(--theme-muted-text)' }}>
              No personal activity events recorded yet.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={analytics.timelineChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-surface-border)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--theme-muted-text)' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--theme-muted-text)' }} />
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    backgroundColor: 'var(--theme-card-bg)',
                    border: '1px solid var(--theme-surface-border)',
                    color: 'var(--theme-card-text)',
                  }}
                />
                <Bar dataKey="completed" stackId="activity" fill={chartColors[0]} radius={[0, 0, 0, 0]} />
                <Bar dataKey="started" stackId="activity" fill={chartColors[1]} radius={[0, 0, 0, 0]} />
                <Bar dataKey="escalated" stackId="activity" fill={chartColors[2]} radius={[0, 0, 0, 0]} />
                <Bar dataKey="redirected" stackId="activity" fill={chartColors[3]} radius={[0, 0, 0, 0]} />
                <Bar dataKey="commented" stackId="activity" fill={chartColors[4]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="!p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold">Needs Attention</h3>
              <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                Highest urgency work currently assigned to you.
              </p>
            </div>
            <AlertTriangle size={15} style={{ color: 'var(--theme-warning)' }} />
          </div>
          {analytics.attentionTasks.length === 0 ? (
            <p className="text-xs py-10 text-center" style={{ color: 'var(--theme-muted-text)' }}>
              Nothing urgent right now.
            </p>
          ) : (
            <div className="space-y-2">
              {analytics.attentionTasks.map((task) => {
                const overdue = !!task.due_date && new Date(task.due_date).getTime() < now
                return (
                  <Link
                    key={task.id}
                    href={`/tasks/${task.id}`}
                    className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-[var(--theme-row-highlight)]"
                    style={{ borderColor: 'var(--theme-surface-border)' }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      <div className="flex flex-wrap gap-2 mt-1 text-[10px]">
                        <span className="px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                          {task.priority}
                        </span>
                        <span className="px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                          {task.status.replace(/_/g, ' ')}
                        </span>
                        {task.due_date && (
                          <span
                            className="px-1.5 py-0.5 rounded-full"
                            style={{
                              backgroundColor: overdue ? 'color-mix(in srgb, var(--theme-danger) 12%, transparent)' : 'color-mix(in srgb, var(--status-info) 12%, transparent)',
                              color: overdue ? 'var(--theme-danger)' : 'var(--status-info)',
                            }}
                          >
                            {overdue ? 'Overdue' : `Due ${formatRelativeDate(task.due_date)}`}
                          </span>
                        )}
                      </div>
                    </div>
                    <ArrowRight size={14} style={{ color: 'var(--theme-muted-text)' }} />
                  </Link>
                )
              })}
            </div>
          )}
        </Card>

        <Card className="!p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold">Recent Completions</h3>
              <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                Recently completed tasks attributed to you.
              </p>
            </div>
            <CheckCircle2 size={15} style={{ color: 'var(--theme-success)' }} />
          </div>
          {analytics.recentCompleted.length === 0 ? (
            <p className="text-xs py-10 text-center" style={{ color: 'var(--theme-muted-text)' }}>
              No completions recorded yet.
            </p>
          ) : (
            <div className="space-y-2">
              {analytics.recentCompleted.map((task) => (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-[var(--theme-row-highlight)]"
                  style={{ borderColor: 'var(--theme-surface-border)' }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{task.title}</p>
                    <div className="flex flex-wrap gap-2 mt-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                      <span>{task.completed_at ? `Completed ${formatRelativeDate(task.completed_at)}` : 'Completed'}</span>
                      <span>{formatDuration(
                        task.completed_at
                          ? new Date(task.completed_at).getTime() - new Date(task.started_at ?? task.created_at).getTime()
                          : null
                      )}</span>
                      {task.outcome && <span>Outcome: {task.outcome}</span>}
                    </div>
                  </div>
                  <ArrowRight size={14} style={{ color: 'var(--theme-muted-text)' }} />
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="!p-4">
        <PersonalActivityTimeline
          events={analytics.timelineEvents}
          mode="report"
          title="What You’ve Been Doing"
          subtitle="A chronological timeline of personal task and workflow activity."
        />
      </Card>

      <Card className="!p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">Escalations Targeting You</h3>
            <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
              Workflow escalations configured to route work to you.
            </p>
          </div>
          <GitBranch size={15} style={{ color: 'var(--theme-primary-text)' }} />
        </div>
        {analytics.openEscalations.length === 0 ? (
          <p className="text-xs py-8 text-center" style={{ color: 'var(--theme-muted-text)' }}>
            No escalations are currently targeting you.
          </p>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {analytics.openEscalations.map((entry) => (
              <Link
                key={entry.id}
                href={entry.task?.id ? `/tasks/${entry.task.id}` : '/tasks'}
                className="rounded-lg border p-3 transition-colors hover:bg-[var(--theme-row-highlight)]"
                style={{ borderColor: 'var(--theme-surface-border)' }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{entry.task?.title ?? 'Escalated task'}</p>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                      {entry.escalation_type} escalation · after {entry.escalate_after_minutes} min
                    </p>
                  </div>
                  <span
                    className="px-2 py-1 rounded-full text-[10px]"
                    style={{
                      backgroundColor: entry.is_escalated ? 'color-mix(in srgb, var(--theme-danger) 12%, transparent)' : 'color-mix(in srgb, var(--status-info) 12%, transparent)',
                      color: entry.is_escalated ? 'var(--theme-danger)' : 'var(--status-info)',
                    }}
                  >
                    {entry.is_escalated ? 'Escalated' : 'Watching'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-3 mt-2 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                  {entry.task?.priority && <span>Priority: {entry.task.priority}</span>}
                  {entry.task?.status && <span>Status: {entry.task.status.replace(/_/g, ' ')}</span>}
                  <span>{formatRelativeDate(entry.escalated_at ?? entry.created_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
