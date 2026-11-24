"use client"

import { forwardRef, type ReactNode } from "react"
import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"
import { useTagStyles } from "@/hooks/use-tag-styles"
import { autoTagColor, cleanTagName, TAG_PALETTE, type TagColorToken } from "@/lib/tags/palette"

/**
 * One tag, in its colour: the colour chosen for it in the workspace's tag
 * registry (Settings → Tags), else its automatic colour (from the name;
 * neutral grey when the workspace turned auto colour off). Colours come from
 * the palette's CSS (app/globals.css `.tag-chip`), tinted into the theme's
 * card colour in light and dark mode. A description shows as a tooltip.
 *
 * Every list, card and detail that shows tags uses this (or TagList).
 */

export type TagChipSize = "xs" | "sm" | "md"

const SIZE: Record<TagChipSize, string> = {
  xs: "h-4 px-1 text-2xs gap-0.5",
  sm: "h-5 px-1.5 text-xs gap-1",
  md: "h-6 px-2 text-xs gap-1",
}

export interface TagChipProps extends Omit<React.HTMLAttributes<HTMLElement>, "color" | "onClick"> {
  name: string
  size?: TagChipSize
  /** Show this colour instead of the workspace's (previews, the picker). */
  color?: TagColorToken
  /** Override the registry description (tooltip). */
  description?: string | null
  /** Ringed: an active filter. */
  selected?: boolean
  /** Makes the chip a button (filters). */
  onClick?: (event: React.MouseEvent<HTMLElement>) => void
  /** Adds a remove (×) button. */
  onRemove?: () => void
  /** Max width class (truncates the name); default max-w-[12rem]. */
  maxWidthClass?: string
  /** Leading content (e.g. an icon). */
  leading?: ReactNode
}

export const TagChip = forwardRef<HTMLElement, TagChipProps>(function TagChip(
  { name, size = "sm", color, description, selected = false, onClick, onRemove, maxWidthClass = "max-w-[12rem]", leading, className, ...rest },
  ref,
) {
  const { resolve } = useTagStyles()
  const label = cleanTagName(name)
  const style = resolve(label)
  const token = color ?? style.color
  const tip = description !== undefined ? description : style.description
  const classes = cn(
    "tag-chip inline-flex w-fit min-w-0 shrink-0 items-center whitespace-nowrap rounded-full border font-medium leading-none",
    SIZE[size], maxWidthClass,
    onClick && "cursor-pointer transition-[filter] duration-[var(--ds-dur-fast)] hover:brightness-95 dark:hover:brightness-110",
    className,
  )
  const inner = (
    <>
      {leading}
      <span className="truncate">{label}</span>
      {onRemove && (
        <button type="button" aria-label={`Remove tag ${label}`} data-tag-remove
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove() }}
          className="-mr-0.5 inline-flex shrink-0 items-center justify-center rounded-full opacity-70 hover:opacity-100">
          <X className={size === "xs" ? "size-2.5" : "size-3"} aria-hidden />
        </button>
      )}
    </>
  )
  const common = { "data-tag": label, "data-tag-color": token, "data-tag-selected": selected || undefined, className: classes, ...rest }
  const chip = onClick ? (
    <button ref={ref as React.Ref<HTMLButtonElement>} type="button" aria-pressed={selected} {...common}
      onClick={(e) => { e.stopPropagation(); onClick(e) }}>
      {inner}
    </button>
  ) : (
    <span ref={ref as React.Ref<HTMLSpanElement>} {...common}>{inner}</span>
  )
  return tip ? <Tooltip content={<><span className="font-semibold">{label}</span> · {tip}</>}>{chip}</Tooltip> : chip
})

export interface TagListProps {
  tags: readonly string[] | null | undefined
  /** Chips shown before "+N" (default 3; 0 = all). */
  max?: number
  size?: TagChipSize
  selectedTag?: string | null
  onTagClick?: (tag: string) => void
  className?: string
  maxWidthClass?: string
}

/** A row of tag chips with "+N" for the rest (their names in a tooltip). */
export function TagList({ tags, max = 3, size = "sm", selectedTag, onTagClick, className, maxWidthClass }: TagListProps) {
  const list = [...new Set((tags ?? []).map(cleanTagName).filter(Boolean))]
  if (!list.length) return null
  const shown = max > 0 ? list.slice(0, max) : list
  const rest = list.slice(shown.length)
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-1", className)} data-tag-list>
      {shown.map((t) => (
        <TagChip key={t} name={t} size={size} maxWidthClass={maxWidthClass}
          selected={selectedTag != null && selectedTag.toLowerCase() === t.toLowerCase()}
          onClick={onTagClick ? () => onTagClick(t) : undefined} />
      ))}
      {rest.length > 0 && (
        <Tooltip content={rest.join(", ")}>
          <span className="text-2xs text-fg-subtle" data-tag-overflow>+{rest.length}</span>
        </Tooltip>
      )}
    </span>
  )
}

/* ── Picking a colour ─────────────────────────────────────────────────── */

export interface TagColorPickerProps {
  name: string
  /** The chosen colour; null = automatic. */
  value: TagColorToken | null
  onChange: (color: TagColorToken | null) => void
  disabled?: boolean
  autoColor?: boolean
}

/** The palette as swatches, plus "Auto" (the colour the name gets by itself). */
export function TagColorPicker({ name, value, onChange, disabled = false, autoColor = true }: TagColorPickerProps) {
  const auto = autoColor ? autoTagColor(name) : "gray"
  return (
    <div className="space-y-2" data-tag-color-picker>
      <div role="radiogroup" aria-label={`Colour for ${name}`} className="grid grid-cols-8 gap-1.5">
        <button type="button" role="radio" aria-checked={value === null} disabled={disabled} title={`Auto (${auto})`}
          onClick={() => onChange(null)} data-tag-swatch="auto"
          className={cn("tag-swatch relative flex size-6 items-center justify-center rounded-full text-2xs font-semibold text-white ring-offset-2 ring-offset-[var(--theme-card-bg)] disabled:opacity-50",
            value === null && "ring-2 ring-[var(--theme-focus-ring)]")}
          data-tag-color={auto}>
          A
        </button>
        {TAG_PALETTE.map((p) => (
          <button key={p.token} type="button" role="radio" aria-checked={value === p.token} aria-label={p.label} title={p.label}
            disabled={disabled} onClick={() => onChange(p.token)} data-tag-swatch={p.token} data-tag-color={p.token}
            className={cn("tag-swatch flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-[var(--theme-card-bg)] transition-transform hover:scale-110 disabled:opacity-50",
              value === p.token && "ring-2 ring-[var(--theme-focus-ring)]")}>
            {value === p.token && <Check className="size-3 text-white" aria-hidden />}
          </button>
        ))}
      </div>
      <p className="text-2xs text-fg-muted">Auto gives the tag a colour from its name{autoColor ? "" : " (grey while automatic colours are off)"}.</p>
    </div>
  )
}
