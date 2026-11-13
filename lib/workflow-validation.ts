import type { WorkflowNode } from './workflow-schema'
import { WORKFLOW_UPDATABLE_TASK_FIELDS } from './task-fields'
import { NODE_CATALOG } from './workflow-schema'
import { extensionCatalogEntry, looksLikeExtensionNodeType } from './extensions/nodes'
import { normalizeScheduleConfig } from './workflow-schedule'
import { setVariableValidationErrors } from './workflow-set-variable'
import { taskDataFieldSlug } from './task-data'
import { aadGroupValidationErrors } from './tasks/aad-group-assignment'
import { AUDIO_FORMATS, IMAGE_FEATURES, MEDIA_BACKGROUND_NODE_TYPES, MEDIA_TOOL_OPERATIONS, REDACT_TARGETS, TRANSCRIPT_FORMATS, VIDEO_FEATURES, VIDEO_FORMATS, isMediaNodeType } from './media/catalog'

const TRIGGER_TYPES = NODE_CATALOG.filter(n => n.category === 'trigger').map(n => n.type)

const SCHEDULE_CONFIG_KEYS = ['schedule_mode', 'interval_minutes', 'minute_of_hour', 'time_of_day', 'day_of_week', 'day_of_month', 'run_at'] as const

/**
 * Trigger configs are mostly optional (unset scope = fire for everything), so
 * only misconfigurations that make a workflow SILENTLY never fire are flagged.
 * A completely empty schedule config passes here (pinned by tests / new-node
 * default); validateWorkflow adds the workflow-level "never runs" check.
 */
function validateTriggerNode(node: WorkflowNode): string[] {
  const c = node.config ?? {}
  // Without a form it can never fire.
  if (node.type === 'form_submitted' && !c.form_id) return ['Choose the form whose submissions start this workflow']
  if (node.type === 'schedule') {
    const hasAnyScheduleKey = SCHEDULE_CONFIG_KEYS.some((key) => c[key] !== undefined && c[key] !== null && c[key] !== '')
    if (hasAnyScheduleKey && !normalizeScheduleConfig(c)) {
      return ['Schedule is incomplete — choose a repeat mode and fill in its fields']
    }
  }
  return []
}

/**
 * What the workspace makes available, when the caller knows it (the designer,
 * MCP). Absent fields are not checked (offline / gallery validation).
 */
export interface WorkflowValidationEnv {
  /** An enabled Entra ID directory connection (AAD group assignment). */
  entraGroups?: boolean
}

/**
 * Extension nodes and triggers (ext.<id>.<key>): installed in this build,
 * and every required input mapped (or defaulted). Whether the workspace has
 * the extension enabled and licensed is checked when the step runs.
 */
function validateExtensionNode(node: WorkflowNode): string[] {
  const entry = extensionCatalogEntry(node.type)
  if (!entry) return [`${node.type} is not installed in this build (extension missing)`]
  const mappings = (node.config?.input_mappings ?? {}) as Record<string, unknown>
  const source = entry.category === 'trigger' ? (node.config ?? {}) : mappings
  const errors: string[] = []
  for (const field of entry.inputs) {
    if (!field.required || field.default !== undefined) continue
    const value = source[field.name]
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) errors.push(`${field.label ?? field.name} is required`)
  }
  return errors
}

