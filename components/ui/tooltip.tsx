"use client"

import * as RadixTooltip from "@radix-ui/react-tooltip"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Kbd } from "./kbd"

/**
 * Tooltip: label (+ optional shortcut) for icon buttons and truncated text.
 * 400ms delay. Each Tooltip carries its own provider, so it works anywhere;
 * wrap a toolbar in <TooltipProvider> when you want one shared provider.
 */
export function TooltipProvider({ children, delayDuration = 400 }: { children: ReactNode; delayDuration?: number }) {
  return <RadixTooltip.Provider delayDuration={delayDuration} skipDelayDuration={300}>{children}</RadixTooltip.Provider>
}

export interface TooltipProps {
  content: ReactNode
  /** Shortcut shown after the label. */
  kbd?: ReactNode
  children: ReactNode
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  /** Renders the trigger only (no tooltip) when false. */
  enabled?: boolean
  delayDuration?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

/** Inverted surface: card text as the background, card colour as the text. */
export const tooltipContentClass =
  "ds-pop z-[1100] max-w-xs select-none rounded-md bg-fg px-2 py-1 text-xs font-medium text-panel"

export function Tooltip({ content, kbd, children, side = "top", align = "center", enabled = true, delayDuration = 400, open, onOpenChange, className }: TooltipProps) {
  if (!enabled || content == null || content === "") return <>{children}</>
  return (
    <RadixTooltip.Provider delayDuration={delayDuration} skipDelayDuration={300}>
      <RadixTooltip.Root open={open} onOpenChange={onOpenChange}>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content side={side} align={align} sideOffset={6} collisionPadding={8} className={cn(tooltipContentClass, className)}>
            <span className="inline-flex items-center gap-1.5">
              {content}
              {kbd != null && <Kbd className="border-transparent bg-transparent text-panel shadow-none">{kbd}</Kbd>}
            </span>
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}
