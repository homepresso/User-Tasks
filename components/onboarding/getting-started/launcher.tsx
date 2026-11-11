'use client'

import { Rocket } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip } from '@/components/ui/tooltip'
import { sidebarItemClass, sidebarMuted } from '@/components/layout/sidebar-nav-item'
import { useOnboarding } from './onboarding-provider'
import { ProgressRing } from './progress-ring'

/**
 * The "Getting started" launcher in the side menu footer (and the phone
 * menu): the progress ("2 of 6") and a click to reopen the guide. Shown while
 * the guide applies (new workspace / new member) and hasn't been finished or
 * turned off; Help → Getting started opens it any time.
 */
export function GettingStartedLauncher({ collapsed = false, onOpen }: { collapsed?: boolean; onOpen?: () => void }) {
  const { visibility, progress, openGuide } = useOnboarding()
  if (!visibility?.launcher) return null
  const status = `${progress.done} of ${progress.total} done`
  const open = () => { onOpen?.(); openGuide() }
  const button = (
    <button
      type="button"
      onClick={open}
      aria-label={`Getting started, ${status}`}
      className={cn(sidebarItemClass, 'mb-0.5', collapsed ? 'justify-center px-0' : 'h-auto min-h-[var(--ds-nav-item-h)] py-1.5')}
      data-getting-started-launcher
      data-tour="getting-started-launcher"
    >
      {collapsed ? (
        <ProgressRing percent={progress.percent} size={22} stroke={3} showText={false} label={status} />
      ) : (
        <>
          <span className={cn('inline-flex size-4 shrink-0', sidebarMuted)} aria-hidden><Rocket className="size-4" /></span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate">Getting started</span>
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--theme-sidebar-text)_14%,transparent)]" aria-hidden>
              <span className="block h-full rounded-full bg-[color:var(--theme-sidebar-accent,var(--theme-primary))] transition-[width] duration-[var(--ds-dur-base)]" style={{ width: `${progress.percent}%` }} />
            </span>
          </span>
          <span className={cn('num shrink-0 text-2xs font-semibold', sidebarMuted)} aria-hidden>{progress.done}/{progress.total}</span>
        </>
      )}
    </button>
  )
  return collapsed ? <Tooltip content={`Getting started · ${status}`} side="right">{button}</Tooltip> : button
}
