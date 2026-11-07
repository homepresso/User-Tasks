'use client'

import * as RadixDialog from '@radix-ui/react-dialog'
import { forwardRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { DialogHeader, overlayClass } from './dialog'

/**
 * Sheet: a right-side Dialog (480px md, 640px lg) for details, submissions,
 * run logs and create flows with more than ~3 fields. Same anatomy as Dialog:
 * use DialogBody / DialogFooter inside.
 */
export const Sheet = RadixDialog.Root
export const SheetTrigger = RadixDialog.Trigger
export const SheetClose = RadixDialog.Close

export interface SheetContentProps extends Omit<React.ComponentPropsWithoutRef<typeof RadixDialog.Content>, 'title'> {
  size?: 'md' | 'lg'
  /** bottom: a phone bottom sheet (full width, up to 85% of the screen high). */
  side?: 'right' | 'left' | 'bottom'
  title: ReactNode
  description?: ReactNode
  showClose?: boolean
}

export const SheetContent = forwardRef<HTMLDivElement, SheetContentProps>(
  ({ size = 'md', side = 'right', title, description, showClose = true, className, children, ...props }, ref) => (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={overlayClass} />
      <RadixDialog.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex max-w-full flex-col bg-elevated text-fg shadow-elev-3 outline-none',
          side === 'bottom'
            ? 'ds-sheet-bottom inset-x-0 bottom-0 max-h-[85dvh] w-full rounded-t-lg border-t border-border pb-[env(safe-area-inset-bottom)]'
            : cn('ds-sheet inset-y-0', side === 'right' ? 'right-0 border-l border-border' : 'left-0 border-r border-border', size === 'md' ? 'w-[480px]' : 'w-[640px]'),
          className,
        )}
        {...(description == null ? { 'aria-describedby': undefined } : {})}
        {...props}
      >
        <DialogHeader title={title} description={description} showClose={showClose} className="pb-1" />
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  ),
)
SheetContent.displayName = 'SheetContent'
