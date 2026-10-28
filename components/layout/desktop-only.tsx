"use client"

import Link from "next/link"
import { Monitor } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"

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
      <div
        className="w-full max-w-sm rounded-2xl border p-8 text-center"
        style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)" }}
      >
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
          style={{ backgroundColor: "var(--theme-primary-light)" }}
        >
          <Monitor size={22} style={{ color: "var(--theme-primary-text)" }} />
        </div>
        <p className="text-sm font-semibold" style={{ color: "var(--theme-card-text)" }}>
          Open on desktop to edit
        </p>
        <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--theme-muted-text)" }}>
          This is a design surface — open UserTasks on a desktop to edit. You can still view pages,
          tasks, and boards from your phone.
        </p>
        <Link
          href="/tasks"
          className="mt-5 inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold text-[color:var(--theme-on-primary)] transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--theme-primary)" }}
        >
          Back to Tasks
        </Link>
      </div>
    </div>
  )
}
