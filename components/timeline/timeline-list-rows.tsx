"use client"

import { useState } from "react"
import { Eye } from "lucide-react"
import { Dialog, DialogBody, DialogContent } from "@/components/ui/dialog"
import { ListValueView } from "@/components/forms/list-field"
import type { TimelineField } from "@/lib/run-timeline"

/** A timeline field's List rows: "View" opens them read-only (each row has its own "View row" pop-out). */
export function TimelineListRows({ field }: { field: TimelineField & { list: NonNullable<TimelineField["list"]> } }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="ml-2 inline-flex items-center gap-1 text-primary-text underline-offset-2 hover:underline" aria-haspopup="dialog" data-timeline-list-view>
        <Eye size={12} aria-hidden /> View
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl" title={field.label} description={field.value}>
          <DialogBody>
            <ListValueView field={{ key: "timeline_list", label: field.label, type: "list", list: field.list.config } as never} value={field.list.rows} />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  )
}
