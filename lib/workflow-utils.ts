import { getWorkflowActivitySummary } from "@/lib/extensibility"
import { dataTableLabel, type TableNames } from "@/lib/workflow-table-refs"
import { isMediaNodeType } from "@/lib/media/catalog"
import { mediaOutputVar } from "@/lib/media/schemas"
import { setVariableSummary } from "@/lib/workflow-set-variable"

/** Names of referenced records, so summaries show names rather than ids. */
export interface SummaryLookups {
  /** Data table id → name; `undefined` while not loaded. */
  tableNames?: TableNames
}

/**
 * Generate a human-readable config summary for a workflow node.
 * Used by canvas-node, process-viewer, and test-runner.
 */
export function getNodeConfigSummary(node: { type: string; config: Record<string, any> }, lookups: SummaryLookups = {}): string | null {
  const c = node.config ?? {}

  switch (node.type) {
    case 'condition': {
      const groups = c.groups as { logic: string; rules: { field: string; operator: string; value: string }[] }[] | undefined
      if (groups?.length) {
        const parts = groups.map(g => {
          const ruleTexts = g.rules.filter(r => r.field).map(r => `${r.field} ${r.operator} ${r.value}`)
          return ruleTexts.join(` ${g.logic.toUpperCase()} `)
        })
        return parts.filter(Boolean).join(" OR ") || null
      }
      const branches = (c.branches ?? []) as { label: string; rules: { field: string; operator: string; value: string }[] }[]
      if (branches.length > 0) {
        const first = branches[0]
        const rules = (first.rules ?? []).filter((r: any) => r.field)
        if (rules.length > 0) return `${rules[0].field} ${rules[0].operator} ${rules[0].value}`
      }
      if (c.field) return `${c.field} ${c.operator ?? ""} ${c.value ?? ""}`
      return null
    }
    case 'update_task':
      return c.field ? `${c.field}${c.value ? ` = ${c.value}` : ''}` : null
    case 'set_sla': {
      const parts: string[] = []
      if (c.sla_label) parts.push(String(c.sla_label))
      if (c.mode === 'exact' && c.due_at) parts.push(`due ${c.due_at}`)
      if ((c.mode ?? 'relative') === 'relative' && c.amount) parts.push(`${c.amount} ${c.unit ?? 'hours'}`)
      if (c.warning_amount) parts.push(`warn ${c.warning_amount} ${c.warning_unit ?? c.unit ?? 'hours'} early`)
      return parts.length > 0 ? parts.join(' · ') : 'Configure SLA'
    }
    case 'set_variable':
      return setVariableSummary(c)
    case 'delay':
      return c.duration ? `${c.duration} ${c.unit ?? 'minutes'}` : null
    case 'http_request':
      return c.url ? `${c.method ?? 'GET'} ${c.url}` : null
    case 'call_reference':
      if (c.reference_name) {
        const method = c.reference_method ?? ''
        return method ? `${method} ${c.reference_name}` : c.reference_name
      }
      return null
    case 'custom_activity': {
      // The card's description already names the function; the summary line shows the action key (and a pinned version).
      if (c.operation_label || c.operation) return [c.custom_activity_key, c.custom_activity_version ? `v${c.custom_activity_version}` : null].filter(Boolean).join(' · ') || null
      const summary = getWorkflowActivitySummary(c.manifest)
      if (summary) return summary
      const key = c.custom_activity_key || c.activity_name || null
      const outputs = Array.isArray(c.manifest?.outputs) ? c.manifest.outputs.length : 0
      return key ? `${key}${outputs ? ` · ${outputs} outputs` : ''}` : null
    }
    case 'live_reference':
      if (c.reference_name) {
        return `⚡ ${c.binding_name || 'live'} ← ${c.reference_name}`
      }
      return c.binding_name ? `⚡ ${c.binding_name}` : null
    case 'send_email':
      return c.to ? `To: ${String(c.to).slice(0, 25)}${String(c.to).length > 25 ? '...' : ''}` : null
    case 'auto_action': {
      const parts: string[] = []
      if (c.status) parts.push(`→ ${c.status}`)
      if (c.outcome) parts.push(`outcome: ${c.outcome}`)
      if (c.acceptance_status) parts.push(`accept: ${c.acceptance_status}`)
      return parts.length > 0 ? parts.join(', ') : null
    }
    case 'server_event': {
      const parts: string[] = []
      if (c.event_name) parts.push(c.event_name)
      if (c.outbound_action === 'api_reference' && c.reference_name) parts.push(`→ ${c.reference_name}`)
      if (c.outbound_action === 'data_table') { const t = dataTableLabel(c, lookups.tableNames); if (t) parts.push(`→ ${t}`) }
      return parts.length > 0 ? parts.join(' ') : null
    }
    case 'data_table_event': {
      const tbl = dataTableLabel(c, lookups.tableNames)
      if (!tbl) return null
      const events = Array.isArray(c.event_types) && c.event_types.length > 0 ? c.event_types.join(', ') : 'created'
      return `${tbl} · ${events}`
    }
    case 'goto_activity':
      return c.target_node_label ? `→ ${c.target_node_label}` : null
    case 'parallel': {
      const branches = (c.branches ?? []) as { label: string }[]
      const mode = c.mode ?? 'parallel'
      return `${mode === 'parallel' ? '⫘' : '→'} ${branches.length || 2} branches`
    }
    case 'loop':
      return c.items ? `each in ${c.items}` : null
    case 'loop_n_times':
      return c.count ? `${c.count} times` : null
    case 'add_task_attachment': {
      const what = c.name ? `"${c.name}"` : c.file ? String(c.file) : null
      const task = String(c.task_id ?? '').trim()
      return what ? (task ? `${what} → ${task}` : what) : null
    }
    case 'create_subtask': {
      const parent = String(c.parent_task_id ?? '').trim()
      const title = c.title ? `"${c.title}"` : null
      if (parent && title) return `${title} → ${parent}`
      return title ?? (parent ? `→ ${parent}` : null)
    }
    case 'update_data_table': {
      const op = c.operation ?? 'insert'
      const tbl = dataTableLabel(c, lookups.tableNames)
      if (op === 'set_retention') return tbl ? `retention → ${tbl}` : 'retention'
      return tbl ? `${op} → ${tbl}` : null
    }
    case 'log':
      return c.message ? c.message.slice(0, 30) : null
    case 'math':
      return c.expression ?? null
    case 'text_template':
      return c.template ? c.template.slice(0, 30) : null
    case 'call_sub_workflow':
      return c.sub_workflow_name ? `→ ${c.sub_workflow_name}` : null
    case 'decision_table':
      return c.decision_table_name ? `→ ${c.decision_table_name}` : null
    case 'run_agent': {
      const label = c.agent_name || c.agent_label || c.agent_id || 'agent'
      const parts = [`→ ${label}`]
      if (c.output_variable) parts.push(`as ${c.output_variable}`)
      return parts.join(' ')
    }
    case 'add_user_to_role': {
      const roleLabel = c.role_name || c.role_label || c.role_id
      const userLabel = c.user_label || c.user_id
      if (roleLabel && userLabel) return `${userLabel} → ${roleLabel}`
      if (roleLabel) return `→ ${roleLabel}`
      return null
    }
    case 'remove_user_from_role': {
      const roleLabel = c.role_name || c.role_label || c.role_id
      const userLabel = c.user_label || c.user_id
      if (roleLabel && userLabel) return `${userLabel} × ${roleLabel}`
      if (roleLabel) return `× ${roleLabel}`
      return null
    }
    case 'check_permission':
      return c.permission ? `${c.user_label || c.user_id || 'user'} · ${c.permission}` : null
    case 'user_task': {
      const parts: string[] = []
      if (c.task_title) parts.push(c.task_title.slice(0, 25))
      if (c.assignment_type === 'team') parts.push('→ team')
      if (c.assignment_type === 'aad_group') parts.push(`→ AAD ${c.aad_group_name ? String(c.aad_group_name).slice(0, 25) : 'group'}${c.aad_group_mode === 'everyone' ? ' (everyone)' : ''}`)
      if (c.allow_redirect) parts.push('redirect')
      if (c.allow_redirect && c.redirect_assignment_mode === 'many') parts.push('many')
      if (c.allow_redirect && c.redirect_assignment_mode === 'many' && c.redirect_recipient_limit_mode === 'capped' && c.redirect_recipient_limit) {
        parts.push(`max ${c.redirect_recipient_limit}`)
      }
      if (c.allow_invite_on_redirect) parts.push('+ invite')
      return parts.length > 0 ? parts.join(' ') : null
    }
    case 'placeholder':
      return c.note ?? null
    case 'file_to_base64':
      return c.file_url ? `← ${String(c.file_url).split('/').pop()?.slice(0, 25)}` : null
    case 'download_file':
      return c.url ? `← ${String(c.url).split('/').pop()?.slice(0, 25)}` : null
    case 'json_build_object': {
      const fields = (c.fields ?? []).filter((f: any) => f.key?.trim())
      return fields.length > 0 ? `{${fields.map((f: any) => f.key).join(', ')}} → ${c.output_var ?? 'json_object'}` : null
    }
    case 'json_build_array':
      return c.output_var ? `[] → ${c.output_var}` : null
    case 'json_add_to_array':
      return c.array_var ? `push → ${c.array_var}` : null
    case 'json_get_value':
      return c.path ? `${c.path} → ${c.output_var ?? 'json_value'}` : null
    case 'read_csv':
      return c.mode === 'write'
        ? `${c.data_var ?? 'data'} → ${c.file_name ?? 'export.csv'}`
        : c.file_url ? `→ ${c.output_var ?? 'csv_data'}` : null
    case 'read_excel':
      return c.mode === 'write'
        ? `${c.data_var ?? 'data'} → ${c.file_name ?? 'export.xlsx'}`
        : c.file_url ? `${c.sheet_name ? c.sheet_name + ' → ' : '→ '}${c.output_var ?? 'excel_data'}` : null
    case 'doc_read': {
      const bits = [c.ocr && c.ocr !== 'off' ? `OCR ${c.ocr}` : '', c.sheet ? `sheet ${c.sheet}` : '', c.pages ? `pages ${c.pages}` : ''].filter(Boolean)
      return c.source ? `${bits.length ? `${bits.join(', ')} ` : ''}→ ${c.output_var || 'document'}` : null
    }
    case 'doc_compare': {
      if (!c.original || !c.revised) return null
      const extras = [c.redline && c.redline !== 'none' ? `redline ${c.redline}` : '', c.report && c.report !== 'none' ? `${c.report} report` : ''].filter(Boolean)
      return `${c.mode && c.mode !== 'auto' ? c.mode : 'auto'} diff${extras.length ? ` + ${extras.join(', ')}` : ''} → ${c.output_var || 'comparison'}`
    }
    case 'doc_convert':
      return c.source ? `→ ${String(c.target ?? 'pdf').toUpperCase()}${c.engine === 'external' ? ' (external)' : ''}` : null
    case 'doc_pdf': {
      const op = String(c.operation ?? 'merge')
      const labels: Record<string, string> = { merge: 'Merge PDFs', split: 'Split', extract_pages: 'Extract pages', page_count: 'Page count', watermark: 'Watermark', rotate: 'Rotate', fill_form: 'Fill form', read_form: 'Read form' }
      const detail = op === 'extract_pages' && c.pages ? ` ${c.pages}` : op === 'watermark' && c.text ? ` "${String(c.text).slice(0, 20)}"` : op === 'split' && c.ranges ? ` ${c.ranges}` : ''
      return `${labels[op] ?? op}${detail}`
    }
    case 'doc_extract': {
      const parts = [c.extract_tables !== false ? 'tables' : '', Array.isArray(c.patterns) && c.patterns.length ? `${c.patterns.length} pattern${c.patterns.length === 1 ? '' : 's'}` : '', Array.isArray(c.finders) && c.finders.length ? c.finders.join(', ') : ''].filter(Boolean)
      const table = c.to_table ? ` → ${dataTableLabel(c, lookups.tableNames) ?? 'data table'}` : ''
      return c.source ? `${parts.join(' · ') || 'nothing selected'}${table}` : null
    }
    case 'doc_redact': {
      const types = Array.isArray(c.info_types) ? c.info_types.length : 0
      const what = [types ? (c.info_types.includes('*') ? 'all types' : c.info_types.includes('@high') ? 'high-confidence types' : `${types} type${types === 1 ? '' : 's'}`) : '', Array.isArray(c.presets) && c.presets.length ? c.presets.join(', ') : '', String(c.terms ?? '').trim() ? 'terms' : '', Array.isArray(c.patterns) && c.patterns.length ? `${c.patterns.length} pattern${c.patterns.length === 1 ? '' : 's'}` : '', c.ai_detection ? 'AI' : ''].filter(Boolean).join(', ')
      const detect = c.mode === 'detect_only'
      return c.source ? `${detect ? 'Find ' : ''}${what || 'nothing selected'} → ${c.output_var || (detect ? 'detected' : 'redacted')}` : null
    }
    case 'esign_send': {
      const n = Array.isArray(c.recipients) ? c.recipients.filter((r: any) => String(r?.email ?? '').trim()).length : 0
      const who = n ? `${n} recipient${n === 1 ? '' : 's'}` : c.recipients_expr ? 'recipients from a variable' : null
      if (!who) return null
      const what = c.source === 'template' ? (c.template_name ? `template "${String(c.template_name).slice(0, 24)}"` : 'template') : 'documents'
      return `${c.provider_label ? `${c.provider_label} · ` : ''}${what} → ${who} → ${c.output_var || 'envelope'}`
    }
    case 'esign_envelope': {
      const labels: Record<string, string> = { status: 'Get status', download: 'Download signed document', cancel: 'Void envelope', signing_url: 'Signing URL', list_templates: 'List templates' }
      return `${labels[String(c.action ?? 'status')] ?? c.action} → ${c.output_var || 'esign_result'}`
    }
    case 'esign_wait':
      return c.envelope_id ? `Until final (timeout ${Number(c.timeout_days) || 30} d)${c.download !== false ? ' + signed PDF' : ''} → ${c.output_var || 'signature'}` : null
    case 'esign_event': {
      const events = Array.isArray(c.events) ? c.events : []
      return events.length ? events.map((e: string) => e.replace(/^envelope_|^recipient_/, '')).join(', ') : 'Any e-signature event'
    }
    case 'doc_inspect':
      return c.source ? (c.operation === 'search' && c.query ? `Find "${String(c.query).slice(0, 24)}"` : `${c.operation ?? 'all'} → ${c.output_var || 'inspection'}`) : null
    case 'media_transcribe':
    case 'media_analyze_image':
    case 'media_analyze_video':
    case 'media_redact_image':
    case 'media_redact_video':
    case 'media_generate_image':
    case 'media_tts':
    case 'media_tools':
      return mediaNodeSummary(node.type, c)
    case 'doc_word':
    case 'doc_excel':
    case 'doc_powerpoint': {
      const mode = c.mode ?? 'find_replace'
      const label = mode.replace(/_/g, ' ')
      return `${label} → ${c.output_var ?? 'doc_file'}`
    }
    default:
      return null
  }
}

