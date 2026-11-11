"use client"

import { useState } from "react"
import { Download, Eye, Paperclip, Plus, Trash2 } from "lucide-react"
import { Table, THead, TBody, TR, TH, TD, TDActions, TableSkeleton } from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog, DialogBody, DialogContent } from "@/components/ui/dialog"
import { InlineNotice } from "@/components/ui/inline-notice"
import { Tooltip } from "@/components/ui/tooltip"
import { formatBytes } from "@/lib/format/number"
import { formatAbsolute, formatRelative } from "@/lib/format/date"
import { attachmentPreviewKind, type TaskAttachment } from "@/lib/task-attachments"
import { AddAttachmentDialog } from "./add-attachment-dialog"
import { useInvalidateTaskAttachments, useTaskAttachments } from "./use-task-attachments"

type Row = TaskAttachment & { can_delete: boolean }

const TYPE_TONE: Record<string, "info" | "success" | "warning" | "brand" | "neutral"> = {
  contract: "brand", invoice: "info", receipt: "success", evidence: "warning", image: "neutral", other: "neutral",
}

function TypeBadge({ type }: { type: string }) {
  return <Badge tone={TYPE_TONE[type.toLowerCase()] ?? "neutral"}>{type}</Badge>
}

function When({ at }: { at: string }) {
  return <time dateTime={at} title={formatAbsolute(at)}>{formatRelative(at)}</time>
}

/**
 * A task's Attachments: the list (name, type, description, file, who and
 * when; preview, download, delete), "Add attachment" and the empty state.
 * Self-contained — mount it in a tab and use useTaskAttachmentCount() for the
 * badge. `canEdit` can only narrow what the server allows (adding needs work
 * access on the open task; deleting the uploader or tasks.delete).
 */
