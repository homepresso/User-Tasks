/**
 * Realtime topics (shared by the browser providers and the SSE route).
 *
 * A topic is one of the tables published for realtime; a filter narrows it to
 * one column value (`column=eq.value`, the shape Supabase postgres_changes
 * takes) and/or one operation. Both providers deliver the same change shape:
 * the table, the operation and the changed row ids. The client refetches
 * through the normal read APIs (React Query invalidation); the SSE provider
 * never carries row data.
 */

export type RealtimeOp = 'INSERT' | 'UPDATE' | 'DELETE'
export type RealtimeEvent = '*' | RealtimeOp

interface TopicDef {
  /** Columns a subscription may filter on. */
  readonly columns: readonly string[]
  /** Filter columns whose value must be the subscriber's own user id. */
  readonly userScoped?: readonly string[]
  /** Filter columns holding a task id (the SSE route checks the task is visible). */
  readonly taskScoped?: readonly string[]
  /** A user-scoped filter is mandatory (the topic is per user). */
  readonly requiresUserFilter?: boolean
  /** Log stream (needs the settings.view permission, like the live log reads). */
  readonly log?: boolean
}

export const REALTIME_TOPICS = {
  tasks: {
    columns: ['id', 'tenant_id', 'assignee_id', 'assigner_id', 'parent_task_id'],
    userScoped: ['assignee_id', 'assigner_id'],
    taskScoped: ['id', 'parent_task_id'],
  },
  task_assignees: { columns: ['tenant_id', 'user_id', 'task_id'], userScoped: ['user_id'], taskScoped: ['task_id'] },
  notifications: { columns: ['user_id'], userScoped: ['user_id'], requiresUserFilter: true },
  /** Background jobs (lib/user-jobs): per user, like notifications. */
  user_jobs: { columns: ['user_id'], userScoped: ['user_id'], requiresUserFilter: true },
  lifecycle_events: { columns: ['tenant_id', 'task_id'], taskScoped: ['task_id'] },
  workflow_logs: { columns: ['tenant_id'], log: true },
  object_audit_log: { columns: ['tenant_id'], log: true },
  integration_call_logs: { columns: ['tenant_id'], log: true },
  agent_runs: { columns: ['tenant_id'], log: true },
} as const satisfies Record<string, TopicDef>

export type RealtimeTopic = keyof typeof REALTIME_TOPICS
export const REALTIME_TOPIC_NAMES = Object.keys(REALTIME_TOPICS) as RealtimeTopic[]

/**
 * Columns (besides id and tenant_id) the NOTIFY triggers put in each row of
 * the payload, so the server can match filters and audiences without reading
 * the row. Mirrors the trigger arguments in
 * supabase/migrations/20261105000000_realtime_notify.sql.
 */
export const NOTIFY_COLUMNS: Record<RealtimeTopic, readonly string[]> = {
  tasks: ['assignee_id', 'assigner_id', 'parent_task_id'],
  task_assignees: ['user_id', 'task_id'],
  notifications: ['user_id'],
  user_jobs: ['user_id'],
  lifecycle_events: ['task_id'],
  workflow_logs: [],
  object_audit_log: [],
  integration_call_logs: [],
  agent_runs: [],
}

export interface RealtimeFilter {
  /** Filter column (one of the topic's columns); requires `value`. */
  column?: string
  value?: string
  /** Operation to listen for (default all). */
  event?: RealtimeEvent
}

export interface RealtimeChange {
  topic: RealtimeTopic
  /**
   * RESYNC: changes may have been missed (reconnect beyond the replay
   * window, server backpressure); treat as "anything may have changed".
   */
  op: RealtimeOp | 'RESYNC'
  /** Changed row ids; null when unknown (bulk statements, resync). */
  ids: string[] | null
  /** The new row — Supabase provider only (postgres_changes carries it). */
  record?: Record<string, unknown>
}

export type RealtimeStatus = 'connecting' | 'live' | 'error' | 'closed'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENTS: readonly RealtimeEvent[] = ['*', 'INSERT', 'UPDATE', 'DELETE']

export function isRealtimeTopic(value: unknown): value is RealtimeTopic {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REALTIME_TOPICS, value)
}

export function topicDef(topic: RealtimeTopic): TopicDef {
  return REALTIME_TOPICS[topic]
}

/** Structural check of a subscription (no authorisation). Returns an error message or null. */
export function validateSubscription(topic: unknown, filter: RealtimeFilter): string | null {
  if (!isRealtimeTopic(topic)) return `unknown topic "${String(topic)}"`
  const def = topicDef(topic)
  if (filter.event !== undefined && !EVENTS.includes(filter.event)) return `invalid event "${String(filter.event)}"`
  if (filter.column === undefined) {
    if (filter.value !== undefined) return 'value without column'
    if (def.requiresUserFilter) return `${topic} must be filtered by user`
    return null
  }
  if (!def.columns.includes(filter.column)) return `${topic} cannot be filtered by "${filter.column}"`
  if (typeof filter.value !== 'string' || !UUID.test(filter.value)) return 'filter value must be a uuid'
  if (def.requiresUserFilter && !def.userScoped?.includes(filter.column)) return `${topic} must be filtered by user`
  return null
}

/** Stable key for one subscription (`topic|column=eq.value|event`). */
export function subscriptionKey(topic: RealtimeTopic, filter: RealtimeFilter = {}): string {
  const where = filter.column ? `${filter.column}=eq.${(filter.value ?? '').toLowerCase()}` : ''
  return `${topic}|${where}|${filter.event ?? '*'}`
}

export interface ParsedSubscription {
  key: string
  topic: RealtimeTopic
  filter: RealtimeFilter
}

/** Inverse of subscriptionKey; null when malformed or invalid. */
export function parseSubscriptionKey(key: string): ParsedSubscription | null {
  if (typeof key !== 'string' || key.length > 200) return null
  const parts = key.split('|')
  if (parts.length !== 3) return null
  const [topic, where, event] = parts
  const filter: RealtimeFilter = { event: event as RealtimeEvent }
  if (where) {
    const m = /^([a-z_]+)=eq\.(.+)$/.exec(where)
    if (!m) return null
    filter.column = m[1]
    filter.value = m[2]
  }
  if (validateSubscription(topic, filter)) return null
  return { key: subscriptionKey(topic as RealtimeTopic, filter), topic: topic as RealtimeTopic, filter }
}

/** Supabase postgres_changes filter string for a subscription. */
export function postgresChangesFilter(filter: RealtimeFilter): string | undefined {
  return filter.column && filter.value ? `${filter.column}=eq.${filter.value}` : undefined
}
