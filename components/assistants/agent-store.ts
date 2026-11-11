'use client'

import { useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { SseParser } from '@/lib/agents/stream'
import { announceChange, currentFormBridge } from '@/lib/assistants/client-registry'
import { ATTACHMENT_LIMITS, attachmentForStorage } from '@/lib/assistants/attachments-core'
import {
  AGENT_OPEN_EVENT, AGENT_RESET_EVENT, OPEN_STATE_KEY, choiceAnswer, choiceStatus, emptyConversation, loadConversation, newConversationId, saveConversation, storageKey, withMergedTurn,
  type ChatItem,
} from '@/lib/assistants/history'
import type { AdminArea, AssistantAvailability, AssistantEvent, ChatAttachment, ChatMessage, DesignerContext, ScreenInfo } from '@/lib/assistants/types'
import type { AgentJobView, AgentTranscript } from '@/lib/assistants/background'
import { JOBS_TOAST_EVENT, type JobsToastDetail } from '@/lib/user-jobs/types'

/**
 * The Agent's state in this tab — ONE conversation, outside React so it
 * survives client-side navigation, the panel moving between the shell and
 * the form designer dialog, and remounts. Persisted per person + workspace
 * (lib/assistants/history.ts). A turn keeps streaming while the person moves
 * between screens.
 *
 * Background work (lib/assistants/background.ts): every turn is a server job
 * that does not depend on this tab. Closing the panel mid-turn moves it to
 * the background (a toast says so; the Jobs panel shows it; the bell tells
 * when it is done) while this tab keeps watching. After a reload, or in
 * another tab, the panel follows a running job by polling and merges a
 * finished job's transcript into the conversation — once per turn id.
 * Stop cancels the job.
 *
 * `messages` is what the server needs next turn (user / assistant / tool, as
 * the server returned them); `items` is what the panel shows.
 */

export interface RequestContext {
  form_id: string | null
  task_id: string | null
  designer: DesignerContext | null
  screen: ScreenInfo | null
  /** The admin page on screen (admin help's starters and context), or null. */
  admin?: { area: AdminArea } | null
  /** Read the live form (only when form help may read it here). */
  readForm: boolean
}

interface AgentState {
  key: string | null
  items: ChatItem[]
  messages: ChatMessage[]
  busy: boolean
  status: string
  open: boolean
  availability: AssistantAvailability | null
  /** The form designer dialog (a modal) hosts the panel while it is open. */
  docks: number
  pending: ChatAttachment[]
  uploading: boolean
  /** The chip text of the last screen a message was sent from (a divider marks a screen change). */
  lastScreen: string | null
  /** The current screen, for the panel: "Looking at" chip, starter prompts, unsaved editor changes. */
  view: AgentView
  /** Opened to build from a process (Home): process starters, and the attach control is focused (counter). */
  processIntent: number
  /** Opened with a starter prompt in the composer (the getting-started guide): the text, and a counter so the same prompt can be placed again. */
  draftIntent: { text: string; n: number } | null
  /** The turn in progress as a server job: watched live in this tab, or followed (a reload, another tab). */
  job: AgentJobState | null
  /** This conversation's id, the turns already in it and the turn in flight (persisted with it). */
  conversationId: string | null
  merged: string[]
  pendingTurn: { turn_id: string; after_item: string | null } | null
}

export interface AgentJobState {
  /** Known once the server created the job (the stream's `job` event, or the jobs list). */
  id: string | null
  turnId: string
  /** This tab streams it (false: followed by polling). */
  live: boolean
  /** Moved to the background (Jobs panel + notification when done). */
  background: boolean
  message: string | null
}

export interface AgentView { label: string | null; starters: string[]; dirty: boolean }

let state: AgentState = {
  key: null, items: [], messages: [], busy: false, status: '', open: readOpen(), availability: null, docks: 0,
  pending: [], uploading: false, lastScreen: null, view: { label: null, starters: [], dirty: false }, processIntent: 0, draftIntent: null,
  job: null, conversationId: null, merged: [], pendingTurn: null,
}
const listeners = new Set<() => void>()
let abort: AbortController | null = null
let queryClient: QueryClient | null = null
let contextProvider: (() => RequestContext) | null = null
/** "Ask Agent to fix" from the test runner: when the Agent changes that workflow, offer to re-run the test with the same inputs. */
let fixRerun: { workflowId: string; values: Record<string, unknown> } | null = null
export const AGENT_RERUN_TEST_EVENT = 'usertasks:agent-rerun-test'
let seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`

function readOpen(): boolean {
  try { return typeof window !== 'undefined' && window.sessionStorage.getItem(OPEN_STATE_KEY) === '1' } catch { return false }
}

function set(patch: Partial<AgentState>, persist = false) {
  state = { ...state, ...patch }
  if (persist && state.key) {
    saveConversation(state.key, {
      v: 1, items: state.items, messages: state.messages, updated_at: Date.now(),
      ...(state.conversationId ? { id: state.conversationId } : {}), merged: state.merged, pending_turn: state.pendingTurn,
    })
  }
  for (const l of listeners) l()
}

function setItems(fn: (items: ChatItem[]) => ChatItem[], persist = true) { set({ items: fn(state.items) }, persist) }

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const getState = () => state
const SERVER_STATE = state

export function useAgentState(): AgentState {
  return useSyncExternalStore(subscribe, getState, () => SERVER_STATE)
}

if (typeof window !== 'undefined') {
  // Sign-out (lib/assistants/history clearAllAgentHistory): forget everything in memory too.
  window.addEventListener(AGENT_RESET_EVENT, () => {
    // Signing out stops the turn (it is not moved to the background).
    if (state.job?.id) void postJob(state.job.id, { action: 'cancel' })
    abort?.abort()
    clearTimeout(pollTimer)
    set({ key: null, items: [], messages: [], busy: false, status: '', open: false, availability: null, pending: [], lastScreen: null, job: null, conversationId: null, merged: [], pendingTurn: null })
  })
  // Another tab changed this conversation: follow it (unless a turn is streaming here).
  window.addEventListener('storage', (e) => {
    if (!state.key || e.key !== storageKey(state.key) || abort) return
    const conv = loadConversation(state.key)
    const merged = conv.merged ?? []
    const followed = state.job && !state.job.live && merged.includes(state.job.turnId)
    set({
      items: conv.items, messages: conv.messages, conversationId: conv.id ?? state.conversationId, merged, pendingTurn: conv.pending_turn ?? null,
      ...(followed ? { job: null, busy: false, status: '' } : {}),
    })
  })
  // The bell's / a toast's "View": open the panel with the finished work merged.
  window.addEventListener(AGENT_OPEN_EVENT, () => {
    setAgentOpen(true)
    void syncAgentJobs()
  })
}

/* ── Wiring (the host) ── */

export function setAgentQueryClient(qc: QueryClient) { queryClient = qc }
export function setAgentContextProvider(fn: (() => RequestContext) | null) { contextProvider = fn }

/** The person + workspace's conversation (from availability). A different key loads that conversation. */
export function setAgentAvailability(availability: AssistantAvailability | null) {
  const key = availability?.history_key ?? null
  if (key !== state.key) {
    // Another person / workspace: this tab stops watching (the turn goes on in the background).
    if (state.key) abort?.abort()
    clearTimeout(pollTimer)
    const conv = key ? loadConversation(key) : emptyConversation()
    set({
      key, items: conv.items, messages: conv.messages, availability, pending: [], lastScreen: null,
      job: null, busy: false, status: '', conversationId: conv.id ?? newConversationId(), merged: conv.merged ?? [], pendingTurn: conv.pending_turn ?? null,
    })
    // Work that finished (or still runs) while this page was closed.
    if (key) void syncAgentJobs()
  } else if (availability !== state.availability) {
    set({ availability })
  }
}

export function setAgentView(view: AgentView) {
  const v = state.view
  if (v.label === view.label && v.dirty === view.dirty && v.starters.join('|') === view.starters.join('|')) return
  set({ view })
}

export function setAgentOpen(open: boolean) {
  try { window.sessionStorage.setItem(OPEN_STATE_KEY, open ? '1' : '0') } catch { /* ignore */ }
  const was = state.open
  set({ open })
  if (was && !open) panelClosed()
  if (!was && open) panelOpened()
}

/** "Ask Agent to fix": open the Agent with the failure attached and ask for a diagnosis. */
export function askAgentToFix(failure: ChatAttachment, rerun: { workflowId: string; values: Record<string, unknown> } | null, prompt: string) {
  fixRerun = rerun
  setAgentOpen(true)
  if (abort || state.job) return
  set({ pending: [failure] })
  sendAgentMessage(prompt)
}

/** "Re-run test" on a fixed workflow: the builder opens the test runner and runs the same inputs. */
export function requestRerunTest(rerun: { workflowId: string; values: Record<string, unknown> }) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(AGENT_RERUN_TEST_EVENT, { detail: rerun }))
}

/** Home → "Build from a process with Agent": open the panel ready to attach a process document. */
export function openAgentForProcess() {
  try { window.sessionStorage.setItem(OPEN_STATE_KEY, '1') } catch { /* ignore */ }
  set({ open: true, processIntent: state.processIntent + 1 })
}

/** Open the panel with a starter prompt in the composer, for the person to edit and send (nothing is sent). */
export function openAgentWithPrompt(text: string) {
  try { window.sessionStorage.setItem(OPEN_STATE_KEY, '1') } catch { /* ignore */ }
  const was = state.open
  set({ open: true, draftIntent: { text, n: (state.draftIntent?.n ?? 0) + 1 } })
  if (!was) panelOpened()
}

/** The form designer dialog hosts the panel while it is open (returns the unregister). */
export function registerAgentDock(): () => void {
  set({ docks: state.docks + 1 })
  return () => set({ docks: Math.max(0, state.docks - 1) })
}

/* ── Attachments ── */

export async function attachFiles(files: File[]): Promise<void> {
  if (!files.length || state.uploading) return
  const room = ATTACHMENT_LIMITS.maxFilesPerMessage - state.pending.length
  const errors: string[] = []
  if (room <= 0) { setItems((p) => [...p, { kind: 'error', id: uid('e'), text: `At most ${ATTACHMENT_LIMITS.maxFilesPerMessage} files per message` }], false); return }
  const chosen = files.slice(0, room)
  if (files.length > room) errors.push(`Only ${ATTACHMENT_LIMITS.maxFilesPerMessage} files per message — the rest were left out`)
  const form = new FormData()
  for (const f of chosen) {
    // PDFs may be larger for a model that reads PDFs itself (the server decides).
    const max = /\.pdf$/i.test(f.name) || f.type === 'application/pdf' ? ATTACHMENT_LIMITS.maxPdfBytes : ATTACHMENT_LIMITS.maxFileBytes
    if (f.size > max) { errors.push(`${f.name}: larger than ${max / 1024 / 1024} MB`); continue }
    form.append('files', f, f.name)
  }
  if (form.has('files')) {
    set({ uploading: true, status: 'Reading the files…' })
    try {
      const res = await fetch('/api/assistants/attachments', { method: 'POST', body: form, credentials: 'same-origin' })
      const body = await res.json().catch(() => null) as { attachments?: ChatAttachment[]; errors?: Array<{ name: string; error: string }>; error?: string } | null
      if (!res.ok) errors.push(body?.error ?? `The files could not be read (${res.status})`)
      else {
        set({ pending: [...state.pending, ...(body?.attachments ?? [])] })
        for (const e of body?.errors ?? []) errors.push(`${e.name}: ${e.error}`)
      }
    } catch {
      errors.push('Could not upload the files — check your connection')
    } finally {
      set({ uploading: false, status: '' })
    }
  }
  if (errors.length) setItems((p) => [...p, ...errors.map((text) => ({ kind: 'error' as const, id: uid('e'), text }))], false)
}

export function removePendingAttachment(index: number) {
  set({ pending: state.pending.filter((_, i) => i !== index) })
}

/* ── Turns ── */

let pollTimer: ReturnType<typeof setTimeout> | undefined
let syncing = false
/** The panel closed before the server named the turn's job: move it to the background once it does. */
let wantBackground = false
/** The person pressed Stop (or started a new conversation) during this turn. */
let userStopped = false
const POLL_MS = 3_000

function toast(detail: JobsToastDetail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<JobsToastDetail>(JOBS_TOAST_EVENT, { detail }))
}

async function postJob(id: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: Record<string, any> | null }> {
  try {
    const res = await fetch(`/api/assistants/jobs/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) }
  } catch {
    return { ok: false, status: 0, body: null }
  }
}

