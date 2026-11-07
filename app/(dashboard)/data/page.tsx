"use client"

import Link from 'next/link'
import { serverRead } from '@/lib/server-read'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { CreateTableDialog } from '@/components/data/create-table-dialog'
import { DataTableList } from '@/components/data/data-table-list'
import { ImportConfigButton } from '@/components/shared/config-transfer'
import { usePermissions } from '@/lib/permissions-context'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { Database, ShieldCheck } from 'lucide-react'

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
    <div>
      <PageHeader
        title="Data"
        description="Tables your workflows, forms and agents read and write. Open a table to browse its rows or edit its schema."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/settings/governance?tab=retention"><ShieldCheck className="size-4" aria-hidden="true" />Configure policies</Link>
            </Button>
            {can('data.create') && (
              <ImportConfigButton size="default" allowRows onImported={() => void queryClient.invalidateQueries({ queryKey: ['custom-tables'] })} />
            )}
            <CreateTableDialog />
          </>
        }
      />

      {!tables?.length ? (
        <div className="rounded-lg border border-border bg-panel">
          <EmptyState
            size="lg"
            icon={Database}
            title="No tables yet"
            description="Tables store records your workflows, forms and agents can read and write. Create one, or import a table from a file."
          />
        </div>
      ) : (
        <DataTableList tables={tables} />
      )}
    </div>
  )
}
