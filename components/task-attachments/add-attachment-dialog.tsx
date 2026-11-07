"use client"

import { useEffect, useId, useRef, useState } from "react"
import { FileUp, X } from "lucide-react"
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { ProgressBar } from "@/components/ui/progress-bar"
import { InlineNotice } from "@/components/ui/inline-notice"
import { formatBytes } from "@/lib/format/number"
import { cn } from "@/lib/utils"
import { defaultAttachmentName, TASK_ATTACHMENT_LIMITS, validateAttachmentMeta, type TaskAttachment, type TaskAttachmentMeta } from "@/lib/task-attachments"
import { uploadTaskAttachment, UploadError } from "./upload"

type Errors = Partial<Record<keyof TaskAttachmentMeta | "file", string>>

/**
 * "Add attachment": a file (drag and drop or browse), a name (defaults to
 * the file name), a type (free text with the workspace's suggestions) and a
 * description; upload progress, field validation and server errors. A
 * centred dialog from 640px, a bottom sheet on phones.
 */
export function AddAttachmentDialog({ taskId, open, onOpenChange, typeSuggestions, maxFileBytes, onAdded }: {
  taskId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  typeSuggestions: string[]
  maxFileBytes: number
  onAdded: (attachment: TaskAttachment) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState("")
  const [nameTouched, setNameTouched] = useState(false)
  const [type, setType] = useState("")
  const [description, setDescription] = useState("")
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const listId = useId()
  const busy = progress !== null

  // The panel remounts this dialog (key) each time it opens; closing cancels an upload in flight.
  useEffect(() => { if (!open) abortRef.current?.abort() }, [open])
  useEffect(() => () => abortRef.current?.abort(), [])

  function pick(next: File | null | undefined) {
    if (!next) return
    setFormError(null)
    if (next.size === 0) { setErrors((e) => ({ ...e, file: "The file is empty" })); return }
    if (next.size > maxFileBytes) { setErrors((e) => ({ ...e, file: `Files must be ${formatBytes(maxFileBytes)} or smaller (this one is ${formatBytes(next.size)})` })); return }
    setFile(next)
    setErrors((e) => ({ ...e, file: undefined }))
    if (!nameTouched) setName(defaultAttachmentName(next.name))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy) return
    const meta = validateAttachmentMeta({ name, type, description }, file?.name ?? "")
    const next: Errors = meta.ok ? {} : { ...meta.errors }
    if (!file) next.file = "Choose a file"
    setErrors(next)
    if (!meta.ok || !file) return
    setFormError(null)
    setProgress(0)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const attachment = await uploadTaskAttachment(taskId, file, meta.value, setProgress, controller.signal)
      onAdded(attachment)
      onOpenChange(false)
    } catch (error) {
      setProgress(null)
      if (error instanceof UploadError && error.message === "aborted") return
      if (error instanceof UploadError && error.fields) setErrors(error.fields)
      setFormError(error instanceof Error ? error.message : "The upload failed — try again")
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy || !next) onOpenChange(next) }}>
      <DialogContent
        size="md"
        title="Add attachment"
        description="Attach a file to this task. People who can see the task can open it, and workflows can use it."
        className={cn(
          // Phones: a bottom sheet.
          "max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:max-h-[92vh] max-sm:w-full max-sm:rounded-b-none max-sm:[transform:none]",
        )}
        data-testid="add-attachment-dialog"
      >
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="space-y-4 overflow-y-auto">
            <div>
              <div
                role="button"
                tabIndex={busy ? -1 : 0}
                aria-label={file ? `File: ${file.name}. Press to choose another file` : "Choose a file, or drop one here"}
                aria-describedby={errors.file ? `${listId}-file-err` : undefined}
                aria-disabled={busy || undefined}
                onClick={() => !busy && inputRef.current?.click()}
                onKeyDown={(e) => { if (!busy && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); inputRef.current?.click() } }}
                onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) pick(e.dataTransfer.files?.[0]) }}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center",
                  "transition-colors duration-[var(--ds-dur-fast)]",
                  dragging ? "border-primary bg-primary-wash" : errors.file ? "border-danger" : "border-border-strong bg-subtle hover:bg-muted",
                  busy && "cursor-default opacity-70",
                )}
                data-testid="attachment-dropzone"
              >
                <FileUp className="size-5 text-fg-muted" aria-hidden="true" />
                {file ? (
                  <span className="flex max-w-full items-center gap-2 text-ui text-fg">
                    <span className="truncate font-medium">{file.name}</span>
                    <span className="num shrink-0 text-fg-muted">{formatBytes(file.size)}</span>
                  </span>
                ) : (
                  <span className="text-ui text-fg"><span className="font-medium text-primary-text">Choose a file</span> or drop it here</span>
                )}
                <span className="text-xs text-fg-muted">Up to {formatBytes(maxFileBytes)}. Executables and scripts are refused.</span>
              </div>
              <input ref={inputRef} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = "" }} data-testid="attachment-file-input" />
              {errors.file && <p id={`${listId}-file-err`} className="mt-1.5 text-xs text-danger">{errors.file}</p>}
            </div>

            <Field label="Name" error={errors.name}>
              <Input value={name} maxLength={TASK_ATTACHMENT_LIMITS.nameMax} disabled={busy} placeholder="e.g. Signed contract"
                onChange={(e) => { setName(e.target.value); setNameTouched(true); setErrors((x) => ({ ...x, name: undefined })) }} />
            </Field>
            <Field label="Type" optional description="Pick a suggestion or type your own." error={errors.type}>
              <Input value={type} list={`${listId}-types`} maxLength={TASK_ATTACHMENT_LIMITS.typeMax} disabled={busy} placeholder="Other"
                onChange={(e) => { setType(e.target.value); setErrors((x) => ({ ...x, type: undefined })) }} autoComplete="off" />
            </Field>
            <datalist id={`${listId}-types`}>
              {typeSuggestions.map((t) => <option key={t} value={t} />)}
            </datalist>
            <Field label="Description" optional error={errors.description}>
              <Textarea value={description} rows={3} maxLength={TASK_ATTACHMENT_LIMITS.descriptionMax} disabled={busy}
                onChange={(e) => { setDescription(e.target.value); setErrors((x) => ({ ...x, description: undefined })) }} />
            </Field>

            {progress !== null && (
              <div className="flex items-center gap-3" aria-live="polite">
                <ProgressBar value={progress} label={`Uploading ${file?.name ?? "file"}`} className="flex-1" />
                <span className="num w-10 text-right text-xs text-fg-muted">{progress}%</span>
                <IconButton size="sm" label="Cancel upload" icon={<X />} onClick={() => abortRef.current?.abort()} />
              </div>
            )}
            {formError && <InlineNotice tone="danger" message={formError} />}
          </DialogBody>
          <DialogFooter className="max-sm:flex-col-reverse max-sm:[&>*]:w-full">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy} data-testid="attachment-submit">{busy ? "Uploading…" : "Add attachment"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
