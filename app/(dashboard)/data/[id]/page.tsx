"use client"

import { use, useState } from 'react'
import { serverRead } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { DataGrid } from '@/components/data/data-grid'
import { TableDesigner } from '@/components/data/table-designer'
import Link from 'next/link'
import { ArrowLeft, FileText, Clock, Columns as ColumnsIcon, Database, Shield } from 'lucide-react'
import { ObjectPermissions } from '@/components/governance/object-permissions'
import { formatRelativeDate } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { RetentionPolicyAssignment } from '@/components/governance/retention-policy-assignment'
import { getRetentionStatus } from '@/lib/retention-policies'
import { ExportAssetButton } from '@/components/shared/config-transfer'

interface TableColumn {
  id: string
  name: string
  type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'file' | 'longtext'
  options?: string[]
  required?: boolean
}

interface CustomTable {
  id: string
  name: string
  description?: string | null
  tenant_id: string
  retention_policy_id?: string | null
  retention_applied_at?: string | null
  retention_policy?: {
    id: string
    name: string
    description?: string | null
    policy_mode: 'review' | 'purge_on' | 'purge_on_exact_date' | 'keep_forever'
    duration_value?: number | null
    duration_unit?: 'days' | 'months' | 'years' | null
    exact_date?: string | null
    applies_to?: string[] | null
  } | null
  created_at: string
  updated_at?: string | null
  columns: TableColumn[]
}

interface UserRef {
  id: string
  display_name: string | null
  email: string | null
  avatar_url: string | null
}

interface CustomTableRow {
  id: string
  table_id: string
  tenant_id: string
  data: Record<string, unknown>
  retention_policy_id?: string | null
  retention_applied_at?: string | null
  retention_policy?: {
    id: string
    name: string
    description?: string | null
    policy_mode: 'review' | 'purge_on' | 'purge_on_exact_date' | 'keep_forever'
    duration_value?: number | null
    duration_unit?: 'days' | 'months' | 'years' | null
    exact_date?: string | null
    applies_to?: string[] | null
  } | null
  created_at: string
  updated_at?: string | null
  created_by?: string | null
  updated_by?: string | null
  creator?: UserRef | null
  updater?: UserRef | null
}

export default function CustomTablePage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [activeTab, setActiveTab] = useState<'rows' | 'schema' | 'access'>('rows')

  const { data: table, isLoading: isTableLoading } = useQuery({
    queryKey: ['custom-table', id],
    queryFn: async () => ((await serverRead('data.table', { id })).data ?? null) as CustomTable | null,
  })

  // Pull rows with BOTH creator and updater joins so the grid and
  // the detail drawer can show "created by X / last edited by Y"
  // without extra round-trips.
  const { data: rows, isLoading: isRowsLoading } = useQuery({
    queryKey: ['custom-table-rows', id],
    queryFn: async () => {
      // Rows are hydrated server-side; one broken join can't blank the grid.
      const { data, error } = await serverRead('data.rows', { tableId: id })
      if (error) {
        console.error('[data/page] failed to load custom table rows', error)
        return [] as CustomTableRow[]
      }
      return (data ?? []) as CustomTableRow[]
    },
  })

  const colCount = table?.columns?.length ?? 0
  const rowCount = rows?.length ?? 0
  const retentionStatus = getRetentionStatus({
    policy: table?.retention_policy ?? null,
    appliedAt: table?.retention_applied_at ?? null,
    createdAt: table?.created_at ?? null,
  })
  const tabs = [
    { key: 'rows' as const, label: `Rows (${rowCount})`, icon: Database },
    { key: 'schema' as const, label: `Schema (${colCount})`, icon: ColumnsIcon },
    { key: 'access' as const, label: 'Access', icon: Shield },
  ]

  if (isTableLoading && !table) return <PageSkeleton variant="detail" />
  if (!table) return <PageSkeleton variant="detail" />

  return (
    <div className="space-y-4">
      {/* Header with document-style icon + metadata */}
      <div className="flex items-start gap-4">
        <Link
          href="/data"
          className="rounded-md p-1.5 hover:bg-[var(--theme-surface)] transition-colors shrink-0 mt-1"
          style={{ color: 'var(--theme-muted-text)' }}
        >
          <ArrowLeft size={18} />
        </Link>
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'var(--theme-primary-light)' }}
        >
          <FileText size={26} style={{ color: 'var(--theme-primary-text)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>
            {table.name}
          </h1>
          {table.description && (
            <p className="text-sm mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
              {table.description}
            </p>
          )}
          <div className="flex items-center gap-3 mt-2 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
            <span className="inline-flex items-center gap-1"><ColumnsIcon size={10} /> {colCount} columns</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1"><Database size={10} /> {rowCount} rows</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1" title={new Date(table.updated_at ?? table.created_at).toLocaleString()}>
              <Clock size={10} /> Updated {formatRelativeDate(table.updated_at ?? table.created_at)}
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Shield size={10} /> {retentionStatus.label}
            </span>
          </div>
        </div>
        <ExportAssetButton ids={[table.id]} name={table.name} allowRows />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--theme-surface-border)' }}>
          {tabs.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: activeTab === tab.key ? 'var(--theme-primary)' : 'transparent',
                  color: activeTab === tab.key ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
                }}
              >
                <Icon size={13} />
                {tab.label}
              </button>
            )
          })}
        </div>
        <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
          {activeTab === 'rows' && 'Browse, search, and update table entries.'}
          {activeTab === 'schema' && 'Manage fields without losing context from the data.'}
          {activeTab === 'access' && 'Control who can view and edit this table.'}
        </p>
      </div>

      {activeTab === 'rows' && (
        <div className="space-y-4">
          <Card className="!p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Table data</h3>
                <p className="mt-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                  Search across values, edit inline, and open row details for full metadata.
                </p>
              </div>
              {isRowsLoading && (
                <span className="text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>
                  Refreshing rows...
                </span>
              )}
            </div>
          </Card>
          <DataGrid
            tableId={table.id}
            tenantId={table.tenant_id}
            columns={table.columns}
            rows={rows ?? []}
          />
        </div>
      )}

      {activeTab === 'schema' && (
        <div className="space-y-4">
          <Card className="!p-4">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Schema overview</h3>
            <p className="mt-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
              Keep the editor collapsed until you need it. The summary below helps you scan the structure quickly.
            </p>
          </Card>
          <TableDesigner tableId={table.id} columns={table.columns} />
        </div>
      )}

      {activeTab === 'access' && (
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}
        >
          <div className="mb-4">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Table access</h3>
            <p className="mt-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
              Permissions are separated here so schema and data work stay focused. Use this tab when you need to restrict who can open or manage the table.
            </p>
          </div>
          <ObjectPermissions
            objectType="data_table"
            objectId={table.id}
            objectName={table.name}
            showExecute={false}
          />
          <div className="mt-4 rounded-xl border p-4" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <RetentionPolicyAssignment
              targetType="data_table"
              targetId={table.id}
              currentPolicyId={table.retention_policy_id}
              allowedScope="data_tables"
            />
            <p className="mt-2 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
              Current status: {retentionStatus.label}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
