'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { useDashboardAuth } from '@/lib/dashboard-auth-context'
import { Button } from '@/components/ui/button'
import { runInlineJob, useJobs } from '@/components/jobs/jobs-provider'
import { Shield, Check, X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { InlineNotice } from '@/components/ui/inline-notice'

interface BulkPermissionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  objectType: 'workflow' | 'data_table'
  objectIds: string[]
  showExecute?: boolean
}

export function BulkPermissionsDialog({ open, onOpenChange, objectType, objectIds, showExecute = true }: BulkPermissionsDialogProps) {
  const { profile } = useDashboardAuth()
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id
  const queryClient = useQueryClient()
  const jobs = useJobs()
  const [grantType, setGrantType] = useState<'role' | 'team' | 'user'>('role')
  const [selectedId, setSelectedId] = useState('')
  const [canView, setCanView] = useState(true)
  const [canEdit, setCanEdit] = useState(true)
  const [canDelete, setCanDelete] = useState(false)
  const [canExecute, setCanExecute] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)

  const { data: roles } = useQuery({
    queryKey: ['roles-list'],
    queryFn: async () => {
      const { data } = await serverRead('governance.roleOptions', { tenantId: tenantId ?? '' })
      return data ?? []
    },
    enabled: open && grantType === 'role',
  })

  const { data: teams } = useQuery({
    queryKey: ['teams-list'],
    queryFn: async () => {
      const { data } = await serverRead('governance.teamOptions', { tenantId: tenantId ?? '' })
      return data ?? []
    },
    enabled: open && grantType === 'team',
  })

  const { data: users } = useQuery({
    queryKey: ['users-list'],
    queryFn: async () => {
      const { data } = await serverRead('governance.userOptions', { tenantId: tenantId ?? '' })
      return data ?? []
    },
    enabled: open && grantType === 'user',
  })

  async function handleApply() {
    if (!selectedId) return
    setSaving(true)
    // An `object_permissions.bulk_set` job (one batch per 100 objects on the server).
    const outcome = await runInlineJob(jobs, 'object_permissions.bulk_set', {
      objectType,
      objectIds,
      roleId: grantType === 'role' ? selectedId : null,
      teamId: grantType === 'team' ? selectedId : null,
      userId: grantType === 'user' ? selectedId : null,
      canView, canEdit, canDelete, canExecute,
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['object-permissions'] })
        queryClient.invalidateQueries({ queryKey: ['restricted-objects'] })
      },
    })
    setSaving(false)
    if (outcome.status === 'failed') setNotice({ tone: 'error', message: outcome.error })
    else onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 dialog-overlay" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(28rem,92vw)] rounded-xl p-6 shadow-xl dialog-content" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
          {notice && (
            <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} className="mb-4" />
          )}

          <Dialog.Title className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--theme-card-text)' }}>
            <Shield size={18} style={{ color: 'var(--theme-primary-text)' }} />
            Set Permissions ({objectIds.length} {objectType.replace('_', ' ')}{objectIds.length !== 1 ? 's' : ''})
          </Dialog.Title>
          <p className="text-xs mt-1 mb-4" style={{ color: 'var(--theme-muted-text)' }}>
            Add a permission grant to all selected objects. This restricts access to only the listed roles, teams, or users.
          </p>

          {/* Grant type toggle */}
          <div className="flex rounded-lg overflow-hidden border mb-3" style={{ borderColor: 'var(--theme-surface-border)' }}>
            {(['role', 'team', 'user'] as const).map(t => (
              <button key={t} onClick={() => { setGrantType(t); setSelectedId('') }}
                className="flex-1 px-3 py-1.5 text-xs font-medium capitalize transition-colors"
                style={{ backgroundColor: grantType === t ? 'var(--theme-primary)' : 'transparent', color: grantType === t ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}>
                {t}
              </button>
            ))}
          </div>

          {/* Select */}
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm mb-4"
            style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}>
            <option value="">Select {grantType}...</option>
            {grantType === 'role' && (roles ?? []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            {grantType === 'team' && (teams ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            {grantType === 'user' && (users ?? []).map(u => <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>)}
          </select>

          {/* Permission toggles */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[
              { key: 'view', value: canView, set: setCanView },
              { key: 'edit', value: canEdit, set: setCanEdit },
              { key: 'delete', value: canDelete, set: setCanDelete },
              ...(showExecute ? [{ key: 'execute', value: canExecute, set: setCanExecute }] : []),
            ].map(({ key, value, set }) => (
              <button key={key} onClick={() => set(!value)}
                className="flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium capitalize transition-colors"
                style={{
                  borderColor: value ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
                  backgroundColor: value ? 'var(--theme-primary-light)' : 'transparent',
                  color: value ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
                }}>
                {value ? <Check size={12} /> : <X size={12} />} {key}
              </button>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </Dialog.Close>
            <Button size="sm" onClick={handleApply} disabled={!selectedId || saving}>
              {saving ? 'Applying...' : `Apply to ${objectIds.length} object${objectIds.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
