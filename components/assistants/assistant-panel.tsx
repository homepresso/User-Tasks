'use client'

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import Link from 'next/link'
import * as RadixDialog from '@radix-ui/react-dialog'
import {
  AlertTriangle, ArrowRight, Check, CheckCheck, Copy, ExternalLink, Eye, FileText, Image as ImageIcon, Loader2, MessageSquarePlus, Paperclip, Send, ShieldAlert, Sparkles, Square, UserCheck, X, XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { TaskActionCard } from '@/lib/assistants/types'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { AGENT_NAME, PROCESS_STARTERS } from '@/lib/assistants/types'
import { agentTitle } from '@/lib/assistants/profiles'
import { ATTACHMENT_ACCEPT, formatBytes } from '@/lib/assistants/attachments-core'
import { choiceStatus, type ChatItem } from '@/lib/assistants/history'
import { ChatMarkdown } from './chat-markdown'
import { ChoiceCard } from './choice-card'
import { DictationButton, DictationStatus, isDictationShortcut, useDictation } from './dictation-button'
import { composeDictation } from '@/lib/assistants/dictation'
import {
  applyProposedValues, attachFiles, clearAgentConversation, decideAgentChange, dismissProposal, registerAgentDock,
  removePendingAttachment, requestRerunTest, sendAgentMessage, setAgentOpen, stopAgent, useAgentState,
} from './agent-store'

/**
 * The Agent panel. One conversation (agent-store), shown as:
 *  - docked    desktop dashboard: a side column in the shell's row — it pushes
 *              the page instead of covering it (non-modal);
 *  - floating  desktop standalone form page: a fixed side panel (non-modal);
 *  - inline    inside the form designer dialog: a column of the dialog body
 *              (inside the modal's focus trap, so it is fully interactive);
 *  - sheet     phones: a full-height bottom sheet (modal: focus is trapped,
 *              Escape closes).
 * Streaming text is announced politely (aria-live), tool activity shows as
 * chips, and proposals / drafts / questions / confirmations are cards.
 */

type Variant = 'docked' | 'floating' | 'inline' | 'sheet'

export function AgentPanel({ variant, open, onClose, returnFocus }: {
  variant: Variant
  open: boolean
  onClose: () => void
  returnFocus?: () => void
}) {
  if (variant === 'sheet') {
    return (
      <RadixDialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
          <RadixDialog.Content
            className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+1.5rem)] bottom-[calc(var(--ds-tabbar-h,0px)+env(safe-area-inset-bottom))] z-[60] flex flex-col rounded-t-xl border-t border-border bg-elevated text-fg shadow-elev-3 outline-none"
            aria-describedby={undefined}
            onCloseAutoFocus={(e) => { e.preventDefault(); returnFocus?.() }}
            data-assistant-panel="sheet"
          >
            <RadixDialog.Title className="sr-only">{AGENT_NAME}</RadixDialog.Title>
            <ChatBody onClose={onClose} />
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    )
  }
  if (!open) return null
  return <SidePanel variant={variant} onClose={onClose} returnFocus={returnFocus}><ChatBody onClose={onClose} /></SidePanel>
}

function SidePanel({ variant, onClose, returnFocus, children }: { variant: Exclude<Variant, 'sheet'>; onClose: () => void; returnFocus?: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    return () => { returnFocus?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on open / close only
  }, [])
  return (
    <aside
      ref={ref}
      role="complementary"
      aria-label={AGENT_NAME}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}
      className={cn(
        'flex flex-col overflow-hidden bg-elevated text-fg',
        variant === 'docked' && 'h-dvh w-[400px] max-w-[45vw] shrink-0 border-l border-border',
        variant === 'inline' && 'w-[380px] max-w-[45%] shrink-0 border-l border-border-subtle',
        variant === 'floating' && 'fixed bottom-4 right-4 top-4 z-50 w-[400px] max-w-[calc(100vw-2rem)] rounded-xl border border-border shadow-elev-3',
      )}
      data-assistant-panel={variant === 'docked' ? 'side' : variant}
    >
      {children}
    </aside>
  )
}

