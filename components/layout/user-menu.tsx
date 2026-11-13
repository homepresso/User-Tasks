"use client"

import Link from "next/link"
import { BookOpen, LogOut, MessageSquareHeart, Rocket, Settings, User } from "lucide-react"
import { useOnboarding } from "@/components/onboarding/getting-started/onboarding-provider"
import { signOutAndRedirect } from "@/lib/auth-client"
import { useCurrentWorkspaceName } from "./workspace-switcher"
import { useExtensionUserMenu } from "@/components/extensions/extension-menus"
import { useExtensionAction } from "@/components/extensions/use-extension-action"
import { ExtIcon } from "@/components/extensions/ext-icon"
import { Avatar } from "@/components/ui/avatar"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/**
 * The avatar menu in the top bar (28px avatar): who you are and which
 * workspace you're in, profile and settings, help, and sign out. Each person
 * works in one workspace, so there is no workspace list to switch between.
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
  const guide = useOnboarding()
  const label = `Account: ${user.display_name}${workspaceName ? `, ${workspaceName}` : ""}`
  // Items contributed by extensions enabled in this workspace.
  const extensionItems = useExtensionUserMenu()
  const extensionAction = useExtensionAction()
  return (
    <>
    {extensionAction.confirmDialog}
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
            {workspaceName && <p className="truncate text-xs text-fg-subtle" data-current-workspace>{workspaceName}</p>}
          </div>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer"><MenuRow icon={<User />}>Profile</MenuRow></Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings" className="cursor-pointer"><MenuRow icon={<Settings />}>Settings</MenuRow></Link>
        </DropdownMenuItem>
        {extensionItems.map((item) => item.action ? (
          <DropdownMenuItem key={item.key} danger={item.danger} icon={<ExtIcon icon={item.icon} />} onSelect={() => extensionAction.run({ extensionId: item.extensionId, action: item.action!.name, confirm: item.action!.confirm, label: item.label })}>
            {item.label}
          </DropdownMenuItem>
        ) : item.href ? (
          <DropdownMenuItem key={item.key} asChild>
            {item.external
              ? <a href={item.href} target="_blank" rel="noopener noreferrer" className="cursor-pointer"><MenuRow icon={<ExtIcon icon={item.icon} />}>{item.label}</MenuRow></a>
              : <Link href={item.href} className="cursor-pointer"><MenuRow icon={<ExtIcon icon={item.icon} />}>{item.label}</MenuRow></Link>}
          </DropdownMenuItem>
        ) : null)}
        <DropdownMenuItem asChild>
          <a href="/docs" target="_blank" rel="noopener noreferrer" className="cursor-pointer"><MenuRow icon={<BookOpen />}>Help &amp; docs</MenuRow></a>
        </DropdownMenuItem>
        {guide.state && (
          // Opens after the menu has closed and returned focus.
          <DropdownMenuItem icon={<Rocket />} onSelect={() => setTimeout(() => guide.openGuide(), 0)} data-help-getting-started>
            Getting started{guide.progress.total > 0 && !guide.progress.complete ? ` (${guide.progress.done}/${guide.progress.total})` : ""}
          </DropdownMenuItem>
        )}
        {guide.state?.feedback_available && (
          <DropdownMenuItem icon={<MessageSquareHeart />} onSelect={() => setTimeout(() => guide.openFeedback(), 0)} data-help-feedback>
            Send feedback
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem danger icon={<LogOut />} onSelect={() => { void signOutAndRedirect() }}>
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
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
