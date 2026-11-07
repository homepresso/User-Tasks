"use client"

import { forwardRef, type ReactNode } from "react"
import { Button, type ButtonProps } from "./button"
import { Tooltip } from "./tooltip"

export interface IconButtonProps extends Omit<ButtonProps, "size" | "children" | "leadingIcon" | "trailingIcon"> {
  /** Accessible name and tooltip text. Required: an icon alone says nothing to a screen reader. */
  label: string
  icon: ReactNode
  size?: "sm" | "md" | "lg"
  /** Shortcut shown in the tooltip. */
  kbd?: ReactNode
  tooltipSide?: "top" | "right" | "bottom" | "left"
  /** Hide the tooltip (the aria-label stays). */
  noTooltip?: boolean
}

const SIZE = { sm: "icon-sm", md: "icon", lg: "icon-lg" } as const

/** Toolbar / row / card icon action: a ghost square Button with an aria-label and a Tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon, size = "md", variant = "ghost", kbd, tooltipSide, noTooltip, loading, ...props }, ref) => (
    <Tooltip content={label} kbd={kbd} side={tooltipSide} enabled={!noTooltip}>
      <Button ref={ref} variant={variant} size={SIZE[size]} aria-label={label} loading={loading} {...props}>
        {loading ? null : <span className="inline-flex [&>svg]:size-[var(--btn-icon)]" aria-hidden="true">{icon}</span>}
      </Button>
    </Tooltip>
  ),
)
IconButton.displayName = "IconButton"
