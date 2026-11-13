'use client'

/**
 * Detail tabs contributed by extensions (task detail first). Core renders the
 * tab and its content from a UI data source: `{ fields: [{ label, value,
 * href? }] }` as a definition list, or `{ items: [{ title, href?, meta? }] }`
 * as a list — core components only, so the tab follows the theme.
 */

import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Skeleton } from '@/components/ui/skeleton'
import { resolveDetailTabs, type Resolved } from '@/lib/extensions/ui'
import type { DetailTabContribution } from '@/lib/extensions/manifest'
import { loadExtensionUiData } from '@/app/actions/extensions'
import { useExtensionResolveContext } from './extensions-provider'

export type ExtensionTabValue = `ext:${string}`

export function extensionTabValue(tab: Pick<Resolved<DetailTabContribution>, 'extensionId' | 'id'>): ExtensionTabValue {
  return `ext:${tab.extensionId}:${tab.id}`
}

export function useExtensionDetailTabs(objectType: string, item: Record<string, unknown> | null): Array<Resolved<DetailTabContribution> & { value: ExtensionTabValue }> {
  const ctx = useExtensionResolveContext()
  return useMemo(() => (ctx.state.extensions.length && item ? resolveDetailTabs(ctx, objectType, item).map((t) => ({ ...t, value: extensionTabValue(t) })) : []), [ctx, objectType, item])
}

interface TabData {
  fields?: Array<{ label: string; value: unknown; href?: string }>
  items?: Array<{ title: string; href?: string; meta?: string }>
}

export function ExtensionDetailTab({ tab, objectType, item }: { tab: Resolved<DetailTabContribution>; objectType: string; item: Record<string, unknown> }) {
  const itemId = String(item.id ?? '')
  const { data, isLoading, error } = useQuery({
    queryKey: ['ext-tab', tab.extensionId, tab.source, objectType, itemId],
    queryFn: async () => {
      const result = await loadExtensionUiData({ extensionId: tab.extensionId, source: tab.source, objectType, item })
      if (!result.ok) throw new Error(result.error)
      return (result.data ?? {}) as TabData
    },
  })
  if (isLoading) return <div className="space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-2/3" /></div>
  if (error) return <InlineNotice tone="danger">{(error as Error).message}</InlineNotice>
  const fields = data?.fields ?? []
  const items = data?.items ?? []
  if (!fields.length && !items.length) return <p className="text-ui text-fg-muted">Nothing to show.</p>
  return (
    <Card padding="md" data-extension-tab={`${tab.extensionId}:${tab.id}`}>
      {fields.length > 0 && (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[160px_minmax(0,1fr)]">
          {fields.map((f, i) => (
            <div key={i} className="contents">
              <dt className="text-xs font-medium text-fg-muted">{f.label}</dt>
              <dd className="min-w-0 break-words text-ui text-fg">
                {f.href ? <Link href={f.href} className="text-primary-text underline-offset-4 hover:underline">{String(f.value ?? '')}</Link> : String(f.value ?? '—')}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-border-subtle">
          {items.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2">
              {it.href ? <Link href={it.href} className="min-w-0 truncate text-ui text-fg hover:underline">{it.title}</Link> : <span className="min-w-0 truncate text-ui text-fg">{it.title}</span>}
              {it.meta && <span className="shrink-0 text-xs text-fg-muted">{it.meta}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
