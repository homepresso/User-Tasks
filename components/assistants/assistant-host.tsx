'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import dynamic from 'next/dynamic'
import { serverQuery } from '@/lib/server-read'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/icon-button'
import { dialogDockMode } from '@/lib/assistants/launcher-geometry'
import { useLauncherAvoidance } from './use-launcher-avoidance'
import { useIsMobile } from '@/hooks/use-mobile'
import { routeLabel } from '@/lib/page-title'
import { useCurrentSurface, useRegisteredDesignerContext } from '@/lib/assistants/client-registry'
import {
  ADMIN_STARTERS, AGENT_NAME, DESIGNER_STARTERS, FORM_STARTERS, GENERAL_STARTERS, TASK_STARTERS,
  type AdminArea, type AssistantAvailability, type DesignerContext,
} from '@/lib/assistants/types'
import { profileStarters, screenArea } from '@/lib/assistants/profiles'
import {
  setAgentAvailability, setAgentContextProvider, setAgentOpen, setAgentQueryClient, setAgentView, useAgentState,
  type RequestContext,
} from './agent-store'

/**
 * The Agent: ONE floating button and panel, mounted once by the dashboard
 * shell (and by the standalone form page). It shows on every screen when the
 * server says the Agent is available to this person (`assistants.availability`:
 * a key is configured AND the Agent is on AND they are allowed). The
 * conversation lives in agent-store (persisted per person + workspace), so it
 * follows the person between screens and survives a reload.
 *
 * Each message carries the CURRENT screen: a task, a form being filled, the
 * item open in a builder (workflow, form designer, data table, decision
 * table), or just the page — the server picks the tools for it.
 *
 * Desktop: a docked side panel in the shell's row (it pushes the page, so a
 * builder's canvas stays usable beside it); the standalone page floats it.
 * Phones: a full-height sheet above the tab bar. While the form designer
 * dialog (a modal) is open, the dialog hosts the panel (AgentDialogDock) and
 * this host stays out of the way.
 */

// The panel (chat, Markdown, cards) loads only when the Agent is available.
const AgentPanel = dynamic(() => import('./assistant-panel').then((m) => m.AgentPanel), { ssr: false })

const ID = '[0-9a-f-]{8,}'

