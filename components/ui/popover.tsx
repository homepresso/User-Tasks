'use client'

import { useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { FloatingLayer } from './floating-layer'
import { floatingSurfaceClass } from './dropdown-menu'

/**
 * Popover (§3.13): the menu surface with 12px padding, anchored to a trigger
 * through FloatingLayer (no extra dependency: @radix-ui/react-popover isn't
 * installed). Closes on outside click and Escape. Use for filter panels
 * (FilterButton → checkboxes), small editors and pickers.
 *
 *   <Popover trigger={(p) => <Button variant="secondary" size="sm" {...p}>Status</Button>}>…</Popover>
 */
export interface PopoverProps {
  /** Render prop: spread the props onto the trigger button. */
  trigger: (props: { ref: React.RefObject<HTMLButtonElement | null>; onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'dialog' }) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Panel width in px (default: at least 240). */
  width?: number
  className?: string
  'aria-label'?: string
}

export function Popover({ trigger, children, open: openProp, onOpenChange, width, className, ...aria }: PopoverProps) {
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const [own, setOwn] = useState(false)
  const open = openProp ?? own
  const setOpen = (next: boolean) => { if (openProp === undefined) setOwn(next); onOpenChange?.(next) }
  const close = () => setOpen(false)
  return (
    <>
      {trigger({ ref: anchorRef, onClick: () => setOpen(!open), 'aria-expanded': open, 'aria-haspopup': 'dialog' })}
      <FloatingLayer
        anchorRef={anchorRef}
        open={open}
        onDismiss={close}
        closeOnEscape
        width={width}
        minWidth={width ?? 240}
        maxHeight={480}
        role="dialog"
        aria-label={aria['aria-label']}
        className={cn('ds-pop overflow-y-auto p-3', floatingSurfaceClass, className)}
      >
        {typeof children === 'function' ? children(close) : children}
      </FloatingLayer>
    </>
  )
}
