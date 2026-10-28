'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveAgent } from '@/app/actions/agents'
import { AgentPlayground } from './agent-playground'
import { cn } from '@/lib/utils'
import {
  Save, Bot, Wrench, Settings, Plus, X,
  MessageSquare, Sparkles, Shield, Target, FileOutput,
  Database, Globe, Workflow, ChevronDown, ChevronRight,
  Download, Upload,
} from 'lucide-react'
import type { AgentTool } from '@/lib/agent-tool-defs'
import { BUILTIN_TOOL_DEFS, type BuiltinToolCategory } from '@/lib/agent-tool-defs'
import { normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import { ExportAssetButton } from '@/components/shared/config-transfer'

const AI_TYPES = new Set(['openai', 'claude', 'google_gemini', 'groq', 'mistral', 'together', 'perplexity', 'deepseek', 'azure_openai', 'ollama'])
// Also match legacy integrations created as rest_api with AI base URLs
const AI_BASE_URLS = ['api.openai.com', 'api.anthropic.com', 'api.groq.com', 'api.mistral.ai', 'api.together.xyz', 'api.perplexity.ai', 'api.deepseek.com', 'generativelanguage.googleapis.com', 'openai.azure.com']
function isAiIntegration(i: { type: string; config: any }) {
  if (AI_TYPES.has(i.type)) return true
  const baseUrl = (i.config as any)?.base_url ?? ''
  return AI_BASE_URLS.some(u => baseUrl.includes(u))
}

interface AgentState {
  id: string; name: string; description: string | null
  integration_id: string | null; model: string; system_prompt: string
  role: string; task: string; boundaries: string
  temperature: number; max_tokens: number; max_iterations: number
  tools: AgentTool[]; is_active: boolean
  output_config: {
    variables: { name: string; description: string; type: string }[]
    data_access?: {
      mode: 'all' | 'selected'
      table_ids: string[]
    }
    document_access?: boolean
    workflow_scope?: {
      mode: 'all' | 'selected'
      workflow_ids: string[]
    }
    workflow_access?: boolean
    task_access?: boolean
    task_scope?: {
      mode: 'all' | 'selected'
      team_ids: string[]
      workflow_ids: string[]
    }
  }
}

interface AgentDesignerProps {
  agent: AgentState
  integrations: { id: string; name: string; type: string; config: any }[]
  references: { id: string; name: string; method: string; description: string | null; integration: { id: string; name: string } | null }[]
  dataTables: { id: string; name: string; description?: string | null; created_at?: string | null; updated_at?: string | null }[]
  workflows: { id: string; name: string; description?: string | null; trigger_type?: string | null; is_active?: boolean | null; created_at?: string | null; updated_at?: string | null }[]
  teams: { id: string; name: string; description?: string | null; created_at?: string | null; updated_at?: string | null }[]
}

type Tab = 'identity' | 'tools' | 'boundaries' | 'output' | 'settings'

type AgentPreset = {
  id: string
  name: string
  description: string
  role: string
  task: string
  boundaries: string
  output_config: AgentState['output_config']
}

const AGENT_PRESETS: AgentPreset[] = [
  {
    id: 'analyst',
    name: 'Analyst',
    description: 'Data-focused analyst that works across selected tables and returns structured findings.',
    role: 'a business analyst who investigates operational data and explains patterns clearly',
    task: 'Query approved tables, identify trends or exceptions, and return a concise analysis with clear next steps.',
    boundaries: [
      '- Use only approved tables.',
      '- Show uncertainty when the data is incomplete.',
      '- Do not make destructive changes unless explicitly instructed.',
      '- Prefer structured findings over long narrative answers.',
    ].join('\n'),
    output_config: {
      variables: [
        { name: 'summary', description: 'Top-level analysis summary', type: 'string' },
        { name: 'findings', description: 'Key findings list', type: 'array' },
      ],
      document_access: false,
      data_access: { mode: 'selected', table_ids: [] },
      task_access: false,
      task_scope: { mode: 'all', team_ids: [], workflow_ids: [] },
      workflow_access: false,
      workflow_scope: { mode: 'all', workflow_ids: [] },
    },
  },
  {
    id: 'task_coordinator',
    name: 'Task Coordinator',
    description: 'Operations helper for triaging, progressing, and escalating work within a governed task scope.',
    role: 'a task coordination assistant who keeps work moving and communicates clearly',
    task: 'Inspect approved tasks, identify blockers, and take the appropriate governed task actions to keep work progressing.',
    boundaries: [
      '- Only act on tasks inside the approved task scope.',
      '- Escalate or redirect only when the reason is clear and stated.',
      '- Do not close work silently; always capture a clear outcome or note.',
      '- Respect user ownership and avoid unnecessary churn.',
    ].join('\n'),
    output_config: {
      variables: [
        { name: 'action_summary', description: 'Summary of task actions taken', type: 'string' },
      ],
      document_access: false,
      data_access: { mode: 'all', table_ids: [] },
      task_access: true,
      task_scope: { mode: 'selected', team_ids: [], workflow_ids: [] },
      workflow_access: false,
      workflow_scope: { mode: 'all', workflow_ids: [] },
    },
  },
  {
    id: 'operations_assistant',
    name: 'Operations Assistant',
    description: 'Cross-functional agent that can work with data, workflows, tasks, and documents inside governed scopes.',
    role: 'an operations assistant who coordinates data, workflows, tasks, and documents carefully',
    task: 'Use the approved app capabilities to progress operational work, communicate status, and keep records up to date.',
    boundaries: [
      '- Stay within approved data, task, workflow, and document scopes.',
      '- Prefer reversible actions and explain why an action is being taken.',
      '- If the request needs broader access than configured, stop and say what is missing.',
    ].join('\n'),
    output_config: {
      variables: [
        { name: 'result_summary', description: 'Summary of what the assistant completed', type: 'string' },
      ],
      document_access: true,
      data_access: { mode: 'selected', table_ids: [] },
      task_access: true,
      task_scope: { mode: 'selected', team_ids: [], workflow_ids: [] },
      workflow_access: true,
      workflow_scope: { mode: 'selected', workflow_ids: [] },
    },
  },
]

function formatRelativeTimestamp(value?: string | null) {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return null
  const diffMs = Date.now() - timestamp
  const absMs = Math.abs(diffMs)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (absMs < minute) return 'just now'
  if (absMs < hour) {
    const minutes = Math.max(1, Math.round(absMs / minute))
    return `${minutes}m ago`
  }
  if (absMs < day) {
    const hours = Math.max(1, Math.round(absMs / hour))
    return `${hours}h ago`
  }
  const days = Math.max(1, Math.round(absMs / day))
  if (days < 30) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function AgentDesigner({ agent: initial, integrations, references, dataTables, workflows, teams }: AgentDesignerProps) {
  const [agent, setAgent] = useState<AgentState>({
    ...initial,
    role: (initial as any).role ?? '',
    task: (initial as any).task ?? '',
    boundaries: (initial as any).boundaries ?? '',
    output_config: normalizeAgentOutputConfig((initial as any).output_config ?? { variables: [] }),
  })
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<Tab>('identity')
  const [showPlayground, setShowPlayground] = useState(false)
  const [showAddTool, setShowAddTool] = useState(false)
  const [toolFilter, setToolFilter] = useState('')
  const [tableSearch, setTableSearch] = useState('')
  const [workflowSearch, setWorkflowSearch] = useState('')
  const [taskWorkflowSearch, setTaskWorkflowSearch] = useState('')
  const [taskTeamSearch, setTaskTeamSearch] = useState('')
  const importRef = useRef<HTMLInputElement>(null)

  const update = useCallback((patch: Partial<AgentState>) => setAgent(prev => ({ ...prev, ...patch })), [])

  const aiIntegrations = useMemo(() => integrations.filter(isAiIntegration), [integrations])
  const selectedIntegration = aiIntegrations.find(i => i.id === agent.integration_id)

  // Auto-generate system prompt from structured fields
  const generatedPrompt = useMemo(() => {
    const parts: string[] = []
    if (agent.role) parts.push(`You are ${agent.role}.`)
    if (agent.task) parts.push(`\nYour task: ${agent.task}`)
    if (agent.boundaries) parts.push(`\nBoundaries and rules:\n${agent.boundaries}`)
    if (agent.output_config?.variables?.length) {
      parts.push(`\nWhen you complete your task, structure your final response to include these outputs:`)
      for (const v of agent.output_config.variables) {
        parts.push(`- ${v.name} (${v.type}): ${v.description}`)
      }
    }
    return parts.join('\n')
  }, [agent.role, agent.task, agent.boundaries, agent.output_config])

  async function handleSave() {
    setSaving(true)
    try {
      // Save custom instructions as-is (the executor composes the full prompt from role+task+boundaries+custom)
      await saveAgent(agent.id, {
        name: agent.name, description: agent.description,
        integration_id: agent.integration_id, model: agent.model,
        system_prompt: agent.system_prompt,
        role: agent.role, task: agent.task, boundaries: agent.boundaries,
        output_config: agent.output_config,
        temperature: agent.temperature, max_tokens: agent.max_tokens,
        max_iterations: agent.max_iterations, tools: agent.tools, is_active: agent.is_active,
      })
    } catch (err) { console.error('[AgentDesigner] Save failed:', err) }
    setSaving(false)
  }

  function handleExport() {
    const exportData = {
      version: 1,
      type: 'agent',
      exportedAt: new Date().toISOString(),
      agent: {
        name: agent.name, description: agent.description,
        model: agent.model, system_prompt: agent.system_prompt,
        role: agent.role, task: agent.task, boundaries: agent.boundaries,
        temperature: agent.temperature, max_tokens: agent.max_tokens,
        max_iterations: agent.max_iterations, tools: agent.tools,
        output_config: agent.output_config, is_active: agent.is_active,
      },
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agent-${agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        // Agent designer files ({ agent }), config exports ({ agents: [...] }) or a bare agent.
        const imported = data.agent ?? (Array.isArray(data.agents) ? data.agents[0] : undefined) ?? data
        if (!imported || typeof imported !== 'object') throw new Error('not an agent')
        update({
          name: imported.name ?? agent.name,
          description: imported.description ?? agent.description,
          model: imported.model ?? agent.model,
          system_prompt: imported.system_prompt ?? '',
          role: imported.role ?? '',
          task: imported.task ?? '',
          boundaries: imported.boundaries ?? '',
          temperature: imported.temperature ?? 0.7,
          max_tokens: imported.max_tokens ?? 4096,
          max_iterations: imported.max_iterations ?? 10,
          tools: imported.tools ?? [],
          output_config: imported.output_config ?? { variables: [] },
          is_active: imported.is_active ?? true,
        })
      } catch { alert('Invalid agent JSON file') }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  function addReferenceTool(ref: typeof references[0]) {
    const tool: AgentTool = {
      id: crypto.randomUUID(), type: 'reference',
      name: ref.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      description: ref.description || `Call ${ref.name}`,
      referenceId: ref.id, inputSchema: [],
    }
    update({ tools: [...agent.tools, tool] })
    setShowAddTool(false)
  }

  function addBuiltinTool(bt: AgentTool) {
    if (agent.tools.some(t => t.name === bt.name)) return
    update({ tools: [...agent.tools, { ...bt, id: crypto.randomUUID() }] })
  }

  function removeTool(toolId: string) {
    update({ tools: agent.tools.filter(t => t.id !== toolId) })
  }

  function updateOutputVar(index: number, field: string, value: string) {
    const vars = [...(agent.output_config?.variables ?? [])]
    vars[index] = { ...vars[index], [field]: value }
    update({ output_config: { ...agent.output_config, variables: vars } })
  }

  function addOutputVar() {
    const vars = [...(agent.output_config?.variables ?? []), { name: '', description: '', type: 'string' }]
    update({ output_config: { ...agent.output_config, variables: vars } })
  }

  function removeOutputVar(index: number) {
    const vars = (agent.output_config?.variables ?? []).filter((_: any, i: number) => i !== index)
    update({ output_config: { ...agent.output_config, variables: vars } })
  }

  function applyPreset(preset: AgentPreset) {
    update({
      role: preset.role,
      task: preset.task,
      boundaries: preset.boundaries,
      output_config: normalizeAgentOutputConfig(preset.output_config),
    })
  }

  const selectedTableIds = new Set(agent.output_config?.data_access?.table_ids ?? [])
  const selectedWorkflowIds = new Set(agent.output_config?.workflow_scope?.workflow_ids ?? [])
  const selectedTaskWorkflowIds = new Set(agent.output_config?.task_scope?.workflow_ids ?? [])
  const selectedTaskTeamIds = new Set(agent.output_config?.task_scope?.team_ids ?? [])
  const tableOptions = dataTables.map((table) => ({
    id: table.id,
    name: table.name,
    subtitle: [table.description, formatRelativeTimestamp(table.updated_at ?? table.created_at) ? `Updated ${formatRelativeTimestamp(table.updated_at ?? table.created_at)}` : null].filter(Boolean).join(' • '),
    searchText: [table.name, table.description].filter(Boolean).join(' ').toLowerCase(),
  }))
  const filteredTableOptions = useMemo(() => {
    const query = tableSearch.trim().toLowerCase()
    const matches = query ? tableOptions.filter((table) => table.searchText.includes(query)) : tableOptions.slice(0, 8)
    const selectedMatches = tableOptions.filter((table) => selectedTableIds.has(table.id))
    const merged = [...selectedMatches, ...matches]
    return merged.filter((table, index, list) => list.findIndex((entry) => entry.id === table.id) === index)
  }, [tableOptions, tableSearch, selectedTableIds])
  const workflowOptions = workflows.map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    subtitle: [
      workflow.description,
      workflow.trigger_type ? `Trigger: ${workflow.trigger_type}` : null,
      workflow.is_active === true ? 'Active' : 'Inactive',
      formatRelativeTimestamp(workflow.updated_at ?? workflow.created_at) ? `Updated ${formatRelativeTimestamp(workflow.updated_at ?? workflow.created_at)}` : null,
    ].filter(Boolean).join(' • '),
    searchText: [workflow.name, workflow.description, workflow.trigger_type, workflow.is_active ? 'active' : 'inactive'].filter(Boolean).join(' ').toLowerCase(),
  }))
  const filteredWorkflowOptions = useMemo(() => {
    const query = workflowSearch.trim().toLowerCase()
    const matches = query ? workflowOptions.filter((workflow) => workflow.searchText.includes(query)) : workflowOptions.slice(0, 8)
    const selectedMatches = workflowOptions.filter((workflow) => selectedWorkflowIds.has(workflow.id))
    const merged = [...selectedMatches, ...matches]
    return merged.filter((workflow, index, list) => list.findIndex((entry) => entry.id === workflow.id) === index)
  }, [workflowOptions, workflowSearch, selectedWorkflowIds])
  const teamOptions = teams.map((team) => ({
    id: team.id,
    name: team.name,
    subtitle: [team.description, formatRelativeTimestamp(team.updated_at ?? team.created_at) ? `Updated ${formatRelativeTimestamp(team.updated_at ?? team.created_at)}` : null].filter(Boolean).join(' • '),
    searchText: [team.name, team.description].filter(Boolean).join(' ').toLowerCase(),
  }))
  const filteredTaskTeamOptions = useMemo(() => {
    const query = taskTeamSearch.trim().toLowerCase()
    const matches = query ? teamOptions.filter((team) => team.searchText.includes(query)) : teamOptions.slice(0, 8)
    const selectedMatches = teamOptions.filter((team) => selectedTaskTeamIds.has(team.id))
    const merged = [...selectedMatches, ...matches]
    return merged.filter((team, index, list) => list.findIndex((entry) => entry.id === team.id) === index)
  }, [teamOptions, taskTeamSearch, selectedTaskTeamIds])
  const filteredTaskWorkflowOptions = useMemo(() => {
    const query = taskWorkflowSearch.trim().toLowerCase()
    const matches = query ? workflowOptions.filter((workflow) => workflow.searchText.includes(query)) : workflowOptions.slice(0, 8)
    const selectedMatches = workflowOptions.filter((workflow) => selectedTaskWorkflowIds.has(workflow.id))
    const merged = [...selectedMatches, ...matches]
    return merged.filter((workflow, index, list) => list.findIndex((entry) => entry.id === workflow.id) === index)
  }, [workflowOptions, taskWorkflowSearch, selectedTaskWorkflowIds])
  const selectedTableCount = agent.output_config?.data_access?.mode === 'all' ? dataTables.length : selectedTableIds.size
  const selectedWorkflowCount = agent.output_config?.workflow_scope?.mode === 'selected' ? selectedWorkflowIds.size : workflows.length
  const selectedTaskScopeCount =
    selectedTaskTeamIds.size + selectedTaskWorkflowIds.size
  const capabilityBadges = [
    `Data: ${agent.output_config?.data_access?.mode === 'selected' ? `${selectedTableCount} table${selectedTableCount === 1 ? '' : 's'}` : 'all tables'}`,
    agent.output_config?.document_access ? 'Documents enabled' : null,
    agent.output_config?.task_access
      ? `Tasks: ${agent.output_config?.task_scope?.mode === 'selected' ? `${selectedTaskScopeCount} scope item${selectedTaskScopeCount === 1 ? '' : 's'}` : 'all accessible'}`
      : null,
    agent.output_config?.workflow_access
      ? `Workflows: ${agent.output_config?.workflow_scope?.mode === 'selected' ? `${selectedWorkflowCount} selected` : 'all'}`
      : null,
  ].filter(Boolean) as string[]
  const governedCapabilityCards = [
    {
      key: 'documents',
      title: 'Documents & files',
      icon: <Database size={12} />,
      summary: agent.output_config?.document_access ? 'File and document helpers enabled' : 'Disabled',
      description: 'Lets the agent use file helpers like CSV reading, downloads, and spreadsheet/document generation.',
      enabled: agent.output_config?.document_access === true,
      actionNames: ['generate_word_document', 'generate_excel', 'read_csv_file', 'download_file', 'read_file_content'],
    },
    {
      key: 'data',
      title: 'Data actions',
      icon: <Database size={12} />,
      summary: agent.output_config?.data_access?.mode === 'selected' ? `${selectedTableCount} selected table${selectedTableCount === 1 ? '' : 's'}` : 'All tenant tables',
      description: 'Lets the agent query rows, insert rows, and update matching rows in approved data tables.',
      enabled: true,
      actionNames: ['query_data_table', 'insert_data_row', 'update_data_rows'],
    },
    {
      key: 'tasks',
      title: 'Task actions',
      icon: <Workflow size={12} />,
      summary: agent.output_config?.task_access
        ? agent.output_config?.task_scope?.mode === 'selected'
          ? `${selectedTaskScopeCount} selected scope item${selectedTaskScopeCount === 1 ? '' : 's'}`
          : 'All tasks the signed-in user can access'
        : 'Disabled',
      description: 'Lets the agent inspect tasks and respond, complete, escalate, or redirect them within the approved task scope.',
      enabled: agent.output_config?.task_access === true,
      actionNames: ['get_task_status', 'respond_to_task', 'complete_task', 'complete_workflow_task', 'escalate_task', 'redirect_task'],
    },
    {
      key: 'workflows',
      title: 'Workflow actions',
      icon: <Workflow size={12} />,
      summary: agent.output_config?.workflow_access
        ? agent.output_config?.workflow_scope?.mode === 'selected'
          ? `${selectedWorkflowCount} selected workflow${selectedWorkflowCount === 1 ? '' : 's'}`
          : 'All workflows'
        : 'Disabled',
      description: 'Lets the agent start workflows, inspect runs, and complete waiting server events in the approved workflow scope.',
      enabled: agent.output_config?.workflow_access === true,
      actionNames: ['start_workflow_run', 'get_workflow_run_status', 'complete_server_event'],
    },
  ]

  function updateDataAccessMode(mode: 'all' | 'selected') {
    update({
      output_config: {
        ...agent.output_config,
        data_access: {
          mode,
          table_ids: mode === 'selected' ? (agent.output_config?.data_access?.table_ids ?? []) : [],
        },
      },
    })
  }

  function toggleDataTable(tableId: string, checked: boolean) {
    const current = agent.output_config?.data_access?.table_ids ?? []
    const next = checked
      ? Array.from(new Set([...current, tableId]))
      : current.filter((id) => id !== tableId)
    update({
      output_config: {
        ...agent.output_config,
        data_access: {
          mode: 'selected',
          table_ids: next,
        },
      },
    })
  }

  function updateWorkflowAccessMode(mode: 'all' | 'selected') {
    update({
      output_config: {
        ...agent.output_config,
        workflow_scope: {
          mode,
          workflow_ids: mode === 'selected' ? (agent.output_config?.workflow_scope?.workflow_ids ?? []) : [],
        },
      },
    })
  }

  function toggleWorkflow(workflowId: string, checked: boolean) {
    const current = agent.output_config?.workflow_scope?.workflow_ids ?? []
    const next = checked
      ? Array.from(new Set([...current, workflowId]))
      : current.filter((id) => id !== workflowId)
    update({
      output_config: {
        ...agent.output_config,
        workflow_scope: {
          mode: 'selected',
          workflow_ids: next,
        },
      },
    })
  }

  function updateTaskAccessMode(mode: 'all' | 'selected') {
    update({
      output_config: {
        ...agent.output_config,
        task_scope: {
          mode,
          team_ids: mode === 'selected' ? (agent.output_config?.task_scope?.team_ids ?? []) : [],
          workflow_ids: mode === 'selected' ? (agent.output_config?.task_scope?.workflow_ids ?? []) : [],
        },
      },
    })
  }

  function toggleTaskScopeId(kind: 'team_ids' | 'workflow_ids', id: string, checked: boolean) {
    const current = agent.output_config?.task_scope?.[kind] ?? []
    const next = checked ? Array.from(new Set([...current, id])) : current.filter((entry) => entry !== id)
    update({
      output_config: {
        ...agent.output_config,
        task_scope: {
          mode: 'selected',
          team_ids: kind === 'team_ids' ? next : (agent.output_config?.task_scope?.team_ids ?? []),
          workflow_ids: kind === 'workflow_ids' ? next : (agent.output_config?.task_scope?.workflow_ids ?? []),
        },
      },
    })
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'identity', label: 'Identity & Task', icon: <Target size={12} /> },
    { id: 'tools', label: `Tools (${agent.tools.length})`, icon: <Wrench size={12} /> },
    { id: 'boundaries', label: 'Boundaries', icon: <Shield size={12} /> },
    { id: 'output', label: 'Output', icon: <FileOutput size={12} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={12} /> },
  ]

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
          <Bot size={20} />
        </div>
        <div className="flex-1">
          <Input value={agent.name} onChange={e => update({ name: e.target.value })} className="!text-lg !font-semibold !h-9 !border-none !p-0 !shadow-none" placeholder="Agent Name" />
          <Input value={agent.description ?? ''} onChange={e => update({ description: e.target.value || null })} className="!text-xs !h-6 !border-none !p-0 !shadow-none" placeholder="Brief description..." style={{ color: 'var(--theme-muted-text)' }} />
          {capabilityBadges.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {capabilityBadges.map((badge) => (
                <span key={badge} className="rounded-full px-2 py-0.5 text-[9px] font-semibold" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                  {badge}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: agent.is_active ? 'var(--theme-success)' : 'var(--theme-muted-text)' }}>
            <input type="checkbox" checked={agent.is_active} onChange={e => update({ is_active: e.target.checked })} />
            {agent.is_active ? 'Active' : 'Inactive'}
          </label>
          <Button variant="ghost" size="sm" onClick={handleExport} title="Download the agent settings as JSON" aria-label="Download agent JSON"><Download size={14} /></Button>
          <Button variant="ghost" size="sm" onClick={() => importRef.current?.click()} title="Load settings from an agent JSON or configuration export into this agent (save to keep)" aria-label="Load agent JSON"><Upload size={14} /></Button>
          <ExportAssetButton ids={[agent.id]} name={agent.name} />
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          <Button variant="outline" size="sm" onClick={() => setShowPlayground(!showPlayground)}>
            <MessageSquare size={14} className="mr-1" /> {showPlayground ? 'Hide' : 'Test'}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save size={14} className="mr-1" /> {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Provider bar */}
      <div className="flex items-center gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
        <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--theme-muted-text)' }}>Provider</span>
        <select value={agent.integration_id ?? ''} onChange={e => update({ integration_id: e.target.value || null })}
          className="rounded border px-2 py-1 text-xs flex-1 max-w-xs"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
          <option value="">Select AI provider...</option>
          {aiIntegrations.map(i => <option key={i.id} value={i.id}>{i.name} ({i.type})</option>)}
        </select>
        <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--theme-muted-text)' }}>Model</span>
        <Input value={agent.model} onChange={e => update({ model: e.target.value })} placeholder="gpt-4o" className="!text-xs !h-7 max-w-[200px]" />
        {selectedIntegration && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
            {selectedIntegration.type}
          </span>
        )}
      </div>

      <div className="flex gap-4">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Tabs */}
          <div className="flex border-b mb-3" style={{ borderColor: 'var(--theme-surface-border)' }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium relative transition-colors"
                style={{ color: tab === t.id ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}>
                {t.icon} {t.label}
                {tab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ backgroundColor: 'var(--theme-primary)' }} />}
              </button>
            ))}
          </div>

          {/* Identity & Task tab */}
          {tab === 'identity' && (
            <div className="space-y-4">
              <Section title="Starter Presets" icon={<Sparkles size={12} />} description="Start from a governed baseline, then fine-tune the prompt and access scopes instead of building every agent from scratch.">
                <div className="grid gap-3 md:grid-cols-2">
                  {AGENT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="rounded-lg border p-3 text-left transition-all hover:shadow-sm"
                      style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>{preset.name}</p>
                          <p className="mt-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{preset.description}</p>
                        </div>
                        <span className="rounded-full px-2 py-0.5 text-[8px] font-semibold uppercase" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                          Apply
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                  Presets intentionally keep selected scopes empty where governance matters, so the next step is to choose the approved tables, workflows, recipients, and teams this agent should actually use.
                </p>
              </Section>

              <Section title="Agent Role" icon={<Bot size={12} />} description="Who is this agent? Define its persona and expertise.">
                <textarea value={agent.role} onChange={e => update({ role: e.target.value })} rows={3}
                  placeholder="e.g. a senior data analyst with expertise in financial reporting and SQL. You communicate clearly and always provide actionable insights."
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }} />
              </Section>

              <Section title="Task" icon={<Target size={12} />} description="What should this agent accomplish? Be specific about the goal.">
                <textarea value={agent.task} onChange={e => update({ task: e.target.value })} rows={4}
                  placeholder="e.g. Analyze the provided sales data, identify top-performing products, calculate month-over-month growth, and generate a summary report with recommendations."
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }} />
              </Section>

              <Section title="Custom Instructions" icon={<Sparkles size={12} />} description="Additional instructions beyond role and task. This is appended to the generated system prompt.">
                <textarea value={agent.system_prompt} onChange={e => update({ system_prompt: e.target.value })} rows={5}
                  placeholder="Any additional context, formatting preferences, or specific instructions..."
                  className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
                  style={{ backgroundColor: 'var(--theme-surface)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }} />
              </Section>

              {/* Preview */}
              {(agent.role || agent.task) && (
                <div className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                  <p className="text-[9px] font-semibold uppercase mb-1" style={{ color: 'var(--theme-muted-text)' }}>Generated System Prompt Preview</p>
                  <pre className="text-[10px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--theme-card-text)' }}>{generatedPrompt || 'Fill in role and task above to see the generated prompt.'}</pre>
                </div>
              )}
            </div>
          )}

          {/* Tools tab */}
          {tab === 'tools' && (
            <div className="space-y-3">
              <Section title="Capability Bundles" icon={<Sparkles size={12} />} description="Use these bundles to understand what the agent can actually do. The built-in tools below are the low-level implementation; most teams can think in terms of these governed capabilities instead.">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {governedCapabilityCards.map((card) => (
                    <div
                      key={card.key}
                      className="rounded-lg border p-3"
                      style={{ borderColor: card.enabled ? 'var(--theme-primary-light)' : 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span style={{ color: card.enabled ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}>{card.icon}</span>
                            <p className="text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>{card.title}</p>
                          </div>
                          <p className="mt-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{card.description}</p>
                        </div>
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[8px] font-semibold uppercase"
                          style={{
                            backgroundColor: card.enabled ? 'var(--theme-primary-light)' : 'var(--theme-surface-border)',
                            color: card.enabled ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
                          }}
                        >
                          {card.enabled ? 'Enabled' : 'Off'}
                        </span>
                      </div>
                      <div className="mt-2 rounded-md px-2 py-1.5 text-[10px]" style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}>
                        {card.summary}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {card.actionNames.map((name) => (
                          <span key={name} className="rounded-full px-2 py-0.5 text-[9px] font-mono" style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-muted-text)' }}>
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              <Section title="Access Scope" icon={<Workflow size={12} />} description="Keep agent payloads tight by limiting which assets it can work with.">
                <div className="space-y-3">
                  <div className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--theme-muted-text)' }}>Data tables</p>
                        <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Choose all tables or only the ones this agent is allowed to query/update.</p>
                      </div>
                      <select
                        value={agent.output_config?.data_access?.mode ?? 'all'}
                        onChange={(e) => updateDataAccessMode(e.target.value === 'selected' ? 'selected' : 'all')}
                        className="rounded border px-2 py-1 text-xs"
                        style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                      >
                        <option value="all">All tables</option>
                        <option value="selected">Selected tables</option>
                      </select>
                    </div>

                    {agent.output_config?.data_access?.mode === 'selected' && (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                            {selectedTableIds.size} selected
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="rounded border px-2 py-1 text-[10px] font-medium hover:opacity-90"
                              style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                              onClick={() => {
                                const visibleIds = filteredTableOptions.map((table) => table.id)
                                const current = agent.output_config?.data_access?.table_ids ?? []
                                update({
                                  output_config: {
                                    ...agent.output_config,
                                    data_access: {
                                      mode: 'selected',
                                      table_ids: Array.from(new Set([...current, ...visibleIds])),
                                    },
                                  },
                                })
                              }}
                            >
                              Select visible
                            </button>
                            <button
                              type="button"
                              className="rounded border px-2 py-1 text-[10px] font-medium hover:opacity-90"
                              style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}
                              onClick={() => {
                                const visibleIds = new Set(filteredTableOptions.map((table) => table.id))
                                const current = agent.output_config?.data_access?.table_ids ?? []
                                update({
                                  output_config: {
                                    ...agent.output_config,
                                    data_access: {
                                      mode: 'selected',
                                      table_ids: current.filter((id) => !visibleIds.has(id)),
                                    },
                                  },
                                })
                              }}
                            >
                              Clear visible
                            </button>
                          </div>
                        </div>
                        <Input
                          value={tableSearch}
                          onChange={(e) => setTableSearch(e.target.value)}
                          placeholder="Search tables..."
                          className="!h-7 !text-xs"
                        />
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {filteredTableOptions.map((table) => (
                            <label key={table.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:opacity-80">
                              <input
                                type="checkbox"
                                checked={selectedTableIds.has(table.id)}
                                onChange={(event) => toggleDataTable(table.id, event.target.checked)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                  <span className="block truncate text-xs" style={{ color: 'var(--theme-card-text)' }}>{table.name}</span>
                                  {selectedTableIds.has(table.id) ? (
                                    <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                                      Selected
                                    </span>
                                  ) : null}
                                </span>
                                {table.subtitle ? <span className="block truncate text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{table.subtitle}</span> : null}
                              </span>
                            </label>
                          ))}
                          {tableOptions.length === 0 && (
                            <p className="px-2 py-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>No data tables found in this tenant yet.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="rounded-lg border p-3 flex items-start gap-2 cursor-pointer" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                      <input
                        type="checkbox"
                        checked={agent.output_config?.document_access === true}
                        onChange={(e) => update({ output_config: { ...agent.output_config, document_access: e.target.checked } })}
                      />
                      <span>
                        <span className="block text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>Document & file utilities</span>
                        <span className="block text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Enable governed document search plus file helpers like CSV reading, downloads, and spreadsheet/document generation.</span>
                      </span>
                    </label>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={agent.output_config?.task_access === true}
                          onChange={(e) => update({
                            output_config: {
                              ...agent.output_config,
                              task_access: e.target.checked,
                              task_scope: e.target.checked
                                ? (agent.output_config?.task_scope ?? { mode: 'all', team_ids: [], workflow_ids: [] })
                                : { mode: 'all', team_ids: [], workflow_ids: [] },
                            },
                          })}
                        />
                        <span>
                          <span className="block text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>Task access</span>
                          <span className="block text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Allow the agent to inspect tasks and take task actions, optionally limited to selected teams or workflows.</span>
                        </span>
                      </label>

                      {agent.output_config?.task_access === true && (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--theme-muted-text)' }}>Task scope</p>
                              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>The agent still respects the signed-in user’s access, then narrows tasks further to the scopes you choose here.</p>
                            </div>
                            <select
                              value={agent.output_config?.task_scope?.mode ?? 'all'}
                              onChange={(e) => updateTaskAccessMode(e.target.value === 'selected' ? 'selected' : 'all')}
                              className="rounded border px-2 py-1 text-xs"
                              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                            >
                              <option value="all">All accessible tasks</option>
                              <option value="selected">Selected scope</option>
                            </select>
                          </div>

                          {agent.output_config?.task_scope?.mode === 'selected' && (
                            <div className="space-y-3">
                              <div className="grid gap-3 md:grid-cols-2">
                                <div className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--theme-muted-text)' }}>Teams</p>
                                    <span className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>{selectedTaskTeamIds.size} selected</span>
                                  </div>
                                  <Input value={taskTeamSearch} onChange={(e) => setTaskTeamSearch(e.target.value)} placeholder="Search teams..." className="!h-7 !text-xs mb-2" />
                                  <div className="max-h-40 overflow-y-auto space-y-1">
                                    {filteredTaskTeamOptions.map((team) => (
                                      <label key={team.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:opacity-80">
                                        <input
                                          type="checkbox"
                                          checked={selectedTaskTeamIds.has(team.id)}
                                          onChange={(event) => toggleTaskScopeId('team_ids', team.id, event.target.checked)}
                                        />
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate text-xs" style={{ color: 'var(--theme-card-text)' }}>{team.name}</span>
                                          {team.subtitle ? <span className="block truncate text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{team.subtitle}</span> : null}
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                </div>

                                <div className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                                  <div className="mb-2 flex items-center justify-between gap-2">
                                    <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--theme-muted-text)' }}>Workflows</p>
                                    <span className="text-[9px]" style={{ color: 'var(--theme-muted-text)' }}>{selectedTaskWorkflowIds.size} selected</span>
                                  </div>
                                  <Input value={taskWorkflowSearch} onChange={(e) => setTaskWorkflowSearch(e.target.value)} placeholder="Search workflows..." className="!h-7 !text-xs mb-2" />
                                  <div className="max-h-40 overflow-y-auto space-y-1">
                                    {filteredTaskWorkflowOptions.map((workflow) => (
                                      <label key={workflow.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:opacity-80">
                                        <input
                                          type="checkbox"
                                          checked={selectedTaskWorkflowIds.has(workflow.id)}
                                          onChange={(event) => toggleTaskScopeId('workflow_ids', workflow.id, event.target.checked)}
                                        />
                                        <span className="min-w-0 flex-1">
                                          <span className="block truncate text-xs" style={{ color: 'var(--theme-card-text)' }}>{workflow.name}</span>
                                          {workflow.subtitle ? <span className="block truncate text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{workflow.subtitle}</span> : null}
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={agent.output_config?.workflow_access === true}
                          onChange={(e) => update({
                            output_config: {
                              ...agent.output_config,
                              workflow_access: e.target.checked,
                              workflow_scope: e.target.checked
                                ? (agent.output_config?.workflow_scope ?? { mode: 'all', workflow_ids: [] })
                                : { mode: 'all', workflow_ids: [] },
                            },
                          })}
                        />
                        <span>
                          <span className="block text-xs font-medium" style={{ color: 'var(--theme-card-text)' }}>Workflow access</span>
                          <span className="block text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Allow the agent to start workflows, inspect run status, and complete waiting server events.</span>
                        </span>
                      </label>

                      {agent.output_config?.workflow_access === true && (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-semibold uppercase" style={{ color: 'var(--theme-muted-text)' }}>Workflow scope</p>
                              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Keep workflow actions limited to all workflows or only an approved subset.</p>
                            </div>
                            <select
                              value={agent.output_config?.workflow_scope?.mode ?? 'all'}
                              onChange={(e) => updateWorkflowAccessMode(e.target.value === 'selected' ? 'selected' : 'all')}
                              className="rounded border px-2 py-1 text-xs"
                              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                            >
                              <option value="all">All workflows</option>
                              <option value="selected">Selected workflows</option>
                            </select>
                          </div>

                          {agent.output_config?.workflow_scope?.mode === 'selected' && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                                  {selectedWorkflowIds.size} selected
                                </span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    className="rounded border px-2 py-1 text-[10px] font-medium hover:opacity-90"
                                    style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
                                    onClick={() => {
                                      const visibleIds = filteredWorkflowOptions.map((workflow) => workflow.id)
                                      const current = agent.output_config?.workflow_scope?.workflow_ids ?? []
                                      update({
                                        output_config: {
                                          ...agent.output_config,
                                          workflow_scope: {
                                            mode: 'selected',
                                            workflow_ids: Array.from(new Set([...current, ...visibleIds])),
                                          },
                                        },
                                      })
                                    }}
                                  >
                                    Select visible
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded border px-2 py-1 text-[10px] font-medium hover:opacity-90"
                                    style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}
                                    onClick={() => {
                                      const visibleIds = new Set(filteredWorkflowOptions.map((workflow) => workflow.id))
                                      const current = agent.output_config?.workflow_scope?.workflow_ids ?? []
                                      update({
                                        output_config: {
                                          ...agent.output_config,
                                          workflow_scope: {
                                            mode: 'selected',
                                            workflow_ids: current.filter((id) => !visibleIds.has(id)),
                                          },
                                        },
                                      })
                                    }}
                                  >
                                    Clear visible
                                  </button>
                                </div>
                              </div>
                              <Input
                                value={workflowSearch}
                                onChange={(e) => setWorkflowSearch(e.target.value)}
                                placeholder="Search workflows..."
                                className="!h-7 !text-xs"
                              />
                              <div className="max-h-40 overflow-y-auto space-y-1">
                                {filteredWorkflowOptions.map((workflow) => (
                                  <label key={workflow.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:opacity-80">
                                    <input
                                      type="checkbox"
                                      checked={selectedWorkflowIds.has(workflow.id)}
                                      onChange={(event) => toggleWorkflow(workflow.id, event.target.checked)}
                                    />
                                    <span className="min-w-0 flex-1">
                                      <span className="flex items-center gap-2">
                                        <span className="block truncate text-xs" style={{ color: 'var(--theme-card-text)' }}>{workflow.name}</span>
                                        {selectedWorkflowIds.has(workflow.id) ? (
                                          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-semibold uppercase" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                                            Selected
                                          </span>
                                        ) : null}
                                      </span>
                                      {workflow.subtitle ? <span className="block truncate text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{workflow.subtitle}</span> : null}
                                    </span>
                                  </label>
                                ))}
                                {workflowOptions.length === 0 && (
                                  <p className="px-2 py-1 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>No workflows found in this tenant yet.</p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </Section>

              <div className="rounded-lg px-3 py-2 text-[10px]" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                <strong>Simple mental model:</strong> first choose the capability bundles you want enabled, then narrow their scope. Most builders never need to think in raw tool names unless they are doing something advanced.
              </div>

              {/* Current tools */}
              <div className="space-y-1.5">
                {agent.tools.map(tool => (
                  <div key={tool.id} className="flex items-center gap-2 rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                    <span style={{ color: tool.type === 'builtin' ? 'var(--theme-warning)' : tool.type === 'reference' ? 'var(--theme-primary-text)' : 'var(--theme-success)' }}>
                      {tool.type === 'builtin' ? <Sparkles size={13} /> : tool.type === 'reference' ? <Globe size={13} /> : <Workflow size={13} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold font-mono" style={{ color: 'var(--theme-card-text)' }}>{tool.name}</span>
                        <span className="text-[8px] font-medium px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>{tool.type}</span>
                      </div>
                      <p className="text-[10px] truncate" style={{ color: 'var(--theme-muted-text)' }}>{tool.description}</p>
                    </div>
                    <button onClick={() => removeTool(tool.id)} className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-danger, #DC2626)' }}><X size={12} /></button>
                  </div>
                ))}
                {agent.tools.length === 0 && (
                  <p className="text-xs py-6 text-center" style={{ color: 'var(--theme-muted-text)' }}>No tools configured. Add tools below to give the agent capabilities.</p>
                )}
              </div>

              {/* Built-in tools by category */}
              {([
                { key: 'core' as BuiltinToolCategory, label: 'Core', icon: <Sparkles size={12} />, desc: 'Basic capabilities' },
                { key: 'data' as BuiltinToolCategory, label: 'Data Store', icon: <Database size={12} />, desc: 'Query, insert, and update data tables' },
                { key: 'workflow' as BuiltinToolCategory, label: 'Workflow & Tasks', icon: <Workflow size={12} />, desc: 'Start workflows and inspect tasks/runs' },
                { key: 'documents' as BuiltinToolCategory, label: 'Documents', icon: <Sparkles size={12} />, desc: 'Generate Word, Excel, read CSV' },
                { key: 'http' as BuiltinToolCategory, label: 'HTTP', icon: <Globe size={12} />, desc: 'Make HTTP requests' },
                { key: 'files' as BuiltinToolCategory, label: 'Files', icon: <Sparkles size={12} />, desc: 'Download and read files' },
                { key: 'multi_agent' as BuiltinToolCategory, label: 'Multi-Agent', icon: <Bot size={12} />, desc: 'Share context between agents' },
              ]).map(cat => {
                const catTools = BUILTIN_TOOL_DEFS.filter(bt => bt.category === cat.key)
                if (catTools.length === 0) return null
                return (
                  <Section key={cat.key} title={cat.label} icon={cat.icon} description={`${cat.desc}. These are the advanced low-level tool switches behind the capability bundles above.`}>
                    <div className="grid grid-cols-2 gap-1.5">
                      {catTools.map(bt => {
                        const added = agent.tools.some(t => t.name === bt.name)
                        return (
                          <button key={bt.id} onClick={() => !added && addBuiltinTool(bt)} disabled={added}
                            className={cn('text-left rounded-lg border px-3 py-2 text-xs transition-all', added ? 'opacity-40' : 'hover:shadow-sm')}
                            style={{ borderColor: added ? 'var(--theme-primary)' : 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                            <span className="font-mono font-medium" style={{ color: 'var(--theme-card-text)' }}>{bt.name}</span>
                            <p className="text-[9px] mt-0.5 line-clamp-2" style={{ color: 'var(--theme-muted-text)' }}>{bt.description}</p>
                            {added && <span className="text-[8px] font-semibold" style={{ color: 'var(--theme-success)' }}>Added</span>}
                          </button>
                        )
                      })}
                    </div>
                  </Section>
                )
              })}

              {/* Reference tools */}
              <Section title="API References" icon={<Globe size={12} />} description="Add integration references as tools the agent can call">
                <div className="relative mb-2">
                  <Input value={toolFilter} onChange={e => setToolFilter(e.target.value)} placeholder="Filter references..." className="!text-xs !h-7" />
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {references.filter(r => {
                    const q = toolFilter.toLowerCase()
                    return (!q || r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)) && !agent.tools.some(t => t.referenceId === r.id)
                  }).map(ref => (
                    <button key={ref.id} onClick={() => addReferenceTool(ref)}
                      className="w-full text-left rounded-lg border px-3 py-2 text-xs hover:shadow-sm transition-all"
                      style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium" style={{ color: 'var(--theme-card-text)' }}>{ref.name}</span>
                        <span className="text-[8px] font-mono px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>{ref.method}</span>
                        {ref.integration && <span className="text-[8px]" style={{ color: 'var(--theme-muted-text)' }}>{ref.integration.name}</span>}
                      </div>
                      {ref.description && <p className="text-[9px] mt-0.5 truncate" style={{ color: 'var(--theme-muted-text)' }}>{ref.description}</p>}
                    </button>
                  ))}
                  {references.filter(r => !agent.tools.some(t => t.referenceId === r.id)).length === 0 && (
                    <p className="text-[10px] text-center py-3" style={{ color: 'var(--theme-muted-text)' }}>All references are added or no references available.</p>
                  )}
                </div>
              </Section>
            </div>
          )}

          {/* Boundaries tab */}
          {tab === 'boundaries' && (
            <div className="space-y-4">
              <Section title="Boundaries & Rules" icon={<Shield size={12} />} description="Define what the agent should and should NOT do. These constraints keep the agent safe and focused.">
                <textarea value={agent.boundaries} onChange={e => update({ boundaries: e.target.value })} rows={10}
                  placeholder={"Examples:\n- Never share personally identifiable information (PII)\n- Only use approved data sources — do not make up data\n- If you are unsure, say so rather than guessing\n- Limit responses to the scope of the assigned task\n- Do not execute any destructive operations (DELETE, DROP)\n- Always cite your sources when providing data\n- Maximum 3 tool calls per request to prevent loops"}
                  className="w-full rounded-lg border px-4 py-3 text-sm leading-relaxed"
                  style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }} />
              </Section>

              <div className="rounded-lg px-3 py-2 text-[10px]" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                <strong>Tip:</strong> Boundaries are injected into the system prompt as rules the agent must follow. Be explicit — agents follow instructions better when boundaries are clear and specific.
              </div>
            </div>
          )}

          {/* Output tab */}
          {tab === 'output' && (
            <div className="space-y-4">
              <Section title="Output Variables" icon={<FileOutput size={12} />} description="Define structured outputs the agent should produce. These become workflow variables when the agent is used in a Run Agent node.">
                <div className="space-y-2">
                  {(agent.output_config?.variables ?? []).map((v: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--theme-surface-border)' }}>
                      <div className="flex-1 grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Variable Name</label>
                          <Input value={v.name} onChange={e => updateOutputVar(i, 'name', e.target.value)} placeholder="summary" className="!text-xs !h-7 font-mono" />
                        </div>
                        <div>
                          <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Type</label>
                          <select value={v.type} onChange={e => updateOutputVar(i, 'type', e.target.value)}
                            className="w-full rounded border px-2 py-1 text-xs h-7"
                            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}>
                            <option value="string">String</option>
                            <option value="number">Number</option>
                            <option value="boolean">Boolean</option>
                            <option value="array">Array</option>
                            <option value="object">JSON Object</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[9px] font-medium mb-0.5" style={{ color: 'var(--theme-muted-text)' }}>Description</label>
                          <Input value={v.description} onChange={e => updateOutputVar(i, 'description', e.target.value)} placeholder="What this output contains" className="!text-xs !h-7" />
                        </div>
                      </div>
                      <button onClick={() => removeOutputVar(i)} className="p-1 mt-3 rounded hover:opacity-70" style={{ color: 'var(--theme-danger, #DC2626)' }}><X size={12} /></button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addOutputVar} className="!text-[10px]">
                    <Plus size={10} className="mr-1" /> Add Output Variable
                  </Button>
                </div>
              </Section>

              <div className="rounded-lg px-3 py-2 text-[10px]" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                <strong>How it works:</strong> Output variables are included in the agent's instructions, asking it to structure its response. In a workflow, the agent's response is stored in the configured output variable (default: <code className="font-mono">agent_response</code>). Additional variables are extracted from structured JSON in the response when possible.
              </div>
            </div>
          )}

          {/* Settings tab */}
          {tab === 'settings' && (
            <div className="space-y-4">
              <Section title="Model Parameters" icon={<Settings size={12} />}>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--theme-muted-text)' }}>Temperature ({agent.temperature})</label>
                    <input type="range" min={0} max={2} step={0.1} value={agent.temperature}
                      onChange={e => update({ temperature: Number(e.target.value) })} className="w-full h-1.5" />
                    <p className="text-[9px] mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>Lower = more focused. Higher = more creative.</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--theme-muted-text)' }}>Max Tokens</label>
                    <Input type="number" value={agent.max_tokens} onChange={e => update({ max_tokens: Number(e.target.value) || 4096 })} className="!text-xs !h-8" />
                    <p className="text-[9px] mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>Maximum response length.</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--theme-muted-text)' }}>Max Tool Iterations</label>
                    <Input type="number" value={agent.max_iterations} onChange={e => update({ max_iterations: Number(e.target.value) || 10 })} className="!text-xs !h-8" />
                    <p className="text-[9px] mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>Max tool-use loops before stopping.</p>
                  </div>
                </div>
              </Section>
            </div>
          )}
        </div>

        {/* Right: Playground */}
        {showPlayground && (
          <div className="w-96 shrink-0">
            <AgentPlayground agentId={agent.id} agentName={agent.name} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Reusable section wrapper ──

function Section({ title, icon, description, children }: { title: string; icon?: React.ReactNode; description?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon && <span style={{ color: 'var(--theme-primary-text)' }}>{icon}</span>}
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>{title}</h3>
      </div>
      {description && <p className="text-[10px] mb-3" style={{ color: 'var(--theme-muted-text)' }}>{description}</p>}
      {children}
    </div>
  )
}
