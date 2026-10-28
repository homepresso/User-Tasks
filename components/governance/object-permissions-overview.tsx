'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { useDashboardAuth } from '@/lib/dashboard-auth-context'
import { ObjectPermissions } from './object-permissions'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Search, Workflow, FileText, Database, Bot, Network, Key, BarChart3,
  Lock, Unlock, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

type ObjectType = 'workflow' | 'data_table' | 'agent' | 'integration' | 'api_key' | 'report'

const OBJECT_TYPES: { type: ObjectType; label: string; icon: any; table: string; nameCol: string; href: (id: string) => string }[] = [
  { type: 'workflow', label: 'Workflows', icon: Workflow, table: 'workflows', nameCol: 'name', href: id => `/automations/${id}` },
  { type: 'data_table', label: 'Data Tables', icon: Database, table: 'custom_tables', nameCol: 'name', href: id => `/data/${id}` },
  { type: 'agent', label: 'Agents', icon: Bot, table: 'agents', nameCol: 'name', href: id => `/agents/${id}` },
  { type: 'integration', label: 'Integrations', icon: Network, table: 'integrations', nameCol: 'name', href: id => `/integrations/${id}` },
]

export function ObjectPermissionsOverview() {
  const { profile } = useDashboardAuth()
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<ObjectType | 'all'>('all')
  const [selectedObject, setSelectedObject] = useState<{ type: ObjectType; id: string; name: string } | null>(null)

  // Fetch all objects across types
  const { data: objects = [], isLoading } = useQuery({
    queryKey: ['all-objects-for-permissions', tenantId],
    queryFn: async () => {
      const { data } = await serverRead('governance.permissionObjects', { tenantId: tenantId! })
      return data ?? []
    },
    enabled: !!tenantId,
  })

  // Fetch which objects have permissions configured
  const { data: restrictedObjects = [] } = useQuery({
    queryKey: ['restricted-objects', tenantId],
    queryFn: async () => {
      // Deduplicated server-side.
      const { data } = await serverRead('governance.restrictedObjects')
      return data ?? []
    },
    enabled: !!tenantId,
  })

  const restrictedSet = new Set(restrictedObjects.map(r => `${r.object_type}:${r.object_id}`))

  const filtered = objects.filter(obj => {
    if (typeFilter !== 'all' && obj.type !== typeFilter) return false
    if (search && !obj.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const typeConfig = OBJECT_TYPES.reduce((acc, t) => { acc[t.type] = t; return acc }, {} as Record<string, typeof OBJECT_TYPES[0]>)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>Object-Level Permissions</h3>
        <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
          By default, all objects are open to everyone. Add permissions to restrict access to specific roles or users.
          Click any object to manage its permissions.
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search objects..." className="pl-9" />
        </div>
        <div className="flex gap-1">
          {[{ type: 'all' as const, label: 'All' }, ...OBJECT_TYPES.map(t => ({ type: t.type, label: t.label }))].map(opt => (
            <button key={opt.type} onClick={() => setTypeFilter(opt.type)}
              className="px-3 py-1 text-[10px] font-medium rounded-full transition-colors"
              style={{
                backgroundColor: typeFilter === opt.type ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                color: typeFilter === opt.type ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
              }}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
        <span>{filtered.length} objects</span>
        <span className="flex items-center gap-1"><Lock size={10} /> {restrictedObjects.length} restricted</span>
        <span className="flex items-center gap-1"><Unlock size={10} /> {objects.length - restrictedObjects.length} open</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
        {/* Object list */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <div className="grid text-[10px] font-semibold uppercase tracking-wider"
            style={{ gridTemplateColumns: '1fr 100px 80px', backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
            <div className="px-3 py-2">Object</div>
            <div className="px-2 py-2">Type</div>
            <div className="px-2 py-2 text-center">Access</div>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {isLoading ? (
              <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--theme-muted-text)' }}>Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs" style={{ color: 'var(--theme-muted-text)' }}>No objects found</div>
            ) : filtered.map(obj => {
              const isRestricted = restrictedSet.has(`${obj.type}:${obj.id}`)
              const isSelected = selectedObject?.id === obj.id
              const Icon = typeConfig[obj.type]?.icon ?? FileText
              return (
                <button key={`${obj.type}-${obj.id}`}
                  onClick={() => setSelectedObject({ type: obj.type, id: obj.id, name: obj.name })}
                  className={cn('grid items-center text-xs border-t w-full text-left transition-colors', isSelected && 'ring-1 ring-inset')}
                  style={{
                    gridTemplateColumns: '1fr 100px 80px',
                    borderColor: 'var(--theme-surface-border)',
                    backgroundColor: isSelected ? 'var(--theme-primary-light)' : undefined,
                    outline: isSelected ? '2px solid var(--theme-primary)' : undefined,
                    outlineOffset: '-2px',
                  }}>
                  <div className="px-3 py-2.5 flex items-center gap-2 min-w-0">
                    <Icon size={13} style={{ color: 'var(--theme-primary-text)' }} className="shrink-0" />
                    <span className="font-medium truncate" style={{ color: 'var(--theme-card-text)' }}>{obj.name}</span>
                  </div>
                  <div className="px-2 py-2.5 text-[10px] capitalize" style={{ color: 'var(--theme-muted-text)' }}>
                    {obj.type.replace('_', ' ')}
                  </div>
                  <div className="px-2 py-2.5 flex justify-center">
                    {isRestricted ? (
                      <span className="flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        <Lock size={8} /> Restricted
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
                        <Unlock size={8} /> Open
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Selected object permissions panel */}
        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
          {selectedObject ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>{selectedObject.name}</h4>
                <Link href={typeConfig[selectedObject.type]?.href(selectedObject.id) ?? '#'}
                  className="text-[10px] flex items-center gap-0.5 hover:underline" style={{ color: 'var(--theme-primary-text)' }}>
                  Open <ChevronRight size={10} />
                </Link>
              </div>
              <ObjectPermissions
                objectType={selectedObject.type}
                objectId={selectedObject.id}
                objectName={selectedObject.name}
                showExecute={selectedObject.type === 'workflow' || selectedObject.type === 'agent' || selectedObject.type === 'integration'}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full min-h-[200px]">
              <p className="text-xs text-center" style={{ color: 'var(--theme-muted-text)' }}>
                Select an object from the list to manage its permissions
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
