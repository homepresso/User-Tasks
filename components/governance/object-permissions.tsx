'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/lib/permissions-context'
import { useDashboardAuth } from '@/lib/dashboard-auth-context'
import {
  getObjectPermissions, setObjectPermission, removeObjectPermission, removeAllObjectPermissions,
  type ObjectPermission,
} from '@/app/actions/object-permissions'
import { Shield, Plus, Trash2, X, Users, Lock, Unlock, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AVAILABLE_FORMS_QUERY_KEY } from '@/lib/forms/available-forms'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'

interface ObjectPermissionsProps {
  objectType: 'workflow' | 'data_table' | 'agent' | 'integration' | 'api_key' | 'report' | 'form'
  objectId: string
  objectName?: string
  showExecute?: boolean // show can_execute column (for workflows, agents, integrations)
  /** Header of the can_execute column (default "Execute"; forms: "Submit"). */
  executeLabel?: string
  /** Show the Edit and Delete columns (default true; forms only use View and Submit). */
  showEditDelete?: boolean
  /** Wording for objects whose grants don't restrict access (forms: grants list the form in people's Forms menu). */
  copy?: { openBadge: string; restrictedBadge: string; open: string; restricted: string }
}

const OBJECT_LABELS: Record<string, string> = {
  workflow: 'Workflow', data_table: 'Data Table',
  agent: 'Agent', integration: 'Integration', api_key: 'API Key', report: 'Report', form: 'Form',
}

