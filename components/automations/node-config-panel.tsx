"use client"

import { useState, useMemo, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { serverRead, type ReadArgs } from "@/lib/server-read"
import { cachedTableNameOf, dataTableIdOf, dataTableLabel, resolvePickerSelection, type TableNames } from "@/lib/workflow-table-refs"

/** id → name map of a loaded table list; undefined while loading. */
function tableNamesOf(tables: { id: string; name: string }[] | undefined): TableNames | undefined {
  if (!tables) return undefined
  const names: TableNames = {}
  for (const t of tables) names[t.id] = t.name
  return names
}
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import type { WorkflowEdge, WorkflowNode } from "@/lib/workflow-schema"
import { NODE_CATALOG } from "@/lib/workflow-schema"
import { Plus, X, ChevronDown, ChevronRight, Database } from "lucide-react"
import { useLinkedForms } from "./linked-forms"
import { VariableInput, TriggerTypeProvider } from "./variable-input"
import { FormSubmittedTriggerConfig } from "@/components/automations/form-submitted-trigger-config";
import { StartFormPageSection } from "@/components/forms/start-form-page";
import { NodeFormSection } from '@/components/forms/node-form-section'
import { normalizeTaskFields, valueFields } from '@/lib/task-field-schema'
import { CallReferenceConfig } from "./call-reference-config"
import { TriggerFilterConfig } from "./trigger-filter-config"
import { DocWordConfig, DocExcelConfig, DocPowerPointConfig } from "./doc-config-panels"
import { normalizeTableColumns } from '@/lib/data-table-columns'
import { getWorkflowActivityDisplayName, getWorkflowActivityInputDefinitions, getWorkflowActivityOutputDefinitions, getWorkflowActivitySetupNotes, getWorkflowActivitySummary, getWorkflowActivityPresentation } from '@/lib/extensibility'
import { PERMISSION_KEYS } from '@/lib/permissions'
import { agentOutputPrefix } from '@/lib/agent-knowledge'
import { normalizeScheduleConfig, describeSchedule, getNextOccurrence } from '@/lib/workflow-schedule'
import { buildDataTree } from '@/lib/workflow-data-picker'
import { DataPickerProvider, LoopItemsInput, type DataPickerContextValue } from './data-picker'
import { HttpResponseModelEditor } from './response-model-editor'

const SWITCH_COLORS = ["var(--theme-chart-1)", "var(--theme-chart-2)", "var(--theme-chart-3)", "var(--theme-chart-4)", "var(--theme-chart-5)", "var(--theme-chart-6)", "var(--theme-chart-7)", "var(--theme-chart-8)"]
const PANEL_QUERY_DEFAULTS = {
  refetchOnWindowFocus: false,
} as const

interface NodeConfigPanelProps {
  node: WorkflowNode | null
  onUpdateNode: (id: string, updates: Partial<WorkflowNode>) => void
  allNodes?: WorkflowNode[]
  workflowVariables?: { name: string; type: string; defaultValue: string; description: string }[]
  triggerType?: string
  customActivities?: any[]
  /** Edges, so the data picker shows only upstream steps (and the loop item inside a loop body). */
  allEdges?: WorkflowEdge[]
  /** "Loop through each item" from the data picker: wrap `nodeId` in a Loop over `itemsExpression`. */
  onInsertLoopBefore?: (nodeId: string, itemsExpression: string) => void
  /** The docked Data sidebar (toggle shown in the header when provided). */
  dataSidebarOpen?: boolean
  onToggleDataSidebar?: () => void
  /** The workflow (trigger settings: its start form's form page). */
  workflowId?: string
}

function getAgentOutputDefinitions(config: Record<string, any>) {
  return Array.isArray(config._agent_outputs) ? config._agent_outputs : []
}

function deriveOutputPrefix(node: WorkflowNode) {
  return node.config._output_prefix || node.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)
}

function useWorkflowOptions() {
  return useQuery({
    queryKey: ['all-workflows-picker'],
    queryFn: async () => (await serverRead('automations.workflowOptions')).data ?? [],
    staleTime: 30_000,
    ...PANEL_QUERY_DEFAULTS,
  })
}

function useDecisionTableOptions() {
  return useQuery({
    queryKey: ['decision-table-options'],
    queryFn: async () => (await serverRead('automations.decisionTableOptions')).data ?? [],
    staleTime: 60_000,
    ...PANEL_QUERY_DEFAULTS,
  })
}

function useUserOptions(queryKey: string) {
  return useQuery({
    queryKey: [queryKey],
    queryFn: async () => (await serverRead('automations.userOptions')).data ?? [],
    staleTime: 60_000,
    ...PANEL_QUERY_DEFAULTS,
  })
}

function useTeamOptions(queryKey: string) {
  return useQuery({
    queryKey: [queryKey],
    queryFn: async () => (await serverRead('automations.teamOptions')).data ?? [],
    staleTime: 60_000,
    ...PANEL_QUERY_DEFAULTS,
  })
}

function useRoleOptions(queryKey: string) {
  return useQuery({
    queryKey: [queryKey],
    queryFn: async () => (await serverRead('automations.roleOptions')).data ?? [],
    staleTime: 60_000,
    ...PANEL_QUERY_DEFAULTS,
  })
}

function useEmailTemplateOptions() {
  return useQuery({
    queryKey: ['workflow-email-template-options'],
    queryFn: async () => (await serverRead('automations.emailTemplateOptions')).data ?? [],
    staleTime: 60_000,
    ...PANEL_QUERY_DEFAULTS,
  })
}

/**
 * Field keys declared on user_task nodes in this workflow — surfaced as
 * {{task_data.<key>}} (returned to the workflow on completion) and
 * {{task.data.<key>}} (the task object's stored values).
 */
function taskFieldKeysFromNodes(allNodes: WorkflowNode[] | undefined): string[] {
  const keys = new Set<string>()
  for (const n of allNodes ?? []) {
    if (n.type !== 'user_task') continue
    for (const field of valueFields(normalizeTaskFields(n.config?.fields))) keys.add(field.key)
  }
  return [...keys]
}

function useCustomTableOptions(queryKey: string, select: 'id, name' | 'id, name, columns' = 'id, name') {
  return useQuery({
    queryKey: [queryKey, select],
    queryFn: async () => (await serverRead('automations.tableOptions', { columns: select === 'id, name, columns' })).data ?? [],
    staleTime: 5 * 60 * 1000,
    ...PANEL_QUERY_DEFAULTS,
  })
}

function useRetentionPolicyOptions(queryKey: string, select: ReadArgs<'automations.retentionPolicyOptions'>['select'] = 'id, name, description, applies_to') {
  return useQuery({
    queryKey: [queryKey, select],
    queryFn: async () => (await serverRead('automations.retentionPolicyOptions', { select })).data ?? [],
    staleTime: 60_000,
    ...PANEL_QUERY_DEFAULTS,
  })
}

function useAgentOptions() {
  return useQuery({
    queryKey: ['agents-for-config'],
    queryFn: async () => {
      const { data } = await serverRead('automations.agentOptions')
      return (data ?? []) as { id: string; name: string; is_active: boolean; integration_id?: string | null; model?: string | null; output_config?: { variables?: { name?: string; type?: string; description?: string }[] } | null }[]
    },
    staleTime: 60_000,
    ...PANEL_QUERY_DEFAULTS,
  })
}

