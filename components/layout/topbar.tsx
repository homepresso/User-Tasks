"use client"

import { Menu } from "lucide-react"
import { UserMenu } from "./user-menu"
import { NotificationBell } from "./notification-bell"
import { JobsIndicator } from "@/components/jobs/jobs-indicator"
import { CommandTrigger } from "./global-search"
import { NewMenu } from "./new-menu"
import { TopbarBreadcrumbs } from "./topbar-breadcrumbs"
import { IconButton } from "@/components/ui/icon-button"

/**
 * The top bar (docs/design/ui-polish-spec.md §4.2): 48px (the theme's
 * topbarHeight overrides), panel background and a hairline. Left: the route's
 * breadcrumbs. Right: the ⌘K trigger, "+ New", background jobs,
 * notifications and the avatar menu. Phones: a menu button opens the nav
 * Sheet and search is an icon.
 */
interface TopbarProps {
  user: {
    display_name: string
    email: string
    avatar_url: string | null
  }
  /** The active workspace (null = "All organizations"), for the avatar menu's workspace switcher. */
  currentTenantId?: string | null
  /** Opens the mobile nav Sheet. The menu button only renders below `md`. */
  onMenuClick?: () => void
}

export function Topbar({ user, currentTenantId = null, onMenuClick }: TopbarProps) {
  return (
    <header className="themed-topbar flex h-[var(--theme-topbar-height)] shrink-0 items-center gap-2 border-b border-border-subtle px-3 md:gap-3 md:px-6">
      {onMenuClick && (
        <IconButton label="Open menu" icon={<Menu />} onClick={onMenuClick} className="-ml-1 md:hidden" noTooltip />
      )}
      <TopbarBreadcrumbs />
      <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-2">
        <CommandTrigger />
        <NewMenu />
        <JobsIndicator />
        <NotificationBell />
        <UserMenu user={user} currentTenantId={currentTenantId} />
      </div>
    </header>
  )
}
