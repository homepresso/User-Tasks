'use client'

import { useAssistantChanges, useDesignerContext, type AssistantChange } from '@/lib/assistants/client-registry'
import { isCustomReference, isWriteReference } from '@/lib/custom-references/types'
import { WritesDataBadge } from '@/components/integrations/writes-data-badge'
import { useState, useCallback, useMemo, useRef } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input, SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge, StatusPill, Tag } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabPanel } from '@/components/ui/tabs'
import { InlineNotice } from '@/components/ui/inline-notice'
import { EmptyState } from '@/components/ui/empty-state'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { formatRelative } from '@/lib/format/date'
import { plural } from '@/lib/format/plural'
import { saveAgent } from '@/app/actions/agents'
import { AgentPlayground } from './agent-playground'
import { cn } from '@/lib/utils'
import {
  Save, Bot, Wrench, Settings, Plus, X,
  MessageSquare, Sparkles, Shield, Target, FileOutput,
  Database, Globe, Workflow, ChevronDown, ChevronRight,
  Download, Upload, MoreHorizontal,
} from 'lucide-react'
import type { AgentTool } from '@/lib/agent-tool-defs'
import { BUILTIN_TOOL_DEFS, type BuiltinToolCategory } from '@/lib/agent-tool-defs'
import { normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import { ExportAssetDialog } from '@/components/shared/config-transfer'
import { isAiProviderIntegration } from '@/lib/agents/provider'
import { mediaProviderForType } from '@/lib/media/catalog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import { ApprovalPanel, HistoryPanel, KnowledgePanel, LimitsPanel, McpToolAdder, TestsPanel } from './agent-panels'
import { FlaskConical, History as HistoryIcon } from 'lucide-react'
import { DataGrantsPanel, dataAccessSummary, type DataAccessValue } from './data-grants-panel'

function isAiIntegration(i: { type: string; config: any; is_ai?: boolean }) {
  return i.is_ai ?? isAiProviderIntegration(i)
}

interface AgentState {
  id: string; name: string; description: string | null
  integration_id: string | null; model: string; system_prompt: string
  role: string; task: string; boundaries: string
  temperature: number | null; max_tokens: number; max_iterations: number
  tools: AgentTool[]; is_active: boolean
  version?: number
  output_config: {
    variables: { name: string; description: string; type: string; required?: boolean; enum?: string[] }[]
    strict_outputs?: boolean
    limits?: { max_run_tokens?: number; max_tool_calls?: number; daily_token_budget?: number; monthly_token_budget?: number; daily_cost_budget?: number; monthly_cost_budget?: number; budget_currency?: string }
    approval?: { tools: string[]; assignee_user_id: string | null; assignee_team_id: string | null }
    egress?: { allowed_hosts: string[] }
    knowledge?: { table_ids: string[]; files: any[] }
    data_access?: DataAccessValue
    document_access?: boolean
    media_access?: { enabled: boolean; integration_id: string | null }
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
  integrations: { id: string; name: string; type: string; config: any; is_ai?: boolean; provider?: string; models?: string[] }[]
  mcpServers?: { id: string; name: string }[]
  members?: { id: string; name: string }[]
  references: { id: string; name: string; method: string; description: string | null; integration: { id: string; name: string } | null }[]
  dataTables: { id: string; name: string; description?: string | null; created_at?: string | null; updated_at?: string | null }[]
  workflows: { id: string; name: string; description?: string | null; trigger_type?: string | null; is_active?: boolean | null; created_at?: string | null; updated_at?: string | null }[]
  teams: { id: string; name: string; description?: string | null; created_at?: string | null; updated_at?: string | null }[]
}

type Tab = 'identity' | 'tools' | 'boundaries' | 'output' | 'settings' | 'tests' | 'history'

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
      data_access: { mode: 'none', table_ids: [], grants: [] },
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
      data_access: { mode: 'none', table_ids: [], grants: [] },
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
      data_access: { mode: 'none', table_ids: [], grants: [] },
      task_access: true,
      task_scope: { mode: 'selected', team_ids: [], workflow_ids: [] },
      workflow_access: true,
      workflow_scope: { mode: 'selected', workflow_ids: [] },
    },
  },
]

/** "5 min ago" / "yesterday" / "27 Oct" for picker subtitles ("Updated …"). */
function formatRelativeTimestamp(value?: string | null) {
  if (!value) return null
  if (Number.isNaN(new Date(value).getTime())) return null
  const text = formatRelative(value)
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text
}

