/**
 * AI assistants: usage records, the per-person daily message limit and the
 * workspace's monthly cost cap (server only).
 *
 * Every request to /api/assistants/chat (a message, or a confirmation that
 * continues a turn) writes one public.assistant_usage row with its tokens
 * and cost, priced with the agents' price table (lib/agents/pricing.ts —
 * workspace overrides, the instance table, the shipped list prices). A model
 * without a price is "cost unknown": it never counts towards the cap (the
 * Settings page says how many such calls there were), like agent budgets.
 *
 * Limits are checked before the model is called:
 *  - messages_per_user_per_day: requests by this person in the last 24 hours;
 *  - monthly_cost_cap: priced spend this calendar month (UTC) in the cap's
 *    currency, all capabilities and people together;
 *  - a person's Agent profile (lib/assistants/profiles.ts) may set its own
 *    messages per person per day (the caller passes the effective limits) and
 *    a monthly cost cap of the profile's use (usage rows recorded with its id
 *    in model_rule) — on top of the workspace's cap, never instead of it.
 * Per-process burst limits (lib/rate-limit) apply on top, in the route.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentUsage } from '@/lib/agent-executor'
import { formatCost, priceUsage, resolvePrice } from '@/lib/agents/pricing'
import { monthStartIso, priceLayers } from '@/lib/agents/costs'
import type { AssistantCapability, AssistantLimits } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped table */

export class AssistantLimitError extends Error {
  constructor(message: string, readonly code: 'daily_messages' | 'monthly_cost') {
    super(message)
    this.name = 'AssistantLimitError'
  }
}

export interface UsageSnapshot { messages_today: number; cost_this_month: number; currency: string; unpriced_calls: number }

export async function usageSnapshot(db: SupabaseClient, tenantId: string, userId: string | null, currency: string, now: Date = new Date()): Promise<UsageSnapshot> {
  const dayAgo = new Date(now.getTime() - 24 * 3600_000).toISOString()
  const month = monthStartIso(now)
  const messagesQuery = userId
    ? (db as any).from('assistant_usage').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('user_id', userId).gte('created_at', dayAgo)
    : (db as any).from('assistant_usage').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('created_at', dayAgo)
  const [messages, spend] = await Promise.all([
    messagesQuery,
    (db as any).from('assistant_usage').select('cost_amount, cost_currency, cost_status').eq('tenant_id', tenantId).gte('created_at', month).limit(100_000),
  ])
  let cost = 0
  let unpriced = 0
  for (const r of (spend?.data ?? []) as any[]) {
    if (r.cost_status === 'priced' && r.cost_currency === currency) cost += Number(r.cost_amount) || 0
    else if (r.cost_status !== 'priced') unpriced++
  }
  return { messages_today: Number(messages?.count) || 0, cost_this_month: Math.round(cost * 1e6) / 1e6, currency, unpriced_calls: unpriced }
}

/** Priced spend this month of one profile's requests (usage rows with its id), in `currency`. */
export async function profileCostThisMonth(db: SupabaseClient, tenantId: string, profileId: string, currency: string, now: Date = new Date()): Promise<number> {
  const { data } = await (db as any).from('assistant_usage').select('cost_amount, cost_currency, cost_status')
    .eq('tenant_id', tenantId).eq('model_rule', profileId).gte('created_at', monthStartIso(now)).limit(100_000)
  let cost = 0
  for (const r of (data ?? []) as any[]) if (r.cost_status === 'priced' && r.cost_currency === currency) cost += Number(r.cost_amount) || 0
  return Math.round(cost * 1e6) / 1e6
}

