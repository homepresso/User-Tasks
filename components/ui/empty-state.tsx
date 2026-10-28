import type { LucideIcon } from 'lucide-react'
import { Button } from './button'
import Link from 'next/link'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: { label: string; href?: string; onClick?: () => void }
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--theme-surface)' }}>
        <Icon className="h-7 w-7" style={{ color: 'var(--theme-muted-text)' }} />
      </div>
      <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--theme-card-text)' }}>{title}</h3>
      <p className="text-sm max-w-xs mb-5" style={{ color: 'var(--theme-muted-text)' }}>{description}</p>
      {action && (
        action.href ? (
          <Link href={action.href}><Button size="sm">{action.label}</Button></Link>
        ) : (
          <Button size="sm" onClick={action.onClick}>{action.label}</Button>
        )
      )}
    </div>
  )
}
