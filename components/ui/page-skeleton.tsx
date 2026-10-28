'use client'

/**
 * Reusable skeleton primitives for loading.tsx files.
 * All use theme CSS variables so they match the active theme.
 */

const shimmer = 'shimmer 1.5s ease-in-out infinite'

function Bar({ w = '100%', h = 14, delay = 0, className = '' }: { w?: string | number; h?: number; delay?: number; className?: string }) {
  return (
    <div className={`rounded ${className}`} style={{
      width: typeof w === 'number' ? `${w}px` : w,
      height: h,
      backgroundColor: 'var(--theme-surface-border, #e5e7eb)',
      animation: `${shimmer}`,
      animationDelay: `${delay}s`,
    }} />
  )
}

function CardSkeleton({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border p-5 ${className}`} style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
      {children}
    </div>
  )
}

/** Page header: title bar + optional action button */
export function HeaderSkeleton({ withButton = true }: { withButton?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1.5">
        <Bar w={180} h={28} />
        <Bar w={240} h={12} delay={0.1} />
      </div>
      {withButton && <Bar w={120} h={36} delay={0.15} className="rounded-lg" />}
    </div>
  )
}

/** KPI card row */
export function KpiRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-${count} gap-3`}>
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
        <Bar w="60%" h={32} className="rounded-lg" />
        <Bar w={80} h={32} delay={0.05} className="rounded-lg" />
        <Bar w={60} h={32} delay={0.1} className="rounded-lg ml-auto" />
      </div>
      {/* Rows */}
      <div className="space-y-0">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 py-3" style={{ borderBottom: i < rows - 1 ? '1px solid var(--theme-surface-border)' : undefined }}>
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
              <Bar w={28} h={28} delay={i * 0.05} className="rounded-lg shrink-0" />
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
        <Bar w={32} h={32} className="rounded-lg" />
        <div className="space-y-1.5">
          <Bar w={200} h={24} />
          <Bar w={120} h={12} delay={0.05} />
        </div>
        <div className="ml-auto flex gap-2">
          <Bar w={80} h={32} delay={0.1} className="rounded-lg" />
          <Bar w={80} h={32} delay={0.15} className="rounded-lg" />
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
          <Bar w="100%" h={200} delay={0.1} className="rounded-lg" />
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
      <Bar w="100%" h={200} delay={0.1} className="rounded-lg" />
    </CardSkeleton>
  )
}

/** Full page skeleton composer */
export function PageSkeleton({ variant }: { variant: 'list' | 'grid' | 'detail' | 'dashboard' | 'settings' }) {
  return (
    <div className="space-y-4 page-transition">
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
                <div key={i} className="flex items-center justify-between py-2" style={{ borderBottom: i < 4 ? '1px solid var(--theme-surface-border)' : undefined }}>
                  <div className="space-y-1">
                    <Bar w={140} h={14} delay={i * 0.06} />
                    <Bar w={220} h={10} delay={i * 0.06 + 0.03} />
                  </div>
                  <Bar w={64} h={28} delay={i * 0.06 + 0.05} className="rounded-lg" />
                </div>
              ))}
            </div>
          </CardSkeleton>
        </>
      )}
    </div>
  )
}
