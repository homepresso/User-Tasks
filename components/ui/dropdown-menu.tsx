'use client'

import * as Menu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight } from 'lucide-react'
import { forwardRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Kbd } from './kbd'

/**
 * DropdownMenu (§3.13) on Radix: elevated surface, elev-2, radius md, 4px
 * padding, min 200px; 32px items with a muted 16px icon and optional Kbd.
 *
 *   <DropdownMenu>
 *     <DropdownMenuTrigger asChild><IconButton label="More" icon={<MoreHorizontal />} /></DropdownMenuTrigger>
 *     <DropdownMenuContent align="end">
 *       <DropdownMenuItem icon={<Copy />} kbd="⌘D">Duplicate</DropdownMenuItem>
 *       <DropdownMenuSeparator />
 *       <DropdownMenuItem danger icon={<Trash2 />}>Delete</DropdownMenuItem>
 *     </DropdownMenuContent>
 *   </DropdownMenu>
 */
export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuGroup = Menu.Group
export const DropdownMenuSub = Menu.Sub
export const DropdownMenuRadioGroup = Menu.RadioGroup

/** Shared floating surface (menus, popovers, autocomplete panels). */
export const floatingSurfaceClass = 'rounded-lg bg-elevated text-fg shadow-elev-2'

export const DropdownMenuContent = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Menu.Content>>(
  ({ className, sideOffset = 4, collisionPadding = 8, ...props }, ref) => (
    <Menu.Portal>
      <Menu.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn('ds-pop z-[1000] min-w-[200px] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto p-1 outline-none', floatingSurfaceClass, className)}
        {...props}
      />
    </Menu.Portal>
  ),
)
DropdownMenuContent.displayName = 'DropdownMenuContent'

export const menuItemClass = cn(
  'relative flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-ui text-fg outline-none',
  'data-[highlighted]:bg-subtle data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
)

interface ItemExtras {
  icon?: ReactNode
  kbd?: ReactNode
  /** Danger text (destructive actions). */
  danger?: boolean
}

function ItemInner({ icon, kbd, children, danger }: ItemExtras & { children: ReactNode }) {
  return (
    <>
      {icon != null && <span className={cn('inline-flex shrink-0 [&>svg]:size-4', danger ? 'text-danger' : 'text-fg-muted')} aria-hidden="true">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {kbd != null && <Kbd className="ml-4">{kbd}</Kbd>}
    </>
  )
}

export const DropdownMenuItem = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Menu.Item> & ItemExtras>(
  ({ className, icon, kbd, danger, children, ...props }, ref) => (
    <Menu.Item ref={ref} className={cn(menuItemClass, danger && 'text-danger data-[highlighted]:bg-danger-wash', className)} {...props}>
      {props.asChild ? children : <ItemInner icon={icon} kbd={kbd} danger={danger}>{children}</ItemInner>}
    </Menu.Item>
  ),
)
DropdownMenuItem.displayName = 'DropdownMenuItem'

export const DropdownMenuCheckboxItem = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Menu.CheckboxItem>>(
  ({ className, children, ...props }, ref) => (
    <Menu.CheckboxItem ref={ref} className={cn(menuItemClass, 'pl-8', className)} {...props}>
      <Menu.ItemIndicator className="absolute left-2 inline-flex text-fg"><Check className="size-4" /></Menu.ItemIndicator>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Menu.CheckboxItem>
  ),
)
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem'

export const DropdownMenuRadioItem = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Menu.RadioItem>>(
  ({ className, children, ...props }, ref) => (
    <Menu.RadioItem ref={ref} className={cn(menuItemClass, 'pl-8', className)} {...props}>
      <Menu.ItemIndicator className="absolute left-2 inline-flex text-fg"><Check className="size-4" /></Menu.ItemIndicator>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Menu.RadioItem>
  ),
)
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem'

export function DropdownMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof Menu.Label>) {
  return <Menu.Label className={cn('px-2 pb-1 pt-1.5 text-2xs font-medium text-fg-muted', className)} {...props} />
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentPropsWithoutRef<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-border-subtle', className)} {...props} />
}

export const DropdownMenuSubTrigger = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Menu.SubTrigger> & { icon?: ReactNode }>(
  ({ className, icon, children, ...props }, ref) => (
    <Menu.SubTrigger ref={ref} className={cn(menuItemClass, 'data-[state=open]:bg-subtle', className)} {...props}>
      <ItemInner icon={icon}>{children}</ItemInner>
      <ChevronRight className="size-4 text-fg-muted" aria-hidden="true" />
    </Menu.SubTrigger>
  ),
)
DropdownMenuSubTrigger.displayName = 'DropdownMenuSubTrigger'

export const DropdownMenuSubContent = forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<typeof Menu.SubContent>>(
  ({ className, ...props }, ref) => (
    <Menu.Portal>
      <Menu.SubContent ref={ref} className={cn('ds-pop z-[1000] min-w-[180px] p-1', floatingSurfaceClass, className)} {...props} />
    </Menu.Portal>
  ),
)
DropdownMenuSubContent.displayName = 'DropdownMenuSubContent'