/** The request's short summary for the toast ("Build a patient intake process"). */
function currentSummary(): string {
  const last = [...state.items].reverse().find((it) => it.kind === 'user')
  const text = last && last.kind === 'user' ? last.text.replace(/\s+/g, ' ').trim() : ''
  if (!text) return 'your request'
  return text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text
}

const viewAction = { label: 'View', onClick: () => window.dispatchEvent(new Event(AGENT_OPEN_EVENT)), testId: 'agent-toast-view' }

/** Closing the panel mid-turn: keep working in the background (this tab keeps watching). */
function panelClosed() {
  const job = state.job
  if (!job?.live || !state.busy || job.background) return
  if (!job.id) { wantBackground = true; return }
  void moveToBackground(job.id)
}

async function moveToBackground(jobId: string) {
  const summary = currentSummary()
  const res = await postJob(jobId, { action: 'background' })
  if (state.job?.id !== jobId) return
  if (res.ok && res.body?.background) {
    set({ job: { ...state.job, background: true } })
    toast({ tone: 'info', title: `Agent is still working on “${summary}”`, body: "You'll get a notification when it's done.", action: viewAction })
  } else if (res.status === 409) {
    toast({ tone: 'info', title: 'The Agent keeps working while this tab is open', body: res.body?.error ?? 'It can\'t run in the background right now.', action: viewAction })
  }
}

