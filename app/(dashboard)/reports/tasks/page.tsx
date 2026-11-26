"use client"

import { useState } from 'react'
import { serverQuery } from '@/lib/server-read'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getDateFrom } from '@/components/reports/report-filters'
import { TaskReportView } from './task-report-view'

export default function TaskReportPage() {
  const [days, setDays] = useState(30)
  // Midnight-aligned (getDateFrom), so the key is stable for the day.
  const since = getDateFrom(days)?.toISOString() ?? null
  const { data } = useQuery({
    queryKey: ['reports', 'tasks', since],
    queryFn: () => serverQuery('reports.tasks', { since }),
    placeholderData: keepPreviousData,
  })

  return (
    <TaskReportView
      days={days}
      onDaysChange={setDays}
      summary={data?.summary ?? null}
      effortRecords={data?.effortRecords ?? []}
      recentCompleted={data?.recentCompleted ?? []}
      userMap={data?.userMap ?? {}}
    />
  )
}
