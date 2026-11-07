"use client"

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { usePathname } from "next/navigation"
import { Tooltip } from "@/components/ui/tooltip"
import { floatingSurfaceClass } from "@/components/ui/dropdown-menu"
import { ChevronDown, FileText } from "lucide-react"
import { AvailableFormsList, useAvailableFormsState } from "./available-forms-menu"
import { HEADER_FORMS_SEARCH_MIN, type AvailableForm } from "@/lib/forms/available-forms"
import { cn } from "@/lib/utils"

/**
 * The "Your forms" panel: the person's available forms, opened from the top
 * bar's "+ New › Fill in a form…" (components/layout/new-menu.tsx). The
 * standalone Forms dropdown (HeaderFormsMenu) is kept for callers that want
 * a trigger of their own.
 *
 * - The trigger reads "Forms"; collapsed sidebar: the icon only, with a tooltip.
 * - The panel lists the person's available forms — the same cached query as
 *   the sidebar's Forms item (useAvailableFormsState), alphabetical.
 * - 10 or more forms (HEADER_FORMS_SEARCH_MIN; the sidebar item's own rule is
 *   more than 10): a search box with type-ahead and the match highlighted.
 * - Keyboard: ↑ / ↓ move, Enter opens, Esc clears the search, then closes
 *   (focus goes back to the trigger).
 * - No available forms: a short empty state; the trigger always shows.
 */

export const HEADER_FORMS_EMPTY_TEXT = "No forms have been shared with you yet."

/** The panel's body: the list, a loading line, or the empty state. */
export function HeaderFormsPanelBody({ forms, loading = false, onClose, autoFocus = false, searchMin = HEADER_FORMS_SEARCH_MIN }: {
  forms: AvailableForm[]
  loading?: boolean
  onClose: () => void
  autoFocus?: boolean
  searchMin?: number
}) {
  if (forms.length === 0) {
    return (
      <p className="px-2 py-2 text-ui text-fg-muted" role="status" data-header-forms-empty>
        {loading ? "Loading forms…" : HEADER_FORMS_EMPTY_TEXT}
      </p>
    )
  }
  return <AvailableFormsList forms={forms} variant="header" onClose={onClose} autoFocus={autoFocus} searchMin={searchMin} />
}

/** The trigger button (exported for tests): "Forms" with the icon and a chevron; icon-only when collapsed. */
export function HeaderFormsTrigger({ open, collapsed, panelId, count, onClick, triggerRef }: {
  open: boolean
  collapsed: boolean
  panelId: string
  count: number
  onClick: () => void
  triggerRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.preventDefault(); onClick() } }}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      aria-label={collapsed ? `Forms (${count})` : undefined}
      className={cn(
        "flex h-8 w-full items-center rounded-md text-ui font-medium text-[color:var(--theme-sidebar-text)] transition-colors hover:bg-[var(--sidebar-hover-bg)]",
        collapsed ? "justify-center" : "gap-2 px-2",
        open && "bg-[var(--sidebar-hover-bg)]",
      )}
      data-header-forms-trigger
    >
      <FileText className="size-4 shrink-0" aria-hidden />
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-left">Forms</span>
          <ChevronDown className={cn("size-3.5 shrink-0 text-[color:var(--theme-sidebar-muted)] transition-transform", open && "rotate-180")} aria-hidden />
        </>
      )}
    </button>
  )
}

/**
 * `placement`: below the trigger (expanded side menu, phone menu) or beside
 * it (collapsed side menu).
 */
export function HeaderFormsMenu({ collapsed = false, placement = collapsed ? "right" : "below" }: {
  collapsed?: boolean
  placement?: "below" | "right"
}) {
  const { forms, loading } = useAvailableFormsState()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pathname = usePathname()

  // Opening a form (or any navigation) closes the panel.
  const [seenPath, setSeenPath] = useState(pathname)
  if (seenPath !== pathname) {
    setSeenPath(pathname)
    setOpen(false)
  }

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])
  const dismiss = useCallback(() => setOpen(false), [])

  const trigger = (
    <HeaderFormsTrigger open={open} collapsed={collapsed} panelId={panelId} count={forms.length} onClick={() => setOpen((v) => !v)} triggerRef={triggerRef} />
  )

  return (
    <div data-header-forms>
      {collapsed ? (
        // A wrapper takes the hover / focus events (they bubble from the button).
        <Tooltip content="Forms" side="right" enabled={!open}><div>{trigger}</div></Tooltip>
      ) : trigger}
      {open && (
        <HeaderFormsPanel id={panelId} anchor={triggerRef} placement={placement} onClose={close} onDismiss={dismiss}>
          <HeaderFormsPanelBody forms={forms} loading={loading} onClose={close} autoFocus />
        </HeaderFormsPanel>
      )}
    </div>
  )
}

/** The popover (portalled: the side menu and the top bar clip their content). */
export function HeaderFormsPanel({ id, anchor, placement, onClose, onDismiss, children }: {
  id?: string
  anchor: React.RefObject<HTMLButtonElement | null>
  /** below: left-aligned under the trigger; below-end: right-aligned (top bar); right: beside it (collapsed side menu). */
  placement: "below" | "below-end" | "right"
  onClose: () => void
  /** Click outside / focus leaving: close without pulling focus back. */
  onDismiss: () => void
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect()
      if (!rect) return
      const height = panelRef.current?.offsetHeight ?? 0
      if (placement === "right") {
        const rail = anchor.current?.closest("aside")?.getBoundingClientRect()
        setPos({ left: (rail?.right ?? rect.right) + 8, top: Math.max(8, Math.min(rect.top - 6, window.innerHeight - height - 8)), width: 272 })
      } else if (placement === "below-end") {
        const width = Math.min(320, window.innerWidth - 16)
        setPos({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top: rect.bottom + 6, width })
      } else {
        const width = Math.max(rect.width, 256)
        setPos({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: rect.bottom + 6, width })
      }
    }
    place()
    window.addEventListener("resize", place)
    return () => window.removeEventListener("resize", place)
  }, [anchor, placement])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target) || anchor.current?.contains(target)) return
      onDismiss()
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [anchor, onDismiss])

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label="Forms"
      className={cn("ds-pop fixed z-[1000] p-1", floatingSurfaceClass)}
      data-state="open"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: pos?.width ?? 256 }}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); onClose() } }}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null
        if (next && !panelRef.current?.contains(next) && !anchor.current?.contains(next)) onDismiss()
      }}
      data-header-forms-panel
    >
      <p className="px-2 pb-1 pt-1.5 text-2xs font-medium text-fg-muted">Your forms</p>
      {children}
    </div>,
    // Inside a modal (the phone menu Sheet) the panel must live in the dialog,
    // or the dialog's focus trap and outside-pointer block swallow it.
    anchor.current?.closest<HTMLElement>('[role="dialog"]') ?? document.body,
  )
}