/** Opening the panel: a turn this tab is watching needs no notification any more; merge finished work. */
function panelOpened() {
  wantBackground = false
  const job = state.job
  if (job?.live && job.id && job.background) {
    void postJob(job.id, { action: 'foreground' }).then((res) => {
      if (res.ok && state.job?.id === job.id) set({ job: { ...state.job, background: res.body?.background === true } })
    })
  }
  void syncAgentJobs()
}

function schedulePoll(ms = POLL_MS) {
  clearTimeout(pollTimer)
  pollTimer = setTimeout(() => { if (state.job && !state.job.live) void syncAgentJobs() }, ms)
}

/** Apply one panel event to the items (live, or replaying a background job). Returns false for the turn-level events. */
function createEventHandler(taskId: string | null) {
  let assistantId: string | null = null
  const appendText = (text: string) => {
    if (!assistantId) {
      const id = uid('a')
      assistantId = id
      setItems((prev) => [...prev, { kind: 'assistant', id, text }], false)
    } else {
      const id = assistantId
      setItems((prev) => prev.map((it) => (it.id === id && it.kind === 'assistant' ? { ...it, text: it.text + text } : it)), false)
    }
  }
  return (event: AssistantEvent): boolean => {
    switch (event.type) {
      case 'delta': appendText(event.text); return true
      case 'delta_reset':
        if (assistantId) { const id = assistantId; setItems((prev) => prev.filter((it) => it.id !== id), false); assistantId = null }
        return true
      case 'tool_start':
        assistantId = null
        set({ status: `${event.label}…` })
        setItems((prev) => [...prev, { kind: 'tool', id: `tool-${event.id}`, label: event.label, state: 'running' }], false)
        return true
      case 'tool_end':
        setItems((prev) => prev.map((it) => (it.id === `tool-${event.id}` && it.kind === 'tool' ? { ...it, state: event.ok ? 'ok' : 'error' } : it)), false)
        return true
      case 'proposal':
        assistantId = null
        setItems((prev) => [...prev, { kind: 'proposal', id: `proposal-${event.id}`, values: event.values, skipped: event.skipped, applied: {}, dismissed: false }])
        return true
      case 'draft':
        assistantId = null
        setItems((prev) => [...prev, { kind: 'draft', id: `draft-${event.id}`, draft: event.kind, text: event.text, taskId }])
        return true
      case 'outcome_suggestion':
        assistantId = null
        setItems((prev) => [...prev, { kind: 'outcome', id: `outcome-${event.id}`, outcome: event.outcome, reason: event.reason }])
        return true
      case 'info_card': {
        assistantId = null
        const { type, ...card } = event
        void type
        setItems((prev) => [...prev, { ...card, kind: 'info', id: `info-${event.id}` }])
        return true
      }
      case 'confirm':
        assistantId = null
        setItems((prev) => [...prev, { kind: 'confirm', id: `confirm-${event.card.tool_call_id}`, card: event.card, state: 'pending', at: Date.now() }])
        return true
      case 'choice':
        assistantId = null
        setItems((prev) => [...prev, { kind: 'choice', id: `choice-${event.id}`, question: event.question, options: event.options, ...(event.allow_other ? { allow_other: true } : {}), ...(event.multi ? { multi: true } : {}), answered: null }])
        return true
      case 'changed':
        assistantId = null
        setItems((prev) => [...prev, {
          kind: 'changed', id: uid('c'), title: event.title, href: event.href, action: event.action, itemKind: event.kind,
          rerun: fixRerun && event.kind === 'workflow' && event.id === fixRerun.workflowId && event.action === 'updated' ? fixRerun : null,
        }])
        announceChange(event)
        // Open lists and editors read the change (editors with local state reload on the announcement).
        void queryClient?.invalidateQueries()
        return true
      default:
        return false
    }
  }
}