/**
 * The Agent inside the form designer dialog (a modal makes everything outside
 * it inert): the dialog renders the returned panel as a column of its body —
 * the SAME conversation — and a header button (AgentDialogButton) toggles it.
 * While mounted, the shell's floating button and panel step aside.
 */
export function useAgentDock(): React.ReactNode {
  const agent = useAgentState()
  const isMobile = useIsMobile()
  useEffect(() => registerAgentDock(), [])
  if (!agent.availability?.agent || !agent.open) return null
  return isMobile
    ? <AgentPanel variant="sheet" open onClose={() => setAgentOpen(false)} />
    : <AgentPanel variant="inline" open onClose={() => setAgentOpen(false)} />
}

/** The header button of a dialog that hosts the Agent (null when the Agent isn't available). */
export function AgentDialogButton() {
  const agent = useAgentState()
  if (!agent.availability?.agent) return null
  return (
    <IconButton
      label={agent.open ? `Hide the ${AGENT_NAME}` : AGENT_NAME}
      icon={<Sparkles />}
      onClick={() => setAgentOpen(!agent.open)}
      aria-pressed={agent.open}
      tooltipSide="bottom"
      data-testid="dialog-agent-button"
    />
  )
}

function ChatBody({ onClose }: { onClose: () => void }) {
  const agent = useAgentState()
  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const attachRef = useRef<HTMLButtonElement>(null)
  const { view } = agent
  const starters = agent.processIntent && !agent.items.length ? PROCESS_STARTERS : view.starters

  // Opened with a starter prompt (the getting-started guide): it goes in the composer, focused, to edit and send.
  useEffect(() => {
    if (!agent.draftIntent) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hand-off from the store
    setDraft(agent.draftIntent.text)
    const t = window.setTimeout(() => { const el = inputRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } }, 50)
    return () => window.clearTimeout(t)
  }, [agent.draftIntent])

  // Opened from Home to build from a process: the attach control has the focus.
  useEffect(() => {
    if (!agent.processIntent) return
    const t = window.setTimeout(() => attachRef.current?.focus(), 50)
    return () => window.clearTimeout(t)
  }, [agent.processIntent])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [agent.items])

  const submit = () => {
    if ((!draft.trim() && !agent.pending.length) || agent.busy || agent.uploading) return
    if (dictation.active) { dictationDetached.current = true; dictation.stop() }
    sendAgentMessage(draft)
    setDraft('')
  }

  // Dictation: the words stream into the box after what was already typed; the
  // text stays there to edit (sent at once only with "Send automatically").
  // Typing while dictating stops it; the words heard are then added to what was typed.
  const dictationBase = useRef('')
  const dictationDetached = useRef(false)
  const dictationConfig = agent.availability?.dictation ?? null
  const dictation = useDictation({
    config: dictationConfig,
    onText: ({ finals, interim }) => { if (!dictationDetached.current) setDraft(composeDictation(dictationBase.current, finals, interim)) },
    onDone: (text) => {
      if (dictationDetached.current) { if (text) setDraft((d) => composeDictation(d, text)); return }
      const next = composeDictation(dictationBase.current, text)
      setDraft(next)
      inputRef.current?.focus()
      if (text && dictationConfig?.auto_send && next.trim() && !agent.busy && !agent.uploading) {
        sendAgentMessage(next)
        setDraft('')
      }
    },
  })
  const toggleDictation = () => {
    if (!dictation.active) { dictationBase.current = draft; dictationDetached.current = false }
    dictation.toggle()
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length) void attachFiles(files)
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => { if (isDictationShortcut(e) && dictation.enabled) { e.preventDefault(); toggleDictation() } }}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true) } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false) }}
      onDrop={onDrop}
    >
      <div className="flex items-start gap-2 border-b border-border px-3 py-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-text" aria-hidden="true"><Sparkles className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold" data-testid="assistant-panel-title">{agentTitle(agent.availability?.profile)}</h2>
          {view.label && (
            <p className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2 py-0.5 text-2xs text-fg-muted" data-testid="agent-context-chip">
              <Eye className="size-3 shrink-0" aria-hidden="true" /><span className="truncate">Looking at: {view.label}</span>
            </p>
          )}
        </div>
        <IconButton label="New conversation" icon={<MessageSquarePlus />} size="sm" onClick={() => { clearAgentConversation(); inputRef.current?.focus() }} disabled={!agent.items.length} data-testid="assistant-clear" />
        <IconButton label={`Close the ${AGENT_NAME}`} icon={<X />} size="sm" onClick={onClose} data-testid="assistant-close" />
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-ui" data-testid="assistant-messages">
        {!agent.items.length && (
          <div className="space-y-2">
            <p className="text-xs text-fg-muted">One assistant on every screen: it keeps this conversation as you move between tasks, forms and the builders. Every change is shown for you to confirm first. You can attach a form design or a process (image, PDF, Word, Excel, BPMN) to build from.</p>
            {agent.processIntent > 0 && <p className="text-xs font-medium" data-testid="agent-process-intro">Attach your process (a document, a diagram, BPMN or a photo of a whiteboard) or describe it, and the Agent plans the tables, forms and workflow to build. You review the plan before anything is created.</p>}
            <p className="text-xs text-fg-muted">Try asking:</p>
            <div className="flex flex-col items-start gap-1.5">
              {starters.map((s) => (
                <button key={s} type="button" onClick={() => sendAgentMessage(s)} className="rounded-full border border-border px-3 py-1 text-left text-xs text-fg hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" data-assistant-starter>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {agent.items.map((item, i) => (item.kind === 'choice'
          ? <ChoiceCard key={item.id} item={item} status={choiceStatus(agent.items, i)} busy={agent.busy || agent.uploading} />
          : <Item key={item.id} item={item} busy={agent.busy} dirty={view.dirty} />))}
        {agent.job && !agent.job.live && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-xs" data-testid="agent-background-banner">
            <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-fg-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1">{agent.status || 'Working in the background…'}<span className="block text-2xs text-fg-muted">You can close this panel or leave the page; the result appears here when it's done.</span></span>
          </div>
        )}
        {view.dirty && agent.items.length > 0 && (
          <p className="rounded-md border border-warning px-2 py-1.5 text-2xs">The editor has unsaved changes. Save them before asking the {AGENT_NAME} to change this item.</p>
        )}
      </div>

      {/* Streaming / activity, announced politely to screen readers. */}
      <div className="sr-only" aria-live="polite" role="status">{agent.status}</div>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-elevated/90 text-sm font-medium" aria-hidden="true">
          Drop files to attach
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="border-t border-border p-2.5">
        {(agent.pending.length > 0 || agent.uploading) && (
          <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Attached files" data-testid="agent-pending-attachments">
            {agent.pending.map((a, i) => (
              <li key={`${a.name}-${i}`} className={`inline-flex max-w-full items-center gap-1 rounded-md border bg-panel px-2 py-0.5 text-2xs ${a.kind === 'failed' ? 'border-danger text-danger' : 'border-border'}`} title={a.error ?? a.note} data-attachment-failed={a.kind === 'failed' || undefined}>
                {a.kind === 'failed' ? <AlertTriangle className="size-3 shrink-0" aria-hidden="true" /> : a.kind === 'image' ? <ImageIcon className="size-3 shrink-0" aria-hidden="true" /> : <FileText className="size-3 shrink-0" aria-hidden="true" />}
                <span className="truncate">{a.name}</span>{a.kind === 'failed' ? <span className="truncate">— {a.error}</span> : <span className="text-fg-muted">{formatBytes(a.size)}</span>}
                <button type="button" className="rounded-sm text-fg-muted hover:text-fg" onClick={() => removePendingAttachment(i)} aria-label={`Remove ${a.name}`}><X className="size-3" /></button>
              </li>
            ))}
            {agent.uploading && <li className="inline-flex items-center gap-1 text-2xs text-fg-muted"><Loader2 className="size-3 animate-spin" aria-hidden="true" />Reading…</li>}
          </ul>
        )}
        {agent.pending.some((a) => a.infopath) && !agent.busy && !agent.uploading && (
          <div className="mb-2 flex flex-wrap gap-1.5" data-testid="agent-infopath-actions">
            <button type="button" className="rounded-full border border-primary px-2.5 py-1 text-2xs font-medium text-primary-text hover:bg-primary-wash"
              onClick={() => { sendAgentMessage(`Import this InfoPath form (${agent.pending.find((a) => a.infopath)?.name}) into UserTasks.`); setDraft('') }}>
              Import this InfoPath form
            </button>
            <button type="button" className="rounded-full border border-border px-2.5 py-1 text-2xs hover:bg-panel"
              onClick={() => { sendAgentMessage('Explain what in this InfoPath form converts to UserTasks and what needs attention.'); setDraft('') }}>
              What converts?
            </button>
          </div>
        )}
        <DictationStatus control={dictation} />
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" multiple accept={ATTACHMENT_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) void attachFiles(files) }} data-testid="agent-file-input" />
          <IconButton ref={attachRef} type="button" label="Attach files" icon={<Paperclip />} variant="ghost" onClick={() => fileRef.current?.click()} disabled={agent.uploading || agent.busy} data-testid="agent-attach" />
          <DictationButton control={{ ...dictation, toggle: toggleDictation }} disabled={agent.busy || agent.uploading} />
          <label htmlFor="assistant-input" className="sr-only">Message the {AGENT_NAME}</label>
          <textarea
            id="assistant-input"
            ref={inputRef}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); if (dictation.active) { dictationDetached.current = true; dictation.stop() } }}
            onKeyDown={onKey}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? [])
              if (files.length) { e.preventDefault(); void attachFiles(files) }
            }}
            rows={2}
            maxLength={4000}
            placeholder={dictation.phase === 'listening' ? 'Listening…' : `Ask the ${AGENT_NAME}…`}
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-md border border-border bg-panel px-2.5 py-2 text-ui text-fg placeholder:text-fg-subtle focus:border-primary focus:outline-none"
            data-testid="assistant-input"
          />
          {agent.busy
            ? <IconButton label="Stop" icon={<Square />} variant="secondary" onClick={stopAgent} data-testid="assistant-stop" />
            : <IconButton label="Send" icon={<Send />} variant="primary" type="submit" disabled={(!draft.trim() && !agent.pending.length) || agent.uploading} data-testid="assistant-send" />}
        </div>
      </form>
    </div>
  )
}

