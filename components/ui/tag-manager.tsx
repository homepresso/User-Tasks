"use client"

import { useState, useRef, useEffect, useMemo, useCallback } from "react"
import { Tag, X, Plus, Check, Palette, Pipette } from "lucide-react"

// ─── Preset tag colors ───

export const TAG_COLORS = [
  { name: "Gray", value: "#6B7280" },
  { name: "Red", value: "#EF4444" },
  { name: "Orange", value: "#F97316" },
  { name: "Amber", value: "#F59E0B" },
  { name: "Green", value: "#22C55E" },
  { name: "Teal", value: "#17150F" },
  { name: "Blue", value: "#3B82F6" },
  { name: "Indigo", value: "#6366F1" },
  { name: "Purple", value: "#8B5CF6" },
  { name: "Pink", value: "#EC4899" },
]

// ─── Types ───

export interface TagDefinition {
  id: string
  name: string
  color: string
}

// ─── TagBadge ───

interface TagBadgeProps {
  tag: string
  color?: string
  selected?: boolean
  onSelect?: (tag: string) => void
  onRemove?: () => void
}

export function TagBadge({ tag, color, selected, onSelect, onRemove }: TagBadgeProps) {
  const bg = selected
    ? (color || "var(--theme-primary)")
    : color
      ? `color-mix(in srgb, ${color} 15%, transparent)`
      : "var(--theme-surface)"
  const fg = selected
    ? "white"
    : color || "var(--theme-muted-text)"

  return (
    <span
      className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full cursor-pointer transition-colors"
      style={{ backgroundColor: bg, color: fg }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onSelect?.(tag)
      }}
    >
      <Tag size={8} />
      {tag}
      {onRemove && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove() }}
          className="hover:opacity-60 ml-0.5"
        >
          <X size={8} />
        </button>
      )}
    </span>
  )
}

// ─── InlineTagEditor ───

interface InlineTagEditorProps {
  tags: string[]
  tagDefinitions?: TagDefinition[]
  selectedTag?: string | null
  onSelectTag?: (tag: string | null) => void
  onAdd: (tag: string) => void | Promise<void>
  onRemove: (tag: string) => void | Promise<void>
  onCreateDefinition?: (name: string, color: string) => void | Promise<void>
  onUpdateDefinitionColor?: (name: string, color: string) => void | Promise<void>
}