/** The builder area (and open item) of a builder page, or null. */
export function designerAreaForPath(pathname: string): DesignerContext | null {
  const p = pathname.replace(/\/+$/, '')
  let m: RegExpMatchArray | null
  if ((m = p.match(new RegExp(`^/automations/rules/(${ID})$`, 'i')))) return { area: 'decision_table', item_id: m[1] }
  if (p === '/automations/rules') return { area: 'decision_table' }
  if (p === '/automations/forms/new') return { area: 'form' }
  if ((m = p.match(new RegExp(`^/automations/forms/(${ID})$`, 'i')))) return { area: 'form', item_id: m[1] }
  if (p === '/automations/forms') return { area: 'form' }
  if (p === '/automations/email-templates' || p.startsWith('/automations/email-templates/')) return { area: 'email_template' }
  if (/^\/automations\/(queue|runs|schedules|email-templates)(\/|$)/.test(p) || /\/runs$/.test(p)) return null
  if ((m = p.match(new RegExp(`^/automations/(${ID})$`, 'i')))) return { area: 'workflow', item_id: m[1] }
  if (p === '/automations') return { area: 'general' }
  if ((m = p.match(new RegExp(`^/data/(${ID})$`, 'i')))) return { area: 'data', item_id: m[1] }
  if (p === '/data') return { area: 'data' }
  if (p === '/extensibility' || p.startsWith('/extensibility/')) return { area: 'extensibility' }
  if (p === '/automations/email-templates' || p.startsWith('/automations/email-templates/')) return { area: 'email_template' }
  if (p === '/reports/builder') return { area: 'report' }
  if ((m = p.match(new RegExp(`^/reports/(${ID})$`, 'i')))) return { area: 'report', item_id: m[1] }
  if (p === '/reports' || p.startsWith('/reports/')) return { area: 'report' }
  if ((m = p.match(new RegExp(`^/agents/(${ID})$`, 'i')))) return { area: 'agent', item_id: m[1] }
  if (p === '/agents' || p.startsWith('/agents/')) return { area: 'agent' }
  // An app page (the builder registers the app's id, name and open page): its slug is the open item.
  if ((m = p.match(/^\/apps\/([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)(?:\/[a-z0-9-]+)?$/))) return { area: 'app', item_id: m[1] }
  if ((m = p.match(new RegExp(`^/integrations/(${ID})$`, 'i')))) return { area: 'integration', item_id: m[1] }
  if (p === '/integrations' || p.startsWith('/integrations/')) return { area: 'integration' }
  return null
}

/**
 * The admin page of a path (admin help's starters and context), or null.
 * `search` (the query string, read when a message is sent) picks the
 * Settings tab: ?tab=forms / ?tab=sign-in is the sign-in page for forms and apps, governance ?tab=retention
 * the retention policies.
 */
export function adminAreaForPath(pathname: string, search = ''): AdminArea | null {
  const p = pathname.replace(/\/+$/, '')
  const tab = new URLSearchParams(search).get('tab')
  if (p === '/team' || p.startsWith('/team/')) return 'team'
  if (p === '/org' || p.startsWith('/org/')) return 'org'
  if (p === '/activity' || p.startsWith('/activity/')) return 'activity'
  if (p === '/automations/email-templates' || p.startsWith('/automations/email-templates/')) return 'email_templates'
  if (p === '/settings/governance') return tab === 'retention' ? 'retention' : 'roles'
  if (p === '/settings/theme') return 'theme'
  if (p === '/settings/invitations') return 'invitations'
  if (p === '/settings/assistants') return 'usage'
  if (/^\/settings\/(log-export|sso|webhooks|api-keys|oauth-apps|workspace-dns|mcp|document-ocr|github-sync|logs)(\/|$)/.test(p)) return 'integrations'
  if (p === '/settings') return tab === 'forms' || tab === 'sign-in' ? 'sign_in_page' : 'settings'
  if (p.startsWith('/settings/')) return 'settings'
  return null
}

const AREA_NOUN: Record<DesignerContext['area'], string> = {
  workflow: 'Workflow', form: 'Form', data: 'Data table', decision_table: 'Business rule', extensibility: 'Extensibility', general: 'Workflows',
  report: 'Report', agent: 'Agent', integration: 'Integration', email_template: 'Email templates', page: 'This page', app: 'App',
}

/** The "Looking at" chip text for the current screen. */
export function screenLabel(params: {
  pathname: string
  surface: ReturnType<typeof useCurrentSurface>
  designer: DesignerContext | null
}): string {
  const { surface, designer, pathname } = params
  const q = (s: string | null | undefined) => (s ? ` “${s}”` : '')
  if (surface?.kind === 'task') return `Task${q(surface.title)}`
  if (surface?.kind === 'form') return `Form${q(surface.title)}`
  if (designer?.item_id) return `${AREA_NOUN[designer.area]}${q(designer.item_name)}${designer.area === 'form' ? ' (designer)' : ''}`
  return routeLabel(pathname) ?? (designer ? AREA_NOUN[designer.area] : 'This page')
}

/**
 * The open modal dialog that should host the Agent (a modal makes the rest of
 * the page inert): the topmost open Radix dialog that is big enough to work
 * in (an editor, not a small confirmation), else null. On phones a dialog is
 * a full-width bottom sheet, so only its height counts. The form designer and
 * the test runner host the panel themselves (registerAgentDock). A dialog
 * marked data-agent-no-host (a settings sheet with its own footer, e.g.
 * Settings → Agent's profile editor) never hosts it.
 */
export function hostDialog(doc: Document = document, mobile = false): HTMLElement | null {
  // Radix dialogs (data-state) and custom modal panels (aria-modal, e.g. an app's panels and modals).
  const open = Array.from(doc.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"], [role="dialog"][aria-modal="true"]'))
    .filter((el) => !el.closest('[data-assistant-panel]') && !el.hasAttribute('data-assistant-panel') && el.getAttribute('role') !== 'alertdialog' && !el.hasAttribute('data-agent-no-host'))
  const top = open[open.length - 1]
  if (!top) return null
  const rect = top.getBoundingClientRect()
  return (mobile ? rect.height >= 300 : rect.width >= 560 && rect.height >= 360) ? top : null
}

function useHostDialog(enabled: boolean, mobile: boolean): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!enabled) { setEl(null); return }
    let frame = 0
    const check = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setEl(hostDialog(document, mobile))) }
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'aria-modal'] })
    check()
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [enabled, mobile])
  return el
}

