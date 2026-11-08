/**
 * The Agent's conversation in the browser (client-safe, no React).
 *
 * Storage choice: localStorage, one entry per person + workspace. The key is
 * the opaque `history_key` the server returns with availability (sha-256 of
 * user id + workspace id: lib/services/assistants agentHistoryKey), so
 *  - the conversation survives navigation, the form designer dialog and a
 *    reload, and is shared by the dashboard and the standalone form page;
 *  - another person on the same browser, or the same person in another
 *    workspace, gets a different (empty) conversation — never this one;
 *  - signing out removes every stored conversation on the device
 *    (clearAllAgentHistory, called by lib/auth-client and the dashboard auth
 *    context).
 * Nothing new is stored server-side: the server never trusts this history
 * anyway (it is re-sanitised and every tool re-checks permissions per request).
 *
 * Size caps (trimConversation): the last MAX_STORED_MESSAGES model messages
 * (starting at a user message) and MAX_STORED_ITEMS panel items, and at most
 * MAX_STORED_CHARS characters in all — the oldest turns go first. Image bytes
 * are never stored (attachments-core attachmentForStorage).
 */
import { attachmentForStorage } from './attachments-core'
import type { ChatMessage, ChoiceOption, ConfirmCard, ProposedValue } from './types'

export type AttachmentChip = { name: string; mime_type: string; size: number }

export type ChatItem =
  | { kind: 'user'; id: string; text: string; attachments?: AttachmentChip[] }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; label: string; state: 'running' | 'ok' | 'error' }
  | { kind: 'proposal'; id: string; values: ProposedValue[]; skipped: Array<{ key: string; reason: string }>; applied: Record<string, 'applied' | string>; dismissed: boolean }
  | { kind: 'draft'; id: string; draft: 'comment' | 'outcome_note'; text: string; taskId?: string | null }
  | { kind: 'outcome'; id: string; outcome: string; reason: string }
  | { kind: 'confirm'; id: string; card: ConfirmCard; state: 'pending' | 'approved' | 'declined' | 'expired'; at?: number }
  /** answered: the label(s) chosen, or '—' when the person moved on without answering (expired). */
  | { kind: 'choice'; id: string; question: string; options: ChoiceOption[]; allow_other?: boolean; multi?: boolean; answered?: string | null }
  | { kind: 'changed'; id: string; title: string; href: string | null; action: 'created' | 'updated' | 'deleted'; itemKind: string; rerun?: { workflowId: string; values: Record<string, unknown> } | null }
  | { kind: 'screen'; id: string; label: string }
  | { kind: 'error'; id: string; text: string }

export interface StoredConversation {
  v: 1
  items: ChatItem[]
  messages: ChatMessage[]
  updated_at: number
  /** This conversation (a new conversation gets a new id): background Agent jobs merge only into theirs. */
  id?: string
  /** Turn ids already in the conversation (live or merged from a background job), newest last. */
  merged?: string[]
  /** The turn in flight: its id and the last item before its output (a merge replaces what was shown live). */
  pending_turn?: { turn_id: string; after_item: string | null } | null
}

/** Turn ids remembered per conversation (merging is idempotent within them). */
export const MAX_MERGED_TURNS = 50

