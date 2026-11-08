/**
 * The Agent: the workspace's settings row (server only).
 *
 * public.assistant_settings (migration 20261230000000) holds one row per
 * workspace. The key is encrypted with lib/secret-crypto before it is
 * stored, never selected for the browser (the column isn't even granted to
 * `authenticated`) and only decrypted here, for a provider call. Instead of a
 * key the admin may point at an existing Integrations connection (an AI
 * provider integration of the same workspace), whose config is decrypted the
 * way agents do (lib/agents/prepare.ts).
 *
 * Callers pass a service-role client and an explicit tenant id; permission
 * checks are the service's job (lib/services/assistants.ts).
 */
import type { ThinkingLevel } from '@/lib/agents/reasoning'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret } from '@/lib/secret-crypto'
import { decryptSensitiveFields } from '@/lib/secret-fields'
import { chatBodyParams, isAiProviderIntegration, resolveAgentEndpoint, type AgentProviderKind } from '@/lib/agents/provider'
import { keyHint, normalizeAgentSettings, normalizeLimits, normalizeProvider, providerDefaults, type AvailabilitySettings } from './config'
import type { AgentSettings, AssistantLimits, AssistantProvider, AssistantSettingsView } from './types'
import type { ModelRule, RulePerson } from './model-rules'
import { matchProfile, type AgentProfile, type ProfileArea } from './profiles'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows (table not in the generated types) */

export const SETTINGS_COLUMNS = 'tenant_id, provider, key_source, integration_id, base_url, model, api_key, key_last4, capabilities, limits, last_test_status, last_test_message, last_tested_at, updated_at'

export interface AssistantSettingsRow {
  tenant_id: string
  provider: AssistantProvider
  key_source: 'key' | 'integration'
  integration_id: string | null
  base_url: string | null
  model: string
  /** Ciphertext (enc:v…) or null. */
  api_key: string | null
  key_last4: string | null
  /** The Agent's switch, access list and tool groups (the `capabilities` column; either stored version, normalised). */
  agent: AgentSettings
  limits: AssistantLimits
  last_test_status: 'ok' | 'failed' | null
  last_test_message: string | null
  last_tested_at: string | null
  updated_at: string | null
}

export function normalizeRow(raw: any): AssistantSettingsRow | null {
  if (!raw || typeof raw !== 'object') return null
  return {
    tenant_id: String(raw.tenant_id ?? ''),
    provider: normalizeProvider(raw.provider),
    key_source: raw.key_source === 'integration' ? 'integration' : 'key',
    integration_id: raw.integration_id ? String(raw.integration_id) : null,
    base_url: raw.base_url ? String(raw.base_url) : null,
    model: String(raw.model ?? ''),
    api_key: raw.api_key ? String(raw.api_key) : null,
    key_last4: raw.key_last4 ? String(raw.key_last4) : null,
    agent: normalizeAgentSettings(raw.capabilities),
    limits: normalizeLimits(raw.limits),
    last_test_status: raw.last_test_status === 'ok' || raw.last_test_status === 'failed' ? raw.last_test_status : null,
    last_test_message: raw.last_test_message ?? null,
    last_tested_at: raw.last_tested_at ?? null,
    updated_at: raw.updated_at ?? null,
  }
}

/** The workspace's row (still encrypted), or null when none / the table isn't there yet. */
export async function loadAssistantSettings(db: SupabaseClient, tenantId: string): Promise<AssistantSettingsRow | null> {
  const { data, error } = await (db as any).from('assistant_settings').select(SETTINGS_COLUMNS).eq('tenant_id', tenantId).maybeSingle()
  if (error) {
    // Migration not applied yet: behave as "not configured" (nothing shows).
    if (/assistant_settings|does not exist|schema cache/i.test(String(error.message ?? ''))) return null
    throw new Error(error.message)
  }
  return normalizeRow(data)
}

/** The integration a row points at (same workspace, an AI provider), decrypted — or null. */
async function loadIntegration(db: SupabaseClient, tenantId: string, integrationId: string | null): Promise<{ id: string; type: string; config: Record<string, any> } | null> {
  if (!integrationId) return null
  const { data } = await (db as any).from('integrations').select('id, type, config, tenant_id, is_active')
    .eq('id', integrationId).eq('tenant_id', tenantId).maybeSingle()
  if (!data?.config || data.is_active === false) return null
  if (!isAiProviderIntegration({ type: data.type, config: data.config })) return null
  return { id: String(data.id), type: String(data.type ?? ''), config: decryptSensitiveFields(data.config) as Record<string, any> }
}

