"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { History } from "lucide-react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Button, buttonVariants } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"
import { useIsMobile } from "@/hooks/use-mobile"
import type { TimelineTarget } from "@/lib/run-timeline"

// The timeline's own chunk: the lists only load it when a sheet opens.
const RunTimeline = dynamic(() => import("./run-timeline").then((m) => m.RunTimeline), {
  loading: () => <div className="space-y-3"><Skeleton className="h-28 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>,
})

/** The timeline over the current page: a right sheet (a bottom sheet on phones). */
export function TimelineSheet({ target, open, onOpenChange, title = "Timeline" }: { target: TimelineTarget; open: boolean; onOpenChange: (open: boolean) => void; title?: string }) {
  const mobile = useIsMobile()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={title} size="lg" side={mobile ? "bottom" : "right"} className={mobile ? "h-[85dvh]" : undefined} data-timeline-sheet>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2 sm:px-5">
          {open && <RunTimeline target={target} />}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** A list row's small Timeline button (next to Process view); opens the sheet. */
export function TimelineIconButton({ target, title }: { target: TimelineTarget; title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Tooltip content="Timeline — what has happened so far">
        <button type="button" aria-label={`Timeline: ${title}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
          data-timeline-button={target.runId ?? target.taskId}
          onClick={(e) => { e.stopPropagation(); setOpen(true) }}
          onKeyDown={(e) => e.stopPropagation()}>
          <History className="size-3.5" aria-hidden="true" />
        </button>
      </Tooltip>
      {open && <span onClick={(e) => e.stopPropagation()} className="contents"><TimelineSheet target={target} open={open} onOpenChange={setOpen} /></span>}
    </>
  )
}

/** A header "Timeline" button (task page, process views). */
export function TimelineButton({ target, label = "Timeline", variant = "secondary" }: { target: TimelineTarget; label?: string; variant?: "secondary" | "ghost" }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant={variant} leadingIcon={<History />} onClick={() => setOpen(true)} data-timeline-open>{label}</Button>
      {open && <TimelineSheet target={target} open={open} onOpenChange={setOpen} />}
    </>
  )
}