export function validateNode(node: WorkflowNode, env: WorkflowValidationEnv = {}): string[] {
  const c = node.config
  const errors: string[] = []

  if (TRIGGER_TYPES.includes(node.type)) return validateTriggerNode(node)
  if (looksLikeExtensionNodeType(node.type)) return validateExtensionNode(node)

  switch (node.type) {
    case 'condition':
      if (!c.groups?.length && !c.field && !c.branches?.length) errors.push('No condition defined')
      break
    case 'switch_case':
      if (!c.field) errors.push('Value field required')
      if (!c.cases?.length) errors.push('No cases defined')
      break
    case 'set_variable':
      // Legacy { name, expression }: only the name is required (unchanged);
      // { assignments: [...] }: per-row name / duplicate / expression checks.
      errors.push(...setVariableValidationErrors(c))
      break
    case 'set_sla':
      if ((c.mode ?? 'relative') === 'exact') {
        if (!String(c.due_at ?? '').trim()) errors.push('Due date/time required')
      } else {
        // A number, or an expression resolved (and checked) at run time.
        const amount = String(c.amount ?? '').trim()
        if (!amount) errors.push('SLA amount required')
        else if (!amount.includes('{{')) {
          if (!Number.isFinite(Number(amount))) errors.push('SLA amount must be a number or an expression')
          else if (Number(amount) <= 0) errors.push('SLA amount required')
        }
      }
      if ((c.warning_mode ?? 'relative') === 'exact') {
        if (c.warning_at && !String(c.warning_at).trim()) errors.push('Warning date/time is invalid')
      } else if (c.warning_amount !== undefined && c.warning_amount !== null && String(c.warning_amount).trim() !== '') {
        const warning = String(c.warning_amount).trim()
        if (!warning.includes('{{')) {
          if (!Number.isFinite(Number(warning))) errors.push('Warning amount must be a number or an expression')
          else if (Number(warning) < 0) errors.push('Warning amount cannot be negative')
        }
      }
      break
    case 'update_task':
      if (!c.field) errors.push('Field required')
      else if (!(WORKFLOW_UPDATABLE_TASK_FIELDS as readonly string[]).includes(String(c.field))) {
        errors.push(`Field "${c.field}" cannot be updated by a workflow`)
      }
      break
    case 'call_reference':
      if (!c.reference_id) {
        errors.push('No reference selected')
      } else {
        const refInputs = (c._ref_inputs ?? []) as { name: string; required: boolean }[]
        const inputMappings = (c.input_mappings ?? {}) as Record<string, string>
        for (const inp of refInputs) {
          if (inp.required && !inputMappings[inp.name]?.trim()) {
            errors.push(`Input "${inp.name}" required`)
          }
        }
      }
      break
    case 'custom_activity': {
      if (!c.custom_activity_id) errors.push('No custom activity selected')
      const inputs = Array.isArray(c.manifest?.inputs) ? c.manifest.inputs : []
      const inputMappings = (c.input_mappings ?? {}) as Record<string, string>
      for (const input of inputs) {
        const name = String(input?.name ?? input?.key ?? '').trim()
        if (!name) continue
        if (input?.required && !String(inputMappings[name] ?? '').trim()) {
          errors.push(`Input "${name}" required`)
        }
      }
      break
    }
    case 'live_reference':
      if (!c.reference_id) {
        errors.push('No reference selected')
      } else {
        if (!c.binding_name?.trim()) errors.push('Binding name required')
        const refInputs = (c._ref_inputs ?? []) as { name: string; required: boolean }[]
        const inputMappings = (c.input_mappings ?? {}) as Record<string, string>
        for (const inp of refInputs) {
          if (inp.required && !inputMappings[inp.name]?.trim()) {
            errors.push(`Input "${inp.name}" required`)
          }
        }
      }
      break
    case 'http_request':
      if (!c.url) errors.push('URL required')
      break
    case 'send_email':
      if (!c.to) errors.push('Recipient required')
      if (!c.email_template_id && !c.subject) errors.push('Subject required')
      break
    case 'delay':
      if (!c.duration) errors.push('Duration required')
      break
    case 'loop':
      if (!c.items) errors.push('Items collection required')
      break
    case 'loop_n_times':
      if (!c.count) errors.push('Count required')
      break
    case 'add_task_attachment':
      if (!String(c.file ?? '').trim()) errors.push('File required')
      break
    case 'create_subtask':
      if (!c.title) errors.push('Title required')
      break
    case 'log':
      if (!c.message) errors.push('Message required')
      break
    case 'auto_action':
      if (!c.status && !c.outcome && !c.acceptance_status && !c.priority) errors.push('No action configured')
      break
    case 'update_data_table':
      if (!c.table_id) errors.push('No table selected')
      if ((c.operation === 'get' || c.operation === 'update' || c.operation === 'delete' || c.operation === 'set_retention')
        && !c.row_id
        && !(c.row_match_field && (c.row_match_value !== undefined && c.row_match_value !== ''))
        && !(c.match_column && (c.match_value !== undefined && c.match_value !== ''))
      ) errors.push('Row ID required')
      if (c.operation === 'set_retention' && !('retention_policy_id' in c)) errors.push('Retention policy selection required')
      if (c.operation === 'list' && c.filters?.some((f: any) => !f.column)) errors.push('Filter has no column selected')
      break
    case 'retention_policies': {
      const operation = c.operation ?? 'list_policies'
      if (operation === 'create_policy') {
        if (!c.name?.trim()) errors.push('Policy name required')
        if (!['review', 'review_on_exact_date', 'purge_on', 'purge_on_exact_date', 'keep_forever'].includes(c.policy_mode ?? '')) {
          errors.push('Valid policy mode required')
        }
        if (c.policy_mode === 'review_on_exact_date' || c.policy_mode === 'purge_on_exact_date') {
          if (!c.exact_date?.trim()) errors.push('Exact date required')
        } else if (c.policy_mode !== 'keep_forever') {
          if (!String(c.duration_value ?? '').trim()) errors.push('Duration value required')
          if (!['days', 'months', 'years'].includes(c.duration_unit ?? '')) errors.push('Duration unit must be days, months, or years')
        }
      }
      if ((operation === 'delete_policy' || operation === 'list_assets' || operation === 'assign_policy') && !String(c.retention_policy_id ?? '').trim()) {
        errors.push('Retention policy required')
      }
      if (operation === 'create_policy') {
        const appliesTo = Array.isArray(c.applies_to) ? c.applies_to.map((value: any) => String(value ?? '').trim()) : []
        if (appliesTo.includes('roles') && ['purge_on', 'purge_on_exact_date'].includes(c.policy_mode ?? '')) {
          errors.push('Roles support review-style retention policies only')
        }
      }
      if (operation === 'assign_policy') {
        if (!['data_table', 'data_row', 'role'].includes(c.target_type ?? '')) errors.push('Target type is invalid')
        if (!String(c.target_id ?? '').trim()) errors.push('Target ID required')
      }
      break
    }
    case 'file_to_base64':
      if (!c.file_url) errors.push('File URL required')
      break
    case 'base64_to_file':
      if (!c.base64_data) errors.push('Base64 data required')
      if (!c.file_name) errors.push('File name required')
      break
    case 'download_file':
      if (!c.url) errors.push('URL required')
      break
    case 'read_file':
      if (!c.file_url) errors.push('File URL required')
      break
    case 'math':
      if (!c.expression) errors.push('Expression required')
      break
    case 'text_template':
      if (!c.template) errors.push('Template required')
      break
    case 'modify_string':
      if (!c.operation) errors.push('Operation required')
      break
    case 'format_date':
      if (!c.date && !c.input) errors.push('Date value required')
      break
    case 'date_math':
      if (!c.date && !c.input) errors.push('Date value required')
      break
    case 'regex':
      if (!c.pattern) errors.push('Pattern required')
      break
    case 'collection_count':
    case 'collection_get':
    case 'collection_filter':
    case 'collection_sort':
    case 'collection_unique':
    case 'collection_join':
      if (!c.collection) errors.push('Collection required')
      break
    case 'pause_until':
      if (!c.date) errors.push('Date required')
      break
    case 'call_sub_workflow':
      if (!c.sub_workflow_id) errors.push('Sub-workflow required')
      break
    case 'decision_table':
      if (!c.decision_table_id) errors.push('Business rule required')
      if ((c._decision_inputs ?? []).some((input: any) => input.required && !c.input_mappings?.[input.key]?.trim())) {
        for (const input of (c._decision_inputs ?? []) as any[]) {
          if (input.required && !c.input_mappings?.[input.key]?.trim()) {
            errors.push(`Input "${input.key}" required`)
          }
        }
      }
      break
    case 'add_user_to_role':
    case 'remove_user_from_role':
      if (!c.user_id) errors.push('User required')
      if (!c.role_id && !c.role_name) errors.push('Role required')
      break
    case 'check_permission':
      if (!c.user_id) errors.push('User required')
      if (!c.permission) errors.push('Permission required')
      break
    case 'json_build_object':
      if (!c.fields?.some((f: any) => f.key?.trim())) errors.push('At least one field required')
      break
    case 'json_add_to_array':
      if (!c.array_var) errors.push('Array variable required')
      break
    case 'json_get_value':
      if (!c.source) errors.push('Source required')
      break
    case 'read_csv':
    case 'read_excel':
      // Write mode turns a list into a file: it reads data_var, not file_url.
      if (c.mode === 'write') {
        if (!c.data_var) errors.push('Data (a list variable) required')
      } else if (!c.file_url) errors.push('File URL required')
      break
    case 'doc_word':
    case 'doc_excel':
    case 'doc_powerpoint':
      if (!c.template_url && !(c.source_mode === 'table' && c.table_id && c.table_row_id)) errors.push('Template source required')
      if (c.mode === 'find_replace' && !c.replacements?.some((r: any) => r.find?.trim())) errors.push('At least one replacement required')
      break
    case 'doc_read':
    case 'doc_convert':
    case 'doc_extract':
    case 'doc_redact':
    case 'doc_inspect':
      if (!String(c.source ?? '').trim()) errors.push('Source file required')
      if (node.type === 'doc_convert' && c.target && !['pdf', 'docx', 'html', 'markdown', 'text', 'csv', 'xlsx', 'json'].includes(c.target)) errors.push('Unknown target format')
      if (node.type === 'doc_extract' && c.to_table && !c.table_id) errors.push('Data table required')
      if (node.type === 'doc_redact' && !(Array.isArray(c.presets) && c.presets.length) && !(Array.isArray(c.info_types) ? c.info_types.length : String(c.info_types ?? '').trim()) && !c.ai_detection && !String(c.terms ?? '').trim() && !(Array.isArray(c.patterns) && c.patterns.some((p: any) => String(p?.pattern ?? p ?? '').trim()))) errors.push(c.mode === 'detect_only' ? 'Choose what to find' : 'Choose what to redact')
      if (node.type === 'doc_redact' && c.ai_detection && !String(c.ai_agent_id ?? '').trim()) errors.push('Choose the agent for AI detection')
      if (node.type === 'doc_inspect' && c.operation === 'search' && !String(c.query ?? '').trim()) errors.push('Search text required')
      break
    case 'media_transcribe':
    case 'media_analyze_image':
    case 'media_analyze_video':
    case 'media_redact_image':
    case 'media_redact_video':
    case 'media_generate_image':
    case 'media_tts':
    case 'media_tools':
      errors.push(...validateMediaNode(node.type, c))
      break
    case 'esign_send':
    case 'esign_envelope':
    case 'esign_wait':
      errors.push(...validateEsignNode(node.type, c))
      break
    case 'doc_compare':
      if (!String(c.original ?? '').trim()) errors.push('Original required')
      if (!String(c.revised ?? '').trim()) errors.push('Revised required')
      break
    case 'doc_pdf': {
      const op = c.operation ?? 'merge'
      if (op === 'merge') { if (!String(c.sources ?? '').trim() || (Array.isArray(c.sources) && !c.sources.length)) errors.push('PDFs to merge required') }
      else if (!String(c.source ?? '').trim()) errors.push('Source PDF required')
      if (op === 'watermark' && !String(c.text ?? '').trim()) errors.push('Watermark text required')
      if (op === 'extract_pages' && !String(c.pages ?? '').trim()) errors.push('Pages required')
      break
    }
    case 'user_task':
      if (!(c.task_title ?? c.title)) errors.push('Task title required')
      if ((c.assignment_type ?? 'individual') === 'individual' && !c.assignee_id && !c.assignee_variable && !c.assign_to_user_id && !c.assign_to_user_variable) errors.push('Assignee required')
      if (c.assignment_type === 'team' && !c.team_id && !c.assign_to_team_id) errors.push('Team required')
      errors.push(...aadGroupValidationErrors(c, env))
      if (c.allow_invite_on_redirect && !c.allow_redirect) errors.push('Enable redirect before invite on redirect')
      if (c.queue_behaviour !== undefined && c.queue_behaviour !== null && c.queue_behaviour !== '' && !['rules', 'queue', 'add'].includes(c.queue_behaviour)) {
        errors.push('Queue behaviour must be rules, queue or add')
      }
      if (c.redirect_assignment_mode && !['single', 'many'].includes(c.redirect_assignment_mode)) errors.push('Redirect assignment mode must be single or many')
      if (c.redirect_recipient_limit_mode && !['unlimited', 'capped'].includes(c.redirect_recipient_limit_mode)) errors.push('Redirect recipient limit mode must be unlimited or capped')
      if (c.redirect_assignment_mode === 'many' && c.redirect_recipient_limit_mode === 'capped' && (!(Number(c.redirect_recipient_limit) > 0) || !Number.isFinite(Number(c.redirect_recipient_limit)))) {
        errors.push('Redirect recipient limit must be greater than 0')
      }
      if (Array.isArray(c.fields)) {
        const seenKeys = new Set<string>()
        for (const field of c.fields as Array<Record<string, unknown> | null>) {
          const label = String(field?.label ?? '').trim()
          const key = taskDataFieldSlug(String(field?.key ?? '').trim() || label)
          if (!key) {
            errors.push('Every task field needs a label or key')
            continue
          }
          if (seenKeys.has(key)) errors.push(`Duplicate task field key "${key}"`)
          seenKeys.add(key)
          if (field?.type === 'choice' && !(Array.isArray(field.options) && field.options.some((o) => String(o ?? '').trim()))) {
            errors.push(`Choice field "${label || key}" needs at least one option`)
          }
        }
      }
      break
    case 'goto_activity':
      if (!c.target_node_id) errors.push('Target activity required')
      break
    case 'parallel':
      if (!(c.branches as any[])?.length || (c.branches as any[]).length < 2) errors.push('At least 2 branches required')
      break
    case 'placeholder':
      // Placeholders pass through without errors — they're no-ops at runtime
      break
    case 'server_event':
      if (!c.event_name) errors.push('Event name required')
      if (c.outbound_action === 'api_reference' && !c.reference_id) errors.push('API reference required')
      if (c.outbound_action === 'data_table' && !c.table_id) errors.push('Data table required')
      break
    case 'run_agent':
      if (!c.agent_id) errors.push('Agent is required')
      if (!c.user_message?.trim() && !c.message?.trim()) errors.push('Prompt / message required')
      if (c.execution_mode !== undefined && !['inline', 'queued'].includes(c.execution_mode)) errors.push('Run mode must be inline or queued')
      if (c.act_as !== undefined && !['initiator', 'owner', 'none'].includes(c.act_as)) errors.push('Act as must be initiator, owner or none')
      break
    // end_workflow — no required fields
  }
  return errors
}

