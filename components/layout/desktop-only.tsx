"use client"

import { Monitor } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { EmptyState } from "@/components/ui/empty-state"

/**
 * Guards design-time surfaces (page/template builder, workflow canvas)
 * from phones. On viewports < 768px it replaces its children with a
 * friendly "open on desktop" notice; on desktop it renders children
 * unchanged. SSR renders children (useIsMobile is false until mount),
 * so desktop hydration is untouched.
 */
export function DesktopOnly({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile()

  if (!isMobile) return <>{children}</>

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <EmptyState
        icon={Monitor}
        title="Open on desktop to edit"
        description="This is a design surface: open UserTasks on a desktop to edit it. You can still view pages, tasks and boards from your phone."
        action={{ label: "Back to tasks", href: "/tasks" }}
      />
    </div>
  )
}
