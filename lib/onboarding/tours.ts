/**
 * Spotlight tours of the getting-started guide, as data. Each step points at
 * a real element by its `data-tour="…"` attribute (added to the sidebar
 * items, the Settings sub-nav, the Agent button, the New menu, the Gallery
 * buttons and a few settings cards), may first go to a page, and falls back
 * to a centred card when the element isn't there (a folded sidebar group, a
 * permission the person lacks, a page that changed).
 *
 * The runner is components/onboarding/getting-started/tour-runner.tsx; the
 * helpers below are pure (__tests__/onboarding-tours.test.ts).
 */

export type TourPlacement = 'right' | 'bottom' | 'left' | 'top'

export interface TourStep {
  /** The element: `[data-tour="<target>"]`. None: a centred card. */
  target?: string
  /** Go here first (path, optionally with ?query) when not already on it. */
  path?: string
  title: string
  body: string
  placement?: TourPlacement
  /**
   * The primary button clicks the element and ends the tour (e.g. "Open the
   * gallery"), with this label.
   */
  clickLabel?: string
  /**
   * A light hint after the tour (no dimming, no buttons, no focus): a ring
   * and a bubble over an element inside another dialog. Ends when the
   * element is clicked or goes away.
   */
  hint?: boolean
}

export interface TourDef {
  id: string
  title: string
  steps: TourStep[]
}

export const TOURS: readonly TourDef[] = [
  {
    id: 'gallery', title: 'Install from the Gallery',
    steps: [
      { target: 'nav-packages', title: 'Packages', body: 'Solutions you install live here: each one is a workflow and everything it uses, kept together so you can update or remove it in one go.', placement: 'right' },
      { path: '/packages', target: 'browse-gallery', title: 'This is the Gallery', body: 'Ready-made solutions for approvals, onboarding, requests and more. Pick one and click Install: you see exactly what it adds before anything changes.', placement: 'bottom', clickLabel: 'Open the gallery' },
      { target: 'gallery-install', title: 'Click Install', body: 'Pick a solution and click Install.', placement: 'left', hint: true },
    ],
  },
  {
    id: 'theme', title: 'Theme and logo',
    steps: [
      { path: '/settings?tab=general', target: 'settings-general', title: 'General settings', body: 'The workspace address, logo and theme everyone sees.', placement: 'right' },
      { path: '/settings?tab=general', target: 'logo-upload', title: 'Your logo', body: 'Upload your logo: it shows at the top of the sidebar for everyone in the workspace.', placement: 'bottom' },
      { path: '/settings?tab=general', target: 'theme-card', title: 'Pick a theme', body: 'Choose one of the ready-made themes, light or dark.', placement: 'top' },
      { path: '/settings?tab=general', target: 'settings-theme', title: 'Or design your own', body: 'The theme designer sets your colours, fonts and corner styles, with a live preview.', placement: 'right' },
    ],
  },
  {
    id: 'team', title: 'Invite your team',
    steps: [
      { path: '/settings/invitations', target: 'settings-invitations', title: 'Members & invites', body: 'Everyone in the workspace and the invitations waiting to be accepted.', placement: 'right' },
      { path: '/settings/invitations', target: 'invite-form', title: 'Send an invitation', body: 'Enter an email address and pick a role. Members work on tasks and forms; Admins can change settings.', placement: 'bottom' },
    ],
  },
  {
    id: 'sso', title: 'Single sign-on',
    steps: [
      { path: '/settings/sso', target: 'settings-sso', title: 'SSO & directory', body: 'Connect your identity provider so people sign in with their work account, and keep members and groups in sync.', placement: 'right' },
      { path: '/settings/sso', target: 'sso-providers', title: 'Choose your provider', body: 'Microsoft Entra ID, Okta, Google Workspace or LDAP. Each card walks you through the details it needs.', placement: 'top' },
    ],
  },
  {
    id: 'agent', title: 'Turn on the Agent',
    steps: [
      { path: '/settings/assistants', target: 'settings-assistants', title: 'Agent settings', body: 'The Agent builds forms, workflows and tables from a description, and helps people with their tasks.', placement: 'right' },
      { path: '/settings/assistants', target: 'agent-provider', title: '1. Add a provider key', body: 'Pick your AI provider and paste an API key (or use an existing connection). Click Test to check it.', placement: 'bottom' },
      { path: '/settings/assistants', target: 'agent-enable', title: '2. Turn it on', body: 'Switch the Agent on and choose who may use it, then save.', placement: 'bottom' },
      { target: 'agent-button', title: 'Then ask away', body: 'Once it\'s on, the Agent button sits in the corner of every page.', placement: 'left' },
    ],
  },
  {
    id: 'build', title: 'Build a form or workflow',
    steps: [
      { target: 'new-menu', title: 'New', body: 'Create a task, workflow, form, data table or report from anywhere.', placement: 'bottom' },
      { target: 'nav-forms-wizard', title: 'The form wizard', body: 'Build a form step by step: it creates the form, a table for the responses, an optional approval and a results page.', placement: 'right' },
      { target: 'agent-button', title: 'Or describe your process', body: 'With the Agent on, attach a process document or describe it, and the Agent plans the tables, forms and workflow for you to review.', placement: 'left' },
    ],
  },
  {
    id: 'selftest', title: 'Platform self-test',
    steps: [
      { path: '/settings?tab=general', target: 'self-test', title: 'Platform self-test', body: 'Install the kitchen sink workflow and run it: it exercises every built-in step and reports what passed.', placement: 'top' },
    ],
  },
  {
    id: 'tasks', title: 'Your tasks',
    steps: [
      { target: 'nav-tasks', title: 'My tasks', body: 'Everything assigned to you. The number is what is still open.', placement: 'right' },
      { path: '/tasks', target: 'task-list', title: 'Your list', body: 'Soonest due first. Open a task to see its form, act on it and add comments.', placement: 'top' },
    ],
  },
  {
    id: 'form', title: 'Fill in a form',
    steps: [
      { target: 'forms-menu', title: 'Forms', body: 'The forms shared with you, ready to fill in.', placement: 'right' },
      { target: 'new-menu', title: 'Or from New', body: '“Fill in a form…” lists the same forms from any page.', placement: 'bottom' },
    ],
  },
  {
    id: 'meet_agent', title: 'Meet the Agent',
    steps: [
      { target: 'agent-button', title: 'The Agent', body: 'Ask about your tasks, have it fill in a form for you, or ask how something works. It sees the page you are on.', placement: 'left' },
    ],
  },
  {
    id: 'notifications', title: 'Your preferences',
    steps: [
      { target: 'notification-bell', title: 'Notifications', body: 'New tasks, mentions and finished work land here.', placement: 'bottom' },
      { path: '/settings?tab=preferences', target: 'settings-preferences', title: 'Preferences', body: 'Choose which processes you follow, your task defaults and the hours you are available.', placement: 'right' },
    ],
  },
]

