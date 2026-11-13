'use client'

/**
 * Extension nav for the sidebar, the mobile drawer and the ⌘K Navigate
 * group: the resolved items (lib/extensions/ui resolveNav), their badges
 * (each badge is a UI data source returning { count }), and the merge of
 * extension items into the core groups by `order` (core items sit at
 * multiples of 100) with extension sections placed between core groups
 * (primary 100, Build 200, Operate 300, People 400, Govern 500).
 */

import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import type { NavEntry, NavGroup } from '@/lib/constants'
import { resolveNav, type ResolvedNav, type Resolved } from '@/lib/extensions/ui'
import type { NavItemContribution } from '@/lib/extensions/manifest'
import { loadExtensionUiData } from '@/app/actions/extensions'
import { useExtensionResolveContext } from './extensions-provider'
import { extensionLucide } from './ext-icon'

export const CORE_GROUP_ORDER: Record<string, number> = { primary: 100, build: 200, operate: 300, people: 400, govern: 500 }

export interface ShellNavItem {
  key: string
  href: string
  label: string
  icon: LucideIcon | string
  enabled: boolean
  external?: boolean
  mobile?: boolean
  badge?: { extensionId: string; source: string }
}

export interface ShellNavSection {
  /** Core group id or `ext:<extension>:<section>`. */
  id: string
  label: string
  items: ShellNavItem[]
}

export function useExtensionNav(isManager?: boolean): ResolvedNav {
  const ctx = useExtensionResolveContext(isManager)
  return useMemo(() => resolveNav(ctx), [ctx])
}

function toShell(item: Resolved<NavItemContribution>): ShellNavItem | null {
  if (!item.href) return null
  return {
    key: `ext:${item.extensionId}:${item.id}`,
    href: item.href,
    label: item.label,
    icon: extensionLucide(item.icon),
    enabled: true,
    external: 'url' in item.target,
    mobile: item.mobile,
    ...(item.badge ? { badge: { extensionId: item.extensionId, source: item.badge.source } } : {}),
  }
}

/** Core items (order = position × 100) merged with extension items by order. */
export function mergeByOrder(core: readonly ShellNavItem[], ext: ReadonlyArray<Resolved<NavItemContribution>>): ShellNavItem[] {
  if (!ext.length) return [...core]
  const ranked: Array<{ order: number; seq: number; item: ShellNavItem }> = core.map((item, i) => ({ order: (i + 1) * 100, seq: i, item }))
  ext.forEach((e, i) => {
    const item = toShell(e)
    if (item) ranked.push({ order: e.order ?? 500, seq: core.length + i, item })
  })
  return ranked.sort((a, b) => a.order - b.order || a.seq - b.seq).map((r) => r.item)
}

export function coreShellItem(entry: Pick<NavEntry, 'href' | 'label' | 'icon' | 'enabled'>): ShellNavItem {
  return { key: entry.href, href: entry.href, label: entry.label, icon: entry.icon, enabled: entry.enabled }
}

/** Core groups (already filtered for the person) plus extension items and sections, in order. */
export function mergeNavSections(coreGroups: readonly NavGroup[], nav: ResolvedNav): ShellNavSection[] {
  const byId = new Map(coreGroups.map((g) => [g.id as string, g]))
  const ranked: Array<{ order: number; section: ShellNavSection }> = []
  for (const id of ['build', 'operate', 'people', 'govern']) {
    const group = byId.get(id)
    const items = mergeByOrder((group?.items ?? []).map(coreShellItem), nav.byGroup[id] ?? [])
    if (items.length) ranked.push({ order: CORE_GROUP_ORDER[id], section: { id, label: group?.label ?? id.charAt(0).toUpperCase() + id.slice(1), items } })
  }
  for (const section of nav.sections) {
    const items = section.items.map(toShell).filter((i): i is ShellNavItem => Boolean(i))
    if (items.length) ranked.push({ order: section.order, section: { id: `ext:${section.key}`, label: section.label, items } })
  }
  return ranked.sort((a, b) => a.order - b.order).map((r) => r.section)
}

/** Badge counts of extension items, keyed by item key (refreshed every two minutes). */
export function useExtensionBadgeCounts(items: readonly ShellNavItem[]): Map<string, number> {
  const withBadges = items.filter((i) => i.badge)
  const results = useQueries({
    queries: withBadges.map((item) => ({
      queryKey: ['ext-badge', item.badge!.extensionId, item.badge!.source],
      queryFn: async () => {
        const result = await loadExtensionUiData({ extensionId: item.badge!.extensionId, source: item.badge!.source })
        if (!result.ok) return 0
        const count = Number((result.data as { count?: unknown } | null)?.count ?? 0)
        return Number.isFinite(count) ? count : 0
      },
      staleTime: 60_000,
      refetchInterval: 120_000,
    })),
  })
  return useMemo(() => new Map(withBadges.map((item, i) => [item.key, results[i]?.data ?? 0])), [withBadges, results])
}
