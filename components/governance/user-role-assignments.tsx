'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Search, Shield, Users as UsersIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { assignRole, removeUserRole } from '@/app/actions/governance'
import { BulkAssignUsersDialog } from './bulk-assign-users-dialog'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface Props {
  users: any[]
  roles: any[]
}

const PAGE_SIZE = 25

/**
 * UserRoleAssignments — the list view for the Governance page.
 *
 * Previously rendered every user in a single flat table with no
 * pagination, which is unusable for tenants that have hundreds or
 * thousands of members. This version adds:
 *
 *   - Pagination (25 per page by default, with a "rows per page"
 *     picker in the footer)
 *   - Live match count next to the search box
 *   - "Bulk manage" button at the top that opens BulkAssignUsersDialog
 *     for mass add/remove of a single role across a multi-select list
 *     of users, with search, filter ("with role" / "without role"),
 *     and paginated selection
 *
 * Inline per-row assign still works for one-off tweaks — the dialog
 * is opt-in for admins who need to touch lots of users at once.
 */
export function UserRoleAssignments({ users, roles }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [assigningUser, setAssigningUser] = useState<string | null>(null)
  const [selectedRole, setSelectedRole] = useState('')
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; roleId: string; roleName: string } | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(u => {
      if ((u.display_name ?? '').toLowerCase().includes(q)) return true
      if ((u.email ?? '').toLowerCase().includes(q)) return true
      // Let users find by role name too — handy for "show everyone
      // who's currently in 'Workflow editor'" without opening the dialog.
      if ((u.assignments ?? []).some((a: any) => (a.role?.name ?? '').toLowerCase().includes(q))) return true
      return false
    })
  }, [users, search])

  // Reset pagination when the filter changes
  useEffect(() => { setPage(1) }, [search, pageSize])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  async function handleAssign() {
    if (!assigningUser || !selectedRole) return
    setLoading(true)
    try {
      await assignRole(assigningUser, selectedRole)
      const roleName = roles.find((role: any) => role.id === selectedRole)?.name ?? 'Role'
      setAssigningUser(null)
      setSelectedRole('')
      setNotice({ tone: 'success', message: `${roleName} assigned.` })
      router.refresh()
    } catch (err: any) {
      setNotice({ tone: 'error', message: err.message })
    }
    setLoading(false)
  }

  async function handleRemove(userId: string, roleId: string) {
    setLoading(true)
    try {
      await removeUserRole(userId, roleId)
      setNotice({ tone: 'success', message: 'Role removed from user.' })
      router.refresh()
    } catch (err: any) {
      setNotice({ tone: 'error', message: err.message ?? 'Failed to remove role' })
    }
    setLoading(false)
  }

  return (
    <div className="space-y-4">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>User Assignments</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
            {users.length} user{users.length !== 1 ? 's' : ''} in this tenant
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, or role…"
              className="pl-9 !h-8 !text-sm"
            />
          </div>
          <Button size="sm" onClick={() => setBulkOpen(true)}>
            <UsersIcon size={13} className="mr-1" /> Bulk manage
          </Button>
        </div>
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--theme-surface-border)' }}
      >
        <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr style={{ backgroundColor: 'var(--theme-surface)' }}>
              <th className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--theme-muted-text)' }}>User</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--theme-muted-text)' }}>Assigned Roles</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold w-24" style={{ color: 'var(--theme-muted-text)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-12 text-center text-sm" style={{ color: 'var(--theme-muted-text)', backgroundColor: 'var(--theme-card-bg)' }}>
                  {search ? 'No users match your search.' : 'No users yet.'}
                </td>
              </tr>
            ) : (
              pageRows.map(user => (
                <tr key={user.id} className="border-t" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-sm" style={{ color: 'var(--theme-card-text)' }}>{user.display_name}</div>
                    <div className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{user.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {user.assignments.length === 0 && (
                        <span className="text-xs italic" style={{ color: 'var(--theme-muted-text)' }}>No roles assigned</span>
                      )}
                      {user.assignments.map((a: any) => (
                        <span
                          key={a.id}
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium',
                            a.role?.is_system ? 'bg-[color:var(--theme-primary-light)] text-[color:var(--theme-card-text)]' : 'bg-purple-50 text-purple-700',
                          )}
                        >
                          <Shield size={9} />
                          {a.role?.name ?? 'Unknown'}
                          <button
                            onClick={() => setRemoveTarget({ userId: user.id, roleId: a.role_id, roleName: a.role?.name ?? 'Role' })}
                            className="ml-0.5 hover:text-red-500"
                            title="Remove role"
                            disabled={loading}
                          >
                            <X size={9} />
                          </button>
                        </span>
                      ))}
                      {assigningUser === user.id ? (
                        <div className="flex items-center gap-1">
                          <select
                            value={selectedRole}
                            onChange={e => setSelectedRole(e.target.value)}
                            className="rounded border px-1.5 py-0.5 text-[10px]"
                            style={{ borderColor: 'var(--theme-surface-border)' }}
                            autoFocus
                          >
                            <option value="">Select role...</option>
                            {roles
                              .filter(r => !user.assignments.some((a: any) => a.role_id === r.id))
                              .map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                          <Button size="sm" className="h-5 text-[10px] px-2" onClick={handleAssign} disabled={!selectedRole || loading}>Add</Button>
                          <button onClick={() => { setAssigningUser(null); setSelectedRole('') }} className="text-gray-400 hover:text-gray-600"><X size={11} /></button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {assigningUser !== user.id && (
                      <button
                        onClick={() => setAssigningUser(user.id)}
                        className="text-xs text-[color:var(--theme-card-text)] hover:underline flex items-center gap-1 ml-auto"
                      >
                        <Plus size={11} /> Assign
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>

        {/* Pagination footer — always shown so users can switch rows/page
            even on short lists, but the prev/next buttons only appear
            when there's more than one page. */}
        {filtered.length > 0 && (
          <div
            className="flex items-center justify-between px-4 py-2 border-t text-[11px]"
            style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}
          >
            <div className="flex items-center gap-2">
              <span>
                Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length}
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
                  {[25, 50, 100, 250].map(n => <option key={n} value={n}>{n}</option>)}
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
      </div>

      <BulkAssignUsersDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        users={users}
        roles={roles}
        onComplete={() => router.refresh()}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null) }}
        title="Remove Role"
        description={`Remove ${removeTarget?.roleName ?? 'this role'} from the selected user?`}
        confirmLabel="Remove"
        destructive
        busy={loading}
        onConfirm={async () => {
          if (!removeTarget) return
          await handleRemove(removeTarget.userId, removeTarget.roleId)
          setRemoveTarget(null)
        }}
      />
    </div>
  )
}