export function tourById(id: string | null | undefined): TourDef | undefined {
  return id ? TOURS.find((t) => t.id === id) : undefined
}

/** The tour steps that still make sense in this context (no "Agent button" step when the Agent is off). */
export function tourSteps(tour: TourDef, opts: { agentAvailable: boolean }): TourStep[] {
  return tour.steps.filter((s) => opts.agentAvailable || s.target !== 'agent-button' || tour.id === 'agent')
}

/** Whether the page is the step's `path` (same pathname; the path's query values present). */
export function onStepPath(step: Pick<TourStep, 'path'>, pathname: string, search: string): boolean {
  if (!step.path) return true
  const [path, query = ''] = step.path.split('?')
  if ((pathname.replace(/\/+$/, '') || '/') !== path) return false
  const have = new URLSearchParams(search)
  for (const [k, v] of new URLSearchParams(query)) if (have.get(k) !== v) return false
  return true
}

/** The selector for a step's element. Only [a-z0-9-] names are accepted. */
export function tourSelector(target: string): string | null {
  return /^[a-z0-9-]{1,60}$/.test(target) ? `[data-tour="${target}"]` : null
}

export interface ElementLike { getBoundingClientRect(): { width: number; height: number; top: number; left: number } }
export interface QueryRoot { querySelectorAll(selector: string): ArrayLike<ElementLike> }

/** The step's element: the first match that has a size (hidden copies, e.g. the phone nav, are skipped); null when missing. */
export function resolveStepTarget<E extends ElementLike>(step: Pick<TourStep, 'target'>, root: QueryRoot): E | null {
  if (!step.target) return null
  const selector = tourSelector(step.target)
  if (!selector) return null
  const found = Array.from(root.querySelectorAll(selector))
  return (found.find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }) as E | undefined) ?? null
}

