'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Shield, Users, Clock, Lock, Archive } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RoleList } from './role-list'
import { UserRoleAssignments } from './user-role-assignments'
import { AuditLogTable } from './audit-log-table'
import { ObjectPermissionsOverview } from './object-permissions-overview'
import { RetentionPoliciesManager } from './retention-policies-manager'

const TABS = [
  { id: 'roles', label: 'Roles & Permissions', icon: Shield },
  { id: 'users', label: 'User Assignments', icon: Users },
  { id: 'objects', label: 'Object Permissions', icon: Lock },
  { id: 'retention', label: 'Retention Policies', icon: Archive },
  { id: 'audit', label: 'Audit Log', icon: Clock },
] as const

interface Props {
  roles: any[]
  users: any[]
  auditLog: any[]
  retentionPolicies: any[]
}

export function GovernanceTabs({ roles, users, auditLog, retentionPolicies }: Props) {
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const initialTab = TABS.some((tab) => tab.id === requestedTab) ? requestedTab! : 'roles'
  const [tab, setTab] = useState<string>(initialTab)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>Governance</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--theme-muted-text)' }}>Manage roles, permissions, and user access across the platform</p>
      </div>

      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--theme-surface-border)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              tab === t.id ? 'border-[color:var(--theme-primary)] text-[color:var(--theme-card-text)]' : 'border-transparent hover:border-gray-200',
            )}
            style={tab !== t.id ? { color: 'var(--theme-muted-text)' } : undefined}
          >
            <t.icon size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'roles' && <RoleList roles={roles} users={users} />}
      {tab === 'users' && <UserRoleAssignments users={users} roles={roles} />}
      {tab === 'objects' && <ObjectPermissionsOverview />}
      {tab === 'retention' && <RetentionPoliciesManager policies={retentionPolicies} />}
      {tab === 'audit' && <AuditLogTable entries={auditLog} />}
    </div>
  )
}
