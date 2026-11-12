'use client'

import { useId, useState } from 'react'
import { Eraser, PenLine } from 'lucide-react'
import { Dialog, DialogBody, DialogContent } from '@/components/ui/dialog'
import { attachmentPath } from '@/lib/forms/attachments'
import { describeSignature, normalizeSignatureValue, type SignatureValue } from '@/lib/forms/media-fields'
import type { ListColumn } from '@/lib/forms/list-field'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { cn } from '@/lib/utils'
import { SignatureField } from './signature-field'

/**
 * A List signature column (lib/forms/list-field.ts, type `signature`): each
 * row signs its own cell with the Signature control's pad
 * (components/forms/signature-field.tsx). The PNG is uploaded under the
 * column's upload key (`<list>.<column>`), the server re-reads it and
 * stamps who signed and when on submit.
 *
 *  - compact (an editable table's cell): the signature's thumbnail or a
 *    "Sign" button; either opens the pad in a dialog (sign, clear, re-sign).
 *  - full (the row pop-out, phone cards): the pad in place.
 *  - reading (list views, submissions): SignatureCellValue — the thumbnail
 *    and "Signed by … on …".
 */

/** The column as a Signature field (the pad reads its key — the upload key —, label and config). */
function padField(column: ListColumn, uploadKey: string): TaskFieldDef {
  return { key: uploadKey, label: column.label, type: 'signature', ...(column.signature ? { signature: column.signature } : {}), ...(column.required ? { required: true } : {}) }
}

/** A signature cell for reading: a small image and "Signed by … on …" (compact: the image, the text as its title). */
export function SignatureCellValue({ value, compact }: { value: unknown; compact?: boolean }) {
  const sig = normalizeSignatureValue(value)
  if (!sig) return <span className="text-fg-muted" data-signature-cell="empty">—</span>
  const text = describeSignature(sig)
  const who = sig.user_name || sig.typed_name
  return (
    <span className={cn('inline-flex max-w-full gap-1', compact ? 'items-center' : 'flex-col items-start')} title={text} data-signature-cell="signed">
      {sig.file.id && (
        // eslint-disable-next-line @next/next/no-img-element -- authorised, same-origin signature image
        <img src={`${attachmentPath(sig.file.id)}?inline=1`} alt={`Signature${who ? ` of ${who}` : ''}`} className={cn('rounded border border-border bg-white object-contain', compact ? 'h-8 max-w-[7rem]' : 'max-h-16 max-w-full p-0.5')} />
      )}
      <span className={cn('text-2xs text-fg-muted', compact && 'sr-only')}>{text}</span>
    </span>
  )
}

/** A signature cell people sign (compact: thumbnail / "Sign" → the pad in a dialog; full: the pad in place). */
export function SignatureCellInput({ column, uploadKey, value, onChange, id, compact, invalid, labelledBy, inputRef }: {
  column: ListColumn
  /** The column's upload key (listUploadKey: `<list>.<column>`, nested `<list>.<child>.<column>`). */
  uploadKey: string
  value: unknown
  onChange: (value: SignatureValue | null) => void
  id: string
  compact?: boolean
  invalid?: boolean
  labelledBy?: string
  inputRef?: (el: HTMLElement | null) => void
}) {
  const [open, setOpen] = useState(false)
  const padId = useId()
  const field = padField(column, uploadKey)
  const sig = normalizeSignatureValue(value)
  if (!compact) {
    return (
      <div data-signature-cell-input={column.key}>
        <span id={`${id}-label`} className="sr-only">{column.label}</span>
        <SignatureField field={field} value={sig} onChange={onChange} id={id} invalid={invalid} />
      </div>
    )
  }
  const who = sig?.user_name || sig?.typed_name
  return (
    <div className="flex min-h-10 items-center gap-1" data-signature-cell-input={column.key}>
      {sig ? (
        <>
          <button ref={inputRef as React.Ref<HTMLButtonElement>} id={id} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-labelledby={labelledBy ? `${labelledBy} ${id}` : undefined}
            aria-invalid={invalid || undefined} title={describeSignature(sig)}
            className="inline-flex h-10 max-w-[9rem] items-center rounded-md border border-border bg-white px-1 hover:border-primary" data-signature-cell-open>
            {sig.file.id
              // eslint-disable-next-line @next/next/no-img-element -- authorised, same-origin signature image
              ? <img src={`${attachmentPath(sig.file.id)}?inline=1`} alt={`Signature${who ? ` of ${who}` : ''} — change`} className="h-8 max-w-full object-contain" />
              : <span className="px-1 text-xs text-fg">Signed</span>}
          </button>
          <button type="button" onClick={() => onChange(null)} aria-label={`Clear ${column.label}`} title={`Clear ${column.label}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-subtle hover:text-fg" data-signature-cell-clear>
            <Eraser size={14} aria-hidden />
          </button>
        </>
      ) : (
        <button ref={inputRef as React.Ref<HTMLButtonElement>} id={id} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-labelledby={labelledBy ? `${labelledBy} ${id}` : undefined}
          aria-invalid={invalid || undefined}
          className={cn('inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium text-fg hover:bg-subtle', invalid ? 'border-(--status-blocked)' : 'border-border')} data-signature-cell-sign>
          <PenLine size={14} aria-hidden /> Sign
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md" title={column.label} data-signature-cell-dialog={column.key}>
          <DialogBody>
            <span id={`${padId}-label`} className="sr-only">{column.label}</span>
            <SignatureField field={field} value={sig} id={padId} invalid={invalid}
              onChange={(next) => { onChange(next); if (next) setOpen(false) }} />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  )
}
