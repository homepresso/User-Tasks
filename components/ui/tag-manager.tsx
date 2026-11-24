"use client"

import { useEffect, useRef, useState } from "react"
import { Plus, Tag as TagIcon, X } from "lucide-react"
import { TagChip } from "@/components/ui/tag-chip"
import { EditableTagChip } from "@/components/ui/tag-color-popover"
import { TagInput } from "@/components/ui/tag-input"
import { tagKey } from "@/lib/tags/palette"

/**
 * Tag editing and filtering for lists (workflows, integrations, references).
 * Chips take their colour from the workspace tag registry (TagChip); people
 * with tags.manage click a chip to pick its colour (EditableTagChip), which
 * changes it everywhere. New tags need no colour: they get their automatic
 * one straight away.
 */

// ─── InlineTagEditor ───

interface InlineTagEditorProps {
  tags: string[]
  /** @deprecated Suggestions now come from the workspace (TagInput's autocomplete); kept for callers. */
  suggestions?: string[]
  selectedTag?: string | null
  onSelectTag?: (tag: string | null) => void
  onAdd: (tag: string) => void | Promise<void>
  onRemove: (tag: string) => void | Promise<void>
}

/**
 * A row's tags with a + to edit: coloured chips (click to filter, or to
 * recolour with tags.manage); editing swaps in the shared TagInput
 * (autocomplete from the workspace's tags, Enter / comma to add).
 */
export function InlineTagEditor({ tags, selectedTag, onSelectTag, onAdd, onRemove }: InlineTagEditorProps) {
  const [isEditing, setIsEditing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsEditing(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  if (isEditing) {
    return (
      <div ref={containerRef} className="max-w-md" data-inline-tag-editor onKeyDown={(e) => { if (e.key === "Escape") setIsEditing(false) }}>
        <TagInput value={tags ?? []} onAdd={onAdd} onRemove={onRemove} autoFocus />
      </div>
    )
  }
  return (
    <div ref={containerRef} className="relative flex flex-wrap items-center gap-1" data-inline-tag-editor>
      {(tags ?? []).map((tag) => (
        <EditableTagChip key={tag} name={tag} size="xs"
          selected={selectedTag != null && tagKey(selectedTag) === tagKey(tag)}
          onSelect={onSelectTag ? () => onSelectTag(selectedTag != null && tagKey(selectedTag) === tagKey(tag) ? null : tag) : undefined} />
      ))}
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsEditing(true) }}
        className="rounded px-1 py-0.5 text-2xs text-fg-muted hover:opacity-70"
        aria-label="Edit tags"
      >
        <Plus size={10} />
      </button>
    </div>
  )
}

// ─── TagFilterBar ───

interface TagFilterBarProps {
  tags: string[]
  selectedTag: string | null
  onSelectTag: (tag: string | null) => void
}

/** Every tag of a list as coloured filter chips; one selected at a time. */
export function TagFilterBar({ tags, selectedTag, onSelectTag }: TagFilterBarProps) {
  if (tags.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-tag-filter-bar>
      <TagIcon size={12} className="text-fg-muted" aria-hidden />
      {tags.map((tag) => {
        const isSelected = selectedTag != null && tagKey(selectedTag) === tagKey(tag)
        return (
          <TagChip key={tag} name={tag} size="sm" selected={isSelected}
            onClick={() => onSelectTag(isSelected ? null : tag)} />
        )
      })}
      {selectedTag && (
        <button type="button" onClick={() => onSelectTag(null)} className="text-2xs text-fg-muted hover:opacity-70" aria-label="Clear tag filter">
          <X size={12} />
        </button>
      )}
    </div>
  )
}
export { TagInput, parseTagText } from "@/components/ui/tag-input"
