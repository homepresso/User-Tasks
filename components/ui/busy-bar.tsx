'use client'

import { cn } from '@/lib/utils'

/**
 * Indeterminate progress bar for multi-second operations (creating an
 * automation, provisioning, imports). Pair with a short label so the user
 * knows work is happening — never leave a several-second action silent.
 */
export function BusyBar({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)} role="status" aria-live="polite">
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'var(--theme-surface-border)' }}>
        <div
          className="h-full w-full rounded-full"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, var(--theme-primary, #17150F) 35%, var(--theme-primary, #17150F) 65%, transparent 100%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.2s linear infinite',
          }}
        />
      </div>
      {label && <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>{label}</p>}
    </div>
  )
}