function Item({ item, busy, dirty }: { item: ChatItem; busy: boolean; dirty: boolean }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="ml-8 rounded-lg bg-primary/10 px-3 py-2 text-fg" data-assistant-item="user">
          {item.attachments?.length ? (
            <ul className="mb-1 flex flex-wrap gap-1" aria-label="Attached files">
              {item.attachments.map((a, i) => (
                <li key={i} className={`inline-flex items-center gap-1 rounded border bg-panel px-1.5 py-0.5 text-2xs ${a.error ? 'border-danger text-danger' : 'border-border'}`} title={a.error} data-assistant-attachment>
                  {a.error ? <AlertTriangle className="size-3" aria-hidden="true" /> : a.mime_type.startsWith('image/') ? <ImageIcon className="size-3" aria-hidden="true" /> : <FileText className="size-3" aria-hidden="true" />}{a.name} {a.error ? <span>— could not be read: {a.error}</span> : <span className="text-fg-muted">{formatBytes(a.size)}</span>}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="whitespace-pre-wrap">{item.text}</p>
        </div>
      )
    case 'assistant':
      return item.text.trim() ? <div className="mr-4 text-fg" data-assistant-item="assistant"><ChatMarkdown text={item.text} /></div> : null
    case 'screen':
      return (
        <div className="flex items-center gap-2 text-2xs text-fg-muted" data-assistant-item="screen" role="separator" aria-label={`Now on ${item.label}`}>
          <span className="h-px flex-1 bg-border" /><span>Now on {item.label}</span><span className="h-px flex-1 bg-border" />
        </div>
      )
    case 'tool':
      return (
        <div className="flex" data-assistant-item="tool">
          <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs', item.state === 'error' ? 'border-danger text-danger' : 'border-border text-fg-muted')}>
            {item.state === 'running' ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : item.state === 'ok' ? <Check className="size-3" aria-hidden="true" /> : <XCircle className="size-3" aria-hidden="true" />}
            {item.label}
          </span>
        </div>
      )
    case 'proposal': return <ProposalCard item={item} />
    case 'draft': return <DraftCard item={item} />
    case 'outcome':
      return (
        <div className="rounded-lg border border-border bg-panel p-3" data-assistant-item="outcome">
          <p className="text-2xs font-medium uppercase tracking-wide text-fg-muted">Suggested outcome</p>
          <p className="mt-1 font-semibold">{item.outcome}</p>
          {item.reason && <p className="mt-1 text-xs text-fg-muted">{item.reason}</p>}
          <p className="mt-2 text-2xs text-fg-muted">Only a suggestion — choose the outcome yourself with the task&apos;s buttons when you&apos;re ready.</p>
        </div>
      )
    case 'info': return <InfoCardView item={item} />
    case 'choice': return null // rendered by ChoiceCard (needs the list for its status)
    case 'confirm': return <ConfirmCardView item={item} busy={busy} dirty={dirty} />
    case 'changed':
      return (
        <div className="flex items-center gap-2 rounded-lg border border-success bg-panel px-3 py-2 text-xs" data-assistant-item="changed">
          <CheckCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
          <span className="min-w-0 flex-1">{item.action === 'created' ? 'Created' : item.action === 'deleted' ? 'Deleted' : 'Updated'} <span className="font-medium">{item.title}</span>{item.itemKind === 'workflow' ? ' (draft)' : ''}</span>
          {item.rerun && <Button size="sm" variant="secondary" onClick={() => requestRerunTest(item.rerun!)} data-testid="agent-rerun-test">Re-run test</Button>}
          {item.href && <Link href={item.href} className="inline-flex shrink-0 items-center gap-1 font-medium text-primary-text underline-offset-2 hover:underline" data-testid="assistant-changed-link">Open <ExternalLink className="size-3" aria-hidden="true" /></Link>}
        </div>
      )
    case 'error':
      return <div className="flex items-start gap-2 rounded-lg border border-danger px-3 py-2 text-xs text-danger" role="alert" data-assistant-item="error"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{item.text}</div>
  }
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return '…' } }
  return String(v)
}

function ProposalCard({ item }: { item: Extract<ChatItem, { kind: 'proposal' }> }) {
  const pending = item.values.filter((v) => item.applied[v.key] !== 'applied')
  if (item.dismissed) return <p className="text-2xs text-fg-muted" data-assistant-item="proposal-dismissed">Suggested values dismissed.</p>
  return (
    <div className="rounded-lg border border-border bg-panel" data-assistant-item="proposal">
      <p className="border-b border-border px-3 py-2 text-xs font-medium">Suggested values <span className="font-normal text-fg-muted">— nothing changes until you apply</span></p>
      <ul className="divide-y divide-border">
        {item.values.map((v) => {
          const state = item.applied[v.key]
          return (
            <li key={v.key} className="flex items-start gap-2 px-3 py-2" data-proposal-key={v.key}>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{v.label}</p>
                <p className="text-xs"><span className="text-fg-muted line-through decoration-fg-subtle">{formatValue(v.current)}</span> <span aria-hidden="true">→</span><span className="sr-only">will become</span> <span className="font-medium">{v.display}</span></p>
                {v.reason && <p className="text-2xs text-fg-muted">{v.reason}</p>}
                {state && state !== 'applied' && <p className="text-2xs text-danger">Not applied: {state}</p>}
              </div>
              {state === 'applied'
                ? <span className="inline-flex items-center gap-1 text-2xs text-success"><Check className="size-3" aria-hidden="true" />Applied</span>
                : <Button size="sm" variant="secondary" onClick={() => applyProposedValues(item.id, [v.key])} aria-label={`Apply ${v.label}`} data-testid="assistant-apply-one">Apply</Button>}
            </li>
          )
        })}
      </ul>
      {item.skipped.length > 0 && (
        <p className="border-t border-border px-3 py-1.5 text-2xs text-fg-muted">Not proposed: {item.skipped.map((s) => `${s.key} (${s.reason})`).join('; ')}</p>
      )}
      <div className="flex justify-end gap-2 border-t border-border px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => dismissProposal(item.id)} data-testid="assistant-dismiss">Dismiss</Button>
        <Button size="sm" disabled={!pending.length} onClick={() => applyProposedValues(item.id, pending.map((v) => v.key))} data-testid="assistant-apply-all">Apply all</Button>
      </div>
    </div>
  )
}

function DraftCard({ item }: { item: Extract<ChatItem, { kind: 'draft' }> }) {
  const taskId = item.taskId ?? null
  const [copied, setCopied] = useState(false)
  const [posted, setPosted] = useState<'idle' | 'posting' | 'posted' | string>('idle')
  const post = async () => {
    if (!taskId) return
    setPosted('posting')
    const { addTaskComment } = await import('@/app/actions/tasks')
    const result = await addTaskComment(taskId, item.text)
    setPosted(result.ok ? 'posted' : result.error)
  }
  return (
    <div className="rounded-lg border border-border bg-panel" data-assistant-item="draft">
      <p className="border-b border-border px-3 py-2 text-xs font-medium">{item.draft === 'outcome_note' ? 'Draft outcome note' : 'Draft comment'}</p>
      <p className="whitespace-pre-wrap px-3 py-2 text-xs">{item.text}</p>
      <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
        {typeof posted === 'string' && !['idle', 'posting', 'posted'].includes(posted) && <span className="mr-auto text-2xs text-danger">{posted}</span>}
        <Button size="sm" variant="ghost" leadingIcon={<Copy />} onClick={() => { void navigator.clipboard?.writeText(item.text).then(() => setCopied(true)) }}>{copied ? 'Copied' : 'Copy'}</Button>
        {taskId && item.draft === 'comment' && (
          posted === 'posted'
            ? <span className="inline-flex items-center gap-1 text-2xs text-success"><Check className="size-3" aria-hidden="true" />Posted</span>
            : <Button size="sm" variant="secondary" leadingIcon={<MessageSquarePlus />} loading={posted === 'posting'} onClick={() => void post()} data-testid="assistant-post-comment">Post as comment</Button>
        )}
      </div>
    </div>
  )
}

/** Hex colours (theme changes) get a swatch before the value. */
const SWATCH_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
function PreviewCell({ value }: { value: string }) {
  if (!SWATCH_RE.test(value)) return <>{value}</>
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className="inline-block size-3 shrink-0 rounded-sm border border-border" style={{ backgroundColor: value }} data-confirm-swatch />
      <span className="font-mono">{value}</span>
    </span>
  )
}

