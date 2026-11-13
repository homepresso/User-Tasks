'use client'

/**
 * Extension entries for the "+ New" menu, the ⌘K palette and the user menu
 * (lib/extensions/ui resolvers with the signed-in person's permissions).
 */

import { useMemo } from 'react'
import { resolveCreateEntries, resolveNav, resolvePaletteEntries, resolveUserMenu } from '@/lib/extensions/ui'
import type { ExtensionIcon, ExtensionTarget } from '@/lib/extensions/manifest'
import { useExtensionResolveContext } from './extensions-provider'

export interface ExtensionMenuEntry {
  key: string
  extensionId: string
  label: string
  /** Palette label and search keywords. */
  paletteLabel: string
  keywords: string
  icon?: ExtensionIcon
  href: string | null
  external: boolean
  /** Set for `{ action }` targets. */
  action?: { name: string; confirm?: string }
  danger?: boolean
}

function entry(extensionId: string, id: string, label: string, target: ExtensionTarget, href: string | null, extra: Partial<ExtensionMenuEntry> = {}): ExtensionMenuEntry {
  return {
    key: `ext:${extensionId}:${id}`,
    extensionId,
    label,
    paletteLabel: extra.paletteLabel ?? label,
    keywords: extra.keywords ?? '',
    href,
    external: 'url' in target,
    ...('action' in target ? { action: { name: target.action, confirm: target.confirm } } : {}),
    ...extra,
  }
}

export function useExtensionCreateEntries(): ExtensionMenuEntry[] {
  const ctx = useExtensionResolveContext()
  return useMemo(() => resolveCreateEntries(ctx).map((e) => entry(e.extensionId, e.id, e.label, e.target, e.href, { paletteLabel: e.paletteLabel ?? `Create ${e.label.toLowerCase()}`, keywords: e.keywords.join(' '), icon: e.icon })), [ctx])
}

export function useExtensionUserMenu(): ExtensionMenuEntry[] {
  const ctx = useExtensionResolveContext()
  return useMemo(() => resolveUserMenu(ctx).map((e) => entry(e.extensionId, e.id, e.label, e.target, e.href, { icon: e.icon, danger: e.danger })), [ctx])
}

/** ⌘K: Navigate (extension nav items + navigate entries) and Actions (create + action entries). */
export function useExtensionPaletteEntries(): { navigate: ExtensionMenuEntry[]; actions: ExtensionMenuEntry[] } {
  const ctx = useExtensionResolveContext()
  return useMemo(() => {
    const nav = resolveNav(ctx)
    const navItems = [...Object.values(nav.byGroup).flat(), ...nav.sections.flatMap((s) => s.items)]
    const palette = resolvePaletteEntries(ctx)
    const navigate = [
      ...navItems.filter((i) => i.href).map((i) => entry(i.extensionId, `nav:${i.id}`, i.label, i.target, i.href, { keywords: i.extensionName })),
      ...palette.filter((p) => p.section === 'navigate').map((p) => entry(p.extensionId, `pal:${p.id}`, p.label, p.target, p.href, { keywords: p.keywords.join(' ') })),
    ]
    const actions = [
      ...resolveCreateEntries(ctx).map((e) => entry(e.extensionId, `new:${e.id}`, e.label, e.target, e.href, { paletteLabel: e.paletteLabel ?? `Create ${e.label.toLowerCase()}`, keywords: e.keywords.join(' ') })),
      ...palette.filter((p) => p.section === 'actions').map((p) => entry(p.extensionId, `pal:${p.id}`, p.label, p.target, p.href, { keywords: p.keywords.join(' ') })),
    ]
    return { navigate, actions }
  }, [ctx])
}
