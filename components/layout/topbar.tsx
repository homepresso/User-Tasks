"use client"

import { Menu } from "lucide-react"
import { UserMenu } from "./user-menu"
import { NotificationBell } from "./notification-bell"
import { JobsIndicator } from "@/components/jobs/jobs-indicator"
import { GlobalSearch } from "./global-search"
import { formatDate, getGreeting } from "@/lib/utils"

interface TopbarProps {
  user: {
    display_name: string
    email: string
    avatar_url: string | null
  }
  /** Opens the mobile nav drawer. The hamburger only renders below `md`. */
  onMenuClick?: () => void
}

export function Topbar({ user, onMenuClick }: TopbarProps) {
  return (
    <header className="themed-topbar flex h-[var(--theme-topbar-height)] items-center justify-between border-b px-4 backdrop-blur-sm md:px-6" style={{ boxShadow: '0 1px 0 rgba(23,21,15,0.04), 0 1px 3px rgba(23,21,15,0.02)' }}>
      <div className="flex min-w-0 items-center gap-2">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="-ml-1 rounded-md p-2 transition-colors hover:bg-[var(--theme-row-highlight)] md:hidden"
            style={{ color: 'var(--theme-topbar-text)' }}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight" style={{ color: 'var(--theme-topbar-text)' }}>
            {getGreeting()}, {user.display_name.split(" ")[0]}
          </p>
          <p className="text-[10px] font-medium uppercase tracking-wider mt-0.5" style={{ color: 'var(--theme-topbar-muted)' }}>{formatDate(new Date())}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 md:gap-3">
        <GlobalSearch />
        <JobsIndicator />
        <NotificationBell />
        <UserMenu user={user} />
      </div>
    </header>
  )
}
