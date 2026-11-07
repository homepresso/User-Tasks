'use client'

import { useState, useMemo, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { overlayClass } from '@/components/ui/dialog'
import { X, Search, Check, Square, CheckSquare, Shield, Users as UsersIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { getInitials } from '@/lib/utils'
import { runInlineJob, useJobs } from '@/components/jobs/jobs-provider'

interface UserRow {
  id: string
  display_name: string | null
  email: string | null
  assignments: { role_id: string; role?: { id: string; name: string } | null }[]
}

interface Role {
  id: string
  name: string
  is_system?: boolean | null
}

interface BulkAssignUsersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  users: UserRow[]
  roles: Role[]
  onComplete?: () => void
  /**
   * When set, the dialog opens with this role pre-selected and hides
   * the role picker entirely. Used by the role card "Manage users"
   * button so admins don't have to re-pick the role they just clicked.
   */
  lockedRoleId?: string
}

/**
 * BulkAssignUsersDialog — mass user/role management for tenants with
 * hundreds or thousands of users.
 *
 * Flow:
 *   1. Pick a role from the dropdown at the top.
 *   2. The user list below shows every tenant member with a checkbox
 *      and a badge indicating whether they already have the role.
 *   3. Search narrows the list; "Select all matching" selects every
 *      row that passes the current filter (not just the page).
 *   4. Two filter chips let admins focus on "With role" or "Without
 *      role" so they can either unassign en masse or assign the
 *      missing ones in one click.
 *   5. Assign adds the role to every selected user who doesn't
 *      already have it; Remove takes it off every selected user
 *      who does. Server returns an accurate {assigned, skipped}
 *      count which we surface in a summary line.
 *
 * Virtualization: the list is windowed via a simple paginated slice
 * capped at PAGE_SIZE per page. For 1000+ users this keeps the DOM
 * bounded; selection state is kept in a Set so it persists across
 * pagination.
 */

const PAGE_SIZE = 50

export function BulkAssignUsersDialog({ open, onOpenChange, users, roles, onComplete, lockedRoleId }: BulkAssignUsersDialogProps) {
  const [selectedRoleId, setSelectedRoleId] = useState<string>('')
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'with' | 'without'>('without')
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const jobs = useJobs()
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)

  // Reset state whenever the dialog reopens so users don't carry
  // stale selections between sessions. When lockedRoleId is provided
  // (opened from a specific role card) we honor it and default the
  // filter to "without role" — the most common bulk-add flow.
  useEffect(() => {
    if (open) {
      setSelectedRoleId(lockedRoleId ?? roles[0]?.id ?? '')
      setSelectedUserIds(new Set())
      setSearch('')
      setFilter(lockedRoleId ? 'without' : 'all')
      setPage(1)
      setSummary(null)
      setError(null)
    }
  }, [open, lockedRoleId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filter users by the role-has filter + the search term. Computed
  // once per keystroke but cached via useMemo so large lists don't
  // re-filter unnecessarily.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter(u => {
      if (selectedRoleId) {
        const has = u.assignments.some(a => a.role_id === selectedRoleId)
        if (filter === 'with' && !has) return false
        if (filter === 'without' && has) return false
      }
      if (!q) return true
      const name = (u.display_name ?? '').toLowerCase()
      const email = (u.email ?? '').toLowerCase()
      return name.includes(q) || email.includes(q)
    })
  }, [users, selectedRoleId, search, filter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  // Reset pagination when the filter/search changes
  useEffect(() => { setPage(1) }, [search, filter, selectedRoleId])

  const allFilteredSelected = filtered.length > 0 && filtered.every(u => selectedUserIds.has(u.id))

  function toggleUser(id: string) {
    setSelectedUserIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllFiltered() {
    setSelectedUserIds(prev => {
      const next = new Set(prev)
      for (const u of filtered) next.add(u.id)
      return next
    })
  }

  function clearSelection() {
    setSelectedUserIds(new Set())
  }

  async function handleAssign() {
    if (!selectedRoleId) {
      setError('Pick a role first')
      return
    }
    if (selectedUserIds.size === 0) {
      setError('Select at least one user')
      return
    }
    setBusy(true)
    setError(null)
    setSummary(null)
    try {
      // A `roles.bulk` job: finishes here, or reports through the popup.
      const outcome = await runInlineJob(jobs, 'roles.bulk', { action: 'assign', role_id: selectedRoleId, user_ids: [...selectedUserIds], role_name: roles.find((r) => r.id === selectedRoleId)?.name ?? 'role' }, { onSuccess: () => onComplete?.() })
      if (outcome.status === 'failed') throw new Error(outcome.error)
      if (outcome.status === 'done') {
        const result = { assigned: outcome.counts.assigned ?? 0, skipped: outcome.counts.skipped ?? 0 }
        const skippedText = result.skipped > 0 ? `, ${result.skipped} already had it` : ''
        setSummary(`Assigned to ${result.assigned} user${result.assigned !== 1 ? 's' : ''}${skippedText}.`)
      } else {
        setSummary('Assigning in the background — we’ll let you know when it’s done.')
      }
      setSelectedUserIds(new Set())
    } catch (e: any) {
      setError(e?.message ?? 'Failed to assign role')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    if (!selectedRoleId) {
      setError('Pick a role first')
      return
    }
    if (selectedUserIds.size === 0) {
      setError('Select at least one user')
      return
    }
    setBusy(true)
    setError(null)
    setSummary(null)
    try {
      const outcome = await runInlineJob(jobs, 'roles.bulk', { action: 'remove', role_id: selectedRoleId, user_ids: [...selectedUserIds], role_name: roles.find((r) => r.id === selectedRoleId)?.name ?? 'role' }, { onSuccess: () => onComplete?.() })
      if (outcome.status === 'failed') throw new Error(outcome.error)
      const removed = outcome.status === 'done' ? outcome.counts.removed ?? 0 : null
      setSummary(removed === null ? 'Removing in the background — we’ll let you know when it’s done.' : `Removed from ${removed} user${removed !== 1 ? 's' : ''}.`)
      setSelectedUserIds(new Set())
    } catch (e: any) {
      setError(e?.message ?? 'Failed to remove role')
    } finally {
      setBusy(false)
    }
  }

  const selectedRole = roles.find(r => r.id === selectedRoleId)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayClass} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 [transform:translate(-50%,-50%)] z-50 w-[min(48rem,92vw)] rounded-xl shadow-elev-3 flex flex-col bg-elevated ds-dialog text-fg"
          style={{
            maxHeight: '85vh',
            height: '85vh',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-6 py-4 border-b shrink-0 border-border"
          >
            <div>
              <Dialog.Title className="text-lg font-semibold flex items-center gap-2 text-fg">
                <UsersIcon size={18} style={{ color: 'var(--theme-primary-text)' }} />
                {lockedRoleId && selectedRole ? `Manage users · ${selectedRole.name}` : 'Manage users in bulk'}
              </Dialog.Title>
              <Dialog.Description className="text-xs mt-0.5 text-fg-muted">
                {lockedRoleId
                  ? 'Search, select, then assign or remove this role in one action'
                  : 'Pick a role, select users, then assign or remove in one action'}
              </Dialog.Description>
            </div>
            <Dialog.Close className="p-1 rounded-lg hover:bg-[var(--theme-surface)] text-fg-muted">
              <X size={18} />
            </Dialog.Close>
          </div>

          {/* Role picker + filters */}
          <div
            className="px-6 py-4 border-b space-y-3 shrink-0 border-border"
          >
            {!lockedRoleId && (
              <div>
                <label className="block text-2xs font-semibold mb-1.5 text-fg-muted">
                  Role
                </label>
                <select
                  value={selectedRoleId}
                  onChange={e => setSelectedRoleId(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm border-border bg-panel text-fg"
                >
                  <option value="">— Select a role —</option>
                  {roles.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name}{r.is_system ? ' (system)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search users by name or email…"
                  className="pl-8 !h-8 !text-xs"
                />
              </div>
              <div className="flex rounded-lg overflow-hidden border shrink-0 border-border">
                {(['all', 'with', 'without'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className="px-2.5 py-1 text-2xs font-medium transition-colors"
                    style={{
                      backgroundColor: filter === f ? 'var(--theme-primary)' : 'transparent',
                      color: filter === f ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
                    }}
                    title={
                      f === 'all' ? 'All users'
                      : f === 'with' ? 'Users who already have the selected role'
                      : 'Users who don\'t yet have the selected role'
                    }
                  >
                    {f === 'all' ? 'All' : f === 'with' ? 'With role' : 'Without role'}
                  </button>
                ))}
              </div>
            </div>

            {/* Selection summary line */}
            <div className="flex items-center justify-between text-2xs text-fg-muted">
              <span>
                Showing {filtered.length} of {users.length} user{users.length !== 1 ? 's' : ''}
                {selectedUserIds.size > 0 && ` · ${selectedUserIds.size} selected`}
              </span>
              <div className="flex items-center gap-2">
                {selectedUserIds.size > 0 && (
                  <button onClick={clearSelection} className="hover:underline text-primary-text">
                    Clear selection
                  </button>
                )}
                {filtered.length > 0 && (
                  <button
                    onClick={allFilteredSelected ? clearSelection : selectAllFiltered}
                    className="hover:underline text-primary-text"
                  >
                    {allFilteredSelected ? 'Deselect all' : `Select all ${filtered.length}`}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* User list — paginated + selectable */}
          <div className="flex-1 overflow-y-auto">
            {pageRows.length === 0 ? (
              <p className="text-center text-sm py-12 text-fg-muted">
                No users match your filters.
              </p>
            ) : (
              pageRows.map(user => {
                const isSelected = selectedUserIds.has(user.id)
                const hasRole = selectedRoleId && user.assignments.some(a => a.role_id === selectedRoleId)
                const name = user.display_name ?? user.email ?? 'Unknown'
                return (
                  <button
                    key={user.id}
                    onClick={() => toggleUser(user.id)}
                    className="w-full flex items-center gap-3 px-6 py-2.5 text-left transition-colors border-b hover:bg-[var(--theme-row-highlight)]"
                    style={{
                      borderColor: 'var(--theme-surface-border)',
                      backgroundColor: isSelected ? 'var(--theme-primary-light)' : undefined,
                    }}
                  >
                    <span style={{ color: isSelected ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}>
                      {isSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                    </span>
                    <span
                      className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-2xs font-bold bg-primary-wash text-primary-text"
                    >
                      {getInitials(name)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-fg">
                        {user.display_name ?? '—'}
                      </p>
                      <p className="text-2xs truncate text-fg-muted">
                        {user.email ?? ''}
                      </p>
                    </div>
                    {hasRole && (
                      <span
                        className="inline-flex items-center gap-1 text-2xs font-bold uppercase px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: 'var(--status-success-bg, var(--theme-primary-light))', color: 'var(--status-success, var(--theme-primary-text))' }}
                      >
                        <Shield size={9} /> Has role
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>

          {/* Pagination bar */}
          {filtered.length > PAGE_SIZE && (
            <div
              className="flex items-center justify-between px-6 py-2 border-t text-2xs shrink-0 border-border text-fg-muted"
            >
              <span>
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
                >‹ Prev</button>
                <span>Page {safePage} of {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
                >Next ›</button>
              </div>
            </div>
          )}

          {/* Status + actions */}
          <div
            className="border-t shrink-0 border-border"
          >
            {(summary || error) && (
              <div
                className="px-6 py-2 text-xs"
                style={{
                  backgroundColor: error ? 'var(--status-error-bg)' : 'var(--status-success-bg, var(--theme-primary-light))',
                  color: error ? 'var(--status-error)' : 'var(--status-success, var(--theme-primary-text))',
                }}
              >
                {error ?? summary}
              </div>
            )}
            <div className="flex items-center justify-between px-6 py-3">
              <span className="text-2xs text-fg-muted">
                {selectedRole
                  ? `Target role: ${selectedRole.name}`
                  : 'Pick a role above to enable actions'}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmRemoveOpen(true)}
                  disabled={busy || selectedUserIds.size === 0 || !selectedRoleId}
                  className="!text-danger hover:!bg-danger-wash"
                >
                  Remove role
                </Button>
                <Button
                  size="sm"
                  onClick={handleAssign}
                  disabled={busy || selectedUserIds.size === 0 || !selectedRoleId}
                >
                  <Check size={13} className="mr-1" />
                  {busy ? 'Working…' : `Assign to ${selectedUserIds.size || ''} user${selectedUserIds.size === 1 ? '' : 's'}`}
                </Button>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
      <ConfirmDialog
        open={confirmRemoveOpen}
        onOpenChange={setConfirmRemoveOpen}
        title="Remove Role"
        description={`Remove this role from ${selectedUserIds.size} selected user${selectedUserIds.size !== 1 ? 's' : ''}?`}
        confirmLabel="Remove"
        destructive
        busy={busy}
        onConfirm={handleRemove}
      />
    </Dialog.Root>
  )
}
