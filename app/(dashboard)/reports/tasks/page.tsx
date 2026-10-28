"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { TaskReportView } from './task-report-view'

export default function TaskReportPage() {
  const { data } = useQuery({
    queryKey: ['reports', 'tasks'],
    queryFn: () => serverQuery('reports.tasks'),
  })

  return (
    <TaskReportView
      allTasks={data?.allTasks ?? []}
      completedRecent={data?.completedRecent ?? []}
      effortRecords={data?.effortRecords ?? []}
      overdueTasks={data?.overdueTasks ?? []}
      recentCompleted={data?.recentCompleted ?? []}
      userMap={data?.userMap ?? {}}
    />
  )
}
