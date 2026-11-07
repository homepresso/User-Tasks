"use client"

import { useMemberships } from "@/hooks/use-memberships"
import { Home } from "lucide-react"
import { workspaceInitials } from "@/lib/workspace-memberships"
import { StatusPill } from "@/components/ui/badge"

function brand(branding: unknown): React.CSSProperties | undefined {
  const color = (branding as { primary_color?: unknown } | null)?.primary_color
  return typeof color === "string" ? { backgroundColor: color, color: "white" } : undefined
}

export function OrgList() {
  const { data: memberships, isLoading } = useMemberships()

  if (isLoading) {
    return <p className="text-sm text-fg-muted">Loading organizations…</p>
  }

  if (!memberships?.length) {
    return <p className="text-sm text-fg-muted">You aren&apos;t a member of any organization.</p>
  }

  return (
    <div className="divide-y divide-border-subtle rounded-lg border border-border bg-panel">
      {memberships.map((m) => (
        <div
          key={m.id}
          className="flex items-center justify-between px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <span
              className="flex size-8 items-center justify-center rounded-md bg-muted text-xs font-semibold text-fg"
              // Data-driven: the workspace's own brand colour.
              style={brand(m.tenant.branding)}
            >
              {workspaceInitials(m.tenant.name)}
            </span>
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium text-fg">
                {m.tenant.name}
                {m.is_home && (
                  <Home className="size-3.5 text-fg-muted" aria-label="Home workspace" />
                )}
              </p>
              <p className="text-xs capitalize text-fg-muted">{m.role}</p>
            </div>
          </div>
          <StatusPill status={m.is_active ? "active" : "inactive"} />
        </div>
      ))}
    </div>
  )
}
