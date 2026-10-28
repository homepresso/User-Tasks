"use client"

import { useMemberships } from "@/hooks/use-memberships"
import { Home } from "lucide-react"
import { workspaceInitials } from "@/lib/workspace-memberships"

export function OrgList() {
  const { data: memberships, isLoading } = useMemberships()

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading organizations...</p>
  }

  if (!memberships?.length) {
    return <p className="text-sm text-gray-500">No organizations.</p>
  }

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {memberships.map((m) => (
        <div
          key={m.id}
          className="flex items-center justify-between py-3"
        >
          <div className="flex items-center gap-3">
            <span
              className="w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold text-white"
              style={{
                backgroundColor:
                  (m.tenant.branding as any)?.primary_color ?? "#5F6B7A",
              }}
            >
              {workspaceInitials(m.tenant.name)}
            </span>
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
                {m.tenant.name}
                {m.is_home && (
                  <Home size={12} className="text-gray-400" />
                )}
              </p>
              <p className="text-xs text-gray-500 capitalize">{m.role}</p>
            </div>
          </div>
          <span className="text-xs text-gray-400">
            {m.is_active ? "Active" : "Inactive"}
          </span>
        </div>
      ))}
    </div>
  )
}
