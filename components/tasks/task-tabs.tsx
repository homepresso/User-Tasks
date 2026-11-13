"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Tabs, TabPanel, type TabItem } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

/**
 * The task page's views: Details · Form (only with a form) · Comments ·
 * Attachments. The chosen one lives in the URL (`?tab=form`), so links and
 * back / forward keep it; without one, the page's default applies (Form when
 * the task has a form, is open and is mine; otherwise Details).
 *
 * The Attachments tab is a mount point: components/tasks/task-attachments-tab.tsx
 * is the adapter the task-attachments feature replaces.
 */
export type TaskTab = "details" | "form" | "comments" | "attachments" | `ext:${string}`

export const TASK_TABS: readonly TaskTab[] = ["details", "form", "comments", "attachments"]

/** Detail tabs contributed by extensions (`ext:<extension>:<tab>`), after the core ones. */
export interface ExtensionTaskTab { value: `ext:${string}`; label: string }

export function parseTaskTab(value: string | null | undefined, allowed: readonly TaskTab[]): TaskTab | null {
  return value && (allowed as readonly string[]).includes(value) ? (value as TaskTab) : null
}

/** The tab items, in order; Form only when the task has one. Counts are left off while unknown. */
export function taskTabs({ hasForm, comments, attachments, extensionTabs = [] }: { hasForm: boolean; comments?: number; attachments?: number; extensionTabs?: readonly ExtensionTaskTab[] }): TabItem<TaskTab>[] {
  return [
    { value: "details", label: "Details" },
    ...(hasForm ? [{ value: "form" as const, label: "Form" }] : []),
    { value: "comments", label: "Comments", count: comments },
    { value: "attachments", label: "Attachments", count: attachments },
    ...extensionTabs.map((t) => ({ value: t.value, label: t.label })),
  ]
}

export function TaskTabs({ taskId, tabs, defaultTab, className, children }: {
  taskId: string
  tabs: TabItem<TaskTab>[]
  defaultTab: TaskTab
  className?: string
  children: (tab: TaskTab) => ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const allowed = tabs.map((t) => t.value)
  const [fromUrl, setFromUrl] = useState<TaskTab | null>(null)

  // Read ?tab= after hydration (no useSearchParams Suspense bailout); follow back / forward.
  useEffect(() => {
    const read = () => {
      const raw = new URLSearchParams(window.location.search).get("tab")
      setFromUrl(raw?.startsWith("ext:") ? (raw as TaskTab) : parseTaskTab(raw, TASK_TABS))
    }
    read()
    window.addEventListener("popstate", read)
    return () => window.removeEventListener("popstate", read)
  }, [taskId])

  const tab = parseTaskTab(fromUrl, allowed) ?? defaultTab
  const select = useCallback((next: TaskTab) => {
    setFromUrl(next)
    const params = new URLSearchParams(window.location.search)
    params.set("tab", next)
    router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false })
  }, [router, pathname])

  return (
    <div className={cn("min-w-0", className)} data-task-tabs data-task-tab={tab}>
      <Tabs aria-label="Task" idBase="task" items={tabs} value={tab} onValueChange={select} />
      <TabPanel idBase="task" value={tab} tabIndex={-1}>
        {children(tab)}
      </TabPanel>
    </div>
  )
}