export interface WorkflowValidationResult {
  valid: boolean
  totalErrors: number
  nodeErrors: { nodeId: string; nodeLabel: string; errors: string[] }[]
}

export function validateWorkflow(nodes: WorkflowNode[], triggerType?: string, env: WorkflowValidationEnv = {}): WorkflowValidationResult {
  const nodeErrors: { nodeId: string; nodeLabel: string; errors: string[] }[] = []
  let totalErrors = 0

  for (const node of nodes) {
    const errors = validateNode(node, env)
    if (triggerType === 'middleware_received' && node.type === 'user_task') {
      errors.push('User Task is unavailable for middleware workflows')
    }
    // Workflow-level: a schedule-triggered workflow whose schedule node is
    // completely unconfigured will silently never fire (the sweep skips it).
    // Per-node validation lets an empty schedule node pass (new-node default),
    // so the "this workflow can never run" check belongs here.
    if (triggerType === 'schedule' && node.type === 'schedule' && !normalizeScheduleConfig(node.config)) {
      const message = 'Schedule not configured — this workflow will never run'
      if (!errors.includes(message) && errors.length === 0) errors.push(message)
    }
    if (errors.length > 0) {
      nodeErrors.push({ nodeId: node.id, nodeLabel: node.label, errors })
      totalErrors += errors.length
    }
  }

  return { valid: totalErrors === 0, totalErrors, nodeErrors }
}

