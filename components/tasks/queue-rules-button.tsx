"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { SlidersHorizontal } from "lucide-react"
import { IconButton } from "@/components/ui/icon-button"
import { useIsMobile } from "@/hooks/use-mobile"

// The dialog (queue-rules editor, lib/tasks/queue-rules) loads when it opens, not with Home / My tasks.
const QueueRulesDialog = dynamic(() => import("./queue-rules-dialog").then((m) => m.QueueRulesDialog), { ssr: false })

/** "Queue rules" toolbar button: opens the signed-in person's queue rules. */
export function QueueRulesButton() {
  const [open, setOpen] = useState(false)
  const mobile = useIsMobile()
  return (
    <>
      <IconButton size="sm" label="Queue rules" icon={<SlidersHorizontal />} onClick={() => setOpen(true)} aria-haspopup="dialog" data-queue-rules-button />
      {open && <QueueRulesDialog open={open} onOpenChange={setOpen} mobile={mobile} />}
    </>
  )
}
