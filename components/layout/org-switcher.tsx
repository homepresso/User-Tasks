'use client'

import { useMemberships } from '@/hooks/use-memberships'
import { switchWorkspace } from '@/app/actions/session'
import { clearCurrentTenantCache } from '@/lib/get-user-id'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Building2, Globe, Check, Home, CircleSlash } from 'lucide-react'
import { switcherLabel, workspaceInitials } from '@/lib/workspace-memberships'

interface OrgSwitcherProps {
  currentTenantId: string | null  // null = unified view
}

export function OrgSwitcher({ currentTenantId }: OrgSwitcherProps) {
  const { data: memberships } = useMemberships()
  const queryClient = useQueryClient()
  const router = useRouter()

  async function handleSwitch(tenantId: string | null) {
    // switch_tenant checks membership (null = unified view).
    const result = await switchWorkspace(tenantId)
    if (!result.ok) return
    // Workspace switch: every client-side cache is tenant-scoped data.
    // router.refresh() only re-renders server components — React Query
    // caches (messages, tasks, notifications, ...) would keep showing the
    // previous workspace's rows without this.
    clearCurrentTenantCache()
    await queryClient.invalidateQueries()
    router.refresh()
  }

  const label = switcherLabel(memberships, currentTenantId)

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="w-full px-3 py-2 flex items-center gap-2 rounded-lg transition-colors text-sm hover:bg-[var(--sidebar-hover-bg)]"
        style={{ color: 'var(--theme-sidebar-text)' }}
      >
        {label.kind === 'workspace' ? (
          <>
            <Building2 size={14} />
            <span className="truncate font-medium">
              {label.membership.tenant.name}
            </span>
          </>
        ) : label.kind === 'unavailable' ? (
          <>
            <CircleSlash size={14} />
            <span className="truncate font-medium">
              Unavailable workspace
            </span>
          </>
        ) : (
          <>
            <Globe size={14} />
            <span className="font-medium">
              All organizations
            </span>
          </>
        )}
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-[1000] rounded-lg p-1 min-w-[220px] border"
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            color: 'var(--theme-card-text)',
            borderColor: 'var(--theme-surface-border)',
            boxShadow: 'var(--shadow-lg)',
          }}
          sideOffset={4}
          align="start"
        >
        {/* All orgs option */}
        <DropdownMenu.Item
          className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer outline-none hover:bg-[var(--theme-row-highlight)]"
          style={{ color: 'var(--theme-card-text)' }}
          onClick={() => handleSwitch(null)}
        >
          <Globe size={14} />
          All organizations
          {!currentTenantId && <Check size={14} className="ml-auto" style={{ color: 'var(--theme-primary-text)' }} />}
        </DropdownMenu.Item>

        <DropdownMenu.Separator className="h-px my-1" style={{ backgroundColor: 'var(--theme-surface-border)' }} />

        {/* Individual orgs */}
        {memberships?.map((m) => (
          <DropdownMenu.Item
            key={m.tenant.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer outline-none hover:bg-[var(--theme-row-highlight)]"
            style={{ color: 'var(--theme-card-text)' }}
            onClick={() => handleSwitch(m.tenant.id)}
          >
            <span
              className="w-4 h-4 rounded-sm flex items-center justify-center text-[8px] font-bold text-white shrink-0"
              style={{ backgroundColor: (m.tenant.branding as any)?.primary_color ?? 'var(--theme-primary)' }}
            >
              {workspaceInitials(m.tenant.name)}
            </span>
            <span className="truncate">{m.tenant.name}</span>
            {m.is_home && <Home size={12} style={{ color: 'var(--theme-muted-text)' }} />}
            {currentTenantId === m.tenant.id && <Check size={14} className="ml-auto" style={{ color: 'var(--theme-primary-text)' }} />}
          </DropdownMenu.Item>
        ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