export function AgentDesigner({ agent: initial, integrations, references, dataTables, workflows, teams, mcpServers = [], members = [] }: AgentDesignerProps) {
  const [initialState] = useState<AgentState>(() => ({
    ...initial,
    role: (initial as any).role ?? '',
    task: (initial as any).task ?? '',
    boundaries: (initial as any).boundaries ?? '',
    output_config: normalizeAgentOutputConfig((initial as any).output_config ?? { variables: [] }),
  }))
  const [agent, setAgent] = useState<AgentState>(initialState)
  const [saving, setSaving] = useState(false)
  // Synchronous guard: each save adds a version, so a double click must not save twice.
  const saveGuard = useSubmitGuard()
  const [saveStatus, setSaveStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(initialState))
  const queryClient = useQueryClient()
  const { data: usage } = useQuery({ queryKey: ['agent-usage', initial.id], queryFn: () => serverQuery('agents.usage', { agentId: initial.id }) })
  const [tab, setTab] = useState<Tab>('identity')
  const [showPlayground, setShowPlayground] = useState(false)
  const [showAddTool, setShowAddTool] = useState(false)
  const [toolFilter, setToolFilter] = useState('')
  const [workflowSearch, setWorkflowSearch] = useState('')
  const [taskWorkflowSearch, setTaskWorkflowSearch] = useState('')
  const [taskTeamSearch, setTaskTeamSearch] = useState('')
  const importRef = useRef<HTMLInputElement>(null)
  const [showExport, setShowExport] = useState(false)

  const update = useCallback((patch: Partial<AgentState>) => { setSaveStatus(null); setAgent(prev => ({ ...prev, ...patch })) }, [])
  const dirty = JSON.stringify(agent) !== savedSnapshot
  // The Agent (assistant): this workflow agent is the open item; a confirmed change to it reloads the page.
  useDesignerContext({
    area: 'agent', item_id: (agent as { id?: string }).id ?? null, item_name: agent.name ?? null, dirty,
    summary: [`Model: ${agent.model || 'the connection default'}`, `Tools: ${(Array.isArray(agent.tools) ? agent.tools : []).map((t: unknown) => (typeof t === 'string' ? t : (t as { name?: string })?.name)).filter(Boolean).slice(0, 30).join(', ') || 'none'}`, `Active: ${agent.is_active ? 'yes' : 'no'}`, `Instructions: ${String(agent.system_prompt ?? '').replace(/\s+/g, ' ').slice(0, 400)}`].join('\n'),
  })
  useAssistantChanges(useCallback((change: AssistantChange) => {
    if (change.kind === 'agent' && change.id === (agent as { id?: string }).id && !dirty) window.location.reload()
  }, [agent, dirty]))

  const aiIntegrations = useMemo(() => integrations.filter(isAiIntegration), [integrations])
  const mediaIntegrations = useMemo(() => integrations.flatMap((i) => {
    const provider = mediaProviderForType(i.type)
    return provider && (provider.capabilities.includes('transcribe') || provider.capabilities.includes('analyze_image')) ? [{ ...i, providerLabel: provider.label }] : []
  }), [integrations])
  const selectedIntegration = aiIntegrations.find(i => i.id === agent.integration_id)

  // Auto-generate system prompt from structured fields
  const generatedPrompt = useMemo(() => {
    const parts: string[] = []
    if (agent.role) parts.push(`You are ${agent.role}.`)
    if (agent.task) parts.push(`\nYour task: ${agent.task}`)
    if (agent.boundaries) parts.push(`\nBoundaries and rules:\n${agent.boundaries}`)
    if (agent.output_config?.variables?.length) {
      parts.push(`\nWhen you have finished, end your final message with a fenced json block containing exactly these keys:`)
      for (const v of agent.output_config.variables) {
        parts.push(`- "${v.name}" (${v.type}${v.required ? ', required' : ''})${v.enum?.length ? ` — one of ${v.enum.join(', ')}` : ''}${v.description ? ` — ${v.description}` : ''}`)
      }
    }
    return parts.join('\n')
  }, [agent.role, agent.task, agent.boundaries, agent.output_config])

  async function handleSave() {
    await saveGuard.run(async () => {
      setSaving(true)
      setSaveStatus(null)
      try {
        // Save custom instructions as-is (the executor composes the full prompt from role+task+boundaries+custom)
        const result = await saveAgent(agent.id, {
          name: agent.name, description: agent.description,
          integration_id: agent.integration_id, model: agent.model,
          system_prompt: agent.system_prompt,
          role: agent.role, task: agent.task, boundaries: agent.boundaries,
          output_config: agent.output_config,
          temperature: agent.temperature, max_tokens: agent.max_tokens,
          max_iterations: agent.max_iterations, tools: agent.tools, is_active: agent.is_active,
        })
        if (result.ok) {
          const next = { ...agent, version: result.data.version }
          setAgent(next)
          setSavedSnapshot(JSON.stringify(next))
          setSaveStatus({ ok: true, message: `Saved · version ${result.data.version}` })
          void queryClient.invalidateQueries({ queryKey: ['agent', agent.id] })
        } else {
          setSaveStatus({ ok: false, message: result.error })
        }
      } catch (err) {
        setSaveStatus({ ok: false, message: err instanceof Error ? err.message : 'Could not save the agent' })
      }
      setSaving(false)
    })
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
      description: isWriteReference(ref as { request_config?: unknown })
        ? `${ref.description || `Call ${ref.name}`} (side-effecting: writes data)`
        : ref.description || `Call ${ref.name}`,
      referenceId: ref.id, inputSchema: [],
      // A write reference changes data: it waits for a person's approval until the designer turns that off.
      ...(isWriteReference(ref as { request_config?: unknown }) ? { requiresApproval: true } : {}),
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

  function updateOutputVar(index: number, field: string, value: unknown) {
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

  const selectedWorkflowIds = new Set(agent.output_config?.workflow_scope?.workflow_ids ?? [])
  const selectedTaskWorkflowIds = new Set(agent.output_config?.task_scope?.workflow_ids ?? [])
  const selectedTaskTeamIds = new Set(agent.output_config?.task_scope?.team_ids ?? [])
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
  const selectedWorkflowCount = agent.output_config?.workflow_scope?.mode === 'selected' ? selectedWorkflowIds.size : workflows.length
  const selectedTaskScopeCount =
    selectedTaskTeamIds.size + selectedTaskWorkflowIds.size
  const capabilityBadges = [
    `Data: ${dataAccessSummary(agent.output_config?.data_access)}`,
    agent.output_config?.document_access ? 'Documents enabled' : null,
    agent.output_config?.media_access?.enabled ? 'Media enabled' : null,
    agent.output_config?.task_access
      ? `Tasks: ${agent.output_config?.task_scope?.mode === 'selected' ? plural(selectedTaskScopeCount, 'scope item') : 'all accessible'}`
      : null,
    agent.output_config?.workflow_access
      ? `Workflows: ${agent.output_config?.workflow_scope?.mode === 'selected' ? `${selectedWorkflowCount} selected` : 'all'}`
      : null,
  ].filter(Boolean) as string[]
  const governedCapabilityCards = [
    {
      key: 'documents',
      title: 'Documents & files',
      icon: <Database size={14} />,
      summary: agent.output_config?.document_access ? 'File and document helpers enabled' : 'Disabled',
      description: 'Lets the agent use file helpers like CSV reading, downloads, and spreadsheet/document generation.',
      enabled: agent.output_config?.document_access === true,
      actionNames: ['generate_word_document', 'generate_excel', 'read_csv_file', 'download_file', 'read_file_content'],
    },
    {
      key: 'media',
      title: 'Media (images, audio, video)',
      icon: <Sparkles size={14} />,
      summary: agent.output_config?.media_access?.enabled
        ? (agent.output_config.media_access.integration_id ? `Uses ${mediaIntegrations.find((i) => i.id === agent.output_config.media_access?.integration_id)?.name ?? 'the chosen connection'}` : 'Choose a connection')
        : 'Disabled',
      description: 'Lets the agent transcribe audio and video and analyze images with your own provider. Media is sent to that provider.',
      enabled: agent.output_config?.media_access?.enabled === true && Boolean(agent.output_config?.media_access?.integration_id),
      actionNames: ['transcribe_media', 'analyze_image'],
    },
    {
      key: 'data',
      title: 'Data actions',
      icon: <Database size={14} />,
      summary: dataAccessSummary(agent.output_config?.data_access),
      description: 'Lets the agent read, add, update or delete rows — per table, only the operations granted.',
      enabled: (agent.output_config?.data_access?.mode ?? 'none') !== 'none',
      actionNames: ['query_data_table', 'insert_data_row', 'insert_data_rows', 'update_data_rows', 'delete_data_rows'],
    },
    {
      key: 'tasks',
      title: 'Task actions',
      icon: <Workflow size={14} />,
      summary: agent.output_config?.task_access
        ? agent.output_config?.task_scope?.mode === 'selected'
          ? `${plural(selectedTaskScopeCount, 'selected scope item')}`
          : 'All tasks the signed-in user can access'
        : 'Disabled',
      description: 'Lets the agent inspect tasks and respond, complete, escalate, or redirect them within the approved task scope.',
      enabled: agent.output_config?.task_access === true,
      actionNames: ['get_task_status', 'respond_to_task', 'complete_task', 'complete_workflow_task', 'escalate_task', 'redirect_task'],
    },
    {
      key: 'workflows',
      title: 'Workflow actions',
      icon: <Workflow size={14} />,
      summary: agent.output_config?.workflow_access
        ? agent.output_config?.workflow_scope?.mode === 'selected'
          ? `${plural(selectedWorkflowCount, 'selected workflow')}`
          : 'All workflows'
        : 'Disabled',
      description: 'Lets the agent start workflows, inspect runs, and complete waiting server events in the approved workflow scope.',
      enabled: agent.output_config?.workflow_access === true,
      actionNames: ['start_workflow_run', 'get_workflow_run_status', 'complete_server_event'],
    },
  ]

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

  const TABS: { value: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { value: 'identity', label: 'Identity & task', icon: <Target /> },
    { value: 'tools', label: 'Tools', icon: <Wrench />, count: agent.tools.length },
    { value: 'boundaries', label: 'Boundaries', icon: <Shield /> },
    { value: 'output', label: 'Output', icon: <FileOutput /> },
    { value: 'settings', label: 'Settings', icon: <Settings /> },
    { value: 'tests', label: 'Tests', icon: <FlaskConical /> },
    { value: 'history', label: `History${agent.version ? ` (v${agent.version})` : ''}`, icon: <HistoryIcon /> },
  ]

  const displayName = agent.name.trim() || 'Untitled agent'
  const availableReferences = references.filter(r => !agent.tools.some(t => t.referenceId === r.id))
  const filteredReferences = availableReferences.filter(r => {
    const q = toolFilter.toLowerCase()
    return !q || r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)
  })

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: 'Agents', href: '/agents' }, { label: displayName }]}
        icon={<Bot />}
        title={displayName}
        badge={<StatusPill status={agent.is_active ? 'active' : 'inactive'} />}
        actions={(
          <>
            {dirty && !saving && <span className="text-xs text-fg-muted">Unsaved changes</span>}
            <Button asChild variant="secondary">
              <Link href={`/agents/${agent.id}/runs`}>View runs</Link>
            </Button>
            <Button variant="secondary" leadingIcon={<MessageSquare />} aria-pressed={showPlayground} onClick={() => setShowPlayground(!showPlayground)}>
              {showPlayground ? 'Hide test' : 'Test'}
            </Button>
            <Button onClick={handleSave} loading={saving} leadingIcon={<Save />}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton variant="secondary" label="More actions" icon={<MoreHorizontal />} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem icon={<Download />} onSelect={() => setShowExport(true)}>Export…</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem icon={<Download />} onSelect={handleExport}>Download agent JSON</DropdownMenuItem>
                <DropdownMenuItem icon={<Upload />} onSelect={() => importRef.current?.click()}>Load agent JSON…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      />
      <input ref={importRef} type="file" accept=".json" className="hidden" aria-label="Load agent JSON" onChange={handleImport} />
      <ExportAssetDialog ids={[agent.id]} name={agent.name} open={showExport} onOpenChange={setShowExport} />

      <div className="space-y-4">
        {saveStatus && (
          <InlineNotice tone={saveStatus.ok ? 'success' : 'danger'} message={saveStatus.message} />
        )}

        {agent.output_config?.data_access?.mode === 'all' && tab !== 'tools' && (
          <div role="note" data-testid="agent-broad-access-notice">
            <InlineNotice
              tone="warning"
              message={<>This agent can read, add and update rows in <strong className="font-semibold">every data table</strong> of this workspace (access it had before per-table grants). Consider narrowing it to the tables it needs.</>}
              actions={<Button type="button" size="sm" variant="secondary" onClick={() => setTab('tools')}>Review data access</Button>}
            />
          </div>
        )}

        {/* Identity + provider */}
        <Card padding="none">
          <CardBody className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Name">
              <Input value={agent.name} onChange={e => update({ name: e.target.value })} placeholder="Agent name" />
            </Field>
            <Field label="Description" optional>
              <Input value={agent.description ?? ''} onChange={e => update({ description: e.target.value || null })} placeholder="Brief description…" />
            </Field>
            <Field label="Provider">
              <Select value={agent.integration_id ?? ''} onChange={e => update({ integration_id: e.target.value || null })}>
                <option value="">Select AI provider…</option>
                {aiIntegrations.map(i => <option key={i.id} value={i.id}>{i.name} ({i.type})</option>)}
              </Select>
            </Field>
            <Field label="Model" labelAside={selectedIntegration ? <Tag mono>{selectedIntegration.type}</Tag> : undefined}>
              <Input aria-label="Model" list="agent-model-options" value={agent.model} onChange={e => update({ model: e.target.value })} placeholder={selectedIntegration?.models?.[0] ?? 'model id'} className="font-mono" />
            </Field>
            <datalist id="agent-model-options">
              {(selectedIntegration?.models ?? []).map(m => <option key={m} value={m} />)}
            </datalist>
          </CardBody>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-subtle px-4 py-3">
            <Switch checked={agent.is_active} onCheckedChange={(checked) => update({ is_active: checked })} label="Active" />
            {capabilityBadges.length > 0 && <span className="h-4 w-px bg-border" aria-hidden="true" />}
            {capabilityBadges.map((badge) => (
              <Badge key={badge} tone="brand">{badge}</Badge>
            ))}
          </div>
        </Card>

        <div className="flex gap-4">
          {/* Main content */}
          <div className="min-w-0 flex-1">
            <Tabs aria-label="Agent settings" idBase="agent-designer" value={tab} onValueChange={setTab} items={TABS} className="mb-4" />

            <TabPanel idBase="agent-designer" value={tab}>
            {/* Identity & Task tab */}
            {tab === 'identity' && (
              <div className="space-y-4">
                <Section title="Starter presets" icon={<Sparkles />} description="Start from a governed baseline, then fine-tune the prompt and access scopes instead of building every agent from scratch.">
                  <div className="grid gap-2 md:grid-cols-2">
                    {AGENT_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => applyPreset(preset)}
                        className="group rounded-md bg-subtle p-3 text-left transition-colors hover:bg-muted"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-ui font-medium text-fg">{preset.name}</p>
                            <p className="mt-0.5 text-xs text-fg-muted">{preset.description}</p>
                          </div>
                          <span className="shrink-0 text-xs font-medium text-primary-text group-hover:underline">Apply</span>
                        </div>
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-fg-muted">
                    Presets intentionally keep selected scopes empty where governance matters, so the next step is to choose the approved tables, workflows, recipients, and teams this agent should actually use.
                  </p>
                </Section>

                <Section title="Agent role" icon={<Bot />} description="Who is this agent? Define its persona and expertise.">
                  <Textarea aria-label="Agent role" value={agent.role} onChange={e => update({ role: e.target.value })} rows={3}
                    placeholder="e.g. a senior data analyst with expertise in financial reporting and SQL. You communicate clearly and always provide actionable insights."
                    className="text-sm" />
                </Section>

                <Section title="Task" icon={<Target />} description="What should this agent accomplish? Be specific about the goal.">
                  <Textarea aria-label="Task" value={agent.task} onChange={e => update({ task: e.target.value })} rows={4}
                    placeholder="e.g. Analyze the provided sales data, identify top-performing products, calculate month-over-month growth, and generate a summary report with recommendations."
                    className="text-sm" />
                </Section>

                <Section title="Custom instructions" icon={<Sparkles />} description="Additional instructions beyond role and task. This is appended to the generated system prompt.">
                  <Textarea aria-label="Custom instructions" value={agent.system_prompt} onChange={e => update({ system_prompt: e.target.value })} rows={5}
                    placeholder="Any additional context, formatting preferences, or specific instructions…"
                    className="font-mono" />
                </Section>

                {/* Preview */}
                {(agent.role || agent.task) && (
                  <Card variant="inset" padding="md">
                    <p className="mb-1 text-xs font-medium text-fg-muted">Generated system prompt preview</p>
                    <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-fg">{generatedPrompt || 'Fill in role and task above to see the generated prompt.'}</pre>
                  </Card>
                )}
              </div>
            )}

            {/* Tools tab */}
            {tab === 'tools' && (
              <div className="space-y-4">
                <Section title="Capability bundles" icon={<Sparkles />} description="Use these bundles to understand what the agent can actually do. The built-in tools below are the low-level implementation; most teams can think in terms of these governed capabilities instead.">
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {governedCapabilityCards.map((card) => (
                      <div
                        key={card.key}
                        className={cn('rounded-md p-3', card.enabled ? 'bg-primary-wash' : 'bg-subtle')}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={card.enabled ? 'text-primary-text' : 'text-fg-muted'} aria-hidden="true">{card.icon}</span>
                              <p className="text-ui font-medium text-fg">{card.title}</p>
                            </div>
                            <p className="mt-1 text-xs text-fg-muted">{card.description}</p>
                          </div>
                          <StatusPill status={card.enabled ? 'enabled' : 'disabled'} label={card.enabled ? 'Enabled' : 'Off'} className="shrink-0" />
                        </div>
                        <p className="mt-2 text-xs font-medium text-fg">{card.summary}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {card.actionNames.map((name) => (
                            <Tag key={name} mono>{name}</Tag>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>

                <Section title="Access scope" icon={<Workflow />} description="Keep agent payloads tight by limiting which assets it can work with.">
                  <div className="space-y-3">
                    <div className="rounded-md bg-subtle p-3">
                      <div className="mb-2">
                        <p className="text-ui font-medium text-fg">Data tables</p>
                        <p className="text-xs text-fg-muted">Grant each table the agent needs, and only the operations it needs. Nothing is granted by default.</p>
                      </div>
                      <DataGrantsPanel value={agent.output_config?.data_access} tables={dataTables}
                        onChange={(next) => update({ output_config: { ...agent.output_config, data_access: next } })} />
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-md bg-subtle p-3">
                        <Checkbox
                          checked={agent.output_config?.document_access === true}
                          onChange={(e) => update({ output_config: { ...agent.output_config, document_access: e.target.checked } })}
                          label={<span className="font-medium">Document & file utilities</span>}
                          description="Enable governed document search plus file helpers like CSV reading, downloads, and spreadsheet/document generation."
                        />
                      </div>
                      <div className="space-y-2 rounded-md bg-subtle p-3">
                        <Checkbox
                          checked={agent.output_config?.media_access?.enabled === true}
                          onChange={(e) => update({ output_config: { ...agent.output_config, media_access: { enabled: e.target.checked, integration_id: agent.output_config?.media_access?.integration_id ?? null } } })}
                          label={<span className="font-medium">Media (images, audio, video)</span>}
                          description={<>Adds the tools <code className="font-mono">transcribe_media</code> and <code className="font-mono">analyze_image</code> for attached files or URLs. Media is sent to the provider of the connection you choose.</>}
                        />
                        {agent.output_config?.media_access?.enabled && (
                          <>
                            <Select
                              aria-label="Media connection"
                              value={agent.output_config?.media_access?.integration_id ?? ''}
                              onChange={(e) => update({ output_config: { ...agent.output_config, media_access: { enabled: true, integration_id: e.target.value || null } } })}
                            >
                              <option value="">{mediaIntegrations.length ? 'Choose a connection' : 'No media-capable connection'}</option>
                              {mediaIntegrations.map((i) => <option key={i.id} value={i.id}>{i.name} — {i.providerLabel}</option>)}
                            </Select>
                            {mediaIntegrations.length === 0 && (
                              <span className="block text-xs text-fg-muted">
                                Add an OpenAI, Gemini, Azure AI, AWS, Deepgram, AssemblyAI or ElevenLabs connector in Integrations. <a href="/docs/workflows/media/providers" target="_blank" rel="noreferrer" className="text-primary-text underline">Provider setup</a>
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-md bg-subtle p-3">
                        <Checkbox
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
                          label={<span className="font-medium">Task access</span>}
                          description="Allow the agent to inspect tasks and take task actions, optionally limited to selected teams or workflows."
                        />

                        {agent.output_config?.task_access === true && (
                          <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-medium text-fg">Task scope</p>
                                <p className="text-xs text-fg-muted">The agent still respects the signed-in user’s access, then narrows tasks further to the scopes you choose here.</p>
                              </div>
                              <Select
                                aria-label="Task scope"
                                size="sm"
                                wrapperClassName="w-auto shrink-0"
                                value={agent.output_config?.task_scope?.mode ?? 'all'}
                                onChange={(e) => updateTaskAccessMode(e.target.value === 'selected' ? 'selected' : 'all')}
                              >
                                <option value="all">All accessible tasks</option>
                                <option value="selected">Selected scope</option>
                              </Select>
                            </div>

                            {agent.output_config?.task_scope?.mode === 'selected' && (
                              <div className="grid gap-3 md:grid-cols-2">
                                <ScopePicker
                                  title="Teams"
                                  selectedCount={selectedTaskTeamIds.size}
                                  search={taskTeamSearch}
                                  onSearch={setTaskTeamSearch}
                                  searchPlaceholder="Search teams…"
                                  options={filteredTaskTeamOptions}
                                  isSelected={(id) => selectedTaskTeamIds.has(id)}
                                  onToggle={(id, checked) => toggleTaskScopeId('team_ids', id, checked)}
                                />
                                <ScopePicker
                                  title="Workflows"
                                  selectedCount={selectedTaskWorkflowIds.size}
                                  search={taskWorkflowSearch}
                                  onSearch={setTaskWorkflowSearch}
                                  searchPlaceholder="Search workflows…"
                                  options={filteredTaskWorkflowOptions}
                                  isSelected={(id) => selectedTaskWorkflowIds.has(id)}
                                  onToggle={(id, checked) => toggleTaskScopeId('workflow_ids', id, checked)}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="rounded-md bg-subtle p-3">
                        <Checkbox
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
                          label={<span className="font-medium">Workflow access</span>}
                          description="Allow the agent to start workflows, inspect run status, and complete waiting server events."
                        />

                        {agent.output_config?.workflow_access === true && (
                          <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-medium text-fg">Workflow scope</p>
                                <p className="text-xs text-fg-muted">Keep workflow actions limited to all workflows or only an approved subset.</p>
                              </div>
                              <Select
                                aria-label="Workflow scope"
                                size="sm"
                                wrapperClassName="w-auto shrink-0"
                                value={agent.output_config?.workflow_scope?.mode ?? 'all'}
                                onChange={(e) => updateWorkflowAccessMode(e.target.value === 'selected' ? 'selected' : 'all')}
                              >
                                <option value="all">All workflows</option>
                                <option value="selected">Selected workflows</option>
                              </Select>
                            </div>

                            {agent.output_config?.workflow_scope?.mode === 'selected' && (
                              <div className="space-y-2 rounded-md bg-panel p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="num text-xs text-fg-muted">
                                    {selectedWorkflowIds.size} selected
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
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
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
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
                                    </Button>
                                  </div>
                                </div>
                                <SearchInput
                                  size="sm"
                                  aria-label="Search workflows"
                                  value={workflowSearch}
                                  onValueChange={setWorkflowSearch}
                                  placeholder="Search workflows…"
                                />
                                <div className="max-h-40 space-y-0.5 overflow-y-auto">
                                  {filteredWorkflowOptions.map((workflow) => (
                                    <label key={workflow.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-subtle">
                                      <Checkbox
                                        className="mt-0.5"
                                        checked={selectedWorkflowIds.has(workflow.id)}
                                        onChange={(event) => toggleWorkflow(workflow.id, event.target.checked)}
                                      />
                                      <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-2">
                                          <span className="block truncate text-ui text-fg">{workflow.name}</span>
                                          {selectedWorkflowIds.has(workflow.id) ? <Badge tone="brand">Selected</Badge> : null}
                                        </span>
                                        {workflow.subtitle ? <span className="block truncate text-xs text-fg-muted">{workflow.subtitle}</span> : null}
                                      </span>
                                    </label>
                                  ))}
                                  {workflowOptions.length === 0 && (
                                    <p className="px-2 py-1 text-xs text-fg-muted">No workflows found in this tenant yet.</p>
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

                <InlineNotice tone="info" message={<><strong className="font-semibold">Simple mental model:</strong> first choose the capability bundles you want enabled, then narrow their scope. Most builders never need to think in raw tool names unless they are doing something advanced.</>} />

                {/* Current tools */}
                <Card padding="none">
                  <CardHeader title={<SectionTitle icon={<Wrench />} title="Tools" />} actions={<span className="num text-xs text-fg-muted">{plural(agent.tools.length, 'tool')}</span>} />
                  {agent.tools.length === 0 ? (
                    <EmptyState size="sm" icon={Wrench} title="No tools configured" description="Add tools below to give the agent capabilities." />
                  ) : (
                    <div className="divide-y divide-border-subtle border-t border-border-subtle">
                      {agent.tools.map(tool => (
                        <div key={tool.id} className="flex items-center gap-3 py-2 pl-4 pr-2 hover:bg-subtle">
                          <span className={cn('shrink-0', tool.type === 'builtin' ? 'text-warning' : tool.type === 'reference' ? 'text-primary-text' : 'text-success')} aria-hidden="true">
                            {tool.type === 'builtin' ? <Sparkles size={14} /> : tool.type === 'reference' ? <Globe size={14} /> : <Workflow size={14} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-mono text-ui font-medium text-fg">{tool.name}</span>
                              <Tag>{tool.type}</Tag>
                            </div>
                            <p className="truncate text-xs text-fg-muted">{tool.description}</p>
                          </div>
                          <IconButton size="sm" variant="danger-ghost" label={`Remove ${tool.name}`} icon={<X />} onClick={() => removeTool(tool.id)} />
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                {/* Built-in tools by category */}
                {([
                  { key: 'core' as BuiltinToolCategory, label: 'Core', icon: <Sparkles />, desc: 'Basic capabilities' },
                  { key: 'data' as BuiltinToolCategory, label: 'Data store', icon: <Database />, desc: 'Query, insert, and update data tables' },
                  { key: 'workflow' as BuiltinToolCategory, label: 'Workflow & tasks', icon: <Workflow />, desc: 'Start workflows and inspect tasks/runs' },
                  { key: 'documents' as BuiltinToolCategory, label: 'Documents', icon: <Sparkles />, desc: 'Generate Word, Excel, read CSV' },
                  { key: 'media' as BuiltinToolCategory, label: 'Media', icon: <Sparkles />, desc: 'Transcribe audio/video, analyze images' },
                  { key: 'http' as BuiltinToolCategory, label: 'HTTP', icon: <Globe />, desc: 'Make HTTP requests' },
                  { key: 'files' as BuiltinToolCategory, label: 'Files', icon: <Sparkles />, desc: 'Download and read files' },
                  { key: 'multi_agent' as BuiltinToolCategory, label: 'Multi-agent', icon: <Bot />, desc: 'Share context between agents' },
                ]).map(cat => {
                  const catTools = BUILTIN_TOOL_DEFS.filter(bt => bt.category === cat.key)
                  if (catTools.length === 0) return null
                  return (
                    <Section key={cat.key} title={cat.label} icon={cat.icon} description={`${cat.desc}. These are the advanced low-level tool switches behind the capability bundles above.`}>
                      <div className="grid grid-cols-2 gap-2">
                        {catTools.map(bt => {
                          const added = agent.tools.some(t => t.name === bt.name)
                          return (
                            <button key={bt.id} type="button" onClick={() => !added && addBuiltinTool(bt)} disabled={added}
                              className={cn(
                                'rounded-md px-3 py-2 text-left transition-colors',
                                added ? 'cursor-not-allowed bg-primary-wash' : 'bg-subtle hover:bg-muted',
                              )}>
                              <span className="flex items-center justify-between gap-2">
                                <span className="truncate font-mono text-ui font-medium text-fg">{bt.name}</span>
                                {added && <span className="shrink-0 text-xs font-medium text-success">Added</span>}
                              </span>
                              <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{bt.description}</p>
                            </button>
                          )
                        })}
                      </div>
                    </Section>
                  )
                })}

                <Section title="MCP tools" icon={<Globe />} description="Call a tool on one of this workspace's MCP servers.">
                  <McpToolAdder servers={mcpServers} onAdd={(tool) => { if (!agent.tools.some(t => t.name === tool.name)) update({ tools: [...agent.tools, tool] }) }} />
                </Section>

                <KnowledgePanel outputConfig={agent.output_config as any} onChange={(next) => update({ output_config: next as any })} dataTables={dataTables} />

                <ApprovalPanel tools={agent.tools} outputConfig={agent.output_config as any} onChange={(next) => update({ output_config: next as any })} onToolsChange={(next) => update({ tools: next })} members={members} teams={teams} />

                {/* Reference tools */}
                <Section title="API references" icon={<Globe />} description="Add integration references as tools the agent can call">
                  <SearchInput size="sm" aria-label="Filter references" value={toolFilter} onValueChange={setToolFilter} placeholder="Filter references…" wrapperClassName="mb-2" />
                  <div className="max-h-60 space-y-1 overflow-y-auto">
                    {filteredReferences.map(ref => (
                      <button key={ref.id} type="button" onClick={() => addReferenceTool(ref)}
                        className="w-full rounded-md bg-subtle px-3 py-2 text-left transition-colors hover:bg-muted">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-ui font-medium text-fg">{ref.name}</span>
                          <Tag mono>{ref.method}</Tag>
                          {isCustomReference(ref as { request_config?: unknown }) && <Badge tone="brand">Custom</Badge>}
                          {isWriteReference(ref as { request_config?: unknown }) && <WritesDataBadge />}
                          {ref.integration && <span className="text-xs text-fg-muted">{ref.integration.name}</span>}
                        </div>
                        {ref.description && <p className="mt-0.5 truncate text-xs text-fg-muted">{ref.description}</p>}
                      </button>
                    ))}
                    {availableReferences.length === 0 && (
                      <p className="py-3 text-center text-xs text-fg-muted">All references are added or no references available.</p>
                    )}
                  </div>
                </Section>
              </div>
            )}

            {/* Boundaries tab */}
            {tab === 'boundaries' && (
              <div className="space-y-4">
                <Section title="Boundaries & rules" icon={<Shield />} description="Define what the agent should and should NOT do. These constraints keep the agent safe and focused.">
                  <Textarea aria-label="Boundaries and rules" value={agent.boundaries} onChange={e => update({ boundaries: e.target.value })} rows={10}
                    placeholder={"Examples:\n- Never share personally identifiable information (PII)\n- Only use approved data sources — do not make up data\n- If you are unsure, say so rather than guessing\n- Limit responses to the scope of the assigned task\n- Do not execute any destructive operations (DELETE, DROP)\n- Always cite your sources when providing data\n- Maximum 3 tool calls per request to prevent loops"}
                    className="text-sm leading-relaxed" />
                </Section>

                <InlineNotice tone="info" message={<><strong className="font-semibold">Tip:</strong> Boundaries are injected into the system prompt as rules the agent must follow. Be explicit — agents follow instructions better when boundaries are clear and specific.</>} />
              </div>
            )}

            {/* Output tab */}
            {tab === 'output' && (
              <div className="space-y-4">
                <Section title="Output variables" icon={<FileOutput />} description="Define structured outputs the agent should produce. These become workflow variables when the agent is used in a Run Agent node.">
                  <div className="space-y-2">
                    {(agent.output_config?.variables ?? []).map((v: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 rounded-md bg-subtle p-3">
                        <div className="grid flex-1 grid-cols-3 gap-2">
                          <Field label="Variable name">
                            <Input size="sm" value={v.name} onChange={e => updateOutputVar(i, 'name', e.target.value)} placeholder="summary" className="font-mono" />
                          </Field>
                          <Field label="Type">
                            <Select size="sm" value={v.type} onChange={e => updateOutputVar(i, 'type', e.target.value)}>
                              <option value="string">String</option>
                              <option value="number">Number</option>
                              <option value="integer">Integer</option>
                              <option value="boolean">Boolean</option>
                              <option value="array">Array</option>
                              <option value="object">JSON object</option>
                            </Select>
                          </Field>
                          <Field label="Description">
                            <Input size="sm" value={v.description} onChange={e => updateOutputVar(i, 'description', e.target.value)} placeholder="What this output contains" />
                          </Field>
                        </div>
                        <div className="mt-6 flex flex-col gap-1.5">
                          <Checkbox checked={Boolean(v.required)} onChange={e => updateOutputVar(i, 'required', e.target.checked)} label="Required" />
                          <Input size="sm" aria-label={`Allowed values for ${v.name || 'output'}`} value={(v.enum ?? []).join(', ')} onChange={e => updateOutputVar(i, 'enum', e.target.value.split(',').map((x: string) => x.trim()).filter(Boolean))} placeholder="Allowed values" className="w-36" />
                        </div>
                        <IconButton size="sm" variant="danger-ghost" label="Remove output" icon={<X />} onClick={() => removeOutputVar(i)} className="mt-6" />
                      </div>
                    ))}
                    <Button variant="secondary" size="sm" onClick={addOutputVar} leadingIcon={<Plus />}>
                      Add output variable
                    </Button>
                    <Checkbox
                      className="mt-2"
                      checked={Boolean(agent.output_config?.strict_outputs)}
                      onChange={e => update({ output_config: { ...agent.output_config, strict_outputs: e.target.checked } })}
                      label="Strict — fail the run when outputs are still missing or invalid after one repair attempt"
                    />
                  </div>
                </Section>

                <InlineNotice tone="neutral" message={<><strong className="font-semibold">How it works:</strong> the agent ends its answer with a JSON block holding these keys. Each value is checked against its type (and allowed values); if any is missing or invalid the agent is asked once to fix its answer. In a workflow the response text goes to the output variable (default <code className="font-mono">agent_response</code>), and each output becomes <code className="font-mono">{'{{name}}'}</code> and <code className="font-mono">{'{{prefix_name}}'}</code>.</>} />
              </div>
            )}

            {/* Settings tab */}
            {tab === 'settings' && (
              <div className="space-y-4">
                <Section title="Model parameters" icon={<Settings />}>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="agent-temperature" className="mb-1.5 block text-ui font-medium text-fg">
                        Temperature <span className="num font-normal text-fg-muted">({agent.temperature === null ? 'provider default' : agent.temperature})</span>
                      </label>
                      <input id="agent-temperature" aria-label="Temperature" type="range" min={0} max={2} step={0.1} value={agent.temperature ?? 1} disabled={agent.temperature === null}
                        onChange={e => update({ temperature: Number(e.target.value) })} className="h-1.5 w-full accent-[color:var(--theme-primary)] disabled:opacity-45" />
                      <Checkbox
                        className="mt-2"
                        checked={agent.temperature === null}
                        onChange={e => update({ temperature: e.target.checked ? null : 0.7 })}
                        label={<span className="text-xs text-fg-muted">Use the provider&apos;s default (newer Claude and OpenAI reasoning models ignore temperature)</span>}
                      />
                    </div>
                    <Field label="Max tokens" description="Maximum length of each model response.">
                      <Input aria-label="Max tokens" type="number" min={1} max={128000} value={agent.max_tokens} onChange={e => update({ max_tokens: Math.max(1, Math.min(128000, Number(e.target.value) || 4096)) })} className="num" />
                    </Field>
                    <Field label="Max tool iterations" description="Model calls before the run stops (and fails) — 1 to 50.">
                      <Input aria-label="Max iterations" type="number" min={1} max={50} value={agent.max_iterations} onChange={e => update({ max_iterations: Math.max(1, Math.min(50, Number(e.target.value) || 10)) })} className="num" />
                    </Field>
                  </div>
                </Section>
                <LimitsPanel outputConfig={agent.output_config as any} onChange={(next) => update({ output_config: next as any })} usage={usage ?? null} />
              </div>
            )}

            {tab === 'tests' && <TestsPanel agentId={agent.id} dirty={dirty} />}

            {tab === 'history' && (
              <HistoryPanel agentId={agent.id} currentVersion={agent.version ?? 1} onRestored={() => {
                void queryClient.invalidateQueries({ queryKey: ['agent', agent.id] })
                window.location.reload()
              }} />
            )}
            </TabPanel>
          </div>

          {/* Right: Playground */}
          {showPlayground && (
            <div className="w-96 shrink-0">
              <div className="sticky top-4">
                <AgentPlayground agentId={agent.id} agentName={agent.name} dirty={dirty} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Reusable section wrapper ──

function SectionTitle({ icon, title }: { icon?: React.ReactNode; title: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {icon && <span className="inline-flex text-fg-muted [&>svg]:size-4" aria-hidden="true">{icon}</span>}
      {title}
    </span>
  )
}

function Section({ title, icon, description, children }: { title: string; icon?: React.ReactNode; description?: string; children: React.ReactNode }) {
  return (
    <Card padding="none">
      <CardHeader title={<SectionTitle icon={icon} title={title} />} description={description} />
      <CardBody className="pt-0">{children}</CardBody>
    </Card>
  )
}

/** Searchable checkbox list for the task scope (teams / workflows). */
function ScopePicker({ title, selectedCount, search, onSearch, searchPlaceholder, options, isSelected, onToggle }: {
  title: string
  selectedCount: number
  search: string
  onSearch: (value: string) => void
  searchPlaceholder: string
  options: { id: string; name: string; subtitle: string }[]
  isSelected: (id: string) => boolean
  onToggle: (id: string, checked: boolean) => void
}) {
  return (
    <div className="rounded-md bg-panel p-2">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <p className="text-xs font-medium text-fg">{title}</p>
        <span className="num text-xs text-fg-muted">{selectedCount} selected</span>
      </div>
      <SearchInput size="sm" aria-label={searchPlaceholder.replace('…', '')} value={search} onValueChange={onSearch} placeholder={searchPlaceholder} wrapperClassName="mb-2" />
      <div className="max-h-40 space-y-0.5 overflow-y-auto">
        {options.map((option) => (
          <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-subtle">
            <Checkbox
              className="mt-0.5"
              checked={isSelected(option.id)}
              onChange={(event) => onToggle(option.id, event.target.checked)}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui text-fg">{option.name}</span>
              {option.subtitle ? <span className="block truncate text-xs text-fg-muted">{option.subtitle}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
