'use client'

import { Badge, CountBadge } from '@/components/ui/badge'
import { Tabs } from '@/components/ui/tabs'

/**
 * The designer's inspector tabs (Field · Step · Header · Rules · Data ·
 * Theme · Checks): underline Tabs that never wrap — the row scrolls with
 * faded edges — with neutral counts and the accessibility score as a badge.
 * Ids are `designer-tab-<value>` (the Checks panel is labelled by its tab).
 */
export interface InspectorTab<V extends string> {
  value: V
  label: string
  /** Neutral count after the label (hidden when 0). */
  count?: number
  /** The count turns red: the tab has problems. */
  problem?: boolean
  /** Accessibility score (0–100) as a toned badge. */
  score?: number
  /** Accessible name when the visible label and badge say less ("Rules, 14 rules, with problems"). */
  srLabel?: string
}

function scoreTone(score: number) {
  return score >= 90 ? 'success' : score >= 70 ? 'warning' : 'danger'
}

export function InspectorTabs<V extends string>({ tabs, tab, onTab }: { tabs: Array<InspectorTab<V>>; tab: V; onTab: (tab: V) => void }) {
  return (
    <Tabs
      aria-label="Properties"
      idBase="designer"
      value={tab}
      onValueChange={onTab}
      className="ds-scroll-fade-x shrink-0 px-3 [&_[role=tablist]]:gap-2"
      items={tabs.map((t) => ({
        value: t.value,
        label: (
          <>
            <span aria-hidden={t.srLabel ? true : undefined}>{t.label}</span>
            {t.count ? <CountBadge count={t.count} tone={t.problem ? 'danger' : 'neutral'} aria-hidden={t.srLabel ? true : undefined} /> : null}
            {t.score != null && <Badge tone={scoreTone(t.score)} className="num" aria-hidden={t.srLabel ? true : undefined}>{t.score}</Badge>}
            {t.srLabel && <span className="sr-only">{t.srLabel}</span>}
          </>
        ),
      }))}
    />
  )
}
