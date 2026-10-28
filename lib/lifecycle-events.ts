import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Task lifecycle event types written by the app. The base enum values come
 * from the original schema; the task_* values are added by
 * 20260711_task_hardening.sql; task_data_saved by 20261015000004_strip_back.sql.
 */
export type TaskLifecycleEventType =
  | 'task_accepted' | 'task_held' | 'task_rejected' | 'task_redirected'
  | 'task_escalated' | 'task_response' | 'task_unanimous_failed' | 'task_data_saved'
  | 'created' | 'assigned' | 'started' | 'reassigned' | 'escalated'
  | 'redirected' | 'delegated' | 'snoozed' | 'blocked' | 'unblocked'
  | 'completed' | 'cancelled' | 'reopened' | 'comment_added'

/**
 * Canonical lifecycle-event writer. Historically two different row shapes
 * were written ({task_id, event_type} from the v1 route vs
 * {entity_type, entity_id, actor_id} from the agent tool) — every writer now
 * goes through this one shape so timeline consumers see consistent rows.
 *
 * Never throws: an audit-trail failure must not break the user's action.
 */
export async function writeLifecycleEvent(params: {
  supabase: SupabaseClient
  tenantId: string
  taskId?: string | null
  eventType: TaskLifecycleEventType
  actorId?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const { supabase, tenantId, taskId, eventType, actorId, metadata } = params
  try {
    if (!tenantId || !taskId || !eventType) return
    await (supabase as any).from('lifecycle_events').insert({
      tenant_id: tenantId,
      task_id: taskId,
      event_type: eventType,
      actor_id: actorId ?? null,
      metadata: metadata ?? null,
    })
  } catch (error) {
    console.warn('[lifecycle-events] write failed:', error)
  }
}