/** Does the row hold what a call needs (without decrypting anything)? */
export function rowLooksUsable(row: AssistantSettingsRow | null): boolean {
  if (!row) return false
  if (row.key_source === 'integration') return Boolean(row.integration_id)
  if (row.api_key) return true
  // Keyless providers need a base URL to reach.
  return (row.provider === 'ollama' || row.provider === 'other') && Boolean(row.base_url || providerDefaults(row.provider).baseUrl)
}

export function availabilitySettings(row: AssistantSettingsRow | null): AvailabilitySettings | null {
  if (!row) return null
  return { provider: row.provider, usable: rowLooksUsable(row), agent: row.agent }
}

export interface AssistantConnection {
  provider: AgentProviderKind
  model: string
  url: string
  headers: Record<string, string>
  baseUrl: string
  /** The thinking level for this request (lib/agents/reasoning.ts); absent = the provider's default. */
  thinking?: ThinkingLevel
}

export class AssistantConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'AssistantConfigError' }
}

/**
 * Endpoint, headers and model for a call. Throws AssistantConfigError when
 * the workspace's settings can't make one (no key, integration gone).
 */
export async function resolveConnection(db: SupabaseClient, row: AssistantSettingsRow): Promise<AssistantConnection> {
  if (row.key_source === 'integration') {
    const integration = await loadIntegration(db, row.tenant_id, row.integration_id)
    if (!integration) throw new AssistantConfigError('The Agent\'s Integrations connection was removed or turned off — pick another one in Settings → Agent')
    const endpoint = resolveAgentEndpoint(integration)
    if (!endpoint.apiKey && endpoint.kind !== 'ollama' && integration.config.auth_type !== 'none') {
      throw new AssistantConfigError('The chosen Integrations connection has no API key')
    }
    const model = row.model.trim() || String(integration.config.default_model ?? '') || providerDefaults(normalizeProvider(endpoint.kind)).model
    return { provider: endpoint.kind, model, url: endpoint.url, headers: endpoint.headers, baseUrl: String(integration.config.base_url ?? '') }
  }
  let key = ''
  if (row.api_key) {
    try { key = decryptSecret(row.api_key) } catch { throw new AssistantConfigError('The saved API key could not be decrypted — enter it again in Settings → Agent') }
  }
  const defaults = providerDefaults(row.provider)
  const baseUrl = (row.base_url || defaults.baseUrl || '').trim()
  if (!baseUrl) throw new AssistantConfigError('Enter the provider\'s base URL in Settings → Agent')
  if (!key && row.provider !== 'ollama' && row.provider !== 'other') throw new AssistantConfigError('No API key is saved for the Agent')
  // The integration-type map knows our provider ids, so the endpoint rules are the agents' own.
  const type = row.provider === 'anthropic' ? 'claude' : row.provider === 'gemini' ? 'google_gemini' : row.provider === 'other' ? 'openai_compatible' : row.provider
  const endpoint = resolveAgentEndpoint({ type, config: { base_url: baseUrl, auth_config: { key_value: key } } })
  const kind: AgentProviderKind = row.provider === 'other' ? endpoint.kind : row.provider
  return { provider: kind, model: row.model.trim() || defaults.model, url: endpoint.url, headers: endpoint.headers, baseUrl }
}

/* ── Profiles (formerly model rules): keys and connections ── */

/** A profile's (or version 2 rule's) connection part. */
export type ModelChoice = Pick<ModelRule, 'id' | 'connection' | 'provider' | 'base_url' | 'integration_id' | 'model' | 'key_last4'>

/**
 * The encrypted keys of the profiles ({ profile id: ciphertext }; a version 2
 * rule's profile keeps the rule's id, so its key carries over), or {} (none /
 * migration 20261231000001 not applied). Never selected for the browser.
 */
