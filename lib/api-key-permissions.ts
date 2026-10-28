import { canUserSeeTask } from '@/lib/task-authz'
import type { ApiKeyScopes, ApiKeySuccessResult } from '@/lib/api-auth'

function uniqueIds(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)))
}

export function normalizeApiKeyScopes(raw: unknown): ApiKeyScopes {
  const next = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    workflow_ids: uniqueIds(next.workflow_ids),
    table_ids: uniqueIds(next.table_ids),
  }
}

export function hasWorkflowScope(auth: ApiKeySuccessResult) {
  return auth.scopes.workflow_ids.length > 0
}

export function hasTableScope(auth: ApiKeySuccessResult) {
  return auth.scopes.table_ids.length > 0
}

export function canAccessWorkflow(auth: ApiKeySuccessResult, workflowId: string) {
  return !hasWorkflowScope(auth) || auth.scopes.workflow_ids.includes(workflowId)
}

export function canAccessTable(auth: ApiKeySuccessResult, tableId: string) {
  return !hasTableScope(auth) || auth.scopes.table_ids.includes(tableId)
}

export async function getAccessibleTaskIdsForUser(supabase: any, tenantId: string, userId: string) {
  const { data } = await (supabase as any)
    .from('task_assignees')
    .select('task_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)

  return Array.from(new Set((data ?? []).map((row: any) => String(row.task_id ?? '')).filter(Boolean)))
}

/**
 * Can a user-bound credential see / touch this task? Their own tasks
 * (assignee, collaborator, member of the assigned team) and their reports'
 * tasks (manager chain). Actioning a workflow task is stricter — see
 * lib/task-authz.ts (authorizeTaskAction).
 */
export async function canAccessTaskAsUser(supabase: any, tenantId: string, userId: string, taskId: string) {
  return canUserSeeTask(supabase, tenantId, userId, taskId)
}
