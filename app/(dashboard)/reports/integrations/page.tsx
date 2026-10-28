"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { IntegrationReportView } from './integration-report-view'

export default function IntegrationReportPage() {
  const { data } = useQuery({
    queryKey: ['reports', 'integrations'],
    queryFn: () => serverQuery('reports.integrations'),
  })

  return (
    <IntegrationReportView
      integrations={data?.integrations ?? []}
      references={data?.references ?? []}
      connectors={data?.connectors ?? []}
    />
  )
}