export function TaskAttachmentsPanel({ taskId, canEdit = true }: { taskId: string; canEdit?: boolean }) {
  const { data, isLoading, error, refetch } = useTaskAttachments(taskId)
  const invalidate = useInvalidateTaskAttachments(taskId)
  const [adding, setAdding] = useState(false)
  const [addKey, setAddKey] = useState(0)
  const openAdd = () => { setAddKey((k) => k + 1); setAdding(true) }
  const [preview, setPreview] = useState<Row | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null)

  const canAdd = Boolean(canEdit && data?.can_add)
  const rows = data?.attachments ?? []

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const res = await fetch(`/api/internal/tasks/${encodeURIComponent(taskId)}/attachments/${deleting.id}`, { method: "DELETE", credentials: "same-origin" })
      const body = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) throw new Error(body?.error ?? "The attachment couldn't be deleted")
      setNotice({ tone: "success", text: `Deleted "${deleting.name}"` })
      setDeleting(null)
      await invalidate()
    } catch (err) {
      setNotice({ tone: "danger", text: err instanceof Error ? err.message : "The attachment couldn't be deleted" })
      setDeleting(null)
    } finally {
      setDeleteBusy(false)
    }
  }

  const actions = (row: Row, size: "sm" | "md" = "sm") => (
    <>
      {attachmentPreviewKind(row.mime) && (
        <IconButton size={size === "sm" ? "sm" : undefined} label={`Preview ${row.name}`} icon={<Eye />} onClick={() => setPreview(row)} />
      )}
      <Tooltip content="Download">
        <Button asChild variant="ghost" size={size === "sm" ? "icon-sm" : "icon"}>
          <a href={row.url} download={row.file_name} aria-label={`Download ${row.name}`} data-testid="attachment-download"><Download aria-hidden="true" className={size === "sm" ? "size-3.5" : "size-4"} /></a>
        </Button>
      </Tooltip>
      {canEdit && row.can_delete && (
        <IconButton size={size === "sm" ? "sm" : undefined} label={`Delete ${row.name}`} icon={<Trash2 />} variant="danger-ghost" onClick={() => setDeleting(row)} />
      )}
    </>
  )

  return (
    <div className="space-y-3" data-testid="task-attachments-panel">
      {(isLoading || rows.length > 0) && <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-ui text-fg-muted" aria-live="polite">
          {isLoading ? "Loading attachments…" : rows.length === 1 ? "1 file" : `${rows.length} files`}
          {data && !canAdd && rows.length > 0 && <span> · view only</span>}
        </p>
        {canAdd && rows.length > 0 && (
          <Button size="sm" leadingIcon={<Plus />} onClick={openAdd} className="max-sm:w-full" data-testid="add-attachment">Add attachment</Button>
        )}
      </div>}

      {data?.legal_hold && <InlineNotice tone="info" message="This task's form is on legal hold: its attachments can't be deleted." />}
      {notice && <InlineNotice tone={notice.tone} message={notice.text} onDismiss={() => setNotice(null)} />}

      {error ? (
        <EmptyState size="sm" variant="error" title="Couldn't load the attachments" description={error instanceof Error ? error.message : undefined} action={{ label: "Try again", onClick: () => void refetch() }} />
      ) : isLoading ? (
        <Table label="Attachments"><TBody><TableSkeleton columns={5} rows={3} /></TBody></Table>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-panel">
          <EmptyState
            size="sm"
            icon={Paperclip}
            title="No attachments yet"
            description={canAdd ? "Add contracts, invoices, receipts, photos or other evidence. Workflows can use them once the task is done." : "Nobody has attached a file to this task."}
            action={canAdd ? { label: "Add attachment", onClick: openAdd } : undefined}
          />
        </div>
      ) : (
        <>
          {/* 640px and up: a table. */}
          <div className="hidden sm:block">
            <Table label="Attachments">
              <THead>
                <tr><TH col="name">Name</TH><TH col="status">Type</TH><TH col="text">File</TH><TH col="date">Added</TH><TH col="actions"><span className="sr-only">Actions</span></TH></tr>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id} data-testid="attachment-row">
                    <TD className="max-w-0">
                      <div className="truncate font-medium text-fg" title={row.name}>{row.name}</div>
                      {row.description && <div className="truncate text-xs text-fg-muted" title={row.description}>{row.description}</div>}
                    </TD>
                    <TD><TypeBadge type={row.type} /></TD>
                    <TD className="max-w-0">
                      <div className="truncate text-fg" title={row.file_name}>{row.file_name}</div>
                      <div className="num text-xs text-fg-muted">{formatBytes(row.size)}</div>
                    </TD>
                    <TD className="whitespace-nowrap">
                      <div className="text-fg">{row.uploaded_by_name ?? (row.uploaded_by ? "Someone" : "Workflow")}</div>
                      <div className="text-xs text-fg-muted"><When at={row.created_at} /></div>
                    </TD>
                    <TDActions>{actions(row)}</TDActions>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {/* Phones: stacked rows. */}
          <ul className="divide-y divide-border-subtle rounded-lg border border-border bg-panel sm:hidden" aria-label="Attachments">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-1.5 p-3" data-testid="attachment-row-mobile">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-ui font-medium text-fg">{row.name}</div>
                    <div className="truncate text-xs text-fg-muted">{row.file_name} · <span className="num">{formatBytes(row.size)}</span></div>
                  </div>
                  <TypeBadge type={row.type} />
                </div>
                {row.description && <p className="whitespace-pre-line text-xs text-fg-muted">{row.description}</p>}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-fg-muted">{row.uploaded_by_name ?? (row.uploaded_by ? "Someone" : "Workflow")} · <When at={row.created_at} /></span>
                  <span className="flex items-center gap-1">{actions(row, "md")}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {data && (
        <AddAttachmentDialog
          key={addKey}
          taskId={taskId}
          open={adding}
          onOpenChange={setAdding}
          typeSuggestions={data.type_suggestions}
          maxFileBytes={data.max_file_bytes}
          onAdded={(a) => { setNotice({ tone: "success", text: `Added "${a.name}"` }); void invalidate() }}
        />
      )}
      <AttachmentPreview row={preview} onClose={() => setPreview(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => { if (!o) setDeleting(null) }}
        destructive
        busy={deleteBusy}
        title={deleting ? `Delete "${deleting.name}"?` : "Delete attachment?"}
        description="It disappears from the task for everyone. Workflows that already used it keep their copy of the details."
        confirmLabel="Delete attachment"
        onConfirm={confirmDelete}
      />
    </div>
  )
}

/** Images straight from the signed link (?inline=1: served as an image, sandboxed). */
function AttachmentPreview({ row, onClose }: { row: Row | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent size="lg" title={row?.name ?? "Preview"} description={row ? `${row.file_name} · ${formatBytes(row.size)}` : undefined}>
        <DialogBody className="pb-5">
          {row && (
            // eslint-disable-next-line @next/next/no-img-element -- an authorised, signed, private file
            <img src={`${row.url}?inline=1`} alt={row.description || row.name} className="mx-auto max-h-[70vh] max-w-full rounded-md object-contain" />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