/* ── Media actions (lib/media) ─────────────────────────────────────── */

const filled = (v: unknown) => v != null && (typeof v !== 'string' || v.trim() !== '') && !(Array.isArray(v) && v.length === 0)
/** A literal number to range-check, or null for empty values and expressions. */
function literalNumber(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v
  const t = String(v).trim()
  if (t.includes('{{')) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}
function unknownOf(values: unknown, allowed: readonly string[]): string[] {
  return Array.isArray(values) ? values.map(String).filter((v) => !allowed.includes(v)) : []
}

const filledText = (v: unknown) => v !== undefined && v !== null && String(typeof v === 'object' ? JSON.stringify(v) : v).trim() !== '' && !(Array.isArray(v) && v.length === 0)

/** Designer checks for the e-signature steps (config keys of lib/esign/handlers.ts). */
export function validateEsignNode(type: string, c: Record<string, any>): string[] {
  const errors: string[] = []
  if (!filledText(c.integration_id)) errors.push('E-signature integration required')
  if (type === 'esign_send') {
    if (c.source === 'template') { if (!filledText(c.template_id)) errors.push('Template required') }
    else if (!filledText(c.documents)) errors.push('Documents required')
    const rows = Array.isArray(c.recipients) ? c.recipients.filter((r: any) => filledText(r?.email)) : []
    if (!rows.length && !filledText(c.recipients_expr)) errors.push('At least one recipient required')
    if (!filledText(c.subject)) errors.push('Email subject required')
    if (filledText(c.advanced) && typeof c.advanced === 'string' && !c.advanced.includes('{{')) {
      try { const v = JSON.parse(c.advanced); if (!v || typeof v !== 'object' || Array.isArray(v)) errors.push('Advanced options must be a JSON object') } catch { errors.push('Advanced options must be valid JSON') }
    }
  } else if (type === 'esign_envelope') {
    const action = String(c.action ?? 'status')
    if (!['status', 'download', 'cancel', 'signing_url', 'list_templates'].includes(action)) errors.push('Unknown envelope action')
    if (action !== 'list_templates' && !filledText(c.envelope_id)) errors.push('Envelope ID required')
    if (action === 'signing_url' && !filledText(c.recipient_email)) errors.push('Recipient email required')
  } else if (type === 'esign_wait') {
    if (!filledText(c.envelope_id)) errors.push('Envelope ID required')
    const t = literalNumber(c.timeout_days)
    if (t !== null && !(t > 0 && t <= 365)) errors.push('Timeout must be 1–365 days')
  }
  return errors
}