/**
 * Merge a finished background job into the conversation (once per turn):
 * what this tab showed live of that turn is replaced by the full replay,
 * then the messages are appended.
 */
export function mergeAgentTranscript(t: AgentTranscript) {
  if (state.merged.includes(t.turn_id)) return
  const pending = state.pendingTurn?.turn_id === t.turn_id ? state.pendingTurn : null
  if (pending?.after_item) {
    const i = state.items.findIndex((it) => it.id === pending.after_item)
    if (i >= 0) set({ items: state.items.slice(0, i + 1) })
  }
  const handle = createEventHandler(null)
  for (const event of t.events ?? []) handle(event)
  const extra: ChatItem[] = []
  if (t.truncated) extra.push({ kind: 'assistant', id: uid('a'), text: '_Part of the Agent\'s activity was too long to keep; the result is below._' })
  if (t.outcome === 'failed' && t.error) extra.push({ kind: 'error', id: uid('e'), text: t.error })
  if (t.outcome === 'cancelled') extra.push({ kind: 'error', id: uid('e'), text: 'Stopped.' })
  set({
    items: [...state.items.map((it) => (it.kind === 'tool' && it.state === 'running' ? { ...it, state: 'error' as const } : it)), ...extra],
    messages: [...state.messages, ...(t.messages ?? [])],
    merged: withMergedTurn(state.merged, t.turn_id),
    pendingTurn: pending ? null : state.pendingTurn,
    status: '',
  }, true)
}

