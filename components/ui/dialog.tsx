'use client'

import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { forwardRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { IconButton } from './icon-button'

/**
 * Dialog (§3.12) on Radix: focus trap, Esc, focus return.
 *
 *   <Dialog open={open} onOpenChange={setOpen}>
 *     <DialogContent size="md" title="Rename form" description="…">
 *       <DialogBody>…</DialogBody>
 *       <DialogFooter><Button variant="secondary">Cancel</Button><Button>Save</Button></DialogFooter>
 *     </DialogContent>
 *   </Dialog>
 *
 * Footer buttons right-aligned: secondary, then primary. Destructive buttons
 * carry the verb ("Delete form").
 */
export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger
export const DialogClose = RadixDialog.Close

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

const WIDTH: Record<DialogSize, string> = {
  sm: 'w-[min(400px,calc(100vw-32px))]',
  md: 'w-[min(560px,calc(100vw-32px))]',
  lg: 'w-[min(720px,calc(100vw-32px))]',
  xl: 'w-[min(960px,calc(100vw-32px))]',
  full: 'h-[calc(100vh-48px)] w-[calc(100vw-48px)]',
}

export const overlayClass = 'ds-overlay fixed inset-0 z-50 bg-[color:var(--theme-overlay)] backdrop-blur-[2px]'

export interface DialogContentProps extends Omit<React.ComponentPropsWithoutRef<typeof RadixDialog.Content>, 'title'> {
  size?: DialogSize
  title?: ReactNode
  description?: ReactNode
  /** Hide the visible header but keep the accessible title (pass `title` anyway). */
  hideHeader?: boolean
  /** Close button in the header (default true). */
  showClose?: boolean
}

export const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  ({ size = 'md', title, description, hideHeader = false, showClose = true, className, children, ...props }, ref) => (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className={overlayClass} />
      <RadixDialog.Content
        ref={ref}
        className={cn(
          'ds-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-48px)] [transform:translate(-50%,-50%)] flex-col overflow-hidden',
          'rounded-xl bg-elevated text-fg shadow-elev-3 outline-none',
          WIDTH[size],
          // Phones (< sm): a bottom sheet, full width, clear of the home indicator.
          'max-sm:inset-x-0 max-sm:bottom-0 max-sm:left-0 max-sm:top-auto max-sm:w-full max-sm:max-w-none max-sm:[transform:none] max-sm:max-h-[calc(100dvh-24px)] max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]',
          size === 'full' && 'max-sm:h-[calc(100dvh-24px)]',
          className,
        )}
        {...(description == null ? { 'aria-describedby': undefined } : {})}
        {...props}
      >
        {title != null && (hideHeader ? (
          <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
        ) : (
          <DialogHeader title={title} description={description} showClose={showClose} />
        ))}
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  ),
)
DialogContent.displayName = 'DialogContent'

export function DialogHeader({ title, description, showClose = true, className }: { title: ReactNode; description?: ReactNode; showClose?: boolean; className?: string }) {
  return (
    <div className={cn('flex shrink-0 items-start gap-3 px-6 pt-5 max-sm:px-4 max-sm:pt-4', className)}>
      <div className="min-w-0 flex-1">
        <RadixDialog.Title className="text-base font-semibold text-fg">{title}</RadixDialog.Title>
        {description != null && <RadixDialog.Description className="mt-1 text-ui text-fg-muted">{description}</RadixDialog.Description>}
      </div>
      {showClose && (
        <RadixDialog.Close asChild>
          <IconButton label="Close" icon={<X />} size="sm" className="-mr-2 -mt-1" noTooltip />
        </RadixDialog.Close>
      )}
    </div>
  )
}

/** Scrolling body: 16px 24px. */
export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-4 text-sm text-fg max-sm:px-4', className)} {...props} />
}

/** Footer: right-aligned actions over a subtle hairline. */
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border-subtle px-6 py-4 max-sm:px-4', className)} {...props} />
}

export const DialogTitle = RadixDialog.Title
export const DialogDescription = RadixDialog.Description
