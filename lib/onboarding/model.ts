/**
 * The getting-started guide (components/onboarding/getting-started/*): the
 * checklists, who sees them and when, and what the person chose. Pure, so
 * the rules are unit-tested (__tests__/onboarding-model.test.ts); the server
 * side is lib/services/onboarding.ts.
 *
 * Storage: users.preferences.onboarding, keyed by workspace (like
 * home_layout), so the choice follows the person across devices and each
 * workspace keeps its own. No migration.
 *
 * Audiences:
 *  - admin  (settings.edit): the workspace checklist (Gallery, theme, team,
 *           SSO, the Agent, a first form or workflow).
 *  - member (everyone else): a short checklist (tasks, a form, the Agent,
 *           notification preferences).
 * Shown automatically to admins of a workspace created in the last
 * NEW_WINDOW_DAYS days, and to members who joined in that window when the
 * workspace setting allows it (tenants.settings.onboarding.show_to_members,
 * on by default) — until they finish it or choose "Don't show again".
 * Anyone can open it from Help → Getting started.
 */

import type { Permission } from '@/lib/permissions'

export const NEW_WINDOW_DAYS = 30
/** "Remind me later": back after this many days (the launcher stays meanwhile). */
export const REMIND_AFTER_DAYS = 1
const DAY_MS = 24 * 60 * 60 * 1000

export type OnboardingAudience = 'admin' | 'member'

export type AdminItemId = 'gallery' | 'theme' | 'team' | 'sso' | 'agent' | 'build' | 'selftest' | 'tutorials'
export type MemberItemId = 'tasks' | 'form' | 'meet_agent' | 'notifications'
export type OnboardingItemId = AdminItemId | MemberItemId

/** Icons by name (lucide), resolved in the component so this file stays server-safe. */
export type OnboardingIcon = 'gallery' | 'palette' | 'users' | 'key' | 'sparkles' | 'build' | 'flask' | 'book' | 'tasks' | 'form' | 'bell'

export interface OnboardingItemDef {
  id: OnboardingItemId
  audience: OnboardingAudience
  title: string
  description: string
  icon: OnboardingIcon
  /** The primary button: a page, or a client action. */
  action: { label: string; href?: string; run?: 'agent' | 'agent-process' | 'tour' }
  /** A second way in, only when the Agent is available ("Build from a process with Agent"). */
  agentAction?: { label: string; run: 'agent-process' }
  /** Needs ALL of these. */
  all?: readonly Permission[]
  /** Needs ANY of these. */
  any?: readonly Permission[]
  /** Only when the Agent is available to this person. */
  needsAgent?: boolean
  /** Shown under "Optional"; not counted in the progress. */
  optional?: boolean
  /** The spotlight tour (lib/onboarding/tours.ts). */
  tour?: string
  /** How "done" is detected, in words (docs, tests). */
  doneWhen: string
  /** A starter prompt for "Ask the Agent to set this up". */
  agentPrompt?: string
}

