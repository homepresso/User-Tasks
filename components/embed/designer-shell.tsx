'use client'

/**
 * The frame around an embedded designer (/embed/workflows/…, /embed/forms/…,
 * lib/embed/designers.ts): the providers the designers need from the
 * dashboard shell (session, permissions, extensions, jobs / toasts) WITHOUT
 * its chrome — no sidebar, top bar, breadcrumbs, global search, New menu or
 * Agent — plus:
 *
 *  - a compact header: Back to <list>, what is open and whether it has
 *    unsaved changes, Open in UserTasks (new tab) and Done;
 *  - links: same-origin app links go to their /embed/ equivalent (launch
 *    parameters carried) or open in a new tab; links to the host page's
 *    origin navigate the top window (after the unsaved-changes check); other
 *    sites open in a new tab. The full app never opens inside the frame;
 *  - host messages (postMessage to the approved host origin only): ready,
 *    state (dirty, name), done / deleted; the host acks `done` when it
 *    navigates itself, else the frame navigates the top window;
 *  - the unsaved-changes guard: Back / Done ask first, and the browser's
 *    "leave page" prompt is armed while there are unsaved changes;
 *  - workflows: "Import from Nintex" (components/importers/nintex-import-dialog):
 *    by default onto the list and event this workflow is bound to, as a new
 *    draft of it; the designer then reloads to show that draft.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft, ExternalLink, Upload } from 'lucide-react'
import { NintexImportDialog } from '@/components/importers/nintex-import-dialog'
import { DashboardAuthProvider, useDashboardAuth } from '@/lib/dashboard-auth-context'
import { PermissionsProvider } from '@/lib/permissions-context'
import { BreadcrumbsProvider } from '@/lib/breadcrumbs-context'
import { ExtensionsProvider } from '@/components/extensions/extensions-provider'
import { ExtensionActionHost } from '@/components/extensions/action-host'
import { JobsProvider } from '@/components/jobs/jobs-provider'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { BusyBar } from '@/components/ui/busy-bar'
import { useRegisteredDesignerContext } from '@/lib/assistants/client-registry'
import type { ExtensionUiState } from '@/lib/extensions/ui'
import { EmbedNavigationProvider, type EmbedNavigation } from '@/lib/embed/navigation'
import {
  DESIGNER_MESSAGE_TYPE, EMBED_SESSION_KEY, embedPathFor, isHostMessage, withEmbedParams,
  type DesignerKind, type DesignerMessage, type EmbedReturn,
} from '@/lib/embed/designers'
import { ensureRandomUUID } from '@/lib/embed/secure-context'

// A frame under a plain-http host page is not a secure context: no crypto.randomUUID there (lib/embed/secure-context.ts).
if (typeof window !== 'undefined') ensureRandomUUID()

/** How long Done waits for the host page to take over before navigating the top window itself. */
const HOST_ACK_MS = 400
/** Header height + padding: the designers size themselves with --designer-offset. */
const DESIGNER_OFFSET = '3.5rem'

export interface EmbeddedDesignerShellProps {
  kind: DesignerKind
  id: string
  /** The same page in the full app (Open in UserTasks). */
  appPath: string
  ret: EmbedReturn | null
  hostOrigin: string | null
  header: boolean
  carried: Record<string, string>
  extensionUi: ExtensionUiState
  children: React.ReactNode
}

const KIND_LABEL: Record<DesignerKind, string> = { workflow: 'Workflow', form: 'Form', runs: 'Workflow runs', run: 'Workflow run' }

export function EmbeddedDesignerShell(props: EmbeddedDesignerShellProps) {
  return (
    <DashboardAuthProvider>
      <ExtensionsProvider initial={props.extensionUi}>
        <SignedInFrame {...props} />
      </ExtensionsProvider>
    </DashboardAuthProvider>
  )
}

