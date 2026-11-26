'use client'

import { revokeInvitation, resendInvitation } from '@/app/actions/invitations'
import { RoleBadge } from '@/components/team/role-badge'
import { formatRelativeDate } from '@/lib/utils'
import { RefreshCw, X } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/use-confirm'

interface Invitation {
  id: string
  email: string
  role: string
  expires_at: string
  created_at: string
  inviter: { display_name: string } | null
}

interface InvitationListProps {
  invitations: Invitation[]
}

export function InvitationList({ invitations }: InvitationListProps) {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()

  if (invitations.length === 0) {
    return <EmptyState size="sm" headingLevel={3} title="No pending invitations" description="People you invite appear here until they accept." />
  }

  async function handleRevoke(id: string, email: string) {
    if (!(await confirm({ title: 'Revoke this invitation?', description: `${email} will no longer be able to join with this link.`, confirmLabel: 'Revoke', destructive: true }))) return
    setLoadingId(id)
    try { await revokeInvitation(id) } catch {}
    setLoadingId(null)
  }

  async function handleResend(id: string) {
    setLoadingId(id)
    try { await resendInvitation(id) } catch {}
    setLoadingId(null)
  }

  return (
    <div className="space-y-1">
      {invitations.map((inv) => {
        const isExpired = new Date(inv.expires_at) < new Date()
        return (
          <div
            key={inv.id}
            className="flex items-center justify-between py-3 border-b border-border"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{inv.email}</span>
                <RoleBadge role={inv.role} />
                {isExpired && (
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-danger-wash text-danger">
                    Expired
                  </span>
                )}
              </div>
              <p className="text-xs mt-0.5 text-fg-muted">
                Invited by {inv.inviter?.display_name ?? 'Unknown'} · {formatRelativeDate(inv.created_at)}
                {!isExpired && ` · Expires ${formatRelativeDate(inv.expires_at)}`}
              </p>
            </div>
            <div className="flex items-center gap-1 ml-3">
              <button
                onClick={() => handleResend(inv.id)}
                disabled={loadingId === inv.id}
                className="p-1.5 rounded-md hover:opacity-70 transition-colors text-fg-muted"
                title="Resend invitation"
                aria-label={`Resend invitation to ${inv.email}`}
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={() => handleRevoke(inv.id, inv.email)}
                disabled={loadingId === inv.id}
                className="p-1.5 rounded-md hover:text-danger transition-colors text-fg-muted"
                title="Revoke invitation"
                aria-label={`Revoke invitation for ${inv.email}`}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )
      })}
      {confirmDialog}
    </div>
  )
}
