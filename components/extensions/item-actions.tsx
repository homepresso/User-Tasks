'use client'

/**
 * Row, toolbar and bulk actions contributed by extensions for one object
 * type (task, workflow, form, data_table, data_row, report, run or an
 * extension's own type). Core lists drop these into their existing menus:
 *
 *   <ExtensionMenuItems objectType="workflow" items={[wf]} />      inside a DropdownMenuContent
 *   <ExtensionToolbarActions objectType="data_row" items={rows} /> in a toolbar / bulk bar
 *
 * Entries are filtered by permission, licence feature, setting, appliesWhen
 * and (for several items) `bulk`. An action entry runs through the action
 * host (confirmation first when the manifest asks); a link entry navigates.
 * Nothing renders in a build without extensions.
 */

import { useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { resolveItemActions, type Resolved } from '@/lib/extensions/ui'
import type { ItemActionContribution } from '@/lib/extensions/manifest'
import { useExtensionResolveContext } from './extensions-provider'
import { requestExtensionAction } from './action-host'
import { ExtIcon } from './ext-icon'

export function useItemActions(objectType: string, items: Array<Record<string, unknown>>, placement: 'menu' | 'toolbar' = 'menu'): Array<Resolved<ItemActionContribution>> {
  const ctx = useExtensionResolveContext()
  return useMemo(() => (items.length && ctx.state.extensions.length ? resolveItemActions(ctx, objectType, items, placement) : []), [ctx, objectType, items, placement])
}

function runOrOpen(action: Resolved<ItemActionContribution>, objectType: string, items: Array<Record<string, unknown>>, push: (href: string) => void) {
  if ('action' in action.target) {
    requestExtensionAction({ extensionId: action.extensionId, action: action.target.action, confirm: action.target.confirm, label: action.label, objectType, items })
  } else if (action.href) {
    if ('url' in action.target) window.open(action.href, '_blank', 'noopener,noreferrer')
    else push(action.href)
  }
}

/** Menu items for an existing DropdownMenuContent (with a separator before them). */
export function ExtensionMenuItems({ objectType, items, separator = true }: { objectType: string; items: Array<Record<string, unknown>>; separator?: boolean }) {
  const router = useRouter()
  const actions = useItemActions(objectType, items, 'menu')
  if (!actions.length) return null
  return (
    <>
      {separator && <DropdownMenuSeparator />}
      {actions.map((action) => (
        <DropdownMenuItem
          key={`${action.extensionId}:${action.id}`}
          danger={action.danger}
          icon={<ExtIcon icon={action.icon} />}
          onSelect={() => runOrOpen(action, objectType, items, router.push)}
          data-extension-action={`${action.extensionId}:${action.id}`}
        >
          {action.label}
        </DropdownMenuItem>
      ))}
    </>
  )
}

/** Toolbar / bulk-bar buttons. */
export function ExtensionToolbarActions({ objectType, items, size = 'sm' }: { objectType: string; items: Array<Record<string, unknown>>; size?: 'sm' | 'md' }) {
  const router = useRouter()
  const actions = useItemActions(objectType, items, 'toolbar')
  if (!actions.length) return null
  return (
    <>
      {actions.map((action) => !('action' in action.target) && action.href && !('url' in action.target) ? (
        <Button key={`${action.extensionId}:${action.id}`} asChild variant="secondary" size={size} leadingIcon={<ExtIcon icon={action.icon} />}>
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : (
        <Button
          key={`${action.extensionId}:${action.id}`}
          variant={action.danger ? 'danger-ghost' : 'secondary'}
          size={size}
          leadingIcon={<ExtIcon icon={action.icon} />}
          onClick={() => runOrOpen(action, objectType, items, router.push)}
          data-extension-action={`${action.extensionId}:${action.id}`}
        >
          {action.label}
        </Button>
      ))}
    </>
  )
}
