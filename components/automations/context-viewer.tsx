'use client'

import { useState } from 'react'
import { TASK_VARIABLE_CATALOG } from '@/lib/task-data'
import { ChevronDown, ChevronRight, Variable, Globe, Zap, Database } from 'lucide-react'
import type { WorkflowNode } from '@/lib/workflow-schema'
import { cn } from '@/lib/utils'

interface ContextViewerProps {
  nodes: WorkflowNode[]
  triggerType: string
}

export function ContextViewer({ nodes, triggerType }: ContextViewerProps) {
  const [expanded, setExpanded] = useState(false)

  // Collect all variables from the workflow
  const variables: { name: string; source: string; sourceIcon: string; type: string }[] = []

  const TASK_TRIGGERS = ['task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected']
  const DATA_TRIGGERS = ['data_table_event']

  // Core workflow variables (always available)
  variables.push({ name: '_title', source: 'Workflow', sourceIcon: 'variable', type: 'auto' })
  variables.push({ name: 'tenant_id', source: 'Workflow', sourceIcon: 'variable', type: 'auto' })

  // Task context variables (available for all task triggers)
  if (TASK_TRIGGERS.includes(triggerType)) {
    const taskVars = ['task_id', ...TASK_VARIABLE_CATALOG.map(v => v.name)]
    taskVars.forEach(v => variables.push({ name: v, source: 'Task Trigger', sourceIcon: 'trigger', type: 'auto' }))
  }

  if (DATA_TRIGGERS.includes(triggerType)) {
    ;['data_event', 'data_event_type', 'data_table_id', 'data_table_name', 'data_table_slug', 'data_row_id', 'row_id', 'data_row', 'row'].forEach(v =>
      variables.push({ name: v, source: 'Data Table Trigger', sourceIcon: 'trigger', type: 'auto' })
    )
    const triggerNode = nodes.find(n => n.type === 'data_table_event')
    const triggerColumns = (triggerNode?.config?._table_columns ?? []) as { key: string }[]
    for (const column of triggerColumns) {
      variables.push({ name: column.key, source: 'Data Table Trigger', sourceIcon: 'trigger', type: 'auto' })
      variables.push({ name: `row.${column.key}`, source: 'Data Table Trigger', sourceIcon: 'trigger', type: 'auto' })
      variables.push({ name: `data_row.${column.key}`, source: 'Data Table Trigger', sourceIcon: 'trigger', type: 'auto' })
    }
  }

  // Webhook variables
  const webhookNode = nodes.find(n => n.type === 'webhook_received' || n.type === 'middleware_received')
  if (webhookNode || triggerType === 'webhook_received' || triggerType === 'middleware_received') {
    variables.push({ name: '_raw', source: 'Webhook', sourceIcon: 'webhook', type: 'object' })
  }

  // Workflow error variables
  if (triggerType === 'workflow_error') {
    ['error_workflow_id', 'error_workflow_name', 'error_run_id', 'error_message', 'error_node', 'error_timestamp'].forEach(v =>
      variables.push({ name: v, source: 'Workflow Error', sourceIcon: 'trigger', type: 'auto' })
    )
  }

  if (triggerType === 'retention_policy_review') {
    ['retention_review_event_id', 'retention_policy_id', 'retention_policy_name', 'retention_policy_mode', 'retention_review_date', 'retention_target_type', 'retention_target_id', 'retention_asset_name'].forEach(v =>
      variables.push({ name: v, source: 'Policy Review', sourceIcon: 'trigger', type: 'auto' })
    )
  }

  if (triggerType === 'retention_policy_executed') {
    ['retention_execution_event_id', 'retention_policy_id', 'retention_policy_name', 'retention_policy_mode', 'retention_action_type', 'retention_execution_date', 'retention_target_type', 'retention_target_id', 'retention_asset_name'].forEach(v =>
      variables.push({ name: v, source: 'Policy Executed', sourceIcon: 'trigger', type: 'auto' })
    )
  }

  // Call Reference output mappings
  nodes.filter(n => n.type === 'call_reference').forEach(n => {
    const outputMappings = n.config.output_mappings as Record<string, { enabled: boolean; variableName: string }> | undefined
    if (outputMappings) {
      Object.entries(outputMappings).forEach(([outputName, mapping]) => {
        if (mapping.enabled && mapping.variableName) {
          variables.push({ name: mapping.variableName, source: `API: ${n.label}`, sourceIcon: 'api', type: 'dynamic' })
        }
      })
    }
    // Always-available api_response/api_status
    const prefix = n.config._output_prefix || n.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
    variables.push({ name: `${prefix}_response`, source: n.label, sourceIcon: 'api', type: 'auto' })
    variables.push({ name: `${prefix}_status`, source: n.label, sourceIcon: 'api', type: 'auto' })
  })

  // Default output variable names per node type (used when user hasn't set a custom name)
  const OUTPUT_VAR_DEFAULTS: Record<string, string> = {
    math: 'result', modify_string: 'modified_string', text_template: 'text',
    format_date: 'formatted_date', date_math: 'new_date', regex: 'regex_result',
    collection_count: 'count', collection_get: 'item', collection_filter: 'filtered',
    collection_sort: 'sorted', collection_unique: 'unique', collection_join: 'joined',
    json_build_object: 'json_object', json_build_array: 'json_array', json_get_value: 'json_value',
    read_csv: 'csv_data', read_excel: 'excel_data',
    file_to_base64: 'file_base64', base64_to_file: 'file_url',
    download_file: 'downloaded_file', read_file: 'file_content',
    doc_word: 'doc_file', doc_excel: 'doc_file', doc_powerpoint: 'doc_file',
  }

  // Nodes with output variables
  for (const n of nodes) {
    const defaultVar = OUTPUT_VAR_DEFAULTS[n.type]
    if (defaultVar) {
      const varName = n.config.output_var || defaultVar
      // For CSV/Excel write mode, different defaults
      const isWriteMode = (n.type === 'read_csv' || n.type === 'read_excel') && n.config.mode === 'write'
      const finalVar = isWriteMode ? (n.config.output_var || (n.type === 'read_csv' ? 'csv_file' : 'excel_file')) : varName
      variables.push({ name: finalVar, source: n.label, sourceIcon: 'variable', type: 'dynamic' })
      // Extra variables for some types
      if (n.type === 'read_csv' && !isWriteMode) {
        variables.push({ name: `${finalVar}_count`, source: n.label, sourceIcon: 'variable', type: 'auto' })
        variables.push({ name: `${finalVar}_headers`, source: n.label, sourceIcon: 'variable', type: 'auto' })
      }
      if (n.type === 'read_excel' && !isWriteMode) {
        variables.push({ name: `${finalVar}_count`, source: n.label, sourceIcon: 'variable', type: 'auto' })
        variables.push({ name: `${finalVar}_sheets`, source: n.label, sourceIcon: 'variable', type: 'auto' })
      }
    }

    // Set Variable
    if (n.type === 'set_variable' && n.config.name) {
      variables.push({ name: n.config.name, source: n.label, sourceIcon: 'variable', type: 'dynamic' })
    }

    if (n.type === 'custom_activity') {
      const outputs = Array.isArray(n.config.manifest?.outputs) ? n.config.manifest.outputs : []
      const prefix = n.config._output_prefix || n.config.custom_activity_key || n.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
      for (const output of outputs) {
        const name = String(output?.name ?? output?.key ?? '').trim()
        if (!name) continue
        variables.push({ name, source: `Custom Activity: ${n.label}`, sourceIcon: 'variable', type: 'dynamic' })
        variables.push({ name: `${prefix}_${name}`, source: `Custom Activity: ${n.label}`, sourceIcon: 'variable', type: 'auto' })
      }
    }

    if (n.type === 'run_agent') {
      const outputVar = n.config.output_variable || 'agent_response'
      const prefix = n.config._output_prefix || n.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
      variables.push({ name: outputVar, source: `Agent: ${n.label}`, sourceIcon: 'variable', type: 'dynamic' })
      variables.push({ name: `${outputVar}_status`, source: `Agent: ${n.label}`, sourceIcon: 'variable', type: 'auto' })
      variables.push({ name: `${outputVar}_duration_ms`, source: `Agent: ${n.label}`, sourceIcon: 'variable', type: 'auto' })
      variables.push({ name: `${outputVar}_iterations`, source: `Agent: ${n.label}`, sourceIcon: 'variable', type: 'auto' })
      variables.push({ name: `${outputVar}_tool_calls`, source: `Agent: ${n.label}`, sourceIcon: 'variable', type: 'auto' })
      variables.push({ name: `${outputVar}_usage`, source: `Agent: ${n.label}`, sourceIcon: 'variable', type: 'auto' })
      const outputs = Array.isArray(n.config._agent_outputs) ? n.config._agent_outputs : []
      for (const output of outputs) {
        const name = String(output?.name ?? '').trim()
        if (!name) continue
        variables.push({ name, source: `Agent: ${n.label}`, sourceIcon: 'variable', type: 'dynamic' })
        variables.push({ name: `${prefix}_${name}`, source: `Agent: ${n.label}`, sourceIcon: 'variable', type: 'auto' })
      }
    }

    if (n.type === 'retention_policies') {
      const prefix = n.config._output_prefix || n.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
      ;['operation', 'retention_policy_id', 'retention_policy_name', 'policy_count', 'asset_count', 'target_type', 'target_id', 'assigned'].forEach((key) => {
        variables.push({ name: `${prefix}_${key}`, source: `Retention Policies: ${n.label}`, sourceIcon: 'variable', type: 'auto' })
      })
      ;['policy', 'policies', 'assets', 'data_tables', 'data_rows'].forEach((key) => {
        variables.push({ name: `${prefix}_${key}`, source: `Retention Policies: ${n.label}`, sourceIcon: 'variable', type: 'auto' })
      })
    }

    // Set Title
    if (n.type === 'set_title') {
      variables.push({ name: '_title', source: n.label, sourceIcon: 'variable', type: 'dynamic' })
    }

    // JSON Add to Array
    if (n.type === 'json_add_to_array') {
      const arrVar = n.config.array_var || 'json_array'
      variables.push({ name: arrVar, source: n.label, sourceIcon: 'variable', type: 'dynamic' })
    }

    // Loop
    if (n.type === 'loop') {
      const itemVar = n.config.item_var ?? 'item'
      variables.push({ name: itemVar, source: `Loop: ${n.label}`, sourceIcon: 'variable', type: 'dynamic' })
      variables.push({ name: `${itemVar}_count`, source: `Loop: ${n.label}`, sourceIcon: 'variable', type: 'auto' })
    }
    if (n.type === 'loop_n_times') {
      const indexVar = n.config.index_var ?? 'i'
      variables.push({ name: indexVar, source: `Loop: ${n.label}`, sourceIcon: 'variable', type: 'dynamic' })
      variables.push({ name: `${indexVar}_total`, source: `Loop: ${n.label}`, sourceIcon: 'variable', type: 'auto' })
    }

    // User Task
    if (n.type === 'user_task') {
      const prefix = n.config._output_prefix || n.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
      variables.push({ name: `${prefix}_task_id`, source: n.label, sourceIcon: 'trigger', type: 'auto' })
      variables.push({ name: `${prefix}_event_id`, source: n.label, sourceIcon: 'trigger', type: 'auto' })
      variables.push({ name: 'user_task_id', source: n.label, sourceIcon: 'trigger', type: 'auto' })
    }

    if (n.type === 'create_subtask') {
      const prefix = n.config._output_prefix || n.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
      variables.push({ name: `${prefix}_subtask_id`, source: n.label, sourceIcon: 'task', type: 'auto' })
    }

    // Server Event
    if (n.type === 'server_event') {
      const prefix = n.config._output_prefix || n.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
      variables.push({ name: `${prefix}_event_id`, source: n.label, sourceIcon: 'trigger', type: 'auto' })
      variables.push({ name: 'event_id', source: n.label, sourceIcon: 'trigger', type: 'auto' })
    }

    // HTTP Request
    if (n.type === 'http_request') {
      const prefix = n.config._output_prefix || n.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
      variables.push({ name: `${prefix}_response`, source: n.label, sourceIcon: 'api', type: 'auto' })
      variables.push({ name: `${prefix}_file`, source: n.label, sourceIcon: 'api', type: 'auto' })
    }

    // Sub Workflow
    if (n.type === 'call_sub_workflow') {
      const prefix = n.config._output_prefix || n.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
      variables.push({ name: `${prefix}_status`, source: n.label, sourceIcon: 'variable', type: 'auto' })
      variables.push({ name: `${prefix}_results`, source: n.label, sourceIcon: 'variable', type: 'auto' })
    }
  }

  const sourceIcons: Record<string, any> = {
    trigger: Zap,
    webhook: Globe,
    variable: Variable,
    api: Database,
  }

  if (variables.length === 0) return null

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold"
        style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
      >
        <span className="flex items-center gap-1.5">
          <Variable size={12} style={{ color: 'var(--theme-primary-text)' }} />
          Context Variables ({variables.length})
        </span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {expanded && (
        <div className="max-h-48 overflow-y-auto" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
          {variables.map((v, i) => {
            const Icon = sourceIcons[v.sourceIcon] ?? Variable
            return (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-1.5 text-[10px] border-t"
                style={{ borderColor: 'var(--theme-surface-border)' }}
              >
                <Icon size={10} style={{ color: 'var(--theme-primary-text)' }} />
                <code className="font-mono font-medium" style={{ color: 'var(--theme-primary-text)' }}>
                  {`{{${v.name}}}`}
                </code>
                <span className="flex-1" />
                <span style={{ color: 'var(--theme-muted-text)' }}>
                  {v.source}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