export function ObjectPermissions({ objectType, objectId, objectName, showExecute = true, executeLabel = 'Execute', showEditDelete = true, copy }: ObjectPermissionsProps) {
  const { can } = usePermissions()
  const { profile } = useDashboardAuth()
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [addType, setAddType] = useState<'role' | 'user' | 'team'>('role')
  const [selectedId, setSelectedId] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [resetOpen, setResetOpen] = useState(false)

  const canManage = can('team.change_roles')

  // Fetch current permissions
  const { data: permissions = [], isLoading } = useQuery({
    queryKey: ['object-permissions', objectType, objectId],
    queryFn: () => getObjectPermissions(objectType, objectId),
    enabled: !!objectId,
  })

  // Fetch roles and users for the add dropdown
  const { data: roles } = useQuery({
    queryKey: ['roles-list'],
    queryFn: async () => {
      const { data } = await serverRead('governance.roleOptions', { tenantId: tenantId ?? '' })
      return data ?? []
    },
    enabled: adding && addType === 'role',
  })

  const { data: users } = useQuery({
    queryKey: ['users-list'],
    queryFn: async () => {
      const { data } = await serverRead('governance.userOptions', { tenantId: tenantId ?? '' })
      return data ?? []
    },
    enabled: adding && addType === 'user',
  })

  const { data: teams } = useQuery({
    queryKey: ['teams-list'],
    queryFn: async () => {
      const { data } = await serverRead('governance.teamOptions', { tenantId: tenantId ?? '' })
      return data ?? []
    },
    enabled: adding && addType === 'team',
  })

  const isRestricted = permissions.length > 0
  // Grants on a form decide who sees it in the sidebar Forms menu ("Available forms").
  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['object-permissions', objectType, objectId] }),
    ...(objectType === 'form' ? [queryClient.invalidateQueries({ queryKey: AVAILABLE_FORMS_QUERY_KEY })] : []),
  ])
  const flagFields = [...(showEditDelete ? ['can_view', 'can_edit', 'can_delete'] : ['can_view']), ...(showExecute ? ['can_execute'] : [])] as const
  const gridTemplateColumns = `1fr ${flagFields.map(() => '70px').join(' ')} 36px`

  async function handleAdd() {
    if (!selectedId) return
    setSaving(true)
    try {
      await setObjectPermission({
        objectType, objectId,
        roleId: addType === 'role' ? selectedId : undefined,
        userId: addType === 'user' ? selectedId : undefined,
        teamId: addType === 'team' ? selectedId : undefined,
        canView: true, canEdit: true, canDelete: false, canExecute: true,
      })
      void invalidate()
      setSelectedId('')
      setAdding(false)
    } catch (e: any) {
      setNotice({ tone: 'error', message: e.message })
    }
    setSaving(false)
  }

  async function handleToggle(perm: ObjectPermission, field: 'can_view' | 'can_edit' | 'can_delete' | 'can_execute') {
    try {
      await setObjectPermission({
        objectType, objectId,
        roleId: perm.role_id ?? undefined,
        userId: perm.user_id ?? undefined,
        teamId: perm.team_id ?? undefined,
        canView: field === 'can_view' ? !perm.can_view : perm.can_view,
        canEdit: field === 'can_edit' ? !perm.can_edit : perm.can_edit,
        canDelete: field === 'can_delete' ? !perm.can_delete : perm.can_delete,
        canExecute: field === 'can_execute' ? !perm.can_execute : perm.can_execute,
      })
      void invalidate()
    } catch (e: any) {
      setNotice({ tone: 'error', message: e?.message ?? 'Failed to update permissions' })
    }
  }

  async function handleRemove(id: string) {
    try {
      await removeObjectPermission(id)
      void invalidate()
    } catch (e: any) {
      setNotice({ tone: 'error', message: e?.message ?? 'Failed to update permissions' })
    }
  }

  async function handleResetToOpen() {
    try {
      await removeAllObjectPermissions(objectType, objectId)
      void invalidate()
      setNotice({ tone: 'success', message: 'Permissions reset. This item is now open to everyone.' })
    } catch (e: any) {
      setNotice({ tone: 'error', message: e?.message ?? 'Failed to reset permissions' })
    }
  }

  // Filter out already-added roles/users
  const existingRoleIds = new Set(permissions.filter(p => p.role_id).map(p => p.role_id))
  const existingUserIds = new Set(permissions.filter(p => p.user_id).map(p => p.user_id))
  const existingTeamIds = new Set(permissions.filter(p => p.team_id).map(p => p.team_id))
  const availableRoles = (roles ?? []).filter(r => !existingRoleIds.has(r.id))
  const availableUsers = (users ?? []).filter(u => !existingUserIds.has(u.id))
  const availableTeams = (teams ?? []).filter(t => !existingTeamIds.has(t.id))
  const addOptions = addType === 'role' ? availableRoles.map(r => ({ value: String(r.id), label: String(r.name) }))
    : addType === 'team' ? availableTeams.map(t => ({ value: String(t.id), label: String(t.name) }))
    : availableUsers.map(u => ({ value: String(u.id), label: String(u.display_name || u.email), hint: u.email ? String(u.email) : undefined }))
  const addNoun = addType === 'user' ? 'people' : `${addType}s`

  return (
    <div className="min-w-0 space-y-4">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Shield size={16} style={{ color: 'var(--theme-primary-text)' }} />
          <h3 className="text-sm font-semibold text-fg">
            {OBJECT_LABELS[objectType]} Permissions
          </h3>
          {isRestricted ? (
            <span className="flex items-center gap-1 text-2xs font-medium px-2 py-0.5 rounded-full bg-warning-wash text-warning">
              <Lock size={9} /> {copy?.restrictedBadge ?? 'Restricted'}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-2xs font-medium px-2 py-0.5 rounded-full bg-success-wash text-success">
              <Unlock size={9} /> {copy?.openBadge ?? 'Open to all'}
            </span>
          )}
        </div>
        {canManage && isRestricted && (
          <Button variant="outline" size="sm" onClick={() => setResetOpen(true)} className="!h-7 !text-2xs">
            <Unlock size={10} className="mr-1" /> Reset to open
          </Button>
        )}
      </div>

      <p className="text-xs text-fg-muted">
        {copy ? (isRestricted ? copy.restricted : copy.open) : isRestricted
          ? `Only the roles and users listed below have access to this ${OBJECT_LABELS[objectType].toLowerCase()}.`
          : `Everyone in your organization can access this ${OBJECT_LABELS[objectType].toLowerCase()}. Add roles or users below to restrict access.`
        }
      </p>

      {/* Permissions table */}
      {permissions.length > 0 && (
        <div className="rounded-lg border overflow-hidden border-border">
          <div className="grid text-2xs font-semibold "
            style={{
              gridTemplateColumns,
              backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)',
            }}>
            <div className="px-3 py-2">Role / Team / User</div>
            <div className="px-2 py-2 text-center">View</div>
            {showEditDelete && <div className="px-2 py-2 text-center">Edit</div>}
            {showEditDelete && <div className="px-2 py-2 text-center">Delete</div>}
            {showExecute && <div className="px-2 py-2 text-center">{executeLabel}</div>}
            <div />
          </div>
          {permissions.map(perm => (
            <div key={perm.id} className="grid items-center text-xs border-t"
              style={{
                gridTemplateColumns,
                borderColor: 'var(--theme-surface-border)',
              }}>
              <div className="px-3 py-2 flex items-center gap-2 min-w-0">
                <Users size={12} style={{ color: 'var(--theme-muted-text)' }} />
                <div className="min-w-0">
                  <span className="font-medium truncate block text-fg">
                    {perm.role?.name ?? perm.team?.name ?? perm.user?.display_name ?? '—'}
                  </span>
                  <span className="text-2xs truncate block text-fg-muted">
                    {perm.role ? 'Role' : perm.team ? 'Team' : perm.user?.email ?? 'User'}
                  </span>
                </div>
              </div>
              {flagFields.map(field => (
                <div key={field} className="px-2 py-2 flex justify-center">
                  <button
                    onClick={() => canManage && handleToggle(perm, field as any)}
                    disabled={!canManage}
                    aria-pressed={Boolean((perm as any)[field])}
                    aria-label={`${field === 'can_execute' ? executeLabel : field.slice(4).replace(/^./, (c) => c.toUpperCase())}: ${perm.role?.name ?? perm.team?.name ?? perm.user?.display_name ?? ''}`}
                    className={cn(
                      'w-5 h-5 rounded flex items-center justify-center transition-colors',
                      (perm as any)[field] ? 'bg-[color:var(--theme-primary)] text-[color:var(--theme-on-primary)]' : 'border',
                    )}
                    style={{ borderColor: (perm as any)[field] ? undefined : 'var(--theme-surface-border)' }}
                  >
                    {(perm as any)[field] && <Check size={10} />}
                  </button>
                </div>
              ))}
              <div className="px-1 py-2 flex justify-center">
                {canManage && (
                  <button onClick={() => handleRemove(perm.id)} className="p-1 rounded hover:opacity-70 text-danger">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add permission */}
      {canManage && (
        <>
          {adding ? (
            // min-w-0 + wrapping rows keep the kind switch, the search box and Add inside narrow panels
            // (the Governance side panel, a form's Details → Access); the options open in a portal layer.
            <div className="min-w-0 rounded-lg border p-3 space-y-2 border-border bg-subtle" data-object-permissions-add>
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex shrink-0 rounded-lg overflow-hidden border" role="radiogroup" aria-label="Grant to" style={{ borderColor: 'var(--theme-surface-border)' }}>
                  {(['role', 'team', 'user'] as const).map(t => (
                    <button key={t} type="button" role="radio" aria-checked={addType === t} onClick={() => { setAddType(t); setSelectedId('') }}
                      className="px-3 py-1 text-xs font-medium capitalize"
                      style={{ backgroundColor: addType === t ? 'var(--theme-primary)' : 'transparent', color: addType === t ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}>
                      {t}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => setAdding(false)} className="ml-auto shrink-0 p-1" aria-label="Cancel adding a permission" style={{ color: 'var(--theme-muted-text)' }}><X size={14} /></button>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1 basis-44">
                  <AutocompleteSelect value={selectedId} onChange={setSelectedId} options={addOptions}
                    placeholder={`Search ${addNoun}…`} emptyLabel={`No ${addNoun} left to add`} />
                </div>
                <Button size="sm" onClick={handleAdd} disabled={!selectedId || saving} className="!h-8 shrink-0">
                  {saving ? '...' : 'Add'}
                </Button>
              </div>
              <p className="text-2xs text-fg-muted">
                Adding a permission will restrict this {OBJECT_LABELS[objectType].toLowerCase()} to only the listed roles/users. Default grants: {showEditDelete ? `View + Edit + ${executeLabel}` : `View + ${executeLabel}`}.
              </p>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus size={12} className="mr-1" /> Add permission
            </Button>
          )}
        </>
      )}

      {!canManage && (
        <p className="text-2xs text-fg-muted">
          You need the Change roles permission to manage object-level access.
        </p>
      )}

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset Permissions"
        description="Remove all permissions and make this item accessible to everyone?"
        confirmLabel="Reset"
        onConfirm={async () => {
          await handleResetToOpen()
          setResetOpen(false)
        }}
      />
    </div>
  )
}
