'use client'

import { useState, useEffect } from 'react'
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
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface ObjectPermissionsProps {
  objectType: 'workflow' | 'data_table' | 'agent' | 'integration' | 'api_key' | 'report'
  objectId: string
  objectName?: string
  showExecute?: boolean // show can_execute column (for workflows, agents, integrations)
}

const OBJECT_LABELS: Record<string, string> = {
  workflow: 'Workflow', data_table: 'Data Table',
  agent: 'Agent', integration: 'Integration', api_key: 'API Key', report: 'Report',
}

export function ObjectPermissions({ objectType, objectId, objectName, showExecute = true }: ObjectPermissionsProps) {
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
      queryClient.invalidateQueries({ queryKey: ['object-permissions', objectType, objectId] })
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
      queryClient.invalidateQueries({ queryKey: ['object-permissions', objectType, objectId] })
    } catch {}
  }

  async function handleRemove(id: string) {
    try {
      await removeObjectPermission(id)
      queryClient.invalidateQueries({ queryKey: ['object-permissions', objectType, objectId] })
    } catch {}
  }

  async function handleResetToOpen() {
    try {
      await removeAllObjectPermissions(objectType, objectId)
      queryClient.invalidateQueries({ queryKey: ['object-permissions', objectType, objectId] })
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

  return (
    <div className="space-y-4">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={16} style={{ color: 'var(--theme-primary-text)' }} />
          <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>
            {OBJECT_LABELS[objectType]} Permissions
          </h3>
          {isRestricted ? (
            <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              <Lock size={9} /> Restricted
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
              <Unlock size={9} /> Open to all
            </span>
          )}
        </div>
        {canManage && isRestricted && (
          <Button variant="outline" size="sm" onClick={() => setResetOpen(true)} className="!h-7 !text-[10px]">
            <Unlock size={10} className="mr-1" /> Reset to open
          </Button>
        )}
      </div>

      <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
        {isRestricted
          ? `Only the roles and users listed below have access to this ${OBJECT_LABELS[objectType].toLowerCase()}.`
          : `Everyone in your organization can access this ${OBJECT_LABELS[objectType].toLowerCase()}. Add roles or users below to restrict access.`
        }
      </p>

      {/* Permissions table */}
      {permissions.length > 0 && (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <div className="grid text-[10px] font-semibold uppercase tracking-wider"
            style={{
              gridTemplateColumns: showExecute ? '1fr 70px 70px 70px 70px 36px' : '1fr 70px 70px 70px 36px',
              backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)',
            }}>
            <div className="px-3 py-2">Role / User</div>
            <div className="px-2 py-2 text-center">View</div>
            <div className="px-2 py-2 text-center">Edit</div>
            <div className="px-2 py-2 text-center">Delete</div>
            {showExecute && <div className="px-2 py-2 text-center">Execute</div>}
            <div />
          </div>
          {permissions.map(perm => (
            <div key={perm.id} className="grid items-center text-xs border-t"
              style={{
                gridTemplateColumns: showExecute ? '1fr 70px 70px 70px 70px 36px' : '1fr 70px 70px 70px 36px',
                borderColor: 'var(--theme-surface-border)',
              }}>
              <div className="px-3 py-2 flex items-center gap-2 min-w-0">
                <Users size={12} style={{ color: 'var(--theme-muted-text)' }} />
                <div className="min-w-0">
                  <span className="font-medium truncate block" style={{ color: 'var(--theme-card-text)' }}>
                    {perm.role?.name ?? perm.team?.name ?? perm.user?.display_name ?? '—'}
                  </span>
                  <span className="text-[9px] truncate block" style={{ color: 'var(--theme-muted-text)' }}>
                    {perm.role ? 'Role' : perm.team ? 'Team' : perm.user?.email ?? 'User'}
                  </span>
                </div>
              </div>
              {(['can_view', 'can_edit', 'can_delete', ...(showExecute ? ['can_execute'] : [])] as const).map(field => (
                <div key={field} className="px-2 py-2 flex justify-center">
                  <button
                    onClick={() => canManage && handleToggle(perm, field as any)}
                    disabled={!canManage}
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
                  <button onClick={() => handleRemove(perm.id)} className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-danger, #DC2626)' }}>
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
            <div className="rounded-lg border p-3 space-y-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--theme-surface-border)' }}>
                  {(['role', 'team', 'user'] as const).map(t => (
                    <button key={t} onClick={() => { setAddType(t); setSelectedId('') }}
                      className="px-3 py-1 text-xs font-medium capitalize"
                      style={{ backgroundColor: addType === t ? 'var(--theme-primary)' : 'transparent', color: addType === t ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}>
                      {t}
                    </button>
                  ))}
                </div>
                <select
                  value={selectedId}
                  onChange={e => setSelectedId(e.target.value)}
                  className="flex-1 rounded-lg border px-3 py-1.5 text-sm"
                  style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
                >
                  <option value="">Select {addType}...</option>
                  {addType === 'role' && availableRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  {addType === 'team' && availableTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  {addType === 'user' && availableUsers.map(u => <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>)}
                </select>
                <Button size="sm" onClick={handleAdd} disabled={!selectedId || saving} className="!h-7">
                  {saving ? '...' : 'Add'}
                </Button>
                <button onClick={() => setAdding(false)} className="p-1" style={{ color: 'var(--theme-muted-text)' }}><X size={14} /></button>
              </div>
              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                Adding a permission will restrict this {OBJECT_LABELS[objectType].toLowerCase()} to only the listed roles/users. Default grants: View + Edit + Execute.
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
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          You need the "Change Roles" permission to manage object-level access.
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
