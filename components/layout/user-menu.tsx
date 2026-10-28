"use client"

import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import { LogOut, Settings, User } from "lucide-react"
import { signOutAndRedirect } from "@/lib/auth-client"
import { getInitials } from "@/lib/utils"
import Link from "next/link"

interface UserMenuProps {
  user: {
    display_name: string
    email: string
    avatar_url: string | null
  }
}

export function UserMenu({ user }: UserMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--theme-accent-light)] text-sm font-medium text-[color:var(--theme-card-text)] transition-colors hover:bg-[color:var(--theme-accent-light)] focus:outline-none focus:ring-2 focus:ring-[color:var(--theme-primary)] focus:ring-offset-2 dark:bg-[color:var(--theme-accent-light)] dark:text-[color:var(--theme-primary-text)]">
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={user.display_name}
              className="h-8 w-8 rounded-full"
            />
          ) : (
            getInitials(user.display_name)
          )}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[200px] rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="px-3 py-2">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {user.display_name}
            </p>
            <p className="text-xs text-gray-500">{user.email}</p>
          </div>

          <DropdownMenu.Separator className="my-1 h-px bg-gray-200 dark:bg-gray-700" />

          <DropdownMenu.Item asChild>
            <Link
              href="/settings"
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <User className="h-4 w-4" />
              Profile
            </Link>
          </DropdownMenu.Item>

          <DropdownMenu.Item asChild>
            <Link
              href="/settings"
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 outline-none hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Settings className="h-4 w-4" />
              Settings
            </Link>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-gray-200 dark:bg-gray-700" />

          <DropdownMenu.Item
            onSelect={() => { void signOutAndRedirect() }}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 outline-none hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
