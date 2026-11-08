/**
 * The Agent's model rules (client-safe normalisers + the pure resolver;
 * connections are resolved server-side in lib/assistants/settings.ts).
 *
 * Since Agent profiles (lib/assistants/profiles.ts) a rule is the MODEL PART
 * of a profile: profiles reuse this shape and normaliser for their who +
 * connection + model + thinking level, and version 2 rows' rules are read as
 * model-only profiles. The description below is the version 2 behaviour.
 *
 * The workspace's provider / connection / model is the DEFAULT, used by
 * everyone. An ordered list of rules can give some people another model:
 * each rule names users, teams and roles, and a connection — the default
 * connection with another model, a saved key for any provider (encrypted in
 * assistant_settings.model_rule_keys, never returned: only its last 4), an
 * Integrations connection, or a keyless Ollama / compatible base URL.
 *
 * Resolution (resolvePersonModel), on every chat request, server-side: the
 * FIRST rule (top to bottom) that names the person, one of their teams or
 * one of their roles wins; none → the default. Rules only choose the model —
 * who may use the Agent at all is the single access list.
 *
 * Rules live in assistant_settings.capabilities.model_rules (version 2 jsonb).
 */
import { normalizeThinkingLevel, type ThinkingLevel } from '@/lib/agents/reasoning'
import { isAssistantProvider, type AssistantProvider } from './types'

export const MAX_MODEL_RULES = 20

export interface ModelRule {
  id: string
  label: string | null
  users: string[]
  teams: string[]
  roles: string[]
  /** default: the workspace's connection (another model); key: a key saved for this rule; integration: an Integrations connection. */
  connection: 'default' | 'key' | 'integration'
  provider: AssistantProvider | null
  base_url: string | null
  integration_id: string | null
  model: string
  key_last4: string | null
  last_test_status: 'ok' | 'failed' | null
  last_test_message: string | null
  /** This rule's thinking level (lib/agents/reasoning.ts); 'default' = the help group's / default card's. */
  thinking_level: ThinkingLevel
}

const ids = (v: unknown, max = 200) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? '').trim()).filter((x) => x && x.length <= 100))].slice(0, max) : [])
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export function normalizeModelRule(raw: unknown, index = 0): ModelRule | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const connection = r.connection === 'key' || r.connection === 'integration' ? r.connection : 'default'
  const id = str(r.id, 64)?.replace(/[^A-Za-z0-9_-]/g, '') || `rule_${index + 1}`
  return {
    id,
    label: str(r.label, 80),
    users: ids(r.users),
    teams: ids(r.teams),
    roles: ids(r.roles),
    connection,
    provider: connection === 'key' && isAssistantProvider(r.provider) ? r.provider : null,
    base_url: connection === 'key' ? str(r.base_url, 500) : null,
    integration_id: connection === 'integration' ? str(r.integration_id, 100) : null,
    model: str(r.model, 200) ?? '',
    key_last4: connection === 'key' ? str(r.key_last4, 8) : null,
    last_test_status: r.last_test_status === 'ok' || r.last_test_status === 'failed' ? r.last_test_status : null,
    last_test_message: str(r.last_test_message, 500),
    thinking_level: normalizeThinkingLevel(r.thinking_level),
  }
}

export function normalizeModelRules(raw: unknown): ModelRule[] {
  if (!Array.isArray(raw)) return []
  const out: ModelRule[] = []
  const seen = new Set<string>()
  raw.slice(0, MAX_MODEL_RULES).forEach((r, i) => {
    const rule = normalizeModelRule(r, i)
    if (!rule) return
    while (seen.has(rule.id)) rule.id = `${rule.id}_${i}`
    seen.add(rule.id)
    out.push(rule)
  })
  return out
}

export interface RulePerson { userId: string; roleIds: readonly string[]; teamIds: readonly string[] }

export function ruleMatches(rule: ModelRule, person: RulePerson): boolean {
  return rule.users.includes(person.userId) || rule.teams.some((t) => person.teamIds.includes(t)) || rule.roles.some((r) => person.roleIds.includes(r))
}

/** The first matching rule (top to bottom), or null for the default. */
export function matchModelRule(rules: readonly ModelRule[], person: RulePerson): ModelRule | null {
  return rules.find((rule) => ruleMatches(rule, person)) ?? null
}

/** Provider kind and model of a rule / profile's connection (pure): 'other' for an Integrations connection until resolved. */
export function choiceModel(row: { provider: AssistantProvider; model: string }, rule: Pick<ModelRule, 'connection' | 'provider' | 'model'> | null): { provider: AssistantProvider; model: string } {
  if (!rule) return { provider: row.provider, model: row.model }
  const provider = rule.connection === 'key' && rule.provider ? rule.provider : rule.connection === 'default' ? row.provider : 'other'
  return { provider, model: rule.model || (rule.connection === 'default' ? row.model : '') }
}

/** "Builders (role), Finance (team), Priya → Claude Sonnet" */
export function ruleSummary(rule: ModelRule, names: { users?: Map<string, string>; teams?: Map<string, string>; roles?: Map<string, string> } = {}): string {
  const who = [
    ...rule.users.map((u) => names.users?.get(u) ?? 'a person'),
    ...rule.teams.map((t) => `${names.teams?.get(t) ?? 'a team'} (team)`),
    ...rule.roles.map((r) => `${names.roles?.get(r) ?? 'a role'} (role)`),
  ]
  return `${who.length ? who.join(', ') : 'No one yet'} → ${rule.label || rule.model || 'default model'}`
}