export function newConversationId(): string {
  try { return crypto.randomUUID().replace(/-/g, '') } catch { return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}` }
}

/** Remember a turn as merged (bounded). */
export function withMergedTurn(merged: string[] | undefined, turnId: string): string[] {
  const list = (merged ?? []).filter((t) => t !== turnId)
  return [...list, turnId].slice(-MAX_MERGED_TURNS)
}

export const STORAGE_PREFIX = 'usertasks.agent.v1.'
export const OPEN_STATE_KEY = 'usertasks.agent.open'
export const MAX_STORED_MESSAGES = 60
export const MAX_STORED_ITEMS = 150
export const MAX_STORED_CHARS = 400_000
/** A confirmation card left pending longer than this expires (the change is not made). */
export const CONFIRM_TTL_MS = 60 * 60 * 1000

export function storageKey(historyKey: string): string {
  return `${STORAGE_PREFIX}${historyKey}`
}

export function emptyConversation(): StoredConversation {
  return { v: 1, items: [], messages: [], updated_at: Date.now(), id: newConversationId(), merged: [] }
}

/** Drop messages from the front until the list starts at a user message. */
function startAtUser(messages: ChatMessage[]): ChatMessage[] {
  let i = 0
  while (i < messages.length && messages[i].role !== 'user') i++
  return messages.slice(i)
}

/** The conversation within the caps (oldest turns dropped first; image bytes removed). */
export function trimConversation(conv: StoredConversation, caps = { messages: MAX_STORED_MESSAGES, items: MAX_STORED_ITEMS, chars: MAX_STORED_CHARS }): StoredConversation {
  let messages = conv.messages.map((m) => (m.attachments?.length ? { ...m, attachments: m.attachments.map(attachmentForStorage) } : m))
  if (messages.length > caps.messages) messages = startAtUser(messages.slice(-caps.messages))
  let items = conv.items.slice(-caps.items)
  const size = () => JSON.stringify(messages).length + JSON.stringify(items).length
  while (size() > caps.chars && (messages.length > 1 || items.length > 1)) {
    if (messages.length > 1) messages = startAtUser(messages.slice(Math.max(1, Math.ceil(messages.length / 4))))
    if (items.length > 1) items = items.slice(Math.max(1, Math.ceil(items.length / 4)))
  }
  if (size() > caps.chars) { messages = []; items = [] }
  return { v: 1, items, messages, updated_at: conv.updated_at, ...(conv.id ? { id: conv.id } : {}), ...(conv.merged?.length ? { merged: conv.merged.slice(-MAX_MERGED_TURNS) } : {}), ...(conv.pending_turn ? { pending_turn: conv.pending_turn } : {}) }
}

/** Pending confirmation cards older than the TTL expire (nothing is changed; the next message answers them as not confirmed). */
export function expireStaleConfirms(items: ChatItem[], now = Date.now()): ChatItem[] {
  return items.map((it) => (it.kind === 'confirm' && it.state === 'pending' && (it.at ?? 0) + CONFIRM_TTL_MS < now ? { ...it, state: 'expired' as const } : it))
}

/**
 * A question card's state: answered (shows the answer, disabled), open (its
 * buttons work — only while it is the latest thing the person can answer: no
 * message of theirs after it), or expired (moved on without answering).
 */
export function choiceStatus(items: readonly ChatItem[], index: number): 'answered' | 'open' | 'expired' {
  const item = items[index]
  if (!item || item.kind !== 'choice') return 'expired'
  if (item.answered && item.answered !== '—') return 'answered'
  if (item.answered === '—') return 'expired'
  for (let i = index + 1; i < items.length; i++) {
    const later = items[i]
    if (later.kind === 'user' || (later.kind === 'choice' && !later.answered)) return 'expired'
  }
  return 'open'
}

/** The person's message for a question card's answer (labels for the bubble; the reply text for the model). */
export function choiceAnswer(options: readonly ChoiceOption[], picked: readonly ChoiceOption[], other?: string | null): { display: string; reply: string } | null {
  const typed = typeof other === 'string' ? other.trim().slice(0, 1000) : ''
  const chosen = picked.filter((p) => options.some((o) => o.label === p.label))
  if (!chosen.length && !typed) return null
  const display = [...chosen.map((o) => o.label), ...(typed ? [typed] : [])].join(', ')
  const reply = [...chosen.map((o) => o.reply), ...(typed ? [typed] : [])].join('; ')
  return { display, reply }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

function storage(): StorageLike | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

export function loadConversation(historyKey: string, store: StorageLike | null = storage()): StoredConversation {
  if (!store) return emptyConversation()
  try {
    const raw = store.getItem(storageKey(historyKey))
    if (!raw) return emptyConversation()
    const parsed = JSON.parse(raw) as Partial<StoredConversation>
    if (parsed?.v !== 1 || !Array.isArray(parsed.items) || !Array.isArray(parsed.messages)) return emptyConversation()
    // A turn interrupted by the reload: its running chips are no longer running.
    const items = expireStaleConfirms(parsed.items.map((it) => (it.kind === 'tool' && it.state === 'running' ? { ...it, state: 'error' as const } : it)))
    const id = typeof parsed.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(parsed.id) ? parsed.id : newConversationId()
    const merged = Array.isArray(parsed.merged) ? parsed.merged.filter((t): t is string => typeof t === 'string').slice(-MAX_MERGED_TURNS) : []
    const p = parsed.pending_turn
    const pending_turn = p && typeof p.turn_id === 'string' ? { turn_id: p.turn_id, after_item: typeof p.after_item === 'string' ? p.after_item : null } : null
    return { v: 1, items, messages: parsed.messages, updated_at: Number(parsed.updated_at) || 0, id, merged, pending_turn }
  } catch {
    return emptyConversation()
  }
}

export function saveConversation(historyKey: string, conv: StoredConversation, store: StorageLike | null = storage()): void {
  if (!store) return
  const trimmed = trimConversation(conv)
  try {
    if (!trimmed.items.length && !trimmed.messages.length && !trimmed.merged?.length && !trimmed.pending_turn) store.removeItem(storageKey(historyKey))
    else store.setItem(storageKey(historyKey), JSON.stringify(trimmed))
  } catch {
    // Quota: keep only the newest quarter, else give up quietly (the conversation still lives in memory).
    try { store.setItem(storageKey(historyKey), JSON.stringify(trimConversation(trimmed, { messages: 15, items: 40, chars: 100_000 }))) } catch { /* ignore */ }
  }
}

export const AGENT_RESET_EVENT = 'usertasks:agent-reset'
/** Window event that opens the Agent panel and merges finished background work (the bell, toasts). */
export const AGENT_OPEN_EVENT = 'usertasks:agent-open'

/** Remove every stored Agent conversation on this device (sign-out). */
export function clearAllAgentHistory(store: StorageLike | null = storage()): void {
  if (store) {
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k)
    }
    for (const k of keys) { try { store.removeItem(k) } catch { /* ignore */ } }
  }
  try { if (typeof window !== 'undefined') window.sessionStorage.removeItem(OPEN_STATE_KEY) } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AGENT_RESET_EVENT))
}
