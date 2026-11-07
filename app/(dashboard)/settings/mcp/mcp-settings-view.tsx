'use client'

import { useState } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Copy, Check, Plug, Plus, Trash2, RefreshCw, ExternalLink,
  Shield, Bot, ClipboardList, Workflow, FileText, Database, BarChart3, Network, Scale,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/lib/permissions-context'
import { useQueryClient } from '@tanstack/react-query'
import { ExportAssetButton, ImportConfigButton } from '@/components/shared/config-transfer'

const APP_URL = typeof window !== 'undefined' ? window.location.origin : ''

const TOOL_CATEGORY_DISPLAY: Record<string, { icon: any; label: string; color: string }> = {
  tasks: { icon: ClipboardList, label: 'Tasks', color: 'text-[color:var(--theme-card-text)]' },
  workflows: { icon: Workflow, label: 'Workflows', color: 'text-[color:var(--theme-chart-6-text)]' },
  agents: { icon: Bot, label: 'Agents', color: 'text-[color:var(--theme-chart-5-text)]' },
  forms: { icon: FileText, label: 'Forms', color: 'text-[color:var(--theme-chart-3-text)]' },
  data: { icon: Database, label: 'Data Tables', color: 'text-[color:var(--theme-chart-4-text)]' },
  reports: { icon: BarChart3, label: 'Reports', color: 'text-[color:var(--theme-chart-3-text)]' },
  integrations: { icon: Network, label: 'Integrations', color: 'text-[color:var(--theme-chart-2-text)]' },
  governance: { icon: Shield, label: 'Governance', color: 'text-[color:var(--theme-muted-text)]' },
  api_keys: { icon: Shield, label: 'API Keys', color: 'text-[color:var(--theme-muted-text)]' },
  observability: { icon: BarChart3, label: 'Observability', color: 'text-[color:var(--theme-chart-9-text)]' },
  decision_tables: { icon: Scale, label: 'Business Rules', color: 'text-[color:var(--theme-chart-9-text)]' },
  apps: { icon: Database, label: 'Apps', color: 'text-[color:var(--theme-chart-8-text)]' },
  extensibility: { icon: Plug, label: 'Extensibility', color: 'text-[color:var(--theme-chart-6-text)]' },
  retention: { icon: Shield, label: 'Retention', color: 'text-[color:var(--theme-chart-7-text)]' },
  pages: { icon: FileText, label: 'Pages', color: 'text-[color:var(--theme-chart-6-text)]' },
}

const MCP_EXAMPLES = [
  {
    id: 'dt-list',
    title: 'List Decision Tables',
    description: 'Find available business rules before wiring them into workflows or testing them.',
    snippet: `decision_tables_list({
  "search": "expense",
  "limit": 20
})`,
  },
  {
    id: 'dt-create',
    title: 'Create Decision Table',
    description: 'Create a business rule with typed inputs, outputs, and ordered matching rules.',
    snippet: `decision_tables_create({
  "name": "Expense Approval",
  "description": "Routes expense claims based on amount and department",
  "inputs": [
    { "key": "amount", "label": "Amount", "type": "number" },
    { "key": "department", "label": "Department", "type": "text" }
  ],
  "outputs": [
    { "key": "approver", "label": "Approver", "type": "text" },
    { "key": "priority", "label": "Priority", "type": "text" }
  ],
  "rules": [
    {
      "label": "Finance high value",
      "enabled": true,
      "conditions": [
        { "inputKey": "department", "operator": "equals", "value": "Finance" },
        { "inputKey": "amount", "operator": "greater_than", "value": 1000 }
      ],
      "outputs": {
        "approver": "cfo",
        "priority": "high"
      }
    }
  ]
})`,
  },
  {
    id: 'dt-test',
    title: 'Test Decision Table',
    description: 'Validate a rule quickly and inspect the matched outputs before using it in production.',
    snippet: `decision_tables_test({
  "decision_table_id": "your-decision-table-id",
  "values": {
    "amount": 1500,
    "department": "Finance"
  }
})`,
  },
]

interface Props {
  apiKeys: any[]
  tenantSlug: string
  mcpServers: any[]
  toolCategories: Array<{ category: string; count: number }>
}

