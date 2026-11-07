'use client'

import { useMemberships } from '@/hooks/use-memberships'
import { switchWorkspace } from '@/app/actions/session'
import { clearCurrentTenantCache } from '@/lib/get-user-id'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useDashboardAuth } from '@/lib/dashboard-auth-context'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { DropdownMenuLabel, menuItemClass } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Globe, Check, Home, Building2 } from 'lucide-react'
import { performWorkspaceSwitch, switcherLabel, workspaceMenuEntries, type WorkspaceMenuEntry } from '@/lib/workspace-memberships'

/**
 * The workspace switcher, inside the avatar menu in the top bar
 * (components/layout/user-menu.tsx). It used to be the control at the top of
 * the side menu, which is now the Forms dropdown. Same list and behaviour:
 * "All organizations", then each workspace; picking one switches straight
 * away (two clicks from anywhere: avatar, workspace).
 */

/** The active workspace's name for the avatar menu header (null while loading). */
export function useCurrentWorkspaceName(currentTenantId: string | null): string | null {
  const { data: memberships } = useMemberships()
  const label = switcherLabel(memberships, currentTenantId)
  if (label.kind === 'workspace') return label.membership.tenant.name
  if (label.kind === 'unavailable') return 'Unavailable workspace'
  return currentTenantId ? null : 'All organizations'
}

function useSwitchWorkspace() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const { refreshProfile } = useDashboardAuth()
  return (tenantId: string | null) => performWorkspaceSwitch(tenantId, {
    switchWorkspace,
    clearCurrentTenantCache,
    invalidateQueries: () => queryClient.invalidateQueries(),
    // The tick, the avatar's tooltip and the role/permissions follow the new workspace straight away.
    refreshProfile,
    refresh: () => router.refresh(),
  })
}

/** One workspace row (exported for tests; rendered inside a DropdownMenu). */
export function WorkspaceEntryContent({ entry }: { entry: WorkspaceMenuEntry }) {
  return (
    <>
      {entry.tenantId === null ? (
        <Globe className="size-4 shrink-0 text-fg-muted" aria-hidden />
      ) : (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-2xs font-semibold text-white"
          style={{ backgroundColor: entry.color ?? 'var(--theme-primary)' }}
          aria-hidden
        >
          {entry.initials}
        </span>
      )}
      <span className="min-w-0 truncate">{entry.name}</span>
      {entry.isHome && <Home className="size-3.5 shrink-0 text-fg-subtle" aria-label="Home workspace" />}
      {entry.current && <Check className="ml-auto size-4 shrink-0 text-primary-text" aria-label="Current" />}
    </>
  )
}

const ITEM_CLASS = cn(menuItemClass, 'cursor-pointer')

/** The "Workspaces" group of the avatar menu. */
export function WorkspaceMenuItems({ currentTenantId }: { currentTenantId: string | null }) {
  const { data: memberships } = useMemberships()
  const switchTo = useSwitchWorkspace()
  const entries = workspaceMenuEntries(memberships, currentTenantId)
  return (
    <DropdownMenu.Group aria-label="Workspaces" data-workspace-switcher>
      <DropdownMenuLabel className="flex items-center gap-1.5">
        <Building2 className="size-3" aria-hidden /> Workspaces
      </DropdownMenuLabel>
      <div className="max-h-64 overflow-y-auto">
        {entries.map((entry) => (
          <DropdownMenu.Item
            key={entry.tenantId ?? 'all'}
            className={ITEM_CLASS}
            onSelect={() => { if (!entry.current) void switchTo(entry.tenantId) }}
            aria-current={entry.current ? 'true' : undefined}
            data-workspace-option={entry.tenantId ?? 'all'}
          >
            <WorkspaceEntryContent entry={entry} />
          </DropdownMenu.Item>
        ))}
      </div>
    </DropdownMenu.Group>
  )
}
