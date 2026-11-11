/**
 * The Agent: pure settings normalisers and the availability rule
 * (client-safe, no I/O — lib/assistants/settings.ts loads, the service
 * gates; tests exercise these directly).
 *
 * Settings (stored in assistant_settings.capabilities):
 *   version 3  version 2 + `profiles` (lib/assistants/profiles.ts) instead of
 *              `model_rules`; the profiles' model part is mirrored into
 *              `model_rules` so an older instance mid-deploy keeps people's models
 *   version 2  { version: 2, enabled, roles, teams, tools: { form, task, designer, admin }, all_forms, model_rules }
 *              (a row saved before Admin help has no `admin` key: on by default;
 *              its model rules are read as model-only profiles — same ids, so
 *              their keys keep working — and the next save writes version 3)
 *   version 1  { form: { enabled, roles, teams, all_forms }, task: {…}, designer: {…} }
 *              — the first release's three assistants, read and mapped here
 *              (normalizeAgentSettings); the next save writes version 2.
 *
 * Mapping a version 1 row (no data migration needed):
 *   - the Agent is ON when any capability was enabled;
 *   - access: the MOST PERMISSIVE of the enabled capabilities — if any enabled
 *     one was open to everyone (no roles / teams), the Agent is open to
 *     everyone; otherwise the union of their roles and teams;
 *   - tool groups: a group stays on only if its capability was enabled (so
 *     nobody silently gains a kind of help the admin had left off) — when
 *     nothing was enabled all groups default on, ready for the switch;
 *   - Admin help (added later; the first release had no such capability)
 *     follows the building capability: on when building help was on (or
 *     when nothing was enabled), so a workspace that had left building help
 *     off doesn't gain admin changes silently;
 *   - all_forms: the form capability's own setting.
 *
 * Availability (resolveAvailability) — the Agent shows only when ALL hold:
 *   1. the workspace has a usable provider (a saved key, an integration with
 *      a key, or a keyless provider with a base URL: Ollama / compatible);
 *   2. the Agent is turned on;
 *   3. the person is allowed: both lists empty (everyone), or they hold a
 *      listed role, or they are in a listed team.
 * The person's profile (the first that names them and applies on the screen's
 * area; none → the Default profile = these settings) chooses the tool group
 * switches; then each tool group needs its switch AND the person's permissions
 * (a profile only narrows, never widens):
 *   form       forms.submit to propose values; reading the form needs only the
 *              group on and the form not opted out (layout.assistant 'off', or
 *              no 'on' when the workspace's all_forms is off);
 *   task       tasks.view_own / tasks.view_all;
 *   designer   writes need a build permission; read tools follow each tool's
 *              own view permission (lib/assistants/tools/designer.ts);
 *   admin      one of ADMIN_BASE_PERMISSIONS; every admin tool then needs its
 *              own permission (lib/assistants/tools/admin.ts).
 * A form's opt-out turns off form help on that form (and on its task) — never
 * the whole Agent.
 */
import { normalizeThinkingLevel, type ThinkingGroup, type ThinkingLevel } from '@/lib/agents/reasoning'
import {
  NO_ASSISTANTS, PROVIDER_PRESETS, isAssistantProvider,
  type AgentSettings, type AssistantAvailability, type AssistantCapability, type AssistantLimits, type AssistantProvider,
  type AgentToolGroup, type CapabilityAccess, type FormAssistantSetting,
} from './types'
import { normalizeModelRules } from './model-rules'
import { DEFAULT_DICTATION, normalizeDictation } from './dictation'
import { clientProfile, matchProfile, normalizeProfiles, profileAsModelRule, profilesFromModelRules, profileTools, type ProfileArea } from './profiles'

const ids = (value: unknown, max = 200): string[] => {
  if (!Array.isArray(value)) return []
  const out = new Set<string>()
  for (const v of value) {
    const s = String(v ?? '').trim()
    if (s && s.length <= 100) out.add(s)
    if (out.size >= max) break
  }
  return [...out]
}

const obj = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {})

