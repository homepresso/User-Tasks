"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { usePermissions } from '@/lib/permissions-context'
import { useDashboardAuth } from '@/lib/dashboard-auth-context'
import { GovernanceTabs } from '@/components/governance/governance-tabs'

export default function GovernancePage() {
  const { can } = usePermissions()
  const { profile } = useDashboardAuth()
  // `||`, not `??`: an empty id must wait like a missing one.
  const tenantId: string | null = profile?.current_tenant_id || profile?.tenant_id || null

  const { data } = useQuery({
    queryKey: ['governance', tenantId],
    queryFn: () => serverQuery('governance.settingsPage', { tenantId: tenantId! }),
    enabled: can('team.change_roles') && !!tenantId,
  })

  if (!can('team.change_roles')) {
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }

  if (!tenantId) {
    return null
  }

  return (
    <GovernanceTabs
      roles={data?.roles ?? []}
      users={data?.users ?? []}
      retentionPolicies={data?.retentionPolicies ?? []}
      auditLog={data?.auditLog ?? []}
    />
  )
}
