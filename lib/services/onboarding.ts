/**
 * The getting-started guide on the server (lib/onboarding/model.ts has the
 * rules and the checklists):
 *
 *  - getOnboardingState: the person's audience, the items they can act on
 *    with each one's done state, their stored choices and the facts the
 *    visibility rules need (workspace age, when they joined, the workspace
 *    setting). Every read is the caller's own or a yes / no about their
 *    workspace (counts, never rows); each done check runs only for an item
 *    their permissions show.
 *  - saveOnboardingChoice: "Remind me later", "Don't show again", visited
 *    items, finished tours — users.preferences.onboarding[tenant], the
 *    caller's own row only.
 *  - the workspace setting tenants.settings.onboarding.show_to_members
 *    (default on; settings.edit changes it, audited).
 */

import { z } from 'zod'
import { audit, dbError, serviceRoleClient } from './_shared'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import {
  applicableItems, applyChoice, audienceFor, compactStored, ITEM_IDS, storedFor,
  type OnboardingAudience, type OnboardingChoice, type OnboardingItemId, type StoredOnboarding,
} from '@/lib/onboarding/model'
import { KITCHEN_SINK_NAME } from '@/lib/kitchen-sink/build'
import { DIRECTORY_CONNECTOR_KEYS } from '@/lib/directory-sync/connection'
import type { Permission } from '@/lib/permissions'
import { betaWelcomeOn } from '@/lib/onboarding/beta'
import { feedbackAvailable } from './feedback'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role client and JSON columns */

export interface OnboardingSettings { show_to_members: boolean }

export interface OnboardingState {
  audience: OnboardingAudience
  tenant_id: string
  tenant_created_at: string | null
  joined_at: string | null
  settings: OnboardingSettings
  agent_available: boolean
  /** The welcome carries the beta lines (USERTASKS_BETA; lib/onboarding/beta.ts). */
  beta: boolean
  /** "Send feedback" can be delivered on this instance. */
  feedback_available: boolean
  stored: StoredOnboarding
  /** The items this person can act on, in checklist order. */
  items: Array<{ id: OnboardingItemId; done: boolean }>
}

function actor(ctx: ServiceContext): string {
  if (!ctx.actorId) throw ServiceError.forbidden('The getting-started guide is personal: use a credential bound to a user')
  return ctx.actorId
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {}
}

export function onboardingSettingsFrom(tenantSettings: unknown): OnboardingSettings {
  const o = asObject(asObject(tenantSettings).onboarding)
  return { show_to_members: o.show_to_members !== false }
}

/* ── Done detection ── */

/** A head count; any error reads as "not done" (the guide never blocks on a check). */
async function count(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  try {
    const { count: n, error } = await q
    return error ? 0 : n ?? 0
  } catch {
    return 0
  }
}

async function rows<T>(q: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  try {
    const { data, error } = await q
    return error ? [] : data ?? []
  } catch {
    return []
  }
}

const head = { count: 'exact' as const, head: true }

export interface DoneFacts {
  db: AnySupabaseClient
  tenantId: string
  userId: string
  agentAvailable: boolean
  stored: StoredOnboarding
}

/** One item's done state (exported for the tests; each check is a count on this workspace). */
export async function detectItemDone(id: OnboardingItemId, f: DoneFacts): Promise<boolean> {
  const db = f.db as any
  const t = f.tenantId
  switch (id) {
    case 'gallery':
      return (await count(db.from('package_installs').select('id', head).eq('tenant_id', t))) > 0
    case 'theme': {
      const [tenant, themes] = await Promise.all([
        rows<{ branding: unknown }>(db.from('tenants').select('branding').eq('id', t).limit(1)),
        // The row provisioning writes is version 1 with no editor: changed = a later version or someone saved it.
        count(db.from('workspace_themes').select('tenant_id', head).eq('tenant_id', t).or('version.gt.1,updated_by.not.is.null')),
      ])
      return Boolean(asObject(tenant[0]?.branding).logo_url) || themes > 0
    }
    case 'team': {
      const [invites, members] = await Promise.all([
        count(db.from('invitations').select('id', head).eq('tenant_id', t)),
        count(db.from('user_memberships').select('user_id', head).eq('tenant_id', t).eq('is_active', true)),
      ])
      return invites > 0 || members > 1
    }
    case 'sso':
      return (await count(db.from('tenant_connectors').select('id', head).eq('tenant_id', t)
        .in('connector_key', Object.values(DIRECTORY_CONNECTOR_KEYS)).eq('is_enabled', true))) > 0
    case 'agent':
      return f.agentAvailable
    case 'build': {
      const [workflows, forms, packaged] = await Promise.all([
        rows<{ id: string; name: string | null }>(db.from('workflows').select('id, name').eq('tenant_id', t).limit(200)),
        rows<{ id: string; name: string | null }>(db.from('forms').select('id, name').eq('tenant_id', t).limit(200)),
        rows<{ local_id: string | null }>(db.from('package_install_assets').select('local_id').eq('tenant_id', t).in('asset_type', ['workflow', 'form']).limit(2000)),
      ])
      const fromPackages = new Set(packaged.map((r) => String(r.local_id)))
      return [...workflows, ...forms].some((r) => !fromPackages.has(String(r.id)) && !/^kitchen sink\b/i.test(String(r.name ?? '')))
    }
    case 'selftest':
      return (await count(db.from('workflows').select('id', head).eq('tenant_id', t).eq('name', KITCHEN_SINK_NAME))) > 0
    case 'form':
      return (await count(db.from('form_submissions').select('id', head).eq('tenant_id', t).eq('submitted_by', f.userId))) > 0
    case 'tutorials':
    case 'tasks':
    case 'meet_agent':
    case 'notifications':
      return (f.stored.visited ?? []).includes(id)
  }
}

