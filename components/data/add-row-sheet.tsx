'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { DialogBody, DialogFooter } from '@/components/ui/dialog'
import { insertRow } from '@/app/actions/data-store'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { columnKey } from '@/lib/data-table-cells'
import type { DataColumn } from './lookup-config'
import { RowFieldEditor, uploadRowFile } from './row-detail-drawer'

/** "Add row": every column as a Field in a Sheet; Save inserts the row. */
export function AddRowSheet({
  open,
  onOpenChange,
  columns,
  tableId,
  tenantId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  columns: DataColumn[]
  tableId: string
  tenantId: string
}) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [uploading, setUploading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const guard = useSubmitGuard()
  const router = useRouter()
  const queryClient = useQueryClient()

  function close() {
    setValues({})
    setError(null)
    onOpenChange(false)
  }

  async function save(addAnother: boolean) {
    await guard.run(async () => {
      setError(null)
      try {
        await insertRow(tableId, tenantId, values)
        queryClient.invalidateQueries({ queryKey: ['custom-table-rows', tableId] })
        queryClient.invalidateQueries({ queryKey: ['binding-table', tableId] })
        router.refresh()
        if (addAnother) setValues({})
        else close()
      } catch (e) {
        setError(`Failed to add row: ${e instanceof Error ? e.message : String(e)}`)
      }
    })
  }

  async function upload(key: string, file: File) {
    setUploading(key)
    try {
      const fileData = await uploadRowFile(tableId, file)
      setValues((prev) => ({ ...prev, [key]: fileData }))
    } catch (e) {
      setError(`Upload failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setUploading(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) close() }}>
      <SheetContent size="lg" title="Add row" description="Fill in the values for the new row. Empty fields stay blank.">
        <DialogBody className="space-y-5">
          {columns.map((col, index) => (
            <RowFieldEditor
              key={col.id || `col:${index}`}
              column={col}
              value={values[columnKey(col)]}
              onChange={(v) => setValues((prev) => ({ ...prev, [columnKey(col)]: v }))}
              uploading={uploading === columnKey(col)}
              onUpload={(file) => upload(columnKey(col), file)}
            />
          ))}
          {error && <InlineNotice tone="danger" message={error} onDismiss={() => setError(null)} />}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button variant="secondary" onClick={() => save(true)} disabled={guard.pending || uploading !== null}>Save and add another</Button>
          <Button onClick={() => save(false)} loading={guard.pending} disabled={uploading !== null}>Add row</Button>
        </DialogFooter>
      </SheetContent>
    </Sheet>
  )
}
