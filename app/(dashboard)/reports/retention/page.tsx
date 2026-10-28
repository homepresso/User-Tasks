"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { RetentionReportView } from './retention-report-view'

export default function RetentionReportPage() {
  const { data } = useQuery({
    queryKey: ['reports', 'retention'],
    queryFn: () => serverQuery('reports.retention'),
  })

  return (
    <RetentionReportView
      policies={data?.policies ?? []}
      reviews={data?.reviews ?? []}
      executions={data?.executions ?? []}
      tables={data?.tables ?? []}
      rows={data?.rows ?? []}
      roles={data?.roles ?? []}
    />
  )
}