export function InlineTagEditor({
  tags, tagDefinitions, selectedTag, onSelectTag,
  onAdd, onRemove, onCreateDefinition, onUpdateDefinitionColor,
}: InlineTagEditorProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [input, setInput] = useState("")
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [colorPickerTag, setColorPickerTag] = useState<string | null>(null)
  const [pendingNewTag, setPendingNewTag] = useState<string | null>(null)
  const [pendingColor, setPendingColor] = useState("#6B7280")
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const defMap = useMemo(() => {
    const m = new Map<string, TagDefinition>()
    for (const d of tagDefinitions ?? []) m.set(d.name, d)
    return m
  }, [tagDefinitions])

  // Suggestions: all known tag definitions not already applied, filtered by input
  const suggestions = useMemo(() => {
    if (!tagDefinitions) return []
    const q = input.trim().toLowerCase()
    return tagDefinitions
      .filter(d => !tags.includes(d.name))
      .filter(d => !q || d.name.includes(q))
      .slice(0, 8)
  }, [tagDefinitions, tags, input])

  const showDropdown = isEditing && showSuggestions && (suggestions.length > 0 || input.trim())

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsEditing(false)
        setShowSuggestions(false)
        setColorPickerTag(null)
        setPendingNewTag(null)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  async function handleSubmit(tagName?: string) {
    const name = (tagName ?? input).trim().toLowerCase()
    if (!name || tags.includes(name)) return

    // If the tag already exists in definitions, apply it directly
    if (defMap.has(name)) {
      await onAdd(name)
      setInput("")
      setShowSuggestions(false)
      setPendingNewTag(null)
      return
    }

    // New tag — show color picker step
    if (onCreateDefinition) {
      setPendingNewTag(name)
      setPendingColor("#6B7280")
      setShowSuggestions(false)
      return
    }

    // No create handler — just add directly
    await onAdd(name)
    setInput("")
    setShowSuggestions(false)
  }

  async function confirmNewTag() {
    if (!pendingNewTag) return
    if (onCreateDefinition) {
      await onCreateDefinition(pendingNewTag, pendingColor)
    }
    await onAdd(pendingNewTag)
    setInput("")
    setPendingNewTag(null)
    setShowSuggestions(false)
  }

  function getColor(tag: string) {
    return defMap.get(tag)?.color
  }

  return (
    <div ref={containerRef} className="relative flex flex-wrap items-center gap-1">
      {(tags ?? []).map((tag) => (
        <div key={tag} className="relative group/tag">
          <TagBadge
            tag={tag}
            color={getColor(tag)}
            selected={selectedTag === tag}
            onSelect={onSelectTag ? () => onSelectTag(selectedTag === tag ? null : tag) : undefined}
            onRemove={isEditing ? () => onRemove(tag) : undefined}
          />
          {/* Color picker trigger — always visible on hover when handler provided */}
          {onUpdateDefinitionColor && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setColorPickerTag(colorPickerTag === tag ? null : tag) }}
              className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full border opacity-60 hover:opacity-100 transition-opacity flex items-center justify-center"
              style={{
                backgroundColor: getColor(tag) || "var(--theme-muted-text)",
                borderColor: "var(--theme-card-bg)",
              }}
            >
              <Palette size={6} color="white" />
            </button>
          )}
          {/* Color picker dropdown */}
          {colorPickerTag === tag && (
            <TagColorPicker
              currentColor={getColor(tag) || "#6B7280"}
              onSelect={async (color) => {
                await onUpdateDefinitionColor!(tag, color)
                setColorPickerTag(null)
              }}
              onClose={() => setColorPickerTag(null)}
            />
          )}
        </div>
      ))}

      {isEditing ? (
        <div className="relative">
          <form className="inline-flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); handleSubmit() }}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); setShowSuggestions(true) }}
              onFocus={() => setShowSuggestions(true)}
              placeholder="add tag..."
              className="w-24 text-[9px] px-1.5 py-0.5 rounded border outline-none"
              style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)" }}
              autoFocus
            />
            {input.trim() && (
              <button type="submit" className="text-[9px]" style={{ color: "var(--theme-primary-text)" }}>
                <Plus size={8} />
              </button>
            )}
          </form>

          {/* Suggestion dropdown */}
          {showDropdown && !pendingNewTag && (
            <div className="absolute top-full left-0 z-20 mt-1 w-44 rounded-lg border shadow-lg overflow-hidden"
              style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
            >
              {suggestions.map(s => (
                <button
                  key={s.name}
                  onMouseDown={(e) => { e.preventDefault(); handleSubmit(s.name) }}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-[10px] text-left hover:opacity-80 transition-colors"
                  style={{ color: "var(--theme-card-text)" }}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  {s.name}
                </button>
              ))}
              {input.trim() && !suggestions.some(s => s.name === input.trim().toLowerCase()) && (
                <button
                  onMouseDown={(e) => { e.preventDefault(); handleSubmit() }}
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-[10px] text-left border-t"
                  style={{ color: "var(--theme-primary-text)", borderColor: "var(--theme-surface-border)" }}
                >
                  <Plus size={10} />
                  Create &ldquo;{input.trim().toLowerCase()}&rdquo;
                </button>
              )}
            </div>
          )}

          {/* New tag color picker step */}
          {pendingNewTag && (
            <div className="absolute top-full left-0 z-20 mt-1 w-52 rounded-lg border shadow-lg"
              style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
              onClick={e => e.stopPropagation()}
            >
              <div className="px-3 pt-2.5 pb-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: pendingColor }} />
                  <span className="text-[10px] font-semibold" style={{ color: "var(--theme-card-text)" }}>
                    {pendingNewTag}
                  </span>
                </div>
                <p className="text-[9px] mb-2" style={{ color: "var(--theme-muted-text)" }}>Choose a color for this tag</p>
                <div className="grid grid-cols-5 gap-1.5 mb-2">
                  {TAG_COLORS.map(c => (
                    <button
                      key={c.value}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPendingColor(c.value) }}
                      className="w-6 h-6 rounded-full flex items-center justify-center hover:scale-110 transition-transform"
                      style={{ backgroundColor: c.value }}
                      title={c.name}
                    >
                      {pendingColor === c.value && <Check size={10} color="white" />}
                    </button>
                  ))}
                </div>
                {/* Custom color row */}
                <div className="flex items-center gap-1.5 mb-2">
                  <input
                    type="color"
                    value={pendingColor}
                    onChange={(e) => setPendingColor(e.target.value)}
                    className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                    title="Pick custom color"
                  />
                  <input
                    type="text"
                    value={pendingColor}
                    onChange={(e) => setPendingColor(e.target.value)}
                    className="flex-1 text-[9px] font-mono px-1.5 py-1 rounded border outline-none"
                    style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-surface)" }}
                  />
                </div>
              </div>
              <div className="flex border-t" style={{ borderColor: "var(--theme-surface-border)" }}>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPendingNewTag(null) }}
                  className="flex-1 px-3 py-2 text-[10px] font-medium hover:opacity-70"
                  style={{ color: "var(--theme-muted-text)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={async (e) => { e.preventDefault(); e.stopPropagation(); await confirmNewTag() }}
                  className="flex-1 px-3 py-2 text-[10px] font-medium rounded-br-lg"
                  style={{ backgroundColor: pendingColor, color: "white" }}
                >
                  Create Tag
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsEditing(true); setInput("") }}
          className="text-[9px] px-1 py-0.5 rounded hover:opacity-70"
          style={{ color: "var(--theme-muted-text)" }}
        >
          <Plus size={8} />
        </button>
      )}
    </div>
  )
}