function SignedInFrame(props: EmbeddedDesignerShellProps) {
  const { loading, profile, permissions, userId } = useDashboardAuth()
  const pathname = usePathname()
  const [hydrated, setHydrated] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- first client render matches the server's loading frame
  useEffect(() => { setHydrated(true) }, [])
  if (!hydrated || (loading && !profile)) {
    return (
      <div className="relative h-dvh" aria-busy="true" aria-label="Loading">
        <BusyBar className="absolute inset-x-0 top-0" />
      </div>
    )
  }
  if (!profile || !userId) return null
  return (
    <PermissionsProvider permissions={permissions} userId={userId}>
      <BreadcrumbsProvider resetKey={pathname}>
        <JobsProvider>
          <DesignerFrame {...props} />
          <ExtensionActionHost />
        </JobsProvider>
      </BreadcrumbsProvider>
    </PermissionsProvider>
  )
}

function post(hostOrigin: string | null, message: DesignerMessage) {
  if (!hostOrigin || typeof window === 'undefined' || window.parent === window) return
  try { window.parent.postMessage(message, hostOrigin) } catch { /* host gone */ }
}

/** Navigate the top window (allowed from a cross-origin frame with the click's user activation). */
function navigateTop(url: string) {
  try {
    if (window.top) { window.top.location.href = url; return }
  } catch { /* fall through */ }
  const a = document.createElement('a')
  a.href = url
  a.target = '_top'
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function DesignerFrame({ kind, id, appPath, ret, hostOrigin, header, carried, children }: EmbeddedDesignerShellProps) {
  const router = useRouter()
  const designer = useRegisteredDesignerContext()
  const dirty = Boolean(designer?.dirty)
  const name = designer?.item_name ?? null
  const [confirm, setConfirm] = useState<null | { reason: 'done' | 'deleted' | 'link'; url: string | null }>(null)
  const [closed, setClosed] = useState(false)
  const [importing, setImporting] = useState(false)
  const acked = useRef(false)
  const dirtyRef = useRef(dirty)
  useEffect(() => { dirtyRef.current = dirty }, [dirty])

  // Remember the launch parameters for this frame (the dashboard shell's escape guard uses them).
  useEffect(() => {
    try { sessionStorage.setItem(EMBED_SESSION_KEY, JSON.stringify(carried)) } catch { /* storage blocked */ }
  }, [carried])

  // Host messages: ready once per object, then state on every change.
  useEffect(() => { post(hostOrigin, { type: DESIGNER_MESSAGE_TYPE, event: 'ready', kind, id, name, layout: 'fill' }) }, [hostOrigin, kind, id]) // eslint-disable-line react-hooks/exhaustive-deps -- once per object
  useEffect(() => { post(hostOrigin, { type: DESIGNER_MESSAGE_TYPE, event: 'state', kind, id, name, dirty }) }, [hostOrigin, kind, id, name, dirty])
  useEffect(() => {
    if (!hostOrigin) return
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || e.origin !== hostOrigin || !isHostMessage(e.data)) return
      acked.current = true
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [hostOrigin])

  // The browser's own prompt while there are unsaved changes (closing the tab, the host page navigating away).
  // (Reads the ref: after "Leave without saving" the leave itself must not ask again.)
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const finish = useCallback((reason: 'done' | 'deleted' | 'link', url: string | null) => {
    if (reason === 'link') { if (url) navigateTop(url); return }
    acked.current = false
    post(hostOrigin, { type: DESIGNER_MESSAGE_TYPE, event: reason, kind, id, returnUrl: ret?.url ?? null })
    window.setTimeout(() => {
      if (acked.current) return
      if (ret) navigateTop(ret.url)
      else setClosed(true)
    }, hostOrigin ? HOST_ACK_MS : 0)
  }, [hostOrigin, kind, id, ret])

  const leave = useCallback((reason: 'done' | 'deleted' | 'link' = 'done', url: string | null = null) => {
    if (reason !== 'deleted' && dirtyRef.current) { setConfirm({ reason, url }); return }
    finish(reason, url)
  }, [finish])

  const nav = useMemo<EmbedNavigation>(() => ({ carried, leave: (reason) => leave(reason ?? 'done') }), [carried, leave])

  // Links: keep the person inside the embed, or out of the frame.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.hasAttribute('download') || a.dataset.embedLink === 'native') return
      const raw = a.getAttribute('href') ?? ''
      if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel):/i.test(raw)) return
      let url: URL
      try { url = new URL(a.href, window.location.href) } catch { return }
      const target = (a.getAttribute('target') ?? '').toLowerCase()
      if (url.origin === window.location.origin) {
        const path = `${url.pathname}${url.search}${url.hash}`
        if (url.pathname.startsWith('/embed/') || url.pathname.startsWith('/api/')) return
        if (target === '_blank') return
        e.preventDefault(); e.stopPropagation()
        const mapped = embedPathFor(path)
        if (mapped) router.push(withEmbedParams(mapped, carried))
        else window.open(path, '_blank', 'noopener')
        return
      }
      if (hostOrigin && url.origin === hostOrigin) {
        e.preventDefault(); e.stopPropagation()
        leave('link', url.toString())
        return
      }
      if (target !== '_blank') {
        e.preventDefault(); e.stopPropagation()
        window.open(url.toString(), '_blank', 'noopener,noreferrer')
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [router, carried, hostOrigin, leave])

  if (closed) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-6 text-center" data-embed-closed="">
        <p className="text-sm text-fg-muted" role="status">Done. You can close this window.</p>
        <Button variant="secondary" size="sm" onClick={() => setClosed(false)}>Keep editing</Button>
      </main>
    )
  }

  return (
    <EmbedNavigationProvider value={nav}>
      <div className="flex h-dvh flex-col overflow-hidden bg-bg" data-embed-designer={kind} style={{ ['--designer-offset' as string]: header ? DESIGNER_OFFSET : '1rem' }}>
        {header && (
          <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle bg-panel px-2" data-embed-header="">
            {ret && (
              <a href={ret.url} target="_top" className={buttonVariants({ variant: 'ghost', size: 'sm' })} data-embed-back=""
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); leave('done') }}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                <span className="max-w-[16rem] truncate">{ret.label}</span>
              </a>
            )}
            {ret && <span className="h-4 w-px bg-border" aria-hidden="true" />}
            <span className="min-w-0 truncate text-sm text-fg-muted">
              <span className="text-fg-subtle">{KIND_LABEL[kind]}</span>
              {name ? <><span aria-hidden="true"> · </span><span className="font-medium text-fg">{name}</span></> : null}
            </span>
            {(kind === 'workflow' || kind === 'form') && (
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-fg-muted" data-embed-state={dirty ? 'dirty' : 'saved'}>
                <span className={`size-1.5 rounded-full ${dirty ? 'bg-warning' : 'bg-success'}`} aria-hidden="true" />
                {dirty ? 'Unsaved changes' : 'All changes saved'}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {kind === 'workflow' && (
                <Button size="sm" variant="ghost" leadingIcon={<Upload aria-hidden="true" />} onClick={() => setImporting(true)} data-embed-import-nintex="">Import from Nintex</Button>
              )}
              <a href={appPath} target="_blank" rel="noopener" className={buttonVariants({ variant: 'ghost', size: 'sm' })} data-embed-open-app="">
                Open in UserTasks <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
              <Button size="sm" onClick={() => leave('done')} data-embed-done="">Done</Button>
            </div>
          </header>
        )}
        <div className="min-h-0 flex-1 overflow-auto p-2">{children}</div>
      </div>
      {kind === 'workflow' && importing && (
        <NintexImportDialog
          open={importing}
          onOpenChange={setImporting}
          designer={{ workflowId: id, dirty }}
          onOpenResult={(href, same) => {
            // The designer's own workflow: load the new draft (nothing unsaved is left to keep). Another one: its embedded designer.
            if (same) { dirtyRef.current = false; window.location.reload(); return }
            const mapped = embedPathFor(href)
            if (mapped) router.push(withEmbedParams(mapped, carried))
            else window.open(href, '_blank', 'noopener')
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => { if (!open) setConfirm(null) }}
        title="Leave without saving?"
        description="You have unsaved changes. If you leave now, they are lost."
        confirmLabel="Leave without saving"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          const c = confirm
          setConfirm(null)
          // The person chose to drop the changes: disarm this frame's and the host's leave prompts first.
          dirtyRef.current = false
          post(hostOrigin, { type: DESIGNER_MESSAGE_TYPE, event: 'state', kind, id, name, dirty: false })
          if (c) finish(c.reason, c.url)
        }}
      />
    </EmbedNavigationProvider>
  )
}