export async function detectDone(ids: readonly OnboardingItemId[], f: DoneFacts): Promise<Partial<Record<OnboardingItemId, boolean>>> {
  const results = await Promise.all(ids.map(async (id) => [id, await detectItemDone(id, f).catch(() => false)] as const))
  return Object.fromEntries(results)
}

/* ── Reads ── */

async function agentAvailableFor(ctx: ServiceContext): Promise<boolean> {
  try {
    const { getAssistantAvailability } = await import('./assistants')
    return (await getAssistantAvailability(ctx)).agent === true
  } catch {
    return false
  }
}

/** The caller's guide in the current workspace. */
export async function getOnboardingState(ctx: ServiceContext): Promise<OnboardingState | null> {
  const me = actor(ctx)
  if (!ctx.tenantId) return null
  const db = await serviceRoleClient(ctx)
  const [tenantRes, userRes, memberRes, agentAvailable] = await Promise.all([
    (db as any).from('tenants').select('created_at, settings').eq('id', ctx.tenantId).maybeSingle(),
    (db as any).from('users').select('preferences, created_at, tenant_id').eq('id', me).maybeSingle(),
    (db as any).from('user_memberships').select('joined_at, created_at').eq('user_id', me).eq('tenant_id', ctx.tenantId).maybeSingle(),
    agentAvailableFor(ctx),
  ])
  if (tenantRes.error) throw dbError(tenantRes.error)
  if (userRes.error) throw dbError(userRes.error)
  if (!tenantRes.data || !userRes.data) return null
  const stored = storedFor(userRes.data.preferences, ctx.tenantId)
  const can = (p: Permission) => hasPerm(ctx, p)
  const audience = audienceFor(can)
  const items = applicableItems(audience, can, agentAvailable)
  const done = await detectDone(items.map((i) => i.id), { db, tenantId: ctx.tenantId, userId: me, agentAvailable, stored })
  const joinedAt = memberRes?.data?.joined_at ?? memberRes?.data?.created_at
    ?? (userRes.data.tenant_id === ctx.tenantId ? userRes.data.created_at : null) ?? null
  return {
    audience,
    tenant_id: ctx.tenantId,
    tenant_created_at: tenantRes.data.created_at ?? null,
    joined_at: joinedAt,
    settings: onboardingSettingsFrom(tenantRes.data.settings),
    agent_available: agentAvailable,
    beta: betaWelcomeOn(),
    feedback_available: feedbackAvailable(),
    stored,
    items: items.map((i) => ({ id: i.id, done: done[i.id] === true })),
  }
}

/* ── The person's choices ── */

export const onboardingChoiceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('snooze'), days: z.number().min(0).max(30).optional() }),
  z.object({ kind: z.literal('never') }),
  z.object({ kind: z.literal('resume') }),
  z.object({ kind: z.literal('visit'), item: z.enum(ITEM_IDS as unknown as [OnboardingItemId, ...OnboardingItemId[]]) }),
  z.object({ kind: z.literal('tour'), tour: z.string().regex(/^[a-z_]{1,40}$/) }),
  z.object({ kind: z.literal('complete') }),
  z.object({ kind: z.literal('welcomed') }),
])

/** Save one choice for the caller in this workspace (their own users.preferences only). */
export async function saveOnboardingChoice(ctx: ServiceContext, input: unknown, now = new Date()): Promise<StoredOnboarding> {
  const me = actor(ctx)
  const parsed = onboardingChoiceSchema.safeParse(input)
  if (!parsed.success) throw ServiceError.validation('Invalid getting-started choice')
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('users').select('preferences').eq('id', me).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('User not found')
  const prefs = asObject(data.preferences)
  const all = asObject(prefs.onboarding)
  const before = storedFor(prefs, ctx.tenantId)
  const next = compactStored(applyChoice(before, parsed.data as OnboardingChoice, now))
  if (JSON.stringify(next) === JSON.stringify(compactStored(before))) return next
  all[ctx.tenantId] = next
  const { error: updateError } = await (db as any).from('users').update({ preferences: { ...prefs, onboarding: all } }).eq('id', me)
  if (updateError) throw dbError(updateError)
  return next
}

/* ── The workspace setting ── */

export async function setOnboardingSettings(ctx: ServiceContext, input: Partial<OnboardingSettings>): Promise<OnboardingSettings> {
  requirePerm(ctx, 'settings.edit')
  if (typeof input?.show_to_members !== 'boolean') throw ServiceError.validation('show_to_members must be true or false')
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('tenants').select('id, settings').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workspace not found')
  const settings = asObject(data.settings)
  const before = onboardingSettingsFrom(settings)
  settings.onboarding = { ...asObject(settings.onboarding), show_to_members: input.show_to_members }
  const { error: updateError } = await (db as any).from('tenants').update({ settings }).eq('id', ctx.tenantId)
  if (updateError) throw dbError(updateError)
  const after = onboardingSettingsFrom(settings)
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'update',
    summary: after.show_to_members ? 'Turned on the getting-started guide for new members' : 'Turned off the getting-started guide for new members',
    diff: { 'onboarding.show_to_members': { before: before.show_to_members, after: after.show_to_members } },
  })
  return after
}