export function McpSettingsView({ apiKeys, tenantSlug, mcpServers, toolCategories }: Props) {
  const router = useRouter()
  const [copied, setCopied] = useState<string | null>(null)
  const [showAddServer, setShowAddServer] = useState(false)
  const { can } = usePermissions()
  const canEditServers = can('settings.edit')
  const queryClient = useQueryClient()
  const [serverError, setServerError] = useState('')
  const [serverName, setServerName] = useState('')
  const [serverUrl, setServerUrl] = useState('')
  const [serverAuthType, setServerAuthType] = useState<'none' | 'bearer' | 'api_key'>('none')
  const [serverToken, setServerToken] = useState('')
  const [saving, setSaving] = useState(false)
  // Synchronous guard: two clicks in one frame both see saving === false.
  const addGuard = useSubmitGuard()

  const mcpUrl = `${APP_URL}/api/mcp`
  const activeKey = apiKeys[0]

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const claudeConfig = JSON.stringify({
    mcpServers: {
      usertasks: {
        url: mcpUrl,
        headers: {
          Authorization: `Bearer ${activeKey ? `${activeKey.key_prefix}...` : '<your-api-key>'}`,
        },
      },
    },
  }, null, 2)

  const chatgptConfig = JSON.stringify({
    mcpServers: {
      usertasks: {
        url: mcpUrl,
        headers: {
          Authorization: `Bearer ${activeKey ? `${activeKey.key_prefix}...` : '<your-api-key>'}`,
        },
      },
    },
  }, null, 2)

  const [addError, setAddError] = useState('')
  const displayedToolCategories = toolCategories
    .map((item) => {
      const display = TOOL_CATEGORY_DISPLAY[item.category]
      if (!display) return null
      return { ...item, ...display }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  async function handleAddServer() {
    await addGuard.run(async () => {
      if (!serverName.trim() || !serverUrl.trim()) return
      setAddError('')
      // Validate URL
      try { new URL(serverUrl.trim()) } catch { setAddError('Invalid URL'); return }
      const host = new URL(serverUrl.trim()).hostname.toLowerCase()
      if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) { setAddError('Private network URLs are not allowed'); return }

      setSaving(true)
      try {
        const { addMcpServer } = await import('@/app/actions/mcp-servers')
        await addMcpServer({
          name: serverName.trim(),
          url: serverUrl.trim(),
          authType: serverAuthType,
          token: serverToken,
        })
        setShowAddServer(false)
        setServerName('')
        setServerUrl('')
        setServerToken('')
        router.refresh()
      } catch (err: any) {
        setAddError(err.message ?? 'Failed to add server')
      }
      setSaving(false)
    })
  }

  async function handleDeleteServer(id: string) {
    if (!confirm('Delete this MCP server?')) return
    setServerError('')
    try {
      const { deleteMcpServer } = await import('@/app/actions/mcp-servers')
      await deleteMcpServer(id)
      router.refresh()
    } catch (err: any) {
      setServerError(err?.message ?? 'Failed to delete server')
    }
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/settings" className="p-1.5 rounded-lg hover:bg-subtle transition-colors text-fg-muted">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-fg">MCP Servers</h1>
          <p className="text-sm mt-0.5 text-fg-muted">Connect UserTasks to Claude, ChatGPT, Cursor, or other MCP clients</p>
        </div>
      </div>

      {/* Connect UserTasks to Claude */}
      <Card className="p-6 space-y-5 bg-panel border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary-wash">
            <Plug size={20} style={{ color: 'var(--theme-primary-text)' }} />
          </div>
          <div>
            <h2 className="font-semibold text-fg">Connect to UserTasks</h2>
            <p className="text-xs text-fg-muted">Use this MCP server to control your tenant from Claude, ChatGPT, Cursor, or any MCP client</p>
          </div>
        </div>

        {/* Endpoint */}
        <div>
          <label className="text-xs font-medium block mb-1.5 text-fg-muted">MCP Server URL</label>
          <div className="flex gap-2">
            <Input value={mcpUrl} readOnly className="font-mono text-sm bg-subtle" />
            <Button variant="outline" size="sm" onClick={() => copyToClipboard(mcpUrl, 'url')}>
              {copied === 'url' ? <Check size={14} /> : <Copy size={14} />}
            </Button>
          </div>
        </div>

        {/* API Key */}
        <div>
          <label className="text-xs font-medium block mb-1.5 text-fg-muted">API Key</label>
          {activeKey ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono px-3 py-2 rounded-lg flex-1 bg-subtle text-fg">
                  {activeKey.key_prefix}••••••••••••
                </code>
                <Link href="/settings/api-keys" className="text-xs hover:underline text-primary-text">
                  Manage keys
                </Link>
              </div>
              <p className="text-2xs text-fg-muted">
                Copy the full API key from the <Link href="/settings/api-keys" className="underline">API Keys page</Link> and paste it into the config below.
              </p>
            </div>
          ) : (
            <div className="rounded-lg p-3 bg-subtle">
              <p className="text-xs text-fg-muted">
                No API keys found. <Link href="/settings/api-keys" className="font-medium text-primary-text">Create one</Link> to connect.
              </p>
            </div>
          )}
        </div>

        {/* Claude Desktop Config */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-fg-muted">Claude Desktop Configuration</label>
            <button
              onClick={() => copyToClipboard(claudeConfig, 'config')}
              className="text-xs flex items-center gap-1 hover:underline text-primary-text"
            >
              {copied === 'config' ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
            </button>
          </div>
          <pre
            className="text-xs font-mono p-4 rounded-lg overflow-x-auto leading-relaxed bg-subtle text-fg"
          >
            {claudeConfig}
          </pre>
          <p className="text-2xs mt-2 text-fg-muted">
            Add this to your <code className="px-1 py-0.5 rounded text-2xs bg-subtle">claude_desktop_config.json</code> file.
            Replace the API key with a full key from the <Link href="/settings/api-keys" className="underline">API Keys page</Link>.
          </p>
        </div>

        {/* ChatGPT Config */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-fg-muted">ChatGPT MCP Configuration</label>
            <button
              onClick={() => copyToClipboard(chatgptConfig, 'chatgpt-config')}
              className="text-xs flex items-center gap-1 hover:underline text-primary-text"
            >
              {copied === 'chatgpt-config' ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
            </button>
          </div>
          <pre
            className="text-xs font-mono p-4 rounded-lg overflow-x-auto leading-relaxed bg-subtle text-fg"
          >
            {chatgptConfig}
          </pre>
          <div className="mt-2 space-y-1.5">
            <p className="text-2xs text-fg-muted">
              In ChatGPT, open <strong>Settings → Connectors → Custom MCP</strong> or the MCP connection screen available in your workspace, then add a new MCP server using the config above.
            </p>
            <p className="text-2xs text-fg-muted">
              If your ChatGPT MCP screen asks for fields instead of JSON, use the server URL <code className="px-1 py-0.5 rounded text-2xs bg-subtle">{mcpUrl}</code> and set the <code className="px-1 py-0.5 rounded text-2xs bg-subtle">Authorization</code> header to <code className="px-1 py-0.5 rounded text-2xs bg-subtle">Bearer &lt;your-api-key&gt;</code>.
            </p>
            <p className="text-2xs text-fg-muted">
              For best results, use a user API key when you want ChatGPT to act with a specific UserTasks user context for tasks, workflow actions, and report queries.
            </p>
          </div>
        </div>

        {/* Claude Web (claude.ai) */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-fg-muted">Claude Web / claude.ai (Remote MCP)</label>
            <button
              onClick={() => copyToClipboard(`${mcpUrl}?key=${activeKey ? `${activeKey.key_prefix}...` : '<your-api-key>'}`, 'weburl')}
              className="text-xs flex items-center gap-1 hover:underline text-primary-text"
            >
              {copied === 'weburl' ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
            </button>
          </div>
          <div className="rounded-md bg-subtle p-4 space-y-2">
            <p className="text-xs font-mono text-fg">
              {mcpUrl}?key=<span className="text-warning">{'<your-api-key>'}</span>
            </p>
          </div>
          <div className="mt-2 space-y-1.5">
            <p className="text-2xs text-fg-muted">
              Claude&apos;s web connector does not support custom headers. Pass your API key as a <code className="px-1 py-0.5 rounded text-2xs bg-subtle">?key=</code> query parameter instead.
            </p>
            <p className="text-2xs text-fg-muted">
              In claude.ai: <strong>Settings → Connectors → Add Connector</strong> → paste the URL above as the Remote MCP Server URL. Leave OAuth fields blank.
            </p>
          </div>
        </div>

        {/* Available tools */}
        <div>
          <label className="text-xs font-medium block mb-2 text-fg-muted">{displayedToolCategories.reduce((s, c) => s + c.count, 0)} Tools Available</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {displayedToolCategories.map(cat => (
              <div key={cat.category} className="flex items-center gap-2 rounded-lg px-3 py-2 bg-subtle">
                <cat.icon size={14} className={cat.color} />
                <div>
                  <span className="text-xs font-medium block text-fg">{cat.label}</span>
                  <span className="text-2xs text-fg-muted">{cat.count} tools</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium block mb-1.5 text-fg-muted">Example MCP Calls</label>
            <p className="text-2xs text-fg-muted">
              These examples show how agents and MCP clients can create and test business rules directly from UserTasks.
            </p>
          </div>
          <div className="space-y-3">
            {MCP_EXAMPLES.map((example) => (
              <div
                key={example.id}
                className="rounded-xl border p-4 space-y-2 bg-subtle border-border"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium text-fg">{example.title}</h3>
                    <p className="text-2xs mt-0.5 text-fg-muted">{example.description}</p>
                  </div>
                  <button
                    onClick={() => copyToClipboard(example.snippet, example.id)}
                    className="text-xs flex items-center gap-1 hover:underline shrink-0 text-primary-text"
                  >
                    {copied === example.id ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
                  </button>
                </div>
                <pre
                  className="text-xs font-mono p-3 rounded-lg overflow-x-auto leading-relaxed bg-subtle text-fg"
                >
                  {example.snippet}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* External MCP Servers (for agents) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-fg">External MCP Servers</h2>
            <p className="text-xs text-fg-muted">Connect external MCP servers for use as agent tools</p>
          </div>
          {canEditServers && (
            <div className="flex items-center gap-2">
              <ImportConfigButton onImported={() => void queryClient.invalidateQueries({ queryKey: ['mcp-settings'] })} />
              <Button size="sm" onClick={() => setShowAddServer(true)}>
                <Plus size={14} className="mr-1" /> Add Server
              </Button>
            </div>
          )}
        </div>

        {serverError && (
          <p className="mb-3 rounded-lg bg-danger-wash border border-danger p-2.5 text-xs text-danger">{serverError}</p>
        )}

        {mcpServers.length === 0 && !showAddServer && (
          <Card className="p-8 text-center bg-panel border-border">
            <Plug size={32} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium text-fg">No external MCP servers configured</p>
            <p className="text-xs mt-1 text-fg-muted">Add an external MCP server to give your AI agents access to additional tools</p>
          </Card>
        )}

        {showAddServer && (
          <Card className="p-4 space-y-3 mb-3 bg-panel border-border">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1 text-fg-muted">Server Name</label>
                <Input value={serverName} onChange={e => setServerName(e.target.value)} placeholder="e.g. Slack MCP" />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1 text-fg-muted">Server URL</label>
                <Input value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="https://..." />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium block mb-1 text-fg-muted">Auth Type</label>
                <select
                  value={serverAuthType}
                  onChange={e => setServerAuthType(e.target.value as 'none' | 'bearer' | 'api_key')}
                  className="w-full rounded-lg border px-3 py-2 text-sm border-border"
                >
                  <option value="none">None</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="api_key">API Key Header</option>
                </select>
              </div>
              {serverAuthType !== 'none' && (
                <div>
                  <label className="text-xs font-medium block mb-1 text-fg-muted">Token / Key</label>
                  <Input type="password" value={serverToken} onChange={e => setServerToken(e.target.value)} placeholder="••••••••" />
                </div>
              )}
            </div>
            {addError && <p className="text-xs text-danger">{addError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setShowAddServer(false); setAddError('') }}>Cancel</Button>
              <Button size="sm" onClick={handleAddServer} disabled={!serverName.trim() || !serverUrl.trim() || saving}>
                {saving ? 'Adding...' : 'Add Server'}
              </Button>
            </div>
          </Card>
        )}

        {mcpServers.map((server: any) => (
          <Card key={server.id} className="p-4 mb-2 flex items-center justify-between bg-panel border-border">
            <div className="flex items-center gap-3">
              <div className={cn('w-2 h-2 rounded-full', server.is_active ? 'bg-green-500' : 'bg-gray-300')} />
              <div>
                <h3 className="text-sm font-medium text-fg">{server.name}</h3>
                <p className="text-2xs font-mono truncate max-w-[300px] text-fg-muted">{server.url}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {server.tools_cache?.length > 0 && (
                <span className="text-2xs px-2 py-0.5 rounded-full bg-subtle text-fg-muted">
                  {server.tools_cache.length} tools
                </span>
              )}
              <span className="text-2xs text-fg-muted">
                {server.auth_type !== 'none' ? server.auth_type : 'No auth'}
              </span>
              {can('settings.view') && <ExportAssetButton ids={[server.id]} name={server.name} iconOnly variant="ghost" className="!h-auto !p-1.5 text-fg-muted" />}
              {canEditServers && (
                <button onClick={() => handleDeleteServer(server.id)} className="p-1.5 rounded hover:bg-danger-wash text-danger hover:text-danger">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
