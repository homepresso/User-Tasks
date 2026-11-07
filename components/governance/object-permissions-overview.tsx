'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { updateForm } from '@/app/actions/forms'
import { usePermissions } from '@/lib/permissions-context'
import { serverRead } from '@/lib/server-read'
import { useDashboardAuth } from '@/lib/dashboard-auth-context'
import { ObjectPermissions } from './object-permissions'
import { Input } from '@/components/ui/input'
import {
  Search, Workflow, FileText, Database, Bot, Network, ClipboardList,
  Lock, Unlock, ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { OBJECT_PERMISSION_META, type ObjectPermissionType } from '@/lib/object-permission-types'

type ObjectType = ObjectPermissionType

const ICONS: Partial<Record<ObjectType, any>> = { workflow: Workflow, data_table: Database, form: ClipboardList, agent: Bot, integration: Network }

/** Types listed here (same order as governance.permissionObjects). */
const OBJECT_TYPES: { type: ObjectType; label: string; icon: any; href: (id: string) => string }[] = (['workflow', 'data_table', 'form', 'agent', 'integration'] as const)
  .map((type) => ({ type, label: OBJECT_PERMISSION_META[type].plural, icon: ICONS[type] ?? FileText, href: OBJECT_PERMISSION_META[type].href }))

/** Forms: grants list the form in people's Forms menu (they don't restrict who can open it). */
const FORM_COPY = {
  openBadge: 'No one yet', restrictedBadge: 'Given access',
  open: 'No one has been given access to this form yet. Add a role, team or person: with Available forms on, the form shows in their Forms menu (they also need Submit forms).',
  restricted: 'These roles, teams and people have been given access. With Available forms on, the form shows in their Forms menu (they also need Submit forms).',
}

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
  const restrictedCount = objects.filter(obj => restrictedSet.has(`${obj.type}:${obj.id}`)).length

  const filtered = objects.filter(obj => {
    if (typeFilter !== 'all' && obj.type !== typeFilter) return false
    if (search && !obj.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const typeConfig = OBJECT_TYPES.reduce((acc, t) => { acc[t.type] = t; return acc }, {} as Record<string, typeof OBJECT_TYPES[0]>)

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-fg">Object-Level Permissions</h3>
        <p className="text-xs mt-1 text-fg-muted">
          By default, all objects are open to everyone. Add permissions to restrict access to specific roles or users.
          Forms use View and Submit: a grant lists the form in people&apos;s Forms menu (Available forms).
          Click any object to manage its permissions.
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search objects..." className="pl-9" />
        </div>
        <div className="flex gap-1">
          {[{ type: 'all' as const, label: 'All' }, ...OBJECT_TYPES.map(t => ({ type: t.type, label: t.label }))].map(opt => (
            <button key={opt.type} onClick={() => setTypeFilter(opt.type)}
              className="px-3 py-1 text-2xs font-medium rounded-full transition-colors"
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
      <div className="flex gap-4 text-xs text-fg-muted">
        <span>{filtered.length} objects</span>
        <span className="flex items-center gap-1"><Lock size={10} /> {restrictedCount} with grants</span>
        <span className="flex items-center gap-1"><Unlock size={10} /> {objects.length - restrictedCount} open</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] gap-4">
        {/* Object list */}
        <div className="rounded-xl border overflow-hidden border-border">
          <div className="grid text-2xs font-semibold "
            style={{ gridTemplateColumns: '1fr 100px 80px', backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
            <div className="px-3 py-2">Object</div>
            <div className="px-2 py-2">Type</div>
            <div className="px-2 py-2 text-center">Access</div>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {isLoading ? (
              <div className="px-4 py-8 text-center text-xs text-fg-muted">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-fg-muted">No objects found</div>
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
                    <Icon size={13} className="shrink-0 text-primary-text" />
                    <span className="font-medium truncate text-fg">{obj.name}</span>
                  </div>
                  <div className="px-2 py-2.5 text-2xs text-fg-muted">
                    {OBJECT_PERMISSION_META[obj.type as ObjectType]?.label ?? obj.type}
                  </div>
                  <div className="px-2 py-2.5 flex justify-center">
                    {isRestricted ? (
                      <span className="flex items-center gap-0.5 text-2xs font-medium px-1.5 py-0.5 rounded-full bg-warning-wash text-warning">
                        <Lock size={8} /> {obj.type === 'form' ? ((obj as { in_menu?: boolean }).in_menu ? 'In menu' : 'Granted') : 'Restricted'}
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5 text-2xs font-medium px-1.5 py-0.5 rounded-full bg-success-wash text-success">
                        <Unlock size={8} /> {obj.type === 'form' ? 'No grants' : 'Open'}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Selected object permissions panel */}
        <div className="min-w-0 rounded-xl border p-4 border-border bg-panel">
          {selectedObject ? (
            <div className="space-y-3">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <h4 className="min-w-0 truncate text-sm font-semibold text-fg" title={selectedObject.name}>{selectedObject.name}</h4>
                <Link href={typeConfig[selectedObject.type]?.href(selectedObject.id) ?? '#'}
                  className="text-2xs flex items-center gap-0.5 hover:underline text-primary-text">
                  Open <ChevronRight size={10} />
                </Link>
              </div>
              <ObjectPermissions
                key={`${selectedObject.type}:${selectedObject.id}`}
                objectType={selectedObject.type}
                objectId={selectedObject.id}
                objectName={selectedObject.name}
                showExecute={Boolean(OBJECT_PERMISSION_META[selectedObject.type].execute)}
                executeLabel={OBJECT_PERMISSION_META[selectedObject.type].execute ?? undefined}
                showEditDelete={OBJECT_PERMISSION_META[selectedObject.type].editDelete}
                copy={selectedObject.type === 'form' ? FORM_COPY : undefined}
              />
              {selectedObject.type === 'form' && (
                <FormMenuSwitch formId={selectedObject.id} formName={selectedObject.name}
                  inMenu={(objects as Array<{ id: string; in_menu?: boolean }>).find((o) => o.id === selectedObject.id)?.in_menu === true} />
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full min-h-[200px]">
              <p className="text-xs text-center text-fg-muted">
                Select an object from the list to manage its permissions
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Forms: the Available forms switch next to the grants, so people with access see the form in their Forms menu. */
function FormMenuSwitch({ formId, formName, inMenu }: { formId: string; formName: string; inMenu: boolean }) {
  const queryClient = useQueryClient()
  const { can } = usePermissions()
  const canEdit = can('forms.edit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toggle = async (next: boolean) => {
    setBusy(true); setError(null)
    const result = await updateForm(formId, { available_in_menu: next })
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['all-objects-for-permissions'] }),
      queryClient.invalidateQueries({ queryKey: ['available-forms'] }),
    ])
  }
  return (
    <div className="rounded-lg border p-3 space-y-1 border-border" data-testid="governance-form-menu-switch">
      <label className="flex items-center gap-2 text-xs font-medium text-fg">
        <input type="checkbox" checked={inMenu} disabled={!canEdit || busy} onChange={(e) => void toggle(e.target.checked)} style={{ accentColor: 'var(--theme-primary)' }} />
        Available forms — show “{formName}” in the Forms menu of the people above
      </label>
      <p className={inMenu ? 'text-xs text-fg-muted' : 'text-xs text-warning'}>
        {inMenu ? 'On: everyone given access (who can submit forms) sees it in their Forms menu.' : 'Off: people given access won’t see this form in their Forms menu until you turn this on.'}
        {!canEdit && ' You need Edit forms to change this.'}
      </p>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </div>
  )
}
