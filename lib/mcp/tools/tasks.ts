import type { McpToolServer } from '../server'
import { buildTaskDataObject } from '@/lib/task-data'
import { z } from 'zod'
import type { McpContext } from '../server'
import { mcpOk, mcpErr } from '../server'
import { canAccessTaskAsUser, getAccessibleTaskIdsForUser } from '@/lib/api-key-permissions'
import { mergeTaskFieldValuesChecked } from '@/lib/forms/task-values'
import { kickQueueProcessor } from '@/lib/process-queue'
import type { Json } from '@/lib/database.types'
import { sanitizeTaskDescription } from '@/lib/html-sanitize'
import { withDescriptionText } from '@/lib/task-description-format'
import { fromMcpContext } from '@/lib/services/context'

const DESCRIPTION_HTML = 'Plain text or HTML (sanitised to an allowlist: formatting, lists, headings, links, tables, https images)'

const taskFieldValuesSchema = z.record(z.string(), z.unknown()).optional()
  .describe('Values for the user_task node\'s fields, keyed by field key (see tasks_get → metadata.fields). Stored on the task as task.data.<key> and passed to the resumed workflow as {{task_data.<key>}}.')

export function registerTaskTools(server: McpToolServer, ctx: McpContext) {
  const { tenantId, supabase } = ctx
  const actingUserId = ctx.actingUserId ?? null

  /** Shared completion service (assignee, or manager on behalf). */
  async function completeWorkflow(args: { task_id: string; outcome: string; notes?: string; values?: Record<string, unknown>; on_behalf?: boolean; on_behalf_note?: string }) {
    try {
      const { completeWorkflowTaskAction } = await import('@/lib/services/task-actions')
      const result = await completeWorkflowTaskAction(fromMcpContext(ctx), args.task_id, {
        outcome: args.outcome, notes: args.notes ?? null, values: args.values ?? null,
        onBehalf: args.on_behalf === true, onBehalfNote: args.on_behalf_note ?? null,
      }, { via: 'mcp' })
      kickQueueProcessor()
      if (result.status === 'invalid') return mcpErr(`Invalid field values: ${Object.values(result.errors).join('; ')}`)
      if (result.status === 'waiting') return mcpOk({ completed: false, status: 'waiting', task_id: args.task_id, responses: result.responses, needed: result.needed, acted_as: result.acted_as, on_behalf_of: result.on_behalf_of })
      return mcpOk({
        completed: true, task_id: args.task_id, outcome: result.outcome, workflow_resumed: result.workflow_resumed,
        ...(result.workflow_resumed ? { workflow_status: 'queued', run_id: result.run_id, resumed: 'queued' } : { workflow_error: result.workflow_error }),
        acted_as: result.acted_as, on_behalf_of: result.on_behalf_of,
      })
    } catch (error) {
      return mcpErr(error instanceof Error ? error.message : 'Failed to complete the task')
    }
  }

  server.tool('tasks_list', 'List tasks with optional filters and pagination. Tasks can be created by workflow `create_subtask` and `user_task` nodes, linked to workflow runs, and completed with an outcome (approved/rejected/completed) that workflow condition nodes can branch on. Use `tasks_respond` to accept/hold/reject tasks in the queue, and `tasks_complete_workflow` to complete workflow-assigned tasks with outcomes.', {
    status: z.string().optional().describe('Filter: todo, in_progress, blocked, completed, cancelled'),
    priority: z.string().optional().describe('Filter: critical, high, medium, low'),
    assignee_id: z.string().optional().describe('Filter by assignee user ID'),
    limit: z.number().optional().describe('Max results (default 50)'),
    offset: z.number().optional().describe('Offset for pagination'),
    scope: z.enum(['all', 'reports']).optional().describe('"reports": the manager view — open tasks of your direct reports (with per-person workload counts); needs a user-bound credential'),
    indirect: z.boolean().optional().describe('scope "reports": include reports of reports'),
  }, async (args) => {
    if (args.scope === 'reports') {
      try {
        const { listReportTasks } = await import('@/lib/services/manager-tasks')
        return mcpOk(await listReportTasks(fromMcpContext(ctx), {
          indirect: args.indirect === true, person: args.assignee_id ?? null,
          status: args.status ? args.status.split(',') : null, priority: args.priority ? args.priority.split(',') : null,
          limit: args.limit ?? null,
        }))
      } catch (error) {
        return mcpErr(error instanceof Error ? error.message : 'Failed to list your reports\' tasks')
      }
    }
    if (actingUserId && args.assignee_id && args.assignee_id !== actingUserId) {
      return mcpErr('User-context API keys can only list tasks for their own user context')
    }

    let query = supabase.from('tasks')
      .select('id, title, status, priority, due_date, created_at, completed_at, assignee_id, progress_pct, is_workflow_task')
      .is('deleted_at', null)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(Math.min(args.limit ?? 50, 200))

    if (args.status) query = query.eq('status', args.status)
    if (args.priority) query = query.eq('priority', args.priority)
    if (args.assignee_id) query = query.eq('assignee_id', args.assignee_id)
    else if (actingUserId) {
      const collaborativeTaskIds = await getAccessibleTaskIdsForUser(supabase, tenantId, actingUserId)
      if (collaborativeTaskIds.length > 0) {
        query = query.or(`assignee_id.eq.${actingUserId},id.in.(${collaborativeTaskIds.join(',')})`)
      } else {
        query = query.eq('assignee_id', actingUserId)
      }
    }
    if (args.offset) query = query.range(args.offset, args.offset + (args.limit ?? 50) - 1)

    const { data, error } = await query
    if (error) return mcpErr(error.message)
    return mcpOk({ tasks: data, count: data?.length ?? 0 })
  })

  server.tool('tasks_get', 'Get a single task by ID with full details. Tasks can originate from workflow `create_subtask` and `user_task` nodes. Task completion outcomes drive workflow branching via condition nodes.', {
    task_id: z.string().describe('Task ID'),
    strip_html: z.boolean().optional().describe('Return description as plain text (HTML stripped); description_text is always included'),
  }, async (args) => {
    if (actingUserId && !(await canAccessTaskAsUser(supabase, tenantId, actingUserId, args.task_id))) {
      return mcpErr('This user-context API key cannot access that task')
    }
    const { data, error } = await supabase.from('tasks')
      .select('*, assignee:users!tasks_assignee_id_fkey(id, display_name, email), tenant:tenants(id, name)')
      .eq('id', args.task_id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .single()
    if (error) return mcpErr('Task not found')

    // Canonical task data object: raw columns + data (form values) +
    // responses/timeline — same shape the workflow designer binds to.
    const [{ data: responses }, { data: events }] = await Promise.all([
      (supabase as any).from('task_responses').select('user_id, outcome, outcome_notes, responded_at').eq('task_id', args.task_id).limit(100),
      (supabase as any).from('lifecycle_events').select('event_type, actor_id, created_at, metadata').eq('task_id', args.task_id).order('created_at', { ascending: false }).limit(20),
    ])
    return mcpOk(withDescriptionText(buildTaskDataObject({ task: data as any, responses, events }), args.strip_html === true))
  })

  server.tool('tasks_lookup', 'Suggestions for an Autocomplete / lookup field of an open task\'s form (field type "lookup" in tasks_get → metadata.fields). Runs only the lookup stored on the task (its data table or API reference, columns and filters); returns items { value, label, description?, fields }. Complete the task with the chosen item\'s value as values.<field_key>; the server confirms it and stores the item as task_data.<field_key>_item.', {
    task_id: z.string().describe('Task ID'),
    field_key: z.string().describe('Key of the lookup field'),
    query: z.string().optional().describe('Search text'),
    values: z.record(z.string(), z.unknown()).optional().describe('The form\'s current values, for {{task_data.<key>}} placeholders in the lookup\'s filters / inputs'),
  }, async (args) => {
    try {
      const [{ fromMcpContext }, { lookupTaskField }] = await Promise.all([import('@/lib/services/context'), import('@/lib/services/form-lookup')])
      return mcpOk(await lookupTaskField(fromMcpContext(ctx), args.task_id, { field_key: args.field_key, query: args.query, values: args.values }))
    } catch (error) {
      return mcpErr(error instanceof Error ? error.message : 'Lookup failed')
    }
  })

  server.tool('tasks_create', 'Create a new task. Tasks can also be created automatically by workflow `create_subtask` and `user_task` nodes. Task completion outcomes can drive workflow branching via condition nodes.', {
    title: z.string().describe('Task title'),
    description: z.string().optional().describe(`Task description. ${DESCRIPTION_HTML}`),
    priority: z.enum(['critical', 'high', 'medium', 'low', 'none']).optional().describe('Priority level'),
    due_date: z.string().optional().describe('Due date (ISO 8601)'),
    assignee_id: z.string().optional().describe('User ID to assign to'),
    status: z.enum(['todo', 'in_progress', 'blocked']).optional().describe('Initial status'),
  }, async (args) => {
    const { data, error } = await supabase.from('tasks').insert({
      tenant_id: tenantId,
      title: args.title,
      description: sanitizeTaskDescription(args.description ?? null),
      priority: args.priority ?? 'medium',
      due_date: args.due_date ?? null,
      assignee_id: args.assignee_id ?? null,
      status: args.status ?? 'todo',
      assigner_id: actingUserId,
    }).select('id, title, status').single()
    if (error) return mcpErr(error.message)
    return mcpOk({ created: true, task: data })
  })

  server.tool('tasks_update', 'Update task fields. Tasks can be created by workflow `create_subtask` and `user_task` nodes. Task completion outcomes drive workflow branching via condition nodes.', {
    task_id: z.string().describe('Task ID'),
    title: z.string().optional().describe('Updated task title'),
    description: z.string().optional().describe(`Updated task description. ${DESCRIPTION_HTML}`),
    priority: z.string().optional().describe('Updated priority'),
    status: z.string().optional().describe('Updated status'),
    due_date: z.string().optional().describe('Updated due date (ISO 8601)'),
    assignee_id: z.string().optional().describe('Updated assignee user ID'),
  }, async (args) => {
    if (actingUserId && !(await canAccessTaskAsUser(supabase, tenantId, actingUserId, args.task_id))) {
      return mcpErr('This user-context API key cannot update that task')
    }
    const { task_id, ...updates } = args
    const filtered = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined))
    if (filtered.status === 'completed') {
      const { data: current } = await supabase.from('tasks').select('is_workflow_task, event_id').eq('id', task_id).eq('tenant_id', tenantId).maybeSingle()
      if (current?.is_workflow_task && current.event_id) return mcpErr('Complete workflow tasks with tasks_complete_workflow (assignee, or their manager with on_behalf)')
    }
    if (typeof filtered.description === 'string') filtered.description = sanitizeTaskDescription(filtered.description)
    if (Object.keys(filtered).length === 0) return mcpErr('No fields to update')
    const { error } = await supabase.from('tasks').update(filtered).eq('id', task_id).eq('tenant_id', tenantId)
    if (error) return mcpErr(error.message)
    return mcpOk({ updated: true, task_id })
  })

  server.tool('tasks_complete', 'Complete a task with an outcome. Tasks can be created by workflow `create_subtask` and `user_task` nodes. The outcome value (e.g. approved, rejected, completed) can be referenced by workflow condition nodes via {{nodes.wait_node.output.outcome}}. For workflow-assigned tasks, prefer `tasks_complete_workflow` which also resumes the paused workflow.', {
    task_id: z.string().describe('Task ID'),
    outcome: z.string().optional().describe('Outcome value (e.g. approved, rejected, completed)'),
    outcome_notes: z.string().optional().describe('Notes about the outcome'),
    values: taskFieldValuesSchema,
  }, async (args) => {
    const { data: kind } = await supabase.from('tasks').select('is_workflow_task, event_id').eq('id', args.task_id).eq('tenant_id', tenantId).is('deleted_at', null).maybeSingle()
    if (!kind) return mcpErr('Task not found')
    if (kind.is_workflow_task && kind.event_id) {
      return completeWorkflow({ task_id: args.task_id, outcome: args.outcome ?? 'completed', notes: args.outcome_notes, values: args.values })
    }
    if (actingUserId && !(await canAccessTaskAsUser(supabase, tenantId, actingUserId, args.task_id))) {
      return mcpErr('This user-context API key cannot complete that task')
    }
    const updates: { status: string; outcome: string; outcome_notes: string | null; completed_at: string; metadata?: Json } = {
      status: 'completed',
      outcome: args.outcome ?? 'completed',
      outcome_notes: args.outcome_notes ?? null,
      completed_at: new Date().toISOString(),
    }
    if (args.values) {
      const { data: task } = await supabase.from('tasks').select('metadata').eq('id', args.task_id).eq('tenant_id', tenantId).maybeSingle()
      if (!task) return mcpErr('Task not found')
      const metadata = (task.metadata ?? {}) as Record<string, unknown>
      const { errors, templateValues } = await mergeTaskFieldValuesChecked(supabase, tenantId, metadata, args.values, { taskId: args.task_id })
      if (Object.keys(errors).length > 0) return mcpErr(`Invalid field values: ${Object.values(errors).join('; ')}`)
      updates.metadata = { ...metadata, template_values: templateValues } as Json
    }
    const { error } = await supabase.from('tasks').update(updates).eq('id', args.task_id).eq('tenant_id', tenantId)
    if (error) return mcpErr(error.message)
    return mcpOk({ completed: true, task_id: args.task_id })
  })

  server.tool('tasks_escalate', 'Escalate a task to another user. Tasks can be created by workflow `create_subtask` and `user_task` nodes. Task completion outcomes drive workflow branching via condition nodes.', {
    task_id: z.string().describe('Task ID'),
    escalate_to: z.string().describe('User ID to escalate to'),
    reason: z.string().optional().describe('Reason for escalation'),
  }, async (args) => {
    if (actingUserId && !(await canAccessTaskAsUser(supabase, tenantId, actingUserId, args.task_id))) {
      return mcpErr('This user-context API key cannot escalate that task')
    }
    const { error } = await supabase.from('tasks').update({
      assignee_id: args.escalate_to,
      acceptance_status: 'pending',
    }).eq('id', args.task_id).eq('tenant_id', tenantId)
    if (error) return mcpErr(error.message)
    return mcpOk({ escalated: true, task_id: args.task_id, escalated_to: args.escalate_to })
  })

  server.tool('tasks_redirect', 'Redirect a task to another user. Tasks can be created by workflow `create_subtask` and `user_task` nodes. Task completion outcomes drive workflow branching via condition nodes.', {
    task_id: z.string().describe('Task ID'),
    redirect_to: z.string().describe('User ID to redirect to'),
    reason: z.string().optional().describe('Reason for redirect'),
  }, async (args) => {
    if (actingUserId && !(await canAccessTaskAsUser(supabase, tenantId, actingUserId, args.task_id))) {
      return mcpErr('This user-context API key cannot redirect that task')
    }
    const { error } = await supabase.from('tasks').update({
      assignee_id: args.redirect_to,
      acceptance_status: 'pending',
    }).eq('id', args.task_id).eq('tenant_id', tenantId)
    if (error) return mcpErr(error.message)
    return mcpOk({ redirected: true, task_id: args.task_id, redirected_to: args.redirect_to })
  })

  server.tool('tasks_respond', 'Accept, hold, or reject a task in the queue. Use this for task queue management — accepting assigns the task to you, holding keeps it in queue for later, rejecting removes it from your queue. Tasks can be created by workflow `create_subtask` and `user_task` nodes. Task completion outcomes drive workflow branching via condition nodes.', {
    task_id: z.string().describe('Task ID'),
    response: z.enum(['accepted', 'held', 'rejected']).describe('Response: accepted, held, or rejected'),
    comment: z.string().optional().describe('Optional comment explaining the response'),
    on_behalf: z.boolean().optional().describe('Workflow tasks: respond for the assignee (their manager, or tasks.complete_any); needs on_behalf_note'),
    on_behalf_note: z.string().optional().describe('Why you are acting on behalf (required with on_behalf)'),
  }, async (args) => {
    const { data: kind } = await supabase.from('tasks').select('is_workflow_task, event_id').eq('id', args.task_id).eq('tenant_id', tenantId).is('deleted_at', null).maybeSingle()
    if (!kind) return mcpErr('Task not found')
    if (kind.is_workflow_task && kind.event_id) {
      try {
        const { respondToWorkflowTask } = await import('@/lib/services/task-actions')
        const result = await respondToWorkflowTask(fromMcpContext(ctx), args.task_id, args.response, { comment: args.comment ?? null, onBehalf: args.on_behalf === true, onBehalfNote: args.on_behalf_note ?? null, via: 'mcp' })
        kickQueueProcessor()
        return mcpOk({ responded: true, task_id: args.task_id, ...result })
      } catch (error) {
        return mcpErr(error instanceof Error ? error.message : 'Failed to respond')
      }
    }
    if (actingUserId && !(await canAccessTaskAsUser(supabase, tenantId, actingUserId, args.task_id))) {
      return mcpErr('This user-context API key cannot respond to that task')
    }
    const { error: updateError } = await supabase.from('tasks')
      .update({ acceptance_status: args.response })
      .eq('id', args.task_id)
      .eq('tenant_id', tenantId)
    if (updateError) return mcpErr(updateError.message)

    const { error: eventError } = await supabase.from('lifecycle_events').insert({
      tenant_id: tenantId,
      task_id: args.task_id,
      actor_id: actingUserId,
      event_type: `task_${args.response}`,
      metadata: { comment: args.comment ?? null },
    })
    if (eventError) return mcpErr(eventError.message)

    return mcpOk({ responded: true, task_id: args.task_id, response: args.response })
  })

  server.tool('tasks_complete_workflow', 'Complete a workflow-assigned user_task with an outcome and resume the paused workflow. Only the assignee can (a member of the assigned team for a team task); their manager — anyone in their manager chain — can act on behalf with on_behalf=true and an on_behalf_note (recorded as actioned_by = manager, actioned_on_behalf_of = assignee; the assignee is notified). Applies the task\'s completion rule (multi-assignee tasks may report `waiting` until enough responses arrive). Outcomes (e.g. approved, rejected, completed) are available after the node as {{outcome}} and can drive condition-node branching; field values are available as {{task_data.<key>}}. Tasks can be created by workflow `create_subtask` and `user_task` nodes.', {
    task_id: z.string().describe('Task ID'),
    outcome: z.string().describe('Outcome value (e.g. approved, rejected, completed)'),
    notes: z.string().optional().describe('Optional notes about the outcome'),
    values: taskFieldValuesSchema,
    on_behalf: z.boolean().optional().describe('Act for the assignee (their manager, or tasks.complete_any)'),
    on_behalf_note: z.string().optional().describe('Why you are acting on behalf (required with on_behalf)'),
  }, async (args) => completeWorkflow(args))

  server.tool('tasks_priority_summary', 'Summarize task priority and due-date pressure for the current tenant. With a user-context API key, this automatically focuses on the bound user.', {
    assignee_id: z.string().optional().describe('Optional assignee filter. User-context keys can only use their own ID.'),
  }, async (args) => {
    if (actingUserId && args.assignee_id && args.assignee_id !== actingUserId) {
      return mcpErr('User-context API keys can only summarize their own tasks')
    }

    let query = supabase.from('tasks')
      .select('id, priority, status, due_date, assignee_id')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)

    if (args.assignee_id) query = query.eq('assignee_id', args.assignee_id)
    else if (actingUserId) query = query.eq('assignee_id', actingUserId)

    const { data, error } = await query
    if (error) return mcpErr(error.message)

    const now = Date.now()
    const rows = data ?? []
    const byPriority = rows.reduce((acc: Record<string, number>, row: any) => {
      const key = row.priority ?? 'none'
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})
    const overdue = rows.filter((row: any) => row.due_date && new Date(row.due_date).getTime() < now && row.status !== 'completed').length
    const active = rows.filter((row: any) => ['todo', 'in_progress', 'blocked'].includes(row.status)).length

    return mcpOk({ total: rows.length, active, overdue, by_priority: byPriority })
  })
}