/** Sanitise a data-tour name built from an href ("/forms/wizard" → "nav-forms-wizard"). */
export function navTourId(href: string): string {
  const slug = href.split('?')[0].replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  return `nav-${slug || 'root'}`
}

/** The Settings sub-nav item's data-tour ("/settings?tab=general" → "settings-general", "/settings/sso" → "settings-sso"). */
export function settingsTourId(href: string): string {
  const [path, query] = href.split('?')
  const tab = query ? new URLSearchParams(query).get('tab') : null
  if (path === '/settings') return `settings-${tab ?? 'profile'}`
  return `settings-${path.replace(/^\/settings\/?/, '').replace(/^\/+/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'profile'}`
}

/* ── Card placement ── */

export interface Rect { top: number; left: number; width: number; height: number }
export interface Size { width: number; height: number }
export interface CardPosition { top: number; left: number; placement: TourPlacement | 'center' }

const GAP = 14
const MARGIN = 12

/**
 * Where the tooltip card goes: beside the element on the preferred side when
 * it fits, else the side with the most room; centred when there's no
 * element. Always kept inside the viewport.
 */
export function placeCard(target: Rect | null, card: Size, viewport: Size, preferred: TourPlacement = 'bottom'): CardPosition {
  const clampLeft = (x: number) => Math.min(Math.max(x, MARGIN), Math.max(MARGIN, viewport.width - card.width - MARGIN))
  const clampTop = (y: number) => Math.min(Math.max(y, MARGIN), Math.max(MARGIN, viewport.height - card.height - MARGIN))
  if (!target) {
    return { top: clampTop((viewport.height - card.height) / 2), left: clampLeft((viewport.width - card.width) / 2), placement: 'center' }
  }
  const room: Record<TourPlacement, number> = {
    right: viewport.width - (target.left + target.width) - GAP,
    left: target.left - GAP,
    bottom: viewport.height - (target.top + target.height) - GAP,
    top: target.top - GAP,
  }
  const fits = (p: TourPlacement) => (p === 'left' || p === 'right' ? room[p] >= card.width + MARGIN : room[p] >= card.height + MARGIN)
  const opposite: Record<TourPlacement, TourPlacement> = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' }
  // The preferred side, then its opposite, then the rest.
  const order: TourPlacement[] = [...new Set<TourPlacement>([preferred, opposite[preferred], 'bottom', 'right', 'top', 'left'])]
  const placement = order.find(fits) ?? (Object.entries(room).sort((a, b) => b[1] - a[1])[0][0] as TourPlacement)
  const midX = target.left + target.width / 2 - card.width / 2
  const midY = target.top + target.height / 2 - card.height / 2
  switch (placement) {
    case 'right': return { top: clampTop(midY), left: clampLeft(target.left + target.width + GAP), placement }
    case 'left': return { top: clampTop(midY), left: clampLeft(target.left - GAP - card.width), placement }
    case 'top': return { top: clampTop(target.top - GAP - card.height), left: clampLeft(midX), placement }
    default: return { top: clampTop(target.top + target.height + GAP), left: clampLeft(midX), placement: 'bottom' }
  }
}

/* ── Keyboard ── */

export type TourKeyAction = 'next' | 'back' | 'exit' | null

/** Esc exits; → / ← step (Enter and Space stay with the focused button). */
export function tourKeyAction(key: string): TourKeyAction {
  if (key === 'Escape' || key === 'Esc') return 'exit'
  if (key === 'ArrowRight') return 'next'
  if (key === 'ArrowLeft') return 'back'
  return null
}

/** Focus trap: the index Tab (or Shift+Tab) moves to, wrapping inside the card. -1 when nothing is focusable. */
export function trapFocusIndex(current: number, count: number, shift: boolean): number {
  if (count <= 0) return -1
  if (current < 0) return shift ? count - 1 : 0
  return shift ? (current - 1 + count) % count : (current + 1) % count
}

/** The live-region announcement for a step. */
export function stepAnnouncement(tour: TourDef, index: number, total: number, step: TourStep, found: boolean): string {
  return `${tour.title}, step ${index + 1} of ${total}: ${step.title}. ${step.body}${found || !step.target ? '' : ' (This part of the page isn’t showing right now.)'}`
}
