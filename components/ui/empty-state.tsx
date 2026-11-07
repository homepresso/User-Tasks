import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, SearchX } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from './button'

/**
 * EmptyState (§3.10). Title states the situation ("No forms yet"); the body
 * says what it is for and the next step. Never "No data available".
 *
 * Sizes: sm (inside tables / panels), md (default), lg (first-run pages).
 * Variants: first-run (default), no-results (SearchX), error (danger tile).
 */
export interface EmptyStateAction {
  label: string
  href?: string
  onClick?: () => void
}

export interface EmptyStateProps {
  icon?: LucideIcon
  title: ReactNode
  description?: ReactNode
  /** Primary action (Button sm). */
  action?: EmptyStateAction
  /** Secondary link-style action ("Learn more"). */
  secondaryAction?: EmptyStateAction
  size?: 'sm' | 'md' | 'lg'
  variant?: 'first-run' | 'no-results' | 'error'
  className?: string
  children?: ReactNode
}

const PAD = { sm: 'py-6', md: 'py-12', lg: 'py-20' } as const

function ActionButton({ action, variant }: { action: EmptyStateAction; variant: 'primary' | 'link' }) {
  if (action.href) {
    return <Button asChild size="sm" variant={variant}><Link href={action.href}>{action.label}</Link></Button>
  }
  return <Button size="sm" variant={variant} onClick={action.onClick}>{action.label}</Button>
}

export function EmptyState({ icon, title, description, action, secondaryAction, size = 'md', variant = 'first-run', className, children }: EmptyStateProps) {
  const Icon = icon ?? (variant === 'error' ? AlertTriangle : variant === 'no-results' ? SearchX : undefined)
  return (
    <div className={cn('flex flex-col items-center justify-center px-4 text-center', PAD[size], className)} role={variant === 'error' ? 'alert' : undefined}>
      {Icon && (
        <div
          className={cn(
            'mb-3 flex size-10 items-center justify-center rounded-lg border',
            variant === 'error' ? 'border-transparent bg-danger-wash text-danger' : 'border-border bg-subtle text-fg-muted',
          )}
        >
          <Icon className="lucide-lg size-5" aria-hidden="true" />
        </div>
      )}
      <h3 className={cn('font-semibold text-fg', size === 'lg' ? 'text-base' : 'text-sm')}>{title}</h3>
      {description != null && <p className="mt-1 max-w-[44ch] text-ui text-fg-muted">{description}</p>}
      {children}
      {(action || secondaryAction) && (
        <div className="mt-4 flex items-center gap-3">
          {action && <ActionButton action={action} variant="primary" />}
          {secondaryAction && <ActionButton action={secondaryAction} variant="link" />}
        </div>
      )}
    </div>
  )
}