/**
 * The conversation's background jobs: merge finished ones (and acknowledge
 * them, which drops their transcript on the server), follow a running one.
 */
export async function syncAgentJobs(): Promise<void> {
  const conversationId = state.conversationId
  if (syncing || !state.key || !conversationId) return
  syncing = true
  try {
    const res = await fetch(`/api/assistants/jobs?conversation_id=${encodeURIComponent(conversationId)}`, { credentials: 'same-origin', cache: 'no-store' })
    if (!res.ok || state.conversationId !== conversationId) return
    const { jobs } = await res.json() as { jobs: AgentJobView[] }
    const liveTurn = state.job?.live ? state.job.turnId : null
    for (const j of jobs) {
      if (!j.transcript || j.turn_id === liveTurn) continue
      mergeAgentTranscript(j.transcript)
      void postJob(j.id, { action: 'ack', read: state.open })
    }
    if (state.job?.live) return
    const running = jobs.find((j) => (j.status === 'running' || j.status === 'queued') && j.turn_id !== liveTurn)
    if (running) {
      const message = running.message && running.message !== 'Thinking…' ? running.message : null
      set({
        job: { id: running.id, turnId: running.turn_id, live: false, background: running.background, message },
        busy: true,
        status: userStopped ? 'Stopping…' : message ? `Working in the background: ${message}` : 'Working in the background…',
      })
      schedulePoll()
    } else if (state.job) {
      // The followed job finished (merged above) or is gone.
      const turn = state.job.turnId
      set({ job: null, busy: false, status: '', pendingTurn: state.pendingTurn?.turn_id === turn ? null : state.pendingTurn }, true)
      userStopped = false
    } else if (state.pendingTurn && !abort) {
      // A turn in flight before a reload that left no job (it never became one): nothing to wait for.
      set({ pendingTurn: null }, true)
    }
  } catch {
    if (state.job && !state.job.live) schedulePoll(POLL_MS * 2)
  } finally {
    syncing = false
  }
}

