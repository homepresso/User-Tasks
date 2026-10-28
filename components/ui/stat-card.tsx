import { Card } from '@/components/ui/card'

/** Small KPI tile: uppercase label over a large value (run and call-log pages). */
export function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card className="!p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: accent ?? 'var(--theme-card-text)' }}>{value}</p>
    </Card>
  )
}
