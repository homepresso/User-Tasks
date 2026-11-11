"use client"

import { Monitor } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { EmptyState } from "@/components/ui/empty-state"

/**
 * Guards design-time surfaces (page/template builder, workflow canvas, the
 * form designer page) from phones. On viewports < 768px it replaces its
 * children with a friendly "open on desktop" notice — optionally with a
 * read-only view under it (`preview`, e.g. the form as it renders) and its
 * own way back (`action`); on desktop it renders children unchanged. SSR
 * renders children (useIsMobile is false until mount), so desktop hydration
 * is untouched.
 */
export function DesktopOnly({ children, preview, action = { label: "Back to tasks", href: "/tasks" } }: {
  children: React.ReactNode
  preview?: React.ReactNode
  action?: { label: string; href: string }
}) {
  const isMobile = useIsMobile()

  if (!isMobile) return <>{children}</>

  return (
    <div className="space-y-4 p-4" data-desktop-only-notice="">
      <div className={preview ? "flex items-center justify-center" : "flex min-h-[60vh] items-center justify-center"}>
        <EmptyState
          icon={Monitor}
          title="Open on desktop to edit"
          description={preview
            ? "This is a design surface: open UserTasks on a desktop to edit it. Here is how it looks, read only."
            : "This is a design surface: open UserTasks on a desktop to edit it. You can still view pages, tasks and boards from your phone."}
          action={action}
        />
      </div>
      {preview}
    </div>
  )
}