async function run(body: { text?: string; display?: string; decision?: { tool_call_id: string; approved: boolean } }) {
  if (abort || state.job) return
  const ctx = contextProvider?.() ?? { form_id: null, task_id: null, designer: null, screen: null, readForm: false }
  if (body.text !== undefined) {
    const attachments = state.pending
    const screenLabel = ctx.screen?.label ?? null
    const newItems: ChatItem[] = []
    // A divider when the conversation continues on another screen.
    if (screenLabel && state.lastScreen && screenLabel !== state.lastScreen && state.items.length) newItems.push({ kind: 'screen', id: uid('s'), label: screenLabel })
    newItems.push({ kind: 'user', id: uid('u'), text: body.display ?? body.text, ...(attachments.length ? { attachments: attachments.map((a) => ({ name: a.name, mime_type: a.mime_type, size: a.size, ...(a.kind === 'failed' && a.error ? { error: a.error } : {}) })) } : {}) })
    set({
      messages: [...state.messages, { role: 'user', content: body.text, ...(attachments.length ? { attachments } : {}) }],
      items: [...state.items, ...newItems],
      pending: [],
      lastScreen: screenLabel ?? state.lastScreen,
    }, true)
  }
  const controller = new AbortController()
  abort = controller
  userStopped = false
  wantBackground = !state.open
  const turnId = newTurnId()
  const conversationId = state.conversationId ?? newConversationId()
  set({
    busy: true, status: 'The Agent is thinking…', conversationId,
    job: { id: null, turnId, live: true, background: false, message: null },
    pendingTurn: { turn_id: turnId, after_item: state.items[state.items.length - 1]?.id ?? null },
  }, true)
  const handleItem = createEventHandler(ctx.task_id)
  const handle = (event: AssistantEvent) => {
    if (handleItem(event)) return
    switch (event.type) {
      case 'job':
        if (state.job?.turnId !== turnId) break
        set({ job: { ...state.job, id: event.id } })
        if (wantBackground && !state.open) { wantBackground = false; void moveToBackground(event.id) }
        break
      case 'messages':
        if (state.job?.turnId !== turnId) break // the conversation was cleared meanwhile
        set({ messages: [...state.messages, ...event.messages], merged: withMergedTurn(state.merged, turnId), pendingTurn: null }, true)
        break
      case 'error':
        if (event.code !== 'cancelled') setItems((prev) => [...prev, { kind: 'error', id: uid('e'), text: event.error }])
        break
      default:
        break
    }
  }
  let unanswered = false
  try {
    const bridge = ctx.readForm ? currentFormBridge() : null
    const res = await fetch('/api/assistants/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      credentials: 'same-origin',
      signal: controller.signal,
      body: JSON.stringify({
        messages: withRecentImages(state.messages),
        context: { form_id: ctx.form_id, task_id: ctx.task_id, form: bridge ? bridge.snapshot() : null, designer: ctx.designer, screen: ctx.screen, admin: ctx.admin ?? null },
        ...(body.decision ? { decision: body.decision } : {}),
        turn_id: turnId,
        conversation_id: conversationId,
      }),
    })
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => null) as { error?: string } | null
      handle({ type: 'error', error: err?.error ?? `The Agent is unavailable (${res.status})` })
      // The message wasn't answered: keep the conversation consistent for the next try.
      if (body.text !== undefined) set({ messages: state.messages.slice(0, -1) }, true)
      unanswered = true
      return
    }
    const reader = res.body.getReader()
    const parser = new SseParser()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const ev of parser.push(value)) {
        try { handle(JSON.parse(ev.data) as AssistantEvent) } catch { /* ignore a malformed event */ }
      }
    }
    for (const ev of parser.end()) {
      try { handle(JSON.parse(ev.data) as AssistantEvent) } catch { /* ignore */ }
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') {
      if (userStopped) setItems((prev) => [...prev, { kind: 'error', id: uid('e'), text: 'Stopped.' }])
    } else if (!getState().job?.id) {
      handle({ type: 'error', error: 'Could not reach the Agent — check your connection and try again' })
    }
  } finally {
    abort = null
    const current = getState().job
    const job = current?.turnId === turnId ? current : null
    const delivered = state.merged.includes(turnId)
    if (!delivered && !unanswered && !userStopped && job?.id && state.key) {
      // The live view broke (connection, workspace switch) but the job goes on: follow it.
      set({ job: { ...job, live: false }, status: 'Working in the background…' }, true)
      schedulePoll(1_000)
    } else {
      set({
        busy: false, status: '', job: null,
        // A stopped turn is never merged later (what it showed stays as it is).
        merged: userStopped ? withMergedTurn(state.merged, turnId) : state.merged,
        pendingTurn: state.pendingTurn?.turn_id === turnId ? null : state.pendingTurn,
      }, true)
      // Watched to the end after the panel closed: the server's copy is no longer needed.
      if (job?.id && job.background && delivered) void postJob(job.id, { action: 'ack', read: state.open })
      userStopped = false
    }
  }
}

