"use client"

import { forwardRef, type ReactNode } from "react"
import { Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Kbd } from "./kbd"

export type ControlSize = "sm" | "md" | "lg"

/** Heights: sm 28, md = density control height (32 comfortable), lg 40 (form runtime). Never below 40 on touch. */
export const CONTROL_HEIGHT: Record<ControlSize, string> = {
  sm: "h-[max(var(--ds-control-h-sm),var(--ds-touch-min))]",
  md: "h-[max(var(--ds-control-h),var(--ds-touch-min))]",
  lg: "h-10",
}

/**
 * Shared look of text-like controls (Input, Select, Textarea, picker
 * triggers): input background, 1px input border, radius sm, 13px text,
 * border-strong on hover, the global focus ring, danger border when
 * aria-invalid, subtle background when disabled.
 */
export const controlClass = cn(
  "w-full min-w-0 rounded-[var(--ds-radius-input)] border border-input-border bg-input text-[length:var(--ds-control-text)] leading-5 text-fg",
  "placeholder:text-fg-subtle",
  "transition-[border-color,box-shadow] duration-[var(--ds-dur-fast)] ease-[var(--ds-ease-standard)]",
  "hover:border-border-strong",
  "aria-invalid:border-danger aria-invalid:focus-visible:border-danger aria-invalid:shadow-[0_0_0_3px_color-mix(in_srgb,var(--theme-danger)_18%,transparent)]",
  "disabled:cursor-not-allowed disabled:bg-subtle disabled:text-fg-muted disabled:hover:border-input-border",
)

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** sm 28px · md 32px (density) · lg 40px (form runtime). */
  size?: ControlSize
  /** The native `size` attribute (character width). */
  htmlSize?: number
  /** Icon (16px, muted) inside the left edge. */
  leading?: ReactNode
  /** Content inside the right edge: a unit, a clear button, a Kbd. */
  trailing?: ReactNode
  /** Classes for the wrapper when `leading` / `trailing` are set. */
  wrapperClassName?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size = "md", htmlSize, leading, trailing, wrapperClassName, ...props }, ref) => {
    const input = (
      <input
        ref={ref}
        type={type}
        size={htmlSize}
        className={cn(controlClass, CONTROL_HEIGHT[size], "px-2.5", size === "lg" && "px-3 text-sm", leading != null && "pl-8", trailing != null && "pr-8", className)}
        {...props}
      />
    )
    if (leading == null && trailing == null) return input
    return (
      <div className={cn("relative flex w-full items-center", wrapperClassName)}>
        {leading != null && (
          <span className="pointer-events-none absolute left-2.5 inline-flex text-fg-muted [&>svg]:size-4" aria-hidden="true">{leading}</span>
        )}
        {input}
        {trailing != null && <span className="absolute right-1.5 inline-flex items-center gap-1 text-fg-muted">{trailing}</span>}
      </div>
    )
  },
)
Input.displayName = "Input"

export interface SearchInputProps extends Omit<InputProps, "leading" | "trailing" | "onChange" | "value" | "type"> {
  value: string
  onValueChange: (value: string) => void
  /** Shortcut hint shown while empty ("/"). */
  kbd?: ReactNode
  clearLabel?: string
}

/** Input with a search icon, a clear button and an optional shortcut hint. */
const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ value, onValueChange, kbd, clearLabel = "Clear search", placeholder = "Search…", className, onKeyDown, ...props }, ref) => (
    <Input
      ref={ref}
      type="search"
      role="searchbox"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onValueChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && value) { e.preventDefault(); onValueChange("") }
        onKeyDown?.(e)
      }}
      leading={<Search />}
      trailing={value ? (
        <button type="button" onClick={() => onValueChange("")} aria-label={clearLabel}
          className="inline-flex size-5 items-center justify-center rounded-sm text-fg-muted hover:bg-muted hover:text-fg">
          <X className="size-3.5" />
        </button>
      ) : kbd != null ? <Kbd>{kbd}</Kbd> : undefined}
      {...props}
      className={cn("[&::-webkit-search-cancel-button]:appearance-none", className)}
    />
  ),
)
SearchInput.displayName = "SearchInput"

export { Input, SearchInput }
