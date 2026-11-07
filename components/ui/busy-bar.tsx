'use client'

import { cn } from '@/lib/utils'

/**
 * Indeterminate progress bar for multi-second operations (creating a
 * workflow, provisioning, imports). Pair with a short label so the user
 * knows work is happening — never leave a several-second action silent.
 */
export function BusyBar({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)} role="status" aria-live="polite">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full w-full rounded-full bg-[linear-gradient(90deg,transparent_0%,var(--theme-primary)_35%,var(--theme-primary)_65%,transparent_100%)] bg-[length:200%_100%] motion-safe:animate-[shimmer_1.2s_linear_infinite]" />
      </div>
      {label && <p className="text-xs text-fg-muted">{label}</p>}
    </div>
  )
}