export async function loadRuleKeys(db: SupabaseClient, tenantId: string): Promise<Record<string, string>> {
  const { data, error } = await (db as any).from('assistant_settings').select('model_rule_keys').eq('tenant_id', tenantId).maybeSingle()
  if (error || !data?.model_rule_keys || typeof data.model_rule_keys !== 'object') return {}
  return data.model_rule_keys as Record<string, string>
}

/** The settings row as one profile's connection sees it (then resolveConnection does the rest). */
export function rowForRule(row: AssistantSettingsRow, rule: ModelChoice, ruleKeys: Record<string, string>): AssistantSettingsRow {
  if (rule.connection === 'default') return { ...row, model: rule.model || row.model }
  if (rule.connection === 'integration') return { ...row, key_source: 'integration', integration_id: rule.integration_id, model: rule.model }
  return { ...row, key_source: 'key', provider: rule.provider ?? row.provider, base_url: rule.base_url, model: rule.model, api_key: ruleKeys[rule.id] ?? null, key_last4: rule.key_last4 }
}

/** The connection of a person's profile (null: the Default profile's, i.e. the workspace default). */
export async function connectionForProfile(db: SupabaseClient, row: AssistantSettingsRow, profile: (ModelChoice & { name: string }) | null): Promise<AssistantConnection> {
  if (!profile) return resolveConnection(db, row)
  const keys = profile.connection === 'key' ? await loadRuleKeys(db, row.tenant_id) : {}
  const profileRow = rowForRule(row, profile, keys)
  if (profile.connection === 'key' && !profileRow.api_key && profileRow.provider !== 'ollama' && profileRow.provider !== 'other') {
    throw new AssistantConfigError(`The Agent profile “${profile.name}” has no saved key — add it in Settings → Agent → Profiles`)
  }
  return resolveConnection(db, profileRow)
}

/** The connection for one person: their profile's (first match on `area`), else the default. */
export async function resolvePersonConnection(db: SupabaseClient, row: AssistantSettingsRow, person: RulePerson, area?: ProfileArea | null): Promise<{ connection: AssistantConnection; profile: AgentProfile | null }> {
  const profile = matchProfile(row.agent.profiles, person, area)
  return { connection: await connectionForProfile(db, row, profile), profile }
}

/** The view the admin page gets: never the key, only whether one is saved and its last four characters. */
export function presentSettings(row: AssistantSettingsRow | null): AssistantSettingsView {
  const provider = row?.provider ?? 'openai'
  return {
    configured: rowLooksUsable(row),
    provider,
    key_source: row?.key_source ?? 'key',
    integration_id: row?.integration_id ?? null,
    base_url: row?.base_url ?? null,
    model: row?.model ?? '',
    key_saved: Boolean(row?.api_key),
    key_hint: row?.api_key ? keyHint(row.key_last4) : null,
    agent: row?.agent ?? normalizeAgentSettings({}),
    limits: row?.limits ?? normalizeLimits({}),
    last_test_status: row?.last_test_status ?? null,
    last_test_message: row?.last_test_message ?? null,
    last_tested_at: row?.last_tested_at ?? null,
    updated_at: row?.updated_at ?? null,
  }
}

/** A one-line request proving the key, base URL and model work (no tools). */
export async function testConnection(conn: AssistantConnection, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; message: string }> {
  const body = {
    model: conn.model,
    messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    ...chatBodyParams(conn.provider, conn.model, { maxTokens: 16, temperature: null }),
  }
  try {
    const resp = await fetchImpl(conn.url, { method: 'POST', headers: conn.headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
    if (!resp.ok) {
      const text = (await resp.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)
      const hint = resp.status === 401 || resp.status === 403 ? ' — check the API key' : resp.status === 404 ? ' — check the model and base URL' : ''
      return { ok: false, message: `The provider answered ${resp.status}${text ? `: ${text}` : ''}${hint}` }
    }
    const json = await resp.json().catch(() => null) as any
    const content = json?.choices?.[0]?.message?.content
    return { ok: true, message: `Connected — ${conn.model} answered${typeof content === 'string' && content.trim() ? ` “${content.trim().slice(0, 40)}”` : ''}` }
  } catch (error) {
    const e = error as Error
    return { ok: false, message: e?.name === 'TimeoutError' ? 'The provider did not answer within 20 seconds' : `Could not reach the provider: ${e?.message ?? 'network error'}` }
  }
}