export const ADMIN_ITEMS: readonly OnboardingItemDef[] = [
  {
    id: 'agent', audience: 'admin', icon: 'sparkles',
    title: 'Set up the Agent',
    description: 'Settings → Agent: add an AI provider key, then turn it on to start using AI. It builds forms and workflows and helps everyone with their work.',
    action: { label: 'Open Agent settings', href: '/settings/assistants' },
    all: ['assistants.manage'], tour: 'agent',
    doneWhen: 'The Agent is configured, turned on and available to you.',
  },
  {
    id: 'gallery', audience: 'admin', icon: 'gallery',
    title: 'Browse the Gallery',
    description: 'Ready-made solutions for quick starts: approvals, onboarding, requests and more, installed in one click and ready to adapt.',
    action: { label: 'Open the Gallery', href: '/packages?gallery=packages' },
    all: ['packages.install'], tour: 'gallery',
    doneWhen: 'Any package is installed in the workspace.',
  },
  {
    id: 'theme', audience: 'admin', icon: 'palette',
    title: 'Make it yours: theme and logo',
    description: 'Add your logo and pick a theme, so the workspace looks like your organisation.',
    action: { label: 'Open General settings', href: '/settings?tab=general' },
    all: ['settings.edit'], tour: 'theme',
    doneWhen: 'A logo is uploaded or the workspace theme was changed from the default.',
  },
  {
    id: 'team', audience: 'admin', icon: 'users',
    title: 'Invite your team',
    description: 'Send invitations and choose each person\'s role.',
    action: { label: 'Invite people', href: '/settings/invitations' },
    all: ['team.invite'], tour: 'team',
    doneWhen: 'An invitation was sent, or the workspace has more than one member.',
  },
  {
    id: 'sso', audience: 'admin', icon: 'key',
    title: 'Set up single sign-on (SSO)',
    description: 'Connect Microsoft Entra ID, Okta, Google or LDAP so people sign in with their work account.',
    action: { label: 'Open SSO & directory', href: '/settings/sso' },
    all: ['settings.edit'], tour: 'sso',
    doneWhen: 'A directory (Entra ID, Okta, Google, LDAP or SCIM) is connected and enabled.',
    agentPrompt: 'Help me set up single sign-on and directory sync for this workspace. Ask me which identity provider we use.',
  },
  {
    id: 'build', audience: 'admin', icon: 'build',
    title: 'Build your first form or workflow',
    description: 'The form wizard makes a form, its responses table and a results page in a few steps.',
    action: { label: 'Open the form wizard', href: '/forms/wizard' },
    agentAction: { label: 'Build from a process with Agent', run: 'agent-process' },
    any: ['forms.wizard', 'forms.edit', 'workflows.create'], tour: 'build',
    doneWhen: 'A form or workflow exists that is not from a package or the self-test.',
    agentPrompt: 'I want to automate a process. Ask me a few questions about it, then plan the tables, forms and workflow to build.',
  },
  {
    id: 'selftest', audience: 'admin', icon: 'flask', optional: true,
    title: 'Run the platform self-test',
    description: 'Install the kitchen sink workflow, which runs every built-in step and checks the results.',
    action: { label: 'Open General settings', href: '/settings?tab=general' },
    all: ['settings.edit', 'workflows.create', 'workflows.activate'], tour: 'selftest',
    doneWhen: 'The kitchen sink self-test workflow is installed.',
  },
  {
    id: 'tutorials', audience: 'admin', icon: 'book', optional: true,
    title: 'Read the tutorials',
    description: 'Step-by-step guides: a form, an approval workflow, an AI agent and an integration.',
    action: { label: 'Open the tutorials', href: '/docs/tutorials' },
    doneWhen: 'You opened the tutorials from the guide.',
  },
]

export const MEMBER_ITEMS: readonly OnboardingItemDef[] = [
  {
    id: 'tasks', audience: 'member', icon: 'tasks',
    title: 'Find your tasks',
    description: 'Everything assigned to you, with what is due first.',
    action: { label: 'Open My tasks', href: '/tasks' },
    all: ['tasks.view_own'], tour: 'tasks',
    doneWhen: 'You opened My tasks.',
  },
  {
    id: 'form', audience: 'member', icon: 'form',
    title: 'Fill in a form',
    description: 'Requests and forms shared with you are in the Forms menu and under New.',
    action: { label: 'Show me where', run: 'tour' },
    all: ['forms.submit'], tour: 'form',
    doneWhen: 'You submitted a form in this workspace.',
  },
  {
    id: 'meet_agent', audience: 'member', icon: 'sparkles', needsAgent: true,
    title: 'Meet the Agent',
    description: 'Ask it about your tasks, or to fill in a form for you.',
    action: { label: 'Open the Agent', run: 'agent' },
    tour: 'meet_agent',
    doneWhen: 'You opened the Agent from the guide.',
  },
  {
    id: 'notifications', audience: 'member', icon: 'bell',
    title: 'Set your notification preferences',
    description: 'Choose which processes you follow and the hours you are available.',
    action: { label: 'Open Preferences', href: '/settings?tab=preferences' },
    tour: 'notifications',
    doneWhen: 'You opened your Preferences.',
  },
]

export const ALL_ITEMS: readonly OnboardingItemDef[] = [...ADMIN_ITEMS, ...MEMBER_ITEMS]
export const ITEM_IDS = ALL_ITEMS.map((i) => i.id) as readonly OnboardingItemId[]
export function itemDef(id: string): OnboardingItemDef | undefined { return ALL_ITEMS.find((i) => i.id === id) }

/** Items marked done by being visited (no data to detect them from). */
export const VISIT_ITEMS: readonly OnboardingItemId[] = ['tutorials', 'tasks', 'meet_agent', 'notifications']

/** Paths whose visit completes an item (the guide marks them as the person browses). */
export function visitedItemForPath(pathname: string, search = ''): OnboardingItemId | null {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (p === '/tasks') return 'tasks'
  if (p === '/settings' && new URLSearchParams(search).get('tab') === 'preferences') return 'notifications'
  if (p === '/docs/tutorials' || p.startsWith('/docs/tutorials/')) return 'tutorials'
  return null
}

/** The audience for a person: workspace admins (settings.edit) get the workspace checklist. */
export function audienceFor(can: (p: Permission) => boolean): OnboardingAudience {
  return can('settings.edit') ? 'admin' : 'member'
}

