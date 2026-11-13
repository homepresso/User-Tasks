'use client'

/**
 * Home widgets contributed by extensions, rendered by core: `metric` (a
 * number with a label and optional link, as a StatCard) or `list` (rows
 * with links). Each reads a UI data source of its extension; guards
 * (permission, licence feature, setting) decide who sees which. Shown in
 * their own row under the customisable grid, sized by the manifest's width.
 */

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { StatCard } from '@/components/ui/stat-card'
import { Skeleton } from '@/components/ui/skeleton'
import { InlineNotice } from '@/components/ui/inline-notice'
import { resolveWidgets, type Resolved } from '@/lib/extensions/ui'
import type { WidgetContribution } from '@/lib/extensions/manifest'
import { loadExtensionUiData } from '@/app/actions/extensions'
import { useExtensionResolveContext } from './extensions-provider'
import { useMemo } from 'react'

function Widget({ widget }: { widget: Resolved<WidgetContribution> }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ext-widget', widget.extensionId, widget.source],
    queryFn: async () => {
      const result = await loadExtensionUiData({ extensionId: widget.extensionId, source: widget.source })
      if (!result.ok) throw new Error(result.error)
      return (result.data ?? {}) as { value?: unknown; label?: string; href?: string; items?: Array<{ title: string; href?: string; meta?: string }> }
    },
    staleTime: 60_000,
  })
  if (isLoading) return <Card padding="md"><Skeleton className="h-4 w-24" /><Skeleton className="mt-3 h-8 w-16" /></Card>
  if (error) return <Card padding="md"><p className="text-ui font-medium text-fg">{widget.title}</p><InlineNotice tone="danger" className="mt-2 text-xs">{(error as Error).message}</InlineNotice></Card>
  if (widget.render === 'metric') {
    const card = <StatCard label={widget.title} value={String(data?.value ?? '—')} hint={data?.label ?? widget.description} />
    return data?.href ? <Link href={data.href} className="block rounded-lg focus-visible:outline-2">{card}</Link> : card
  }
  const items = data?.items ?? []
  return (
    <Card padding="md" className="h-full">
      <p className="text-ui font-semibold text-fg">{widget.title}</p>
      {widget.description && <p className="text-xs text-fg-muted">{widget.description}</p>}
      {items.length === 0 ? <p className="mt-3 text-ui text-fg-muted">Nothing yet.</p> : (
        <ul className="mt-2 divide-y divide-border-subtle">
          {items.map((item, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-1.5">
              {item.href ? <Link href={item.href} className="min-w-0 truncate text-ui text-fg hover:underline">{item.title}</Link> : <span className="min-w-0 truncate text-ui text-fg">{item.title}</span>}
              {item.meta && <span className="shrink-0 text-xs text-fg-muted">{item.meta}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

const SPAN: Record<number, string> = { 1: 'md:col-span-1', 2: 'md:col-span-2', 3: 'md:col-span-3', 4: 'md:col-span-4', 5: 'md:col-span-5', 6: 'md:col-span-6', 7: 'md:col-span-7', 8: 'md:col-span-8', 9: 'md:col-span-9', 10: 'md:col-span-10', 11: 'md:col-span-11', 12: 'md:col-span-12' }

export function ExtensionWidgets() {
  const ctx = useExtensionResolveContext()
  const widgets = useMemo(() => (ctx.state.extensions.length ? resolveWidgets(ctx) : []), [ctx])
  if (!widgets.length) return null
  return (
    <section aria-label="From extensions" className="grid grid-cols-1 gap-3 md:grid-cols-12" data-extension-widgets>
      {widgets.map((w) => (
        <div key={`${w.extensionId}:${w.id}`} className={SPAN[w.size.w] ?? 'md:col-span-4'} data-extension-widget={`${w.extensionId}:${w.id}`}>
          <Widget widget={w} />
        </div>
      ))}
    </section>
  )
}
