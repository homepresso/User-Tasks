'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import dynamic from 'next/dynamic'
import { serverQuery } from '@/lib/server-read'
import { cn } from '@/lib/utils'
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
  if ((m = p.match(new RegExp(`^/integrations/(${ID})$`, 'i')))) return { area: 'integration', item_id: m[1] }
  if (p === '/integrations' || p.startsWith('/integrations/')) return { area: 'integration' }
  return null
}

/**
 * The admin page of a path (admin help's starters and context), or null.
 * `search` (the query string, read when a message is sent) picks the
 * Settings tab: ?tab=forms is the form sign-in page, governance ?tab=retention
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
  if (p === '/settings') return tab === 'forms' ? 'sign_in_page' : 'settings'
  if (p.startsWith('/settings/')) return 'settings'
  return null
}

const AREA_NOUN: Record<DesignerContext['area'], string> = {
  workflow: 'Workflow', form: 'Form', data: 'Data table', decision_table: 'Business rule', extensibility: 'Extensibility', general: 'Workflows',
  report: 'Report', agent: 'Agent', integration: 'Integration', email_template: 'Email templates', page: 'This page',
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
 * in (an editor, not a small confirmation), else null. The form designer and
 * the test runner host the panel themselves (registerAgentDock). A dialog
 * marked data-agent-no-host (a settings sheet with its own footer, e.g.
 * Settings → Agent's profile editor) never hosts it.
 */
export function hostDialog(doc: Document = document): HTMLElement | null {
  const open = Array.from(doc.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"]'))
    .filter((el) => !el.closest('[data-assistant-panel]') && !el.hasAttribute('data-assistant-panel') && el.getAttribute('role') !== 'alertdialog' && !el.hasAttribute('data-agent-no-host'))
  const top = open[open.length - 1]
  if (!top) return null
  const rect = top.getBoundingClientRect()
  return rect.width >= 560 && rect.height >= 360 ? top : null
}

function useHostDialog(enabled: boolean): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!enabled) { setEl(null); return }
    let frame = 0
    const check = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setEl(hostDialog())) }
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] })
    check()
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [enabled])
  return el
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
  // A modal editor is open: the Agent moves inside it (button and panel), so it stays reachable and interactive.
  const dialog = useHostDialog(available && agent.docks === 0)
  if (!available || agent.docks > 0) return null
  if (dialog) {
    return createPortal(
      <div data-agent-in-dialog="">
        {!agent.open && (
          <button type="button" onClick={() => setAgentOpen(true)} aria-label={`Open the ${AGENT_NAME}`} title={AGENT_NAME}
            className="absolute bottom-3 right-3 z-[60] inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-2 text-xs font-medium text-primary-fg shadow-elev-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            data-testid="assistant-launcher-dialog">
            <Sparkles className="size-3.5" aria-hidden="true" />{AGENT_NAME}
          </button>
        )}
        {agent.open && (isMobile
          ? <AgentPanel variant="sheet" open onClose={() => setAgentOpen(false)} />
          : <div className="absolute inset-y-0 right-0 z-[60] flex w-[380px] max-w-full shadow-elev-3"><AgentPanel variant="inline" open onClose={() => setAgentOpen(false)} /></div>)}
      </div>,
      dialog,
    )
  }
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
        >
          <Sparkles className="size-4" aria-hidden="true" />
          <span className="max-md:sr-only">{AGENT_NAME}</span>
        </button>
      )}
      <AgentPanel variant={isMobile ? 'sheet' : docked ? 'docked' : 'floating'} open={open} onClose={() => setAgentOpen(false)} returnFocus={returnFocus} />
    </>
  )
}
