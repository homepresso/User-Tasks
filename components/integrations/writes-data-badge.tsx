'use client'

import { AlertTriangle } from 'lucide-react'
import { WRITES_DATA_BADGE } from '@/lib/custom-references/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** "Writes data" — shown on write-kind custom references in every picker. */
export function WritesDataBadge({ className = '' }: { className?: string }) {
  return (
    <Badge tone="warning" className={cn('gap-1', className)} data-testid="writes-data-badge" aria-description="This reference changes data when it runs">
      <AlertTriangle className="size-3" aria-hidden /> {WRITES_DATA_BADGE}
    </Badge>
  )
}