function ConfirmCardView({ item, busy, dirty }: { item: Extract<ChatItem, { kind: 'confirm' }>; busy: boolean; dirty: boolean }) {
  const { card } = item
  const [typed, setTyped] = useState('')
  const typedOk = !card.typed_confirm || typed.trim().toLowerCase() === card.typed_confirm.toLowerCase()
  return (
    <div className={cn('rounded-lg border bg-panel', card.danger ? 'border-danger' : 'border-primary')} data-assistant-item="confirm" data-confirm-state={item.state}>
      <p className="border-b border-border px-3 py-2 text-xs font-semibold">{card.title}</p>
      {card.task ? <TaskActionSummary task={card.task} /> : (
        <ul className="list-disc space-y-0.5 px-3 py-2 pl-7 text-xs">
          {card.lines.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
      {card.preview && card.preview.columns.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          {card.preview.caption && <p className="mb-1 text-2xs text-fg-muted">{card.preview.caption}</p>}
          <div className="max-h-56 overflow-auto rounded border border-border">
            <table className="w-full text-2xs" data-testid="agent-confirm-preview">
              <thead className="bg-subtle"><tr>{card.preview.columns.map((c) => <th key={c} scope="col" className="whitespace-nowrap px-1.5 py-1 text-left font-medium">{c}</th>)}</tr></thead>
              <tbody>{card.preview.rows.map((r, i) => <tr key={i} className="border-t border-border">{r.map((v, j) => <td key={j} className="max-w-[10rem] truncate px-1.5 py-0.5" title={v}><PreviewCell value={v} /></td>)}</tr>)}</tbody>
            </table>
          </div>
          {card.preview.total > card.preview.rows.length && <p className="mt-1 text-2xs text-fg-muted">…and {card.preview.total - card.preview.rows.length} more ({card.preview.total} in total)</p>}
        </div>
      )}
      {card.warnings.length > 0 && (
        <ul className="space-y-0.5 border-t border-border px-3 py-2 text-2xs">
          {card.warnings.map((w, i) => <li key={i} className="flex items-start gap-1.5"><AlertTriangle className={cn('mt-px size-3 shrink-0', card.danger ? 'text-danger' : 'text-fg')} aria-hidden="true" />{w}</li>)}
        </ul>
      )}
      {item.state === 'pending' && card.typed_confirm && (
        <div className="border-t border-border px-3 py-2">
          <label className="block text-2xs" htmlFor={`typed-${item.id}`}>Type <span className="font-mono font-semibold">{card.typed_confirm}</span> to confirm</label>
          <input id={`typed-${item.id}`} value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 w-full rounded border border-border bg-bg px-2 py-1 text-xs" autoComplete="off" data-testid="agent-typed-confirm" />
        </div>
      )}
      <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
        {item.state === 'pending' ? (
          <>
            {dirty && <span className="mr-auto text-2xs text-fg">Save your editor changes first</span>}
            <Button size="sm" variant="ghost" onClick={() => decideAgentChange(item.id, card.tool_call_id, false)} disabled={busy} data-testid="assistant-decline">Cancel</Button>
            <Button size="sm" variant={card.danger ? 'danger' : 'primary'} onClick={() => decideAgentChange(item.id, card.tool_call_id, true)} disabled={busy || dirty || !typedOk} data-testid="assistant-confirm">{card.confirm_label ?? 'Confirm'}</Button>
          </>
        ) : (
          <span className="text-2xs text-fg-muted">{item.state === 'approved' ? 'Confirmed' : item.state === 'expired' ? 'Expired — nothing was changed' : 'Cancelled'}</span>
        )}
      </div>
    </div>
  )
}

const TASK_ACTION_LABELS: Record<TaskActionCard['action'], string> = { complete: 'Outcome', accept: 'Response', hold: 'Response', decline: 'Response', save: 'Save' }
const RESPONSE_LABELS: Partial<Record<TaskActionCard['action'], string>> = { accept: 'Accept', hold: 'Hold', decline: 'Decline' }

/** A task action's confirmation card body: outcome (in its colour), comment, values (changed ones marked), on behalf, what happens next. */
function TaskActionSummary({ task }: { task: TaskActionCard }) {
  const breakGlass = task.basis === 'break_glass'
  const label = task.action === 'complete' ? task.outcome : RESPONSE_LABELS[task.action]
  return (
    <div className="space-y-2 px-3 py-2 text-xs" data-agent-task-action={task.action}>
      {task.on_behalf_of && (
        <div className={cn('flex items-start gap-1.5 rounded-md border px-2 py-1.5', breakGlass ? 'border-danger bg-danger-wash text-danger' : 'border-border bg-info-wash text-fg')} data-agent-on-behalf={task.basis ?? 'manager'}>
          {breakGlass ? <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" /> : <UserCheck className="mt-px size-3.5 shrink-0 text-info" aria-hidden="true" />}
          <div className="min-w-0">
            <p className="font-semibold">{breakGlass ? `Break-glass: on behalf of ${task.on_behalf_of}` : `On behalf of ${task.on_behalf_of}`}</p>
            {task.on_behalf_note && <p className="text-fg-muted">Reason: {task.on_behalf_note}</p>}
          </div>
        </div>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {label && (
          <>
            <dt className="text-fg-muted">{TASK_ACTION_LABELS[task.action]}</dt>
            <dd><Badge tone={task.tone ?? 'brand'} pill dot data-agent-outcome={label}>{label}</Badge>{task.accept_first && <span className="ml-1.5 text-2xs text-fg-muted">accepted first</span>}</dd>
          </>
        )}
        {task.comment && (
          <>
            <dt className="text-fg-muted">{task.action === 'complete' ? 'Comment' : 'Reason'}</dt>
            <dd className="whitespace-pre-wrap break-words">{task.comment}</dd>
          </>
        )}
      </dl>
      {task.values && task.values.length > 0 && (
        <div>
          <p className="mb-0.5 text-2xs font-medium uppercase tracking-wide text-fg-muted">Field values</p>
          <dl className="grid grid-cols-[minmax(0,40%)_1fr] gap-x-3 gap-y-0.5 rounded border border-border px-2 py-1" data-agent-task-values>
            {task.values.map((v, i) => (
              <div key={i} className="contents" data-changed={v.changed || undefined}>
                <dt className="truncate text-fg-muted" title={v.label}>{v.label}</dt>
                <dd className={cn('break-words', v.changed && 'font-semibold text-primary-text')}>{v.value}{v.changed && <span className="sr-only"> (changed)</span>}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {task.next && (
        <p className="flex items-start gap-1.5 text-fg-muted" data-agent-task-next><ArrowRight className="mt-px size-3 shrink-0" aria-hidden="true" />{task.next}</p>
      )}
    </div>
  )
}

/** A task's form at a glance (task_get_form): label → value, required-but-empty fields flagged, its outcome buttons. Values are data written by people. */
function InfoCardView({ item }: { item: Extract<ChatItem, { kind: 'info' }> }) {
  return (
    <div className="rounded-lg border border-border bg-panel" data-assistant-item="info">
      <div className="flex items-start gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold" title={item.title}>{item.title}</p>
          {item.subtitle && <p className="truncate text-2xs text-fg-muted">{item.subtitle}</p>}
        </div>
        {item.href && <Link href={item.href} className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-primary-text underline-offset-2 hover:underline">Open <ExternalLink className="size-3" aria-hidden="true" /></Link>}
      </div>
      <dl className="grid grid-cols-[minmax(0,40%)_1fr] gap-x-3 gap-y-1 px-3 py-2 text-xs" data-agent-info-rows>
        {item.rows.map((r, i) => (
          <div key={i} className="contents" data-flag={r.flag ?? undefined}>
            <dt className={cn('truncate text-fg-muted', r.flag === 'required_empty' && 'text-danger')} title={r.label}>{r.label}{r.flag === 'required_empty' && <span aria-hidden="true"> *</span>}</dt>
            <dd className={cn('break-words', r.flag === 'required_empty' && 'text-danger', r.flag === 'invalid' && 'text-danger')}>
              {r.flag === 'required_empty' ? <span className="inline-flex items-center gap-1"><AlertTriangle className="size-3" aria-hidden="true" />Required — empty</span> : r.value}
            </dd>
          </div>
        ))}
      </dl>
      {item.outcomes && item.outcomes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border px-3 py-1.5" aria-label="Outcomes">
          <span className="mr-1 text-2xs text-fg-muted">Outcomes</span>
          {item.outcomes.map((o) => <Badge key={o.label} tone={o.tone} pill dot>{o.label}</Badge>)}
        </div>
      )}
      {item.notes && item.notes.length > 0 && (
        <ul className="space-y-0.5 border-t border-border px-3 py-1.5 text-2xs text-fg-muted">
          {item.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </div>
  )
}