function newTurnId(): string {
  try { return crypto.randomUUID() } catch {
    const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
    return `${h()}${h()}-${h()}-4${h().slice(1)}-8${h().slice(1)}-${h()}${h()}${h()}`
  }
}

/**
 * Image bytes go with the latest two user messages that carry images; PDF
 * bytes (and page images) with the latest user message that carries a PDF,
 * so follow-up questions in this session still see it (the provider caches
 * it). Older ones are sent as their stored form: a PDF's text, or "no longer
 * available — re-attach it". Nothing of this is in the stored history.
 */
function withRecentImages(messages: ChatMessage[]): ChatMessage[] {
  let keptImages = 0
  let keptPdf = false
  const out = [...messages]
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i]
    if (m.role !== 'user' || !m.attachments?.some((a) => a.kind === 'image' || a.kind === 'document')) continue
    const hasImage = m.attachments.some((a) => a.kind === 'image')
    const hasPdf = m.attachments.some((a) => a.kind === 'document')
    const keepImages = hasImage && keptImages < 2
    const keepPdf = hasPdf && !keptPdf
    if (hasImage && keepImages) keptImages++
    if (hasPdf && keepPdf) keptPdf = true
    if ((!hasImage || keepImages) && (!hasPdf || keepPdf)) continue
    out[i] = { ...m, attachments: m.attachments.map((a) => ((a.kind === 'image' && !keepImages) || (a.kind === 'document' && !keepPdf) ? attachmentForStorage(a) : a)) }
  }
  return out
}

