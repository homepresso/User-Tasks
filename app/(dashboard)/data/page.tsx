"use client"

import Link from 'next/link'
import { serverRead } from '@/lib/server-read'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { CreateTableDialog } from '@/components/data/create-table-dialog'
import { DataTableList } from '@/components/data/data-table-list'
import { McpBanner } from '@/components/shared/mcp-banner'
import { ImportConfigButton } from '@/components/shared/config-transfer'
import { usePermissions } from '@/lib/permissions-context'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { ShieldCheck } from 'lucide-react'

export default function DataStorePage() {
  const queryClient = useQueryClient()
  const { can } = usePermissions()

  const { data: tables, isLoading } = useQuery({
    queryKey: ['custom-tables'],
    // Creator display name is joined so the list can show an avatar +
    // "Created by" line without a second round-trip; row_count is a nested
    // aggregate (see data.tables).
    queryFn: async () => (await serverRead('data.tables')).data ?? [],
  })

  if (isLoading && !tables) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Data Store</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/settings/governance?tab=retention"
            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors hover:opacity-90"
            style={{
              borderColor: 'var(--theme-surface-border)',
              backgroundColor: 'var(--theme-card-bg)',
              color: 'var(--theme-card-text)',
            }}
          >
            <ShieldCheck size={15} style={{ color: 'var(--theme-primary-text)' }} />
            Configure Policies
          </Link>
          {can('data.create') && <ImportConfigButton allowRows onImported={() => void queryClient.invalidateQueries({ queryKey: ['custom-tables'] })} />}
          <CreateTableDialog />
        </div>
      </div>

      <McpBanner />

      {!tables?.length ? (
        <Card>
          <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
            No tables yet. Create one to start storing data.
          </p>
        </Card>
      ) : (
        <DataTableList tables={tables} />
      )}
    </div>
  )
}
