/**
 * The Agent: one chat request, prepared and run for the signed-in person
 * (server only). /api/assistants/chat authenticates and streams; this module
 * decides everything else, on EVERY request (nothing is trusted from the
 * browser's history or its idea of what is available):
 *
 *  1. availability (a key configured AND the Agent on AND the person allowed)
 *     — 403 otherwise;
 *  2. burst rate limit (per person / per workspace) and the workspace's
 *     limits (messages per person per day, monthly cost cap) — 429;
 *  3. the provider connection (decrypted key / integration);
 *  4. the CURRENT screen's untrusted context and the tools for it, filtered
 *     by the person's permissions and the Agent's tool groups:
 *       form help      a fillable form on screen → get_form,
 *                      get_validation_problems, propose_field_values
 *                      (forms.submit; never on a form that opted out; never submit);
 *       task help      a task on screen (RLS) → get_task_history,
 *                      draft_comment, suggest_outcome + its form's tools
 *                      (never complete / approve / redirect);
 *       building help  everywhere: the MCP read tools the person's view
 *                      permissions allow, and for builders the write tools
 *                      (confirmed, drafts only) + ask_where_to_build when an
 *                      item of a buildable kind is open;
 *       admin help     everywhere, for people with an admin permission: the
 *                      admin read tools (settings, access, audit, usage,
 *                      health) and confirmed admin writes, each with its own
 *                      permission; secrets, SSO, the workspace address,
 *                      billing and the Agent's own settings are never tools
 *                      (lib/assistants/tools/admin.ts);
 *  5. the turn (lib/assistants/engine.ts) and its usage record.
 *
 * The person's Agent profile (lib/assistants/profiles.ts: the first that
 * names them and applies on this screen's area; none → the Default profile)
 * chooses the model, thinking level, help groups (still narrowed by
 * permissions), the instructions appended after ours, and the limits; the
 * usage row records it (model_rule).
 *
 * The conversation spans screens: the history may mention items from other
 * screens; the instructions tell the model to look them up by name.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { rateLimit } from '@/lib/rate-limit'
import { htmlToPlainText } from '@/lib/html-sanitize'
import type { ServiceContext } from '@/lib/services/context'
import { resolveThinkingLevel, type ThinkingLevel } from '@/lib/agents/reasoning'
import { resolveAvailability } from './config'
import { DEFAULT_TURN_LIMITS, modelAcceptsImages, runAssistantTurn, type AssistantToolDef, type TurnLimits, type TurnResult } from './engine'
import { formForModel, sanitizeSnapshot } from './form-values'
import { AssistantLimitError, checkAssistantLimits, recordAssistantUsage } from './limits'
import { assistantInstructions } from './prompts'
import { AssistantConfigError, availabilitySettings, connectionForProfile, loadAssistantSettings, type AssistantConnection } from './settings'
import { matchProfile, profileLimits, profileTools, screenArea, withProfileInstructions } from './profiles'
import { formTools } from './tools/form'
import { openItemOf, whereToBuildTool } from './tools/choice'
import { askUserTool } from './tools/ask-user'
import { withAssignmentTools } from './assignment'
import { processTool, type ProcessTarget } from './tools/process'
import { taskForModel, taskTools, type TaskContext, type TaskEvent } from './tools/task'
import { ADMIN_WRITE_TOOLS } from './admin-policy'
import { ADMIN_AREAS, ASSISTANT_CAPABILITIES, formAssistantSetting, type AdminArea, type AssistantCapability, type AssistantEvent, type ChatRequest, type DesignerContext } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

export class AssistantRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly retryAfterMs?: number) {
    super(message)
    this.name = 'AssistantRequestError'
  }
}

/**
 * Per-request limits by the turn's main tool group (building makes bigger
 * things). No token cap by default (maxTokens 0): the workspace's monthly
 * cost cap is the guard; an admin can set one in Settings → Agent → Limits
 * (limits.max_request_tokens), and the turn then stops resumably before it.
 */
export const CAPABILITY_LIMITS: Record<AssistantCapability, TurnLimits> = {
  form: { ...DEFAULT_TURN_LIMITS, maxIterations: 6, maxTokens: 0, maxOutputTokens: 2048, timeoutMs: 120_000 },
  task: { ...DEFAULT_TURN_LIMITS, maxIterations: 6, maxTokens: 0, maxOutputTokens: 2048, timeoutMs: 120_000 },
  designer: { ...DEFAULT_TURN_LIMITS, maxIterations: 16, maxTokens: 0, maxOutputTokens: 16_384, timeoutMs: 240_000 },
}

