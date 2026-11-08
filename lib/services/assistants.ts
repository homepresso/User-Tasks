/**
 * The Agent (Settings → Agent, the Agent panel's availability,
 * /api/assistants/chat).
 *
 *  - getAssistantSettings / updateAssistantSettings / removeAssistantKey /
 *    testAssistantConnection: assistants.manage. The key is write-only: it is
 *    encrypted before it is stored, never returned (only "•••• last4"), never
 *    audited or logged. Changes and tests are audited (object type
 *    `workspace`, metadata.kind = 'ai_assistants').
 *  - getAssistantAvailability: any signed-in member, for themselves —
 *    booleans only (lib/assistants/config.ts resolveAvailability has the
 *    rule), their profile's panel name and starters (never its instructions,
 *    model or who), plus an opaque history key (sha-256 of user + workspace)
 *    the browser keys the stored conversation by. Nothing shows unless a key
 *    is configured AND the Agent is on AND the person is allowed.
 *  - Agent profiles (lib/assistants/profiles.ts) are part of the settings:
 *    assistants.manage reads and edits them; a profile's own key is
 *    encrypted into model_rule_keys under the profile id (write-only).
 *
 * Settings rows are read and written with the service-role client and an
 * explicit tenant filter (the key column is not granted to `authenticated`).
 */
import { resolveThinkingLevel, type ThinkingGroup, type ThinkingLevel } from '@/lib/agents/reasoning'
import { createHash } from 'node:crypto'
import { assertSafeEgressUrl } from '@/lib/egress-guard'
import { encryptSecret } from '@/lib/secret-crypto'
import { isAiProviderIntegration } from '@/lib/agents/provider'
import { lastFour, mergeAgentSettings, normalizeAgentSettings, normalizeLimits, resolveAvailability, storedAgentSettings, userAllowed, type AvailabilityUser } from '@/lib/assistants/config'
import {
  AssistantConfigError, availabilitySettings, loadAssistantSettings, loadRuleKeys, presentSettings, resolveConnection, rowForRule, testConnection,
  type AssistantSettingsRow,
} from '@/lib/assistants/settings'
import { usageSnapshot } from '@/lib/assistants/limits'
import { normalizeModelRules } from '@/lib/assistants/model-rules'
import {
  MAX_PROFILE_INSTRUCTIONS, MAX_PROFILES, PROFILE_AREAS, matchProfile, normalizeProfiles, profileLimits, profilesFromModelRules, profileTools,
  type ProfileArea,
} from '@/lib/assistants/profiles'
import {
  AGENT_TOOL_GROUPS, NO_ASSISTANTS, PROVIDER_PRESETS, formAssistantSetting, isAssistantProvider,
  type AgentToolGroup, type AssistantAvailability, type AssistantLimits, type AssistantSettingsInput, type AssistantSettingsView, type ProfileInput,
} from '@/lib/assistants/types'
import { requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, SECRET_PLACEHOLDER, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped table rows */

export const ASSISTANTS_SETTINGS_PATH = '/settings/assistants'

export interface AssistantIntegrationOption { id: string; name: string; type: string }

/** AI provider integrations of the workspace (names only) for "use an existing connection". */
async function aiIntegrations(db: AnySupabaseClient, tenantId: string): Promise<AssistantIntegrationOption[]> {
  const { data } = await (db as any).from('integrations').select('id, name, type, config, is_active').eq('tenant_id', tenantId).order('name')
  return ((data ?? []) as any[])
    .filter((i) => i.is_active !== false && isAiProviderIntegration({ type: i.type, config: i.config }))
    .map((i) => ({ id: String(i.id), name: String(i.name ?? i.type), type: String(i.type ?? '') }))
}

export async function getAssistantSettings(ctx: ServiceContext): Promise<AssistantSettingsView & { integrations: AssistantIntegrationOption[] }> {
  requirePerm(ctx, 'assistants.manage')
  const db = await serviceRoleClient(ctx)
  const row = await loadAssistantSettings(db, ctx.tenantId)
  const view = presentSettings(row)
  const [usage, integrations, unpriced] = await Promise.all([
    usageSnapshot(db, ctx.tenantId, null, view.limits.cost_currency).catch(() => undefined),
    aiIntegrations(db, ctx.tenantId).catch(() => []),
    unpricedModels(db, ctx.tenantId, view).catch(() => []),
  ])
  return { ...view, ...(usage ? { usage } : {}), ...(unpriced.length ? { unpriced_models: unpriced } : {}), integrations }
}

/**
 * The configured models (the default and the model rules with their own
 * provider) that have no price: the monthly cost cap can't count their use.
 * Models reached through an Integrations connection are not checked here.
 */
async function unpricedModels(db: AnySupabaseClient, tenantId: string, view: AssistantSettingsView): Promise<string[]> {
  if (!view.configured) return []
  const { resolvePrice } = await import('@/lib/agents/pricing')
  const { priceLayers } = await import('@/lib/agents/costs')
  const { providerDefaults } = await import('@/lib/assistants/config')
  const layers = await priceLayers(db, tenantId)
  const candidates: Array<[string, string]> = []
  if (view.key_source === 'key') candidates.push([view.provider, view.model || providerDefaults(view.provider).model])
  for (const rule of view.agent.profiles) {
    if (rule.connection === 'key' && rule.provider && rule.model) candidates.push([rule.provider, rule.model])
    else if (rule.connection === 'default' && view.key_source === 'key' && rule.model) candidates.push([view.provider, rule.model])
  }
  const out = new Set<string>()
  for (const [provider, model] of candidates) if (model && !resolvePrice(layers, provider, model)) out.add(model)
  return [...out]
}

/** A base URL the admin typed: absolute http(s), no credentials / query, a host the egress guard allows. */
export async function validateBaseUrl(raw: unknown): Promise<string | null> {
  const value = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!value) return null
  if (value.length > 500) throw ServiceError.validation('base_url is too long')
  let url: URL
  try { url = new URL(value) } catch { throw ServiceError.validation('base_url must be an absolute URL, e.g. https://api.openai.com') }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw ServiceError.validation('base_url must use https:// (or http:// for a local server)')
  if (url.username || url.password || url.search || url.hash) throw ServiceError.validation('base_url cannot contain credentials, a query or a fragment')
  try {
    await assertSafeEgressUrl(value)
  } catch (error) {
    throw ServiceError.validation(`base_url is not allowed: ${(error as Error).message}${/private|loopback|local/i.test((error as Error).message) ? ' (self-hosted: set ALLOW_PRIVATE_EGRESS=true to reach a server on your network)' : ''}`)
  }
  return value
}

