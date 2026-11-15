'use client'

/**
 * App navigation that knows about embedded designers (lib/embed/designers.ts).
 * The designers call useAppNavigation() instead of the router for the few
 * places they move on by themselves (after creating, duplicating or deleting,
 * "Back"): in the full app it is the router; inside /embed/ it keeps the
 * person in the embed (the /embed/ equivalent with the launch parameters),
 * opens other areas in a new tab, and "leaves" through the host page
 * (Back / Done) instead of opening a library page inside the frame.
 */

import { createContext, useContext, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { embedPathFor, withEmbedParams } from './designers'

export interface EmbedNavigation {
  /** Launch parameters to carry on every in-embed link. */
  carried: Record<string, string>
  /** Leave the embed: back to the host page's return target (after the unsaved-changes check). */
  leave(reason?: 'done' | 'deleted'): void
}

const EmbedNavigationContext = createContext<EmbedNavigation | null>(null)

export function EmbedNavigationProvider({ value, children }: { value: EmbedNavigation; children: React.ReactNode }) {
  return <EmbedNavigationContext value={value}>{children}</EmbedNavigationContext>
}

/** Inside an embedded designer (/embed/workflows/…, /embed/forms/…)? */
export function useEmbedNavigation(): EmbedNavigation | null {
  return useContext(EmbedNavigationContext)
}

export interface AppNavigation {
  embedded: boolean
  /** An href for an app path: its /embed/ equivalent inside the embed (when there is one). */
  href(path: string): string
  push(path: string): void
  replace(path: string): void
  /** Done with this page: the library page in the app, the host page's return target in the embed. */
  leave(appFallback: string, reason?: 'done' | 'deleted'): void
}

export function useAppNavigation(): AppNavigation {
  const router = useRouter()
  const embed = useContext(EmbedNavigationContext)
  return useMemo<AppNavigation>(() => {
    if (!embed) {
      return {
        embedded: false,
        href: (path) => path,
        push: (path) => router.push(path),
        replace: (path) => router.replace(path),
        leave: (fallback) => router.push(fallback),
      }
    }
    const inEmbed = (path: string) => {
      const mapped = embedPathFor(path)
      return mapped ? withEmbedParams(mapped, embed.carried) : null
    }
    const go = (path: string, how: 'push' | 'replace') => {
      const mapped = inEmbed(path)
      if (mapped) router[how](mapped)
      else window.open(path, '_blank', 'noopener')
    }
    return {
      embedded: true,
      href: (path) => inEmbed(path) ?? path,
      push: (path) => go(path, 'push'),
      replace: (path) => go(path, 'replace'),
      leave: (_fallback, reason) => embed.leave(reason),
    }
  }, [embed, router])
}