const ADMIN_WRITE_SET = new Set<string>(ADMIN_WRITE_TOOLS)

/** Burst limits per process / cache store (on top of the workspace's daily / monthly limits). */
export const BURST = { perActorPerMinute: 20, perTenantPerMinute: 120 }

export interface PreparedTurn {
  /** The turn's main tool group (recorded on the usage row): task, else form, else designer. */
  capability: AssistantCapability
  connection: AssistantConnection
  /** The Agent profile that chose the configuration (null: the Default profile); recorded on the usage row. */
  profile: { id: string; name: string } | null
  instructions: string
  context: Record<string, unknown> | null
  tools: AssistantToolDef[]
  limits: TurnLimits
}

export interface ChatDeps {
  /** Service-role client (settings, usage, MCP tools as the person). */
  serviceDb: SupabaseClient
  fetchImpl?: typeof fetch
  /** Test seam: skip the burst limiter. */
  skipBurst?: boolean
}

export function parseChatRequest(body: unknown): ChatRequest {
  const b = body && typeof body === 'object' ? body as Record<string, any> : {}
  // The first release's per-assistant `capability` is accepted and ignored (tools follow the screen).
  const capability = ASSISTANT_CAPABILITIES.includes(b.capability) ? b.capability as AssistantCapability : null
  const context = b.context && typeof b.context === 'object' ? b.context : {}
  const str = (v: unknown, n = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
  const designer = context.designer && typeof context.designer === 'object' ? context.designer : null
  const areas: DesignerContext['area'][] = ['workflow', 'form', 'data', 'decision_table', 'extensibility', 'general', 'report', 'agent', 'integration', 'email_template', 'page']
  const decision = b.decision && typeof b.decision === 'object' && typeof b.decision.tool_call_id === 'string'
    ? { tool_call_id: String(b.decision.tool_call_id).slice(0, 100), approved: b.decision.approved === true }
    : null
  const screen = context.screen && typeof context.screen === 'object' ? context.screen : null
  const adminArea = context.admin && typeof context.admin === 'object' && (ADMIN_AREAS as readonly string[]).includes(context.admin.area) ? context.admin.area as AdminArea : null
  return {
    capability,
    messages: Array.isArray(b.messages) ? b.messages : [],
    context: {
      form_id: str(context.form_id),
      task_id: str(context.task_id),
      form: context.form ?? null,
      designer: designer ? {
        area: areas.includes(designer.area) ? designer.area : 'general',
        item_id: str(designer.item_id),
        item_name: str(designer.item_name),
        dirty: designer.dirty === true,
        summary: str(designer.summary, 4_000),
      } : null,
      screen: screen && str(screen.label) ? { label: str(screen.label)!, path: str(screen.path, 300) } : null,
      admin: adminArea ? { area: adminArea } : null,
    },
    decision,
  }
}

async function loadTask(ctx: ServiceContext, serviceDb: SupabaseClient, taskId: string): Promise<TaskContext> {
  // As the person: RLS decides whether they can see it.
  const session = ctx.db ?? ctx.supabase
  const { data: task } = await (session as any).from('tasks')
    .select('id, tenant_id, title, description, status, priority, due_date, available_outcomes, assignee_id, assigner_id, is_workflow_task, metadata')
    .eq('id', taskId).is('deleted_at', null).maybeSingle()
  if (!task) throw new AssistantRequestError('Task not found', 404, 'not_found')
  const { describeTaskAccess } = await import('@/lib/task-authz')
  const [access, people] = await Promise.all([
    describeTaskAccess(serviceDb, { tenantId: ctx.tenantId, taskId, actorId: ctx.actorId!, permissions: ctx.permissions }),
    (async () => {
      const ids = [task.assignee_id, task.assigner_id].filter(Boolean)
      if (!ids.length) return new Map<string, string>()
      const { data } = await (session as any).from('users').select('id, display_name, email').in('id', ids)
      return new Map(((data ?? []) as any[]).map((u) => [String(u.id), String(u.display_name || u.email || 'Someone')]))
    })(),
  ])
  let onBehalfName: string | null = null
  if (access?.onBehalfOf) {
    const { data } = await (session as any).from('users').select('display_name, email').eq('id', access.onBehalfOf).maybeSingle()
    onBehalfName = data ? String(data.display_name || data.email) : null
  }
  const outcomes = Array.isArray(task.available_outcomes) ? (task.available_outcomes as unknown[]).map(String).filter(Boolean).slice(0, 20) : []
  return {
    id: String(task.id),
    title: String(task.title ?? ''),
    description: task.description ? htmlToPlainText(task.description) : null,
    status: String(task.status ?? ''),
    priority: task.priority ?? null,
    due_date: task.due_date ?? null,
    outcomes,
    assignee: task.assignee_id ? people.get(String(task.assignee_id)) ?? null : null,
    assigner: task.assigner_id ? people.get(String(task.assigner_id)) ?? null : null,
    mode: access?.mode ?? 'none',
    closed: access?.closed ?? true,
    on_behalf_of: onBehalfName,
    workflow_task: Boolean(task.is_workflow_task),
  }
}

async function taskHistory(ctx: ServiceContext, taskId: string): Promise<TaskEvent[]> {
  const { listTaskEvents } = await import('@/lib/services/activity')
  const events = await listTaskEvents(ctx, taskId, 40)
  return events.map((e) => ({
    type: String(e.event_type ?? ''),
    by: e.actor?.display_name ?? null,
    at: String(e.created_at ?? ''),
    message: typeof e.metadata?.message === 'string' ? e.metadata.message.slice(0, 2_000) : null,
    outcome: typeof e.metadata?.outcome === 'string' ? e.metadata.outcome : null,
  }))
}

/** Everything the turn needs, or an AssistantRequestError (403 not available, 429 limits, 400 config). */
export async function prepareAssistantTurn(ctx: ServiceContext, request: ChatRequest, deps: ChatDeps): Promise<PreparedTurn> {
  if (!ctx.actorId || !ctx.permissions) throw new AssistantRequestError('Not signed in', 401, 'unauthorized')
  const db = deps.serviceDb
  const row = await loadAssistantSettings(db, ctx.tenantId)
  const settings = availabilitySettings(row)
  if (!row || !settings?.usable) throw new AssistantRequestError('The Agent is not set up in this workspace', 403, 'not_configured')

  // Availability for this person (and the form / task's form on screen).
  const { availabilityUser } = await import('@/lib/services/assistants')
  const user = await availabilityUser(db as any, ctx.tenantId, ctx.actorId, ctx.permissions)
  // The person's profile on this screen's area (first match; none → the Default profile).
  const area = screenArea({ taskId: request.context?.task_id, formId: request.context?.form_id, form: request.context?.form, designer: request.context?.designer, path: request.context?.screen?.path })
  const profile = matchProfile(row.agent.profiles, { userId: ctx.actorId, roleIds: user.roleIds, teamIds: user.teamIds }, area)
  const limits = profileLimits(row.limits, profile)
  let formSetting = null as ReturnType<typeof formAssistantSetting>
  let formKnown = false
  const taskId = request.context?.task_id ?? null
  const formId = taskId ? null : request.context?.form_id ?? null
  if (formId) {
    const { data } = await (db as any).from('forms').select('layout').eq('id', formId).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (data) { formKnown = true; formSetting = formAssistantSetting(data.layout) }
  }
  const base = resolveAvailability(settings, user, { area })
  if (!base.agent) throw new AssistantRequestError('The Agent is not available to you', 403, 'not_available')
  let task: TaskContext | null = null
  if (taskId && base.task) {
    task = await loadTask(ctx, db, taskId)
    const { data } = await (db as any).from('tasks').select('metadata').eq('id', taskId).eq('tenant_id', ctx.tenantId).maybeSingle()
    formKnown = true
    formSetting = formAssistantSetting(data?.metadata?.form_layout)
  }
  const availability = resolveAvailability(settings, user, { formKnown, formSetting, area })

  // Limits: bursts first (cheap), then the workspace's daily / monthly limits.
  if (!deps.skipBurst) {
    const actor = await rateLimit(`assistant:actor:${ctx.tenantId}:${ctx.actorId}`, { max: BURST.perActorPerMinute, windowMs: 60_000 })
    if (!actor.ok) throw new AssistantRequestError('Too many Agent messages — wait a moment and try again.', 429, 'rate_limited', actor.retryAfterMs)
    const tenant = await rateLimit(`assistant:tenant:${ctx.tenantId}`, { max: BURST.perTenantPerMinute, windowMs: 60_000 })
    if (!tenant.ok) throw new AssistantRequestError('The workspace\'s Agent is busy — try again shortly.', 429, 'rate_limited', tenant.retryAfterMs)
  }
  try {
    await checkAssistantLimits(db, ctx.tenantId, ctx.actorId, limits, undefined, profile ? { id: profile.id, name: profile.name, monthly_cost_cap: profile.limits.monthly_cost_cap } : null)
  } catch (error) {
    if (error instanceof AssistantLimitError) throw new AssistantRequestError(error.message, 429, error.code)
    throw error
  }

  // The person's model: their profile's, else the workspace default (resolved here, every request).
  let connection: AssistantConnection
  const ruleThinking: ThinkingLevel | null = profile?.thinking_level ?? null
  try {
    connection = await connectionForProfile(db, row, profile)
    const baseUrl = profile ? (profile.connection === 'key' ? profile.base_url : profile.connection === 'default' && row.key_source === 'key' ? row.base_url : null) : row.key_source === 'key' ? row.base_url : null
    if (baseUrl) {
      const { validateBaseUrl } = await import('@/lib/services/assistants')
      await validateBaseUrl(baseUrl)
    }
  } catch (error) {
    if (error instanceof AssistantConfigError) throw new AssistantRequestError(error.message, 400, 'config')
    if ((error as any)?.name === 'ServiceError') throw new AssistantRequestError((error as Error).message, 400, 'config')
    throw error
  }

  // A form opted out of form help is not read at all (its values never reach the model).
  const snapshot = availability.form_read ? sanitizeSnapshot(request.context?.form) : null
  const tools: AssistantToolDef[] = []
  const groups: AssistantCapability[] = []
  const context: Record<string, unknown> = {}
  const screen = request.context?.screen
  if (screen) context.screen = { label: screen.label, path: screen.path ?? null }

  if (task) {
    groups.push('task')
    tools.push(...taskTools(task, snapshot, () => taskHistory(ctx, task!.id), { canPropose: availability.form }))
    context.task = taskForModel(task)
    context.task_form = availability.form_read ? formForModel(snapshot) : 'Form help is turned off for this task\'s form'
  } else if (taskId) {
    context.task = 'A task is open, but task help is not available to this person'
  } else if (formId || request.context?.form) {
    if (availability.form_read && snapshot) {
      groups.push('form')
      tools.push(...formTools(snapshot, { canEdit: availability.form && !snapshot.read_only }))
      context.form = formForModel(snapshot)
    } else {
      context.form = formKnown && !availability.form_read ? 'A form is open; form help is turned off for this form' : 'A form is open; form help is not available'
    }
  }

  const d = request.context?.designer
  const openItem = openItemOf(d ?? null)
  if (d) {
    context.builder = {
      area: d.area,
      open_item: openItem ? { kind: openItem.kind, id: openItem.id, name: openItem.name, unsaved_changes_in_editor: d.dirty === true } : null,
      ...(d.summary ? { outline: d.summary } : {}),
    }
  }
  // One MCP server bound to the person, shared by building and admin help.
  let personServer: { server: import('@/lib/mcp/server').McpToolServer; mcpCtx: import('@/lib/mcp/server').McpContext } | null = null
  const serverForPerson = async () => {
    if (personServer) return personServer
    const [{ createMcpServer }, { personMcpContext }] = await Promise.all([import('@/lib/mcp/server'), import('./tools/designer')])
    const mcpCtx = personMcpContext({ tenantId: ctx.tenantId, userId: ctx.actorId!, permissions: ctx.permissions!, serviceDb: db })
    personServer = { server: createMcpServer(mcpCtx), mcpCtx }
    return personServer
  }
  if (profileTools(settings.agent.tools, profile).designer) {
    const { designerTools, allowedDesignerToolNames } = await import('./tools/designer')
    if (allowedDesignerToolNames(ctx.permissions).length) {
      const { server } = await serverForPerson()
      const designer = designerTools({ server, permissions: ctx.permissions, area: d?.area ?? null })
      tools.push(...designer)
      const canWrite = designer.some((t) => t.mode === 'write')
      groups.push('designer')
      if (canWrite && openItem) tools.push(whereToBuildTool(openItem))
      context.building = canWrite ? 'The person can build: write tools are available (each confirmed first, saved as drafts).' : 'Read-only: the person can look things up but not build or change anything.'
    }
  }

  // Admin help: every tool needs its own permission; excluded tools never exist.
  let adminOn = false
  let adminCanChange = false
  if (availability.admin) {
    const { adminTools, allowedAdminToolNames } = await import('./tools/admin')
    if (allowedAdminToolNames(ctx.permissions).length) {
      const [{ server, mcpCtx }, { fromMcpContext }] = await Promise.all([serverForPerson(), import('@/lib/services/context')])
      const taken = new Set(tools.map((t) => t.name))
      const admin = adminTools({ server, permissions: ctx.permissions, svc: fromMcpContext(mcpCtx) }).filter((t) => !taken.has(t.name))
      tools.push(...admin)
      adminOn = admin.length > 0
      adminCanChange = admin.some((t) => t.mode === 'write')
      const area = request.context?.admin?.area ?? null
      context.admin = {
        ...(area ? { page: area } : {}),
        access: adminCanChange ? 'The person can make some admin changes: each admin write tool offered is one they hold the permission for (each confirmed first).' : 'Read-only admin help: explain settings, access, audit and usage; no admin changes.',
      }
    }
  }

  // Questions with answer buttons (every screen), and who User Tasks go to when building (lib/assistants/tools/ask-user.ts, assignment.ts).
  tools.push(askUserTool())
  tools.splice(0, tools.length, ...withAssignmentTools(tools, { db, tenantId: ctx.tenantId, meId: ctx.actorId }))

  // "What happens next?": the process behind a task, a form, the open workflow or a run page — from the workflow itself.
  const runMatch = String(screen?.path ?? '').match(/^\/(?:automations|home)\/runs\/([0-9a-f-]{36})/i)
  const processTarget: ProcessTarget | null = task?.workflow_task ? { kind: 'task', taskId: task.id }
    : runMatch ? { kind: 'run', runId: runMatch[1] }
    : formId && !taskId ? { kind: 'form', formId }
    : openItem?.kind === 'workflow' ? { kind: 'workflow', workflowId: openItem.id }
    : null
  if (processTarget) tools.push(processTool({ db, tenantId: ctx.tenantId, userId: ctx.actorId, permissions: ctx.permissions }, processTarget))

  // Task assignment (take ownership / reassign / claim, each confirmed; lib/assistants/tools/task-assign.ts):
  // with task help, and on the screens where waiting work is managed (process view, My tasks / My team, Home, the queue).
  const assignScreen = /^\/(?:tasks(?:\/|$)|home(?:\/|$)|automations\/(?:runs|queue)(?:\/|$))/.test(String(screen?.path ?? ''))
  if (availability.task && ctx.permissions?.has('tasks.complete') !== false && (task || assignScreen)) {
    const { taskAssignTools } = await import('./tools/task-assign')
    const taken = new Set(tools.map((t) => t.name))
    tools.push(...taskAssignTools({ ctx, taskId: task?.id ?? null }).filter((t) => !taken.has(t.name)))
  }

  const capability: AssistantCapability = groups.includes('task') ? 'task' : groups.includes('form') ? 'form' : 'designer'
  return {
    capability,
    // Thinking level: the profile's → the help group's → the default card's → the provider's default.
    connection: { ...connection, thinking: resolveThinkingLevel({ rule: ruleThinking, group: row.agent.thinking_levels?.[capability], base: row.agent.thinking_level }) },
    profile: profile ? { id: profile.id, name: profile.name } : null,
    // The profile's instructions only ever come AFTER ours (and say ours win).
    instructions: withProfileInstructions(assistantInstructions({ groups, openItem: Boolean(openItem), canBuild: tools.some((t) => t.mode === 'write' && !ADMIN_WRITE_SET.has(t.name)), admin: adminOn ? { canChange: adminCanChange } : null }), profile),
    context: Object.keys(context).length ? context : null,
    tools,
    limits: { ...(groups.includes('designer') || adminOn ? CAPABILITY_LIMITS.designer : CAPABILITY_LIMITS[capability]), maxTokens: limits.max_request_tokens || 0 },
  }
}

/** Run the prepared turn, record its usage, return the result. */
export async function runPreparedTurn(ctx: ServiceContext, prepared: PreparedTurn, request: ChatRequest, deps: ChatDeps & { onEvent: (e: AssistantEvent) => void; signal?: AbortSignal }): Promise<TurnResult> {
  const result = await runAssistantTurn({
    connection: prepared.connection,
    instructions: prepared.instructions,
    context: prepared.context,
    history: request.messages,
    tools: prepared.tools,
    decision: request.decision,
    limits: prepared.limits,
    vision: modelAcceptsImages(prepared.connection.provider, prepared.connection.model),
    onEvent: deps.onEvent,
    signal: deps.signal,
    fetchImpl: deps.fetchImpl,
  })
  // A request that never reached the model or a tool (a stale decision) is not usage.
  if (result.llmCalls || result.toolCalls) await recordAssistantUsage(deps.serviceDb, {
    tenantId: ctx.tenantId,
    userId: ctx.actorId,
    capability: prepared.capability,
    provider: prepared.connection.provider,
    model: prepared.connection.model,
    modelRule: prepared.profile?.id ?? null,
    status: result.status,
    usage: result.usage,
    llmCalls: result.llmCalls,
    toolCalls: result.toolCalls,
    usageMissing: result.usageMissing,
    error: result.error ?? null,
  })
  return result
}
