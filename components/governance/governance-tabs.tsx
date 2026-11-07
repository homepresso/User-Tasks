'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabPanel } from '@/components/ui/tabs'
import { RoleList } from './role-list'
import { UserRoleAssignments } from './user-role-assignments'
import { AuditLogTable } from './audit-log-table'
import { ObjectPermissionsOverview } from './object-permissions-overview'
import { RetentionPoliciesManager } from './retention-policies-manager'
import { FormRetentionOverview } from './form-retention-overview'
import { ObjectAuditLog } from './object-audit-log'

const TABS = [
  { value: 'roles', label: 'Roles' },
  { value: 'users', label: 'User assignments' },
  { value: 'objects', label: 'Object permissions' },
  { value: 'retention', label: 'Retention' },
  { value: 'audit', label: 'Audit log' },
] as const
type GovernanceTab = (typeof TABS)[number]['value']

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  roles: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  users: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auditLog: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  retentionPolicies: any[]
}

export function GovernanceTabs({ roles, users, auditLog, retentionPolicies }: Props) {
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const initialTab: GovernanceTab = TABS.find((t) => t.value === requestedTab)?.value ?? 'roles'
  const [tab, setTab] = useState<GovernanceTab>(initialTab)
  // ?tab=audit&type=form opens the audit log filtered to one object type.
  const auditType = searchParams.get('type') ?? ''

  const items = TABS.map((t) => ({
    ...t,
    count: t.value === 'roles' ? roles.length : t.value === 'retention' ? retentionPolicies.length : undefined,
  }))

  return (
    <div>
      <PageHeader
        title="Governance"
        description="Roles, permissions, object access, retention and the audit trail for workflows, forms, data tables and the rest of the platform."
        tabs={<Tabs aria-label="Governance" idBase="gov" items={items} value={tab} onValueChange={setTab} />}
      />

      <TabPanel idBase="gov" value={tab}>
        {tab === 'roles' && <RoleList roles={roles} users={users} />}
        {tab === 'users' && <UserRoleAssignments users={users} roles={roles} />}
        {tab === 'objects' && <ObjectPermissionsOverview />}
        {tab === 'retention' && (
          <div className="space-y-8">
            <RetentionPoliciesManager policies={retentionPolicies} />
            <FormRetentionOverview />
          </div>
        )}
        {tab === 'audit' && (
          <div className="space-y-8">
            <ObjectAuditLog initialType={auditType} />
            <AuditLogTable entries={auditLog} />
          </div>
        )}
      </TabPanel>
    </div>
  )
}
