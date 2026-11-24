"use client"

import { useState } from "react"
import { useQueryClient, type QueryKey } from "@tanstack/react-query"
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { InlineNotice } from "@/components/ui/inline-notice"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { TagInput } from "@/components/ui/tag-input"
import { useInvalidateTagStyles } from "@/hooks/use-tag-styles"
import { usePermissions } from "@/lib/permissions-context"
import type { Permission } from "@/lib/permissions"
import { applyObjectTags } from "@/app/actions/tags"
import type { TaggableType } from "@/lib/services/object-tags"
import { TAG_EDIT_PERMISSIONS } from "@/lib/tags/object-types"

/**
 * "Tags…" from a row's ⋯ menu: the object's tags as coloured chips (× to
 * remove) and the autocomplete to add. Each change saves at once through
 * the object's own update (and its permission); the list's queries are
 * invalidated so its chips update. Without the edit permission the dialog
 * is read-only and says why.
 */

/** Edit permission per type (the server checks again, per object). */
export const TAG_EDIT_PERMISSION = TAG_EDIT_PERMISSIONS as Record<TaggableType, Permission>

export function useCanEditTags(type: TaggableType): boolean {
  const { can } = usePermissions()
  return can(TAG_EDIT_PERMISSION[type])
}

export function ObjectTagsDialog({ open, onOpenChange, type, id, name, tags, invalidate, canEdit: canEditOverride, readOnlyReason }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: TaggableType
  id: string
  name: string
  tags: readonly string[]
  /** Query keys of the list to refresh after each change. */
  invalidate: QueryKey[]
  /** The list knows better than the permission (an app's named editors; only a report's creator). */
  canEdit?: boolean
  /** Why it is read-only, when canEdit is false for a reason other than the permission. */
  readOnlyReason?: string
}) {
  const canEditByPermission = useCanEditTags(type)
  const canEdit = canEditOverride ?? canEditByPermission
  const queryClient = useQueryClient()
  const invalidateTags = useInvalidateTagStyles()
  const [current, setCurrent] = useState<string[]>([...tags])
  const [error, setError] = useState<string | null>(null)

  async function save(change: { add?: string[]; remove?: string[] }) {
    setError(null)
    const result = await applyObjectTags({ type, ids: [id], ...change })
    if (!result.ok) { setError(result.error); throw new Error(result.error) }
    const updated = result.data.updated[0]?.tags
    if (updated) setCurrent(updated)
    await Promise.all([...invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })), invalidateTags()])
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" title={`Tags: ${name}`} description={canEdit ? "Changes save straight away." : undefined}>
        <DialogBody className="space-y-3" data-object-tags-dialog={type}>
          {!canEdit && <InlineNotice tone="warning" message={readOnlyReason ?? `You can see these tags but not change them: that needs the ${TAG_EDIT_PERMISSION[type]} permission.`} />}
          <TagInput value={current} disabled={!canEdit} autoFocus={canEdit} listInline aria-label={`Tags of ${name}`}
            onAdd={(tag) => save({ add: [tag] })}
            onRemove={(tag) => save({ remove: [tag] })} />
          {error && <InlineNotice tone="error" message={error} />}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Bulk "Add / remove tags" for the selected rows of a list. */
export function BulkTagsDialog({ open, onOpenChange, type, ids, invalidate, onDone }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: TaggableType
  ids: string[]
  invalidate: QueryKey[]
  onDone?: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const invalidateTags = useInvalidateTagStyles()
  const [mode, setMode] = useState<"add" | "remove">("add")
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function apply() {
    setBusy(true)
    setError(null)
    const result = await applyObjectTags({ type, ids, ...(mode === "add" ? { add: tags } : { remove: tags }) })
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    await Promise.all([...invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })), invalidateTags()])
    const { updated, unchanged, failed } = result.data
    const message = `${mode === "add" ? "Added" : "Removed"} ${tags.join(", ")} ${mode === "add" ? "to" : "from"} ${updated.length} item${updated.length === 1 ? "" : "s"}${unchanged.length ? ` (${unchanged.length} already ${mode === "add" ? "had them" : "without them"})` : ""}.`
    if (failed.length) { setError(`${message} ${failed.length} couldn't be changed: ${failed[0].error}`); return }
    onDone?.(message)
    setTags([])
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent size="sm" title={`Tags for ${ids.length} selected`}>
        <DialogBody className="space-y-3" data-bulk-tags-dialog={type}>
          <SegmentedControl aria-label="Add or remove" value={mode} onValueChange={(v) => setMode(v as "add" | "remove")}
            options={[{ value: "add", text: "Add tags" }, { value: "remove", text: "Remove tags" }]} />
          <TagInput value={tags} onChange={setTags} autoFocus listInline aria-label={mode === "add" ? "Tags to add" : "Tags to remove"} />
          {error && <InlineNotice tone="error" message={error} />}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void apply()} loading={busy} disabled={!tags.length}>{mode === "add" ? "Add" : "Remove"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
