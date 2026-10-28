'use client'

import { useQuery } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { Button } from '@/components/ui/button'
import * as Dialog from '@radix-ui/react-dialog'
import { FileText, Globe, Table2, Link2, Workflow, Clock, Map, Database } from 'lucide-react'

// ── Shared types ──

interface Dep { id: string; name: string }
interface AssetDeps {
  workflows: Dep[]
  tables: Dep[]
  references: Dep[]
  integrations: Dep[]
  tasks: number
  submissions: number
  runs: number
}

const emptyDeps = (): AssetDeps => ({ workflows: [], tables: [], references: [], integrations: [], tasks: 0, submissions: 0, runs: 0 })

// ── Integration Dependencies ──

export function useIntegrationDependencies(integrationId: string) {
  return useQuery({
    queryKey: ['integration-deps', integrationId],
    // References and the workflows calling them, scanned server-side.
    queryFn: async (): Promise<AssetDeps> => (await serverRead('governance.integrationDependencies', { integrationId })).data ?? emptyDeps(),
    staleTime: 30_000,
    enabled: !!integrationId,
  })
}

// ── Reference Dependencies ──

export function useReferenceDependencies(referenceId: string) {
  return useQuery({
    queryKey: ['reference-deps', referenceId],
    // Workflows using this reference, scanned server-side.
    queryFn: async (): Promise<AssetDeps> => (await serverRead('governance.referenceDependencies', { referenceId })).data ?? emptyDeps(),
    staleTime: 30_000,
    enabled: !!referenceId,
  })
}

// ── Custom Table Dependencies ──

export function useTableDependencies(tableId: string) {
  return useQuery({
    queryKey: ['table-deps', tableId],
    // Row count and the workflows using this table, scanned server-side.
    queryFn: async (): Promise<AssetDeps> => (await serverRead('governance.tableDependencies', { tableId })).data ?? emptyDeps(),
    staleTime: 30_000,
    enabled: !!tableId,
  })
}

// ── Shared UI ──

export function AssetDependencyView({ deps, loading, rowLabel }: { deps?: AssetDeps; loading: boolean; rowLabel?: string }) {
  if (loading) return <p className="text-[10px] py-2 text-center" style={{ color: 'var(--theme-muted-text)' }}>Scanning dependencies...</p>
  if (!deps) return null

  const total = deps.workflows.length + deps.tables.length + deps.references.length + deps.integrations.length + deps.tasks + deps.submissions + deps.runs
  if (total === 0) return <p className="text-[10px] py-2 text-center" style={{ color: 'var(--theme-muted-text)' }}>No linked assets found.</p>

  return (
    <div className="space-y-1.5">
      {deps.submissions > 0 && <DepRow icon={<Database size={11} />} label={rowLabel ?? 'Rows'} value={`${deps.submissions}`} />}
      {deps.runs > 0 && <DepRow icon={<Clock size={11} />} label="Runs" value={`${deps.runs}`} />}
      {deps.tasks > 0 && <DepRow icon={<FileText size={11} />} label="Tasks" value={`${deps.tasks}`} />}
      {deps.workflows.map(w => <DepRow key={w.id} icon={<Workflow size={11} />} label="Workflow" value={w.name} href={`/automations/${w.id}`} />)}
      {deps.tables.map(t => <DepRow key={t.id} icon={<Table2 size={11} />} label="Data Table" value={t.name} href={`/data/${t.id}`} />)}
      {deps.references.map(r => <DepRow key={r.id} icon={<Link2 size={11} />} label="Reference" value={r.name} />)}
      {deps.integrations.map(i => <DepRow key={i.id} icon={<Globe size={11} />} label="Integration" value={i.name} href={`/integrations/${i.id}`} />)}
    </div>
  )
}

function DepRow({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href?: string }) {
  const content = (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[10px]" style={{ backgroundColor: 'var(--theme-surface)' }}>
      <span style={{ color: 'var(--theme-primary-text)' }}>{icon}</span>
      <span className="font-medium" style={{ color: 'var(--theme-muted-text)' }}>{label}</span>
      <span className="flex-1 truncate font-medium" style={{ color: 'var(--theme-card-text)' }}>{value}</span>
    </div>
  )
  if (href) return <a href={href} className="block hover:opacity-80">{content}</a>
  return content
}

export function AssetDependencyDialog({ open, onOpenChange, title, subtitle, deps, loading, rowLabel }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; subtitle: string
  deps?: AssetDeps; loading: boolean; rowLabel?: string
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(28rem,92vw)] rounded-xl p-6 shadow-xl" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
          <Dialog.Title className="text-lg font-semibold mb-1" style={{ color: 'var(--theme-card-text)' }}>
            <Map size={16} className="inline mr-2" style={{ color: 'var(--theme-primary-text)' }} />
            Dependency Map
          </Dialog.Title>
          <p className="text-xs mb-3" style={{ color: 'var(--theme-muted-text)' }}>
            Assets linked to <strong>{title}</strong>{subtitle && <span> ({subtitle})</span>}
          </p>
          <AssetDependencyView deps={deps} loading={loading} rowLabel={rowLabel} />
          <div className="flex justify-end mt-4">
            <Dialog.Close asChild><Button variant="outline" size="sm">Close</Button></Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
