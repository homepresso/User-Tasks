"use client"

import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { serverRead } from '@/lib/server-read'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { DecisionTableEditor } from '@/components/business-rules/decision-table-editor'

export default function DecisionTableDetailPage() {
  const params = useParams<{ id: string }>()
  const tableId = params.id

  const { data: table, isLoading } = useQuery({
    queryKey: ['decision-table', tableId],
    queryFn: async () => (await serverRead('automations.decisionTable', { id: tableId })).data,
    enabled: !!tableId,
  })

  if (isLoading && !table) {
    return <PageSkeleton variant="detail" />
  }

  if (!table) {
    return (
      <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
        Business rule not found.
      </p>
    )
  }

  return <DecisionTableEditor table={table} />
}