/** The dialog's own Agent slot (DialogAgentSlot); null when it has none. */
export function dialogSlot(dialog: ParentNode): HTMLElement | null {
  const slots = Array.from(dialog.querySelectorAll<HTMLElement>('[data-agent-header-slot]')).filter((el) => !el.closest('[data-assistant-panel]'))
  // A header row's slot beats the slim bar (a DialogContent without a title whose children render their own header).
  return slots.find((el) => el.getAttribute('data-agent-header-slot') !== 'bar') ?? slots[0] ?? null
}

/**
 * The header slot to put the Agent button in: the dialog's DialogAgentSlot, or
 * (a custom dialog without one) a slim right-aligned bar added as its first
 * row, so the button never sits on the dialog's content or actions.
 */
function useDialogSlot(dialog: HTMLElement): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const own = dialogSlot(dialog)
    if (own) { setSlot(own); return }
    const bar = document.createElement('div')
    bar.setAttribute('data-agent-header-slot', '')
    bar.setAttribute('data-agent-injected', '')
    bar.className = 'flex shrink-0 justify-end px-3 pt-2'
    dialog.insertBefore(bar, dialog.firstChild)
    setSlot(bar)
    return () => { bar.remove() }
  }, [dialog])
  return slot
}

const DIALOG_PANEL_WIDTH = 400

/**
 * The Agent open inside a modal dialog (desktop): a side panel at the
 * dialog's right edge. `split` widens the dialog by up to one panel and pads
 * its right side, so the form (and its footer buttons) shrinks beside the
 * panel instead of being covered; a dialog too narrow to split gets the panel
 * over it, full width (its close returns to the form). The panel follows the
 * dialog's own scroll, so it stays put in dialogs that scroll as a whole.
 */
function DialogDock({ dialog, onClose, returnFocus }: { dialog: HTMLElement; onClose: () => void; returnFocus: () => void }) {
  const [layout, setLayout] = useState<{ mode: 'split' | 'overlay'; top: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const prev = { width: dialog.style.width, maxWidth: dialog.style.maxWidth, paddingRight: dialog.style.paddingRight }
    const restore = () => { Object.assign(dialog.style, prev) }
    const place = () => setLayout((l) => ({ mode: l?.mode ?? 'overlay', top: dialog.scrollTop, height: dialog.clientHeight }))
    const apply = () => {
      restore()
      const basePad = parseFloat(getComputedStyle(dialog).paddingRight) || 0
      const plan = dialogDockMode({ dialogWidth: dialog.getBoundingClientRect().width, viewportWidth: window.innerWidth, panelWidth: DIALOG_PANEL_WIDTH })
      let mode = plan.mode
      if (plan.mode === 'split') {
        dialog.style.width = `${plan.width}px`
        dialog.style.maxWidth = 'none'
        // A dialog anchored by left / right (not centred) grows one way: pull it back inside the viewport.
        const r = dialog.getBoundingClientRect()
        const overflow = Math.max(0, r.right - (window.innerWidth - 8)) + Math.max(0, 8 - r.left)
        if (overflow > 0) dialog.style.width = `${plan.width - overflow}px`
        if (plan.width - overflow - plan.panel < 360) { restore(); mode = 'overlay' }
        else dialog.style.paddingRight = `${basePad + plan.panel}px`
      }
      setLayout({ mode, top: dialog.scrollTop, height: dialog.clientHeight })
    }
    apply()
    const resize = new ResizeObserver(place)
    resize.observe(dialog)
    dialog.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', apply)
    return () => {
      resize.disconnect()
      dialog.removeEventListener('scroll', place)
      window.removeEventListener('resize', apply)
      restore()
    }
  }, [dialog])
  if (!layout) return null
  return createPortal(
    <div
      className="absolute right-0 z-[60] m-0 flex"
      style={{ top: layout.top, height: layout.height, width: layout.mode === 'split' ? DIALOG_PANEL_WIDTH : '100%' }}
      data-agent-dialog-dock={layout.mode}
    >
      <AgentPanel variant="dialog" open onClose={onClose} returnFocus={returnFocus} />
    </div>,
    dialog,
  )
}

/** The Agent in a pop-up: an icon button in its header row (left of ×) and, open, the docked panel. */
function DialogAgent({ dialog, open, isMobile }: { dialog: HTMLElement; open: boolean; isMobile: boolean }) {
  const slot = useDialogSlot(dialog)
  const ref = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setAgentOpen(false), [])
  const returnFocus = useCallback(() => { requestAnimationFrame(() => ref.current?.focus()) }, [])
  return (
    <>
      {slot && createPortal(
        <IconButton
          ref={ref}
          size="sm"
          label={open ? `Hide the ${AGENT_NAME}` : AGENT_NAME}
          icon={<Sparkles />}
          onClick={() => setAgentOpen(!open)}
          aria-pressed={open}
          tooltipSide="bottom"
          data-testid="assistant-launcher-dialog"
        />,
        slot,
      )}
      {open && (isMobile
        ? <AgentPanel variant="sheet" open onClose={close} returnFocus={returnFocus} />
        : <DialogDock dialog={dialog} onClose={close} returnFocus={returnFocus} />)}
    </>
  )
}

