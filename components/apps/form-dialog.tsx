"use client"

import { Dialog, DialogBody, DialogContent } from "@/components/ui/dialog"
import { StandaloneForm } from "@/components/forms/standalone-form"

/**
 * A reusable form in a dialog (an app's "New submission" button or menu
 * entry): the same form as /fill/<id>, with the viewer's own access
 * (forms.submit and the form's grants). Cancel, Close and a submission that
 * closes the form close the dialog.
 */
export function FormDialog({ formId, title, open, onOpenChange, onSubmitted }: {
  formId: string | null
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmitted?: () => void
}) {
  return (
    <Dialog open={open && !!formId} onOpenChange={onOpenChange}>
      {/* The body scrolls (the dialog itself is overflow-hidden, flex-col): a tall form stays scrollable. */}
      <DialogContent size="lg" title={title} hideHeader className="max-h-[90dvh]" data-app-form-dialog>
        <DialogBody className="p-0 max-sm:px-0" data-app-form-dialog-body>
          {formId && (
            <StandaloneForm formId={formId} surface="app"
              onDone={(event) => {
                if (event === "submitted") onSubmitted?.()
                onOpenChange(false)
              }} />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