/** The items this person can act on (permission filtering; the Agent item only when it is available). */
export function applicableItems(audience: OnboardingAudience, can: (p: Permission) => boolean, agentAvailable: boolean): OnboardingItemDef[] {
  return (audience === 'admin' ? ADMIN_ITEMS : MEMBER_ITEMS).filter((item) => {
    if (item.all && !item.all.every(can)) return false
    if (item.any && !item.any.some(can)) return false
    if (item.needsAgent && !agentAvailable) return false
    return true
  })
}

export interface OnboardingProgress { done: number; total: number; complete: boolean; percent: number }

/** Progress over the required (non-optional) items. */
export function progressOf(items: readonly OnboardingItemDef[], done: Partial<Record<OnboardingItemId, boolean>>): OnboardingProgress {
  const required = items.filter((i) => !i.optional)
  const n = required.filter((i) => done[i.id]).length
  const total = required.length
  return { done: n, total, complete: total > 0 && n === total, percent: total ? Math.round((n / total) * 100) : 0 }
}

/* ── The person's choices (users.preferences.onboarding[tenantId]) ── */

export type OnboardingStatus = 'snoozed' | 'never'

export interface StoredOnboarding {
  status?: OnboardingStatus
  /** "Remind me later": when, and when it comes back. */
  snoozed_at?: string
  remind_at?: string
  /** "Don't show again". */
  never_at?: string
  /** The welcome (first screen) was seen; later opens go straight to the checklist. */
  welcomed_at?: string
  /** Every applicable item done, and the celebration shown. */
  completed_at?: string
  /** Items completed by visiting them. */
  visited?: OnboardingItemId[]
  /** Spotlight tours finished. */
  tours?: string[]
  updated_at?: string
}

const iso = (v: unknown): string | undefined => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : undefined)

/** What is stored, cleaned up (unknown keys and values dropped). */
export function parseStored(raw: unknown): StoredOnboarding {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  const out: StoredOnboarding = {}
  if (r.status === 'snoozed' || r.status === 'never') out.status = r.status
  for (const key of ['snoozed_at', 'remind_at', 'never_at', 'welcomed_at', 'completed_at', 'updated_at'] as const) {
    const v = iso(r[key])
    if (v) out[key] = v
  }
  if (Array.isArray(r.visited)) out.visited = [...new Set(r.visited.filter((v): v is OnboardingItemId => (ITEM_IDS as readonly unknown[]).includes(v)))]
  if (Array.isArray(r.tours)) out.tours = [...new Set(r.tours.filter((v): v is string => typeof v === 'string' && /^[a-z_]{1,40}$/.test(v)))].slice(0, 40)
  return out
}

/** One workspace's entry from users.preferences. */
export function storedFor(preferences: unknown, tenantId: string): StoredOnboarding {
  const all = preferences && typeof preferences === 'object' ? (preferences as Record<string, unknown>).onboarding : null
  return all && typeof all === 'object' && !Array.isArray(all) ? parseStored((all as Record<string, unknown>)[tenantId]) : {}
}

export type OnboardingChoice =
  | { kind: 'snooze'; days?: number }
  | { kind: 'never' }
  | { kind: 'resume' }
  | { kind: 'visit'; item: OnboardingItemId }
  | { kind: 'tour'; tour: string }
  | { kind: 'complete' }
  | { kind: 'welcomed' }

/** Apply a choice to what is stored (pure; `now` for the timestamps). */
export function applyChoice(stored: StoredOnboarding, choice: OnboardingChoice, now: Date): StoredOnboarding {
  const at = now.toISOString()
  const next: StoredOnboarding = { ...stored, updated_at: at }
  switch (choice.kind) {
    case 'snooze': {
      const days = Math.min(Math.max(Number.isFinite(choice.days) ? Number(choice.days) : REMIND_AFTER_DAYS, 0), 30)
      return { ...next, status: 'snoozed', snoozed_at: at, remind_at: new Date(now.getTime() + days * DAY_MS).toISOString(), never_at: undefined }
    }
    case 'never':
      return { ...next, status: 'never', never_at: at, snoozed_at: undefined, remind_at: undefined }
    case 'resume':
      return { ...next, status: undefined, never_at: undefined, snoozed_at: undefined, remind_at: undefined }
    case 'visit':
      return (stored.visited ?? []).includes(choice.item) ? stored : { ...next, visited: [...(stored.visited ?? []), choice.item] }
    case 'tour':
      return (stored.tours ?? []).includes(choice.tour) ? stored : { ...next, tours: [...(stored.tours ?? []), choice.tour] }
    case 'complete':
      return stored.completed_at ? stored : { ...next, completed_at: at }
    case 'welcomed':
      return stored.welcomed_at ? stored : { ...next, welcomed_at: at }
  }
}