/** The CSS variables the page launcher publishes on <html> while it shows: the room shared layouts keep clear for it. */
export function launcherReserveVars(rect: { width: number; height: number; right: number; bottom: number } | null): Record<string, string> {
  if (!rect) return {}
  return { '--agent-launcher-w': `${Math.ceil(rect.width + rect.right + 8)}px`, '--agent-launcher-reserve': `${Math.ceil(rect.height + rect.bottom + 8)}px` }
}

function useLauncherReserve(ref: RefObject<HTMLElement | null>, shown: boolean) {
  useEffect(() => {
    const root = document.documentElement
    const el = ref.current
    const clear = () => { root.style.removeProperty('--agent-launcher-w'); root.style.removeProperty('--agent-launcher-reserve'); root.removeAttribute('data-agent-launcher') }
    if (!shown || !el) { clear(); return }
    const update = () => {
      const cs = getComputedStyle(el)
      const vars = launcherReserveVars({ width: el.offsetWidth, height: el.offsetHeight, right: parseFloat(cs.right) || 0, bottom: parseFloat(cs.bottom) || 0 })
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
      root.setAttribute('data-agent-launcher', '')
    }
    update()
    const resize = new ResizeObserver(update)
    resize.observe(el)
    window.addEventListener('resize', update)

    // Scroll room: a page that already scrolls gets the launcher's height of
    // extra bottom padding (globals.css, main[data-agent-scroll-room]), so its
    // last row can scroll clear of the button. Pages that fit exactly (the
    // full-height builders) get none: they'd only grow a scrollbar.
    let frame = 0
    let main: HTMLElement | null = null
    const room = () => {
      frame = 0
      const now = document.querySelector<HTMLElement>('main#main')
      if (main && main !== now) main.removeAttribute('data-agent-scroll-room')
      main = now
      if (!main) return
      const on = main.hasAttribute('data-agent-scroll-room')
      const extra = on ? (parseFloat(getComputedStyle(main).paddingBottom) || 0) - (parseFloat(main.dataset.agentBasePad ?? '0') || 0) : 0
      if (!on) main.dataset.agentBasePad = String(parseFloat(getComputedStyle(main).paddingBottom) || 0)
      const want = needsScrollRoom({ scrollHeight: main.scrollHeight, clientHeight: main.clientHeight, extra })
      if (want !== on) main.toggleAttribute('data-agent-scroll-room', want)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(room) }
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      resize.disconnect(); mutations.disconnect()
      window.removeEventListener('resize', update); window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
      main?.removeAttribute('data-agent-scroll-room')
      clear()
    }
  }, [ref, shown])
}

/** Does a scroll area (measured with `extra` px of launcher room already added) scroll without that room? */
export function needsScrollRoom({ scrollHeight, clientHeight, extra }: { scrollHeight: number; clientHeight: number; extra: number }): boolean {
  return scrollHeight - extra > clientHeight + 1
}

