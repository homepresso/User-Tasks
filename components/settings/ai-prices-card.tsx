'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PriceTableEditor } from '@/components/agents/agent-costs'
import { DEFAULT_MODEL_PRICES, PRICES_AS_OF, type ModelPrice } from '@/lib/agents/pricing'
import { saveInstanceAiPrices } from '@/app/actions/ai-prices'

/**
 * Settings → Infrastructure → AI model prices (instance admins): prices per
 * provider + model for every workspace's agent runs, over the shipped list
 * prices; a workspace can still override a model (Agents → Costs & budgets).
 */
export function AiPricesCard({ initial }: { initial: ModelPrice[] }) {
  const [prices, setPrices] = useState<ModelPrice[]>(initial)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  return (
    <section className="rounded-xl border p-4 space-y-2 bg-panel border-border" aria-label="AI model prices">
      <h2 className="text-base font-semibold">AI model prices</h2>
      <p className="text-xs text-fg-muted">
        What agent runs cost, per 1M tokens, for every workspace on this instance. These win over the shipped list prices
        (providers&apos; published prices as of {PRICES_AS_OF}, for {DEFAULT_MODEL_PRICES.length} models); a workspace can override a model for itself.
        Add your contract prices, or a price for a model with none (its runs show &ldquo;cost unknown&rdquo; until then). Past runs keep their price.
      </p>
      <PriceTableEditor value={prices} onChange={setPrices} />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={saving} onClick={async () => {
          setSaving(true); setStatus(null)
          const result = await saveInstanceAiPrices(prices)
          setStatus(result.ok ? { ok: true, message: `Saved ${result.count} price${result.count === 1 ? '' : 's'}` } : { ok: false, message: result.error })
          setSaving(false)
        }}>{saving ? 'Saving…' : 'Save prices'}</Button>
        {status && <span role="status" className="text-xs" style={{ color: status.ok ? 'var(--theme-success)' : 'var(--theme-danger)' }}>{status.message}</span>}
      </div>
    </section>
  )
}