export function sendAgentMessage(text: string, options: { display?: string } = {}) {
  const trimmed = text.trim()
  if ((!trimmed && !state.pending.length) || abort || state.job || state.uploading) return
  // An unanswered confirmation / question is closed by moving on (the server answers it as "not confirmed").
  setItems((prev) => prev.map((it) => (it.kind === 'confirm' && it.state === 'pending' ? { ...it, state: 'declined' } : it.kind === 'choice' && !it.answered ? { ...it, answered: '—' } : it)))
  void run({ text: trimmed || 'Please look at the attached file(s).', ...(options.display ? { display: options.display } : {}) })
}

/**
 * Answer a question card (ask_user): the chosen option(s) and / or the
 * "Other…" text become the person's next message — their bubble shows the
 * labels ("Assign to me for testing"), the model reads each option's reply.
 */
export function answerChoice(itemId: string, picked: Array<{ label: string; reply: string }>, other?: string | null) {
  if (abort || state.job || state.uploading) return
  const index = state.items.findIndex((it) => it.id === itemId)
  const item = state.items[index]
  if (!item || item.kind !== 'choice' || choiceStatus(state.items, index) !== 'open') return
  const answer = choiceAnswer(item.options, picked, item.allow_other ? other : null)
  if (!answer) return
  setItems((prev) => prev.map((it) => (it.id === itemId && it.kind === 'choice' ? { ...it, answered: answer.display } : it)))
  sendAgentMessage(answer.reply, { display: answer.display })
}

export function decideAgentChange(itemId: string, toolCallId: string, approved: boolean) {
  if (abort || state.job) return
  setItems((prev) => prev.map((it) => (it.id === itemId && it.kind === 'confirm' ? { ...it, state: approved ? 'approved' : 'declined' } : it)))
  void run({ decision: { tool_call_id: toolCallId, approved } })
}

/** Stop: cancel the job (it stops at its next step), then stop watching. */
export async function stopAgent(): Promise<void> {
  const job = state.job
  if (!job) { abort?.abort(); return }
  userStopped = true
  set({ status: 'Stopping…' })
  // Cancel first, so the server doesn't take the dropped connection as "continue in the background".
  if (job.id) await postJob(job.id, { action: 'cancel' })
  if (abort) abort.abort()
  else schedulePoll(1_000)
}

/** New conversation: forget this person + workspace's stored conversation (a running turn is stopped). */
export function clearAgentConversation() {
  if (state.job) {
    userStopped = true
    if (state.job.id) void postJob(state.job.id, { action: 'cancel' })
    abort?.abort()
  }
  clearTimeout(pollTimer)
  set({ messages: [], items: [], pending: [], lastScreen: null, job: null, busy: false, status: '', conversationId: newConversationId(), merged: [], pendingTurn: null }, true)
}

/** Apply proposed values through the live form (each re-checked there). */
export function applyProposedValues(itemId: string, keys: string[]) {
  const item = state.items.find((it) => it.id === itemId)
  if (!item || item.kind !== 'proposal') return
  const bridge = currentFormBridge()
  const applied = { ...item.applied }
  for (const key of keys) {
    const value = item.values.find((v) => v.key === key)
    if (!value || applied[key] === 'applied') continue
    if (!bridge) { applied[key] = 'The form is no longer open'; continue }
    const result = bridge.apply(key, value.proposed)
    applied[key] = result.ok ? 'applied' : result.reason
  }
  setItems((prev) => prev.map((it) => (it.id === itemId && it.kind === 'proposal' ? { ...it, applied } : it)))
}

export function dismissProposal(itemId: string) {
  setItems((prev) => prev.map((it) => (it.id === itemId && it.kind === 'proposal' ? { ...it, dismissed: true } : it)))
}