/** Drop undefined keys (JSON storage). */
export function compactStored(stored: StoredOnboarding): StoredOnboarding {
  return Object.fromEntries(Object.entries(stored).filter(([, v]) => v !== undefined)) as StoredOnboarding
}

/* ── Who sees it, and when ── */

export interface VisibilityInput {
  audience: OnboardingAudience
  /** tenants.created_at. */
  tenantCreatedAt: string | null
  /** When this person joined the workspace (membership joined_at, else their account). */
  joinedAt: string | null
  /** Workspace setting: the member checklist for new members (default on). */
  showToMembers: boolean
  stored: StoredOnboarding
  progress: OnboardingProgress
  /** Dismissed in this browser session. */
  sessionDismissed: boolean
  now: Date
}

export interface Visibility {
  /** New workspace (admins) / new member with the setting on. */
  eligible: boolean
  /** Open the guide by itself now. */
  autoOpen: boolean
  /** The small "Getting started" launcher with the progress. */
  launcher: boolean
  /** Everything is done but the celebration has not been shown yet. */
  celebrate: boolean
  /** Why (tests, debugging). */
  reason: string
}

function within(at: string | null, now: Date, days: number): boolean {
  if (!at) return false
  const t = Date.parse(at)
  return Number.isFinite(t) && now.getTime() - t <= days * DAY_MS && now.getTime() - t >= -DAY_MS
}

export function isEligible(input: Pick<VisibilityInput, 'audience' | 'tenantCreatedAt' | 'joinedAt' | 'showToMembers' | 'now'>): boolean {
  if (input.audience === 'admin') return within(input.tenantCreatedAt, input.now, NEW_WINDOW_DAYS)
  return input.showToMembers && within(input.joinedAt, input.now, NEW_WINDOW_DAYS)
}

/** Whether a "Remind me later" is due. */
export function reminderDue(stored: StoredOnboarding, now: Date): boolean {
  if (stored.status !== 'snoozed') return true
  const at = stored.remind_at ? Date.parse(stored.remind_at) : NaN
  return !Number.isFinite(at) || now.getTime() >= at
}

export function decideVisibility(input: VisibilityInput): Visibility {
  const { stored, progress, now } = input
  const eligible = isEligible(input)
  const none = (reason: string): Visibility => ({ eligible, autoOpen: false, launcher: false, celebrate: false, reason })
  if (!eligible) return none(input.audience === 'admin' ? 'not a new workspace' : input.showToMembers ? 'not a new member' : 'turned off for members')
  if (stored.status === 'never') return none('never show again')
  if (stored.completed_at) return none('completed')
  if (progress.complete) return { eligible, autoOpen: !input.sessionDismissed, launcher: true, celebrate: true, reason: 'all done: celebrate' }
  if (input.sessionDismissed) return { eligible, autoOpen: false, launcher: true, celebrate: false, reason: 'dismissed this session' }
  if (!reminderDue(stored, now)) return { eligible, autoOpen: false, launcher: true, celebrate: false, reason: 'saved for later' }
  return { eligible, autoOpen: true, launcher: true, celebrate: false, reason: stored.status === 'snoozed' ? 'reminder due' : 'new' }
}

/** sessionStorage key for "Dismiss" (this browser session only). */
export function dismissKey(userId: string, tenantId: string): string {
  return `usertasks.onboarding.dismissed.${userId}.${tenantId}`
}

/* ── The welcome (the first screen) ── */

export interface WelcomeCopy { heading: string; body: string | null; beta: boolean }

/** The opening welcome: with the beta lines while USERTASKS_BETA is on (lib/onboarding/beta.ts). */
export function welcomeCopy(beta: boolean, audience: OnboardingAudience): WelcomeCopy {
  if (beta) {
    return {
      heading: 'Welcome to UserTasks, and thank you for joining the beta',
      body: 'We’re close to general release, and your feedback will shape it.',
      beta: true,
    }
  }
  return {
    heading: 'Welcome to UserTasks',
    body: audience === 'admin' ? 'Here’s how to get your workspace ready.' : 'Here’s how to find your way around.',
    beta: false,
  }
}

/** The two highlighted quick starts on the welcome (admins): the first two checklist items, in order. */
export const WELCOME_QUICK_STARTS: readonly AdminItemId[] = ['agent', 'gallery']

export type GuideView = 'welcome' | 'checklist' | 'celebrate'

/**
 * The first screen when the guide opens: the welcome until it has been seen
 * (and always when asked for), the celebration once everything is done, else
 * the checklist.
 */
export function initialView(stored: StoredOnboarding, opts: { celebrate: boolean; requested?: GuideView | null }): GuideView {
  if (opts.requested) return opts.requested
  if (opts.celebrate) return 'celebrate'
  return stored.welcomed_at ? 'checklist' : 'welcome'
}