/** Designer checks for the media steps (config keys of lib/media/handlers.ts). */
export function validateMediaNode(type: string, c: Record<string, unknown>): string[] {
  if (!isMediaNodeType(type)) return []
  const errors: string[] = []
  const targets: string[] = Array.isArray(c.targets) ? c.targets.map(String) : ['faces', 'text_pii']
  const audio = String(c.audio ?? 'none')
  const isRedact = type === 'media_redact_image' || type === 'media_redact_video'
  const editing = type === 'media_generate_image' && c.operation === 'edit'

  if (isRedact) {
    // Visual targets need the main provider; speech needs it or a separate speech provider.
    if (targets.some((t) => t !== 'custom') && !filled(c.integration_id)) errors.push('AI provider required')
    if (type === 'media_redact_video' && audio !== 'none' && !filled(c.integration_id) && !filled(c.transcribe_integration_id)) errors.push('Speech provider required')
  } else if (type !== 'media_tools' && !filled(c.integration_id)) errors.push('AI provider required')
  if (type !== 'media_tts' && (type !== 'media_generate_image' || editing) && !filled(c.source)) errors.push(editing ? 'Image to edit required' : 'Source media required')
  if (c.run_mode && (MEDIA_BACKGROUND_NODE_TYPES as readonly string[]).includes(type) && !['auto', 'inline', 'background'].includes(String(c.run_mode))) errors.push('Unknown run mode')

  switch (type) {
    case 'media_transcribe':
      if (unknownOf(c.formats, TRANSCRIPT_FORMATS).length) errors.push('Unknown transcript format (srt, vtt, txt or json)')
      { const n = literalNumber(c.max_speakers); if (n !== null && !(n >= 1 && n <= 30)) errors.push('Max speakers must be 1–30') }
      break
    case 'media_analyze_image':
      if (unknownOf(c.features, IMAGE_FEATURES.map((f) => f.id)).length) errors.push('Unknown image feature')
      if (Array.isArray(c.features) && c.features.length === 0 && !filled(c.prompt)) errors.push('Choose what to find or ask a question')
      { const n = literalNumber(c.max_results); if (n !== null && !(n >= 1 && n <= 100)) errors.push('Max results must be 1–100') }
      break
    case 'media_analyze_video':
      if (unknownOf(c.features, VIDEO_FEATURES.map((f) => f.id)).length) errors.push('Unknown video feature')
      if (Array.isArray(c.features) && c.features.length === 0 && !filled(c.prompt)) errors.push('Choose what to find or ask a question')
      { const n = literalNumber(c.max_frames); if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 60)) errors.push('Max frames must be 1–60') }
      break
    case 'media_redact_image':
    case 'media_redact_video':
      if (!targets.length && (type === 'media_redact_image' || audio === 'none')) errors.push(c.mode === 'detect_only' ? 'Choose what to find' : 'Choose what to redact')
      if (unknownOf(targets, REDACT_TARGETS.map((t) => t.id)).length) errors.push('Unknown redaction target')
      if (targets.includes('custom') && !filled(c.boxes)) errors.push('Boxes required (or remove "Boxes from earlier steps")')
      if (targets.includes('text_pii') && Array.isArray(c.info_types) && !c.info_types.length && !filled(c.terms) && !(Array.isArray(c.patterns) && c.patterns.some((p: unknown) => String((p as { pattern?: unknown } | null)?.pattern ?? p ?? '').trim()))) errors.push('Choose the sensitive text to find')
      if (c.style && !['blur', 'pixelate', 'box'].includes(String(c.style))) errors.push('Unknown style')
      if (type === 'media_redact_image' && c.output_format && !['same', 'png', 'jpeg'].includes(String(c.output_format))) errors.push('Unknown output format')
      if (type === 'media_redact_video') {
        if (!['none', 'bleep', 'mute'].includes(audio)) errors.push('Unknown audio option')
        if (c.output_format && !['mp4', 'webm', 'mov'].includes(String(c.output_format))) errors.push('Unknown output format')
        const n = literalNumber(c.sample_interval)
        if (n !== null && !(n >= 0.2)) errors.push('Seconds between frames must be at least 0.2')
      }
      break
    case 'media_generate_image': {
      if (!filled(c.prompt)) errors.push('Prompt required')
      if (c.operation && !['generate', 'edit'].includes(String(c.operation))) errors.push('Unknown operation')
      const n = literalNumber(c.count)
      if (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 4)) errors.push('Number of images must be 1–4')
      if (c.format && !['png', 'jpeg', 'webp'].includes(String(c.format))) errors.push('Unknown image format')
      break
    }
    case 'media_tts':
      if (!filled(c.text)) errors.push('Text required')
      if (c.format && !['mp3', 'wav', 'opus', 'aac', 'flac'].includes(String(c.format))) errors.push('Unknown audio format')
      break
    case 'media_tools': {
      const op = String(c.operation ?? 'info')
      if (!MEDIA_TOOL_OPERATIONS.some((o) => o.id === op)) { errors.push('Unknown operation'); break }
      if (op === 'trim' && !filled(c.start) && !filled(c.end)) errors.push('Start or end required')
      if (op === 'burn_subtitles' && !filled(c.subtitles)) errors.push('Subtitles required')
      if (op === 'convert' && !(filled(c.format) && ([...VIDEO_FORMATS, ...AUDIO_FORMATS] as readonly string[]).includes(String(c.format)))) errors.push('Choose a known format to convert to')
      if (op === 'extract_audio' && c.format && !(AUDIO_FORMATS as readonly string[]).includes(String(c.format))) errors.push('Unknown audio format')
      if ((op === 'frames' || op === 'thumbnail') && c.format && !['png', 'jpeg'].includes(String(c.format))) errors.push('Unknown image format')
      if (op === 'frames') {
        const count = literalNumber(c.count)
        if (count !== null && !(Number.isInteger(count) && count >= 1 && count <= 100)) errors.push('Max frames must be 1–100')
        const interval = literalNumber(c.interval)
        if (interval !== null && !(interval > 0)) errors.push('Seconds between frames must be more than 0')
      }
      break
    }
  }
  return errors
}