function access(raw: unknown): CapabilityAccess {
  const r = obj(raw)
  return { enabled: r.enabled === true, roles: ids(r.roles), teams: ids(r.teams) }
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = { enabled: false, roles: [], teams: [], tools: { form: true, task: true, designer: true, admin: true }, all_forms: true, task_actions: true, profiles: [], thinking_level: 'default', thinking_levels: {}, dictation: { ...DEFAULT_DICTATION } }

/** Is a stored value the first release's per-capability shape? */
export function isLegacyCapabilities(raw: unknown): boolean {
  const r = obj(raw)
  if (r.version === 2 || 'enabled' in r || 'tools' in r) return false
  return ['form', 'task', 'designer'].some((k) => r[k] && typeof r[k] === 'object')
}

/** A version 1 value mapped to the Agent's settings (see the header). */
export function legacyToAgentSettings(raw: unknown): AgentSettings {
  const r = obj(raw)
  const caps = { form: access(r.form), task: access(r.task), designer: access(r.designer) }
  const enabledCaps = (['form', 'task', 'designer'] as const).filter((k) => caps[k].enabled)
  const enabled = enabledCaps.length > 0
  const openToAll = enabledCaps.some((k) => !caps[k].roles.length && !caps[k].teams.length)
  const roles = openToAll ? [] : ids(enabledCaps.flatMap((k) => caps[k].roles))
  const teams = openToAll ? [] : ids(enabledCaps.flatMap((k) => caps[k].teams))
  const tools = enabled
    ? { form: caps.form.enabled, task: caps.task.enabled, designer: caps.designer.enabled, admin: caps.designer.enabled }
    : { ...DEFAULT_AGENT_SETTINGS.tools }
  return { enabled, roles, teams, tools, all_forms: obj(r.form).all_forms !== false, task_actions: true, profiles: [], thinking_level: 'default', thinking_levels: {}, dictation: normalizeDictation(r.dictation) }
}

/** The stored value (either version) as the Agent's settings. */
export function normalizeAgentSettings(raw: unknown): AgentSettings {
  if (isLegacyCapabilities(raw)) return legacyToAgentSettings(raw)
  const r = obj(raw)
  const t = obj(r.tools)
  return {
    ...access(r),
    tools: { form: t.form !== false, task: t.task !== false, designer: t.designer !== false, admin: t.admin !== false },
    all_forms: r.all_forms !== false,
    // Absent (settings saved before task actions) = on.
    task_actions: r.task_actions !== false,
    // Version 3: profiles. Version 2: model rules read as model-only profiles (no data loss).
    profiles: Array.isArray(r.profiles) ? normalizeProfiles(r.profiles) : profilesFromModelRules(normalizeModelRules(r.model_rules)),
    // Absent (settings saved before thinking levels) = the provider's default.
    thinking_level: normalizeThinkingLevel(r.thinking_level),
    thinking_levels: normalizeGroupLevels(r.thinking_levels),
    // Absent (settings saved before dictation) = on, the browser's speech recognition.
    dictation: normalizeDictation(r.dictation),
  }
}

/** Per help group thinking levels: only set ones are kept. */
function normalizeGroupLevels(raw: unknown): Partial<Record<ThinkingGroup, ThinkingLevel>> {
  const r = obj(raw)
  const out: Partial<Record<ThinkingGroup, ThinkingLevel>> = {}
  for (const g of ['designer', 'form', 'task'] as const) { const v = normalizeThinkingLevel(r[g]); if (v !== 'default') out[g] = v }
  return out
}

/**
 * What is stored (version 2). The first release's per-capability keys are
 * written alongside (mirroring the switch, the access list and each help
 * group), so an older instance still running during a deploy reads the same
 * on / off and access instead of "all off".
 */
export function storedAgentSettings(settings: AgentSettings): Record<string, unknown> {
  const s = normalizeAgentSettings(settings)
  const legacy = (group: AssistantCapability) => ({ enabled: s.enabled && s.tools[group], roles: s.roles, teams: s.teams })
  return { version: 3, ...s, model_rules: s.profiles.map(profileAsModelRule), form: { ...legacy('form'), all_forms: s.all_forms }, task: legacy('task'), designer: legacy('designer') }
}

/** Merge a partial update into the current settings. */
export function mergeAgentSettings(current: AgentSettings, patch: unknown): AgentSettings {
  const p = obj(patch)
  return normalizeAgentSettings({
    ...current,
    ...p,
    tools: { ...current.tools, ...obj(p.tools) },
    dictation: { ...current.dictation, ...obj(p.dictation) },
  })
}

export const MAX_MESSAGES_PER_DAY = 10_000
export const MAX_MONTHLY_COST = 1_000_000
/** Token limit per request (Settings → Agent → Limits): at least this when set; 0 / blank = unlimited. */
export const MIN_REQUEST_TOKENS = 10_000
export const MAX_REQUEST_TOKENS = 100_000_000

export function normalizeLimits(raw: unknown): AssistantLimits {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const n = (v: unknown, max: number, money = false) => {
    const x = Number(v)
    if (!Number.isFinite(x) || x <= 0) return 0
    return Math.min(max, money ? Math.round(x * 100) / 100 : Math.floor(x))
  }
  const currency = String(r.cost_currency ?? 'USD').trim().toUpperCase()
  return {
    messages_per_user_per_day: n(r.messages_per_user_per_day, MAX_MESSAGES_PER_DAY),
    monthly_cost_cap: n(r.monthly_cost_cap, MAX_MONTHLY_COST, true),
    // Rows saved before this setting existed have none: unlimited.
    max_request_tokens: (() => { const v = n(r.max_request_tokens, MAX_REQUEST_TOKENS); return v ? Math.max(MIN_REQUEST_TOKENS, v) : 0 })(),
    cost_currency: /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
  }
}

export function normalizeProvider(value: unknown): AssistantProvider {
  return isAssistantProvider(value) ? value : 'openai'
}

/** "•••• abcd" for a key's last four characters. */
export function keyHint(last4: string | null | undefined): string | null {
  const s = String(last4 ?? '').trim()
  return s ? `•••• ${s}` : null
}

export function lastFour(key: string): string {
  return key.trim().slice(-4)
}

/** The minimal settings the availability rule needs. */
export interface AvailabilitySettings {
  provider: AssistantProvider
  /** A usable connection exists (key saved, integration with key, or keyless provider with base URL). */
  usable: boolean
  agent: AgentSettings
}

export interface AvailabilityUser {
  /** The person (profiles can name people); absent = only teams / roles match. */
  userId?: string
  permissions: ReadonlySet<string>
  roleIds: readonly string[]
  teamIds: readonly string[]
}

export const BUILD_PERMISSIONS = [
  'workflows.create', 'workflows.edit', 'forms.edit', 'data.create', 'data.edit_schema', 'data.manage_rows',
  'extensibility.create', 'extensibility.edit',
] as const

/**
 * Admin help shows for people who hold at least one admin permission (a
 * Manager's Invite members / View settings included); each admin tool still
 * needs its own (lib/assistants/tools/admin.ts ADMIN_TOOL_PERMISSIONS).
 */
export const ADMIN_BASE_PERMISSIONS = [
  'team.invite', 'team.remove', 'team.change_roles', 'org.manage',
  'settings.view', 'settings.edit', 'observability.view', 'assistants.manage',
] as const

/** The permission(s) a tool group's full use needs (any of them). */
export const CAPABILITY_BASE_PERMISSIONS: Record<AgentToolGroup, readonly string[]> = {
  form: ['forms.submit'],
  task: ['tasks.view_own', 'tasks.view_all'],
  designer: BUILD_PERMISSIONS,
  admin: ADMIN_BASE_PERMISSIONS,
}

export function userAllowed(rule: CapabilityAccess, user: AvailabilityUser): boolean {
  if (!rule.enabled) return false
  if (!rule.roles.length && !rule.teams.length) return true
  return rule.roles.some((r) => user.roleIds.includes(r)) || rule.teams.some((t) => user.teamIds.includes(t))
}

/** Is form help on for one form (the form's own setting, else the workspace's default)? */
export function formAllows(settings: Pick<AgentSettings, 'all_forms'>, setting: FormAssistantSetting | null): boolean {
  if (setting === 'off') return false
  if (setting === 'on') return true
  return settings.all_forms
}

export function resolveAvailability(
  settings: AvailabilitySettings | null,
  user: AvailabilityUser,
  options: { formSetting?: FormAssistantSetting | null; formKnown?: boolean; area?: ProfileArea | null } = {},
): AssistantAvailability {
  if (!settings || !settings.usable) return { ...NO_ASSISTANTS }
  const agent = settings.agent
  // Who may use the Agent at all is the access list — profiles never widen it.
  if (!userAllowed(agent, user)) return { ...NO_ASSISTANTS }
  const profile = matchProfile(agent.profiles, { userId: user.userId ?? '', roleIds: user.roleIds, teamIds: user.teamIds }, options.area)
  const tools = profileTools(agent.tools, profile)
  const has = (group: AgentToolGroup) => CAPABILITY_BASE_PERMISSIONS[group].some((p) => user.permissions.has(p))
  // A form (or a task's form) in view: its own setting decides over the default.
  const formOn = tools.form && (options.formKnown ? formAllows(agent, options.formSetting ?? null) : true)
  return {
    agent: true,
    form_read: formOn,
    form: formOn && has('form'),
    task: tools.task && has('task'),
    designer: tools.designer && has('designer'),
    admin: tools.admin && has('admin'),
    // The panel's header name and starters (never the instructions); absent = the Default profile.
    ...(profile ? { profile: clientProfile(profile) } : {}),
  }
}

/** A provider preset's defaults when the admin left a field empty. */
export function providerDefaults(provider: AssistantProvider): { baseUrl: string | null; model: string } {
  const preset = PROVIDER_PRESETS[provider]
  return { baseUrl: preset.defaultBaseUrl, model: preset.defaultModel }
}
