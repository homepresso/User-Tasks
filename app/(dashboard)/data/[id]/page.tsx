"use client"

import { use, useEffect, useRef, useState } from 'react'
import { serverRead } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { DataGrid } from '@/components/data/data-grid'
import { TableDesigner } from '@/components/data/table-designer'
import { Table2 } from 'lucide-react'
import { ObjectPermissions } from '@/components/governance/object-permissions'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { plural } from '@/lib/format/plural'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabPanel } from '@/components/ui/tabs'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { RetentionPolicyAssignment } from '@/components/governance/retention-policy-assignment'
import { getRetentionStatus } from '@/lib/retention-policies'
import { ExportAssetButton } from '@/components/shared/config-transfer'
import { useDesignerContext } from '@/lib/assistants/client-registry'

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
  searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = use(params)
  // A new table opens on its schema (?tab=schema) so its columns can be added straight away.
  const { tab } = use(searchParams)
  const [activeTab, setActiveTab] = useState<'rows' | 'schema' | 'access'>(tab === 'schema' || tab === 'access' ? tab : 'rows')

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

  // The Agent: this table is the open item ("add 10 rows to this table"); its rows refresh after a confirmed change (the Agent invalidates queries).
  useDesignerContext(table ? {
    area: 'data', item_id: id, item_name: table.name,
    summary: `Columns: ${(table.columns ?? []).slice(0, 60).map((c) => `${c.name}${(c as { type?: string }).type ? ` (${(c as { type?: string }).type})` : ''}`).join(', ')}`.slice(0, 2_000),
  } : null)

  const colCount = table?.columns?.length ?? 0
  const rowCount = rows?.length ?? 0
  const retentionStatus = getRetentionStatus({
    policy: table?.retention_policy ?? null,
    appliedAt: table?.retention_applied_at ?? null,
    createdAt: table?.created_at ?? null,
  })
  if (isTableLoading && !table) return <PageSkeleton variant="detail" />
  if (!table) {
    return (
      <EmptyState
        variant="error"
        title="This table could not be found"
        description="It may have been deleted, or you may not have access to it."
        action={{ label: 'Back to data', href: '/data' }}
      />
    )
  }

  const updated = table.updated_at ?? table.created_at

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Data', href: '/data' }, { label: table.name }]}
        icon={<Table2 />}
        title={table.name}
        description={
          <>
            {table.description && <ClampedText text={table.description} />}
            <span className="mt-1 block text-xs text-fg-muted">
              <span className="num">{plural(colCount, 'column')}</span>
              {' · '}
              <span className="num">{isRowsLoading && !rows ? '… rows' : plural(rowCount, 'row')}</span>
              {' · '}
              <span title={formatAbsolute(updated)}>Updated {formatRelative(updated)}</span>
              {' · '}
              {retentionStatus.label}
            </span>
          </>
        }
        actions={<ExportAssetButton ids={[table.id]} name={table.name} allowRows />}
        tabs={
          <Tabs
            aria-label="Table"
            idBase="data-table"
            value={activeTab}
            onValueChange={setActiveTab}
            items={[
              { value: 'rows', label: 'Rows', count: rowCount },
              { value: 'schema', label: 'Schema', count: colCount },
              { value: 'access', label: 'Access' },
            ]}
          />
        }
      />

      {activeTab === 'rows' && (
        <TabPanel idBase="data-table" value="rows">
          <DataGrid
            tableId={table.id}
            tenantId={table.tenant_id}
            columns={table.columns}
            rows={rows ?? []}
          />
        </TabPanel>
      )}

      {activeTab === 'schema' && (
        <TabPanel idBase="data-table" value="schema">
          <TableDesigner tableId={table.id} columns={table.columns} />
        </TabPanel>
      )}

      {activeTab === 'access' && (
        <TabPanel idBase="data-table" value="access" className="max-w-4xl space-y-8">
          <section className="space-y-3">
            <div>
              <h2 className="text-base font-semibold text-fg">Permissions</h2>
              <p className="mt-0.5 text-ui text-fg-muted">Control who can open, edit and manage this table.</p>
            </div>
            <ObjectPermissions
              objectType="data_table"
              objectId={table.id}
              objectName={table.name}
              showExecute={false}
            />
          </section>
          <section className="space-y-3 border-t border-border-subtle pt-6">
            <div>
              <h2 className="text-base font-semibold text-fg">Retention</h2>
              <p className="mt-0.5 text-ui text-fg-muted">Current status: {retentionStatus.label}</p>
            </div>
            <RetentionPolicyAssignment
              targetType="data_table"
              targetId={table.id}
              currentPolicyId={table.retention_policy_id}
              allowedScope="data_tables"
            />
          </section>
        </TabPanel>
      )}
    </div>
  )
}

/** A description clamped to two lines, with "more" / "less" when it overflows. */
function ClampedText({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1)
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [text])
  return (
    <>
      <span ref={ref} className={expanded ? 'block' : 'block line-clamp-2'}>{text}</span>
      {(overflows || expanded) && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="text-ui font-medium text-primary-text hover:underline">
          {expanded ? 'Less' : 'More'}
        </button>
      )}
    </>
  )
}
