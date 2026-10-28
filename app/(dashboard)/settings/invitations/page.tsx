"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { InviteForm } from '@/components/admin/invite-form'
import { InvitationList } from '@/components/admin/invitation-list'
import { usePermissions } from '@/lib/permissions-context'

export default function InvitationsPage() {
  const { can } = usePermissions()

  const { data: invitations } = useQuery({
    queryKey: ['invitations'],
    queryFn: () => serverQuery('settings.invitations'),
    enabled: can('team.invite'),
  })

  if (!can('team.invite')) {
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Invite Users</h1>

      <div className="rounded-lg border p-6" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
        <h2 className="text-lg font-semibold mb-4">Send Invitation</h2>
        <InviteForm />
      </div>

      <div className="rounded-lg border p-6" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
        <h2 className="text-lg font-semibold mb-4">
          Pending Invitations
          {invitations && invitations.length > 0 && (
            <span className="text-sm font-normal ml-2" style={{ color: 'var(--theme-muted-text)' }}>
              ({invitations.length})
            </span>
          )}
        </h2>
        <InvitationList invitations={invitations ?? []} />
      </div>
    </div>
  )
}
