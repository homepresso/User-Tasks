'use client'

/* eslint-disable @typescript-eslint/no-explicit-any -- role rows come untyped from governance.settingsPage */

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Archive, ArrowDown, ArrowUp, Download, Lock, MoreHorizontal, Pencil, Plus, Shield, Trash2, Users as UsersIcon,
} from 'lucide-react'
import { Badge, Tag } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { SearchInput } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Table, TBody, TD, TDActions, TH, THead, TR, TableEmpty, type ColumnKind } from '@/components/ui/table'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { DialogBody, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Pagination } from '@/components/ui/list-controls'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { permissionGroupsWithExtensions } from '@/lib/permissions'
import { plural } from '@/lib/format/plural'
import { createRole, updateRole, deleteRole } from '@/app/actions/governance'
import { RoleEditor } from './role-editor'
import { BulkAssignUsersDialog } from './bulk-assign-users-dialog'
import { RetentionPolicyAssignment } from './retention-policy-assignment'
import { useQueryClient } from '@tanstack/react-query'
import { ExportAssetDialog, ImportConfigButton } from '@/components/shared/config-transfer'

interface Props {
  roles: any[]
  users: any[]
}

type RoleSortField = 'name' | 'permissions' | 'users' | 'retention'
type RoleTypeFilter = 'all' | 'system' | 'custom'

const ROLE_PAGE_SIZE = 25

/**
 * Governance → Roles (§5.14): one Table row per role (Role, Users,
 * Permissions, Retention, actions). A row opens the role in a Sheet with its
 * permissions, members and retention policy; edit, manage users, export and
 * delete are in the row's ⋯ menu.
 */
