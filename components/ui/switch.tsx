"use client"

import { forwardRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "value"> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Visible label to the right; otherwise pass aria-label. */
  label?: ReactNode
  size?: "sm" | "md"
}

/** On/off toggle (role=switch): 28×16 track, 12px thumb with elev-1; primary when on. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, label, size = "md", className, disabled, ...props }, ref) => {
    const track = (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        data-state={checked ? "checked" : "unchecked"}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-[var(--ds-dur-fast)] ease-[var(--ds-ease-standard)]",
          size === "md" ? "h-4 w-7" : "h-3.5 w-6",
          checked ? "bg-primary" : "bg-border-strong",
          "disabled:cursor-not-allowed disabled:opacity-45",
          label == null && className,
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none block rounded-full bg-panel shadow-elev-1 transition-transform duration-[var(--ds-dur-fast)] ease-[var(--ds-ease-standard)]",
            size === "md" ? "size-3" : "size-2.5",
            checked ? (size === "md" ? "translate-x-[13px]" : "translate-x-[11px]") : "translate-x-[1px]",
          )}
        />
      </button>
    )
    if (label == null) return track
    return (
      <label className={cn("inline-flex cursor-pointer items-center gap-2 text-ui text-fg", disabled && "cursor-not-allowed opacity-60", className)}>
        {track}
        <span>{label}</span>
      </label>
    )
  },
)
Switch.displayName = "Switch"
