"use client"

import { use } from 'react'
import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { SavedReportView } from './saved-report-view'

export default function SavedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const { data: report } = useQuery({
    queryKey: ['report', id],
    queryFn: () => serverQuery('reports.get', { id }),
  })

  if (!report) return null

  return <SavedReportView report={report} />
}
