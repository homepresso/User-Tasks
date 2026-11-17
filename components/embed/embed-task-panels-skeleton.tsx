import { Skeleton } from '@/components/ui/skeleton'

/** Quiet placeholder shaped like the content (no spinner) — tiny, so the list can show it before the panels' code loads. */
export function PanelSkeleton({ lines = 3, tall = false }: { lines?: number; tall?: boolean }) {
  return (
    <div className="space-y-2 py-1" aria-hidden>
      {tall ? <Skeleton className="h-48 w-full" /> : Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={`h-3 ${['w-2/3', 'w-1/2', 'w-1/3'][i % 3]}`} />)}
    </div>
  )
}
