import { getWorkflowActivitySummary } from "@/lib/extensibility"
import { dataTableLabel, type TableNames } from "@/lib/workflow-table-refs"

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
      return c.name ? `${c.name} = ${c.expression ?? '...'}` : null
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
