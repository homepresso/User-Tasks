'use server'

import { getSessionDbWithUser } from '@/lib/providers/db/session'
import { setInstanceSetting, invalidateInstanceSettingsCache } from '@/lib/config/instance-settings'
import { viewerCanSeeInfrastructure } from '@/lib/admin/infrastructure'
import { normalizePriceList } from '@/lib/agents/pricing'
import { INSTANCE_PRICES_SETTING } from '@/lib/agents/costs'

/*
 * Settings → Infrastructure → AI model prices: the instance's price table
 * (instance setting instance.ai_model_prices), used for every workspace's
 * agent runs unless a workspace overrides a model. Instance admins only
 * (re-checked here); written with the service role and the admin's id.
 */
export async function saveInstanceAiPrices(prices: unknown): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    const { user } = await getSessionDbWithUser()
    if (!user || !(await viewerCanSeeInfrastructure({ id: user.id, email: user.email ?? null }))) return { ok: false, error: 'Only instance administrators can change the instance prices.' }
    const parsed = normalizePriceList(prices)
    if (parsed.errors.length) return { ok: false, error: `Invalid prices: ${parsed.errors.slice(0, 3).join('; ')}` }
    await setInstanceSetting(INSTANCE_PRICES_SETTING, parsed.prices, { updatedBy: user.id })
    invalidateInstanceSettingsCache()
    return { ok: true, count: parsed.prices.length }
  } catch (error) {
    console.error('[ai-prices] save failed', error)
    return { ok: false, error: 'Could not save the instance prices.' }
  }
}
