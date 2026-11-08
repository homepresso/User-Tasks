"use client"

import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { serverRead } from '@/lib/server-read'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { DecisionTableEditor } from '@/components/business-rules/decision-table-editor'
import { useAssistantChanges, useDesignerContext, type AssistantChange } from '@/lib/assistants/client-registry'
import { useCallback, useState } from 'react'

export default function DecisionTableDetailPage() {
  const params = useParams<{ id: string }>()
  const tableId = params.id

  const { data: table, isLoading, refetch } = useQuery({
    queryKey: ['decision-table', tableId],
    queryFn: async () => (await serverRead('automations.decisionTable', { id: tableId })).data,
    enabled: !!tableId,
  })

  // The designer assistant: this rule is the open item; after it changes the rule, reload the editor (local state).
  useDesignerContext(table ? { area: 'decision_table', item_id: tableId, item_name: (table as { name?: string }).name ?? null } : null)
  const [rev, setRev] = useState(0)
  useAssistantChanges(useCallback((change: AssistantChange) => {
    if (change.kind === 'decision_table' && change.id === tableId) void refetch().then(() => setRev((r) => r + 1))
  }, [tableId, refetch]))

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

  return <DecisionTableEditor key={rev} table={table} />
}