// ─── TagColorPicker ───

function TagColorPicker({ currentColor, onSelect, onClose }: {
  currentColor: string
  onSelect: (color: string) => void | Promise<void>
  onClose: () => void
}) {
  const [customHex, setCustomHex] = useState(currentColor)
  const [showCustom, setShowCustom] = useState(false)

  return (
    <div
      className="absolute top-full left-0 z-20 mt-1 rounded-lg border shadow-lg"
      style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
      onClick={e => e.stopPropagation()}
    >
      {/* Preset colors */}
      <div className="p-2 grid grid-cols-5 gap-1.5">
        {TAG_COLORS.map(c => (
          <button
            key={c.value}
            onClick={async (e) => { e.preventDefault(); e.stopPropagation(); await onSelect(c.value) }}
            className="w-6 h-6 rounded-full flex items-center justify-center hover:scale-110 transition-transform"
            style={{ backgroundColor: c.value }}
            title={c.name}
          >
            {currentColor === c.value && <Check size={10} color="white" />}
          </button>
        ))}
      </div>

      {/* Custom color toggle */}
      <div className="border-t px-2 py-1.5" style={{ borderColor: "var(--theme-surface-border)" }}>
        {showCustom ? (
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-full shrink-0 border" style={{ backgroundColor: customHex, borderColor: "var(--theme-surface-border)" }} />
            <input
              type="text"
              value={customHex}
              onChange={(e) => setCustomHex(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSelect(customHex) } }}
              placeholder="#hex"
              className="w-[72px] text-[10px] font-mono px-1.5 py-1 rounded border outline-none"
              style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-surface)" }}
              autoFocus
            />
            <input
              type="color"
              value={customHex}
              onChange={(e) => setCustomHex(e.target.value)}
              className="w-6 h-6 rounded cursor-pointer border-0 p-0"
              title="Pick color"
            />
            <button
              onClick={async (e) => { e.preventDefault(); e.stopPropagation(); await onSelect(customHex) }}
              className="text-[9px] font-medium px-1.5 py-0.5 rounded"
              style={{ backgroundColor: "var(--theme-primary)", color: 'var(--theme-on-primary)' }}
            >
              Apply
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowCustom(true) }}
            className="flex items-center gap-1.5 text-[10px] w-full py-0.5 hover:opacity-70"
            style={{ color: "var(--theme-muted-text)" }}
          >
            <Pipette size={10} />
            Custom color...
          </button>
        )}
      </div>
    </div>
  )
}

// ─── TagFilterBar ───

interface TagFilterBarProps {
  tags: string[]
  tagDefinitions?: TagDefinition[]
  selectedTag: string | null
  onSelectTag: (tag: string | null) => void
}

export function TagFilterBar({ tags, tagDefinitions, selectedTag, onSelectTag }: TagFilterBarProps) {
  if (tags.length === 0) return null

  const defMap = new Map<string, TagDefinition>()
  for (const d of tagDefinitions ?? []) defMap.set(d.name, d)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Tag size={12} style={{ color: "var(--theme-muted-text)" }} />
      {tags.map(tag => {
        const color = defMap.get(tag)?.color
        const isSelected = selectedTag === tag
        return (
          <button
            key={tag}
            onClick={() => onSelectTag(isSelected ? null : tag)}
            className="text-[10px] px-2 py-0.5 rounded-full transition-colors"
            style={{
              backgroundColor: isSelected ? (color || "var(--theme-primary)") : color ? `color-mix(in srgb, ${color} 15%, transparent)` : "var(--theme-surface)",
              color: isSelected ? 'var(--theme-on-primary)' : color || "var(--theme-muted-text)",
            }}
          >
            {tag}
          </button>
        )
      })}
      {selectedTag && (
        <button onClick={() => onSelectTag(null)} className="text-[10px] hover:opacity-70" style={{ color: "var(--theme-muted-text)" }}>
          <X size={12} />
        </button>
      )}
    </div>
  )
}
