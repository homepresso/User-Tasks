"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { BusinessRulesReportView } from './business-rules-report-view'

export default function BusinessRulesReportPage() {
  const { data } = useQuery({
    queryKey: ['reports', 'business-rules'],
    queryFn: () => serverQuery('reports.businessRules'),
  })

  return (
    <BusinessRulesReportView
      logs={data?.logs ?? []}
      tables={data?.tables ?? []}
    />
  )
}