function newKey(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string') throw ServiceError.validation('api_key must be a string')
  const key = raw.trim()
  if (!key || key === SECRET_PLACEHOLDER) return null
  if (key.length > 1000 || /\s/.test(key)) throw ServiceError.validation('api_key is not a valid key')
  return key
}

export async function updateAssistantSettings(ctx: ServiceContext, input: AssistantSettingsInput): Promise<AssistantSettingsView> {
  requirePerm(ctx, 'assistants.manage')
  const db = await serviceRoleClient(ctx)
  const current = await loadAssistantSettings(db, ctx.tenantId)
  const patch: Record<string, any> = {}
  const changed: string[] = []

  if (input.provider !== undefined) {
    if (!isAssistantProvider(input.provider)) throw ServiceError.validation('Unknown provider')
    patch.provider = input.provider
  }
  const provider = patch.provider ?? current?.provider ?? 'openai'
  if (input.key_source !== undefined) {
    if (input.key_source !== 'key' && input.key_source !== 'integration') throw ServiceError.validation('key_source must be key or integration')
    patch.key_source = input.key_source
  }
  const keySource = patch.key_source ?? current?.key_source ?? 'key'
  if (input.integration_id !== undefined) {
    if (input.integration_id) {
      const options = await aiIntegrations(db, ctx.tenantId)
      if (!options.some((o) => o.id === input.integration_id)) throw ServiceError.validation('Pick an AI provider connection of this workspace (Integrations)')
    }
    patch.integration_id = input.integration_id || null
  }
  if (keySource === 'integration' && !(patch.integration_id ?? current?.integration_id)) throw ServiceError.validation('Pick the Integrations connection to use')
  if (input.base_url !== undefined) patch.base_url = await validateBaseUrl(input.base_url)
  if (keySource === 'key' && PROVIDER_PRESETS[provider as keyof typeof PROVIDER_PRESETS].baseUrl === 'required' && !(patch.base_url !== undefined ? patch.base_url : current?.base_url)) {
    throw ServiceError.validation(`${PROVIDER_PRESETS[provider as keyof typeof PROVIDER_PRESETS].label} needs a base URL`)
  }
  if (input.model !== undefined) {
    const model = String(input.model ?? '').trim()
    if (model.length > 200 || /[\s"'<>]/.test(model)) throw ServiceError.validation('model is not a valid model id')
    patch.model = model
  }
  const key = newKey(input.api_key)
  if (key) {
    patch.api_key = encryptSecret(key)
    patch.key_last4 = lastFour(key)
    changed.push('key')
  } else if (patch.provider && current?.provider && patch.provider !== current.provider && current.api_key && keySource === 'key') {
    // A key belongs to its provider: switching provider without a new key drops the old one.
    patch.api_key = null
    patch.key_last4 = null
    changed.push('key removed')
  }
  let ruleKeys: Record<string, string> | null = null
  if (input.agent !== undefined) {
    const { model_rules: legacyRules, ...agentInput } = input.agent
    const agentPatch: Record<string, unknown> = { ...agentInput }
    // Version 2 callers send model_rules: mapped to model-only profiles (same ids and keys).
    const profilesInput: ProfileInput[] | undefined = input.agent.profiles !== undefined ? input.agent.profiles
      : legacyRules !== undefined ? (Array.isArray(legacyRules) ? legacyRules.map((rule, i) => ({ ...profilesFromModelRules(normalizeModelRules([{ ...rule, id: rule?.id || `rule_${Date.now().toString(36)}_${i}` }]))[0], api_key: rule?.api_key })) : legacyRules as never)
      : undefined
    if (profilesInput !== undefined) {
      const prepared = await prepareProfiles(db, ctx.tenantId, current, profilesInput)
      agentPatch.profiles = prepared.profiles
      ruleKeys = prepared.keys
      if (prepared.keysChanged) changed.push('profile keys')
    }
    patch.capabilities = storedAgentSettings(mergeAgentSettings(current?.agent ?? normalizeAgentSettings({}), agentPatch))
  }
  if (input.limits !== undefined) patch.limits = normalizeLimits({ ...(current?.limits ?? {}), ...input.limits })
  for (const k of Object.keys(patch)) if (!['api_key', 'key_last4'].includes(k)) changed.push(k === 'capabilities' ? 'agent' : k)
  if (!Object.keys(patch).length) return presentSettings(current)
  // A connection change voids the last test result.
  if (['provider', 'key_source', 'integration_id', 'base_url', 'model', 'api_key'].some((k) => k in patch)) {
    patch.last_test_status = null
    patch.last_test_message = null
    patch.last_tested_at = null
  }

  const row = { tenant_id: ctx.tenantId, ...patch, updated_by: ctx.actorId }
  const { error } = await (db as any).from('assistant_settings').upsert(row, { onConflict: 'tenant_id' })
  if (error) throw dbError(error)
  if (ruleKeys) {
    const { error: keyError } = await (db as any).from('assistant_settings').update({ model_rule_keys: ruleKeys }).eq('tenant_id', ctx.tenantId)
    if (keyError) throw ServiceError.validation(/model_rule_keys/.test(String(keyError.message)) ? 'Saving keys for Agent profiles needs database migration 20261231000001 — use the default connection or an Integrations connection for now' : keyError.message)
  }
  const saved = await loadAssistantSettings(db, ctx.tenantId)
  void audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'update',
    summary: `Agent settings changed (${[...new Set(changed)].join(', ')})`,
    metadata: { kind: 'ai_assistants', changed: [...new Set(changed)], provider: saved?.provider ?? null, agent: agentSummary(saved) },
  })
  return presentSettings(saved)
}