export function AssistantHost({ standalone = false }: { standalone?: boolean }) {
  const pathname = usePathname() ?? ''
  const surface = useCurrentSurface()
  const registered = useRegisteredDesignerContext()
  const routeDesigner = standalone ? null : designerAreaForPath(pathname)
  const routeKey = routeDesigner ? JSON.stringify(routeDesigner) : ''
  const designer: DesignerContext | null = useMemo(() => (standalone ? null
    : registered ? { ...(routeKey ? JSON.parse(routeKey) : {}), ...registered }
    : routeKey ? JSON.parse(routeKey) : null), [standalone, registered, routeKey])
  // The screen's area picks the person's Agent profile (its panel name and starters).
  const args = surface?.kind === 'task' ? { taskId: surface.taskId } : surface?.kind === 'form' ? { formId: surface.formId }
    : { area: screenArea({ designer: designer ? true : null, path: standalone ? null : pathname }) }
  const { data } = useQuery({
    queryKey: ['assistant-availability', args],
    queryFn: () => serverQuery('assistants.availability', args) as Promise<AssistantAvailability>,
    staleTime: 60_000,
    retry: false,
    // Moving between screens keeps the button while the new screen's answer loads.
    placeholderData: keepPreviousData,
  })
  const agent = useAgentState()
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const available = Boolean(data?.agent)

  useEffect(() => { setAgentQueryClient(queryClient) }, [queryClient])
  useEffect(() => { setAgentAvailability(data ?? null) }, [data])

  const label = screenLabel({ pathname, surface, designer })
  const adminArea = standalone ? null : adminAreaForPath(pathname)
  const profileList = data?.profile?.starters
  const starters = useMemo(() => {
    const screen = surface?.kind === 'task' && data?.task ? TASK_STARTERS
      : surface?.kind === 'form' && data?.form_read ? FORM_STARTERS
      : designer && data?.designer ? DESIGNER_STARTERS[designer.area]
      : adminArea && data?.admin ? ADMIN_STARTERS[adminArea]
      : null
    return profileStarters(profileList ?? [], screen, GENERAL_STARTERS)
  }, [surface?.kind, designer, adminArea, data?.task, data?.form_read, data?.designer, data?.admin, profileList])
  useEffect(() => { setAgentView({ label, starters, dirty: Boolean(designer?.dirty) }) }, [label, starters, designer?.dirty])

  // What each message sends: the screen as it is at that moment.
  const ctxRef = useRef<RequestContext | null>(null)
  const requestContext: RequestContext = {
    form_id: surface?.kind === 'form' ? surface.formId : null,
    task_id: surface?.kind === 'task' ? surface.taskId : null,
    designer,
    screen: { label, path: pathname || null },
    admin: adminArea && data?.admin ? { area: adminAreaForPath(pathname, typeof window === 'undefined' ? '' : window.location.search) ?? adminArea } : null,
    readForm: Boolean(data?.form_read) && (surface?.kind === 'form' || surface?.kind === 'task'),
  }
  useLayoutEffect(() => { ctxRef.current = requestContext })
  useEffect(() => {
    setAgentContextProvider(() => ctxRef.current!)
    return () => setAgentContextProvider(null)
  }, [])

  const returnFocus = useCallback(() => { requestAnimationFrame(() => buttonRef.current?.focus()) }, [])
  // A modal pop-up is open: the Agent moves inside it (a header icon button and a docked panel), so it stays reachable and interactive.
  const dialog = useHostDialog(available && agent.docks === 0, isMobile)
  const pageLauncher = available && agent.docks === 0 && !dialog && !(agent.open && !isMobile)
  const placement = useLauncherAvoidance(buttonRef, pageLauncher)
  useLauncherReserve(buttonRef, pageLauncher)
  if (!available || agent.docks > 0) return null
  if (dialog) return <DialogAgent dialog={dialog} open={agent.open} isMobile={isMobile} />
  const open = agent.open
  const docked = !standalone && !isMobile

  return (
    <>
      {!(open && !isMobile) && (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setAgentOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Open the ${AGENT_NAME}`}
          title={AGENT_NAME}
          style={placement.transform ? { transform: placement.transform } : undefined}
          data-agent-placement={placement.plan.side === 'right' && !placement.plan.lift && !placement.plan.compact ? 'home' : `${placement.plan.side}${placement.plan.compact ? '-compact' : ''}`}
          className={cn(
            'fixed right-4 z-40 inline-flex items-center gap-2 rounded-full bg-primary px-3.5 py-2.5 text-sm font-medium text-primary-fg shadow-elev-3 transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary md:right-6 md:bottom-6',
            standalone
              ? 'bottom-[calc(1rem+env(safe-area-inset-bottom))]'
              // Phones: above the tab bar (and the task screen's action bar).
              : surface?.kind === 'task'
                ? 'bottom-[calc(var(--ds-tabbar-h)+env(safe-area-inset-bottom)+4.25rem)]'
                : 'bottom-[calc(var(--ds-tabbar-h)+env(safe-area-inset-bottom)+0.75rem)]',
          )}
          data-testid="assistant-launcher"
          data-tour="agent-button"
        >
          <Sparkles className="size-4" aria-hidden="true" />
          <span className={placement.plan.compact ? 'sr-only' : 'max-md:sr-only'}>{AGENT_NAME}</span>
        </button>
      )}
      <AgentPanel variant={isMobile ? 'sheet' : docked ? 'docked' : 'floating'} open={open} onClose={() => setAgentOpen(false)} returnFocus={returnFocus} />
    </>
  )
}
