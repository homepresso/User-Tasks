'use client'

/**
 * "This trigger overlaps with another workflow" (TriggerHandler.conflicts): one conflict at a time,
 * with the extension's take-over label, Keep both, and Cancel. Used by the trigger panel (when the
 * settings change) and by Publish (when the draft has no answer yet).
 */

import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { TriggerConflict, TriggerConflictChoice } from '@/lib/extensions/sdk'

export function TriggerConflictDialog({ conflict, onChoose, onCancel, busy = false }: {
  conflict: TriggerConflict | null
  onChoose: (choice: TriggerConflictChoice) => void
  onCancel: () => void
  busy?: boolean
}) {
  return (
    <Dialog open={Boolean(conflict)} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent size="md" title="Another workflow starts on this too" data-trigger-conflict="">
        {conflict && (
          <>
            <DialogBody>
              <p className="text-ui text-fg">{conflict.message}</p>
              {conflict.deactivates && <p className="mt-2 text-xs text-fg-muted">It is the only event of “{conflict.workflow.name}”: removing it turns that workflow off (it is kept, not deleted).</p>}
            </DialogBody>
            <DialogFooter className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
              <Button variant="secondary" onClick={() => onChoose('keep_both')} disabled={busy}>Keep both — both workflows will run</Button>
              <Button onClick={() => onChoose('take_over')} loading={busy}>{conflict.takeOverLabel}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