/**
 * Profiles from the settings page, checked and with their keys: a new key is
 * encrypted into model_rule_keys under the profile id (only its last 4 kept on
 * the profile); an empty / placeholder key keeps the saved one; removed
 * profiles lose theirs.
 */
async function prepareProfiles(db: AnySupabaseClient, tenantId: string, current: AssistantSettingsRow | null, input: ProfileInput[]) {
  if (!Array.isArray(input)) throw ServiceError.validation('profiles must be a list')
  if (input.length > MAX_PROFILES) throw ServiceError.validation(`At most ${MAX_PROFILES} profiles`)
  const before = new Map((current?.agent.profiles ?? []).map((r) => [r.id, r]))
  const savedKeys = await loadRuleKeys(db as any, tenantId)
  const keys: Record<string, string> = {}
  let keysChanged = false
  const integrations = input.some((r) => r?.connection === 'integration') ? await aiIntegrations(db, tenantId) : []
  input.forEach((raw, i) => {
    if (typeof raw?.instructions === 'string' && raw.instructions.trim().length > MAX_PROFILE_INSTRUCTIONS) throw ServiceError.validation(`Profile ${i + 1}: instructions can be at most ${MAX_PROFILE_INSTRUCTIONS.toLocaleString('en')} characters`)
  })
  const rules = normalizeProfiles(input.map((r, i) => ({ ...r, id: r?.id || `profile_${Date.now().toString(36)}_${i}` })))
  for (const [i, rule] of rules.entries()) {
    const raw = input[i] ?? {}
    const where = `Profile ${i + 1} (${rule.name})`
    if (!rule.users.length && !rule.teams.length && !rule.roles.length) throw ServiceError.validation(`${where}: choose who it is for`)
    if (rule.model && (rule.model.length > 200 || /[\s"'<>]/.test(rule.model))) throw ServiceError.validation(`${where}: the model is not a valid model id`)
    if (rule.connection === 'integration' && !integrations.some((o) => o.id === rule.integration_id)) throw ServiceError.validation(`${where}: pick an AI provider connection of this workspace (Integrations)`)
    if (rule.connection === 'key') {
      if (!rule.provider) throw ServiceError.validation(`${where}: choose the provider`)
      if (raw.base_url !== undefined) rule.base_url = await validateBaseUrl(raw.base_url)
      if (PROVIDER_PRESETS[rule.provider].baseUrl === 'required' && !rule.base_url) throw ServiceError.validation(`${where}: ${PROVIDER_PRESETS[rule.provider].label} needs a base URL`)
      const prev = before.get(rule.id)
      const key = newKey(raw.api_key)
      if (key) { keys[rule.id] = encryptSecret(key); rule.key_last4 = lastFour(key); keysChanged = true }
      else if (savedKeys[rule.id] && prev?.connection === 'key' && prev.provider === rule.provider) { keys[rule.id] = savedKeys[rule.id]; rule.key_last4 = prev.key_last4 }
      else { rule.key_last4 = null; if (savedKeys[rule.id]) keysChanged = true }
      if (!keys[rule.id] && PROVIDER_PRESETS[rule.provider].keyRequired) throw ServiceError.validation(`${where}: enter the API key`)
    }
    // A connection change voids the rule's last test.
    const prev = before.get(rule.id)
    if (!prev || prev.connection !== rule.connection || prev.provider !== rule.provider || prev.model !== rule.model || prev.base_url !== rule.base_url || prev.integration_id !== rule.integration_id || keys[rule.id] !== savedKeys[rule.id]) {
      rule.last_test_status = null
      rule.last_test_message = null
    }
  }
  if (Object.keys(savedKeys).some((id) => !keys[id])) keysChanged = true
  return { profiles: rules, keys: keysChanged ? keys : null, keysChanged }
}

/** Test one profile's connection (assistants.manage). */
export async function testModelRuleConnection(ctx: ServiceContext, ruleId: string, fetchImpl?: typeof fetch): Promise<{ ok: boolean; message: string }> {
  requirePerm(ctx, 'assistants.manage')
  const db = await serviceRoleClient(ctx)
  const row = await loadAssistantSettings(db, ctx.tenantId)
  const rule = row?.agent.profiles.find((r) => r.id === ruleId)
  if (!row || !rule) throw ServiceError.notFound('Save the profile first')
  let outcome: { ok: boolean; message: string }
  try {
    const ruleRow = rowForRule(row, rule, rule.connection === 'key' ? await loadRuleKeys(db as any, ctx.tenantId) : {})
    if (ruleRow.key_source === 'key' && ruleRow.base_url) await validateBaseUrl(ruleRow.base_url)
    outcome = await testConnection(await resolveConnection(db, ruleRow), fetchImpl)
  } catch (error) {
    if (error instanceof AssistantConfigError || error instanceof ServiceError) outcome = { ok: false, message: error.message }
    else throw error
  }
  const profiles = row.agent.profiles.map((r) => (r.id === ruleId ? { ...r, last_test_status: outcome.ok ? 'ok' as const : 'failed' as const, last_test_message: outcome.message.slice(0, 500) } : r))
  await (db as any).from('assistant_settings').update({ capabilities: storedAgentSettings({ ...row.agent, profiles }) }).eq('tenant_id', ctx.tenantId)
  void audit(ctx, { objectType: 'workspace', objectId: ctx.tenantId, action: 'test', summary: `Agent profile connection test ${outcome.ok ? 'passed' : 'failed'}`, metadata: { kind: 'ai_assistants', profile: ruleId, ok: outcome.ok } })
  return outcome
}
export const testProfileConnection = testModelRuleConnection

export interface PersonPreview {
  user_id: string
  /** Can they use the Agent at all (the access list and the switch)? */
  allowed: boolean
  /** Their profile (first match, wherever it applies); null = the Default profile. */
  profile: { id: string; name: string; index: number; areas: ProfileArea[] } | null
  /** Back-compat (version 2 preview): the profile as a "rule". */
  rule: { id: string; label: string | null; index: number } | null
  source: 'profile' | 'default'
  provider: string
  model: string
  thinking_level: ThinkingLevel
  thinking_by_group: Partial<Record<ThinkingGroup, ThinkingLevel>>
  /** Help groups they get: the profile's (or the default's) switches AND their permissions. */
  help: Record<AgentToolGroup, boolean>
  /** Building help can change things (a build permission); otherwise it is read-only. */
  can_build: boolean
  limits: Pick<AssistantLimits, 'messages_per_user_per_day' | 'max_request_tokens' | 'monthly_cost_cap' | 'cost_currency'> & { profile_monthly_cost_cap: number | null }
  /** Where an area-restricted profile applies, which profile they get per area (only when it differs between areas). */
  by_area: Array<{ area: ProfileArea; profile: { id: string; name: string } | null }> | null
  has_instructions: boolean
  starters: string[]
}

/** "Who gets what": the profile, model, thinking level, help groups and limits one member gets (assistants.manage). */
export async function previewPersonModel(ctx: ServiceContext, userId: string): Promise<PersonPreview> {
  requirePerm(ctx, 'assistants.manage')
  const db = await serviceRoleClient(ctx)
  const { data: member } = await (db as any).from('user_memberships').select('user_id').eq('tenant_id', ctx.tenantId).eq('user_id', userId).maybeSingle()
  if (!member) throw ServiceError.notFound('Not a member of this workspace')
  const row = await loadAssistantSettings(db, ctx.tenantId)
  const view = presentSettings(row)
  const { memberPermissions } = await import('./members')
  const permissions = await memberPermissions({ ...ctx, supabase: db, db } as ServiceContext, userId).catch(() => new Set<string>())
  const user = await availabilityUser(db, ctx.tenantId, userId, permissions)
  const person = { userId, roleIds: user.roleIds, teamIds: user.teamIds }
  const profiles = view.agent.profiles
  const profile = matchProfile(profiles, person)
  const defaults = PROVIDER_PRESETS[view.provider]
  // The level the person gets: the profile's → (per help group) → the default card's.
  const groups = view.agent.thinking_levels ?? {}
  const thinking = (group?: ThinkingGroup) => resolveThinkingLevel({ rule: profile?.thinking_level, group: group ? groups[group] : null, base: view.agent.thinking_level })
  const byGroup = Object.fromEntries((['designer', 'form', 'task'] as const).filter((g) => groups[g]).map((g) => [g, thinking(g)])) as Partial<Record<ThinkingGroup, ThinkingLevel>>
  // Help groups exactly as a request decides them (the profile's switches, then permissions).
  const availability = resolveAvailability({ provider: view.provider, usable: true, agent: view.agent }, user, {})
  const switches = profileTools(view.agent.tools, profile)
  const help = Object.fromEntries(AGENT_TOOL_GROUPS.map((g) => [g, availability.agent && (g === 'designer' ? switches.designer : g === 'form' ? availability.form : availability[g])])) as Record<AgentToolGroup, boolean>
  const limits = profileLimits(view.limits, profile)
  const perArea = PROFILE_AREAS.map((area) => { const p = matchProfile(profiles, person, area); return { area, profile: p ? { id: p.id, name: p.name } : null } })
  const varies = new Set(perArea.map((a) => a.profile?.id ?? '')).size > 1
  const provider = !profile ? view.provider : profile.connection === 'key' ? profile.provider ?? view.provider : profile.connection === 'integration' ? 'integration' : view.provider
  const model = profile ? profile.model || view.model || defaults.defaultModel : view.model || defaults.defaultModel
  return {
    user_id: userId,
    allowed: view.agent.enabled && userAllowed(view.agent, user),
    profile: profile ? { id: profile.id, name: profile.name, index: profiles.indexOf(profile), areas: profile.areas } : null,
    rule: profile ? { id: profile.id, label: profile.name, index: profiles.indexOf(profile) } : null,
    source: profile ? 'profile' : 'default',
    provider,
    model,
    thinking_level: thinking(),
    thinking_by_group: byGroup,
    help,
    can_build: availability.designer,
    limits: { messages_per_user_per_day: limits.messages_per_user_per_day, max_request_tokens: limits.max_request_tokens, monthly_cost_cap: limits.monthly_cost_cap, cost_currency: limits.cost_currency, profile_monthly_cost_cap: profile?.limits.monthly_cost_cap ?? null },
    by_area: varies ? perArea : null,
    has_instructions: Boolean(profile?.instructions),
    starters: profile?.starters ?? [],
  }
}

function agentSummary(row: AssistantSettingsRow | null) {
  if (!row) return null
  return { enabled: row.agent.enabled, restricted: row.agent.roles.length + row.agent.teams.length > 0, tools: row.agent.tools, profiles: row.agent.profiles.map((p) => p.name) }
}

export async function removeAssistantKey(ctx: ServiceContext): Promise<AssistantSettingsView> {
  requirePerm(ctx, 'assistants.manage')
  const db = await serviceRoleClient(ctx)
  const { error } = await (db as any).from('assistant_settings').update({ api_key: null, key_last4: null, last_test_status: null, last_test_message: null, last_tested_at: null, updated_by: ctx.actorId }).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error)
  void audit(ctx, { objectType: 'workspace', objectId: ctx.tenantId, action: 'update', summary: 'Agent key removed', metadata: { kind: 'ai_assistants', changed: ['key removed'] } })
  return presentSettings(await loadAssistantSettings(db, ctx.tenantId))
}

export async function testAssistantConnection(ctx: ServiceContext, fetchImpl?: typeof fetch): Promise<{ ok: boolean; message: string }> {
  requirePerm(ctx, 'assistants.manage')
  const db = await serviceRoleClient(ctx)
  const row = await loadAssistantSettings(db, ctx.tenantId)
  if (!row) throw ServiceError.validation('Save the provider and key first')
  let outcome: { ok: boolean; message: string }
  try {
    const conn = await resolveConnection(db, row)
    if (row.key_source === 'key' && row.base_url) await validateBaseUrl(row.base_url)
    outcome = await testConnection(conn, fetchImpl)
  } catch (error) {
    if (error instanceof AssistantConfigError || error instanceof ServiceError) outcome = { ok: false, message: error.message }
    else throw error
  }
  await (db as any).from('assistant_settings').update({ last_test_status: outcome.ok ? 'ok' : 'failed', last_test_message: outcome.message.slice(0, 1000), last_tested_at: new Date().toISOString() }).eq('tenant_id', ctx.tenantId)
  void audit(ctx, { objectType: 'workspace', objectId: ctx.tenantId, action: 'test', summary: `Agent connection test ${outcome.ok ? 'passed' : 'failed'}`, metadata: { kind: 'ai_assistants', ok: outcome.ok } })
  return outcome
}

/* ── Availability ──────────────────────────────────────────────────── */

/** The person's role ids and team ids in the workspace (service client, explicit filters). */
export async function availabilityUser(db: AnySupabaseClient, tenantId: string, userId: string, permissions: ReadonlySet<string>): Promise<AvailabilityUser> {
  const [roles, memberships] = await Promise.all([
    (db as any).from('user_roles').select('role_id').eq('tenant_id', tenantId).eq('user_id', userId),
    (db as any).from('user_teams').select('team_id').eq('user_id', userId),
  ])
  const teamIds = ((memberships?.data ?? []) as any[]).map((r) => String(r.team_id))
  let tenantTeams: string[] = []
  if (teamIds.length) {
    const { data } = await (db as any).from('teams').select('id').eq('tenant_id', tenantId).in('id', teamIds)
    tenantTeams = ((data ?? []) as any[]).map((t) => String(t.id))
  }
  return { userId, permissions, roleIds: ((roles?.data ?? []) as any[]).map((r) => String(r.role_id)), teamIds: tenantTeams }
}

/** The form's own assistant setting (layout.assistant) — of a reusable form or a task's form. */
async function formSettingFor(db: AnySupabaseClient, tenantId: string, target: { formId?: string | null; taskId?: string | null }) {
  if (target.formId) {
    const { data } = await (db as any).from('forms').select('layout').eq('id', target.formId).eq('tenant_id', tenantId).maybeSingle()
    return { known: Boolean(data), setting: formAssistantSetting(data?.layout) }
  }
  if (target.taskId) {
    const { data } = await (db as any).from('tasks').select('metadata').eq('id', target.taskId).eq('tenant_id', tenantId).maybeSingle()
    return { known: Boolean(data), setting: formAssistantSetting(data?.metadata?.form_layout) }
  }
  return { known: false, setting: null }
}

/**
 * The browser's key for the person's stored conversation: sha-256 of user +
 * workspace (opaque, so neither id lands in browser storage, and a workspace
 * switch or another person on the same browser gets a different conversation).
 */
export function agentHistoryKey(userId: string, tenantId: string): string {
  return createHash('sha256').update(`usertasks-agent:v1:${userId}:${tenantId}`).digest('hex').slice(0, 32)
}

/**
 * What the signed-in person may use here (lib/assistants/types
 * AssistantAvailability). `formId` / `taskId` narrow form help to a form (its
 * own setting) or a task (its form's setting). Never throws for "not
 * configured": all false.
 */
export async function getAssistantAvailability(ctx: ServiceContext, target: { formId?: string | null; taskId?: string | null; area?: ProfileArea | null } = {}): Promise<AssistantAvailability> {
  if (!ctx.actorId || !ctx.permissions) return { ...NO_ASSISTANTS }
  const db = await serviceRoleClient(ctx)
  const row = await loadAssistantSettings(db, ctx.tenantId).catch(() => null)
  const settings = availabilitySettings(row)
  if (!settings?.usable) return { ...NO_ASSISTANTS }
  const [user, form] = await Promise.all([
    availabilityUser(db, ctx.tenantId, ctx.actorId, ctx.permissions),
    formSettingFor(db, ctx.tenantId, target),
  ])
  // The profile follows the screen's area: a task / form target is that area; otherwise the panel says.
  const area = target.taskId ? 'tasks' : target.formId ? 'forms' : target.area ?? null
  return resolveAvailability(settings, user, { formKnown: form.known, formSetting: form.setting, area })
}

/* ── Attachments ───────────────────────────────────────────────────── */

/**
 * How the signed-in person's attachments are converted (null: the Agent is
 * not available to them): whether their model takes images, and the
 * instance's OCR for images when it doesn't.
 */
export async function attachmentUploadOptions(ctx: ServiceContext): Promise<{ vision: boolean; ocr: ((bytes: Buffer) => Promise<string>) | null } | null> {
  if (!ctx.actorId || !ctx.permissions) return null
  const availability = await getAssistantAvailability(ctx)
  if (!availability.agent) return null
  const db = await serviceRoleClient(ctx)
  const row = await loadAssistantSettings(db, ctx.tenantId)
  if (!row) return null
  const { modelAcceptsImages } = await import('@/lib/assistants/engine')
  const { resolvePersonModel } = await import('@/lib/assistants/profiles')
  const user = await availabilityUser(db, ctx.tenantId, ctx.actorId, ctx.permissions)
  const resolved = resolvePersonModel(row, { userId: ctx.actorId, roleIds: user.roleIds, teamIds: user.teamIds })
  const vision = modelAcceptsImages(resolved.provider, resolved.model)
  let ocr: ((bytes: Buffer) => Promise<string>) | null = null
  if (!vision) {
    const { instanceTesseractAvailable, openOcrProvider } = await import('@/lib/documents/ocr')
    if (await instanceTesseractAvailable().catch(() => false)) {
      ocr = async (bytes) => {
        const provider = await openOcrProvider('eng')
        try { return (await provider.recognize(bytes, { languages: 'eng' })).text } finally { await provider.close?.() }
      }
    }
  }
  return { vision, ocr }
}
