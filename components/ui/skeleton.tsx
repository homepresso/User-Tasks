'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Skeleton block with a real shimmer (.ds-skeleton in globals.css: a moving
 * gradient over the muted fill, off under reduced motion). Mirror the real
 * layout: text bars 10px tall for 13px text, 12px for 14px.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('ds-skeleton h-3', className)} {...props} />
}

/**
 * True once `delayMs` has passed while `active` stays true. Show skeletons
 * only after ~150ms so fast loads don't flash: `useDelayedFlag(isLoading)`.
 */
export function useDelayedFlag(active: boolean = true, delayMs = 150): boolean {
  // The flag remembers which `active` run it was raised for, so a new run starts hidden without a reset in the effect.
  const [shownFor, setShownFor] = useState<number | null>(null)
  const [run, setRun] = useState(0)
  const [prevActive, setPrevActive] = useState(active)
  if (prevActive !== active) {
    setPrevActive(active)
    if (active) setRun((r) => r + 1)
  }
  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => setShownFor(run), delayMs)
    return () => clearTimeout(t)
  }, [active, delayMs, run])
  return active && shownFor === run
}

/** Renders children only after the delay (loading.tsx fallbacks). */
export function Delayed({ children, delayMs = 150 }: { children: React.ReactNode; delayMs?: number }) {
  const shown = useDelayedFlag(true, delayMs)
  return shown ? <>{children}</> : null
}