/** Throws AssistantLimitError when the person's daily messages, the workspace's monthly cost cap or their profile's cap is used up. */
export async function checkAssistantLimits(
  db: SupabaseClient, tenantId: string, userId: string,
  limits: Pick<AssistantLimits, 'messages_per_user_per_day' | 'monthly_cost_cap' | 'cost_currency'>,
  now: Date = new Date(),
  profile: { id: string; name: string; monthly_cost_cap: number | null } | null = null,
): Promise<void> {
  if (profile?.monthly_cost_cap) {
    const spent = await profileCostThisMonth(db, tenantId, profile.id, limits.cost_currency, now)
    if (spent >= profile.monthly_cost_cap) {
      throw new AssistantLimitError(`The “${profile.name}” Agent profile has reached this month's cost cap (${formatCost(profile.monthly_cost_cap, limits.cost_currency)}). An admin can raise it in Settings → Agent → Profiles.`, 'monthly_cost')
    }
  }
  if (!limits.messages_per_user_per_day && !limits.monthly_cost_cap) return
  const usage = await usageSnapshot(db, tenantId, userId, limits.cost_currency, now)
  if (limits.messages_per_user_per_day && usage.messages_today >= limits.messages_per_user_per_day) {
    throw new AssistantLimitError(`You've reached today's limit of ${limits.messages_per_user_per_day} Agent messages. Try again tomorrow.`, 'daily_messages')
  }
  if (limits.monthly_cost_cap && usage.cost_this_month >= limits.monthly_cost_cap) {
    throw new AssistantLimitError(`The workspace's Agent has reached this month's cost cap (${formatCost(limits.monthly_cost_cap, limits.cost_currency)}). An admin can raise it in Settings → Agent.`, 'monthly_cost')
  }
}

export interface UsageRecord {
  tenantId: string
  userId: string | null
  capability: AssistantCapability
  provider: string
  model: string
  /** The Agent profile (formerly model rule) that chose the model (null: the Default profile) — column added by 20261231000001. */
  modelRule?: string | null
  status: 'completed' | 'awaiting_confirmation' | 'failed' | 'cancelled'
  usage: AgentUsage
  llmCalls: number
  toolCalls: number
  /** Some call reported no usage: the cost can't be known. */
  usageMissing: boolean
  error?: string | null
}

/** The cost of a request at the prices in effect today. */
export async function priceAssistantUsage(db: SupabaseClient, tenantId: string, provider: string, model: string, usage: AgentUsage, usageMissing: boolean) {
  if (usageMissing) return { status: 'unknown' as const, amount: null, currency: null }
  try {
    const price = resolvePrice(await priceLayers(db, tenantId), provider, model)
    const cost = priceUsage(usage, price)
    return { status: cost.status, amount: cost.amount, currency: cost.currency }
  } catch {
    return { status: 'unknown' as const, amount: null, currency: null }
  }
}

/** Write the usage row (best effort: a failed write never fails the chat). */
export async function recordAssistantUsage(db: SupabaseClient, record: UsageRecord): Promise<void> {
  try {
    const cost = await priceAssistantUsage(db, record.tenantId, record.provider, record.model, record.usage, record.usageMissing || record.llmCalls === 0)
    const row: Record<string, unknown> = {
      tenant_id: record.tenantId,
      user_id: record.userId,
      capability: record.capability,
      provider: record.provider,
      model: record.model.slice(0, 200),
      status: record.status,
      llm_calls: record.llmCalls,
      tool_calls: record.toolCalls,
      prompt_tokens: record.usage.prompt_tokens,
      completion_tokens: record.usage.completion_tokens,
      total_tokens: record.usage.total_tokens,
      cost_amount: cost.amount,
      cost_currency: cost.currency,
      cost_status: cost.status,
      error: record.error ? String(record.error).slice(0, 1000) : null,
      ...(record.modelRule ? { model_rule: record.modelRule } : {}),
    }
    const { error } = await (db as any).from('assistant_usage').insert(row) ?? {}
    // Before migration 20261231000001 there is no model_rule column: record the rest.
    if (error && 'model_rule' in row && /model_rule/.test(String(error.message ?? ''))) {
      delete row.model_rule
      await (db as any).from('assistant_usage').insert(row)
    }
  } catch (error) {
    console.error('[assistants] usage record failed:', (error as Error)?.message)
  }
}
