'use client'

import { useState, useMemo } from 'react'
import { TASK_VARIABLE_CATALOG } from '@/lib/task-data'
import { Variable, Search, X, Copy, Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { buildDataTree, type PickerEdgeLike, type PickerNodeLike } from '@/lib/workflow-data-picker'
import { DataTree } from './data-picker'
import { useActiveInput } from './active-input'
import { useLinkedForms } from './linked-forms'
import { DATA_DRAG_MIME, encodeDragPayload } from '@/lib/workflow-data-drop'

const CONTEXT_VARIABLES = [
  { group: 'Quick Reference', vars: [
    { name: '_title', description: 'Workflow instance title' },
    { name: 'tenant_id', description: 'Current tenant ID' },
    { name: 'task_id', description: 'Triggering task ID (shorthand)' },
    { name: 'workflow_started_by', description: 'User who started the run (the owner when no one did)' },
    { name: 'workflow_started_via', description: 'How the run started: ui, form, api, cli, mcp, task, schedule, …' },
    { name: 'workflow_owner_id', description: "The workflow's creator" },
  ]},
  { group: 'Task', vars: TASK_VARIABLE_CATALOG.filter(v => v.group === 'Task').map(({ name, description }) => ({ name, description })) },
  { group: 'Task Data', vars: TASK_VARIABLE_CATALOG.filter(v => v.group === 'Task Data').map(({ name, description }) => ({ name, description })) },
  { group: 'Dates', vars: TASK_VARIABLE_CATALOG.filter(v => v.group === 'Dates').map(({ name, description }) => ({ name, description })) },
  { group: 'Workflow', vars: [
    { name: 'task.workflow_source_id', description: 'Workflow source' },
    { name: 'task.workflow_step_id', description: 'Current step' },
    { name: 'task.workflow_position', description: 'Position in workflow' },
  ]},
  { group: 'Metadata', vars: [
    { name: 'task.metadata', description: 'Full metadata JSON' },
  ]},
  { group: 'API / Reference', vars: [
    { name: 'api_response', description: 'Full response from last Call API node' },
    { name: 'api_status', description: 'HTTP status code from last Call API' },
    { name: 'api_file', description: 'File object from binary API response' },
    { name: 'api_file_url', description: 'URL of file from binary API response' },
    { name: 'http_file', description: 'File object from HTTP Request binary response' },
    { name: 'http_file_url', description: 'URL of file from HTTP Request binary response' },
  ]},
  { group: 'Error Handling', vars: [
    { name: 'has_error', description: 'True if any node has errored' },
    { name: 'last_error', description: 'Error message from last failed node' },
    { name: 'last_error_node', description: 'Label of the node that failed' },
    { name: 'last_error_node_id', description: 'ID of the node that failed' },
    { name: 'last_error_node_type', description: 'Type of the node that failed' },
  ]},
  { group: 'Workflow Error Trigger', vars: [
    { name: 'error_workflow_id', description: 'ID of the workflow that failed' },
    { name: 'error_workflow_name', description: 'Name of the workflow that failed' },
    { name: 'error_run_id', description: 'Run ID of the failed execution' },
    { name: 'error_message', description: 'The error message' },
    { name: 'error_node', description: 'Label of the node that caused the failure' },
    { name: 'error_timestamp', description: 'When the error occurred' },
  ]},
  { group: 'Retention Review Trigger', vars: [
    { name: 'retention_review_event_id', description: 'Retention review event ID' },
    { name: 'retention_policy_id', description: 'Retention policy ID' },
    { name: 'retention_policy_name', description: 'Retention policy name' },
    { name: 'retention_policy_mode', description: 'Retention policy mode' },
    { name: 'retention_review_date', description: 'Date the review became due' },
    { name: 'retention_target_type', description: 'Target object type' },
    { name: 'retention_target_id', description: 'Target object ID' },
    { name: 'retention_asset_name', description: 'Asset name at review time' },
  ]},
  { group: 'Retention Execution Trigger', vars: [
    { name: 'retention_execution_event_id', description: 'Retention execution event ID' },
    { name: 'retention_policy_id', description: 'Retention policy ID' },
    { name: 'retention_policy_name', description: 'Retention policy name' },
    { name: 'retention_policy_mode', description: 'Retention policy mode' },
    { name: 'retention_action_type', description: 'Executed action type, such as purge' },
    { name: 'retention_execution_date', description: 'Date the retention action became due' },
    { name: 'retention_target_type', description: 'Target object type' },
    { name: 'retention_target_id', description: 'Target object ID' },
    { name: 'retention_asset_name', description: 'Asset name at execution time' },
  ]},
  { group: 'Data Table Trigger', vars: [
    { name: 'data_event', description: 'Data event type: created, updated, or deleted' },
    { name: 'data_event_type', description: 'Alias of the data event type' },
    { name: 'data_table_id', description: 'Triggering table ID' },
    { name: 'data_table_name', description: 'Triggering table name' },
    { name: 'data_table_slug', description: 'Triggering table slug' },
    { name: 'data_row_id', description: 'Triggering row ID' },
    { name: 'row_id', description: 'Alias of the triggering row ID' },
    { name: 'data_row', description: 'Triggering row object' },
    { name: 'row', description: 'Alias of the triggering row object' },
  ]},
]

interface UserVariable {
  id: string
  name: string
  type: 'string' | 'number' | 'boolean' | 'object'
  defaultValue: string
  description: string
}

const TASK_TRIGGERS = ['task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected']
const DATA_TRIGGERS = ['data_table_event']

// Groups that only show for specific trigger types
const GROUP_TRIGGER_MAP: Record<string, string[]> = {
  'Task': TASK_TRIGGERS,
  'Dates': TASK_TRIGGERS,
  'Workflow': TASK_TRIGGERS, // task.workflow_source_id etc
  'Metadata': TASK_TRIGGERS,
  'Data Table Trigger': DATA_TRIGGERS,
  'Workflow Error Trigger': ['workflow_error'],
  'Retention Review Trigger': ['retention_policy_review'],
  'Retention Execution Trigger': ['retention_policy_executed'],
}

interface VariablesPanelProps {
  open: boolean
  onClose: () => void
  nodes?: { id?: string; type: string; label: string; config: Record<string, any> }[]
  /** Edges + the selected step scope the Data tab to that step's upstream data. */
  edges?: PickerEdgeLike[]
  selectedNodeId?: string | null
  onInsertLoopBefore?: (nodeId: string, itemsExpression: string) => void
  userVariables?: UserVariable[]
  triggerType?: string
}

export function VariablesPanel({ open, onClose, nodes, edges, selectedNodeId, onInsertLoopBefore, userVariables, triggerType }: VariablesPanelProps) {
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [tab, setTab] = useState<'data' | 'all'>('data')
  const { insertIntoActive } = useActiveInput()
  const linkedForms = useLinkedForms()
  const pickerNodes = useMemo(() => (nodes ?? []).filter((n) => n.id) as PickerNodeLike[], [nodes])
  const dataGroups = useMemo(() => buildDataTree({
    nodes: pickerNodes,
    edges: edges ?? [],
    currentNodeId: selectedNodeId ?? null,
    workflowVariables: userVariables,
    linkedForms,
  }), [pickerNodes, edges, selectedNodeId, userVariables, linkedForms])
  // "All variables": form fields (labelled) first, like the Data tab.
  const formFieldGroups = useMemo(() => dataGroups
    .filter((group) => group.kind === 'form' || group.kind === 'workflow')
    .map((group) => ({ group: group.label, vars: group.roots.map((root) => ({ name: root.path, description: root.label !== root.path ? `${root.label}${root.description ? ` · ${root.description}` : ''}` : (root.description ?? '') })) })), [dataGroups])
  const selectedLabel = selectedNodeId ? pickerNodes.find((n) => n.id === selectedNodeId)?.label : null
  const selectedType = selectedNodeId ? pickerNodes.find((n) => n.id === selectedNodeId)?.type : null

  /** Insert into the last-focused field; otherwise copy. */
  function applyToken(token: string) {
    if (insertIntoActive(token)) {
      setCopied(token)
    } else {
      void navigator.clipboard?.writeText(token)
      setCopied(token)
    }
    setTimeout(() => setCopied(null), 1500)
  }

  // Default output variable names per node type
  const OUTPUT_DEFAULTS: Record<string, string> = {
    math: 'result', modify_string: 'modified_string', text_template: 'text',
    format_date: 'formatted_date', date_math: 'new_date', regex: 'regex_result',
    collection_count: 'count', collection_get: 'item', collection_filter: 'filtered',
    collection_sort: 'sorted', collection_unique: 'unique', collection_join: 'joined',
    json_build_object: 'json_object', json_build_array: 'json_array', json_get_value: 'json_value',
    doc_word: 'doc_file', doc_excel: 'doc_file', doc_powerpoint: 'doc_file',
    file_to_base64: 'file_base64', base64_to_file: 'file_url',
    download_file: 'downloaded_file', read_file: 'file_content',
  }

  // Extract dynamic variables from workflow nodes
  const dynamicGroups = useMemo(() => {
    if (!nodes?.length) return []
    const groups: { group: string; vars: { name: string; description: string }[] }[] = []

    const dataTriggerNode = nodes.find(node => node.type === 'data_table_event')
    const triggerTableColumns = (dataTriggerNode?.config?._table_columns ?? []) as { key: string; label?: string; type?: string }[]
    if (triggerTableColumns.length > 0) {
      groups.push({
        group: '🗃️ Trigger Row',
        vars: triggerTableColumns.flatMap((col) => ([
          { name: col.key, description: `${col.label ?? col.key} (${col.type ?? 'text'})` },
          { name: `row.${col.key}`, description: `${col.label ?? col.key} on the triggering row` },
          { name: `data_row.${col.key}`, description: `${col.label ?? col.key} on the triggering row` },
        ])),
      })
    }

    for (const node of nodes) {
      const c = node.config
      const nodeLabel = node.label || node.type
      const prefix = c._output_prefix || nodeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)

      // Call API / Reference
      if (node.type === 'call_reference') {
        const vars: { name: string; description: string }[] = [
          { name: `${prefix}_response`, description: 'Full API response' },
          { name: `${prefix}_status`, description: 'HTTP status code' },
          { name: 'api_response', description: 'Full response (latest)' },
          { name: 'api_status', description: 'Status code (latest)' },
        ]
        const refOutputs = (c._ref_outputs ?? []) as { name: string; path?: string; type?: string }[]
        if (c.output_mappings) {
          for (const [outName, mapping] of Object.entries(c.output_mappings as Record<string, any>)) {
            if (mapping?.enabled && mapping.variableName) {
              const refOut = refOutputs.find(o => o.name === outName)
              const isArray = refOut?.type === 'array' || refOut?.type === 'list'
              vars.push({ name: mapping.variableName, description: `${isArray ? '[LIST] ' : ''}${outName}` })
              if (isArray) {
                refOutputs.filter(o => o.path?.startsWith('[].') ).slice(0, 8).forEach(col => {
                  vars.push({ name: `item.${col.path!.replace('[].', '')}`, description: `${col.type ?? 'field'} — use in Loop` })
                })
              }
            }
          }
        }
        groups.push({ group: `📡 ${nodeLabel}`, vars })
      }

      // HTTP Request
      if (node.type === 'http_request') {
        groups.push({ group: `📡 ${nodeLabel}`, vars: [
          { name: `${prefix}_response`, description: 'Response data' },
          { name: `${prefix}_file`, description: 'File (if binary response)' },
          { name: `${prefix}_file_url`, description: 'File URL (if binary)' },
        ]})
      }

      // Set Variable
      if (node.type === 'set_variable' && c.name) {
        groups.push({ group: `📌 ${nodeLabel}`, vars: [{ name: c.name, description: c.expression || 'set variable' }] })
      }

      if (node.type === 'custom_activity') {
        const outputs = Array.isArray(c.manifest?.outputs) ? c.manifest.outputs : []
        const customPrefix = c._output_prefix || c.custom_activity_key || nodeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
        const vars = outputs.flatMap((output: any) => {
          const key = String(output?.name ?? output?.key ?? '').trim()
          if (!key) return []
          return [
            { name: key, description: `${output?.label ?? key} output` },
            { name: `${customPrefix}_${key}`, description: `Prefixed ${output?.label ?? key} output` },
          ]
        })
        if (vars.length > 0) {
          groups.push({ group: `🧩 ${nodeLabel}`, vars })
        }
      }

      if (node.type === 'run_agent') {
        const outputVar = c.output_variable || 'agent_response'
        const agentPrefix = c._output_prefix || nodeLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
        const vars: { name: string; description: string }[] = [
          { name: outputVar, description: 'Agent response text' },
          { name: `${outputVar}_status`, description: 'Execution status' },
          { name: `${outputVar}_duration_ms`, description: 'Execution duration in milliseconds' },
          { name: `${outputVar}_iterations`, description: 'Number of agent/tool iterations' },
          { name: `${outputVar}_tool_calls`, description: 'Number of tool calls made' },
          { name: `${outputVar}_usage`, description: 'Token usage payload' },
        ]
        const outputs = Array.isArray(c._agent_outputs) ? c._agent_outputs : []
        for (const output of outputs) {
          const key = String(output?.name ?? '').trim()
          if (!key) continue
          vars.push({ name: key, description: output?.description || `${key} from agent output schema` })
          vars.push({ name: `${agentPrefix}_${key}`, description: `Prefixed ${output?.description || key}` })
        }
        groups.push({ group: `🤖 ${nodeLabel}`, vars })
      }

      // Operations with output_var (use defaults when not explicitly set)
      const defaultVar = OUTPUT_DEFAULTS[node.type]
      if (defaultVar) {
        const ov = c.output_var || defaultVar
        const vars: { name: string; description: string }[] = [{ name: ov, description: `Output from ${nodeLabel}` }]
        if (['file_to_base64', 'download_file'].includes(node.type)) {
          vars.push({ name: `${ov}_name`, description: 'Filename' }, { name: `${ov}_size`, description: 'Size' })
        }
        if (node.type === 'download_file') vars.push({ name: `${ov}_base64`, description: 'Base64' })
        if (node.type === 'base64_to_file') vars.push({ name: `${ov}_path`, description: 'Storage path' })
        groups.push({ group: `🔧 ${nodeLabel}`, vars })
      }

      // CSV (read/write)
      if (node.type === 'read_csv') {
        const isWrite = c.mode === 'write'
        const ov = c.output_var || (isWrite ? 'csv_file' : 'csv_data')
        const vars: { name: string; description: string }[] = [{ name: ov, description: isWrite ? 'Generated CSV file' : 'Parsed rows (JSON array)' }]
        if (!isWrite) {
          vars.push({ name: `${ov}_count`, description: 'Row count' })
          vars.push({ name: `${ov}_headers`, description: 'Column headers' })
        }
        groups.push({ group: `📄 ${nodeLabel}`, vars })
      }

      // Excel (read/write)
      if (node.type === 'read_excel') {
        const isWrite = c.mode === 'write'
        const ov = c.output_var || (isWrite ? 'excel_file' : 'excel_data')
        const vars: { name: string; description: string }[] = [{ name: ov, description: isWrite ? 'Generated Excel file' : 'Parsed rows (JSON array)' }]
        if (!isWrite) {
          vars.push({ name: `${ov}_count`, description: 'Row count' })
          vars.push({ name: `${ov}_sheets`, description: 'Sheet names' })
        }
        groups.push({ group: `📊 ${nodeLabel}`, vars })
      }

      // JSON operations
      if (node.type === 'json_add_to_array') {
        const av = c.array_var || 'json_array'
        groups.push({ group: `🔧 ${nodeLabel}`, vars: [{ name: av, description: 'Array being built' }] })
      }

      // Loop
      if (node.type === 'loop') {
        const itemVar = c.item_var || 'item'
        const vars: { name: string; description: string }[] = [
          { name: itemVar, description: 'Current item' },
          { name: `${itemVar}_count`, description: 'Total items' },
        ]
        if (c.items) {
          const refVarName = String(c.items).replace(/\{\{|\}\}/g, '')
          for (const refNode of (nodes ?? [])) {
            if (refNode.type === 'call_reference' && refNode.config?.output_mappings) {
              for (const [, mapping] of Object.entries(refNode.config.output_mappings as Record<string, any>)) {
                if ((mapping as any)?.variableName === refVarName) {
                  const refOutputs = (refNode.config._ref_outputs ?? []) as { name: string; path?: string; type?: string }[]
                  refOutputs.filter(o => o.path?.startsWith('[].') ).forEach(col => {
                    vars.push({ name: `${itemVar}.${col.path!.replace('[].', '')}`, description: `${col.type ?? 'field'} from each row` })
                  })
                }
              }
            }
          }
        }
        groups.push({ group: `🔁 ${nodeLabel}`, vars })
      }
      if (node.type === 'loop_n_times') {
        const iv = c.index_var || 'i'
        groups.push({ group: `🔁 ${nodeLabel}`, vars: [
          { name: iv, description: 'Current index' }, { name: `${iv}_total`, description: 'Total iterations' },
        ]})
      }

      // User Task
      if (node.type === 'user_task') {
        groups.push({ group: `👤 ${nodeLabel}`, vars: [
          { name: `${prefix}_task_id`, description: 'Created task ID' },
          { name: `${prefix}_event_id`, description: 'Event ID for resume' },
          { name: 'user_task_id', description: 'Task ID (latest)' },
          { name: 'outcome', description: 'Task outcome after completion' },
        ]})
      }

      // Server Event
      if (node.type === 'server_event') {
        groups.push({ group: `📡 ${nodeLabel}`, vars: [
          { name: `${prefix}_event_id`, description: 'Event ID' },
          { name: 'event_id', description: 'Event ID (latest)' },
        ]})
      }

      // Sub Workflow
      if (node.type === 'call_sub_workflow') {
        groups.push({ group: `🔗 ${nodeLabel}`, vars: [
          { name: `${prefix}_status`, description: 'Sub-workflow result status' },
          { name: `${prefix}_results`, description: 'Sub-workflow node results' },
        ]})
      }

      // Data (update_data_table) — list, get, insert, update, delete
      if (node.type === 'update_data_table') {
        const op = c.operation ?? 'insert'
        const vars: { name: string; description: string }[] = []
        const tableCols = (c._table_columns ?? []) as { key: string; label?: string; type?: string }[]
        if (op === 'list') {
          const rowsVar = c.output_rows_var || 'rows'
          const countVar = c.output_count_var || 'row_count'
          vars.push({ name: rowsVar, description: 'Array of rows (use in Loop)' })
          vars.push({ name: countVar, description: 'Number of rows returned' })
          // Show column fields available in each row (for Loop item access)
          for (const col of tableCols) {
            vars.push({ name: `item.${col.key}`, description: `${col.label ?? col.key} (${col.type ?? 'text'}) — use in Loop` })
          }
          if (c.live_reference) {
            vars.push({ name: `live.${rowsVar}`, description: '⚡ Re-queries table on each access' })
            vars.push({ name: `live_${rowsVar}`, description: '⚡ Same (shorthand)' })
          }
        } else if (op === 'get') {
          const rowVar = c.output_row_var || 'row'
          const rowIdVar = c.output_row_id_var || 'row_id'
          vars.push({ name: rowVar, description: 'Row object with all columns' })
          vars.push({ name: rowIdVar, description: 'Row ID' })
          // Show individual column accessors
          for (const col of tableCols) {
            vars.push({ name: `${rowVar}.${col.key}`, description: `${col.label ?? col.key} (${col.type ?? 'text'})` })
          }
          if (c.live_reference) {
            vars.push({ name: `live.${rowVar}`, description: '⚡ Re-fetches row on each access' })
            vars.push({ name: `live_${rowVar}`, description: '⚡ Same (shorthand)' })
            for (const col of tableCols) {
              vars.push({ name: `live.${rowVar}.${col.key}`, description: `⚡ ${col.label ?? col.key} (${col.type ?? 'text'})` })
            }
          }
        } else {
          // insert, update, delete
          const rowIdVar = c.output_row_id_var || 'row_id'
          vars.push({ name: rowIdVar, description: `Row ID from ${op}` })
        }
        groups.push({ group: `🗃️ ${nodeLabel}`, vars })
      }

      // Live Reference
      if (node.type === 'live_reference') {
        const bindingName = c.binding_name || prefix
        const liveVars: { name: string; description: string }[] = []
        // Full response — use in Loop items for list APIs
        liveVars.push({ name: `live.${bindingName}`, description: '⚡ Full response — use as Loop items for lists' })
        liveVars.push({ name: `live_${bindingName}`, description: '⚡ Same as above (shorthand)' })
        // Individual output fields
        const refOutputs = (c._ref_outputs ?? []) as { name: string; path?: string; type?: string }[]
        if (refOutputs.length > 0) {
          for (const out of refOutputs) {
            liveVars.push({ name: `live.${bindingName}.${out.name}`, description: `⚡ ${out.name}${out.type ? ` (${out.type})` : ''}` })
          }
        }
        groups.push({ group: `⚡ ${nodeLabel} (Live)`, vars: liveVars })
      }
    }
    return groups
  }, [nodes])

  const userVarGroup = userVariables?.length ? [{
    group: '🔑 Workflow Variables',
    vars: userVariables.map(v => ({
      name: v.name,
      description: `${v.description || v.type}${v.defaultValue ? ` (default: ${v.defaultValue})` : ''}`,
    })),
  }] : []

  // Filter context variables based on trigger type
  const filteredContextVars = CONTEXT_VARIABLES.filter(group => {
    const requiredTriggers = GROUP_TRIGGER_MAP[group.group]
    if (!requiredTriggers) return true
    if (!triggerType) return true
    return requiredTriggers.includes(triggerType)
  })

  const allGroups = [...formFieldGroups, ...(formFieldGroups.some((g) => g.group.startsWith('Start form')) ? [] : userVarGroup), ...filteredContextVars, ...dynamicGroups]

  const filtered = useMemo(() => {
    if (!search.trim()) return allGroups
    const q = search.toLowerCase()
    return allGroups
      .map(group => ({
        ...group,
        vars: group.vars.filter(
          v => v.name.toLowerCase().includes(q) || v.description.toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.vars.length > 0)
  }, [search, allGroups])

  function copyVariable(name: string) {
    navigator.clipboard.writeText(`{{${name}}}`)
    setCopied(name)
    setTimeout(() => setCopied(null), 1500)
  }

  if (!open) return null

  return (
    <div
      className="absolute top-14 right-3 z-30 w-[min(20rem,calc(100vw-2rem))] max-h-[520px] flex flex-col rounded-xl shadow-xl border overflow-hidden"
      style={{
        backgroundColor: 'var(--theme-card-bg)',
        borderColor: 'var(--theme-surface-border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 shrink-0"
        style={{ borderBottom: '1px solid var(--theme-surface-border)' }}
      >
        <div className="flex items-center gap-1.5">
          <Variable size={14} style={{ color: 'var(--theme-primary-text)' }} />
          <span className="text-xs font-semibold">Context Variables</span>
          {triggerType && <span className="text-[8px] ml-1 px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>{triggerType}</span>}
        </div>
        <button onClick={onClose} className="p-0.5 rounded hover:opacity-70">
          <X size={14} style={{ color: 'var(--theme-muted-text)' }} />
        </button>
      </div>

      {/* Tabs: Data (tree of upstream outputs) | All variables (flat list) */}
      <div role="tablist" aria-label="Variable views" className="flex gap-1 px-3 pt-2 shrink-0">
        {(['data', 'all'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className="rounded-md px-2 py-1 text-[11px] font-medium"
            style={{
              backgroundColor: tab === key ? 'var(--theme-primary-light)' : 'transparent',
              color: tab === key ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
            }}
          >
            {key === 'data' ? 'Data' : 'All variables'}
          </button>
        ))}
      </div>

      {tab === 'data' && (
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <p className="px-3 pt-1.5 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
            {selectedLabel ? <>Data available at <strong style={{ color: 'var(--theme-card-text)' }}>{selectedLabel}</strong>. Drag a field onto an input, or click to insert it into the field you last edited (or copy).</> : 'Select a step to see only the data available to it.'}
          </p>
          {copied && <p role="status" className="px-3 text-[10px]" style={{ color: 'var(--theme-primary-text)' }}>Inserted {copied}</p>}
          <DataTree
            groups={dataGroups}
            maxHeight={300}
            onPick={applyToken}
            onLoop={selectedNodeId && onInsertLoopBefore && selectedType !== 'loop' ? (items, insert) => { onInsertLoopBefore(selectedNodeId, items); applyToken(insert) } : undefined}
          />
        </div>
      )}

      {tab === 'all' && (<>
      {/* Search */}
      <div className="px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search variables..."
            className="!text-xs !pl-7 !h-8"
          />
        </div>
      </div>

      {/* Variable list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {filtered.length === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: 'var(--theme-muted-text)' }}>
            No variables matching &ldquo;{search}&rdquo;
          </p>
        ) : (
          filtered.map((group, idx) => (
            <div key={`${group.group}-${idx}`}>
              <p
                className="text-[9px] font-semibold uppercase tracking-wider px-1.5 mb-1"
                style={{ color: 'var(--theme-muted-text)' }}
              >
                {group.group}
              </p>
              {group.vars.map((v) => (
                <button
                  key={v.name}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', `{{${v.name}}}`)
                    e.dataTransfer.setData(DATA_DRAG_MIME, encodeDragPayload({ path: v.name, label: v.name, type: 'any', needsChoices: false }))
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => copyVariable(v.name)}
                  className="flex items-center gap-2 w-full text-left px-1.5 py-1.5 rounded text-[11px] transition-colors hover:opacity-80 cursor-grab active:cursor-grabbing"
                  style={{ backgroundColor: copied === v.name ? 'var(--theme-primary-light)' : 'transparent' }}
                >
                  <code
                    className="font-mono shrink-0"
                    style={{ color: 'var(--theme-primary-text)', fontSize: '10px' }}
                  >
                    {`{{${v.name}}}`}
                  </code>
                  <span className="flex-1 truncate" style={{ color: 'var(--theme-muted-text)', fontSize: '10px' }}>
                    {v.description}
                  </span>
                  {copied === v.name ? (
                    <Check size={10} className="shrink-0 text-[color:var(--theme-card-text)]" />
                  ) : (
                    <Copy size={10} className="shrink-0 opacity-0 group-hover:opacity-100" style={{ color: 'var(--theme-muted-text)' }} />
                  )}
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      </>)}

      {/* Footer */}
      <div
        className="px-3 py-1.5 shrink-0"
        style={{ borderTop: '1px solid var(--theme-surface-border)' }}
      >
        <p className="text-[9px] italic" style={{ color: 'var(--theme-muted-text)' }}>
          {tab === 'data' ? 'Arrow keys move, Enter inserts. Lists offer first item, find, count or loop.' : 'Click to copy, or drag into any input field.'}
        </p>
      </div>
    </div>
  )
}