/* ── Media actions (lib/media) ─────────────────────────────────────── */

const MEDIA_TARGET_SHORT: Record<string, string> = { faces: 'faces', text_pii: 'sensitive text', plates: 'license plates', custom: 'boxes' }
const MEDIA_TOOL_LABELS: Record<string, string> = { info: 'Media info', extract_audio: 'Extract audio', frames: 'Frames', thumbnail: 'Thumbnail', trim: 'Trim', convert: 'Convert', compress: 'Compress', burn_subtitles: 'Burn in subtitles' }

function mediaList(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.map(String) : fallback
}

/** Short canvas summary of a media step ("Google Gemini · SRT, VTT → transcript"). */
export function mediaNodeSummary(type: string, c: Record<string, unknown>): string | null {
  if (!isMediaNodeType(type)) return null
  const ov = mediaOutputVar(type, c)
  const provider = typeof c.provider_label === 'string' && c.provider_label.trim() ? `${c.provider_label.trim()} · ` : ''
  const hasSource = Boolean(String(c.source ?? '').trim())
  const quote = (v: unknown, n = 28) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return `"${t.length > n ? `${t.slice(0, n - 1)}…` : t}"` }
  switch (type) {
    case 'media_transcribe': {
      if (!hasSource) return null
      const formats = mediaList(c.formats, ['srt']).map((f) => f.toUpperCase())
      return `${provider}${formats.join(', ') || 'text'}${c.diarize ? ' · speakers' : ''} → ${ov}`
    }
    case 'media_analyze_image':
    case 'media_analyze_video': {
      if (!hasSource) return null
      const features = mediaList(c.features, type === 'media_analyze_image' ? ['description', 'labels', 'text'] : ['summary', 'scenes'])
      return `${provider}${features.join(', ') || 'nothing selected'}${String(c.prompt ?? '').trim() ? ' + question' : ''} → ${ov}`
    }
    case 'media_redact_image':
    case 'media_redact_video': {
      if (!hasSource) return null
      const targets = mediaList(c.targets, ['faces', 'text_pii']).map((t) => MEDIA_TARGET_SHORT[t] ?? t)
      const speech = type === 'media_redact_video' && c.audio && c.audio !== 'none' ? `${c.audio} speech` : ''
      if (c.mode === 'detect_only') return `Find ${[...targets, speech ? 'speech' : ''].filter(Boolean).join(', ') || 'nothing selected'} → ${ov}`
      if (!targets.length) return `${speech ? `${speech[0].toUpperCase()}${speech.slice(1)}` : 'Nothing selected'} → ${ov}`
      return `${targets.join(', ')} · ${c.style || 'blur'}${speech ? ` + ${speech}` : ''} → ${ov}`
    }
    case 'media_generate_image': {
      if (!String(c.prompt ?? '').trim()) return null
      const count = Number(c.count) > 1 ? ` ×${Number(c.count)}` : ''
      return `${provider}${c.operation === 'edit' ? 'Edit' : 'Generate'}${count} ${quote(c.prompt)}`
    }
    case 'media_tts': {
      if (!String(c.text ?? '').trim()) return null
      return `${provider}${c.voice ? `${c.voice} · ` : ''}${String(c.format || 'mp3').toUpperCase()} → ${ov}`
    }
    case 'media_tools': {
      const op = String(c.operation ?? 'info')
      const label = MEDIA_TOOL_LABELS[op] ?? op
      if (op === 'trim') return `Trim ${String(c.start ?? '').trim() || '0:00'}–${String(c.end ?? '').trim() || 'end'}`
      if (op === 'convert') return c.format ? `${label} → ${String(c.format).toUpperCase()}` : label
      if (op === 'extract_audio') return `${label} → ${String(c.format || 'mp3').toUpperCase()}`
      if (op === 'frames') return `Frames every ${c.interval || 1} s (max ${c.count || 10})`
      if (op === 'thumbnail') return c.at ? `Thumbnail at ${c.at}` : 'Thumbnail'
      if (op === 'compress') return `Compress (${c.quality || 'medium'})`
      return `${label} → ${ov}`
    }
  }
  return null
}