export function NodeConfigPanel({ workflowId, node, onUpdateNode, allNodes, workflowVariables, triggerType, customActivities = [], allEdges, onInsertLoopBefore, dataSidebarOpen, onToggleDataSidebar }: NodeConfigPanelProps) {
  const linkedForms = useLinkedForms()
  // Hooks MUST run before the empty-state return — an early return above
  // them changes the hook count between renders (React "static flag" error).
  const catalog = useMemo(() => NODE_CATALOG.find((n) => n.type === node?.type), [node?.type])
  const dataTriggerNode = useMemo(() => allNodes?.find((n) => n.type === 'data_table_event'), [allNodes])
  const dataTriggerColumns = useMemo(
    () => (dataTriggerNode?.config?._table_columns ?? []) as { key: string; label?: string }[],
    [dataTriggerNode],
  )

  // Build extra variables from workflow variables + dynamic node outputs
  const taskFieldKeys = useMemo(() => taskFieldKeysFromNodes(allNodes), [allNodes])
  const { data: emailTemplates = [] } = useEmailTemplateOptions()

  const extraVariables = useMemo(() => {
    if (!node) return []
    const results: { name: string; group: string }[] = []
    const seen = new Set<string>()
    const pushVar = (name: string | null | undefined, group: string) => {
      const normalized = String(name ?? '').trim()
      if (!normalized) return
      const key = `${group}::${normalized}`
      if (seen.has(key)) return
      seen.add(key)
      results.push({ name: normalized, group })
    }

    if (workflowVariables?.length) {
      for (const wv of workflowVariables) pushVar(wv.name, 'Workflow Variables')
    }

    // Values collected by user_task fields in this workflow
    for (const key of taskFieldKeys) {
      pushVar(`task_data.${key}`, '📝 Task Fields')
      pushVar(`task.data.${key}`, '📝 Task Fields')
    }

    if (allNodes?.length) {
      for (const col of dataTriggerColumns) {
        pushVar(col.key, '🗃️ Trigger Row')
        pushVar(`row.${col.key}`, '🗃️ Trigger Row')
        pushVar(`data_row.${col.key}`, '🗃️ Trigger Row')
      }

      for (const n of allNodes) {
        if (n.id === node.id) continue
        const c = n.config
        if (n.type === 'call_reference' && c.output_mappings) {
          for (const [, mapping] of Object.entries(c.output_mappings as Record<string, any>)) {
            if (mapping?.enabled && mapping.variableName) pushVar(mapping.variableName, `📡 ${n.label}`)
          }
        }
        if (n.type === 'decision_table') {
          const group = `📘 ${n.label}`
          pushVar('matched', group)
          pushVar('rule_id', group)
          pushVar('outputs', group)
          for (const output of (c._decision_outputs ?? []) as { key: string }[]) pushVar(output.key, group)
        }
        if (n.type === 'custom_activity') {
          const group = `🧩 ${n.label}`
          const outputs = Array.isArray(n.config.manifest?.outputs) ? n.config.manifest.outputs : []
          for (const output of outputs) pushVar(String(output?.name ?? output?.key ?? '').trim(), group)
        }
        if (n.type === 'set_variable' && c.name) pushVar(c.name, `📌 ${n.label}`)
        if (['math', 'modify_string', 'text_template', 'format_date', 'date_math', 'regex', 'collection_count', 'collection_get', 'collection_filter', 'collection_sort', 'collection_unique', 'collection_join'].includes(n.type) && c.output_var) {
          pushVar(c.output_var, `🔧 ${n.label}`)
        }
        if (n.type === 'loop') {
          const itemVar = c.item_var || 'item'
          pushVar(itemVar, `🔁 ${n.label}`)
          pushVar(c.index_var || 'index', `🔁 ${n.label}`)
          pushVar(`${itemVar}_count`, `🔁 ${n.label}`)
        }
        if (n.type === 'loop_n_times') pushVar(c.index_var || 'i', `🔁 ${n.label}`)
        if (['file_to_base64', 'base64_to_file', 'download_file', 'read_file'].includes(n.type) && c.output_var) {
          pushVar(c.output_var, `📎 ${n.label}`)
        }
        if (n.type === 'run_agent') {
          const group = `🤖 ${n.label}`
          const outVar = c.output_variable || 'agent_response'
          pushVar(outVar, group)
          pushVar(`${outVar}_iterations`, group)
          pushVar(`${outVar}_tool_calls`, group)
          pushVar(`${outVar}_usage`, group)
          pushVar(`${outVar}_status`, group)
          pushVar(`${outVar}_duration_ms`, group)
          const prefix = deriveOutputPrefix(n)
          for (const output of getAgentOutputDefinitions(c)) {
            const key = String(output?.name ?? '').trim()
            pushVar(key, group)
            pushVar(`${prefix}_${key}`, group)
          }
        }
        if (n.type === 'server_event') {
          // Callback variables are merged into the run by name when the event
          // completes (resumeWorkflow spreads the payload). The declared list
          // here exists to make them discoverable downstream.
          const group = `📡 ${n.label}`
          for (const declared of (c.return_variables ?? []) as string[]) {
            const key = String(declared ?? '').trim()
            if (key) pushVar(key, group)
          }
        }
        if (n.type === 'decision_table') {
          // The engine sets matched/rule_id/rule_label/outputs plus every
          // output key — both bare and prefixed with the node's output prefix,
          // so several decision nodes in one workflow don't overwrite each
          // other. _decision_outputs is cached on the node when picked.
          const group = `⚖️ ${n.label}`
          const prefix = deriveOutputPrefix(n)
          for (const base of ['matched', 'rule_id', 'rule_label', 'outputs']) {
            pushVar(base, group)
            pushVar(`${prefix}_${base}`, group)
          }
          for (const output of (c._decision_outputs ?? []) as { key?: string }[]) {
            const key = String(output?.key ?? '').trim()
            if (!key) continue
            pushVar(key, group)
            pushVar(`${prefix}_${key}`, group)
          }
        }
        if (n.type === 'retention_policies') {
          const group = `🗄️ ${n.label}`
          const prefix = deriveOutputPrefix(n)
          ;['operation', 'retention_policy_id', 'retention_policy_name', 'policy_count', 'asset_count', 'target_type', 'target_id', 'assigned'].forEach((key) => {
            pushVar(`${prefix}_${key}`, group)
          })
          ;['policy', 'policies', 'assets', 'data_tables', 'data_rows'].forEach((key) => {
            pushVar(`${prefix}_${key}`, group)
          })
        }
        if (n.type === 'update_data_table') {
          const op = c.operation ?? 'insert'
          const group = `🗃️ ${n.label}`
          if (op === 'list') {
            const rowsVar = c.output_rows_var || 'rows'
            pushVar(rowsVar, group)
            pushVar(c.output_count_var || 'row_count', group)
            if (c.live_reference) {
              pushVar(`live.${rowsVar}`, `⚡ ${n.label} (Live)`)
              pushVar(`live_${rowsVar}`, `⚡ ${n.label} (Live)`)
            }
          } else if (op === 'get') {
            const rowVar = c.output_row_var || 'row'
            pushVar(rowVar, group)
            pushVar(c.output_row_id_var || 'row_id', group)
            for (const col of (c._table_columns ?? []) as { key: string }[]) pushVar(`${rowVar}.${col.key}`, group)
            if (c.live_reference) {
              const liveGroup = `⚡ ${n.label} (Live)`
              pushVar(`live.${rowVar}`, liveGroup)
              pushVar(`live_${rowVar}`, liveGroup)
              for (const col of (c._table_columns ?? []) as { key: string }[]) pushVar(`live.${rowVar}.${col.key}`, liveGroup)
            }
          } else {
            pushVar(c.output_row_id_var || 'row_id', group)
          }
        }
      }
    }

    return results
  }, [allNodes, dataTriggerColumns, node?.id, workflowVariables, taskFieldKeys])

  // Tree data picker: upstream steps' outputs (response models), loop item scope.
  const dataPicker = useMemo<DataPickerContextValue | null>(() => {
    if (!node) return null
    const groups = buildDataTree({ nodes: allNodes ?? [], edges: allEdges ?? [], currentNodeId: node.id, workflowVariables, linkedForms })
    const nodeId = node.id
    return { groups, onInsertLoop: onInsertLoopBefore && node.type !== 'loop' ? (items: string) => onInsertLoopBefore(nodeId, items) : undefined }
  }, [allNodes, allEdges, node, workflowVariables, onInsertLoopBefore, linkedForms])

  if (!node) {
    return (
      <div className="text-center py-8">
        <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>
          Select a node to configure it
        </p>
      </div>
    )
  }

  function updateConfig(key: string, value: any) {
    onUpdateNode(node!.id, { config: { ...node!.config, [key]: value } })
  }

  function batchUpdateConfig(updates: Record<string, any>) {
    onUpdateNode(node!.id, { config: { ...node!.config, ...updates } })
  }

  return (
    <TriggerTypeProvider value={triggerType}>
    <DataPickerProvider value={dataPicker}>
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-3 h-3 rounded-full" style={{ backgroundColor: catalog?.color }} />
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-muted-text)" }}>
          {catalog?.label ?? node.type}
        </h3>
        {onToggleDataSidebar && (
          <button
            type="button"
            onClick={onToggleDataSidebar}
            aria-pressed={!!dataSidebarOpen}
            title={dataSidebarOpen ? 'Hide the Data sidebar (⌥D)' : 'Show the Data sidebar: form fields and step outputs to drag into inputs (⌥D)'}
            className="ml-auto flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium hover:opacity-90"
            style={{
              backgroundColor: dataSidebarOpen ? 'var(--theme-primary-light)' : 'var(--theme-card-bg)',
              borderColor: dataSidebarOpen ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
              color: 'var(--theme-primary-text)',
            }}
          >
            <Database size={11} aria-hidden /> Data
          </button>
        )}
      </div>

      {/* Label */}
      <div onPointerDown={(e) => e.stopPropagation()}>
        <label className="block text-xs font-medium mb-1">Label</label>
        <Input value={node.label} onChange={(e) => onUpdateNode(node.id, { label: e.target.value })} />
      </div>

      {/* Appearance — custom color + custom SVG icon (stored in config, so
          it exports/imports and syncs like any other node setting) */}
      <div onPointerDown={(e) => e.stopPropagation()}>
        <label className="block text-[10px] font-medium mb-1" style={{ color: "var(--theme-muted-text)" }}>Appearance</label>
        <div className="flex flex-wrap items-center gap-1.5">
          {['#22C55E', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#EF4444', '#64748B'].map((swatch) => (
            <button
              key={swatch}
              type="button"
              title={swatch}
              onClick={() => updateConfig('node_color', node.config.node_color === swatch ? undefined : swatch)}
              className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                backgroundColor: swatch,
                borderColor: node.config.node_color === swatch ? 'var(--theme-card-text)' : 'transparent',
              }}
            />
          ))}
          <input
            type="color"
            value={node.config.node_color ?? catalog?.color ?? '#6B7280'}
            onChange={(e) => updateConfig('node_color', e.target.value)}
            title="Custom color"
            className="h-5 w-7 cursor-pointer rounded border bg-transparent p-0"
            style={{ borderColor: 'var(--theme-surface-border)' }}
          />
          {node.config.node_color && (
            <button
              type="button"
              onClick={() => updateConfig('node_color', undefined)}
              className="text-[9px] underline"
              style={{ color: 'var(--theme-muted-text)' }}
            >
              Reset color
            </button>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <label
            className="cursor-pointer rounded border border-dashed px-2 py-1 text-[9px] font-medium hover:opacity-80"
            style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}
          >
            {node.config.node_icon_svg ? 'Replace custom icon (SVG)' : 'Upload custom icon (SVG)'}
            <input
              type="file"
              accept=".svg,image/svg+xml"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                const text = await file.text()
                const { sanitizeSvg } = await import('@/lib/sanitize-svg')
                const clean = sanitizeSvg(text)
                if (clean) updateConfig('node_icon_svg', clean)
              }}
            />
          </label>
          {node.config.node_icon_svg && (
            <>
              <span
                className="inline-flex h-5 w-5 items-center justify-center overflow-hidden [&_svg]:h-4 [&_svg]:w-4"
                dangerouslySetInnerHTML={{ __html: node.config.node_icon_svg }}
              />
              <button
                type="button"
                onClick={() => updateConfig('node_icon_svg', undefined)}
                className="text-[9px] underline"
                style={{ color: 'var(--theme-muted-text)' }}
              >
                Remove icon
              </button>
            </>
          )}
        </div>
      </div>

      {/* Output prefix — for nodes that produce auto-named variables */}
      {['call_reference', 'live_reference', 'http_request', 'call_sub_workflow', 'decision_table', 'user_task', 'server_event', 'run_agent', 'retention_policies'].includes(node.type) && (
        <div onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-[10px] font-medium mb-1" style={{ color: "var(--theme-muted-text)" }}>Output Prefix</label>
          <Input
            value={node.config._output_prefix ?? ""}
            onChange={(e) => updateConfig("_output_prefix", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            placeholder={deriveOutputPrefix(node)}
            className="!text-xs font-mono"
          />
          <p className="text-[9px] mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
            Variables: {'{{'}{deriveOutputPrefix(node)}_{node.type === 'retention_policies' ? 'retention_policy_id' : 'response'}{'}}'}
          </p>
        </div>
      )}

      {/* Error handling — show on all non-trigger nodes */}
      {!['task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected', 'workflow_error', 'workflow_sla', 'retention_policy_review', 'retention_policy_executed', 'data_table_event', 'form_submitted', 'middleware_received', 'schedule', 'webhook_received'].includes(node.type) && (
        <div onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-[10px] font-medium mb-1" style={{ color: "var(--theme-muted-text)" }}>On Error</label>
          <div className="flex gap-0.5">
            {[
              { val: 'stop', label: 'Stop workflow' },
              { val: 'continue', label: 'Continue' },
            ].map(o => (
              <button key={o.val} type="button"
                onClick={() => onUpdateNode(node.id, { onError: o.val as any })}
                className="flex-1 text-[9px] font-medium py-1 rounded transition-colors"
                style={{
                  backgroundColor: (node.onError ?? 'stop') === o.val ? (o.val === 'stop' ? 'var(--theme-danger)' : 'var(--theme-warning)') : 'var(--theme-surface)',
                  color: (node.onError ?? 'stop') === o.val ? 'var(--theme-card-bg)' : 'var(--theme-muted-text)',
                }}>
                {o.label}
              </button>
            ))}
          </div>
          {node.onError === 'continue' && (
            <p className="text-[9px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
              On error: sets {'{{has_error}}'}, {'{{last_error}}'}, {'{{last_error_node}}'} and continues to next nodes
            </p>
          )}
        </div>
      )}

      {/* Execution mode — show on action/operation nodes */}
      {!['task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected', 'workflow_error', 'workflow_sla', 'retention_policy_review', 'retention_policy_executed', 'data_table_event', 'form_submitted', 'middleware_received', 'schedule', 'webhook_received', 'condition', 'switch_case', 'end_workflow', 'placeholder'].includes(node.type) && (
        <div onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-[10px] font-medium mb-1" style={{ color: "var(--theme-muted-text)" }}>Execution</label>
          <div className="flex gap-0.5">
            {[
              { val: 'sync', label: 'Wait for result', desc: 'Next step runs after this completes' },
              { val: 'async', label: 'Fire & forget', desc: 'Next step runs immediately' },
            ].map(o => (
              <button key={o.val} type="button"
                onClick={() => onUpdateNode(node.id, { executionMode: o.val as any })}
                className="flex-1 text-[9px] font-medium py-1 rounded transition-colors"
                style={{
                  backgroundColor: (node.executionMode ?? 'sync') === o.val ? 'var(--theme-primary)' : 'var(--theme-surface)',
                  color: (node.executionMode ?? 'sync') === o.val ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
                }}>
                {o.label}
              </button>
            ))}
          </div>
          {node.executionMode === 'async' && (
            <p className="text-[9px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
              Async: output variables won't be available to subsequent nodes
            </p>
          )}
        </div>
      )}

      {/* ─── Webhook trigger info ─── */}
      {(node.type === "webhook_received" || node.type === "middleware_received") && (
        <div className="rounded-lg p-3" style={{ backgroundColor: "var(--theme-surface)" }}>
          <p className="text-xs font-medium mb-1" style={{ color: "var(--theme-primary-text)" }}>
            {node.type === "middleware_received" ? "Middleware Trigger" : "Webhook Trigger"}
          </p>
          <p className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
            Configure the endpoint, API key, and payload mappings in the Webhook Configuration section above.
          </p>
          <p className="text-[10px] mt-2" style={{ color: "var(--theme-muted-text)" }}>
            Mapped variables from the incoming payload are available in all downstream nodes using {"{{variable_name}}"} syntax.
          </p>
          {node.type === "middleware_received" && (
            <p className="text-[10px] mt-2" style={{ color: "var(--theme-muted-text)" }}>
              Middleware runs synchronously and returns the response configured on the <code style={{ color: 'var(--theme-primary-text)' }}>End Workflow</code> node.
            </p>
          )}
        </div>
      )}

      {/* ─── Task trigger nodes ─── */}
      {["task_created", "task_received", "task_submitted", "task_updated", "task_completed", "task_rejected"].includes(node.type) && (
        <>
          <TriggerFilterConfig config={node.config} onUpdate={updateConfig} />
          <div className="mt-3">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>Task form (optional)</label>
            <NodeFormSection variant="task_trigger" node={node} allNodes={allNodes ?? []} onPatch={batchUpdateConfig} onUpdateOtherNode={(id, config) => onUpdateNode(id, { config })} />
          </div>
        </>
      )}

      {node.type === "workflow_error" && (
        <WorkflowErrorTriggerConfig config={node.config} onUpdate={updateConfig} />
      )}

      {node.type === "workflow_sla" && (
        <WorkflowSlaTriggerConfig config={node.config} onUpdate={updateConfig} />
      )}

      {node.type === "retention_policy_review" && (
        <RetentionPolicyReviewTriggerConfig config={node.config} onUpdate={updateConfig} />
      )}

      {node.type === "retention_policy_executed" && (
        <RetentionPolicyExecutedTriggerConfig config={node.config} onUpdate={updateConfig} />
      )}


      {/* ─── A trigger that starts from the start form: its form page ("Publish as form page") ─── */}
      {workflowId && node.type !== "form_submitted" && NODE_CATALOG.some((c) => c.type === node.type && c.category === "trigger") && (
        <StartFormPageSection workflowId={workflowId} />
      )}

      {/* ─── Form submitted trigger ─── */}
      {node.type === "form_submitted" && (
        <FormSubmittedTriggerConfig config={node.config} onBatchUpdate={batchUpdateConfig} />
      )}

      {/* ─── Data Table trigger ─── */}
      {node.type === "data_table_event" && (
        <DataTableTriggerConfig config={node.config} onUpdate={updateConfig} />
      )}

      {/* ─── Schedule trigger ─── */}
      {node.type === "schedule" && (
        <ScheduleTriggerConfig config={node.config} onUpdate={updateConfig} onBatchUpdate={batchUpdateConfig} />
      )}

      {/* ─── Condition (multi-branch) ─── */}
      {node.type === "condition" && (
        <MultiBranchConditionBuilder config={node.config} onUpdate={updateConfig} onBatchUpdate={batchUpdateConfig} extraVariables={extraVariables} />
      )}

      {/* ─── Update Task ─── */}
      {node.type === "update_task" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Field to Update</label>
          <AutocompleteSelect
            value={node.config.field ?? ""}
            onChange={(value) => updateConfig("field", value)}
            placeholder="Select field..."
            clearable
            options={[
              { value: "status", label: "Status" },
              { value: "priority", label: "Priority" },
              { value: "assignee_id", label: "Assignee" },
              { value: "due_date", label: "Due Date" },
              { value: "title", label: "Title" },
              { value: "description", label: "Description" },
              { value: "progress_pct", label: "Progress %" },
              { value: "tags", label: "Tags" },
              { value: "outcome", label: "Outcome" },
              { value: "outcome_notes", label: "Outcome Notes" },
            ]}
          />
          <label className="block text-xs font-medium">New Value</label>
          {(node.config.field === 'priority' || node.config.field === 'status') && !(node.config.value ?? '').includes('{{') ? (
            <div className="space-y-1">
              <select value={node.config.value ?? ""} onChange={(e) => updateConfig("value", e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-xs" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
                {node.config.field === 'priority' ? (
                  <>
                    <option value="">Select priority...</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="none">None</option>
                  </>
                ) : (
                  <>
                    <option value="">Select status...</option>
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </>
                )}
              </select>
              <button onClick={() => updateConfig("value", "{" + "{")}
                className="text-[9px] hover:opacity-70" style={{ color: 'var(--theme-primary-text)' }}>
                Use variable instead
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              <VariableInput value={node.config.value ?? ""} onChange={(value) => updateConfig("value", value)}
                placeholder="Value or {{variable}}" extraVariables={extraVariables} />
              {(node.config.field === 'priority' || node.config.field === 'status') && (
                <button onClick={() => updateConfig("value", "")}
                  className="text-[9px] hover:opacity-70" style={{ color: 'var(--theme-primary-text)' }}>
                  Use dropdown instead
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── Set Title ─── */}
      {node.type === "set_title" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Instance Title</label>
          <VariableInput value={node.config.title ?? ""} onChange={(value) => updateConfig("title", value)}
            placeholder="{{task.title}} — {{task.priority}}" extraVariables={extraVariables} />
          <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
            Sets a descriptive title for this workflow run. Supports expressions. Visible in the queue.
          </p>
        </div>
      )}

      {node.type === "set_sla" && (
        <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
          <div className="rounded-lg p-3" style={{ backgroundColor: "var(--theme-surface)" }}>
            <p className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
              Sets an SLA on the current workflow run so queues, reports, and SLA-triggered workflows can detect warning and breach states.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">SLA Label</label>
            <VariableInput
              value={node.config.sla_label ?? ""}
              onChange={(value) => updateConfig("sla_label", value)}
              placeholder="e.g. First response SLA" extraVariables={extraVariables} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Due Mode</label>
            <select
              value={node.config.mode ?? 'relative'}
              onChange={(e) => updateConfig("mode", e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-xs"
              style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
            >
              <option value="relative">Relative from now</option>
              <option value="exact">Exact date/time</option>
            </select>
          </div>

          {(node.config.mode ?? 'relative') === 'exact' ? (
            <div>
              <label className="block text-xs font-medium mb-1">Due At</label>
              <VariableInput
                value={node.config.due_at ?? ''}
                onChange={(value) => updateConfig('due_at', value)}
                placeholder="{{workflow_started_at}} or 2026-04-20T17:00:00Z"
                extraVariables={extraVariables}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Amount</label>
                <VariableInput
                  value={String(node.config.amount ?? 4)}
                  onChange={(value) => updateConfig("amount", value)}
                  placeholder="4 or {{sla_days}}"
                  extraVariables={extraVariables}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Unit</label>
                <select
                  value={node.config.unit ?? 'hours'}
                  onChange={(e) => updateConfig("unit", e.target.value)}
                  className="w-full rounded border px-2 py-1.5 text-xs"
                  style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                  <option value="weeks">Weeks</option>
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1">Warning Mode</label>
            <select
              value={node.config.warning_mode ?? 'relative'}
              onChange={(e) => updateConfig("warning_mode", e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-xs"
              style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
            >
              <option value="relative">Before due time</option>
              <option value="exact">Exact warning date/time</option>
            </select>
          </div>

          {(node.config.warning_mode ?? 'relative') === 'exact' ? (
            <div>
              <label className="block text-xs font-medium mb-1">Warning At</label>
              <VariableInput
                value={node.config.warning_at ?? ''}
                onChange={(value) => updateConfig('warning_at', value)}
                placeholder="2026-04-20T16:00:00Z"
                extraVariables={extraVariables}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Warn Before</label>
                <VariableInput
                  value={String(node.config.warning_amount ?? 1)}
                  onChange={(value) => updateConfig("warning_amount", value)}
                  placeholder="1 or {{warn_days}}"
                  extraVariables={extraVariables}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Warning Unit</label>
                <select
                  value={node.config.warning_unit ?? node.config.unit ?? 'hours'}
                  onChange={(e) => updateConfig("warning_unit", e.target.value)}
                  className="w-full rounded border px-2 py-1.5 text-xs"
                  style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                  <option value="weeks">Weeks</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── JSON Build Object ─── */}
      {node.type === "json_build_object" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Source Variable (optional — merge into existing)</label>
          <Input value={node.config.source_var ?? ""} onChange={(e) => updateConfig("source_var", e.target.value)}
            placeholder="e.g. existing_object" className="!text-xs font-mono" />
          <label className="block text-xs font-medium">Fields</label>
          {((node.config.fields ?? [{ key: '', value: '' }]) as { key: string; value: string }[]).map((field, i) => (
            <div key={i} className="flex gap-1.5 items-start">
              <Input value={field.key} onChange={(e) => {
                const updated = [...(node.config.fields ?? [{ key: '', value: '' }])]; updated[i] = { ...updated[i], key: e.target.value }
                updateConfig("fields", updated)
              }} placeholder="key" className="!text-xs font-mono flex-1" />
              <VariableInput value={field.value} onChange={(value) => {
                const updated = [...(node.config.fields ?? [{ key: '', value: '' }])]; updated[i] = { ...updated[i], value: value }
                updateConfig("fields", updated)
              }} placeholder="{{variable}} or value" extraVariables={extraVariables} wrapperClassName="flex-1 min-w-0" />
              <button onClick={() => {
                const updated = (node.config.fields ?? []).filter((_: any, j: number) => j !== i)
                updateConfig("fields", updated.length > 0 ? updated : [{ key: '', value: '' }])
              }} className="text-xs px-1 mt-1 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>×</button>
            </div>
          ))}
          <button onClick={() => updateConfig("fields", [...(node.config.fields ?? []), { key: '', value: '' }])}
            className="text-[10px] hover:opacity-70" style={{ color: 'var(--theme-primary-text)' }}>+ Add field</button>
          <label className="block text-xs font-medium">Output Variable</label>
          <Input value={node.config.output_var ?? "json_object"} onChange={(e) => updateConfig("output_var", e.target.value)}
            placeholder="json_object" className="!text-xs font-mono" />
        </div>
      )}

      {/* ─── JSON Build Array ─── */}
      {node.type === "json_build_array" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Source Variable (optional — append to existing)</label>
          <Input value={node.config.source_var ?? ""} onChange={(e) => updateConfig("source_var", e.target.value)}
            placeholder="e.g. existing_array" className="!text-xs font-mono" />
          <label className="block text-xs font-medium">Items to Add</label>
          {((node.config.items ?? [{ value: '' }]) as { value: string }[]).map((item, i) => (
            <div key={i} className="flex gap-1.5 items-start">
              <VariableInput value={item.value} onChange={(value) => {
                const updated = [...(node.config.items ?? [{ value: '' }])]; updated[i] = { value: value }
                updateConfig("items", updated)
              }} placeholder='{{variable}} or "static"' extraVariables={extraVariables} wrapperClassName="flex-1 min-w-0" />
              <button onClick={() => {
                const updated = (node.config.items ?? []).filter((_: any, j: number) => j !== i)
                updateConfig("items", updated.length > 0 ? updated : [{ value: '' }])
              }} className="text-xs px-1 mt-1 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>×</button>
            </div>
          ))}
          <button onClick={() => updateConfig("items", [...(node.config.items ?? []), { value: '' }])}
            className="text-[10px] hover:opacity-70" style={{ color: 'var(--theme-primary-text)' }}>+ Add item</button>
          <label className="block text-xs font-medium">Output Variable</label>
          <Input value={node.config.output_var ?? "json_array"} onChange={(e) => updateConfig("output_var", e.target.value)}
            placeholder="json_array" className="!text-xs font-mono" />
        </div>
      )}

      {/* ─── JSON Add to Array ─── */}
      {node.type === "json_add_to_array" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Array Variable</label>
          <Input value={node.config.array_var ?? ""} onChange={(e) => updateConfig("array_var", e.target.value)}
            placeholder="json_array" className="!text-xs font-mono" />
          <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
            The variable holding the array to add to. Use inside a loop to build up an array of objects.
          </p>
          <label className="block text-xs font-medium">Object Fields</label>
          {((node.config.fields ?? [{ key: '', value: '' }]) as { key: string; value: string }[]).map((field, i) => (
            <div key={i} className="flex gap-1.5 items-start">
              <Input value={field.key} onChange={(e) => {
                const updated = [...(node.config.fields ?? [{ key: '', value: '' }])]; updated[i] = { ...updated[i], key: e.target.value }
                updateConfig("fields", updated)
              }} placeholder="key" className="!text-xs font-mono flex-1" />
              <VariableInput value={field.value} onChange={(value) => {
                const updated = [...(node.config.fields ?? [{ key: '', value: '' }])]; updated[i] = { ...updated[i], value: value }
                updateConfig("fields", updated)
              }} placeholder="{{item.field}} or value" extraVariables={extraVariables} wrapperClassName="flex-1 min-w-0" />
              <button onClick={() => {
                const updated = (node.config.fields ?? []).filter((_: any, j: number) => j !== i)
                updateConfig("fields", updated.length > 0 ? updated : [{ key: '', value: '' }])
              }} className="text-xs px-1 mt-1 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>×</button>
            </div>
          ))}
          <button onClick={() => updateConfig("fields", [...(node.config.fields ?? []), { key: '', value: '' }])}
            className="text-[10px] hover:opacity-70" style={{ color: 'var(--theme-primary-text)' }}>+ Add field</button>
        </div>
      )}

      {/* ─── JSON Get Value ─── */}
      {node.type === "json_get_value" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Source</label>
          <VariableInput value={node.config.source ?? ""} onChange={(value) => updateConfig("source", value)}
            placeholder="{{api_response}} or {{json_object}}" extraVariables={extraVariables} />
          <label className="block text-xs font-medium">Path</label>
          <Input value={node.config.path ?? ""} onChange={(e) => updateConfig("path", e.target.value)}
            placeholder="data.items.0.name" className="!text-xs font-mono" />
          <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
            Dot notation. Use numbers for array indices: data.items.0.name
          </p>
          <label className="block text-xs font-medium">Output Variable</label>
          <Input value={node.config.output_var ?? "json_value"} onChange={(e) => updateConfig("output_var", e.target.value)}
            placeholder="json_value" className="!text-xs font-mono" />
        </div>
      )}

      {/* ─── CSV (Read / Write) ─── */}
      {node.type === "read_csv" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Mode</label>
          <div className="flex gap-0.5">
            {[{ val: 'read', label: 'Read CSV' }, { val: 'write', label: 'Write CSV' }].map(o => (
              <button key={o.val} type="button" onClick={() => updateConfig("mode", o.val)}
                className="flex-1 text-[10px] font-medium py-1.5 rounded transition-colors"
                style={{ backgroundColor: (node.config.mode ?? 'read') === o.val ? 'var(--theme-primary)' : 'var(--theme-surface)', color: (node.config.mode ?? 'read') === o.val ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}>
                {o.label}
              </button>
            ))}
          </div>

          {(node.config.mode ?? 'read') === 'read' ? (
            <>
              <label className="block text-xs font-medium">Source</label>
              <select value={node.config.source_mode ?? "url"} onChange={(e) => updateConfig("source_mode", e.target.value)}
                className="w-full rounded-lg border px-2 py-1.5 text-xs"
                style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
                <option value="url">File URL</option>
                <option value="ref">File Reference (from API / workflow)</option>
                <option value="table">Data Table File Column</option>
              </select>
              <label className="block text-xs font-medium">{node.config.source_mode === 'ref' ? 'File Variable' : node.config.source_mode === 'table' ? 'Table Row File Variable' : 'File URL'}</label>
              <VariableInput value={node.config.file_url ?? ""} onChange={(value) => updateConfig("file_url", value)}
                placeholder={node.config.source_mode === 'ref' ? '{{api_file}}' : node.config.source_mode === 'table' ? '{{item.file_column}}' : 'https://example.com/data.csv'} extraVariables={extraVariables} />
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium">Delimiter</label>
                  <select value={node.config.delimiter ?? ","} onChange={(e) => updateConfig("delimiter", e.target.value)}
                    className="w-full rounded-lg border px-2 py-1.5 text-xs"
                    style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
                    <option value=",">Comma (,)</option>
                    <option value=";">Semicolon (;)</option>
                    <option value="\t">Tab</option>
                    <option value="|">Pipe (|)</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium">First Row</label>
                  <select value={node.config.has_headers === false ? "no" : "yes"} onChange={(e) => updateConfig("has_headers", e.target.value === "yes")}
                    className="w-full rounded-lg border px-2 py-1.5 text-xs"
                    style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
                    <option value="yes">Headers</option>
                    <option value="no">Data (no headers)</option>
                  </select>
                </div>
              </div>
              <label className="block text-xs font-medium">Output Variable</label>
              <Input value={node.config.output_var ?? "csv_data"} onChange={(e) => updateConfig("output_var", e.target.value)}
                placeholder="csv_data" className="!text-xs font-mono" />
            </>
          ) : (
            <>
              <label className="block text-xs font-medium">Data Variable (JSON array)</label>
              <VariableInput value={node.config.data_var ?? ""} onChange={(value) => updateConfig("data_var", value)}
                placeholder="{{csv_data}} or {{json_array}}" extraVariables={extraVariables} />
              <label className="block text-xs font-medium">Delimiter</label>
              <select value={node.config.delimiter ?? ","} onChange={(e) => updateConfig("delimiter", e.target.value)}
                className="w-full rounded-lg border px-2 py-1.5 text-xs"
                style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
                <option value=",">Comma (,)</option>
                <option value=";">Semicolon (;)</option>
                <option value="\t">Tab</option>
                <option value="|">Pipe (|)</option>
              </select>
              <label className="block text-xs font-medium">File Name</label>
              <VariableInput value={node.config.file_name ?? ""} onChange={(value) => updateConfig("file_name", value)}
                placeholder="export.csv" extraVariables={extraVariables} />
              <label className="block text-xs font-medium">Output Variable</label>
              <Input value={node.config.output_var ?? "csv_file"} onChange={(e) => updateConfig("output_var", e.target.value)}
                placeholder="csv_file" className="!text-xs font-mono" />
              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                Creates a CSV file in storage. Output is a file reference {'{{csv_file}}'} with .url, .name, .size.
              </p>
            </>
          )}
        </div>
      )}

      {/* ─── Excel (Read / Write) ─── */}
      {node.type === "read_excel" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Mode</label>
          <div className="flex gap-0.5">
            {[{ val: 'read', label: 'Read Excel' }, { val: 'write', label: 'Write Excel' }].map(o => (
              <button key={o.val} type="button" onClick={() => updateConfig("mode", o.val)}
                className="flex-1 text-[10px] font-medium py-1.5 rounded transition-colors"
                style={{ backgroundColor: (node.config.mode ?? 'read') === o.val ? 'var(--theme-primary)' : 'var(--theme-surface)', color: (node.config.mode ?? 'read') === o.val ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}>
                {o.label}
              </button>
            ))}
          </div>

          {(node.config.mode ?? 'read') === 'read' ? (
            <>
              <label className="block text-xs font-medium">Source</label>
              <select value={node.config.source_mode ?? "url"} onChange={(e) => updateConfig("source_mode", e.target.value)}
                className="w-full rounded-lg border px-2 py-1.5 text-xs"
                style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
                <option value="url">File URL</option>
                <option value="ref">File Reference (from API / workflow)</option>
                <option value="table">Data Table File Column</option>
              </select>
              <label className="block text-xs font-medium">{node.config.source_mode === 'ref' ? 'File Variable' : node.config.source_mode === 'table' ? 'Table Row File Variable' : 'File URL'}</label>
              <VariableInput value={node.config.file_url ?? ""} onChange={(value) => updateConfig("file_url", value)}
                placeholder={node.config.source_mode === 'ref' ? '{{api_file}}' : node.config.source_mode === 'table' ? '{{item.file_column}}' : 'https://example.com/data.xlsx'} extraVariables={extraVariables} />
              <label className="block text-xs font-medium">Sheet Name (optional)</label>
              <VariableInput value={node.config.sheet_name ?? ""} onChange={(value) => updateConfig("sheet_name", value)}
                placeholder="Leave empty for first sheet" extraVariables={extraVariables} />
              <div>
                <label className="block text-xs font-medium">First Row</label>
                <select value={node.config.has_headers === false ? "no" : "yes"} onChange={(e) => updateConfig("has_headers", e.target.value === "yes")}
                  className="w-full rounded-lg border px-2 py-1.5 text-xs"
                  style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
                  <option value="yes">Headers</option>
                  <option value="no">Data (no headers)</option>
                </select>
              </div>
              <label className="block text-xs font-medium">Output Variable</label>
              <Input value={node.config.output_var ?? "excel_data"} onChange={(e) => updateConfig("output_var", e.target.value)}
                placeholder="excel_data" className="!text-xs font-mono" />
            </>
          ) : (
            <>
              <label className="block text-xs font-medium">Data Variable (JSON array)</label>
              <VariableInput value={node.config.data_var ?? ""} onChange={(value) => updateConfig("data_var", value)}
                placeholder="{{excel_data}} or {{json_array}}" extraVariables={extraVariables} />
              <label className="block text-xs font-medium">Sheet Name</label>
              <VariableInput value={node.config.sheet_name ?? ""} onChange={(value) => updateConfig("sheet_name", value)}
                placeholder="Sheet1" extraVariables={extraVariables} />
              <label className="block text-xs font-medium">File Name</label>
              <VariableInput value={node.config.file_name ?? ""} onChange={(value) => updateConfig("file_name", value)}
                placeholder="export.xlsx" extraVariables={extraVariables} />
              <label className="block text-xs font-medium">Output Variable</label>
              <Input value={node.config.output_var ?? "excel_file"} onChange={(e) => updateConfig("output_var", e.target.value)}
                placeholder="excel_file" className="!text-xs font-mono" />
              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                Creates an Excel file in storage. Output is a file reference {'{{excel_file}}'} with .url, .name, .size.
              </p>
            </>
          )}
        </div>
      )}

      {/* ─── Set Variable ─── */}
      {node.type === "set_variable" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Variable Name</label>
          <Input value={node.config.name ?? ""} onChange={(e) => updateConfig("name", e.target.value)}
            placeholder="my_variable" className="!text-xs font-mono" />
          <label className="block text-xs font-medium">Value / Expression</label>
          <VariableInput value={node.config.expression ?? ""} onChange={(value) => updateConfig("expression", value)}
            placeholder="{{task.priority}} or static value" extraVariables={extraVariables} />
        </div>
      )}

      {/* ─── Delay ─── */}
      {node.type === "delay" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Duration</label>
          <div className="flex gap-2">
            <Input type="number" value={node.config.duration ?? ""} onChange={(e) => updateConfig("duration", Number(e.target.value))}
              placeholder="5" className="!text-xs w-20" />
            <select value={node.config.unit ?? "minutes"} onChange={(e) => updateConfig("unit", e.target.value)}
              className="rounded border px-2 py-1.5 text-xs flex-1" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
              <option value="seconds">Seconds</option>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </div>
        </div>
      )}

      {/* ─── HTTP Request ─── */}
      {node.type === "http_request" && (
        <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
          {/* Method + URL */}
          <div className="flex gap-2">
            <select value={node.config.method ?? "GET"} onChange={(e) => updateConfig("method", e.target.value)}
              className="rounded border px-2 py-1.5 text-xs font-bold w-24 shrink-0" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
              <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
            </select>
            <VariableInput value={node.config.url ?? ""} onChange={(value) => updateConfig("url", value)}
              placeholder="https://api.example.com/{{path}}" extraVariables={extraVariables} wrapperClassName="flex-1 min-w-0" />
          </div>

          {/* Auth */}
          <div>
            <label className="block text-[10px] font-medium mb-1" style={{ color: "var(--theme-muted-text)" }}>Authentication</label>
            <select value={node.config.auth_type ?? "none"} onChange={(e) => updateConfig("auth_type", e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-xs" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
              <option value="none">None</option>
              <option value="bearer">Bearer Token</option>
              <option value="api_key">API Key</option>
              <option value="basic">Basic Auth</option>
            </select>
            {node.config.auth_type === "bearer" && (
              <VariableInput value={node.config.auth_token ?? ""} onChange={(value) => updateConfig("auth_token", value)}
                placeholder="{{api_key}} or token" extraVariables={extraVariables} wrapperClassName="mt-1" />
            )}
            {node.config.auth_type === "api_key" && (
              <div className="flex gap-1 mt-1">
                <Input value={node.config.auth_key_name ?? "X-API-Key"} onChange={(e) => updateConfig("auth_key_name", e.target.value)}
                  placeholder="Header name" className="!text-xs font-mono w-28" />
                <VariableInput value={node.config.auth_key_value ?? ""} onChange={(value) => updateConfig("auth_key_value", value)}
                  placeholder="{{api_key}}" extraVariables={extraVariables} wrapperClassName="flex-1 min-w-0" />
              </div>
            )}
            {node.config.auth_type === "basic" && (
              <div className="flex gap-1 mt-1">
                <VariableInput value={node.config.auth_username ?? ""} onChange={(value) => updateConfig("auth_username", value)}
                  placeholder="Username" extraVariables={extraVariables} wrapperClassName="flex-1 min-w-0" />
                <Input value={node.config.auth_password ?? ""} onChange={(e) => updateConfig("auth_password", e.target.value)}
                  placeholder="Password" className="!text-xs font-mono flex-1" type="password" />
              </div>
            )}
          </div>

          {/* Headers */}
          <div>
            <label className="block text-[10px] font-medium mb-1" style={{ color: "var(--theme-muted-text)" }}>Headers</label>
            {((node.config.headers ?? []) as { key: string; value: string }[]).map((h, i) => (
              <div key={i} className="flex gap-1 mb-1">
                <Input value={h.key} onChange={(e) => {
                  const updated = [...(node.config.headers ?? [])]; updated[i] = { ...updated[i], key: e.target.value }
                  updateConfig("headers", updated)
                }} placeholder="Header name" className="!text-xs font-mono flex-1" />
                <VariableInput value={h.value} onChange={(value) => {
                  const updated = [...(node.config.headers ?? [])]; updated[i] = { ...updated[i], value: value }
                  updateConfig("headers", updated)
                }} placeholder="{{variable}} or value" extraVariables={extraVariables} wrapperClassName="flex-1 min-w-0" />
                <button onClick={() => updateConfig("headers", (node.config.headers ?? []).filter((_: any, j: number) => j !== i))}
                  className="text-xs px-1 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>×</button>
              </div>
            ))}
            <button onClick={() => updateConfig("headers", [...(node.config.headers ?? []), { key: '', value: '' }])}
              className="text-[10px] hover:opacity-70" style={{ color: 'var(--theme-primary-text)' }}>+ Add header</button>
          </div>

          {/* Query Params */}
          <div>
            <label className="block text-[10px] font-medium mb-1" style={{ color: "var(--theme-muted-text)" }}>Query Parameters</label>
            {((node.config.params ?? []) as { key: string; value: string }[]).map((p, i) => (
              <div key={i} className="flex gap-1 mb-1">
                <Input value={p.key} onChange={(e) => {
                  const updated = [...(node.config.params ?? [])]; updated[i] = { ...updated[i], key: e.target.value }
                  updateConfig("params", updated)
                }} placeholder="Param name" className="!text-xs font-mono flex-1" />
                <VariableInput value={p.value} onChange={(value) => {
                  const updated = [...(node.config.params ?? [])]; updated[i] = { ...updated[i], value: value }
                  updateConfig("params", updated)
                }} placeholder="{{variable}} or value" extraVariables={extraVariables} wrapperClassName="flex-1 min-w-0" />
                <button onClick={() => updateConfig("params", (node.config.params ?? []).filter((_: any, j: number) => j !== i))}
                  className="text-xs px-1 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>×</button>
              </div>
            ))}
            <button onClick={() => updateConfig("params", [...(node.config.params ?? []), { key: '', value: '' }])}
              className="text-[10px] hover:opacity-70" style={{ color: 'var(--theme-primary-text)' }}>+ Add parameter</button>
          </div>

          {/* Body */}
          {node.config.method !== "GET" && (
            <div>
              <label className="block text-[10px] font-medium mb-1" style={{ color: "var(--theme-muted-text)" }}>Body</label>
              <select value={node.config.content_type ?? "json"} onChange={(e) => updateConfig("content_type", e.target.value)}
                className="w-full rounded border px-2 py-1 text-[10px] mb-1" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
                <option value="json">JSON</option>
                <option value="form">Form URL Encoded</option>
                <option value="text">Plain Text</option>
                <option value="none">No Body</option>
              </select>
              {(node.config.content_type ?? "json") !== "none" && (
                <VariableInput multiline rows={4} value={node.config.body ?? ""} onChange={(value) => updateConfig("body", value)}
                  placeholder={(node.config.content_type ?? "json") === "json" ? '{"key": "{{task.title}}"}' : (node.config.content_type === "form" ? 'key={{value}}&key2={{value2}}' : 'Plain text body...')} extraVariables={extraVariables} />
              )}
            </div>
          )}

          {/* Output Variable */}
          <div>
            <label className="block text-[10px] font-medium mb-1" style={{ color: "var(--theme-muted-text)" }}>Output Variable</label>
            <Input value={node.config.output_var ?? ""} onChange={(e) => updateConfig("output_var", e.target.value)}
              placeholder="http_response" className="!text-xs font-mono" />
          </div>

          {/* Response model — makes the response pickable in later steps */}
          <HttpResponseModelEditor config={node.config} outputPrefix={deriveOutputPrefix(node)} onUpdate={updateConfig} />
        </div>
      )}

      {/* ─── Create Subtask ─── */}
      {node.type === "create_subtask" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Parent Task</label>
          <VariableInput value={node.config.parent_task_id ?? ''} onChange={(value) => updateConfig('parent_task_id', value)}
            placeholder="{{task_id}} (defaults to the triggering task)" extraVariables={extraVariables} />
          <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
            Select the task to add a subtask to — a task id or a variable like <code style={{ color: 'var(--theme-primary-text)' }}>{'{{task_id}}'}</code>. Leave blank to use the task that triggered this workflow.
          </p>
          <label className="block text-xs font-medium">Subtask Title</label>
          <VariableInput value={node.config.title ?? ""} onChange={(value) => updateConfig("title", value)}
            placeholder="Review: {{task.title}}" extraVariables={extraVariables} />
          <label className="block text-xs font-medium">Assignee</label>
          <VariableInput value={node.config.assignee ?? ""} onChange={(value) => updateConfig("assignee", value)}
            placeholder="User ID or {{variable}}" extraVariables={extraVariables} />
        </div>
      )}

      {/* ─── Log ─── */}
      {node.type === "log" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Message</label>
          <VariableInput value={node.config.message ?? ""} onChange={(value) => updateConfig("message", value)}
            placeholder="Task {{task.title}} processed" extraVariables={extraVariables} />
        </div>
      )}

      {/* ─── Call Reference ─── */}
      {node.type === "call_reference" && (
        <CallReferenceConfig config={node.config} nodeId={node.id} outputPrefix={deriveOutputPrefix(node)} onUpdate={updateConfig} onBatchUpdate={batchUpdateConfig} />
      )}

      {/* ─── Live Reference ─── */}
      {node.type === "live_reference" && (
        <>
          <div onPointerDown={(e) => e.stopPropagation()} className="space-y-2">
            <label className="block text-[10px] font-medium" style={{ color: "var(--theme-muted-text)" }}>
              Binding Name
            </label>
            <Input
              value={node.config.binding_name ?? ''}
              onChange={(e) => updateConfig('binding_name', e.target.value.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase())}
              placeholder="e.g. customer, order_data"
              className="!text-xs font-mono"
            />
            <p className="text-[9px] px-0.5" style={{ color: 'var(--theme-muted-text)' }}>
              Access fresh data with <span className="font-mono font-semibold" style={{ color: 'var(--theme-primary-text)' }}>{'{{live.<name>.<field>}}'}</span> — re-fetched each time it's used.
            </p>
          </div>
          <CallReferenceConfig config={node.config} nodeId={node.id} outputPrefix={deriveOutputPrefix(node)} onUpdate={updateConfig} onBatchUpdate={batchUpdateConfig} />
        </>
      )}

      {/* ─── Document Generation ─── */}
      {node.type === "doc_word" && <DocWordConfig config={node.config} onUpdate={updateConfig} />}
      {node.type === "doc_excel" && <DocExcelConfig config={node.config} onUpdate={updateConfig} />}
      {node.type === "doc_powerpoint" && <DocPowerPointConfig config={node.config} onUpdate={updateConfig} />}

      {/* ─── Auto Action ─── */}
      {node.type === "auto_action" && (
        <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
          <p className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
            Automatically update task fields. Leave blank to skip a field.
          </p>

          <div>
            <label className="block text-xs font-medium mb-1">Task ID</label>
            <VariableInput value={node.config.target_task_id ?? ""} onChange={(value) => updateConfig("target_task_id", value)}
              placeholder="{{task_id}} (defaults to triggering task)" extraVariables={extraVariables} />
            <p className="text-[9px] mt-0.5" style={{ color: "var(--theme-muted-text)" }}>
              Leave blank to action the triggering task, or use a variable for a different task.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Set Status</label>
            <select value={node.config.status ?? ""} onChange={(e) => updateConfig("status", e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-xs" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
              <option value="">— Don't change —</option>
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="blocked">Blocked</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Set Outcome</label>
            <VariableInput value={node.config.outcome ?? ""} onChange={(value) => updateConfig("outcome", value)}
              placeholder="e.g. approved, rejected, or {{variable}}" extraVariables={extraVariables} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Outcome Notes</label>
            <VariableInput value={node.config.outcome_notes ?? ""} onChange={(value) => updateConfig("outcome_notes", value)}
              placeholder="Auto-processed by workflow" extraVariables={extraVariables} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Set Acceptance Status</label>
            <select value={node.config.acceptance_status ?? ""} onChange={(e) => updateConfig("acceptance_status", e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-xs" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
              <option value="">— Don't change —</option>
              <option value="accepted">Accepted</option>
              <option value="pending">Pending</option>
              <option value="held">Held</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Set Priority</label>
            <select value={node.config.priority ?? ""} onChange={(e) => updateConfig("priority", e.target.value)}
              className="w-full rounded border px-2 py-1.5 text-xs" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
              <option value="">— Don't change —</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Reassign To</label>
            <VariableInput value={node.config.assignee_id ?? ""} onChange={(value) => updateConfig("assignee_id", value)}
              placeholder="User ID or {{variable}}" extraVariables={extraVariables} />
          </div>
        </div>
      )}

      {/* ─── Update Data Table ─── */}
      {node.type === "update_data_table" && (
        <UpdateDataTableConfig config={node.config} onUpdate={updateConfig} onBatchUpdate={batchUpdateConfig} extraVariables={extraVariables} />
      )}

      {node.type === "custom_activity" && (
        <CustomWorkflowActivityConfig
          node={node}
          activities={customActivities}
          onUpdate={updateConfig}
          onBatchUpdate={batchUpdateConfig}
          extraVariables={extraVariables}
        />
      )}

      {/* ─── Loop ─── */}
      {node.type === "loop" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Items to loop through</label>
          <LoopItemsInput value={node.config.items ?? ""} onChange={(value) => updateConfig("items", value)} groups={dataPicker?.groups ?? []} />
          <label className="block text-xs font-medium">Current item variable</label>
          <Input value={node.config.item_var ?? "item"} onChange={(e) => updateConfig("item_var", e.target.value)}
            placeholder="item" className="!text-xs font-mono" />
          <label className="block text-xs font-medium">Index variable</label>
          <Input value={node.config.index_var ?? "index"} onChange={(e) => updateConfig("index_var", e.target.value)}
            placeholder="index" className="!text-xs font-mono" />
          <p className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>
            For each item in the list, {'{{item}}'} will hold the current value and {'{{index}}'} the position (0-based). Connect downstream nodes to process each item.
          </p>
        </div>
      )}

      {/* ─── Switch/Case ─── */}
      {node.type === "switch_case" && (
        <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
          <p className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
            Evaluates a value and routes to the matching case. Each case appears as an output port on the canvas.
          </p>

          <div>
            <label className="block text-xs font-medium mb-1">Value to switch on</label>
            <VariableInput value={node.config.field ?? ""} onChange={(value) => updateConfig("field", value)}
              placeholder="{{task.priority}} or {{task.status}}" extraVariables={extraVariables} />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--theme-muted-text)" }}>
              Cases
            </label>
            <div className="space-y-1.5">
              {(node.config.cases ?? []).map((c: any, i: number) => {
                const caseValue = typeof c === 'object' && c !== null ? c.value : String(c ?? '')
                const color = SWITCH_COLORS[i % SWITCH_COLORS.length]
                return (
                  <div key={i} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <Input value={caseValue} onChange={(e) => {
                      const cases = [...(node.config.cases ?? [])]
                      cases[i] = e.target.value
                      updateConfig("cases", cases)
                    }} placeholder={`e.g. critical, high, completed...`} className="!text-xs font-mono" />
                    <button onClick={() => {
                      updateConfig("cases", (node.config.cases ?? []).filter((_: any, j: number) => j !== i))
                    }} className="shrink-0 text-[color:var(--theme-muted-text)] hover:text-[color:var(--theme-danger)] p-0.5"><X size={12} /></button>
                  </div>
                )
              })}
            </div>
            <Button variant="outline" size="sm" onClick={() => updateConfig("cases", [...(node.config.cases ?? []), ""])} className="!text-[10px] mt-2">
              <Plus size={10} className="mr-1" /> Add Case
            </Button>
          </div>

          {/* Default case */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={node.config.has_default !== false}
              onChange={(e) => updateConfig("has_default", e.target.checked)}
              className="rounded border-[color:var(--theme-surface-border)]"
            />
            <span className="text-xs" style={{ color: "var(--theme-card-text)" }}>
              Include Default case (no match)
            </span>
          </label>

          {node.config.has_default !== false && (
            <div className="rounded-lg px-2.5 py-2 flex items-center gap-2" style={{ backgroundColor: "var(--theme-surface)", borderLeft: "3px solid var(--theme-muted-text)" }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "var(--theme-muted-text)" }} />
              <span className="text-xs font-semibold" style={{ color: "var(--theme-muted-text)" }}>Default</span>
              <span className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>— runs if no case matches</span>
            </div>
          )}
        </div>
      )}

      {/* ─── Disabled nodes ─── */}
      {/* ─── Loop N Times ─── */}
      {node.type === "loop_n_times" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Number of iterations</label>
          <VariableInput value={node.config.count ?? ""} onChange={(value) => updateConfig("count", value)}
            placeholder="10 or {{variable}}" extraVariables={extraVariables} />
          <label className="block text-xs font-medium">Index variable</label>
          <Input value={node.config.index_var ?? "i"} onChange={(e) => updateConfig("index_var", e.target.value)}
            placeholder="i" className="!text-xs font-mono" />
          <p className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>
            {'{{i}}'} will be 0, 1, 2... on each iteration.
          </p>
        </div>
      )}

      {/* ─── Pause Until Date ─── */}
      {node.type === "pause_until" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Wait until</label>
          <VariableInput value={node.config.date ?? ""} onChange={(value) => updateConfig("date", value)}
            placeholder="{{task.due_date}} or 2026-04-01T09:00" extraVariables={extraVariables} />
          <p className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>
            ISO date string or a variable containing a date.
          </p>
        </div>
      )}

      {/* ─── End Workflow ─── */}
      {node.type === "end_workflow" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Reason</label>
          <VariableInput value={node.config.reason ?? ""} onChange={(value) => updateConfig("reason", value)}
            placeholder="Completed successfully" extraVariables={extraVariables} />
          <p className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>
            Stops the workflow. All nodes after this will not execute.
          </p>
          {triggerType === 'middleware_received' && (
            <>
              <div className="pt-2" style={{ borderTop: '1px solid var(--theme-surface-border)' }}>
                <label className="block text-xs font-medium mb-1">HTTP Status Code</label>
                <VariableInput
                  value={node.config.response_status_code ?? "200"}
                  onChange={(value) => updateConfig("response_status_code", value)}
                  placeholder="200" extraVariables={extraVariables} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Response Body</label>
                <select
                  value={node.config.response_body_mode ?? 'json'}
                  onChange={(e) => updateConfig('response_body_mode', e.target.value)}
                  className="w-full rounded border px-2 py-1.5 text-xs"
                  style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
                >
                  <option value="json">JSON fields</option>
                  <option value="json_variable">JSON variable</option>
                  <option value="text">Text</option>
                  <option value="file">File stream</option>
                </select>
              </div>
              {(node.config.response_body_mode ?? 'json') === 'text' ? (
                <div>
                  <label className="block text-xs font-medium mb-1">Text Response</label>
                  <VariableInput
                    value={node.config.response_body ?? ''}
                    onChange={(value) => updateConfig('response_body', value)}
                    placeholder="Done: {{result}}"
                    extraVariables={extraVariables}
                  />
                </div>
              ) : (node.config.response_body_mode ?? 'json') === 'json_variable' ? (
                <div>
                  <label className="block text-xs font-medium mb-1">JSON Source</label>
                  <VariableInput
                    value={node.config.response_json_body ?? ''}
                    onChange={(value) => updateConfig('response_json_body', value)}
                    placeholder="{{api_response}}"
                    extraVariables={extraVariables}
                  />
                  <p className="text-[9px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                    Point this at an object or array variable to return it directly.
                  </p>
                </div>
              ) : (node.config.response_body_mode ?? 'json') === 'file' ? (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium mb-1">File Source</label>
                    <VariableInput
                      value={node.config.response_file_source ?? ''}
                      onChange={(value) => updateConfig('response_file_source', value)}
                      placeholder="{{api_file}} or {{downloaded_file_base64}}"
                      extraVariables={extraVariables}
                    />
                    <p className="text-[9px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                      Accepts a file variable, a file URL, a data URL, or a base64 variable.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">File Name</label>
                    <VariableInput
                      value={node.config.response_file_name ?? ''}
                      onChange={(value) => updateConfig('response_file_name', value)}
                      placeholder="report.pdf"
                      extraVariables={extraVariables}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Content Type</label>
                    <VariableInput
                      value={node.config.response_file_content_type ?? ''}
                      onChange={(value) => updateConfig('response_file_content_type', value)}
                      placeholder="application/pdf"
                      extraVariables={extraVariables}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Content Disposition</label>
                    <select
                      value={node.config.response_file_disposition ?? 'attachment'}
                      onChange={(e) => updateConfig('response_file_disposition', e.target.value)}
                      className="w-full rounded border px-2 py-1.5 text-xs"
                      style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
                    >
                      <option value="attachment">Download attachment</option>
                      <option value="inline">Open inline</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium">JSON Fields</label>
                  {((node.config.response_mappings ?? [{ key: 'ok', value: 'true' }]) as { key: string; value: string }[]).map((field, index) => (
                    <div key={index} className="flex gap-1.5 items-start">
                      <Input
                        value={field.key}
                        onChange={(e) => {
                          const next = [...(node.config.response_mappings ?? [{ key: 'ok', value: 'true' }])]
                          next[index] = { ...next[index], key: e.target.value }
                          updateConfig('response_mappings', next)
                        }}
                        placeholder="status"
                        className="!text-xs font-mono flex-1"
                      />
                      <VariableInput
                        value={field.value}
                        onChange={(value) => {
                          const next = [...(node.config.response_mappings ?? [{ key: 'ok', value: 'true' }])]
                          next[index] = { ...next[index], value }
                          updateConfig('response_mappings', next)
                        }}
                        placeholder="{{result}}"
                        className="flex-1"
                        extraVariables={extraVariables}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = (node.config.response_mappings ?? [{ key: 'ok', value: 'true' }]).filter((_: unknown, i: number) => i !== index)
                          updateConfig('response_mappings', next.length > 0 ? next : [{ key: '', value: '' }])
                        }}
                        className="rounded p-1 hover:opacity-70"
                        style={{ color: 'var(--theme-muted-text)' }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => updateConfig('response_mappings', [...(node.config.response_mappings ?? [{ key: 'ok', value: 'true' }]), { key: '', value: '' }])}
                    className="w-full !text-[10px]"
                  >
                    <Plus size={10} className="mr-1" /> Add Response Field
                  </Button>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium">Headers</label>
                {((node.config.response_headers ?? []) as { key: string; value: string }[]).map((header, index) => (
                  <div key={index} className="flex gap-1.5 items-start">
                    <Input
                      value={header.key}
                      onChange={(e) => {
                        const next = [...(node.config.response_headers ?? [])]
                        next[index] = { ...next[index], key: e.target.value }
                        updateConfig('response_headers', next)
                      }}
                      placeholder="Content-Type"
                      className="!text-xs font-mono flex-1"
                    />
                    <VariableInput
                      value={header.value}
                      onChange={(value) => {
                        const next = [...(node.config.response_headers ?? [])]
                        next[index] = { ...next[index], value }
                        updateConfig('response_headers', next)
                      }}
                      placeholder="application/json"
                      className="flex-1"
                      extraVariables={extraVariables}
                    />
                    <button
                      type="button"
                      onClick={() => updateConfig('response_headers', (node.config.response_headers ?? []).filter((_: unknown, i: number) => i !== index))}
                      className="rounded p-1 hover:opacity-70"
                      style={{ color: 'var(--theme-muted-text)' }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => updateConfig('response_headers', [...(node.config.response_headers ?? []), { key: '', value: '' }])}
                  className="w-full !text-[10px]"
                >
                  <Plus size={10} className="mr-1" /> Add Header
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── Math / Calculate ─── */}
      {node.type === "math" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Expression</label>
          <VariableInput value={node.config.expression ?? ""} onChange={(value) => updateConfig("expression", value)}
            placeholder="{{task.actual_effort}} / 60" extraVariables={extraVariables} />
          <label className="block text-xs font-medium">Save result as</label>
          <Input value={node.config.output_var ?? "result"} onChange={(e) => updateConfig("output_var", e.target.value)}
            className="!text-xs font-mono" />
          <p className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>
            Supports: + - * / % and parentheses. Variables are resolved first.
          </p>
        </div>
      )}

      {/* ─── Modify String ─── */}
      {node.type === "modify_string" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Input</label>
          <VariableInput value={node.config.input ?? ""} onChange={(value) => updateConfig("input", value)}
            placeholder="{{task.title}}" extraVariables={extraVariables} />
          <label className="block text-xs font-medium">Operation</label>
          <AutocompleteSelect
            value={node.config.operation ?? "trim"}
            onChange={(value) => updateConfig("operation", value)}
            options={[
              { value: "uppercase", label: "To Uppercase" },
              { value: "lowercase", label: "To Lowercase" },
              { value: "trim", label: "Trim whitespace" },
              { value: "replace", label: "Find & Replace" },
              { value: "substring", label: "Substring" },
              { value: "slug", label: "Slugify" },
              { value: "reverse", label: "Reverse" },
            ]}
          />
          {node.config.operation === "replace" && (
            <>
              <Input value={node.config.search ?? ""} onChange={(e) => updateConfig("search", e.target.value)}
                placeholder="Find..." className="!text-xs" />
              <VariableInput value={node.config.replace_with ?? ""} onChange={(value) => updateConfig("replace_with", value)}
                placeholder="Replace with..." extraVariables={extraVariables} />
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={node.config.replace_all ?? false}
                  onChange={(e) => updateConfig("replace_all", e.target.checked)} className="rounded" />
                Replace all occurrences
              </label>
            </>
          )}
          {node.config.operation === "substring" && (
            <div className="flex gap-2">
              <Input type="number" value={node.config.start ?? 0} onChange={(e) => updateConfig("start", e.target.value)}
                placeholder="Start" className="!text-xs" />
              <Input type="number" value={node.config.end ?? ""} onChange={(e) => updateConfig("end", e.target.value)}
                placeholder="End (optional)" className="!text-xs" />
            </div>
          )}
          <label className="block text-xs font-medium">Save result as</label>
          <Input value={node.config.output_var ?? "modified_string"} onChange={(e) => updateConfig("output_var", e.target.value)}
            className="!text-xs font-mono" />
        </div>
      )}

      {/* ─── Text Template ─── */}
      {node.type === "text_template" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Template</label>
          <VariableInput multiline rows={3} value={node.config.template ?? ""} onChange={(value) => updateConfig("template", value)}
            placeholder={"Task {{task.title}} assigned to {{task.assignee_id}} is due {{task.due_date}}"} extraVariables={extraVariables} />
          <label className="block text-xs font-medium">Save result as</label>
          <Input value={node.config.output_var ?? "text"} onChange={(e) => updateConfig("output_var", e.target.value)}
            className="!text-xs font-mono" />
        </div>
      )}

      {/* ─── Format Date ─── */}
      {node.type === "format_date" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Date</label>
          <VariableInput value={node.config.date ?? ""} onChange={(value) => updateConfig("date", value)}
            placeholder="{{task.due_date}}" extraVariables={extraVariables} />
          <label className="block text-xs font-medium">Format</label>
          <AutocompleteSelect
            value={node.config.format ?? "short"}
            onChange={(value) => updateConfig("format", value)}
            options={[
              { value: "iso", label: "ISO 8601 (2026-03-27T12:00:00Z)" },
              { value: "short", label: "Short (Mar 27, 2026)" },
              { value: "date", label: "Date (3/27/2026)" },
              { value: "time", label: "Time (12:00:00 PM)" },
              { value: "datetime", label: "Date + Time" },
              { value: "relative", label: "Relative (2 days ago)" },
              { value: "custom", label: "Custom format..." },
            ]}
          />
          {node.config.format === "custom" && (
            <Input value={node.config.custom_format ?? "YYYY-MM-DD"} onChange={(e) => updateConfig("custom_format", e.target.value)}
              placeholder="YYYY-MM-DD HH:mm" className="!text-xs font-mono" />
          )}
          <label className="block text-xs font-medium">Save result as</label>
          <Input value={node.config.output_var ?? "formatted_date"} onChange={(e) => updateConfig("output_var", e.target.value)}
            className="!text-xs font-mono" />
        </div>
      )}

      {/* ─── Date Math ─── */}
      {node.type === "date_math" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Operation</label>
          <select value={node.config.operation ?? "add"} onChange={(e) => updateConfig("operation", e.target.value)}
            className="w-full rounded border px-2 py-1.5 text-xs" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
            <option value="add">Add time to date</option>
            <option value="subtract">Subtract time from date</option>
            <option value="interval">Find interval between dates</option>
          </select>
          <label className="block text-xs font-medium">Date</label>
          <VariableInput value={node.config.date ?? ""} onChange={(value) => updateConfig("date", value)}
            placeholder="{{task.due_date}}" extraVariables={extraVariables} />
          {node.config.operation === "interval" ? (
            <>
              <label className="block text-xs font-medium">Second date</label>
              <VariableInput value={node.config.date2 ?? ""} onChange={(value) => updateConfig("date2", value)}
                placeholder="{{task.completed_at}}" extraVariables={extraVariables} />
            </>
          ) : (
            <div className="flex gap-2">
              <VariableInput value={node.config.amount ?? ""} onChange={(value) => updateConfig("amount", value)}
                placeholder="5" extraVariables={extraVariables} wrapperClassName="w-28 shrink-0" />
              <select value={node.config.unit ?? "days"} onChange={(e) => updateConfig("unit", e.target.value)}
                className="rounded border px-2 py-1.5 text-xs flex-1" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
                <option value="months">Months</option>
                <option value="years">Years</option>
              </select>
            </div>
          )}
          <label className="block text-xs font-medium">Save result as</label>
          <Input value={node.config.output_var ?? (node.config.operation === "interval" ? "interval" : "new_date")}
            onChange={(e) => updateConfig("output_var", e.target.value)} className="!text-xs font-mono" />
        </div>
      )}

      {/* ─── Regex ─── */}
      {node.type === "regex" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Input</label>
          <VariableInput value={node.config.input ?? ""} onChange={(value) => updateConfig("input", value)}
            placeholder="{{task.description}}" extraVariables={extraVariables} />
          <label className="block text-xs font-medium">Operation</label>
          <select value={node.config.operation ?? "match"} onChange={(e) => updateConfig("operation", e.target.value)}
            className="w-full rounded border px-2 py-1.5 text-xs" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
            <option value="match">Match (extract)</option>
            <option value="test">Test (true/false)</option>
            <option value="replace">Replace</option>
            <option value="split">Split</option>
          </select>
          <label className="block text-xs font-medium">Pattern</label>
          <Input value={node.config.pattern ?? ""} onChange={(e) => updateConfig("pattern", e.target.value)}
            placeholder="\\d+" className="!text-xs font-mono" />
          <div className="flex gap-2">
            <Input value={node.config.flags ?? "g"} onChange={(e) => updateConfig("flags", e.target.value)}
              placeholder="g" className="!text-xs font-mono w-16" />
            <span className="text-[9px] self-center" style={{ color: "var(--theme-muted-text)" }}>flags (g, i, m)</span>
          </div>
          {node.config.operation === "replace" && (
            <>
              <label className="block text-xs font-medium">Replace with</label>
              <Input value={node.config.replace_with ?? ""} onChange={(e) => updateConfig("replace_with", e.target.value)}
                placeholder="replacement" className="!text-xs" />
            </>
          )}
          <label className="block text-xs font-medium">Save result as</label>
          <Input value={node.config.output_var ?? "regex_result"} onChange={(e) => updateConfig("output_var", e.target.value)}
            className="!text-xs font-mono" />
        </div>
      )}

      {/* ─── Collection Operations ─── */}
      {["collection_count", "collection_get", "collection_filter", "collection_sort", "collection_unique", "collection_join"].includes(node.type) && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-medium">Collection</label>
          <VariableInput value={node.config.collection ?? ""} onChange={(value) => updateConfig("collection", value)}
            placeholder="{{ref_items}}" extraVariables={extraVariables} />

          {node.type === "collection_get" && (
            <>
              <label className="block text-xs font-medium">Get by</label>
              <select value={node.config.by ?? "index"} onChange={(e) => updateConfig("by", e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-xs" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
                <option value="index">Index (position)</option>
                <option value="last">Last item</option>
                <option value="key">By key/field value</option>
              </select>
              {node.config.by === "index" && (
                <VariableInput value={node.config.index ?? "0"} onChange={(value) => updateConfig("index", value)}
                  placeholder="0" extraVariables={extraVariables} />
              )}
              {node.config.by === "key" && (
                <>
                  <Input value={node.config.key_field ?? ""} onChange={(e) => updateConfig("key_field", e.target.value)}
                    placeholder="Field name (e.g. id)" className="!text-xs font-mono" />
                  <VariableInput value={node.config.key ?? ""} onChange={(value) => updateConfig("key", value)}
                    placeholder="Value to match" extraVariables={extraVariables} />
                </>
              )}
            </>
          )}

          {node.type === "collection_filter" && (
            <>
              <label className="block text-xs font-medium">Filter field</label>
              <Input value={node.config.field ?? ""} onChange={(e) => updateConfig("field", e.target.value)}
                placeholder="status (leave blank for primitives)" className="!text-xs font-mono" />
              <select value={node.config.operator ?? "equals"} onChange={(e) => updateConfig("operator", e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-xs" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
                <option value="equals">=</option><option value="not_equals">!=</option>
                <option value="contains">contains</option><option value="gt">&gt;</option><option value="lt">&lt;</option>
              </select>
              <VariableInput value={node.config.value ?? ""} onChange={(value) => updateConfig("value", value)}
                placeholder="Value to compare" extraVariables={extraVariables} />
            </>
          )}

          {node.type === "collection_sort" && (
            <>
              <label className="block text-xs font-medium">Sort by field</label>
              <Input value={node.config.field ?? ""} onChange={(e) => updateConfig("field", e.target.value)}
                placeholder="name (leave blank for primitives)" className="!text-xs font-mono" />
              <select value={node.config.direction ?? "asc"} onChange={(e) => updateConfig("direction", e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-xs" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
                <option value="asc">Ascending (A→Z, 0→9)</option>
                <option value="desc">Descending (Z→A, 9→0)</option>
              </select>
            </>
          )}

          {node.type === "collection_unique" && (
            <>
              <label className="block text-xs font-medium">Deduplicate by field</label>
              <Input value={node.config.field ?? ""} onChange={(e) => updateConfig("field", e.target.value)}
                placeholder="id (leave blank for whole item)" className="!text-xs font-mono" />
            </>
          )}

          {node.type === "collection_join" && (
            <>
              <label className="block text-xs font-medium">Separator</label>
              <Input value={node.config.separator ?? ", "} onChange={(e) => updateConfig("separator", e.target.value)}
                className="!text-xs font-mono" />
              <label className="block text-xs font-medium">Field to join</label>
              <Input value={node.config.field ?? ""} onChange={(e) => updateConfig("field", e.target.value)}
                placeholder="name (leave blank for whole item)" className="!text-xs font-mono" />
            </>
          )}

          <label className="block text-xs font-medium">Save result as</label>
          <Input value={node.config.output_var ?? ""} onChange={(e) => updateConfig("output_var", e.target.value)}
            placeholder={node.type === "collection_count" ? "count" : node.type === "collection_join" ? "joined" : "result"}
            className="!text-xs font-mono" />
        </div>
      )}

      {/* ─── Send Email ─── */}
      {node.type === "send_email" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <div>
            <label className="block text-xs font-medium mb-1">Email template</label>
            <select value={node.config.email_template_id ?? ""} onChange={(e) => updateConfig("email_template_id", e.target.value || undefined)} className="w-full rounded border px-2 py-1.5 text-xs" style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}>
              <option value="">Custom subject and body</option>
              {emailTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">To</label>
            <VariableInput value={node.config.to ?? ""} onChange={(value) => updateConfig("to", value)}
              placeholder="email@example.com or {{task.assignee_email}}" extraVariables={extraVariables} />
            <p className="text-[9px] mt-0.5" style={{ color: "var(--theme-muted-text)" }}>
              Separate multiple addresses with commas
            </p>
          </div>
          {!node.config.email_template_id && <>
            <div>
              <label className="block text-xs font-medium mb-1">Subject</label>
              <VariableInput value={node.config.subject ?? ""} onChange={(value) => updateConfig("subject", value)} placeholder="Task {{task.title}} requires attention" extraVariables={extraVariables} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Body (HTML)</label>
              <VariableInput multiline rows={6} value={node.config.body ?? ""} onChange={(value) => updateConfig("body", value)} placeholder={"<h2>Task Update</h2>\n<p>Task <strong>{{task.title}}</strong> has been {{task.status}}.</p>"} extraVariables={extraVariables} />
            </div>
          </>}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1">From (optional)</label>
              <VariableInput value={node.config.from ?? ""} onChange={(value) => updateConfig("from", value)}
                placeholder="Name <email>" extraVariables={extraVariables} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Reply-To (optional)</label>
              <VariableInput value={node.config.reply_to ?? ""} onChange={(value) => updateConfig("reply_to", value)}
                placeholder="reply@example.com" extraVariables={extraVariables} />
            </div>
          </div>
          <div className="rounded-lg p-2 text-[9px]" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
            <p className="font-medium mb-0.5">Setup required:</p>
            <p>Add <code className="font-mono" style={{ color: "var(--theme-primary-text)" }}>RESEND_API_KEY</code> to your .env.local file.</p>
            <p>Free tier: 100 emails/day at <a href="https://resend.com" target="_blank" rel="noopener" className="underline">resend.com</a></p>
          </div>
        </div>
      )}

      {/* ─── Server Event ─── */}
      {node.type === "server_event" && (
        <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
          <div className="rounded-lg p-3" style={{ backgroundColor: "color-mix(in srgb, var(--status-info) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--status-info) 19%, transparent)" }}>
            <p className="text-xs font-medium mb-1" style={{ color: "var(--status-info)" }}>Server Event</p>
            <p className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
              Pauses the workflow and waits for an external server to call back. A unique event ID is generated and sent to the external system.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Event Name</label>
            <VariableInput value={node.config.event_name ?? ""} onChange={(value) => updateConfig("event_name", value)}
              placeholder="e.g. order.processing" extraVariables={extraVariables} />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Outbound Action</label>
            <p className="text-[9px] mb-1" style={{ color: "var(--theme-muted-text)" }}>How to notify the external system</p>
            <select value={node.config.outbound_action ?? "none"} onChange={(e) => updateConfig("outbound_action", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-xs"
              style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}>
              <option value="none">None (manual trigger)</option>
              <option value="api_reference">Call API Reference</option>
              <option value="data_table">Write to Data Table</option>
            </select>
          </div>

          {node.config.outbound_action === "api_reference" && (
            <>
              <ServerEventReferencePicker
                referenceId={node.config.reference_id ?? ""}
                referenceName={node.config.reference_name ?? ""}
                // One batched update — two sequential updateConfig calls each
                // rebuild from the same stale snapshot, so the second would
                // erase reference_id and the selection never sticks.
                onSelect={(id, name) => batchUpdateConfig({ reference_id: id, reference_name: name, reference_input_mappings: {} })}
              />
              {node.config.reference_id && (
                <ServerEventReferenceInputs
                  referenceId={node.config.reference_id}
                  mappings={(node.config.reference_input_mappings ?? {}) as Record<string, string>}
                  onChange={(mappings) => updateConfig('reference_input_mappings', mappings)}
                  extraVariables={extraVariables}
                />
              )}
            </>
          )}

          {node.config.outbound_action === "data_table" && (
            <ServerEventTablePicker
              tableId={dataTableIdOf(node.config)}
              tableName={cachedTableNameOf(node.config)}
              onSelect={(id, name) => batchUpdateConfig({ table_id: id, table_name: name })}
            />
          )}

          <div>
            <label className="block text-xs font-medium mb-1">Outbound payload</label>
            <div className="flex gap-1 mb-1.5">
              {[
                { value: 'variables', label: 'Variable list' },
                { value: 'custom', label: 'Custom JSON' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateConfig('payload_mode', option.value)}
                  className="flex-1 rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors"
                  style={{
                    backgroundColor: (node.config.payload_mode ?? 'variables') === option.value ? 'var(--theme-primary)' : 'var(--theme-surface)',
                    color: (node.config.payload_mode ?? 'variables') === option.value ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {(node.config.payload_mode ?? 'variables') === 'variables' ? (
              <>
                <p className="text-[9px] mb-1" style={{ color: "var(--theme-muted-text)" }}>Variable names to include in the outbound payload (comma-separated)</p>
                <Input value={(node.config.send_variables ?? []).join(", ")}
                  onChange={(e) => updateConfig("send_variables", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                  placeholder="e.g. task_id, assignee_id, amount" className="!text-xs font-mono" />
              </>
            ) : (
              <>
                <p className="text-[9px] mb-1" style={{ color: "var(--theme-muted-text)" }}>
                  A JSON object; {'{{variable}}'} placeholders resolve at runtime. <code>event_id</code> and <code>event_name</code> are always merged in so the callback contract holds.
                </p>
                <VariableInput multiline rows={5}
                  value={node.config.custom_payload ?? ''}
                  onChange={(value) => updateConfig('custom_payload', value)}
                  placeholder={'{\n  "order_id": "{{order_id}}",\n  "callback_ref": "{{event_id}}",\n  "priority": "high"\n}'} extraVariables={extraVariables} />
              </>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Expected Return Variables</label>
            <p className="text-[9px] mb-1" style={{ color: "var(--theme-muted-text)" }}>
              Every field in the callback payload is merged into the run by name automatically — list the ones you expect here so they appear in the variable picker for later steps.
            </p>
            <Input value={(node.config.return_variables ?? []).join(", ")}
              onChange={(e) => updateConfig("return_variables", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
              placeholder="e.g. approval_status, comments, processed_at" className="!text-xs font-mono" />
          </div>

          <div className="rounded-lg p-2.5 text-[9px] space-y-1" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
            <p className="font-semibold">How the callback works</p>
            <p>The outbound call includes a unique <code>event_id</code> (e.g. <code>evt_a1b2…</code>). The workflow pauses until your server calls back with that id — then the payload merges into the run and the workflow continues.</p>
            <p className="font-semibold mt-1.5">External systems (recommended) — authenticate with a workspace API key:</p>
            <code className="block font-mono" style={{ color: "var(--theme-primary-text)" }}>
              POST /api/v1/workflows/events/{'{event_id}'}/complete
            </code>
            <p>Header: <code>Authorization: Bearer &lt;api key&gt;</code> · Body: <code>{"{"} &quot;return_variables&quot;: {"{"} &quot;approval_status&quot;: &quot;approved&quot; {"}"} {"}"}</code></p>
            <p className="font-semibold mt-1.5">Internal / signed-in callers:</p>
            <code className="block font-mono" style={{ color: "var(--theme-primary-text)" }}>
              POST /api/events/complete
            </code>
            <p>Body: <code>{"{"} &quot;event_id&quot;: &quot;evt_...&quot;, &quot;approval_status&quot;: &quot;approved&quot;, ... {"}"}</code> (requires a user session or the processor secret — unauthenticated external calls are rejected).</p>
          </div>
        </div>
      )}

      {/* ─── Call Sub Workflow ─── */}
      {node.type === "call_sub_workflow" && (
        <SubWorkflowConfig config={node.config} onUpdate={updateConfig} onBatchUpdate={batchUpdateConfig} extraVariables={extraVariables} />
      )}

      {node.type === "decision_table" && (
        <DecisionTableConfig config={node.config} onUpdate={updateConfig} onBatchUpdate={batchUpdateConfig} extraVariables={extraVariables} />
      )}

      {node.type === "retention_policies" && (
        <RetentionPoliciesWorkflowConfig
          config={node.config}
          onUpdate={updateConfig}
          onBatchUpdate={batchUpdateConfig}
          extraVariables={extraVariables}
        />
      )}

      {/* ─── User Task ─── */}
      {node.type === "user_task" && (
        triggerType === 'middleware_received' ? (
          <div className="rounded-lg p-3" style={{ backgroundColor: "var(--theme-surface)" }}>
            <p className="text-xs font-medium mb-1" style={{ color: "var(--theme-warning)" }}>
              Unavailable In Middleware
            </p>
            <p className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
              Middleware workflows are synchronous system flows and cannot pause for a human <code style={{ color: 'var(--theme-primary-text)' }}>User Task</code>.
            </p>
          </div>
        ) : (
          <UserTaskConfig config={node.config} onUpdate={updateConfig} onBatchUpdate={batchUpdateConfig} extraVariables={extraVariables} emailTemplates={emailTemplates}
            formSection={<NodeFormSection variant="user_task" node={node} allNodes={allNodes ?? []} onPatch={batchUpdateConfig} onUpdateOtherNode={(id, config) => onUpdateNode(id, { config })} />} />
        )
      )}

      {/* ─── Governance ─── */}
      {(node.type === "add_user_to_role" || node.type === "remove_user_from_role") && (
        <GovernanceRoleAssignmentConfig
          action={node.type}
          config={node.config}
          onUpdate={updateConfig}
          onBatchUpdate={batchUpdateConfig}
          extraVariables={extraVariables}
        />
      )}

      {node.type === "check_permission" && (
        <PermissionCheckConfig
          config={node.config}
          onUpdate={updateConfig}
          onBatchUpdate={batchUpdateConfig}
          extraVariables={extraVariables}
        />
      )}

      {/* ─── Parallel / Sequential ─── */}
      {node.type === "parallel" && (
        <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
          <div className="rounded-lg p-3" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-chart-6) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--theme-chart-6) 20%, transparent)' }}>
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--theme-chart-6-text)' }}>Parallel / Sequential</p>
            <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
              Define named branches. In parallel mode all run at once. In sequential mode they run in the numbered order.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Execution Mode</label>
            <div className="flex gap-0.5">
              {[
                { val: 'parallel', label: 'All at once' },
                { val: 'sequential', label: 'One by one' },
              ].map(o => (
                <button key={o.val} type="button"
                  onClick={() => updateConfig("mode", o.val)}
                  className="flex-1 text-[9px] font-medium py-1.5 rounded transition-colors"
                  style={{
                    backgroundColor: (node.config.mode ?? 'parallel') === o.val ? 'var(--theme-primary)' : 'var(--theme-surface)',
                    color: (node.config.mode ?? 'parallel') === o.val ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
                  }}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">
              Branches
              {(node.config.mode ?? 'parallel') === 'sequential' && (
                <span className="ml-1 text-[9px] font-normal" style={{ color: 'var(--theme-muted-text)' }}>
                  (executed top to bottom)
                </span>
              )}
            </label>
            <div className="space-y-1.5">
              {((node.config.branches ?? [{ label: 'Branch 1', order: 1 }, { label: 'Branch 2', order: 2 }]) as { label: string; order: number }[]).map((branch, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-lg p-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
                  {(node.config.mode ?? 'parallel') === 'sequential' && (
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                      style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }}>
                      {i + 1}
                    </span>
                  )}
                  <Input
                    value={branch.label}
                    onChange={(e) => {
                      const updated = [...(node.config.branches ?? [{ label: 'Branch 1', order: 1 }, { label: 'Branch 2', order: 2 }])]
                      updated[i] = { ...updated[i], label: e.target.value }
                      updateConfig('branches', updated)
                    }}
                    placeholder={`Branch ${i + 1}`}
                    className="!text-xs !h-7 flex-1"
                  />
                  {(node.config.branches ?? []).length > 2 && (
                    <button
                      onClick={() => {
                        const updated = [...(node.config.branches ?? [])]
                        updated.splice(i, 1)
                        updateConfig('branches', updated)
                      }}
                      className="p-0.5 rounded hover:text-[color:var(--theme-danger)] shrink-0"
                      style={{ color: 'var(--theme-muted-text)' }}>
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={() => {
              const branches = node.config.branches ?? [{ label: 'Branch 1', order: 1 }, { label: 'Branch 2', order: 2 }]
              updateConfig('branches', [...branches, { label: `Branch ${branches.length + 1}`, order: branches.length + 1 }])
            }} className="w-full mt-2 !text-[10px] !h-7">
              <Plus size={10} className="mr-1" /> Add Branch
            </Button>
          </div>

          <div className="rounded-lg p-2 text-[9px]" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
            Connect each branch port below to the first action in that branch. All branches rejoin after this node's downstream edges.
          </div>
        </div>
      )}

      {/* ─── Go To Activity ─── */}
      {node.type === "goto_activity" && (
        <GoToActivityConfig
          config={node.config}
          onUpdate={updateConfig}
          onBatchUpdate={batchUpdateConfig}
          allNodes={allNodes ?? []}
          currentNodeId={node.id}
          extraVariables={extraVariables}
        />
      )}

      {/* ─── Placeholder ─── */}
      {node.type === "placeholder" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <div className="rounded-lg p-3" style={{ backgroundColor: "var(--theme-surface)" }}>
            <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>
              This is a placeholder action. It does nothing when executed — use it to sketch out your workflow, then replace it with a real action later.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Note (optional)</label>
            <textarea value={node.config.note ?? ""} onChange={(e) => updateConfig("note", e.target.value)}
              rows={2} className="w-full rounded-md border px-3 py-2 text-xs resize-none"
              style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
              placeholder="What should this step do?" />
          </div>
        </div>
      )}

      {/* ─── Run Agent ─── */}
      {node.type === "run_agent" && (
        <RunAgentConfig config={node.config} onUpdate={updateConfig} onBatchUpdate={batchUpdateConfig} extraVariables={extraVariables} />
      )}

      {/* ─── File to Base64 ─── */}
      {node.type === "file_to_base64" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <div>
            <label className="block text-xs font-medium mb-1">File URL</label>
            <VariableInput value={node.config.file_url ?? ""} onChange={(value) => updateConfig("file_url", value)}
              placeholder="{{file_url}} or https://..." extraVariables={extraVariables} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Output Variable</label>
            <Input value={node.config.output_var ?? "file_base64"} onChange={(e) => updateConfig("output_var", e.target.value)}
              className="!text-xs font-mono" />
          </div>
          <div className="rounded-lg p-2 text-[9px] space-y-0.5" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
            <p className="font-medium">Output variables:</p>
            <p><code style={{ color: "var(--theme-primary-text)" }}>{`{{${node.config.output_var || "file_base64"}}}`}</code> — Base64 string</p>
            <p><code style={{ color: "var(--theme-primary-text)" }}>{`{{${node.config.output_var || "file_base64"}_name}}`}</code> — Filename</p>
            <p><code style={{ color: "var(--theme-primary-text)" }}>{`{{${node.config.output_var || "file_base64"}_size}}`}</code> — Size in bytes</p>
          </div>
        </div>
      )}

      {/* ─── Base64 to File ─── */}
      {node.type === "base64_to_file" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <div>
            <label className="block text-xs font-medium mb-1">Base64 Data</label>
            <VariableInput value={node.config.base64_data ?? ""} onChange={(value) => updateConfig("base64_data", value)}
              placeholder="{{file_base64}}" extraVariables={extraVariables} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">File Name</label>
            <VariableInput value={node.config.file_name ?? ""} onChange={(value) => updateConfig("file_name", value)}
              placeholder="output.pdf" extraVariables={extraVariables} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Content Type (optional)</label>
            <Input value={node.config.content_type ?? ""} onChange={(e) => updateConfig("content_type", e.target.value)}
              placeholder="application/pdf" className="!text-xs font-mono" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Output Variable</label>
            <Input value={node.config.output_var ?? "file_url"} onChange={(e) => updateConfig("output_var", e.target.value)}
              className="!text-xs font-mono" />
          </div>
          <div className="rounded-lg p-2 text-[9px] space-y-0.5" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
            <p className="font-medium">Output variables:</p>
            <p><code style={{ color: "var(--theme-primary-text)" }}>{`{{${node.config.output_var || "file_url"}}}`}</code> — Public URL</p>
            <p><code style={{ color: "var(--theme-primary-text)" }}>{`{{${node.config.output_var || "file_url"}_path}}`}</code> — Storage path</p>
            <p><code style={{ color: "var(--theme-primary-text)" }}>{`{{${node.config.output_var || "file_url"}_size}}`}</code> — Size in bytes</p>
          </div>
        </div>
      )}

      {/* ─── Download File ─── */}
      {node.type === "download_file" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <div>
            <label className="block text-xs font-medium mb-1">URL</label>
            <VariableInput value={node.config.url ?? ""} onChange={(value) => updateConfig("url", value)}
              placeholder="https://example.com/file.pdf" extraVariables={extraVariables} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">File Name (optional)</label>
            <VariableInput value={node.config.file_name ?? ""} onChange={(value) => updateConfig("file_name", value)}
              placeholder="Auto-detect from URL/headers" extraVariables={extraVariables} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Output Variable</label>
            <Input value={node.config.output_var ?? "downloaded_file"} onChange={(e) => updateConfig("output_var", e.target.value)}
              className="!text-xs font-mono" />
          </div>
          <div className="rounded-lg p-2 text-[9px] space-y-0.5" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
            <p className="font-medium">Output variables:</p>
            <p><code style={{ color: "var(--theme-primary-text)" }}>{`{{${node.config.output_var || "downloaded_file"}}}`}</code> — Public URL</p>
            <p><code style={{ color: "var(--theme-primary-text)" }}>{`{{${node.config.output_var || "downloaded_file"}_base64}}`}</code> — Base64 content</p>
            <p><code style={{ color: "var(--theme-primary-text)" }}>{`{{${node.config.output_var || "downloaded_file"}_name}}`}</code> — Filename</p>
            <p><code style={{ color: "var(--theme-primary-text)" }}>{`{{${node.config.output_var || "downloaded_file"}_size}}`}</code> — Size in bytes</p>
            <p><code style={{ color: "var(--theme-primary-text)" }}>{`{{${node.config.output_var || "downloaded_file"}_type}}`}</code> — MIME type</p>
          </div>
        </div>
      )}

      {/* ─── Read File Content ─── */}
      {node.type === "read_file" && (
        <div className="space-y-2" onPointerDown={(e) => e.stopPropagation()}>
          <div>
            <label className="block text-xs font-medium mb-1">File URL</label>
            <VariableInput value={node.config.file_url ?? ""} onChange={(value) => updateConfig("file_url", value)}
              placeholder="{{file_url}} or https://..." extraVariables={extraVariables} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Read As</label>
            <select value={node.config.encoding ?? "utf-8"} onChange={(e) => updateConfig("encoding", e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-xs"
              style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}>
              <option value="utf-8">Text (UTF-8)</option>
              <option value="base64">Base64</option>
              <option value="json">JSON (parse)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Output Variable</label>
            <Input value={node.config.output_var ?? "file_content"} onChange={(e) => updateConfig("output_var", e.target.value)}
              className="!text-xs font-mono" />
          </div>
          <div className="rounded-lg p-2 text-[9px]" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
            <p><code style={{ color: "var(--theme-primary-text)" }}>{`{{${node.config.output_var || "file_content"}}}`}</code> — File content in selected format</p>
          </div>
        </div>
      )}
    </div>
    </DataPickerProvider>
    </TriggerTypeProvider>
  )
}

// ─── Multi-Branch Condition Builder ───

interface ConditionRule {
  field: string
  operator: string
  value: string
}

interface ConditionBranch {
  label: string
  logic: "and" | "or"
  rules: ConditionRule[]
}

const BRANCH_COLORS = ["var(--theme-chart-1)", "var(--theme-chart-2)", "var(--theme-chart-3)", "var(--theme-chart-4)", "var(--theme-chart-5)", "var(--theme-chart-6)", "var(--theme-chart-7)"]

// ─── Sub Workflow Config ───
function SubWorkflowConfig({ config, onUpdate, onBatchUpdate, extraVariables }: {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables: { name: string; group: string }[]
}) {
  const { data: workflows } = useWorkflowOptions()

  const selectedWorkflow = workflows?.find(w => w.id === config.sub_workflow_id)
  const subVars = (selectedWorkflow?.user_variables ?? []) as { name: string; type: string; defaultValue: string; description: string }[]
  const inputMappings = (config.input_mappings ?? {}) as Record<string, string>

  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rounded-lg p-3" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-chart-3) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--theme-chart-3) 20%, transparent)' }}>
        <p className="text-xs font-medium mb-1" style={{ color: 'var(--theme-chart-3-text)' }}>Call Sub Workflow</p>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          Execute another workflow as a child process. Use the Execution toggle above to choose whether to wait for completion or fire and forget.
        </p>
      </div>

      {/* Workflow picker */}
      <div>
        <label className="block text-xs font-medium mb-1">Workflow</label>
        <AutocompleteSelect
          value={config.sub_workflow_id ?? ''}
          placeholder="Select a workflow..."
          options={(workflows ?? []).map(w => ({
            value: w.id,
            label: w.name,
            hint: w.is_active ? 'active' : 'draft',
          }))}
          onChange={(nextId) => {
            const wf = workflows?.find(w => w.id === nextId)
            // One batched write — sequential updates would spread a stale
            // config snapshot and clobber each other.
            onBatchUpdate({
              sub_workflow_id: nextId,
              sub_workflow_name: wf?.name ?? '',
              input_mappings: {},
            })
          }}
        />
      </div>

      {/* Dynamic variable inputs */}
      {selectedWorkflow && subVars.length > 0 && (
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>
            Input Variables ({subVars.length})
          </label>
          <p className="text-[9px] mb-2" style={{ color: 'var(--theme-muted-text)' }}>
            Map values to the sub-workflow's variables. Leave empty to use the default.
          </p>
          <div className="space-y-2">
            {subVars.map(v => (
              <div key={v.name}>
                <div className="flex items-center gap-1 mb-0.5">
                  <code className="text-[10px] font-mono font-medium" style={{ color: 'var(--theme-chart-3-text)' }}>{v.name}</code>
                  <span className="text-[8px] px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>{v.type}</span>
                  {v.defaultValue && <span className="text-[8px]" style={{ color: 'var(--theme-muted-text)' }}>default: {v.defaultValue}</span>}
                </div>
                {v.description && <p className="text-[9px] mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>{v.description}</p>}
                <VariableInput
                  value={inputMappings[v.name] ?? ''}
                  onChange={val => onUpdate('input_mappings', { ...inputMappings, [v.name]: val })}
                  placeholder={v.defaultValue ? `Default: ${v.defaultValue}` : `{{variable}} or value`}
                  extraVariables={extraVariables}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedWorkflow && subVars.length === 0 && (
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          This workflow has no input variables defined.
        </p>
      )}

      <div className="rounded-lg p-2 text-[9px] space-y-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
        <p className="font-semibold">Return variables:</p>
        <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{sub_workflow_status}}'}</code> — completed/failed</p>
        <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{sub_workflow_results}}'}</code> — node results from sub-workflow</p>
      </div>
    </div>
  )
}

function DecisionTableConfig({ config, onUpdate, onBatchUpdate, extraVariables }: {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables: { name: string; group: string }[]
}) {
  const { data: tables } = useDecisionTableOptions()

  const selectedTable = (tables ?? []).find((table: any) => table.id === config.decision_table_id)
  const inputDefs = (selectedTable?.inputs ?? config._decision_inputs ?? []) as { key: string; label?: string; type?: string }[]
  const outputDefs = (selectedTable?.outputs ?? config._decision_outputs ?? []) as { key: string; label?: string; type?: string }[]
  const inputMappings = (config.input_mappings ?? {}) as Record<string, string>

  // Backfill/refresh the cached defs so the variables catalog (which can't
  // query the DB) can list this node's outputs — covers nodes configured
  // before caching existed, MCP-created nodes, and edited decision tables.
  useEffect(() => {
    if (!selectedTable) return
    const nextOutputs = JSON.stringify(selectedTable.outputs ?? [])
    const nextInputs = JSON.stringify(selectedTable.inputs ?? [])
    if (nextOutputs !== JSON.stringify(config._decision_outputs ?? []) || nextInputs !== JSON.stringify(config._decision_inputs ?? [])) {
      onBatchUpdate({ _decision_outputs: selectedTable.outputs ?? [], _decision_inputs: selectedTable.inputs ?? [] })
    }
  }, [selectedTable, config._decision_outputs, config._decision_inputs, onBatchUpdate])

  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rounded-lg p-3" style={{ backgroundColor: 'color-mix(in srgb, var(--status-info) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--status-info) 20%, transparent)' }}>
        <p className="text-xs font-medium mb-1" style={{ color: 'var(--status-info)' }}>Decision Table</p>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          Send inputs into a business rule table and return the matched outputs to downstream workflow steps.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Business Rule</label>
        <AutocompleteSelect
          value={config.decision_table_id ?? ''}
          placeholder="Select a business rule…"
          options={(tables ?? []).map((table: any) => ({
            value: table.id,
            label: table.name,
            hint: table.description ?? undefined,
          }))}
          onChange={(nextId) => {
            const table = (tables ?? []).find((candidate: any) => candidate.id === nextId)
            // One batched write — sequential updates would spread a stale
            // config snapshot and clobber each other.
            onBatchUpdate({
              decision_table_id: nextId,
              decision_table_name: table?.name ?? '',
              _decision_inputs: table?.inputs ?? [],
              _decision_outputs: table?.outputs ?? [],
              input_mappings: {},
            })
          }}
        />
        {selectedTable?.description && (
          <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>{selectedTable.description}</p>
        )}
      </div>

      {inputDefs.length > 0 && (
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>
            Inputs ({inputDefs.length})
          </label>
          <div className="space-y-2">
            {inputDefs.map((input) => (
              <div key={input.key}>
                <div className="flex items-center gap-1 mb-0.5">
                  <code className="text-[10px] font-mono font-medium" style={{ color: 'var(--status-info)' }}>{input.key}</code>
                  {input.type && (
                    <span className="text-[8px] px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                      {input.type}
                    </span>
                  )}
                </div>
                <VariableInput
                  value={inputMappings[input.key] ?? ''}
                  onChange={(value) => onUpdate('input_mappings', { ...inputMappings, [input.key]: value })}
                  placeholder={input.label || `{{${input.key}}}`}
                  extraVariables={extraVariables}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {outputDefs.length > 0 && (
        <div className="rounded-lg p-2 text-[9px] space-y-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
          <p className="font-semibold">Outputs</p>
          <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{matched}}'}</code> — true if a rule matched</p>
          <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{outputs}}'}</code> — object containing all returned outputs</p>
          {outputDefs.map((output) => (
            <p key={output.key}>
              <code style={{ color: 'var(--theme-primary-text)' }}>{`{{${output.key}}}`}</code> — {output.label || output.key}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── User Task Config ───
function UserTaskConfig({ config, onUpdate, onBatchUpdate, extraVariables, emailTemplates, formSection }: {
  /** The Form section (designer, saved forms) — components/forms/node-form-section. */
  formSection: React.ReactNode
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables: { name: string; group: string }[]
  emailTemplates: Array<{ id: string; name: string; subject: string }>
}) {
  const { data: users } = useUserOptions('all-users')
  const { data: teams } = useTeamOptions('all-teams')

  const reminders = (config.reminders ?? []) as { offset_minutes: number }[]
  const escalation = config.escalation as { type: string; user_id?: string; team_id?: string; after_minutes: number } | undefined

  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rounded-lg p-3" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--theme-primary) 20%, transparent)' }}>
        <p className="text-xs font-medium mb-1" style={{ color: 'var(--theme-primary-text)' }}>User Task</p>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          Creates a task assigned to a person or team. The workflow pauses until the task is actioned.
        </p>
      </div>

      {/* Title */}
      <div>
        <label className="block text-xs font-medium mb-1">Task Title</label>
        <VariableInput value={config.task_title ?? ''} onChange={v => onUpdate('task_title', v)}
          placeholder="e.g. Review {{task.title}}" extraVariables={extraVariables} />
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-medium mb-1">Instructions</label>
        <VariableInput multiline rows={2} value={config.task_description ?? ''} onChange={(value) => onUpdate('task_description', value)}
          placeholder="Describe what the assignee needs to do..." extraVariables={extraVariables} />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Assignment notification template</label>
        <select value={config.notification_template_id ?? ''} onChange={e => onUpdate('notification_template_id', e.target.value || undefined)} className="w-full rounded-md border px-3 py-2 text-xs" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
          <option value="">Default task notification</option>
          {emailTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <p className="mt-1 text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>Uses the template subject and plain-text body for the assignee’s in-app notification.</p>
      </div>

      {/* Priority */}
      <div>
        <label className="block text-xs font-medium mb-1">Priority</label>
        <select value={config.task_priority ?? 'medium'} onChange={e => onUpdate('task_priority', e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-xs"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      {/* ─── Assignment ─── */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>Assignment</label>
        <div className="flex gap-0.5 mb-2">
          {[
            { val: 'individual', label: 'Individual' },
            { val: 'team', label: 'Team' },
            { val: 'aad_group', label: 'AAD Group' },
          ].map(o => (
            <button key={o.val} type="button"
              onClick={() => onUpdate('assignment_type', o.val)}
              disabled={o.val === 'aad_group'}
              className="flex-1 text-[9px] font-medium py-1.5 rounded transition-colors disabled:opacity-30"
              style={{
                backgroundColor: (config.assignment_type ?? 'individual') === o.val ? 'var(--theme-primary)' : 'var(--theme-surface)',
                color: (config.assignment_type ?? 'individual') === o.val ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
              }}>
              {o.label}{o.val === 'aad_group' ? ' (soon)' : ''}
            </button>
          ))}
        </div>

        {(config.assignment_type ?? 'individual') === 'individual' && (
          <UserSearchPicker
            users={users ?? []}
            selectedId={config.assignee_id ?? ''}
            onSelect={(id, name) => onBatchUpdate({ assignee_id: id, assignee_name: name })}
          />
        )}

        {config.assignment_type === 'team' && (
          <AutocompleteSelect
            value={config.team_id ?? ''}
            placeholder="Select a team..."
            options={(teams ?? []).map((t: any) => ({ value: t.id, label: t.name }))}
            onChange={(value) => onUpdate('team_id', value)}
          />
        )}

        <div className="mt-1">
          <label className="text-[9px] block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Or use a variable:</label>
          <VariableInput value={config.assignee_variable ?? ''} onChange={v => onUpdate('assignee_variable', v)}
            placeholder="{{task.assignee_id}}" extraVariables={extraVariables} />
        </div>
      </div>

      {/* ─── Redirect / Invite ─── */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>Task Routing</label>
        <div className="space-y-2 rounded-lg p-2.5" style={{ backgroundColor: 'var(--theme-surface)' }}>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!config.allow_redirect}
              onChange={e => {
                const checked = e.target.checked
                onBatchUpdate({
                  allow_redirect: checked,
                  allow_invite_on_redirect: checked ? !!config.allow_invite_on_redirect : false,
                })
              }}
              className="rounded mt-0.5"
            />
            <span>
              <span className="block text-xs" style={{ color: 'var(--theme-card-text)' }}>Allow assignee to redirect task</span>
              <span className="block text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                Show redirect controls on the task so the current assignee can send it to another user.
              </span>
            </span>
          </label>

          <div className={`ml-5 ${config.allow_redirect ? '' : 'opacity-60'}`}>
            <label className="text-[9px] font-medium block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Redirect to</label>
            <select
              value={config.redirect_assignment_mode ?? 'single'}
              disabled={!config.allow_redirect}
              onChange={e => onUpdate('redirect_assignment_mode', e.target.value)}
              className="w-full rounded-md border px-2 py-1 text-xs"
              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
            >
              <option value="single">1 person</option>
              <option value="many">Many people</option>
            </select>
            <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
              {config.redirect_assignment_mode === 'many'
                ? 'Redirecting will create a collaborative task for multiple assignees.'
                : 'Redirecting will move the task to a single assignee.'}
            </p>

            {config.allow_redirect && config.redirect_assignment_mode === 'many' && (
              <div className="mt-2 space-y-2">
                <div>
                  <label className="text-[9px] font-medium block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Recipient limit</label>
                  <select
                    value={config.redirect_recipient_limit_mode ?? 'unlimited'}
                    onChange={e => onUpdate('redirect_recipient_limit_mode', e.target.value)}
                    className="w-full rounded-md border px-2 py-1 text-xs"
                    style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                  >
                    <option value="unlimited">Unlimited</option>
                    <option value="capped">Up to a number</option>
                  </select>
                </div>

                {(config.redirect_recipient_limit_mode ?? 'unlimited') === 'capped' && (
                  <div>
                    <label className="text-[9px] font-medium block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Maximum people</label>
                    <Input
                      type="number"
                      min={1}
                      value={config.redirect_recipient_limit ?? 2}
                      onChange={e => onUpdate('redirect_recipient_limit', Math.max(1, Number(e.target.value) || 1))}
                      className="!text-xs !h-8"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="ml-5 space-y-2">
            <label className={`flex items-start gap-2 ${config.allow_redirect ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
              <input
                type="checkbox"
                checked={!!config.allow_invite_on_redirect}
                disabled={!config.allow_redirect}
                onChange={e => onUpdate('allow_invite_on_redirect', e.target.checked)}
                className="rounded mt-0.5"
              />
              <span>
                <span className="block text-xs" style={{ color: 'var(--theme-card-text)' }}>Allow invite by email</span>
                <span className="block text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                  If the redirect target is not already in the organisation, send them an invitation instead.
                </span>
              </span>
            </label>

            {!config.allow_redirect && (
              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                Enable redirect first to allow invite-by-email.
              </p>
            )}

            {config.allow_redirect && config.allow_invite_on_redirect && (
              <div>
                <label className="text-[9px] font-medium block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Invite role</label>
                <select
                  value={config.redirect_invite_role ?? 'viewer'}
                  onChange={e => onUpdate('redirect_invite_role', e.target.value)}
                  className="w-full rounded-md border px-2 py-1 text-xs"
                  style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                >
                  <option value="viewer">Viewer</option>
                  <option value="member">Member</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Due Date ─── */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>Due Date</label>
        <div className="flex gap-0.5 mb-2">
          {[
            { val: 'absolute', label: 'Fixed date' },
            { val: 'relative', label: 'Relative' },
            { val: 'none', label: 'No due date' },
          ].map(o => (
            <button key={o.val} type="button"
              onClick={() => onUpdate('due_date_mode', o.val)}
              className="flex-1 text-[9px] font-medium py-1.5 rounded transition-colors"
              style={{
                backgroundColor: (config.due_date_mode ?? 'relative') === o.val ? 'var(--theme-primary)' : 'var(--theme-surface)',
                color: (config.due_date_mode ?? 'relative') === o.val ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
              }}>
              {o.label}
            </button>
          ))}
        </div>

        {config.due_date_mode === 'absolute' && (
          <VariableInput value={config.due_date ?? ''} onChange={v => onUpdate('due_date', v)}
            placeholder="2024-12-31 or {{variable}}" extraVariables={extraVariables} />
        )}
        {(config.due_date_mode ?? 'relative') === 'relative' && (
          <div className="flex gap-2">
            <Input type="number" value={config.due_offset_amount ?? 3}
              onChange={e => onUpdate('due_offset_amount', Number(e.target.value))}
              className="!text-xs !h-7 w-20" min={1} />
            <select value={config.due_offset_unit ?? 'days'}
              onChange={e => onUpdate('due_offset_unit', e.target.value)}
              className="flex-1 rounded-md border px-2 py-1 text-xs"
              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
              <option value="weeks">Weeks</option>
            </select>
            <span className="text-[10px] self-center" style={{ color: 'var(--theme-muted-text)' }}>after creation</span>
          </div>
        )}
      </div>

      {/* ─── Reminders ─── */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>Reminders</label>
        <div className="space-y-1.5">
          {reminders.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input type="number" value={r.offset_minutes / 60} className="!text-xs !h-6 w-16"
                onChange={e => {
                  const updated = [...reminders]
                  updated[i] = { offset_minutes: Number(e.target.value) * 60 }
                  onUpdate('reminders', updated)
                }} />
              <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>hours before due</span>
              <button onClick={() => onUpdate('reminders', reminders.filter((_, j) => j !== i))}
                className="text-[10px] hover:text-[color:var(--theme-danger)]" style={{ color: 'var(--theme-muted-text)' }}>
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" className="w-full mt-1 !text-[10px] !h-6"
          onClick={() => onUpdate('reminders', [...reminders, { offset_minutes: 1440 }])}>
          <Plus size={10} className="mr-1" /> Add Reminder
        </Button>
      </div>

      {/* ─── Escalation ─── */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>Escalation</label>
        <label className="flex items-center gap-2 cursor-pointer mb-2">
          <input type="checkbox" checked={!!config.escalation_enabled} onChange={e => onUpdate('escalation_enabled', e.target.checked)}
            className="rounded" />
          <span className="text-xs" style={{ color: 'var(--theme-card-text)' }}>Escalate if not actioned by due date</span>
        </label>
        {config.escalation_enabled && (
          <div className="space-y-2 rounded-lg p-2.5" style={{ backgroundColor: 'var(--theme-surface)' }}>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[9px] font-medium block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Escalate after</label>
                <div className="flex gap-1">
                  <Input type="number" value={config.escalate_after_minutes ?? 60}
                    onChange={e => onUpdate('escalate_after_minutes', Number(e.target.value))}
                    className="!text-xs !h-6 w-14" min={0} />
                  <span className="text-[10px] self-center" style={{ color: 'var(--theme-muted-text)' }}>min past due</span>
                </div>
              </div>
            </div>
            <div>
              <label className="text-[9px] font-medium block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Escalate to</label>
              <select value={config.escalation_type ?? 'manager'}
                onChange={e => onUpdate('escalation_type', e.target.value)}
                className="w-full rounded-md border px-2 py-1 text-xs"
                style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
                <option value="manager">Assignee's Manager</option>
                <option value="individual">Specific User</option>
                <option value="team">Team</option>
              </select>
            </div>
            {config.escalation_type === 'individual' && (
              <AutocompleteSelect
                value={config.escalation_user_id ?? ''}
                placeholder="Select user..."
                options={(users ?? []).map((u: any) => ({ value: u.id, label: u.display_name, hint: u.email ?? undefined }))}
                onChange={(value) => onUpdate('escalation_user_id', value)}
              />
            )}
            {config.escalation_type === 'team' && (
              <AutocompleteSelect
                value={config.escalation_team_id ?? ''}
                placeholder="Select team..."
                options={(teams ?? []).map((t: any) => ({ value: t.id, label: t.name }))}
                onChange={(value) => onUpdate('escalation_team_id', value)}
              />
            )}
          </div>
        )}
      </div>

      {/* ─── Outcomes ─── */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>Outcomes</label>
        <p className="text-[9px] mb-2" style={{ color: 'var(--theme-muted-text)' }}>
          Define the possible outcomes. Each creates a branch port on the canvas for routing the workflow.
        </p>
        <div className="space-y-1.5">
          {((config.outcomes ?? []) as string[]).map((outcome, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: ['var(--theme-chart-1)', 'var(--theme-chart-2)', 'var(--theme-chart-3)', 'var(--theme-chart-4)', 'var(--theme-chart-5)', 'var(--theme-chart-6)', 'var(--theme-chart-7)', 'var(--theme-chart-8)'][i % 8] }} />
              <Input value={outcome}
                onChange={e => {
                  const updated = [...(config.outcomes ?? [])]
                  updated[i] = e.target.value
                  onUpdate('outcomes', updated)
                }}
                className="!text-xs !h-7 flex-1" placeholder={`Outcome ${i + 1}`} />
              {(config.outcomes ?? []).length > 1 && (
                <button onClick={() => onUpdate('outcomes', (config.outcomes ?? []).filter((_: any, j: number) => j !== i))}
                  className="p-0.5 rounded hover:text-[color:var(--theme-danger)] shrink-0" style={{ color: 'var(--theme-muted-text)' }}>
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" className="w-full mt-1.5 !text-[10px] !h-6"
          onClick={() => onUpdate('outcomes', [...(config.outcomes ?? []), `Outcome ${(config.outcomes ?? []).length + 1}`])}>
          <Plus size={10} className="mr-1" /> Add Outcome
        </Button>
      </div>

      {/* ─── Completion Rules ─── */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>Completion Rule</label>
        <p className="text-[9px] mb-2" style={{ color: 'var(--theme-muted-text)' }}>
          When multiple people are assigned, how is the task considered complete?
        </p>
        <select value={config.completion_rule ?? 'first_response'}
          onChange={e => onUpdate('completion_rule', e.target.value)}
          className="w-full rounded-md border px-3 py-2 text-xs"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
          <option value="first_response">First response (any one person)</option>
          <option value="all_complete">All must complete</option>
          <option value="consensus">Consensus (majority vote on same outcome)</option>
          <option value="unanimous">Unanimous (all must choose same outcome)</option>
          <option value="custom">Custom rule</option>
        </select>

        {config.completion_rule === 'all_complete' && (
          <p className="text-[9px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            Every assignee must action the task. The workflow resumes after the last person responds.
          </p>
        )}

        {config.completion_rule === 'consensus' && (
          <div className="mt-2 space-y-1">
            <p className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
              The outcome with the most votes wins. In a tie, the first response wins.
            </p>
            <div className="flex items-center gap-2">
              <label className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Min. responses required:</label>
              <Input type="number" value={config.min_responses ?? 2}
                onChange={e => onUpdate('min_responses', Number(e.target.value))}
                className="!text-xs !h-6 w-14" min={1} />
            </div>
          </div>
        )}

        {config.completion_rule === 'unanimous' && (
          <p className="text-[9px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            All assignees must choose the same outcome. If they disagree, the task remains open.
          </p>
        )}

        {config.completion_rule === 'custom' && (
          <div className="mt-2 space-y-2">
            <p className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
              Define a custom completion condition using expressions.
            </p>
            <div>
              <label className="text-[10px] font-medium block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Complete when</label>
              <VariableInput value={config.custom_rule_expression ?? ''}
                onChange={v => onUpdate('custom_rule_expression', v)}
                placeholder='e.g. {{=AND(response_count >= 3, outcome_approve_count >= 2)}}'
                extraVariables={[
                  ...extraVariables,
                  { name: 'response_count', group: 'Task Rule' },
                  { name: 'assignee_count', group: 'Task Rule' },
                  { name: 'outcome_counts', group: 'Task Rule' },
                ]} />
            </div>
            <div>
              <label className="text-[10px] font-medium block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Winning outcome</label>
              <VariableInput value={config.custom_rule_outcome ?? ''}
                onChange={v => onUpdate('custom_rule_outcome', v)}
                placeholder='e.g. {{=IF(outcome_approve_count > outcome_reject_count, "Approved", "Rejected")}}'
                extraVariables={extraVariables} />
            </div>
          </div>
        )}
      </div>

      {/* ─── Form (fields, grid layout, theme) ─── */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>Form (optional)</label>
        {formSection}
      </div>

      {/* ─── External form ─── */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--theme-muted-text)' }}>External form (optional)</label>
        <div className="flex gap-0.5 mb-2">
          {[
            { val: 'none', label: 'None' },
            { val: 'url', label: 'Custom URL' },
          ].map(o => (
            <button key={o.val} type="button"
              onClick={() => onUpdate('form_type', o.val)}
              className="flex-1 text-[9px] font-medium py-1.5 rounded transition-colors"
              style={{
                backgroundColor: (config.form_type === 'url' ? 'url' : 'none') === o.val ? 'var(--theme-primary)' : 'var(--theme-surface)',
                color: (config.form_type === 'url' ? 'url' : 'none') === o.val ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
              }}>
              {o.label}
            </button>
          ))}
        </div>
        {config.form_type === 'url' && (
          <div className="space-y-1.5">
            <div>
              <label className="text-[9px] font-medium block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Form URL</label>
              <VariableInput value={config.form_url ?? ''} onChange={v => onUpdate('form_url', v)}
                placeholder="https://forms.example.com/review?task_id={{user_task_id}}" extraVariables={extraVariables} />
            </div>
            <div className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
              Variables available in URL: <code style={{ color: 'var(--theme-primary-text)' }}>{'{{user_task_id}}'}</code>, <code style={{ color: 'var(--theme-primary-text)' }}>{'{{event_id}}'}</code>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg p-2 text-[9px] space-y-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
        <p className="font-semibold">Workflow pauses until the task is actioned.</p>
        <p>Return variables: <code style={{ color: 'var(--theme-primary-text)' }}>{'{{outcome}}'}</code>, <code style={{ color: 'var(--theme-primary-text)' }}>{'{{outcome_notes}}'}</code>, <code style={{ color: 'var(--theme-primary-text)' }}>{'{{actioned_by}}'}</code>, <code style={{ color: 'var(--theme-primary-text)' }}>{'{{task_data.<key>}}'}</code></p>
        {(config.outcomes ?? []).length > 0 && (
          <p>The workflow routes to the branch matching the outcome. Connect each outcome port below.</p>
        )}
      </div>
    </div>
  )
}

// ─── User Search Picker ───
function UserSearchPicker({ users, selectedId, onSelect }: {
  users: { id: string; display_name: string; email: string }[]
  selectedId: string
  onSelect: (id: string, name: string) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const selected = users.find(u => u.id === selectedId)

  const filtered = search.trim()
    ? users.filter(u =>
        u.display_name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())
      ).slice(0, 20)
    : users.slice(0, 20)

  if (selectedId && selected && !open) {
    return (
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs cursor-pointer hover:opacity-80"
        style={{ borderColor: 'var(--theme-primary)', backgroundColor: 'var(--theme-primary-light)' }}
        onClick={() => setOpen(true)}>
        <span className="flex-1" style={{ color: 'var(--theme-primary-text)' }}>
          {selected.display_name} <span style={{ color: 'var(--theme-muted-text)' }}>({selected.email})</span>
        </span>
        <button onClick={(e) => { e.stopPropagation(); onSelect('', '') }}
          className="text-[9px] underline" style={{ color: 'var(--theme-muted-text)' }}>Clear</button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        value={search}
        onChange={e => { setSearch(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Search by name or email..."
        className="w-full rounded-md border px-3 py-2 text-xs outline-none"
        style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
      />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-40 overflow-y-auto rounded-lg border shadow-lg"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
          {filtered.map(u => (
            <button key={u.id} type="button"
              className="flex items-center w-full px-3 py-2 text-xs text-left hover:opacity-80"
              style={{ backgroundColor: u.id === selectedId ? 'var(--theme-primary-light)' : 'var(--theme-card-bg)' }}
              onClick={() => { onSelect(u.id, u.display_name); setSearch(''); setOpen(false) }}>
              <span className="flex-1 truncate">{u.display_name}</span>
              <span className="text-[10px] ml-2 truncate" style={{ color: 'var(--theme-muted-text)' }}>{u.email}</span>
            </button>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && search.trim() && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border px-3 py-2 text-xs"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}>
          No users matching "{search}"
        </div>
      )}
    </div>
  )
}

function SearchableEntityPicker({
  items,
  selectedId,
  placeholder,
  emptyLabel,
  onSelect,
  fallbackName,
  loading = false,
}: {
  items: { id: string; name: string; subtitle?: string; archived?: boolean }[]
  selectedId: string
  placeholder: string
  emptyLabel: string
  onSelect: (id: string, name: string) => void
  /** Shown for a bound id that is not in `items` (loading, deleted, out of scope). */
  fallbackName?: string
  loading?: boolean
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const selected = resolvePickerSelection(items, selectedId, { fallbackName, loading })

  const filtered = search.trim()
    ? items.filter((item) =>
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        (item.subtitle ?? '').toLowerCase().includes(search.toLowerCase()),
      ).slice(0, 40)
    : items.slice(0, 40)

  if (selectedId && selected && !open) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs cursor-pointer hover:opacity-80"
        style={{ borderColor: selected.missing ? 'var(--theme-warning)' : 'var(--theme-primary)', backgroundColor: 'var(--theme-primary-light)' }}
        onClick={() => setOpen(true)}
        data-picker-selected={selected.id}
        data-picker-missing={selected.missing ? '' : undefined}
        title={selected.missing ? 'This record no longer exists or is not visible to you' : undefined}
      >
        <span className="flex-1 min-w-0" style={{ color: 'var(--theme-primary-text)' }}>
          <span className="truncate block">{selected.name}</span>
          {selected.subtitle && (
            <span className="truncate block text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
              {selected.subtitle}
            </span>
          )}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onSelect('', '') }}
          className="text-[9px] underline"
          style={{ color: 'var(--theme-muted-text)' }}
        >
          Clear
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-md border px-3 py-2 text-xs outline-none"
        style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
      />
      {open && filtered.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 max-h-52 overflow-y-auto rounded-lg border shadow-lg"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
        >
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex items-start w-full px-3 py-2 text-xs text-left hover:opacity-80"
              style={{ backgroundColor: item.id === selectedId ? 'var(--theme-primary-light)' : 'var(--theme-card-bg)' }}
              onClick={() => { onSelect(item.id, item.name); setSearch(''); setOpen(false) }}
            >
              <span className="flex-1 min-w-0">
                <span className="truncate block" style={{ color: 'var(--theme-card-text)' }}>
                  {item.name}{item.archived ? ' (archived)' : ''}
                </span>
                {item.subtitle && (
                  <span className="truncate block text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                    {item.subtitle}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border px-3 py-2 text-xs"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}
        >
          {emptyLabel}
        </div>
      )}
    </div>
  )
}

// ─── Governance Role Assignment Config ───
function GovernanceRoleAssignmentConfig({
  action,
  config,
  onUpdate,
  onBatchUpdate,
  extraVariables,
}: {
  action: 'add_user_to_role' | 'remove_user_from_role'
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables: { name: string; group: string }[]
}) {
  const { data: users } = useUserOptions('workflow-governance-users')
  const { data: roles } = useRoleOptions('workflow-governance-roles')

  const roleMode = config.role_mode ?? (config.role_name && !config.role_id ? 'name' : 'id')
  const actionLabel = action === 'add_user_to_role' ? 'Add User To Role' : 'Remove User From Role'
  const actionColor = action === 'add_user_to_role' ? 'var(--status-info)' : 'var(--theme-danger)'
  const outputPrefix = action === 'add_user_to_role' ? 'governance_role_added' : 'governance_role_removed'

  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rounded-lg p-3" style={{ backgroundColor: `color-mix(in srgb, ${actionColor} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${actionColor} 20%, transparent)` }}>
        <p className="text-xs font-medium mb-1" style={{ color: actionColor }}>{actionLabel}</p>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          Manage governance role membership inside the workflow with tenant-safe validation, deduping, and audit logging.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">User</label>
        <UserSearchPicker
          users={users ?? []}
          selectedId={config.user_id ?? ''}
          onSelect={(id, name) => onBatchUpdate({ user_id: id, user_label: name })}
        />
        <div className="mt-1.5">
          <label className="text-[9px] block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Or use a variable</label>
          <VariableInput
            value={config.user_id ?? ''}
            onChange={(value) => onBatchUpdate({ user_id: value, user_label: '' })}
            placeholder="{{user_id}}"
            extraVariables={extraVariables}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Role Match</label>
        <div className="flex gap-0.5 mb-2">
          {[
            { value: 'id', label: 'Select role' },
            { value: 'name', label: 'Role name / slug' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onBatchUpdate({
                role_mode: option.value,
                role_id: option.value === 'id' ? config.role_id ?? '' : '',
                role_name: option.value === 'name' ? config.role_name ?? '' : '',
                role_label: option.value === 'name' ? config.role_label ?? config.role_name ?? '' : config.role_label ?? '',
              })}
              className="flex-1 text-[9px] font-medium py-1.5 rounded transition-colors"
              style={{
                backgroundColor: roleMode === option.value ? 'var(--theme-primary)' : 'var(--theme-surface)',
                color: roleMode === option.value ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        {roleMode === 'id' ? (
          <>
            <AutocompleteSelect
              value={config.role_id ?? ''}
              placeholder="Select a role..."
              options={(roles ?? []).map((role: any) => ({
                value: role.id,
                label: role.name,
                hint: role.is_system ? 'system' : undefined,
              }))}
              onChange={(nextId) => {
                const role = (roles ?? []).find((item: any) => item.id === nextId)
                // One batched write — sequential updates would clobber each other.
                onBatchUpdate({
                  role_id: nextId,
                  role_name: '',
                  role_label: role?.name ?? '',
                })
              }}
            />
            <p className="text-[9px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
              Best for fixed workflows where the target role is known up front.
            </p>
          </>
        ) : (
          <>
            <VariableInput
              value={config.role_name ?? ''}
              onChange={(value) => onBatchUpdate({ role_name: value, role_id: '', role_label: value.includes('{{') ? '' : value })}
              placeholder="Admin or {{role_name}}"
              extraVariables={extraVariables}
            />
            <p className="text-[9px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
              Matches by role name or slug inside the current tenant.
            </p>
          </>
        )}
      </div>

      <div className="rounded-lg p-2 text-[9px] space-y-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
        <p className="font-semibold">Outputs</p>
        <p><code style={{ color: 'var(--theme-primary-text)' }}>{`{{${outputPrefix}_success}}`}</code> — true when the action completes</p>
        <p><code style={{ color: 'var(--theme-primary-text)' }}>{`{{${outputPrefix}_action}}`}</code> — added, removed, already_assigned, or already_removed</p>
        <p><code style={{ color: 'var(--theme-primary-text)' }}>{`{{${outputPrefix}_role_id}}`}</code> and <code style={{ color: 'var(--theme-primary-text)' }}>{`{{${outputPrefix}_user_id}}`}</code> — resolved identifiers</p>
      </div>
    </div>
  )
}

// ─── Permission Check Config ───
function PermissionCheckConfig({
  config,
  onUpdate,
  onBatchUpdate,
  extraVariables,
}: {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables: { name: string; group: string }[]
}) {
  const { data: users } = useUserOptions('workflow-governance-users')

  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rounded-lg p-3" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-chart-6) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--theme-chart-6) 20%, transparent)' }}>
        <p className="text-xs font-medium mb-1" style={{ color: 'var(--theme-chart-6-text)' }}>Check Permission</p>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          Resolve the user’s effective permissions from their roles and branch the workflow based on the result.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">User</label>
        <UserSearchPicker
          users={users ?? []}
          selectedId={config.user_id ?? ''}
          onSelect={(id, name) => onBatchUpdate({ user_id: id, user_label: name })}
        />
        <div className="mt-1.5">
          <label className="text-[9px] block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Or use a variable</label>
          <VariableInput
            value={config.user_id ?? ''}
            onChange={(value) => onBatchUpdate({ user_id: value, user_label: '' })}
            placeholder="{{user_id}}"
            extraVariables={extraVariables}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Permission</label>
        <AutocompleteSelect
          value={config.permission ?? ''}
          placeholder="Select a permission..."
          options={PERMISSION_KEYS.map((permission) => ({ value: permission, label: permission }))}
          onChange={(value) => onUpdate('permission', value)}
        />
      </div>

      <div className="rounded-lg p-2 text-[9px] space-y-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
        <p className="font-semibold">Outputs</p>
        <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{has_permission}}'}</code> — true or false</p>
        <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{permissions}}'}</code> — full effective permission list for the user</p>
      </div>
    </div>
  )
}

function RetentionPoliciesWorkflowConfig({
  config,
  onUpdate,
  onBatchUpdate,
  extraVariables,
}: {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables: { name: string; group: string }[]
}) {
  const operation = String(config.operation ?? 'list_policies')

  const { data: policies } = useRetentionPolicyOptions(
    'workflow-retention-policies',
    'id, name, description, policy_mode, duration_value, duration_unit, exact_date, applies_to',
  )

  const { data: tables } = useQuery({
    queryKey: ['workflow-retention-data-tables'],
    queryFn: async () => (await serverRead('automations.tableOptions', { limit: 200 })).data ?? [],
    staleTime: 60_000,
    ...PANEL_QUERY_DEFAULTS,
  })

  const { data: tableRows } = useQuery({
    queryKey: ['workflow-retention-data-rows', config.table_id],
    queryFn: async () => {
      if (!config.table_id) return []
      return (await serverRead('automations.tableRows', { tableId: config.table_id, limit: 100 })).data ?? []
    },
    enabled: !!config.table_id && config.target_type === 'data_row',
    staleTime: 30_000,
    ...PANEL_QUERY_DEFAULTS,
  })

  const rowVariables = useMemo(() => {
    const rowVars: { name: string; group: string; label?: string }[] = []
    for (const row of (tableRows ?? []) as any[]) {
      const data = row?.data && typeof row.data === 'object' ? row.data : {}
      const firstValue = Object.values(data).find((value) => value != null && String(value).trim() !== '')
      rowVars.push({
        name: row.id,
        group: `Rows in ${config.table_name || 'table'}`,
        label: firstValue ? `${String(firstValue).slice(0, 30)} — ${String(row.id).slice(0, 8)}` : String(row.id).slice(0, 8),
      })
    }
    return [...rowVars, ...extraVariables]
  }, [config.table_name, extraVariables, tableRows])

  const selectedTargetType = String(config.target_type ?? 'data_table')
  const selectablePolicies = (policies ?? []).filter((policy: any) => {
    const appliesTo = Array.isArray(policy.applies_to) ? policy.applies_to : []
    if (selectedTargetType === 'data_table') return appliesTo.includes('data_tables')
    if (selectedTargetType === 'data_row') return appliesTo.includes('data_rows')
    return true
  })

  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--theme-surface)' }}>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          Manage retention policies from workflows. You can create or delete policies, inspect what assets are assigned to a policy, or apply a policy to a table or row.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Operation</label>
        <div className="grid grid-cols-2 gap-1">
          {[
            { value: 'list_policies', label: 'List Policies' },
            { value: 'create_policy', label: 'Create Policy' },
            { value: 'delete_policy', label: 'Delete Policy' },
            { value: 'list_assets', label: 'List Assets' },
            { value: 'assign_policy', label: 'Assign Policy' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onUpdate('operation', option.value)}
              className="rounded-lg border px-2 py-1.5 text-[10px] font-medium transition-colors"
              style={{
                backgroundColor: operation === option.value ? 'var(--theme-primary)' : 'var(--theme-surface)',
                color: operation === option.value ? 'var(--theme-on-primary)' : 'var(--theme-card-text)',
                borderColor: operation === option.value ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {operation === 'list_policies' && (
        <>
          <div>
            <label className="block text-xs font-medium mb-1">Scope Filter (optional)</label>
            <select
              value={config.scope ?? ''}
              onChange={(e) => onUpdate('scope', e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-xs"
              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
            >
              <option value="">All scopes</option>
              <option value="data_tables">Data tables</option>
              <option value="data_rows">Data rows</option>
            </select>
          </div>
          <div className="rounded-lg p-2 text-[9px] space-y-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
            <p className="font-semibold">Outputs</p>
            <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{policy_count}}'}</code> — number of matching policies</p>
            <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{policies}}'}</code> — full policy list</p>
          </div>
        </>
      )}

      {operation === 'create_policy' && (
        <>
          <div>
            <label className="block text-xs font-medium mb-1">Policy Name</label>
            <VariableInput
              value={config.name ?? ''}
              onChange={(value) => onUpdate('name', value)}
              placeholder="Customer contract retention"
              extraVariables={extraVariables}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Description (optional)</label>
            <VariableInput
              value={config.description ?? ''}
              onChange={(value) => onUpdate('description', value)}
              placeholder="Review customer contracts annually"
              extraVariables={extraVariables}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Policy Mode</label>
            <select
              value={config.policy_mode ?? 'review'}
              onChange={(e) => onUpdate('policy_mode', e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-xs"
              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
            >
              <option value="review">Review after duration</option>
              <option value="review_on_exact_date">Review on exact date</option>
              <option value="purge_on">Purge after duration</option>
              <option value="purge_on_exact_date">Purge on exact date</option>
              <option value="keep_forever">Keep forever</option>
            </select>
          </div>

          {(config.policy_mode ?? 'review') === 'review_on_exact_date' || (config.policy_mode ?? 'review') === 'purge_on_exact_date' ? (
            <div>
              <label className="block text-xs font-medium mb-1">Exact Date</label>
              <VariableInput
                value={config.exact_date ?? ''}
                onChange={(value) => onUpdate('exact_date', value)}
                placeholder="2026-12-31T00:00:00.000Z"
                extraVariables={extraVariables}
              />
            </div>
          ) : (config.policy_mode ?? 'review') !== 'keep_forever' ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Duration Value</label>
                <VariableInput
                  value={config.duration_value ?? ''}
                  onChange={(value) => onUpdate('duration_value', value)}
                  placeholder="30"
                  extraVariables={extraVariables}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Duration Unit</label>
                <select
                  value={config.duration_unit ?? 'days'}
                  onChange={(e) => onUpdate('duration_unit', e.target.value)}
                  className="w-full rounded-md border px-3 py-2 text-xs"
                  style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                >
                  <option value="days">Days</option>
                  <option value="months">Months</option>
                  <option value="years">Years</option>
                </select>
              </div>
            </div>
          ) : null}

          <div>
            <label className="block text-xs font-medium mb-1">Applies To</label>
            <div className="grid grid-cols-2 gap-1">
              {[
                { value: 'data_tables', label: 'Data Tables' },
                { value: 'data_rows', label: 'Data Rows' },
              ].map((scopeOption) => {
                const selected = Array.isArray(config.applies_to) ? config.applies_to.includes(scopeOption.value) : false
                return (
                  <button
                    key={scopeOption.value}
                    type="button"
                    onClick={() => {
                      const current = Array.isArray(config.applies_to) ? config.applies_to : ['data_tables', 'data_rows']
                      const next = selected ? current.filter((item: string) => item !== scopeOption.value) : [...current, scopeOption.value]
                      onUpdate('applies_to', next)
                    }}
                    className="rounded-md border px-2 py-1.5 text-[10px] font-medium transition-colors"
                    style={{
                      backgroundColor: selected ? 'var(--theme-primary)' : 'var(--theme-surface)',
                      color: selected ? 'var(--theme-on-primary)' : 'var(--theme-card-text)',
                      borderColor: selected ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
                    }}
                  >
                    {scopeOption.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="rounded-lg p-2 text-[9px] space-y-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
            <p className="font-semibold">Outputs</p>
            <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{retention_policy_id}}'}</code> — created policy ID</p>
            <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{retention_policy_name}}'}</code> — created policy name</p>
            <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{policy}}'}</code> — created policy object</p>
          </div>
        </>
      )}

      {(operation === 'delete_policy' || operation === 'list_assets' || operation === 'assign_policy') && (
        <div>
          <label className="block text-xs font-medium mb-1">Retention Policy</label>
          <SearchableEntityPicker
            items={selectablePolicies.map((policy: any) => ({
              id: policy.id,
              name: policy.name,
              subtitle: policy.description ?? String(policy.policy_mode ?? '').replaceAll('_', ' '),
            }))}
            selectedId={config.retention_policy_id ?? ''}
            placeholder="Search retention policies..."
            emptyLabel="No retention policies found"
            onSelect={(id, name) => onBatchUpdate({ retention_policy_id: id, retention_policy_name: name })}
          />
          <div className="mt-1.5">
            <VariableInput
              value={config.retention_policy_id ?? ''}
              onChange={(value) => onBatchUpdate({ retention_policy_id: value, retention_policy_name: '' })}
              placeholder="{{retention_policy_id}}"
              extraVariables={extraVariables}
            />
          </div>
        </div>
      )}

      {operation === 'list_assets' && (
        <div className="rounded-lg p-2 text-[9px] space-y-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
          <p className="font-semibold">Outputs</p>
          <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{asset_count}}'}</code> — total assigned assets</p>
          <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{assets}}'}</code> — grouped assets by type</p>
          <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{data_tables}}'}</code>, <code style={{ color: 'var(--theme-primary-text)' }}>{'{{data_rows}}'}</code></p>
        </div>
      )}

      {operation === 'assign_policy' && (
        <>
          <div>
            <label className="block text-xs font-medium mb-1">Target Type</label>
            <div className="grid grid-cols-2 gap-1">
              {[
                { value: 'data_table', label: 'Data Table' },
                { value: 'data_row', label: 'Data Row' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onBatchUpdate({
                    target_type: option.value,
                    target_id: '',
                    table_id: option.value === 'data_row' ? config.table_id ?? '' : '',
                    table_name: option.value === 'data_row' ? config.table_name ?? '' : '',
                  })}
                  className="rounded-md border px-2 py-1.5 text-[10px] font-medium transition-colors"
                  style={{
                    backgroundColor: selectedTargetType === option.value ? 'var(--theme-primary)' : 'var(--theme-surface)',
                    color: selectedTargetType === option.value ? 'var(--theme-on-primary)' : 'var(--theme-card-text)',
                    borderColor: selectedTargetType === option.value ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {selectedTargetType === 'data_table' && (
            <div>
              <label className="block text-xs font-medium mb-1">Data Table</label>
              <SearchableEntityPicker
                items={(tables ?? []).map((table: any) => ({ id: table.id, name: table.name }))}
                selectedId={config.target_id ?? ''}
                placeholder="Search data tables..."
                emptyLabel="No data tables found"
                onSelect={(id, name) => onBatchUpdate({ target_id: id, target_name: name })}
              />
            </div>
          )}

          {selectedTargetType === 'data_row' && (
            <>
              <div>
                <label className="block text-xs font-medium mb-1">Data Table</label>
                <SearchableEntityPicker
                  items={(tables ?? []).map((table: any) => ({ id: table.id, name: table.name }))}
                  selectedId={dataTableIdOf(config)}
                  fallbackName={dataTableLabel(config, tableNamesOf(tables)) ?? undefined}
                  loading={tables === undefined}
                  placeholder="Search tables first..."
                  emptyLabel="No data tables found"
                  onSelect={(id, name) => onBatchUpdate({ table_id: id, table_name: name, target_id: '' })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Row ID</label>
                <VariableInput
                  value={config.target_id ?? ''}
                  onChange={(value) => onUpdate('target_id', value)}
                  placeholder="{{row_id}} or select from recent rows"
                  extraVariables={rowVariables}
                />
              </div>
            </>
          )}

          {!['data_row'].includes(selectedTargetType) && (
            <div className="mt-1.5">
              <label className="text-[9px] block mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Or use a variable</label>
              <VariableInput
                value={config.target_id ?? ''}
                onChange={(value) => onUpdate('target_id', value)}
                placeholder="{{target_id}}"
                extraVariables={extraVariables}
              />
            </div>
          )}

          <div className="rounded-lg p-2 text-[9px] space-y-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
            <p className="font-semibold">Outputs</p>
            <p><code style={{ color: 'var(--theme-primary-text)' }}>{'{{target_type}}'}</code>, <code style={{ color: 'var(--theme-primary-text)' }}>{'{{target_id}}'}</code>, <code style={{ color: 'var(--theme-primary-text)' }}>{'{{retention_policy_id}}'}</code></p>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Row lookup for update_data_table get/update/delete: by explicit Row ID
 * (config.row_id) or by matching a column's value (config.row_match_field +
 * config.row_match_value — canonical keys the engine reads; match_column /
 * match_value are legacy aliases). Switching modes batch-clears the other
 * mode's keys so both can never be set at once.
 */
function RowLookupFields({
  config, onUpdate, onBatchUpdate, verb, tableColumns, rowIdVariables,
}: {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  verb: string
  tableColumns: { key: string; label: string; type: string }[]
  rowIdVariables: { name: string; group: string }[]
}) {
  const matchMode = config.row_match_field !== undefined && config.row_match_field !== null ? 'column' : 'row_id'
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium">Find row by</label>
      <div className="flex gap-0.5">
        {[
          { value: 'row_id', label: 'Row ID' },
          { value: 'column', label: 'Column match' },
        ].map((mode) => (
          <button
            key={mode.value}
            type="button"
            onClick={() => onBatchUpdate(mode.value === 'row_id'
              ? { row_match_field: undefined, row_match_value: undefined, match_column: undefined, match_value: undefined }
              : { row_id: undefined, row_match_field: config.row_match_field ?? '', row_match_value: config.row_match_value ?? '' })}
            className="flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors"
            style={{
              backgroundColor: matchMode === mode.value ? 'var(--theme-primary)' : 'var(--theme-surface)',
              color: matchMode === mode.value ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
            }}
          >
            {mode.label}
          </button>
        ))}
      </div>
      {matchMode === 'row_id' ? (
        <>
          <VariableInput
            value={config.row_id ?? ''}
            onChange={(v) => onUpdate('row_id', v)}
            placeholder="{{row_id}} or specific ID"
            extraVariables={rowIdVariables}
          />
          <p className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
            The unique row ID to {verb}. Use {'{{row_id}}'} from a previous list or insert.
          </p>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <AutocompleteSelect
              value={config.row_match_field ?? ''}
              placeholder="Column..."
              options={tableColumns.map((col) => ({ value: col.key, label: col.label || col.key }))}
              onChange={(value) => onUpdate('row_match_field', value)}
            />
            <VariableInput
              value={config.row_match_value ?? ''}
              onChange={(v) => onUpdate('row_match_value', v)}
              placeholder="Value or {{variable}}"
              extraVariables={rowIdVariables}
            />
          </div>
          <p className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
            The first row whose column equals this value is the one to {verb}.
          </p>
        </>
      )}
    </div>
  )
}

function CustomWorkflowActivityConfig({ node, activities, onUpdate, onBatchUpdate, extraVariables }: {
  node: WorkflowNode
  activities: any[]
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables: { name: string; group: string }[]
}) {
  const [simpleMode, setSimpleMode] = useState(true)
  const activityId = node.config.custom_activity_id ?? ''
  const selectedActivity = activities.find((item) => item.id === activityId)
  const manifest = selectedActivity?.manifest ?? node.config.manifest ?? { inputs: [], outputs: [] }
  const inputs = getWorkflowActivityInputDefinitions(manifest)
  const outputs = getWorkflowActivityOutputDefinitions(manifest)
  const presentation = getWorkflowActivityPresentation(manifest)
  const inputMappings = (node.config.input_mappings ?? {}) as Record<string, string>
  const outputPrefix = String(
    node.config._output_prefix
      || selectedActivity?.key
      || node.config.custom_activity_key
      || 'custom_activity',
  )
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')

  function formatExampleValue(value: unknown) {
    if (value === undefined || value === null || value === '') return null
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  const configuredRequiredInputs = inputs.filter((input) => {
    if (!input.required) return false
    const value = String(inputMappings[input.name] ?? '').trim()
    return value.length > 0
  }).length
  const requiredInputCount = inputs.filter((input) => input.required).length
  const configuredOptionalInputs = inputs.filter((input) => {
    if (input.required) return false
    const value = String(inputMappings[input.name] ?? '').trim()
    return value.length > 0
  }).length
  const summaryInputNames = inputs.slice(0, 3).map((input) => input.label)
  const summaryOutputNames = outputs.slice(0, 3).map((output) => output.label)
  const hasAdvancedConfig = Boolean(selectedActivity)
  const manifestSummary = getWorkflowActivitySummary(manifest)
  const setupNotes = getWorkflowActivitySetupNotes(manifest)
  const displayName = getWorkflowActivityDisplayName(manifest, selectedActivity?.name ?? node.config.activity_name ?? null) ?? selectedActivity?.name ?? 'Reusable activity'

  useEffect(() => {
    setSimpleMode(true)
  }, [activityId])

  function applyActivity(activity: any) {
    const nextManifest = activity?.manifest ?? { inputs: [], outputs: [] }
    const normalizedInputs = getWorkflowActivityInputDefinitions(nextManifest)
    const defaultPrefix = activity?.key || activity?.name?.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'custom_activity'
    onBatchUpdate({
      custom_activity_id: activity.id,
      custom_activity_key: activity.key,
      activity_name: activity.name,
      activity_description: activity.description ?? '',
      activity_icon_name: activity.icon_name ?? 'Puzzle',
      activity_color: activity.color ?? '#0EA5E9',
      source_code: activity.source_code ?? '',
      manifest: nextManifest,
      demo_inputs: activity.demo_inputs ?? {},
      input_mappings: Object.fromEntries(normalizedInputs.map((input) => [input.name, ''])),
      _output_prefix: node.config._output_prefix ?? defaultPrefix,
    })
  }

  return (
    <div className="space-y-4" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--theme-surface)' }}>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          Reusable activities let you add a pre-built step to your workflow. Choose the step, fill in what it needs, and its outputs will be available for later conditions, messages, updates, and actions.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Choose Reusable Step</label>
        <AutocompleteSelect
          value={activityId}
          placeholder="Select a reusable activity..."
          options={activities.map((activity: any) => ({
            value: activity.id,
            label: activity.name,
            hint: activity.description ?? undefined,
          }))}
          onChange={(nextId) => {
            const activity = activities.find((item) => item.id === nextId)
            if (activity) applyActivity(activity)
          }}
        />
      </div>

      {selectedActivity && (
        <>
          <div className="rounded-lg border p-3 text-[10px] space-y-1" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            <p className="font-semibold" style={{ color: 'var(--theme-card-text)' }}>{selectedActivity.name}</p>
            <p style={{ color: 'var(--theme-muted-text)' }}>{selectedActivity.description || 'No description yet.'}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
              >
                Reusable activity
              </span>
              {selectedActivity.key && (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-mono"
                  style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-primary-text)' }}
                >
                  {selectedActivity.key}
                </span>
              )}
            </div>
          </div>

          {hasAdvancedConfig && (
            <div className="rounded-lg border p-3 space-y-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
              <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>
                      {simpleMode ? `${displayName} · Simple Mode` : `${displayName} · Advanced Mode`}
                    </p>
                  <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                    {simpleMode
                      ? 'Start with a plain-English overview, then expand if you need deeper control.'
                      : 'You are editing the full input and output setup for this reusable step.'}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => setSimpleMode((current) => !current)}>
                  {simpleMode ? (
                    <>
                      Show details <ChevronRight size={12} className="ml-1" />
                    </>
                  ) : (
                    <>
                      Back to simple <ChevronDown size={12} className="ml-1" />
                    </>
                  )}
                </Button>
              </div>

              <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>
                  What this step does
                </p>
                <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                  {selectedActivity.name} takes{' '}
                  <span style={{ color: 'var(--theme-card-text)' }}>
                    {inputs.length === 0 ? 'no inputs' : summaryInputNames.join(', ')}
                    {inputs.length > 3 ? ` and ${inputs.length - 3} more` : ''}
                  </span>
                  {' '}and returns{' '}
                  <span style={{ color: 'var(--theme-card-text)' }}>
                    {outputs.length === 0 ? 'no outputs' : summaryOutputNames.join(', ')}
                    {outputs.length > 3 ? ` and ${outputs.length - 3} more` : ''}
                  </span>
                  .
                </p>
                {manifestSummary && (
                  <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                    {manifestSummary}
                  </p>
                )}
                {presentation.recommendedFor && (
                  <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                    Recommended for: <span style={{ color: 'var(--theme-card-text)' }}>{presentation.recommendedFor}</span>
                  </p>
                )}

                {requiredInputCount > 0 && (
                  <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                    Required inputs ready: <span style={{ color: 'var(--theme-card-text)' }}>{configuredRequiredInputs} of {requiredInputCount}</span>
                  </p>
                )}

                {configuredOptionalInputs > 0 && (
                  <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                    Optional inputs filled: <span style={{ color: 'var(--theme-card-text)' }}>{configuredOptionalInputs}</span>
                  </p>
                )}

                <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                  Output group: <code style={{ color: 'var(--theme-primary-text)' }}>{outputPrefix}</code>
                </p>
              </div>

              {simpleMode && setupNotes.length > 0 && (
                <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
                  <p className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>
                    Setup notes
                  </p>
                  {setupNotes.map((note: string, index: number) => (
                    <p key={`${selectedActivity.id}-note-${index}`} className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                      {index + 1}. {note}
                    </p>
                  ))}
                </div>
              )}

              {simpleMode && inputs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>Quick setup</p>
                  {inputs.map((input) => {
                    const value = inputMappings[input.name] ?? ''
                    const isConfigured = String(value).trim().length > 0
                    return (
                      <div
                        key={input.name}
                        className="rounded-lg border p-2 flex items-start justify-between gap-3"
                        style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>{input.label}</p>
                            <span
                              className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                              style={{
                                backgroundColor: input.required ? 'color-mix(in srgb, var(--theme-warning) 12%, transparent)' : 'var(--theme-surface)',
                                color: input.required ? 'var(--theme-warning)' : 'var(--theme-muted-text)',
                              }}
                            >
                              {input.required ? 'Required' : 'Optional'}
                            </span>
                          </div>
                          <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                            {input.description || `Provide a ${input.type || 'value'} for this step.`}
                          </p>
                          {isConfigured && (
                            <p className="text-[10px] truncate" style={{ color: 'var(--theme-muted-text)' }}>
                              Using: <code style={{ color: 'var(--theme-primary-text)' }}>{value}</code>
                            </p>
                          )}
                        </div>
                        <span
                          className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide shrink-0"
                          style={{
                            backgroundColor: isConfigured ? 'color-mix(in srgb, var(--theme-success) 12%, transparent)' : 'var(--theme-surface)',
                            color: isConfigured ? 'var(--theme-success)' : 'var(--theme-muted-text)',
                          }}
                        >
                          {isConfigured ? 'Ready' : 'Needs value'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}

              {simpleMode && inputs.length === 0 && outputs.length === 0 && (
                <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--theme-surface)' }}>
                  <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                    This reusable step does not need any manual input and does not declare any outputs. You can keep it in simple mode unless you want to rename the output group in advanced mode.
                  </p>
                </div>
              )}
            </div>
          )}

          {!simpleMode && (
            <>
              <div>
                <label className="block text-xs font-medium mb-1">Save Outputs As</label>
                <Input
                  value={node.config._output_prefix ?? ''}
                  onChange={(e) => onUpdate('_output_prefix', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder={selectedActivity.key ?? 'custom_activity'}
                  className="!text-xs font-mono"
                />
                <p className="mt-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                  This groups the values returned by the step. Example: <code style={{ color: 'var(--theme-primary-text)' }}>{`{{${outputPrefix}_result}}`}</code>
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Timeout (ms)</label>
                <Input
                  type="number"
                  min={500}
                  max={120000}
                  step={500}
                  value={node.config.timeout_ms ?? ''}
                  onChange={(e) => onUpdate('timeout_ms', e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="10000"
                  className="!text-xs font-mono"
                />
                <p className="mt-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                  500–120,000 ms. Default 10,000. The step fails if the activity takes longer.
                </p>
              </div>

              {inputs.length > 0 && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="block text-xs font-medium">What This Step Needs</label>
                    <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                      Set a fixed value or insert a workflow variable for each input.
                    </p>
                  </div>
                  {inputs.map((input) => {
                    const name = input.name
                    const exampleValue = formatExampleValue(input.defaultValue)
                    const currentValue = inputMappings[name] ?? ''
                    const helperParts = [
                      input.type || 'string',
                      input.required ? 'required' : 'optional',
                    ]
                    if (input.description) helperParts.push(input.description)
                    return (
                      <div key={name} className="rounded-lg border p-2 space-y-1.5" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="text-xs font-medium">{input.label}</p>
                              <span
                                className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                                style={{
                                  backgroundColor: input.required ? 'color-mix(in srgb, var(--theme-warning) 12%, transparent)' : 'var(--theme-surface)',
                                  color: input.required ? 'var(--theme-warning)' : 'var(--theme-muted-text)',
                                }}
                              >
                                {input.required ? 'Required' : 'Optional'}
                              </span>
                            </div>
                            <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                              {helperParts.join(' · ')}
                            </p>
                            {exampleValue && (
                              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                                Example value: <code style={{ color: 'var(--theme-primary-text)' }}>{exampleValue}</code>
                              </p>
                            )}
                          </div>
                        </div>
                        <VariableInput
                          value={currentValue}
                          onChange={(value) => onUpdate('input_mappings', { ...inputMappings, [name]: value })}
                          placeholder={exampleValue ?? (input.required ? `{{${name}}}` : `Optional ${name}`)}
                          extraVariables={extraVariables}
                        />
                        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                          Tip: you can type <code style={{ color: 'var(--theme-primary-text)' }}>{'{{'}</code> to insert a variable from the workflow.
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}

              {outputs.length > 0 && (
                <div className="rounded-lg p-3 text-[10px] space-y-1" style={{ backgroundColor: 'var(--theme-surface)' }}>
                  <p className="font-semibold" style={{ color: 'var(--theme-card-text)' }}>What This Step Gives Back</p>
                  <p style={{ color: 'var(--theme-muted-text)' }}>
                    These outputs are added to workflow variables automatically and can be used anywhere later in the flow.
                  </p>
                  {outputs.map((output) => {
                    const name = output.name
                    return (
                      <div
                        key={name}
                        className="rounded-lg border p-2 space-y-1.5"
                        style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>{output.label}</p>
                          <span
                            className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                            style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
                          >
                            {output.type || 'string'}
                          </span>
                        </div>
                        {output.description && (
                          <p style={{ color: 'var(--theme-muted-text)' }}>{output.description}</p>
                        )}
                        <p style={{ color: 'var(--theme-muted-text)' }}>
                          Grouped: <code style={{ color: 'var(--theme-primary-text)' }}>{`{{${outputPrefix}_${name}}}`}</code>
                        </p>
                        <p style={{ color: 'var(--theme-muted-text)' }}>
                          Direct: <code style={{ color: 'var(--theme-primary-text)' }}>{`{{${name}}}`}</code>
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function WorkflowErrorTriggerConfig({ config, onUpdate }: {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
}) {
  const scope = config.error_scope === 'specific' ? 'specific' : 'all'
  const selectedWorkflowIds = Array.isArray(config.workflow_ids)
    ? (config.workflow_ids as string[]).filter(Boolean)
    : config.workflow_id
      ? [String(config.workflow_id)]
      : []

  const { data: workflows } = useQuery({
    queryKey: ['workflow-error-trigger-sources'],
    queryFn: async () => (await serverRead('automations.triggerSourceWorkflows', { exclude: 'workflow_error' })).data ?? [],
    staleTime: 60_000,
    ...PANEL_QUERY_DEFAULTS,
  })

  return (
    <div className="space-y-4">
      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--theme-surface)' }}>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          This trigger runs when another workflow fails. Use it for fallback handling, notifications, or automated recovery. Error details are available as {'{{error_message}}'}, {'{{error_workflow_name}}'}, {'{{error_node}}'}, and {'{{error_run_id}}'}.
        </p>
      </div>

      <div onPointerDown={(e) => e.stopPropagation()}>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
          Source Workflow Scope
        </label>
        <select
          value={scope}
          onChange={(e) => {
            const nextScope = e.target.value === 'specific' ? 'specific' : 'all'
            onUpdate('error_scope', nextScope)
            if (nextScope === 'all') {
              onUpdate('workflow_ids', [])
              onUpdate('workflow_id', null)
            }
          }}
          className="w-full rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-surface-border)',
            color: 'var(--theme-card-text)',
          }}
        >
          <option value="all">All workflows</option>
          <option value="specific">Only selected workflows</option>
        </select>
      </div>

      {scope === 'specific' && (
        <div onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
            Failed Workflow Filters
          </label>
          <div className="max-h-56 overflow-auto rounded-lg border p-2 space-y-1.5" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            {(workflows ?? []).length === 0 ? (
              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                No source workflows found yet.
              </p>
            ) : (
              (workflows ?? []).map((workflow: any) => (
                <label key={workflow.id} className="flex items-start gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:opacity-90">
                  <input
                    type="checkbox"
                    checked={selectedWorkflowIds.includes(workflow.id)}
                    onChange={(e) => {
                      const nextIds = e.target.checked
                        ? [...selectedWorkflowIds, workflow.id]
                        : selectedWorkflowIds.filter((id) => id !== workflow.id)
                      onUpdate('workflow_ids', nextIds)
                      onUpdate('workflow_id', nextIds[0] ?? null)
                    }}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>
                      {workflow.name}
                    </span>
                    <span className="block text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                      {workflow.trigger_type?.replaceAll('_', ' ') ?? 'workflow'} {workflow.is_active ? '· active' : '· inactive'}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
          <p className="mt-1 text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
            Select one or more source workflows to narrow this error handler.
          </p>
        </div>
      )}
    </div>
  )
}

function WorkflowSlaTriggerConfig({ config, onUpdate }: {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
}) {
  const scope = config.workflow_scope === 'specific' ? 'specific' : 'all'
  const selectedWorkflowIds = Array.isArray(config.workflow_ids)
    ? (config.workflow_ids as string[]).filter(Boolean)
    : config.workflow_id
      ? [String(config.workflow_id)]
      : []
  const selectedEventTypes = Array.isArray(config.event_types) && config.event_types.length > 0
    ? config.event_types
    : ['warning', 'breached']

  const { data: workflows } = useQuery({
    queryKey: ['workflow-sla-trigger-sources'],
    queryFn: async () => (await serverRead('automations.triggerSourceWorkflows', { exclude: 'workflow_sla' })).data ?? [],
    staleTime: 60_000,
    ...PANEL_QUERY_DEFAULTS,
  })

  function toggleEventType(eventType: 'warning' | 'breached') {
    const next = selectedEventTypes.includes(eventType)
      ? selectedEventTypes.filter((value: string) => value !== eventType)
      : [...selectedEventTypes, eventType]
    onUpdate('event_types', next.length > 0 ? next : [eventType])
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--theme-surface)' }}>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          This trigger runs when another workflow SLA is approaching or breached. SLA details are available as {'{{workflow_sla_label}}'}, {'{{workflow_sla_due_at}}'}, {'{{workflow_sla_status}}'}, {'{{workflow_sla_event}}'}, {'{{workflow_sla_workflow_name}}'}, and {'{{workflow_sla_run_id}}'}.
        </p>
      </div>

      <div onPointerDown={(e) => e.stopPropagation()}>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
          Source Workflow Scope
        </label>
        <select
          value={scope}
          onChange={(e) => {
            const nextScope = e.target.value === 'specific' ? 'specific' : 'all'
            onUpdate('workflow_scope', nextScope)
            if (nextScope === 'all') {
              onUpdate('workflow_ids', [])
              onUpdate('workflow_id', null)
            }
          }}
          className="w-full rounded-lg border px-3 py-2 text-xs"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
        >
          <option value="all">All workflows</option>
          <option value="specific">Only selected workflows</option>
        </select>
      </div>

      {scope === 'specific' && (
        <div onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
            Workflow Filters
          </label>
          <div className="max-h-56 overflow-auto rounded-lg border p-2 space-y-1.5" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            {(workflows ?? []).length === 0 ? (
              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                No source workflows found yet.
              </p>
            ) : (
              (workflows ?? []).map((workflow: any) => (
                <label key={workflow.id} className="flex items-start gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:opacity-90">
                  <input
                    type="checkbox"
                    checked={selectedWorkflowIds.includes(workflow.id)}
                    onChange={(e) => {
                      const nextIds = e.target.checked
                        ? [...selectedWorkflowIds, workflow.id]
                        : selectedWorkflowIds.filter((id) => id !== workflow.id)
                      onUpdate('workflow_ids', nextIds)
                      onUpdate('workflow_id', nextIds[0] ?? null)
                    }}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>
                      {workflow.name}
                    </span>
                    <span className="block text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                      {workflow.trigger_type?.replaceAll('_', ' ') ?? 'workflow'} {workflow.is_active ? '· active' : '· inactive'}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
          SLA Events
        </label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'warning', label: 'Near / Warning' },
            { value: 'breached', label: 'Breached' },
          ].map((eventType) => {
            const active = selectedEventTypes.includes(eventType.value)
            return (
              <button
                key={eventType.value}
                type="button"
                onClick={() => toggleEventType(eventType.value as 'warning' | 'breached')}
                className="rounded px-2 py-2 text-[10px] font-medium transition-colors"
                style={{
                  backgroundColor: active ? 'var(--theme-primary)' : 'var(--theme-surface)',
                  color: active ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
                }}
              >
                {eventType.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function RetentionPolicyReviewTriggerConfig({ config, onUpdate }: {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
}) {
  const scope = config.policy_scope === 'specific' ? 'specific' : 'all'
  const selectedPolicyIds = Array.isArray(config.policy_ids)
    ? (config.policy_ids as string[]).filter(Boolean)
    : config.retention_policy_id
      ? [String(config.retention_policy_id)]
      : []

  const { data: policies } = useRetentionPolicyOptions(
    'retention-policy-review-trigger-policies',
    'id, name, description, policy_mode, applies_to',
  )

  return (
    <div className="space-y-4">
      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--theme-surface)' }}>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          This trigger runs when a retention policy review becomes due. The workflow receives {'{{retention_policy_id}}'}, {'{{retention_policy_name}}'}, {'{{retention_review_date}}'}, {'{{retention_target_type}}'}, {'{{retention_target_id}}'}, and {'{{retention_asset_name}}'}.
        </p>
      </div>

      <div onPointerDown={(e) => e.stopPropagation()}>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
          Policy Scope
        </label>
        <select
          value={scope}
          onChange={(e) => {
            const nextScope = e.target.value === 'specific' ? 'specific' : 'all'
            onUpdate('policy_scope', nextScope)
            if (nextScope === 'all') {
              onUpdate('policy_ids', [])
              onUpdate('retention_policy_id', null)
            }
          }}
          className="w-full rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-surface-border)',
            color: 'var(--theme-card-text)',
          }}
        >
          <option value="all">All reviewable policies</option>
          <option value="specific">Only selected policies</option>
        </select>
      </div>

      {scope === 'specific' && (
        <div onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
            Policy Filters
          </label>
          <div className="max-h-56 overflow-auto rounded-lg border p-2 space-y-1.5" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            {(policies ?? []).length === 0 ? (
              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                No retention policies found yet.
              </p>
            ) : (
              (policies ?? []).map((policy: any) => (
                <label key={policy.id} className="flex items-start gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:opacity-90">
                  <input
                    type="checkbox"
                    checked={selectedPolicyIds.includes(policy.id)}
                    onChange={(e) => {
                      const nextIds = e.target.checked
                        ? [...selectedPolicyIds, policy.id]
                        : selectedPolicyIds.filter((id) => id !== policy.id)
                      onUpdate('policy_ids', nextIds)
                      onUpdate('retention_policy_id', nextIds[0] ?? null)
                    }}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>
                      {policy.name}
                    </span>
                    <span className="block text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                      {String(policy.policy_mode ?? '').replaceAll('_', ' ')}
                      {Array.isArray(policy.applies_to) && policy.applies_to.length > 0 ? ` · ${policy.applies_to.join(', ')}` : ''}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
          <p className="mt-1 text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
            Select one or more retention policies to narrow this review workflow.
          </p>
        </div>
      )}
    </div>
  )
}

function RetentionPolicyExecutedTriggerConfig({ config, onUpdate }: {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
}) {
  const scope = config.policy_scope === 'specific' ? 'specific' : 'all'
  const selectedPolicyIds = Array.isArray(config.policy_ids)
    ? (config.policy_ids as string[]).filter(Boolean)
    : config.retention_policy_id
      ? [String(config.retention_policy_id)]
      : []
  const selectedActionTypes = Array.isArray(config.action_types)
    ? (config.action_types as string[]).filter(Boolean)
    : config.action_type
      ? [String(config.action_type)]
      : ['purge']

  const { data: policies } = useRetentionPolicyOptions(
    'retention-policy-executed-trigger-policies',
    'id, name, description, policy_mode, applies_to',
  )

  return (
    <div className="space-y-4">
      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--theme-surface)' }}>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          This trigger runs when a retention policy action is executed. Right now that means purge execution. The workflow receives {'{{retention_execution_event_id}}'}, {'{{retention_policy_id}}'}, {'{{retention_policy_name}}'}, {'{{retention_action_type}}'}, {'{{retention_execution_date}}'}, {'{{retention_target_type}}'}, {'{{retention_target_id}}'}, and {'{{retention_asset_name}}'}.
        </p>
      </div>

      <div onPointerDown={(e) => e.stopPropagation()}>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
          Action Types
        </label>
        <div className="grid grid-cols-2 gap-1">
          {[
            { value: 'purge', label: 'Purge' },
          ].map((option) => {
            const active = selectedActionTypes.includes(option.value)
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  const next = active
                    ? selectedActionTypes.filter((value) => value !== option.value)
                    : [...selectedActionTypes, option.value]
                  onUpdate('action_types', next.length > 0 ? next : [option.value])
                  onUpdate('action_type', (next.length > 0 ? next : [option.value])[0] ?? option.value)
                }}
                className="rounded-md border px-2 py-1.5 text-[10px] font-medium transition-colors"
                style={{
                  backgroundColor: active ? 'var(--theme-primary)' : 'var(--theme-surface)',
                  color: active ? 'var(--theme-on-primary)' : 'var(--theme-card-text)',
                  borderColor: active ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <div onPointerDown={(e) => e.stopPropagation()}>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
          Policy Scope
        </label>
        <select
          value={scope}
          onChange={(e) => {
            const nextScope = e.target.value === 'specific' ? 'specific' : 'all'
            onUpdate('policy_scope', nextScope)
            if (nextScope === 'all') {
              onUpdate('policy_ids', [])
              onUpdate('retention_policy_id', null)
            }
          }}
          className="w-full rounded-lg border px-3 py-2 text-xs"
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-surface-border)',
            color: 'var(--theme-card-text)',
          }}
        >
          <option value="all">All matching policy executions</option>
          <option value="specific">Only selected policies</option>
        </select>
      </div>

      {scope === 'specific' && (
        <div onPointerDown={(e) => e.stopPropagation()}>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
            Policy Filters
          </label>
          <div className="max-h-56 overflow-auto rounded-lg border p-2 space-y-1.5" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            {(policies ?? []).length === 0 ? (
              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                No retention policies found yet.
              </p>
            ) : (
              (policies ?? []).map((policy: any) => (
                <label key={policy.id} className="flex items-start gap-2 cursor-pointer rounded-md px-2 py-1.5 hover:opacity-90">
                  <input
                    type="checkbox"
                    checked={selectedPolicyIds.includes(policy.id)}
                    onChange={(e) => {
                      const nextIds = e.target.checked
                        ? [...selectedPolicyIds, policy.id]
                        : selectedPolicyIds.filter((id) => id !== policy.id)
                      onUpdate('policy_ids', nextIds)
                      onUpdate('retention_policy_id', nextIds[0] ?? null)
                    }}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>
                      {policy.name}
                    </span>
                    <span className="block text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                      {String(policy.policy_mode ?? '').replaceAll('_', ' ')}
                      {Array.isArray(policy.applies_to) && policy.applies_to.length > 0 ? ` · ${policy.applies_to.join(', ')}` : ''}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Go To Activity Config ───
function GoToActivityConfig({ config, onUpdate, onBatchUpdate, allNodes, currentNodeId, extraVariables }: {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  allNodes: WorkflowNode[]
  currentNodeId: string
  extraVariables: { name: string; group: string }[]
}) {
  const targetId = config.target_node_id ?? ''
  const targetNode = allNodes.find(n => n.id === targetId)
  const overrides = (config.input_overrides ?? {}) as Record<string, string>

  // Get available nodes (exclude self and triggers)
  const triggerTypes = ['task_created', 'task_received', 'task_submitted', 'task_updated', 'task_completed', 'task_rejected', 'workflow_error', 'workflow_sla', 'retention_policy_review', 'retention_policy_executed', 'data_table_event', 'form_submitted', 'middleware_received', 'schedule', 'webhook_received']
  const availableNodes = allNodes.filter(n => n.id !== currentNodeId && !triggerTypes.includes(n.type))

  // Get target node's expected inputs (from config like call_reference inputs, loop items, etc.)
  const targetInputs: { name: string; currentValue: string }[] = []
  if (targetNode) {
    const tc = targetNode.config
    if (targetNode.type === 'call_reference' && tc.input_mappings) {
      for (const [name, val] of Object.entries(tc.input_mappings as Record<string, string>)) {
        if (val) targetInputs.push({ name, currentValue: val })
      }
    }
    if (targetNode.type === 'set_variable' && tc.name) {
      targetInputs.push({ name: tc.name, currentValue: tc.expression ?? '' })
    }
    if (targetNode.type === 'condition') {
      const branches = (tc.branches ?? []) as any[]
      for (const b of branches) {
        for (const r of b.rules ?? []) {
          if (r.field) targetInputs.push({ name: `field: ${r.field}`, currentValue: r.value })
        }
      }
    }
    if (targetNode.type === 'loop' && tc.items) {
      targetInputs.push({ name: 'items', currentValue: tc.items })
    }
    if (targetNode.type === 'http_request') {
      if (tc.url) targetInputs.push({ name: 'url', currentValue: tc.url })
      if (tc.body) targetInputs.push({ name: 'body', currentValue: tc.body })
    }
    if (targetNode.type === 'update_task') {
      if (tc.field) targetInputs.push({ name: tc.field, currentValue: tc.value ?? '' })
    }
  }

  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rounded-lg p-3" style={{ backgroundColor: 'color-mix(in srgb, var(--status-info) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--status-info) 20%, transparent)' }}>
        <p className="text-xs font-medium mb-1" style={{ color: 'var(--status-info)' }}>Go To Activity</p>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          Jumps execution to another activity on the canvas. The target runs with current variables — override specific inputs below.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Target Activity</label>
        <AutocompleteSelect
          value={targetId}
          placeholder="Select an activity..."
          options={availableNodes.map(n => {
            const cat = NODE_CATALOG.find(c => c.type === n.type)
            return { value: n.id, label: n.label, hint: cat?.label ?? n.type }
          })}
          onChange={(nextId) => {
            const node = allNodes.find(n => n.id === nextId)
            // One batched write — sequential updates would clobber each other.
            onBatchUpdate({
              target_node_id: nextId,
              target_node_label: node?.label ?? '',
              input_overrides: {},
            })
          }}
        />
      </div>

      {targetNode && targetInputs.length > 0 && (
        <div>
          <label className="block text-xs font-medium mb-1">Input Overrides</label>
          <p className="text-[9px] mb-2" style={{ color: 'var(--theme-muted-text)' }}>
            Leave empty to use the target's configured value. Set a value to override.
          </p>
          <div className="space-y-2">
            {targetInputs.map((inp, i) => (
              <div key={i}>
                <div className="flex items-center gap-1 mb-0.5">
                  <code className="text-[10px] font-mono" style={{ color: 'var(--theme-primary-text)' }}>{inp.name}</code>
                  <span className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
                    current: {inp.currentValue.slice(0, 30)}{inp.currentValue.length > 30 ? '...' : ''}
                  </span>
                </div>
                <VariableInput
                  value={overrides[inp.name] ?? ''}
                  onChange={(v) => onUpdate('input_overrides', { ...overrides, [inp.name]: v })}
                  placeholder="Leave empty to use current value"
                  extraVariables={extraVariables}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {targetNode && targetInputs.length === 0 && (
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          Target activity has no configurable inputs to override.
        </p>
      )}
    </div>
  )
}

// ─── Server Event Reference Picker (searchable, grouped by integration) ───
/**
 * Maps the selected reference's declared inputs to workflow values. When any
 * mapping is set, the engine calls the reference through the governed
 * executor (path/query/body built from these inputs) instead of raw-POSTing
 * the payload at the endpoint. event_id / event_name are always available.
 */
function ServerEventReferenceInputs({ referenceId, mappings, onChange, extraVariables }: {
  referenceId: string
  mappings: Record<string, string>
  onChange: (mappings: Record<string, string>) => void
  extraVariables: { name: string; group: string }[]
}) {
  const { data: reference } = useQuery({
    queryKey: ['server-event-reference-inputs', referenceId],
    queryFn: async () => (await serverRead('automations.referenceInputs', { id: referenceId })).data ?? null,
    enabled: !!referenceId,
    staleTime: 60_000,
    ...PANEL_QUERY_DEFAULTS,
  })

  const declaredInputs = (Array.isArray(reference?.inputs) ? reference.inputs : []) as { name?: string; id?: string; type?: string; required?: boolean; description?: string }[]
  if (declaredInputs.length === 0) return null

  return (
    <div>
      <label className="block text-xs font-medium mb-1">Reference Inputs</label>
      <p className="text-[9px] mb-1.5" style={{ color: 'var(--theme-muted-text)' }}>
        Map values into this reference&apos;s declared inputs. Use <code>{'{{event_id}}'}</code> for the callback reference the external server must send back.
      </p>
      <div className="space-y-1.5">
        {declaredInputs.map((input) => {
          const name = String(input?.name ?? input?.id ?? '').trim()
          if (!name) return null
          return (
            <div key={name}>
              <div className="flex items-center gap-1 mb-0.5">
                <span className="text-[10px] font-mono font-medium" style={{ color: 'var(--theme-primary-text)' }}>{name}</span>
                {input.required && (
                  <span className="text-[8px] px-1 py-0.5 rounded uppercase" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-warning) 12%, transparent)', color: 'var(--theme-warning)' }}>required</span>
                )}
                {input.type && (
                  <span className="text-[8px] px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>{input.type}</span>
                )}
              </div>
              <VariableInput
                value={mappings[name] ?? ''}
                onChange={(value) => onChange({ ...mappings, [name]: value })}
                placeholder={name === 'event_id' ? '{{event_id}}' : `{{variable}} or static value`}
                extraVariables={extraVariables}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ServerEventReferencePicker({ referenceId, referenceName, onSelect }: {
  referenceId: string; referenceName: string; onSelect: (id: string, name: string) => void
}) {
  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const { data } = useQuery({
    queryKey: ['refs-with-integrations'],
    queryFn: async () => (await serverRead('automations.referencePicker')).data ?? { integrations: [], references: [] },
    staleTime: 60000,
    ...PANEL_QUERY_DEFAULTS,
  })

  const integrations = data?.integrations ?? []
  const allRefs = data?.references ?? []
  const q = search.toLowerCase()

  // Group refs by integration, filter by search
  const groups = integrations
    .map(int => ({
      ...int,
      refs: allRefs.filter((r: any) =>
        r.integration_id === int.id &&
        (!q || r.name.toLowerCase().includes(q) || int.name.toLowerCase().includes(q))
      ),
    }))
    .filter(g => g.refs.length > 0)

  // Find selected ref's integration name
  const selectedRef = allRefs.find((r: any) => r.id === referenceId)
  const selectedIntName = selectedRef ? integrations.find((i: any) => i.id === selectedRef.integration_id)?.name : null

  return (
    <div>
      <label className="block text-xs font-medium mb-1">API Reference</label>

      {/* Selected display / trigger */}
      {referenceId && !pickerOpen ? (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="w-full text-left rounded-lg border px-3 py-2 text-xs transition-colors hover:opacity-80"
          style={{ borderColor: "var(--theme-primary)", backgroundColor: "var(--theme-primary-light)" }}
        >
          <p className="font-medium" style={{ color: "var(--theme-primary-text)" }}>{referenceName || selectedRef?.name || 'Unknown'}</p>
          {selectedIntName && (
            <p className="text-[9px] mt-0.5" style={{ color: "var(--theme-muted-text)" }}>from {selectedIntName}</p>
          )}
        </button>
      ) : (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--theme-surface-border)" }}>
          {/* Search */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search references..."
            className="w-full px-3 py-2 text-xs outline-none"
            style={{ backgroundColor: "var(--theme-card-bg)", color: "var(--theme-card-text)", borderBottom: "1px solid var(--theme-surface-border)" }}
            autoFocus
          />

          {/* Grouped list */}
          <div className="max-h-[200px] overflow-y-auto">
            {groups.length === 0 ? (
              <p className="px-3 py-4 text-[10px] text-center" style={{ color: "var(--theme-muted-text)" }}>
                {search ? 'No references matching search' : 'No references available'}
              </p>
            ) : (
              groups.map(int => {
                const isExpanded = expanded === int.id || !!search
                const typeLabels: Record<string, string> = { rest_api: 'API', database: 'DB', graphql: 'GQL', webhook: 'Hook' }
                return (
                  <div key={int.id}>
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded && !search ? null : int.id)}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:opacity-80"
                      style={{ backgroundColor: isExpanded ? "var(--theme-surface)" : "transparent" }}
                    >
                      <span className="text-[8px] font-bold px-1 py-0.5 rounded shrink-0"
                        style={{ backgroundColor: "var(--theme-primary-light)", color: "var(--theme-primary-text)" }}>
                        {typeLabels[int.type] ?? int.type}
                      </span>
                      <span className="text-[11px] font-semibold flex-1 truncate">{int.name}</span>
                      <span className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>{int.refs.length}</span>
                    </button>
                    {isExpanded && (
                      <div>
                        {int.refs.map((ref: any) => {
                          const method = (ref.request_config as any)?.method ?? ''
                          const methodColors: Record<string, string> = { GET: 'var(--theme-success)', POST: 'var(--status-info)', PUT: 'var(--theme-warning)', DELETE: 'var(--theme-danger)', PATCH: 'var(--theme-chart-6)', QUERY: 'var(--theme-chart-3)', EXEC: 'var(--theme-chart-6)' }
                          return (
                            <button
                              key={ref.id}
                              type="button"
                              onClick={() => { onSelect(ref.id, ref.name); setPickerOpen(false); setSearch("") }}
                              className="flex items-center gap-1.5 w-full px-3 py-1.5 pl-7 text-left hover:opacity-80 transition-colors"
                              style={{
                                backgroundColor: ref.id === referenceId ? "var(--theme-primary-light)" : "transparent",
                              }}
                            >
                              {method && (
                                <span className="text-[7px] font-bold px-1 py-0.5 rounded shrink-0"
                                  style={{ color: methodColors[method] ?? 'var(--theme-muted-text)', backgroundColor: `color-mix(in srgb, ${methodColors[method] ?? 'var(--theme-muted-text)'} 8%, transparent)` }}>
                                  {method}
                                </span>
                              )}
                              <span className="text-[10px] flex-1 truncate">{ref.name}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Cancel */}
          {referenceId && (
            <button
              type="button"
              onClick={() => { setPickerOpen(false); setSearch("") }}
              className="w-full px-3 py-1.5 text-[10px] text-center hover:opacity-70"
              style={{ color: "var(--theme-muted-text)", borderTop: "1px solid var(--theme-surface-border)" }}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {referenceId && !pickerOpen && (
        <div className="flex items-center gap-2 mt-1">
          <p className="text-[9px] flex-1" style={{ color: "var(--theme-muted-text)" }}>
            <code style={{ color: "var(--theme-primary-text)" }}>event_id</code> + send variables sent as JSON body
          </p>
          <button type="button" onClick={() => { onSelect("", ""); }} className="text-[9px] underline" style={{ color: "var(--theme-muted-text)" }}>
            Clear
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Server Event Table Picker ───
function ServerEventTablePicker({ tableId, tableName, onSelect }: {
  tableId: string; tableName: string; onSelect: (id: string, name: string) => void
}) {
  const { data: tables } = useQuery({
    queryKey: ['custom-tables-picker'],
    queryFn: async () => (await serverRead('automations.tableOptions')).data ?? [],
    staleTime: 60000,
    ...PANEL_QUERY_DEFAULTS,
  })

  return (
    <div>
      <label className="block text-xs font-medium mb-1">Data Table</label>
      <AutocompleteSelect
        value={tableId}
        placeholder="Select a table..."
        options={(() => {
          const options = (tables ?? []).map((t: any) => ({ value: t.id, label: t.name }))
          // A bound table that is not (yet) in the list still shows by name.
          if (tableId && !options.some((o) => o.value === tableId)) {
            options.unshift({ value: tableId, label: dataTableLabel({ table_id: tableId, table_name: tableName }, tables ? tableNamesOf(tables) : undefined) ?? tableId })
          }
          return options
        })()}
        onChange={(nextId) => {
          const t = tables?.find((t: any) => t.id === nextId)
          onSelect(nextId, t?.name ?? '')
        }}
      />
      {tableId && (
        <p className="text-[9px] mt-1" style={{ color: "var(--theme-muted-text)" }}>
          A row is created with <code style={{ color: "var(--theme-primary-text)" }}>event_id</code> + send variables as data
        </p>
      )}
    </div>
  )
}

function MultiBranchConditionBuilder({
  config,
  onUpdate,
  onBatchUpdate,
  extraVariables,
}: {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables?: { name: string; group: string }[]
}) {
  const branches: ConditionBranch[] = config.branches ?? [
    { label: "If", logic: "and", rules: [{ field: "", operator: "equals", value: "" }] },
  ]
  const hasElse = config.has_else !== false

  function setBranches(newBranches: ConditionBranch[]) {
    // Also set backwards-compat flat fields from first branch first rule
    const updates: Record<string, any> = { branches: newBranches }
    if (newBranches.length > 0 && newBranches[0].rules.length > 0) {
      const first = newBranches[0].rules[0]
      updates.field = first.field
      updates.operator = first.operator
      updates.value = first.value
    }
    onBatchUpdate(updates)
  }

  function addBranch() {
    setBranches([...branches, {
      label: `If ${branches.length + 1}`,
      logic: "and",
      rules: [{ field: "", operator: "equals", value: "" }],
    }])
  }

  function removeBranch(bi: number) {
    if (branches.length <= 1) return
    setBranches(branches.filter((_, i) => i !== bi))
  }

  function updateBranchLabel(bi: number, label: string) {
    const updated = [...branches]
    updated[bi] = { ...updated[bi], label }
    setBranches(updated)
  }

  function toggleLogic(bi: number) {
    const updated = [...branches]
    updated[bi] = { ...updated[bi], logic: String(updated[bi].logic).toLowerCase() === "and" ? "or" : "and" }
    setBranches(updated)
  }

  function addRule(bi: number) {
    const updated = [...branches]
    updated[bi] = { ...updated[bi], rules: [...updated[bi].rules, { field: "", operator: "equals", value: "" }] }
    setBranches(updated)
  }

  function removeRule(bi: number, ri: number) {
    const updated = [...branches]
    updated[bi] = { ...updated[bi], rules: updated[bi].rules.filter((_, i) => i !== ri) }
    if (updated[bi].rules.length === 0) updated[bi].rules = [{ field: "", operator: "equals", value: "" }]
    setBranches(updated)
  }

  function updateRule(bi: number, ri: number, field: string, value: string) {
    const updated = [...branches]
    updated[bi] = {
      ...updated[bi],
      rules: updated[bi].rules.map((r, i) => i === ri ? { ...r, [field]: value } : r),
    }
    setBranches(updated)
  }

  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
      <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-muted-text)" }}>
        Branches
      </label>
      <p className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>
        All branches are evaluated — multiple can match and execute in parallel. Add an Else branch to catch unmatched cases.
      </p>

      {branches.map((branch, bi) => {
        const color = BRANCH_COLORS[bi % BRANCH_COLORS.length]
        return (
          <div key={bi} className="rounded-lg p-2.5 space-y-2" style={{ backgroundColor: "var(--theme-surface)", borderLeft: `3px solid ${color}` }}>
            {/* Branch header */}
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <input
                value={branch.label}
                onChange={(e) => updateBranchLabel(bi, e.target.value)}
                className="flex-1 text-xs font-semibold bg-transparent border-none outline-none"
                style={{ color: "var(--theme-card-text)" }}
                placeholder={bi === 0 ? "If" : "Else If"}
              />
              <button
                onClick={() => toggleLogic(bi)}
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: "var(--theme-primary-light)", color: "var(--theme-primary-text)" }}
              >
                {branch.logic.toUpperCase()}
              </button>
              {branches.length > 1 && (
                <button onClick={() => removeBranch(bi)} className="hover:text-[color:var(--theme-danger)]" style={{ color: "var(--theme-muted-text)" }}>
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Rules */}
            {branch.rules.map((rule, ri) => (
              <div key={ri} className="space-y-1">
                <div className="flex items-center gap-1">
                  <div className="flex-1">
                    <VariableInput
                      value={rule.field}
                      onChange={(v) => updateRule(bi, ri, "field", v)}
                      placeholder="{{task.priority}}"
                      extraVariables={extraVariables}
                    />
                  </div>
                  <select
                    value={rule.operator}
                    onChange={(e) => updateRule(bi, ri, "operator", e.target.value)}
                    className="rounded border px-1 py-0.5 text-[10px] shrink-0"
                    style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
                  >
                    <option value="equals">=</option>
                    <option value="not_equals">!=</option>
                    <option value="contains">contains</option>
                    <option value="not_contains">does not contain</option>
                    <option value="gt">&gt;</option>
                    <option value="lt">&lt;</option>
                    <option value="gte">&gt;=</option>
                    <option value="lte">&lt;=</option>
                    <option value="is_empty">empty</option>
                    <option value="is_not_empty">not empty</option>
                    <option value="starts_with">starts with</option>
                    <option value="ends_with">ends with</option>
                    <option value="in">in list</option>
                    <option value="is_true">is true</option>
                    <option value="is_false">is false</option>
                    <option value="matches">matches regex</option>
                  </select>
                  {branch.rules.length > 1 && (
                    <button onClick={() => removeRule(bi, ri)} className="hover:text-[color:var(--theme-danger)] shrink-0" style={{ color: "var(--theme-muted-text)" }}>
                      <X size={10} />
                    </button>
                  )}
                </div>
                {!["is_empty", "is_not_empty", "is_true", "is_false"].includes(rule.operator) && (
                  <VariableInput
                    value={rule.value}
                    onChange={(v) => updateRule(bi, ri, "value", v)}
                    placeholder="value or {{variable}}"
                    extraVariables={extraVariables}
                  />
                )}
              </div>
            ))}

            <Button variant="ghost" size="sm" onClick={() => addRule(bi)} className="!text-[10px] !h-5 !px-2">
              <Plus size={8} className="mr-1" /> Add Rule
            </Button>
          </div>
        )
      })}

      <Button variant="outline" size="sm" onClick={addBranch} className="w-full !text-[10px]">
        <Plus size={10} className="mr-1" /> Add Branch
      </Button>

      {/* Else toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={hasElse}
          onChange={(e) => onUpdate("has_else", e.target.checked)}
          className="rounded border-[color:var(--theme-surface-border)]"
        />
        <span className="text-xs" style={{ color: "var(--theme-card-text)" }}>
          Include Else branch (catches everything else)
        </span>
      </label>

      {hasElse && (
        <div className="rounded-lg px-2.5 py-2 flex items-center gap-2" style={{ backgroundColor: "var(--theme-surface)", borderLeft: "3px solid var(--theme-muted-text)" }}>
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "var(--theme-muted-text)" }} />
          <span className="text-xs font-semibold" style={{ color: "var(--theme-muted-text)" }}>Else</span>
          <span className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>— runs if no other branch matches</span>
        </div>
      )}
    </div>
  )
}

// ─── Update Data Table Config ───

const SCHEDULE_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function ScheduleTriggerConfig({ config, onUpdate, onBatchUpdate }: { config: Record<string, any>; onUpdate: (key: string, value: any) => void; onBatchUpdate: (updates: Record<string, any>) => void }) {
  const mode = String(config.schedule_mode ?? '')
  const normalized = normalizeScheduleConfig(config)
  const nextRun = normalized ? getNextOccurrence(normalized, new Date()) : null
  const timezones = useMemo(() => {
    try { return (Intl as any).supportedValuesOf?.('timeZone') as string[] ?? ['UTC'] } catch { return ['UTC'] }
  }, [])

  const setMode = (nextMode: string) => {
    // Seed sensible defaults per mode so the schedule is valid immediately.
    // Must be ONE batched update: updateConfig() rebuilds from the same stale
    // node.config snapshot per call, so sequential calls clobber each other.
    const defaults: Record<string, Record<string, any>> = {
      every_minutes: { interval_minutes: config.interval_minutes ?? 15 },
      hourly: { minute_of_hour: config.minute_of_hour ?? 0 },
      daily: { time_of_day: config.time_of_day ?? '09:00' },
      weekly: { time_of_day: config.time_of_day ?? '09:00', day_of_week: config.day_of_week ?? 1 },
      monthly: { time_of_day: config.time_of_day ?? '09:00', day_of_month: config.day_of_month ?? 1 },
      once: { run_at: config.run_at ?? '' },
    }
    onBatchUpdate({
      schedule_mode: nextMode,
      ...(defaults[nextMode] ?? {}),
      ...(config.timezone ? {} : { timezone: 'UTC' }),
    })
  }

  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--theme-surface)' }}>
        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
          Runs this workflow automatically on a schedule. Task data is not available unless a task is explicitly linked. The variables {'{{schedule_occurrence}}'} and {'{{schedule_description}}'} are provided on each run.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Repeats</label>
        <select value={mode} onChange={(e) => setMode(e.target.value)} className="w-full rounded-lg border px-2 py-1.5 text-xs" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
          <option value="">Choose a schedule...</option>
          <option value="every_minutes">Every N minutes</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="once">Once, on a specific date</option>
        </select>
      </div>

      {mode === 'every_minutes' && (
        <div>
          <label className="block text-xs font-medium mb-1">Every how many minutes?</label>
          <input type="number" min={1} max={1440} value={config.interval_minutes ?? 15}
            onChange={(e) => onUpdate('interval_minutes', Math.max(1, Number(e.target.value || 1)))}
            className="w-full rounded-lg border px-2 py-1.5 text-xs font-mono" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }} />
        </div>
      )}

      {mode === 'hourly' && (
        <div>
          <label className="block text-xs font-medium mb-1">At which minute of the hour?</label>
          <input type="number" min={0} max={59} value={config.minute_of_hour ?? 0}
            onChange={(e) => onUpdate('minute_of_hour', Math.min(59, Math.max(0, Number(e.target.value || 0))))}
            className="w-full rounded-lg border px-2 py-1.5 text-xs font-mono" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }} />
        </div>
      )}

      {(mode === 'daily' || mode === 'weekly' || mode === 'monthly') && (
        <div className="grid grid-cols-2 gap-2">
          {mode === 'weekly' && (
            <div>
              <label className="block text-xs font-medium mb-1">Day of week</label>
              <AutocompleteSelect
                value={String(config.day_of_week ?? 1)}
                options={SCHEDULE_WEEKDAYS.map((label, value) => ({ value: String(value), label }))}
                onChange={(value) => onUpdate('day_of_week', Number(value))}
              />
            </div>
          )}
          {mode === 'monthly' && (
            <div>
              <label className="block text-xs font-medium mb-1">Day of month</label>
              <input type="number" min={1} max={31} value={config.day_of_month ?? 1}
                onChange={(e) => onUpdate('day_of_month', Math.min(31, Math.max(1, Number(e.target.value || 1))))}
                className="w-full rounded-lg border px-2 py-1.5 text-xs font-mono" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }} />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium mb-1">At what time?</label>
            <input type="time" value={config.time_of_day ?? '09:00'} onChange={(e) => onUpdate('time_of_day', e.target.value)}
              className="w-full rounded-lg border px-2 py-1.5 text-xs font-mono" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }} />
          </div>
        </div>
      )}

      {mode === 'once' && (
        <div>
          <label className="block text-xs font-medium mb-1">Run at (UTC)</label>
          <input type="datetime-local" value={String(config.run_at ?? '').slice(0, 16)}
            onChange={(e) => onUpdate('run_at', e.target.value ? `${e.target.value}:00.000Z` : '')}
            className="w-full rounded-lg border px-2 py-1.5 text-xs font-mono" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }} />
          <p className="mt-1 text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>Enter the time in UTC — the workflow fires once, at or shortly after this moment.</p>
        </div>
      )}

      {(mode === 'daily' || mode === 'weekly' || mode === 'monthly') && (
        <div>
          <label className="block text-xs font-medium mb-1">Timezone</label>
          <AutocompleteSelect
            value={config.timezone ?? 'UTC'}
            placeholder="Search timezones..."
            options={timezones.map((tz) => ({ value: tz, label: tz }))}
            onChange={(value) => onUpdate('timezone', value)}
          />
        </div>
      )}

      {mode && (
        <div className="rounded-lg border px-3 py-2" style={{ borderColor: normalized ? 'color-mix(in srgb, var(--theme-success) 35%, var(--theme-surface-border))' : 'color-mix(in srgb, var(--theme-warning) 35%, var(--theme-surface-border))', backgroundColor: 'var(--theme-surface)' }}>
          <p className="text-[10px] font-semibold" style={{ color: 'var(--theme-card-text)' }}>
            {normalized ? describeSchedule(normalized) : 'Schedule incomplete — finish the fields above.'}
          </p>
          {nextRun && (
            <p className="mt-0.5 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
              Next run: {nextRun.toLocaleString()} (your local time)
            </p>
          )}
          {normalized && !nextRun && normalized.schedule_mode === 'once' && (
            <p className="mt-0.5 text-[10px]" style={{ color: 'var(--theme-warning)' }}>
              This date is in the past — the workflow will fire once on the next sweep, then never again.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function DataTableTriggerConfig({ config, onUpdate }: { config: Record<string, any>; onUpdate: (key: string, value: any) => void }) {
  const { data: tables } = useCustomTableOptions('data-table-trigger-tables', 'id, name, columns') as { data: { id: string; name: string; columns: any }[] | undefined }

  const selectedTable = tables?.find((table) => table.id === dataTableIdOf(config))
  const tableColumns = useMemo(
    () => normalizeTableColumns(selectedTable?.columns),
    [selectedTable?.columns]
  )

  useEffect(() => {
    const nextColumns = JSON.stringify(tableColumns)
    const currentColumns = JSON.stringify(config._table_columns ?? [])
    if (nextColumns !== currentColumns) onUpdate('_table_columns', tableColumns)
  }, [config._table_columns, onUpdate, tableColumns])

  const selectedEventTypes = Array.isArray(config.event_types) ? config.event_types : ['created']

  useEffect(() => {
    if (!Array.isArray(config.event_types) || config.event_types.length === 0) {
      onUpdate('event_types', ['created'])
    }
  }, [config.event_types, onUpdate])

  function toggleEventType(eventType: 'created' | 'updated' | 'deleted' | 'archived' | 'restored') {
    const next = selectedEventTypes.includes(eventType)
      ? selectedEventTypes.filter((value: string) => value !== eventType)
      : [...selectedEventTypes, eventType]
    onUpdate('event_types', next.length > 0 ? next : [eventType])
  }

  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
      <div className="rounded-lg p-3" style={{ backgroundColor: "var(--theme-surface)" }}>
        <p className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
          Triggers when a row is created, updated, or deleted in a data table. The workflow gets the row ID, full row object, and each selected column as variables.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Data Table</label>
        <SearchableEntityPicker
          items={(tables ?? []).map((table) => ({ id: table.id, name: table.name }))}
          selectedId={dataTableIdOf(config)}
          fallbackName={dataTableLabel(config, tableNamesOf(tables)) ?? undefined}
          loading={tables === undefined}
          placeholder="Search tables..."
          emptyLabel="No tables found"
          onSelect={(id, name) => { onUpdate('table_id', id || null); onUpdate('table_name', id ? name : '') }}
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1">Events</label>
        <div className="grid grid-cols-3 gap-1">
          {[
            { value: 'created', label: 'Row Created' },
            { value: 'updated', label: 'Row Updated' },
            { value: 'deleted', label: 'Row Deleted' },
          ].map((eventType) => {
            const active = selectedEventTypes.includes(eventType.value)
            return (
              <button
                key={eventType.value}
                type="button"
                onClick={() => toggleEventType(eventType.value as 'created' | 'updated' | 'deleted' | 'archived' | 'restored')}
                className="rounded px-2 py-1.5 text-[10px] font-medium transition-colors"
                style={{
                  backgroundColor: active ? 'var(--theme-primary)' : 'var(--theme-surface)',
                  color: active ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
                }}
              >
                {eventType.label}
              </button>
            )
          })}
        </div>
      </div>

      {selectedTable && (
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--theme-muted-text)" }}>
            Trigger Variables
          </label>
          <div className="space-y-0.5 rounded-lg p-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
            {[
              'data_event',
              'data_table_id',
              'data_table_name',
              'data_row_id',
              'row_id',
              'data_row',
              'row',
            ].map((name) => (
              <div key={name} className="flex items-center gap-2 text-[10px] py-0.5">
                <code className="font-mono" style={{ color: "var(--theme-primary-text)" }}>{`{{${name}}}`}</code>
              </div>
            ))}
            {tableColumns.map((column) => (
              <div key={column.key} className="flex items-center gap-2 text-[10px] py-0.5">
                <code className="font-mono" style={{ color: "var(--theme-primary-text)" }}>{`{{${column.key}}}`}</code>
                <code className="font-mono" style={{ color: "var(--theme-primary-text)" }}>{`{{row.${column.key}}}`}</code>
                <span className="truncate" style={{ color: "var(--theme-muted-text)" }}>{column.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function UpdateDataTableConfig({ config, onUpdate, onBatchUpdate, extraVariables }: { config: Record<string, any>; onUpdate: (key: string, value: any) => void; onBatchUpdate: (updates: Record<string, any>) => void; extraVariables?: { name: string; group: string }[] }) {
  const { data: tables } = useCustomTableOptions('custom-tables-list-full', 'id, name, columns') as { data: { id: string; name: string; columns: any }[] | undefined }
  const { data: retentionPolicies } = useRetentionPolicyOptions('retention-policies:data_rows')
  const rowRetentionPolicies = useMemo(
    () => (retentionPolicies ?? []).filter((policy: any) => Array.isArray(policy.applies_to) && policy.applies_to.includes('data_rows')),
    [retentionPolicies],
  )

  // Fetch actual rows for row ID picker (row-targeted operations)
  const tableId = config.table_id
  const operation = config.operation ?? 'insert'
  const { data: tableRows } = useQuery({
    queryKey: ['custom-table-rows-ids', tableId],
    queryFn: async () => {
      if (!tableId) return []
      return ((await serverRead('automations.tableRows', { tableId, limit: 50 })).data ?? []) as { id: string; data: any }[]
    },
    enabled: !!tableId && (operation === 'get' || operation === 'update' || operation === 'delete' || operation === 'set_retention'),
    staleTime: 30 * 1000,
    ...PANEL_QUERY_DEFAULTS,
  })

  const selectedTable = tables?.find((t) => t.id === dataTableIdOf(config))
  const selectedRetentionPolicy = rowRetentionPolicies.find((policy: any) => policy.id === config.retention_policy_id)
  const tableColumns: { key: string; label: string; type: string }[] = (() => {
    const cols = selectedTable?.columns
    if (!cols) return []
    if (Array.isArray(cols)) {
      return cols
        .filter((c: any) => c?.key || c?.name || c?.id)
        .map((c: any) => ({
          key: c.key ?? c.name ?? c.id,
          label: c.label ?? c.name ?? c.key ?? c.id,
          type: c.type ?? 'text',
        }))
    }
    if (typeof cols === 'object') {
      return Object.entries(cols).map(([key, val]: [string, any]) => ({
        key,
        label: typeof val === 'string' ? val : val?.label ?? val?.name ?? key,
        type: typeof val === 'object' ? val?.type ?? 'text' : 'text',
      }))
    }
    return []
  })()

  // Sync table columns to config so the variables panel can show column-level accessors
  useEffect(() => {
    if (tableColumns.length > 0) {
      const current = JSON.stringify(config._table_columns ?? [])
      const updated = JSON.stringify(tableColumns)
      if (current !== updated) {
        onUpdate("_table_columns", tableColumns)
      }
    }
  }, [tableColumns])

  // Build extra variables for the Row ID input: actual row IDs FIRST, then canvas variables
  const rowIdVariables = useMemo(() => {
    const rowVars: { name: string; group: string; label?: string }[] = []
    if (tableRows?.length && tableColumns.length) {
      const labelCol = tableColumns.find(c => c.key === 'name' || c.key === 'title')
        ?? tableColumns.find(c => c.type === 'text')
        ?? tableColumns[0]
      const groupName = `Rows in ${selectedTable?.name ?? 'table'}`
      for (const row of tableRows) {
        const data = row.data as Record<string, any> ?? {}
        const labelVal = data[labelCol?.key] ?? data.id ?? ''
        const shortId = row.id.slice(0, 8)
        rowVars.push({
          name: row.id,
          group: groupName,
          label: labelVal ? `${String(labelVal).slice(0, 30)} — ${shortId}` : shortId,
        })
      }
    }
    // Row IDs first, then canvas variables
    return [...rowVars, ...(extraVariables ?? [])]
  }, [extraVariables, tableRows, tableColumns, selectedTable])

  const columnValues: Record<string, string> = config.column_values ?? {}
  const filters: { column: string; operator: string; value: string }[] = config.filters ?? []

  const FILTER_OPERATORS = [
    { value: 'eq', label: 'Equals' },
    { value: 'neq', label: 'Not equals' },
    { value: 'gt', label: 'Greater than' },
    { value: 'gte', label: 'Greater or equal' },
    { value: 'lt', label: 'Less than' },
    { value: 'lte', label: 'Less or equal' },
    { value: 'like', label: 'Contains' },
    { value: 'ilike', label: 'Contains (case-insensitive)' },
    { value: 'is_null', label: 'Is empty' },
    { value: 'not_null', label: 'Is not empty' },
  ]

  function updateFilter(index: number, field: string, value: string) {
    const updated = [...filters]
    updated[index] = { ...updated[index], [field]: value }
    onUpdate("filters", updated)
  }

  function addFilter() {
    onUpdate("filters", [...filters, { column: '', operator: 'eq', value: '' }])
  }

  function removeFilter(index: number) {
    onUpdate("filters", filters.filter((_, i) => i !== index))
  }

  // Dynamic outputs based on operation
  const outputHints = operation === 'list'
    ? 'Outputs: {{rows}} (array), {{row_count}} (number). Each row contains all columns plus {{row_id}}.'
    : operation === 'get'
    ? 'Outputs: {{row}} (object with all columns), {{row_id}}. Returns null if not found.'
    : operation === 'insert'
    ? 'Outputs: {{row_id}} of the inserted row, plus {{retention_policy_id}} when row retention is enabled.'
    : operation === 'update'
    ? 'Outputs: {{row_id}} of the updated row, plus {{retention_policy_id}} when row retention is enabled.'
    : 'Outputs: {{row_id}} of the deleted row.'

  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
      {/* Operation — first, so context is clear */}
      <div>
        <label className="block text-xs font-medium mb-1">Operation</label>
        <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
          {(['list', 'get', 'insert', 'update', 'delete'] as const).map((op) => (
            <button
              key={op}
              type="button"
              onClick={() => {
                const patch: Record<string, any> = { operation: op }
                if (op !== 'insert' && op !== 'update') {
                  patch.apply_retention_policy = false
                } else if (operation !== 'insert' && operation !== 'update') {
                  patch.apply_retention_policy = false
                }
                if (onBatchUpdate) onBatchUpdate(patch)
                else {
                  Object.entries(patch).forEach(([key, value]) => onUpdate(key, value))
                }
              }}
              className="rounded-lg border px-1.5 py-1.5 text-[10px] font-medium transition-colors capitalize"
              style={{
                backgroundColor: operation === op ? 'var(--theme-primary)' : 'var(--theme-surface)',
                color: operation === op ? 'var(--theme-on-primary)' : 'var(--theme-card-text)',
                borderColor: operation === op ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
              }}
            >
              {op === 'list'
                ? 'List'
                : op === 'get'
                ? 'Get'
                : op === 'insert'
                ? 'Insert'
                : op === 'update'
                ? 'Update'
                : 'Delete'}
            </button>
          ))}
        </div>
      </div>

      {/* Table selection */}
      <div>
        <label className="block text-xs font-medium mb-1">Data Table</label>
        <SearchableEntityPicker
          items={(tables ?? []).map((table) => ({ id: table.id, name: table.name }))}
          selectedId={dataTableIdOf(config)}
          fallbackName={dataTableLabel(config, tableNamesOf(tables)) ?? undefined}
          loading={tables === undefined}
          placeholder="Search tables..."
          emptyLabel="No tables found"
          onSelect={(id, name) => {
            const t = (tables ?? []).find((table) => table.id === id)
            if (onBatchUpdate) {
              const cols = t?.columns
              const colKeys = Array.isArray(cols)
                ? cols.filter((c: any) => c?.key).map((c: any) => ({ key: c.key, label: c.label ?? c.key, type: c.type ?? 'text' }))
                : []
              onBatchUpdate({ table_id: id, table_name: name, _table_columns: colKeys })
            } else {
              onUpdate("table_id", id)
              onUpdate("table_name", name)
            }
          }}
        />
      </div>

      {/* ─── LIST / QUERY ─── */}
      {operation === 'list' && selectedTable && (
        <>
          {/* Filters */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-muted-text)" }}>
                Filters
              </label>
              <Button variant="ghost" size="sm" className="!text-[9px] !h-5 !px-1.5" onClick={addFilter}>
                <Plus size={8} className="mr-0.5" /> Add Filter
              </Button>
            </div>
            {filters.length === 0 && (
              <p className="text-[9px] rounded-lg p-2" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
                No filters — will return all rows. Click Add Filter to narrow results.
              </p>
            )}
            <div className="space-y-2">
              {filters.map((f, i) => (
                <div key={i} className="flex items-start gap-1 rounded-lg p-2 border" style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-surface)" }}>
                  <div className="flex-1 space-y-1">
                    <AutocompleteSelect
                      value={f.column}
                      placeholder="Column..."
                      options={tableColumns.map((c) => ({ value: c.key, label: c.label || c.key }))}
                      onChange={(value) => updateFilter(i, 'column', value)}
                    />
                    <select
                      value={f.operator}
                      onChange={(e) => updateFilter(i, 'operator', e.target.value)}
                      className="w-full rounded border px-2 py-1 text-[10px]"
                      style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
                    >
                      {FILTER_OPERATORS.map((op) => (
                        <option key={op.value} value={op.value}>{op.label}</option>
                      ))}
                    </select>
                    {f.operator !== 'is_null' && f.operator !== 'not_null' && (
                      <VariableInput
                        value={f.value}
                        onChange={(v) => updateFilter(i, 'value', v)}
                        placeholder="Value or {{variable}}"
                        extraVariables={extraVariables}
                      />
                    )}
                  </div>
                  <button type="button" onClick={() => removeFilter(i)} className="mt-1 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Sort */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--theme-muted-text)" }}>
              Sort
            </label>
            <div className="flex gap-1.5">
              <AutocompleteSelect
                className="flex-1"
                value={config.sort_column ?? ""}
                placeholder="Default (newest first)"
                clearable
                options={tableColumns.map((c) => ({ value: c.key, label: c.label || c.key }))}
                onChange={(value) => onUpdate("sort_column", value)}
              />
              {config.sort_column && (
                <select
                  value={config.sort_direction ?? "asc"}
                  onChange={(e) => onUpdate("sort_direction", e.target.value)}
                  className="rounded border px-2 py-1.5 text-[10px]"
                  style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              )}
            </div>
          </div>

          {/* Limit & Offset */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-[10px] font-medium mb-0.5">Limit</label>
              <Input
                type="number"
                value={config.limit ?? 100}
                onChange={(e) => onUpdate("limit", Number(e.target.value) || 100)}
                className="!h-7 !text-[10px]"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] font-medium mb-0.5">Offset</label>
              <VariableInput
                value={config.offset ?? ''}
                onChange={(v) => onUpdate("offset", v)}
                placeholder="0 or {{variable}}"
                extraVariables={extraVariables}
              />
            </div>
          </div>

          {/* Return columns preview */}
          {tableColumns.length > 0 && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--theme-muted-text)" }}>
                Returned Columns
              </label>
              <div className="flex flex-wrap gap-1">
                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                  row_id
                </span>
                {tableColumns.map((c) => (
                  <span key={c.key} className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                    {c.key}
                    <span className="ml-0.5 opacity-50">{c.type}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── GET (single row) ─── */}
      {operation === 'get' && (
        <>
          <RowLookupFields config={config} onUpdate={onUpdate} onBatchUpdate={onBatchUpdate} verb="fetch" tableColumns={tableColumns} rowIdVariables={rowIdVariables} />

          {/* Return columns preview */}
          {selectedTable && tableColumns.length > 0 && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--theme-muted-text)" }}>
                Returned Columns
              </label>
              <div className="flex flex-wrap gap-1">
                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                  row_id
                </span>
                {tableColumns.map((c) => (
                  <span key={c.key} className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                    {c.key}
                    <span className="ml-0.5 opacity-50">{c.type}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ─── INSERT / UPDATE ─── */}
      {(operation === 'insert' || operation === 'update') && (
        <>
          {/* Row lookup — for update */}
          {operation === 'update' && (
            <RowLookupFields config={config} onUpdate={onUpdate} onBatchUpdate={onBatchUpdate} verb="update" tableColumns={tableColumns} rowIdVariables={rowIdVariables} />
          )}

          {/* Column values */}
          {selectedTable && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--theme-muted-text)" }}>
                Column Values
              </label>
              <p className="text-[9px] mb-2" style={{ color: "var(--theme-muted-text)" }}>
                Set values for each column. Use {'{{variable}}'} syntax or drag from the Variables panel.
              </p>
              {tableColumns.length > 0 ? (
                <div className="space-y-1.5">
                  {tableColumns.map((col, ci) => (
                    <div key={`${col.key}-${ci}`}>
                      <div className="flex items-center gap-1 mb-0.5">
                        <label className="text-[10px] font-mono font-medium" style={{ color: "var(--theme-primary-text)" }}>
                          {col.label || col.key}
                        </label>
                        <span className="text-[8px] px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                          {col.type}
                        </span>
                      </div>
                      <VariableInput
                        value={columnValues[col.key] ?? ''}
                        onChange={(v) => onUpdate("column_values", { ...columnValues, [col.key]: v })}
                        placeholder={`{{variable}} or value`}
                        extraVariables={extraVariables}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg p-2 text-[9px]" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
                  No columns defined on this table yet. Add columns in the Data section, or use JSON below.
                </div>
              )}

              {/* Add custom column value */}
              <div className="mt-2 flex gap-1.5">
                <Input
                  value={config._new_col_key ?? ''}
                  onChange={(e) => onUpdate("_new_col_key", e.target.value)}
                  placeholder="column_name"
                  className="!h-6 !text-[10px] font-mono flex-1"
                />
                <Button variant="outline" size="sm" className="!text-[9px] !h-6 !px-2"
                  onClick={() => {
                    const key = config._new_col_key?.trim()
                    if (key) {
                      onUpdate("column_values", { ...columnValues, [key]: '' })
                      onUpdate("_new_col_key", '')
                    }
                  }}>
                  <Plus size={8} className="mr-0.5" /> Add
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={config.apply_retention_policy === true}
                onChange={(e) => {
                  if (onBatchUpdate) onBatchUpdate({ apply_retention_policy: e.target.checked })
                  else onUpdate('apply_retention_policy', e.target.checked)
                }}
              />
              Apply row retention policy
            </label>

            {config.apply_retention_policy === true && (
              <>
                <div>
                  <label className="block text-xs font-medium mb-1">Retention Policy</label>
                  <SearchableEntityPicker
                    items={rowRetentionPolicies.map((policy: any) => ({
                      id: policy.id,
                      name: policy.name,
                      subtitle: policy.description ?? '',
                    }))}
                    selectedId={config.retention_policy_id ?? ''}
                    placeholder="Search row retention policies..."
                    emptyLabel="No row retention policies found"
                    onSelect={(id, name) => {
                      if (onBatchUpdate) onBatchUpdate({ retention_policy_id: id, retention_policy_name: name })
                      else onUpdate('retention_policy_id', id)
                    }}
                  />
                </div>
                <div className="mt-1.5">
                  <VariableInput
                    value={config.retention_policy_id ?? ''}
                    onChange={(v) => {
                      if (onBatchUpdate) onBatchUpdate({ retention_policy_id: v, retention_policy_name: '' })
                      else onUpdate('retention_policy_id', v)
                    }}
                    placeholder={operation === 'insert'
                      ? '{{retention_policy_id}}'
                      : '{{retention_policy_id}} (blank clears the row override)'}
                    extraVariables={extraVariables}
                  />
                </div>
                <p className="mt-1 text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
                  {operation === 'insert'
                    ? 'Apply a row-level retention policy when this row is created.'
                    : selectedRetentionPolicy
                    ? `Current selection: ${selectedRetentionPolicy.name}. Leave blank to clear the current row override.`
                    : 'Set or clear the row-level retention policy while updating this row.'}
                </p>
              </>
            )}
          </div>

          {/* Manual JSON fallback */}
          {!selectedTable && config.table_id && (
            <div>
              <label className="block text-xs font-medium mb-1">Data (JSON)</label>
              <VariableInput multiline rows={3} value={config.data ?? ""} onChange={(value) => onUpdate("data", value)}
                placeholder={'{"name": "{{task.title}}"}'} extraVariables={extraVariables} />
            </div>
          )}
        </>
      )}

      {/* ─── DELETE ─── */}
      {operation === 'delete' && (
        <RowLookupFields config={config} onUpdate={onUpdate} onBatchUpdate={onBatchUpdate} verb="delete" tableColumns={tableColumns} rowIdVariables={extraVariables ?? []} />
      )}

      {/* ─── Output Configuration ─── */}
      {config.table_id && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-muted-text)" }}>
            Output
          </label>

          {/* Custom output variable names */}
          {(operation === 'list' || operation === 'get') && (
            <div className="space-y-1.5">
              {operation === 'list' && (
                <>
                  <div>
                    <label className="block text-[10px] font-medium mb-0.5">Rows variable name</label>
                    <Input
                      value={config.output_rows_var ?? 'rows'}
                      onChange={(e) => onUpdate("output_rows_var", e.target.value.replace(/[^a-zA-Z0-9_]/g, '') || 'rows')}
                      className="!h-6 !text-[10px] font-mono"
                      placeholder="rows"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium mb-0.5">Count variable name</label>
                    <Input
                      value={config.output_count_var ?? 'row_count'}
                      onChange={(e) => onUpdate("output_count_var", e.target.value.replace(/[^a-zA-Z0-9_]/g, '') || 'row_count')}
                      className="!h-6 !text-[10px] font-mono"
                      placeholder="row_count"
                    />
                  </div>
                </>
              )}
              {operation === 'get' && (
                <div>
                  <label className="block text-[10px] font-medium mb-0.5">Row variable name</label>
                  <Input
                    value={config.output_row_var ?? 'row'}
                    onChange={(e) => onUpdate("output_row_var", e.target.value.replace(/[^a-zA-Z0-9_]/g, '') || 'row')}
                    className="!h-6 !text-[10px] font-mono"
                    placeholder="row"
                  />
                </div>
              )}
            </div>
          )}
          {(operation === 'insert' || operation === 'update' || operation === 'delete') && (
            <div>
              <label className="block text-[10px] font-medium mb-0.5">Row ID variable name</label>
              <Input
                value={config.output_row_id_var ?? 'row_id'}
                onChange={(e) => onUpdate("output_row_id_var", e.target.value.replace(/[^a-zA-Z0-9_]/g, '') || 'row_id')}
                className="!h-6 !text-[10px] font-mono"
                placeholder="row_id"
              />
            </div>
          )}

          {/* Live reference toggle */}
          {(operation === 'list' || operation === 'get') && (
            <label className="flex items-center gap-2 rounded-lg border p-2 cursor-pointer" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: config.live_reference ? 'var(--theme-primary-light)' : 'var(--theme-surface)' }}>
              <input
                type="checkbox"
                checked={config.live_reference ?? false}
                onChange={(e) => onUpdate("live_reference", e.target.checked)}
                className="rounded"
              />
              <div>
                <span className="text-[10px] font-medium" style={{ color: 'var(--theme-card-text)' }}>Live reference</span>
                <p className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
                  Re-query the table each time the variable is referenced downstream. Use for data that changes between steps.
                </p>
              </div>
            </label>
          )}

          {/* Output hint */}
          <div className="rounded-lg p-2 text-[9px]" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
            {operation === 'list'
              ? `Outputs: {{${config.output_rows_var || 'rows'}}} (array), {{${config.output_count_var || 'row_count'}}} (number).${config.live_reference ? ' Re-fetched on each access.' : ''}`
              : operation === 'get'
              ? `Outputs: {{${config.output_row_var || 'row'}}} (object), {{${config.output_row_id_var || 'row_id'}}}.${config.live_reference ? ' Re-fetched on each access.' : ''}`
              : `Outputs: {{${config.output_row_id_var || 'row_id'}}} of the ${operation}ed row.`
            }
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Run Agent Config ───────────────────────────────────────────────────────

function RunAgentConfig({ config, onUpdate, onBatchUpdate, extraVariables }: {
  config: Record<string, any>
  onUpdate: (key: string, value: any) => void
  onBatchUpdate: (updates: Record<string, any>) => void
  extraVariables: { name: string; group: string }[]
}) {
  const { data: agents } = useAgentOptions()
  const selectedAgent = agents?.find((a) => a.id === config.agent_id)
  const selectedAgentOutputs = useMemo(() => Array.isArray(selectedAgent?.output_config?.variables) ? selectedAgent!.output_config!.variables! : [], [selectedAgent])

  useEffect(() => {
    if (!selectedAgent) return
    const nextOutputs = selectedAgentOutputs
      .map((item) => ({
        name: String(item?.name ?? '').trim(),
        type: String(item?.type ?? 'string').trim() || 'string',
        description: String(item?.description ?? '').trim(),
      }))
      .filter((item) => item.name)

    const currentOutputs = JSON.stringify(Array.isArray(config._agent_outputs) ? config._agent_outputs : [])
    const nextSerialized = JSON.stringify(nextOutputs)
    const updates: Record<string, any> = {}
    if (config.agent_name !== selectedAgent.name) updates.agent_name = selectedAgent.name
    if (currentOutputs !== nextSerialized) updates._agent_outputs = nextOutputs
    if (Object.keys(updates).length > 0) onBatchUpdate(updates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgent, selectedAgentOutputs, config._agent_outputs, config.agent_name])

  return (
    <div className="space-y-3" onPointerDown={(e) => e.stopPropagation()}>
      {/* Agent Selector */}
      <div>
        <label className="block text-xs font-medium mb-1">Agent</label>
        <AutocompleteSelect
          value={config.agent_id ?? ''}
          placeholder="Select an agent..."
          options={(agents ?? []).map((a) => ({
            value: a.id,
            label: a.name,
            hint: !a.is_active ? 'inactive' : undefined,
          }))}
          onChange={(nextAgentId: string) => {
            const nextAgent = agents?.find((agent) => agent.id === nextAgentId)
            // One batched write — sequential updates spread the STALE config
            // snapshot, so the last clobbered agent_id and the picker
            // appeared to never select.
            onBatchUpdate({
              agent_id: nextAgentId || undefined,
              agent_name: nextAgent?.name || undefined,
              _agent_outputs: Array.isArray(nextAgent?.output_config?.variables)
                ? nextAgent!.output_config!.variables!
                    .map((item) => ({
                      name: String(item?.name ?? '').trim(),
                      type: String(item?.type ?? 'string').trim() || 'string',
                      description: String(item?.description ?? '').trim(),
                    }))
                    .filter((item) => item.name)
                : [],
            })
          }}
        />
      </div>

      {/* Message / Prompt */}
      <div>
        <label className="block text-xs font-medium mb-1">Prompt / Message</label>
        <VariableInput multiline rows={4}
          value={config.user_message ?? ""}
          onChange={(value) => onUpdate("user_message", value)}
          placeholder="What should this agent do? Use {{variables}} for dynamic values." extraVariables={extraVariables} />
      </div>

      {selectedAgent && (
        <div className="rounded-lg p-2 text-[9px] space-y-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
          <p><span className="font-semibold">Status:</span> {selectedAgent.is_active ? 'Active' : 'Inactive'}</p>
          <p><span className="font-semibold">Model:</span> {selectedAgent.model || 'Default'}</p>
          <p><span className="font-semibold">Provider linked:</span> {selectedAgent.integration_id ? 'Yes' : 'No'}</p>
          <p><span className="font-semibold">Declared outputs:</span> {selectedAgentOutputs.length}</p>
        </div>
      )}

      {/* Output Variable */}
      <div>
        <label className="block text-xs font-medium mb-1">Output Variable Name</label>
        <Input
          value={config.output_variable ?? "agent_response"}
          onChange={(e) => onUpdate("output_variable", e.target.value)}
          className="!text-xs font-mono"
        />
        <p className="text-[9px] mt-0.5" style={{ color: "var(--theme-muted-text)" }}>
          Result stored in <code style={{ color: "var(--theme-primary-text)" }}>{`{{${config.output_variable || "agent_response"}}}`}</code>
        </p>
        <p className="text-[9px] mt-0.5" style={{ color: "var(--theme-muted-text)" }}>
          Auto vars: <code style={{ color: "var(--theme-primary-text)" }}>{`{{${config.output_variable || "agent_response"}_status}}`}</code>, <code style={{ color: "var(--theme-primary-text)" }}>{`{{${config.output_variable || "agent_response"}_duration_ms}}`}</code>, <code style={{ color: "var(--theme-primary-text)" }}>{`{{${config.output_variable || "agent_response"}_iterations}}`}</code>
        </p>
      </div>

      {selectedAgentOutputs.length > 0 && (
        <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
          <div>
            <label className="block text-xs font-medium mb-1">Agent Output Variables</label>
            <p className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
              These are pulled from the selected agent and exposed as workflow variables automatically.
            </p>
          </div>
          <div className="space-y-1.5">
            {selectedAgentOutputs.map((output, index) => {
              const key = String(output?.name ?? '').trim()
              if (!key) return null
              const prefix = config._output_prefix || agentOutputPrefix(selectedAgent?.name ?? config.agent_name)
              return (
                <div key={`${key}-${index}`} className="rounded-md border px-2 py-1.5 text-[10px]" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <code style={{ color: 'var(--theme-primary-text)' }}>{`{{${key}}}`}</code>
                    <span style={{ color: 'var(--theme-muted-text)' }}>{output.type || 'string'}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span style={{ color: 'var(--theme-muted-text)' }}>{output.description || 'Structured agent output'}</span>
                    <code style={{ color: 'var(--theme-muted-text)' }}>{`{{${prefix}_${key}}}`}</code>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Share Context Toggle */}
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={config.share_context ?? true}
          onChange={(e) => onUpdate("share_context", e.target.checked)}
          className="mt-0.5 rounded"
        />
        <div>
          <span className="text-[10px] font-medium" style={{ color: "var(--theme-card-text)" }}>Share context with other agents</span>
          <p className="text-[9px]" style={{ color: "var(--theme-muted-text)" }}>
            When enabled, this agent can access messages and facts from other agents in the workflow.
          </p>
        </div>
      </label>

      {/* Max Iterations */}
      <div>
        <label className="block text-xs font-medium mb-1">Max Tool Iterations</label>
        <Input
          type="number"
          min={1}
          max={100}
          value={config.max_iterations ?? 10}
          onChange={(e) => onUpdate("max_iterations", parseInt(e.target.value) || 10)}
          className="!text-xs font-mono"
        />
      </div>

      {/* Max Duration */}
      <div>
        <label className="block text-xs font-medium mb-1">Max duration (ms)</label>
        <Input
          type="number"
          min={1000}
          step={1000}
          value={config.timeout_ms ?? ''}
          onChange={(e) => onUpdate('timeout_ms', e.target.value ? Number(e.target.value) : undefined)}
          placeholder="300000"
          className="!text-xs font-mono"
        />
        <p className="mt-1 text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>
          Wall-clock budget for the whole agent run. Default 300,000 ms (5 minutes).
        </p>
      </div>

      {/* Tip */}
      <div className="rounded-lg p-2 text-[9px]" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
        Tip: Place multiple Run Agent nodes inside a Parallel node for true multi-agent execution with shared context.
      </div>
    </div>
  )
}

