"use client"

import { useState } from "react"
import { Popover } from "@/components/ui/popover"
import { TagChip, TagColorPicker, type TagChipSize } from "@/components/ui/tag-chip"
import { useInvalidateTagStyles, useTagStyles } from "@/hooks/use-tag-styles"
import { usePermissions } from "@/lib/permissions-context"
import type { TagColorToken } from "@/lib/tags/palette"
import { setTagStyle } from "@/app/actions/tags"

/**
 * A chip that opens the colour picker when clicked — for people with
 * tags.manage; everyone else gets the plain chip. Saves to the workspace
 * registry, so the colour changes in every list (styles are refetched).
 * Renaming the tag later keeps its colour (the style moves with it).
 */
export function EditableTagChip({ name, size = "sm", onRemove, selected, onSelect, className }: {
  name: string
  size?: TagChipSize
  onRemove?: () => void
  selected?: boolean
  /** Filter click (when the person can't recolour, or alongside via the menu). */
  onSelect?: () => void
  className?: string
}) {
  const { can } = usePermissions()
  const { resolve, autoColor } = useTagStyles()
  const invalidate = useInvalidateTagStyles()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!can("tags.manage")) {
    return <TagChip name={name} size={size} onRemove={onRemove} selected={selected} onClick={onSelect ? () => onSelect() : undefined} className={className} />
  }
  const style = resolve(name)
  async function choose(color: TagColorToken | null, close: () => void) {
    setSaving(true)
    setError(null)
    const result = await setTagStyle(name, { color: color ?? "auto" })
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    await invalidate()
    close()
  }
  return (
    <Popover aria-label={`Tag ${name}`} width={248}
      trigger={(p) => (
        <TagChip ref={p.ref as React.Ref<HTMLElement>} name={name} size={size} selected={selected} onRemove={onRemove} className={className}
          aria-expanded={p["aria-expanded"]} aria-haspopup="dialog" title={`${name}: change colour`}
          onClick={() => p.onClick()} />
      )}>
      {(close) => (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <TagChip name={name} size="md" />
            {onSelect && (
              <button type="button" className="text-xs text-primary-text hover:underline" onClick={() => { onSelect(); close() }}>
                {selected ? "Clear filter" : "Filter by tag"}
              </button>
            )}
          </div>
          <TagColorPicker name={name} value={style.chosen} autoColor={autoColor} disabled={saving} onChange={(c) => void choose(c, close)} />
          {error && <p role="alert" className="text-2xs text-danger">{error}</p>}
          <a href="/settings/tags" className="block text-2xs text-fg-muted hover:text-fg hover:underline">Manage all tags…</a>
        </div>
      )}
    </Popover>
  )
}

/** A detail page's tags: every chip, each recolourable by people with tags.manage. */
export function EditableTagList({ tags, size = "sm" }: { tags: readonly string[]; size?: TagChipSize }) {
  const unique = [...new Set(tags.map((t) => t.trim()).filter(Boolean))]
  if (!unique.length) return null
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-tag-list>
      {unique.map((t) => <EditableTagChip key={t} name={t} size={size} />)}
    </span>
  )
}
