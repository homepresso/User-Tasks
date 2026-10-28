'use client'

import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useRouter } from 'next/navigation'
import {
  Plus, Pencil, Trash2, Shield, Lock, Users as UsersIcon,
  Search, Grid3x3, List, ChevronUp, ChevronDown, Archive,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { createRole, updateRole, deleteRole } from '@/app/actions/governance'
import { RoleEditor } from './role-editor'
import { BulkAssignUsersDialog } from './bulk-assign-users-dialog'
import { useAppStore } from '@/stores/app-store'
import { RetentionPolicyAssignment } from './retention-policy-assignment'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useQueryClient } from '@tanstack/react-query'
import { ExportAssetButton, ImportConfigButton } from '@/components/shared/config-transfer'

interface Props {
  roles: any[]
  users: any[]
}

type RoleSortField = 'name' | 'permissions' | 'users' | 'type'
type RoleTypeFilter = 'all' | 'system' | 'custom'

const ROLE_PAGE_SIZE = 25

export function RoleList({ roles, users }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [localRoles, setLocalRoles] = useState(roles)
  const [editingRole, setEditingRole] = useState<any | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  // Which role's bulk-manage dialog is open, if any. Stored at the
  // parent so only one dialog mounts at a time even though every
  // card exposes a "Manage users" button.
  const [bulkRoleId, setBulkRoleId] = useState<string | null>(null)
  const [retentionRole, setRetentionRole] = useState<any | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  // List UI state — matches the Agents page pattern: search,
  // type filter, sort, paging, persisted grid/list toggle.
  const { layoutPreference, setLayoutPreference } = useAppStore()
  const viewMode = (layoutPreference.roles === 'list' ? 'list' : 'grid') as 'grid' | 'list'
  const setViewMode = (v: 'grid' | 'list') => setLayoutPreference('roles', v)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<RoleTypeFilter>('all')
  const [sortBy, setSortBy] = useState<RoleSortField>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(ROLE_PAGE_SIZE)

  useEffect(() => {
    setLocalRoles(roles)
  }, [roles])

  // Precompute user counts per role once so filter/sort don't walk
  // the full users array per role per keystroke.
  const userCountByRole = useMemo(() => {
    const map = new Map<string, number>()
    for (const u of users) {
      for (const a of u.assignments ?? []) {
        map.set(a.role_id, (map.get(a.role_id) ?? 0) + 1)
      }
    }
    return map
  }, [users])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return localRoles.filter(r => {
      if (typeFilter === 'system' && !r.is_system) return false
      if (typeFilter === 'custom' && r.is_system) return false
      if (!q) return true
      return (
        (r.name ?? '').toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q)
      )
    })
  }, [localRoles, search, typeFilter])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name') cmp = String(a.name ?? '').localeCompare(String(b.name ?? ''))
      else if (sortBy === 'permissions') cmp = ((a.permissions ?? []).length) - ((b.permissions ?? []).length)
      else if (sortBy === 'users') cmp = (userCountByRole.get(a.id) ?? 0) - (userCountByRole.get(b.id) ?? 0)
      else if (sortBy === 'type') cmp = Number(!!b.is_system) - Number(!!a.is_system)
      return sortDir === 'desc' ? -cmp : cmp
    })
    return copy
  }, [filtered, sortBy, sortDir, userCountByRole])

  // Reset pagination whenever the working set changes
  useEffect(() => { setPage(1) }, [search, typeFilter, pageSize])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sorted, safePage, pageSize],
  )

  function toggleSort(field: RoleSortField) {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir(field === 'name' ? 'asc' : 'desc') }
  }

  const SortIcon = ({ field }: { field: RoleSortField }) => {
    if (sortBy !== field) return null
    return sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
  }

  async function handleDelete(roleId: string) {
    const role = localRoles.find(r => r.id === roleId)
    setDeleting(roleId)
    const previous = localRoles
    try {
      setLocalRoles((current) => current.filter((role) => role.id !== roleId))
      await deleteRole(roleId)
      setNotice({ tone: 'success', message: `Role "${role?.name ?? 'Role'}" deleted.` })
      router.refresh()
    } catch (err: any) {
      setLocalRoles(previous)
      setNotice({ tone: 'error', message: err.message ?? 'Failed to delete role' })
    }
    setDeleting(null)
  }

  async function handleSave(data: { name: string; description: string; permissions: string[] }, roleId?: string) {
    if (roleId) {
      await updateRole(roleId, data)
    } else {
      await createRole(data)
    }
    setEditingRole(null)
    setShowCreate(false)
    router.refresh()
  }

  // When in grid mode we still want the "system vs custom" split
  // headers for quick scanning. Computed off the *filtered* set so
  // search + type filter narrow each group together.
  const systemRoles = pageRows.filter(r => r.is_system)
  const customRoles = pageRows.filter(r => !r.is_system)

  return (
    <div className="space-y-4">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete Role"
        description={`Delete "${deleteTarget?.name ?? 'this role'}"? All users assigned to it will lose its permissions.`}
        confirmLabel="Delete"
        destructive
        busy={Boolean(deleteTarget && deleting === deleteTarget.id)}
        onConfirm={async () => {
          if (!deleteTarget) return
          await handleDelete(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>Roles</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
            {sorted.length === roles.length
              ? `${roles.length} role${roles.length !== 1 ? 's' : ''} configured`
              : `${sorted.length} of ${roles.length} roles match`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ImportConfigButton onImported={() => { void queryClient.invalidateQueries({ queryKey: ['governance'] }); router.refresh() }} />
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} className="mr-1" /> Create Role
          </Button>
        </div>
      </div>

      {/* Toolbar — search, type filter, view toggle. Mirrors the
          Agents page layout so governance feels consistent. */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search roles by name or description…"
            className="pl-9 !h-8 !text-sm"
          />
        </div>
        <div className="flex rounded-lg overflow-hidden border shrink-0" style={{ borderColor: 'var(--theme-surface-border)' }}>
          {(['all', 'system', 'custom'] as RoleTypeFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setTypeFilter(f)}
              className="px-2.5 py-1 text-[10px] font-medium capitalize transition-colors"
              style={{
                backgroundColor: typeFilter === f ? 'var(--theme-primary)' : 'transparent',
                color: typeFilter === f ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
              }}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg overflow-hidden border shrink-0" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <button
            onClick={() => setViewMode('grid')}
            className="p-1.5"
            style={{ backgroundColor: viewMode === 'grid' ? 'var(--theme-primary)' : 'transparent', color: viewMode === 'grid' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}
            title="Card view"
          >
            <Grid3x3 size={14} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className="p-1.5"
            style={{ backgroundColor: viewMode === 'list' ? 'var(--theme-primary)' : 'transparent', color: viewMode === 'list' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}
            title="List view"
          >
            <List size={14} />
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
          <Shield size={36} className="mx-auto mb-3" style={{ color: 'var(--theme-muted-text)', opacity: 0.3 }} />
          <p className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>
            {search || typeFilter !== 'all' ? 'No roles match your filters' : 'No roles configured yet'}
          </p>
          {!search && typeFilter === 'all' && (
            <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
              Create your first role to define a permission set.
            </p>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="space-y-6">
          {/* System roles */}
          {systemRoles.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>System Roles</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {systemRoles.map(role => (
                  <RoleCard
                    key={role.id}
                    role={role}
                    users={users}
                    onEdit={() => setEditingRole(role)}
                    onDelete={() => setDeleteTarget({ id: role.id, name: role.name })}
                    onManage={() => setBulkRoleId(role.id)}
                    onRetention={() => setRetentionRole(role)}
                    deleting={deleting === role.id}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Custom roles */}
          {customRoles.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>Custom Roles</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {customRoles.map(role => (
                  <RoleCard
                    key={role.id}
                    role={role}
                    users={users}
                    onEdit={() => setEditingRole(role)}
                    onDelete={() => setDeleteTarget({ id: role.id, name: role.name })}
                    onManage={() => setBulkRoleId(role.id)}
                    onRetention={() => setRetentionRole(role)}
                    deleting={deleting === role.id}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <RoleTable
          rows={pageRows}
          userCountByRole={userCountByRole}
          sortBy={sortBy}
          sortDir={sortDir}
          toggleSort={toggleSort}
          SortIcon={SortIcon}
          onEdit={(role) => setEditingRole(role)}
          onManage={(roleId) => setBulkRoleId(roleId)}
          onRetention={(role) => setRetentionRole(role)}
          onDelete={(roleId) => {
            const role = localRoles.find((item: any) => item.id === roleId)
            setDeleteTarget({ id: roleId, name: role?.name ?? 'Role' })
          }}
          deletingId={deleting}
        />
      )}

      {/* Pagination footer */}
      {sorted.length > 0 && (
        <div
          className="flex items-center justify-between px-3 py-2 rounded-lg border text-[11px]"
          style={{
            borderColor: 'var(--theme-surface-border)',
            backgroundColor: 'var(--theme-card-bg)',
            color: 'var(--theme-muted-text)',
          }}
        >
          <div className="flex items-center gap-2">
            <span>
              Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sorted.length)} of {sorted.length}
            </span>
            <span>·</span>
            <label className="flex items-center gap-1">
              Rows per page
              <select
                value={pageSize}
                onChange={e => setPageSize(Number(e.target.value))}
                className="rounded border px-1.5 py-0.5 text-[11px]"
                style={{
                  borderColor: 'var(--theme-surface-border)',
                  backgroundColor: 'var(--theme-card-bg)',
                  color: 'var(--theme-card-text)',
                }}
              >
                {[12, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
              >‹ Prev</button>
              <span className="px-2">Page {safePage} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
              >Next ›</button>
            </div>
          )}
        </div>
      )}

      {/* Editor modal */}
      {(editingRole || showCreate) && (
        <RoleEditor
          role={editingRole}
          onSave={handleSave}
          onClose={() => { setEditingRole(null); setShowCreate(false) }}
        />
      )}

      {/* Bulk-manage dialog, pre-locked to whichever role the admin
          clicked into. Mounted once at the parent so switching
          between role cards reuses the same dialog instance. */}
      <BulkAssignUsersDialog
        open={!!bulkRoleId}
        onOpenChange={(o) => { if (!o) setBulkRoleId(null) }}
        users={users}
        roles={roles}
        lockedRoleId={bulkRoleId ?? undefined}
        onComplete={() => router.refresh()}
      />

      <Dialog.Root open={!!retentionRole} onOpenChange={(open) => { if (!open) setRetentionRole(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[120] bg-black/35 backdrop-blur-[1px]" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[121] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-5 shadow-2xl"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
          >
            <div className="mb-4">
              <Dialog.Title className="text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>
                Role Retention Policy
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm" style={{ color: 'var(--theme-muted-text)' }}>
                Apply a governed retention policy to <span className="font-medium" style={{ color: 'var(--theme-card-text)' }}>{retentionRole?.name ?? 'this role'}</span>.
              </Dialog.Description>
            </div>
            {retentionRole && (
              <RetentionPolicyAssignment
                targetType="role"
                targetId={retentionRole.id}
                currentPolicyId={retentionRole.retention_policy_id}
                allowedScope="roles"
              />
            )}
            <div className="mt-5 flex justify-end">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">Close</Button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function RoleCard({
  role,
  users,
  onEdit,
  onDelete,
  onManage,
  onRetention,
  deleting,
}: {
  role: any
  users: any[]
  onEdit: () => void
  onDelete: () => void
  onManage: () => void
  onRetention: () => void
  deleting: boolean
}) {
  const permCount = (role.permissions ?? []).length

  // All user management (add + remove) now lives in the bulk dialog
  // opened via onManage. The card only shows the assigned count.
  const assignedCount = useMemo(() => (
    users.filter((user) => user.assignments?.some((assignment: any) => assignment.role_id === role.id)).length
  ), [role.id, users])

  return (
    <Card className="p-4" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', role.is_system ? 'bg-[color:var(--theme-primary-light)] text-[color:var(--theme-card-text)]' : 'bg-purple-50 text-purple-600')}>
            {role.is_system ? <Shield size={18} /> : <Lock size={18} />}
          </div>
          <div>
            <h4 className="font-semibold text-sm" style={{ color: 'var(--theme-card-text)' }}>{role.name}</h4>
            <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
              {permCount} permission{permCount !== 1 ? 's' : ''}
              {role.is_system && ' · System'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={onEdit} className="p-1.5 rounded hover:bg-gray-100" title="Edit">
            <Pencil size={13} style={{ color: 'var(--theme-muted-text)' }} />
          </button>
          {!role.is_system && <ExportAssetButton ids={[role.id]} name={role.name} iconOnly variant="ghost" className="!h-auto !p-1.5" style={{ color: 'var(--theme-muted-text)' }} />}
          {!role.is_system && (
            <button onClick={onDelete} disabled={deleting} className="p-1.5 rounded hover:bg-red-50" title="Delete">
              <Trash2 size={13} className={deleting ? 'text-gray-300' : 'text-red-400'} />
            </button>
          )}
        </div>
      </div>
      {role.description && (
        <p className="text-xs mt-2 line-clamp-2" style={{ color: 'var(--theme-muted-text)' }}>{role.description}</p>
      )}

      <div className="mt-4 rounded-xl border p-3 flex items-center justify-between gap-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center',
              role.is_system ? 'bg-[color:var(--theme-primary-light)] text-[color:var(--theme-card-text)]' : 'bg-purple-50 text-purple-600',
            )}
          >
            <UsersIcon size={14} />
          </div>
          <div>
            <p className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>
              {assignedCount} user{assignedCount !== 1 ? 's' : ''}
            </p>
            <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
              {assignedCount === 0 ? 'None assigned yet' : 'in this role'}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={onManage} className="h-7 text-[11px] px-2.5">
          Manage users
        </Button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>Retention</p>
          <p className="mt-1 truncate text-xs" style={{ color: role.retention_policy?.name ? 'var(--theme-card-text)' : 'var(--theme-muted-text)' }}>
            {role.retention_policy?.name ?? 'No retention policy'}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onRetention} className="h-7 text-[11px] px-2.5">
          <Archive size={11} className="mr-1" /> Policy
        </Button>
      </div>
    </Card>
  )
}

/**
 * RoleTable — flat list view of roles with sortable column headers.
 *
 * Mirrors the Agents list-view table: fixed grid template, sort on
 * the header cell, hover highlight, single action column on the
 * right. Keeps feature parity with the grid view — every row can
 * edit, bulk-manage, or delete in place — but scales to tenants
 * with dozens of custom roles where the card grid would dominate
 * the screen.
 */
function RoleTable({
  rows,
  userCountByRole,
  sortBy,
  sortDir,
  toggleSort,
  SortIcon,
  onEdit,
  onManage,
  onRetention,
  onDelete,
  deletingId,
}: {
  rows: any[]
  userCountByRole: Map<string, number>
  sortBy: RoleSortField
  sortDir: 'asc' | 'desc'
  toggleSort: (f: RoleSortField) => void
  SortIcon: (props: { field: RoleSortField }) => React.ReactElement | null
  onEdit: (role: any) => void
  onManage: (roleId: string) => void
  onRetention: (role: any) => void
  onDelete: (roleId: string) => void
  deletingId: string | null
}) {
  const gridCols = '1.8fr 110px 100px 100px 220px'
  return (
    <div className="rounded-xl border overflow-hidden max-lg:overflow-x-auto" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
      <div className="max-lg:min-w-[760px] grid text-[10px] font-semibold uppercase tracking-wider select-none" style={{ gridTemplateColumns: gridCols, backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
        <button className="px-3 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort('name')} style={{ color: sortBy === 'name' ? 'var(--theme-primary-text)' : undefined }}>
          Name <SortIcon field="name" />
        </button>
        <button className="px-2 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort('type')} style={{ color: sortBy === 'type' ? 'var(--theme-primary-text)' : undefined }}>
          Type <SortIcon field="type" />
        </button>
        <button className="px-2 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort('permissions')} style={{ color: sortBy === 'permissions' ? 'var(--theme-primary-text)' : undefined }}>
          Perms <SortIcon field="permissions" />
        </button>
        <button className="px-2 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort('users')} style={{ color: sortBy === 'users' ? 'var(--theme-primary-text)' : undefined }}>
          Users <SortIcon field="users" />
        </button>
        <div className="px-2 py-2 text-right">Actions</div>
      </div>
      {rows.map(role => {
        const permCount = (role.permissions ?? []).length
        const userCount = userCountByRole.get(role.id) ?? 0
        return (
          <div
            key={role.id}
            className="max-lg:min-w-[760px] grid items-center text-xs border-t hover:bg-[var(--theme-surface)]"
            style={{ gridTemplateColumns: gridCols, borderColor: 'var(--theme-surface-border)' }}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 min-w-0">
              <div
                className={cn(
                  'w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                  role.is_system ? 'bg-[color:var(--theme-primary-light)] text-[color:var(--theme-card-text)]' : 'bg-purple-50 text-purple-600',
                )}
              >
                {role.is_system ? <Shield size={13} /> : <Lock size={13} />}
              </div>
              <div className="min-w-0">
                <div className="font-medium truncate" style={{ color: 'var(--theme-card-text)' }}>{role.name}</div>
                {role.description && (
                  <div className="text-[10px] truncate" style={{ color: 'var(--theme-muted-text)' }}>{role.description}</div>
                )}
              </div>
            </div>
            <div className="px-2 py-2.5">
              <span
                className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: role.is_system ? 'rgba(20,184,166,0.1)' : 'rgba(168,85,247,0.1)',
                  color: role.is_system ? '#17150F' : '#9333EA',
                }}
              >
                {role.is_system ? 'System' : 'Custom'}
              </span>
            </div>
            <div className="px-2 py-2.5" style={{ color: 'var(--theme-muted-text)' }}>{permCount}</div>
            <div className="px-2 py-2.5" style={{ color: 'var(--theme-muted-text)' }}>{userCount}</div>
            <div className="px-2 py-2.5 flex items-center justify-end gap-1">
              <button
                onClick={() => onManage(role.id)}
                className="text-[10px] font-medium px-2 py-1 rounded hover:opacity-80"
                style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}
                title="Manage users in this role"
              >
                <UsersIcon size={10} className="inline mr-0.5" /> Users
              </button>
              <button
                onClick={() => onRetention(role)}
                className="text-[10px] font-medium px-2 py-1 rounded hover:opacity-80"
                style={{
                  backgroundColor: role.retention_policy?.name ? 'rgba(59,130,246,0.12)' : 'var(--theme-surface)',
                  color: role.retention_policy?.name ? '#2563EB' : 'var(--theme-muted-text)',
                }}
                title={role.retention_policy?.name ? `Retention: ${role.retention_policy.name}` : 'Assign retention policy'}
              >
                <Archive size={10} className="inline mr-0.5" /> {role.retention_policy?.name ? 'Policy set' : 'Policy'}
              </button>
              <button onClick={() => onEdit(role)} className="p-1 rounded hover:bg-[var(--theme-surface)]" title="Edit">
                <Pencil size={12} style={{ color: 'var(--theme-muted-text)' }} />
              </button>
              {!role.is_system && <ExportAssetButton ids={[role.id]} name={role.name} iconOnly variant="ghost" className="!h-auto !p-1" style={{ color: 'var(--theme-muted-text)' }} />}
              {!role.is_system && (
                <button
                  onClick={() => onDelete(role.id)}
                  disabled={deletingId === role.id}
                  className="p-1 rounded hover:bg-red-50 disabled:opacity-50"
                  title="Delete"
                >
                  <Trash2 size={12} className="text-red-400" />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
