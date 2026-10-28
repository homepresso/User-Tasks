'use client'

import { cn } from '@/lib/utils'

interface OrgBadgeProps {
  name: string
  color?: string
  slug: string
  size?: 'sm' | 'md'
}

export function OrgBadge({ name, color, slug, size = 'sm' }: OrgBadgeProps) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md',
        'border border-gray-200 dark:border-gray-700',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]'
          : 'px-2 py-1 text-xs',
      )}
    >
      <span
        className="w-4 h-4 rounded-sm flex items-center justify-center text-[8px] font-bold text-white"
        style={{ backgroundColor: color ?? '#5F6B7A' }}
      >
        {initials}
      </span>
      <span className="text-gray-500 font-medium">
        {name}
      </span>
    </div>
  )
}
