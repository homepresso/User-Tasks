'use client'

import { cn } from '@/lib/utils'
import { Delayed, Skeleton } from './skeleton'

/**
 * Page compositions for loading.tsx files, built on Skeleton (real shimmer).
 * PageSkeleton appears only after 150ms so fast loads don't flash.
 */

function Bar({ w = '100%', h = 14, className = '' }: { w?: string | number; h?: number; delay?: number; className?: string }) {
  return <Skeleton className={className} style={{ width: typeof w === 'number' ? `${w}px` : w, height: h }} />
}

function CardSkeleton({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border border-border bg-panel p-5', className)}>{children}</div>
}

/** Page header: title bar + optional action button */
export function HeaderSkeleton({ withButton = true }: { withButton?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1.5">
        <Bar w={180} h={28} />
        <Bar w={240} h={12} delay={0.1} />
      </div>
      {withButton && <Bar w={120} h={36} delay={0.15} className="rounded-md" />}
    </div>
  )
}

/** KPI card row */
export function KpiRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3`}>
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i}>
          <div className="space-y-3">
            <Bar w={80} h={12} delay={i * 0.08} />
            <Bar w={48} h={28} delay={i * 0.08 + 0.05} />
            <Bar w={100} h={10} delay={i * 0.08 + 0.1} />
          </div>
        </CardSkeleton>
      ))}
    </div>
  )
}

/** List/table skeleton with toolbar + rows */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <CardSkeleton>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <Bar w="60%" h={32} className="rounded-md" />
        <Bar w={80} h={32} delay={0.05} className="rounded-md" />
        <Bar w={60} h={32} delay={0.1} className="rounded-md ml-auto" />
      </div>
      {/* Rows */}
      <div className="space-y-0">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={cn('flex items-center gap-4 py-3', i < rows - 1 && 'border-b border-border-subtle')}>
            <Bar w={16} h={16} delay={i * 0.04} className="rounded shrink-0" />
            <Bar w="40%" h={14} delay={i * 0.04 + 0.02} />
            <Bar w={60} h={12} delay={i * 0.04 + 0.04} className="ml-auto" />
            <Bar w={60} h={12} delay={i * 0.04 + 0.06} />
            <Bar w={80} h={12} delay={i * 0.04 + 0.08} />
          </div>
        ))}
      </div>
    </CardSkeleton>
  )
}

/** Grid of cards */
export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i}>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Bar w={28} h={28} delay={i * 0.05} className="rounded-md shrink-0" />
              <Bar w="60%" h={14} delay={i * 0.05 + 0.03} />
            </div>
            <Bar w="90%" h={10} delay={i * 0.05 + 0.06} />
            <Bar w="70%" h={10} delay={i * 0.05 + 0.09} />
          </div>
        </CardSkeleton>
      ))}
    </div>
  )
}

/** Detail page: header + content sections */
export function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Bar w={32} h={32} className="rounded-md" />
        <div className="space-y-1.5">
          <Bar w={200} h={24} />
          <Bar w={120} h={12} delay={0.05} />
        </div>
        <div className="ml-auto flex gap-2">
          <Bar w={80} h={32} delay={0.1} className="rounded-md" />
          <Bar w={80} h={32} delay={0.15} className="rounded-md" />
        </div>
      </div>
      <CardSkeleton>
        <div className="space-y-4">
          <Bar w={140} h={16} />
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Bar w={100} h={12} delay={i * 0.05} />
              <Bar w="60%" h={12} delay={i * 0.05 + 0.03} />
            </div>
          ))}
        </div>
      </CardSkeleton>
      <CardSkeleton>
        <div className="space-y-3">
          <Bar w={120} h={16} />
          <Bar w="100%" h={200} delay={0.1} className="rounded-md" />
        </div>
      </CardSkeleton>
    </div>
  )
}

/** Chart area skeleton */
export function ChartSkeleton() {
  return (
    <CardSkeleton>
      <Bar w={160} h={14} className="mb-3" />
      <Bar w="100%" h={200} delay={0.1} className="rounded-md" />
    </CardSkeleton>
  )
}

/** Full page skeleton composer */
export function PageSkeleton({ variant }: { variant: 'list' | 'grid' | 'detail' | 'dashboard' | 'settings' }) {
  return (
    <Delayed>
    <div className="space-y-4 page-transition" aria-busy="true" aria-label="Loading">
      {variant === 'list' && (
        <>
          <HeaderSkeleton />
          <ListSkeleton />
        </>
      )}
      {variant === 'grid' && (
        <>
          <HeaderSkeleton />
          <GridSkeleton />
        </>
      )}
      {variant === 'detail' && <DetailSkeleton />}
      {variant === 'dashboard' && (
        <>
          <HeaderSkeleton withButton={false} />
          <KpiRowSkeleton />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartSkeleton />
            <ChartSkeleton />
          </div>
          <ListSkeleton rows={4} />
        </>
      )}
      {variant === 'settings' && (
        <>
          <HeaderSkeleton withButton={false} />
          <CardSkeleton>
            <div className="space-y-4">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className={cn('flex items-center justify-between py-2', i < 4 && 'border-b border-border-subtle')}>
                  <div className="space-y-1">
                    <Bar w={140} h={14} delay={i * 0.06} />
                    <Bar w={220} h={10} delay={i * 0.06 + 0.03} />
                  </div>
                  <Bar w={64} h={28} delay={i * 0.06 + 0.05} className="rounded-md" />
                </div>
              ))}
            </div>
          </CardSkeleton>
        </>
      )}
    </div>
    </Delayed>
  )
}
