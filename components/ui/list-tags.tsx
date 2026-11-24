"use client"

import { useCallback, useMemo, useState } from "react"
import { ChevronDown, Tag as TagIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CountBadge } from "@/components/ui/badge"
import { IconButton } from "@/components/ui/icon-button"
import { TagChip, TagList } from "@/components/ui/tag-chip"
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cleanTagName, tagKey } from "@/lib/tags/palette"

/**
 * The tags column and tag filter every object list shares (data tables,
 * reports, business rules, email templates, form controls, apps, packages,
 * schedules, …): chips (max 3 + "+N") that toggle the list's tag filter when
 * clicked, a "Tags" filter menu over the tags on the list's rows, and a
 * "Tags…" icon button for lists whose rows have no ⋯ menu.
 */

/** The list's tag filter: every tag on its rows (first spelling per key), the selection, and a row matcher (any selected tag). */
export function useTagFilter<T>(items: readonly T[] | null | undefined, getTags: (item: T) => readonly unknown[] | null | undefined) {
  const [selected, setSelected] = useState<string[]>([])
  const allTags = useMemo(() => {
    const byKey = new Map<string, string>()
    for (const item of items ?? []) {
      for (const raw of getTags(item) ?? []) {
        const name = cleanTagName(raw)
        const key = tagKey(name)
        if (key && !byKey.has(key)) byKey.set(key, name)
      }
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    // getTags is a stable accessor in practice; items drive the recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])
  const selectedKeys = useMemo(() => new Set(selected.map(tagKey)), [selected])
  const matches = useCallback((item: T) => {
    if (!selectedKeys.size) return true
    return (getTags(item) ?? []).some((t) => selectedKeys.has(tagKey(t)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKeys])
  const toggle = useCallback((tag: string) => {
    setSelected((cur) => (cur.some((t) => tagKey(t) === tagKey(tag)) ? cur.filter((t) => tagKey(t) !== tagKey(tag)) : [...cur, tag]))
  }, [])
  return { allTags, selected, setSelected, toggle, matches, active: selected.length > 0, clear: () => setSelected([]) }
}

/** "Tags" toolbar filter: the tags on the list's rows as checkboxes (any of them matches). Hidden when no row has a tag. */
export function TagFilterMenu({ tags, selected, onChange, className }: {
  tags: readonly string[]
  selected: readonly string[]
  onChange: (next: string[]) => void
  className?: string
}) {
  if (!tags.length && !selected.length) return null
  const keys = new Set(selected.map(tagKey))
  const active = selected.length > 0
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className={className} leadingIcon={<TagIcon />} trailingIcon={<ChevronDown />} data-tag-filter
          aria-label={active ? `Tags: ${selected.join(", ")}` : "Filter by tag"}>
          {active && selected.length === 1 ? <span className="max-w-[10rem] truncate">{selected[0]}</span> : "Tags"}
          {active && selected.length > 1 && <CountBadge count={selected.length} tone="brand" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-[220px]">
        <DropdownMenuLabel>Show items tagged</DropdownMenuLabel>
        {tags.map((tag) => (
          <DropdownMenuCheckboxItem key={tagKey(tag)} checked={keys.has(tagKey(tag))} onSelect={(e) => e.preventDefault()}
            onCheckedChange={(on) => onChange(on ? [...selected, tag] : selected.filter((t) => tagKey(t) !== tagKey(tag)))}>
            <TagChip name={tag} size="xs" maxWidthClass="max-w-[14rem]" />
          </DropdownMenuCheckboxItem>
        ))}
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])}>Clear tag filter</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A row's tags for the Tags column: up to `max` chips and "+N"; clicking a chip toggles the list's filter. */
export function TagsCell({ tags, selected, onToggle, max = 3, className }: {
  tags: readonly string[] | null | undefined
  selected?: readonly string[]
  onToggle?: (tag: string) => void
  max?: number
  className?: string
}) {
  const list = tags ?? []
  if (!list.length) return <span className="text-fg-subtle" data-tags-cell="" aria-label="No tags">—</span>
  const keys = new Set((selected ?? []).map(tagKey))
  return (
    <span data-tags-cell="" onClick={(e) => { if (onToggle) e.stopPropagation() }}>
      <TagList tags={list} max={max} size="xs" maxWidthClass="max-w-[9rem]" className={className ?? "flex-wrap"}
        selectedTag={[...keys][0] ? list.find((t) => keys.has(tagKey(t))) ?? null : null}
        onTagClick={onToggle} />
    </span>
  )
}

/** "Tags…" for a row whose actions are icon buttons (no ⋯ menu). */
export function TagsActionButton({ onClick, label = "Tags…" }: { onClick: () => void; label?: string }) {
  return <IconButton label={label} icon={<TagIcon />} size="sm" onClick={(e) => { e.stopPropagation(); onClick() }} data-tags-action="" />
}
