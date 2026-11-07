"use client"

import Link from "next/link"
import { BookOpen, LogOut, Settings, User } from "lucide-react"
import { signOutAndRedirect } from "@/lib/auth-client"
import { useCurrentWorkspaceName, WorkspaceMenuItems } from "./workspace-switcher"
import { Avatar } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * The avatar menu in the top bar (28px avatar): who you are and which
 * workspace you're in, the workspace switcher, profile and settings, help,
 * and sign out.
 */

interface UserMenuProps {
  user: {
    display_name: string
    email: string
    avatar_url: string | null
  }
  /** The active workspace (null = "All organizations"). */
  currentTenantId: string | null
}

export function UserMenu({ user, currentTenantId }: UserMenuProps) {
  const workspaceName = useCurrentWorkspaceName(currentTenantId)
  const label = `Account and workspaces: ${user.display_name}${workspaceName ? `, ${workspaceName}` : ""}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-user-menu-trigger
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-subtle data-[state=open]:bg-subtle"
        >
          <Avatar name={user.display_name} src={user.avatar_url} size="md" aria-hidden role={undefined} aria-label={undefined} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64 max-w-[calc(100vw-1rem)]">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <Avatar name={user.display_name} src={user.avatar_url} size="lg" aria-hidden role={undefined} aria-label={undefined} />
          <div className="min-w-0">
            <p className="truncate text-ui font-semibold text-fg">{user.display_name}</p>
            <p className="truncate text-xs text-fg-muted">{user.email}</p>
          </div>
        </div>

        <DropdownMenuSeparator />
        <WorkspaceMenuItems currentTenantId={currentTenantId} />
        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer"><MenuRow icon={<User />}>Profile</MenuRow></Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer"><MenuRow icon={<Settings />}>Settings</MenuRow></Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/docs" target="_blank" rel="noopener noreferrer" className="cursor-pointer"><MenuRow icon={<BookOpen />}>Help &amp; docs</MenuRow></a>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem danger icon={<LogOut />} onSelect={() => { void signOutAndRedirect() }}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The inside of an `asChild` menu item (link items render their own icon + label). */
function MenuRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <span className="inline-flex shrink-0 text-fg-muted [&>svg]:size-4" aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </>
  )
}