export function RoleList({ roles, users }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [localRoles, setLocalRoles] = useState(roles)
  const [editingRole, setEditingRole] = useState<any | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  // Which role's bulk-manage dialog is open, if any (one dialog for every row).
  const [bulkRoleId, setBulkRoleId] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [exportRole, setExportRole] = useState<{ id: string; name: string } | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<RoleTypeFilter>('all')
  const [sortBy, setSortBy] = useState<RoleSortField>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(ROLE_PAGE_SIZE)

  useEffect(() => {
    setLocalRoles(roles)
  }, [roles])

  // User counts per role, once, so filter/sort don't walk every user per row.
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
      else if (sortBy === 'retention') cmp = String(a.retention_policy?.name ?? '~').localeCompare(String(b.retention_policy?.name ?? '~'))
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
    else { setSortBy(field); setSortDir(field === 'name' || field === 'retention' ? 'asc' : 'desc') }
  }

  async function handleDelete(roleId: string) {
    const role = localRoles.find(r => r.id === roleId)
    setDeleting(roleId)
    const previous = localRoles
    try {
      setLocalRoles((current) => current.filter((role) => role.id !== roleId))
      await deleteRole(roleId)
      setNotice({ tone: 'success', message: `Role "${role?.name ?? 'Role'}" deleted.` })
      if (detailId === roleId) setDetailId(null)
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

  const detail = detailId ? localRoles.find((r) => r.id === detailId) ?? null : null
  const sortable = (field: RoleSortField, label: string, numeric = false, col?: ColumnKind) => (
    <TH numeric={numeric} col={col} aria-sort={sortBy === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => toggleSort(field)} className="inline-flex items-center gap-1 hover:text-fg">
        {label}
        {sortBy === field && (sortDir === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
      </button>
    </TH>
  )

  return (
    <div className="space-y-4">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title={`Delete “${deleteTarget?.name ?? 'this role'}”?`}
        description="Everyone assigned to it loses its permissions."
        confirmLabel="Delete role"
        destructive
        busy={Boolean(deleteTarget && deleting === deleteTarget.id)}
        onConfirm={async () => {
          if (!deleteTarget) return
          await handleDelete(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search roles…"
          aria-label="Search roles"
          className="min-w-[220px]"
          wrapperClassName="w-auto min-w-[220px] flex-1 max-w-sm"
        />
        <SegmentedControl<RoleTypeFilter>
          aria-label="Role type"
          value={typeFilter}
          onValueChange={setTypeFilter}
          options={[{ value: 'all', text: 'All' }, { value: 'system', text: 'System' }, { value: 'custom', text: 'Custom' }]}
        />
        <span className="num text-xs text-fg-muted">
          {sorted.length === roles.length ? plural(roles.length, 'role') : `${sorted.length} of ${plural(roles.length, 'role')}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ImportConfigButton onImported={() => { void queryClient.invalidateQueries({ queryKey: ['governance'] }); router.refresh() }} />
          <Button leadingIcon={<Plus />} onClick={() => setShowCreate(true)}>New role</Button>
        </div>
      </div>

      <Table label="Roles" stickyFirstColumn>
        <THead>
          <tr>
            {sortable('name', 'Role', false, 'title')}
            {sortable('users', 'Users', true, 'number')}
            {sortable('permissions', 'Permissions', true, 'number')}
            {sortable('retention', 'Retention', false, 'name')}
            <TH col="actions"><span className="sr-only">Actions</span></TH>
          </tr>
        </THead>
        <TBody>
          {pageRows.length === 0 ? (
            <TableEmpty
              colSpan={5}
              icon={Shield}
              variant={search || typeFilter !== 'all' ? 'no-results' : 'first-run'}
              title={search || typeFilter !== 'all' ? 'No roles match your filters' : 'No roles yet'}
              description={search || typeFilter !== 'all' ? undefined : 'Create a role to define a permission set.'}
            />
          ) : pageRows.map((role) => {
            const permCount = (role.permissions ?? []).length
            const userCount = userCountByRole.get(role.id) ?? 0
            return (
              <TR key={role.id} interactive selected={role.id === detailId} onClick={() => setDetailId(role.id)} aria-label={`Open role ${role.name}`}>
                <TD className="max-w-0">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-subtle text-fg-muted" aria-hidden>
                      {role.is_system ? <Shield className="size-3.5" /> : <Lock className="size-3.5" />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-fg" title={role.name}>{role.name}</span>
                        {role.is_system && <Tag>System</Tag>}
                      </div>
                      {role.description && <p className="truncate text-xs text-fg-muted" title={role.description}>{role.description}</p>}
                    </div>
                  </div>
                </TD>
                <TD numeric>{userCount}</TD>
                <TD numeric>{permCount}</TD>
                <TD className={role.retention_policy?.name ? 'text-fg' : 'text-fg-muted'}>
                  {role.retention_policy?.name ?? 'None'}
                </TD>
                <TDActions onClick={(e) => e.stopPropagation()}>
                  <RoleMenu
                    role={role}
                    deleting={deleting === role.id}
                    onEdit={() => setEditingRole(role)}
                    onManage={() => setBulkRoleId(role.id)}
                    onRetention={() => setDetailId(role.id)}
                    onExport={() => setExportRole({ id: role.id, name: role.name })}
                    onDelete={() => setDeleteTarget({ id: role.id, name: role.name })}
                  />
                </TDActions>
              </TR>
            )
          })}
        </TBody>
      </Table>

      <Pagination
        page={safePage}
        pageSize={pageSize}
        total={sorted.length}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        pageSizeOptions={[12, 25, 50, 100]}
        noun="roles"
      />

      <RoleSheet
        role={detail}
        userCount={detail ? userCountByRole.get(detail.id) ?? 0 : 0}
        onOpenChange={(open) => { if (!open) setDetailId(null) }}
        onEdit={() => { if (detail) { setEditingRole(detail); setDetailId(null) } }}
        onManage={() => detail && setBulkRoleId(detail.id)}
      />

      {/* Editor modal */}
      {(editingRole || showCreate) && (
        <RoleEditor
          role={editingRole}
          onSave={handleSave}
          onClose={() => { setEditingRole(null); setShowCreate(false) }}
        />
      )}

      <BulkAssignUsersDialog
        open={!!bulkRoleId}
        onOpenChange={(o) => { if (!o) setBulkRoleId(null) }}
        users={users}
        roles={roles}
        lockedRoleId={bulkRoleId ?? undefined}
        onComplete={() => router.refresh()}
      />

      {exportRole && (
        <ExportAssetDialog ids={[exportRole.id]} name={exportRole.name} open onOpenChange={(open) => { if (!open) setExportRole(null) }} />
      )}
    </div>
  )
}

function RoleMenu({ role, deleting, onEdit, onManage, onRetention, onExport, onDelete }: {
  role: any
  deleting: boolean
  onEdit: () => void
  onManage: () => void
  onRetention: () => void
  onExport: () => void
  onDelete: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" label={`Actions for ${role.name}`} icon={<MoreHorizontal />} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem icon={<Pencil />} onSelect={onEdit}>Edit role</DropdownMenuItem>
        <DropdownMenuItem icon={<UsersIcon />} onSelect={onManage}>Manage users</DropdownMenuItem>
        <DropdownMenuItem icon={<Archive />} onSelect={onRetention}>Retention policy</DropdownMenuItem>
        {!role.is_system && (
          <>
            <DropdownMenuItem icon={<Download />} onSelect={onExport}>Export definition</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger icon={<Trash2 />} disabled={deleting} onSelect={onDelete}>Delete role</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The role detail: permissions by group, members, retention policy. */
function RoleSheet({ role, userCount, onOpenChange, onEdit, onManage }: {
  role: any | null
  userCount: number
  onOpenChange: (open: boolean) => void
  onEdit: () => void
  onManage: () => void
}) {
  const granted = new Set<string>(role?.permissions ?? [])
  const groups = permissionGroupsWithExtensions()
    .map((g) => ({ ...g, granted: g.permissions.filter((p) => granted.has(p.key)) }))
    .filter((g) => g.granted.length > 0)
  return (
    <Sheet open={role != null} onOpenChange={onOpenChange}>
      {role && (
        <SheetContent
          size="lg"
          title={<span className="inline-flex items-center gap-2">{role.name}{role.is_system && <Tag>System</Tag>}</span>}
          description={role.description || undefined}
        >
          <DialogBody className="space-y-6 overflow-y-auto">
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-fg">Members</h3>
                <Button size="sm" variant="secondary" leadingIcon={<UsersIcon />} onClick={onManage}>Manage users</Button>
              </div>
              <p className="num text-ui text-fg-muted">{userCount === 0 ? 'Nobody is assigned to this role yet.' : `${plural(userCount, 'person', 'people')} in this role.`}</p>
            </section>

            <section className="space-y-2 border-t border-border-subtle pt-6">
              <h3 className="text-sm font-semibold text-fg">Retention policy</h3>
              <RetentionPolicyAssignment
                targetType="role"
                targetId={role.id}
                currentPolicyId={role.retention_policy_id}
                allowedScope="roles"
              />
            </section>

            <section className="space-y-3 border-t border-border-subtle pt-6">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-fg">Permissions</h3>
                <Badge className="num">{granted.size}</Badge>
              </div>
              {groups.length === 0 ? (
                <p className="text-ui text-fg-muted">This role grants no permissions.</p>
              ) : (
                <dl className="space-y-3">
                  {groups.map((g) => (
                    <div key={g.key}>
                      <dt className="mb-1 text-xs font-medium text-fg-muted"><span>{g.label}</span> <span className="num">{g.granted.length} of {g.permissions.length}</span></dt>
                      <dd className="flex flex-wrap gap-1">
                        {g.granted.map((p) => <Tag key={p.key}>{p.label}</Tag>)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
            <Button leadingIcon={<Pencil />} onClick={onEdit}>Edit role</Button>
          </DialogFooter>
        </SheetContent>
      )}
    </Sheet>
  )
}
