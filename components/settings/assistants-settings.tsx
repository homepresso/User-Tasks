'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, KeyRound, Mic, PlugZap, Sparkles, Trash2 } from 'lucide-react'
import { usePermissions } from '@/lib/permissions-context'
import { useDashboardAuth } from '@/lib/dashboard-auth-context'
import { serverQuery, serverRead } from '@/lib/server-read'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { SearchableMultiOptionPicker } from '@/components/ui/searchable-multi-option-picker'
import { formatRelativeDate } from '@/lib/utils'
import { formatCost } from '@/lib/agents/pricing'
import { AgentProfiles, toProfileDrafts, type ProfileDraft } from './agent-profiles'
import { ThinkingLevelSelect } from './thinking-level-select'
import { THINKING_LABELS, THINKING_LEVELS, type ThinkingLevel } from '@/lib/agents/reasoning'
import { agentProviderKind } from '@/lib/agents/provider'
import { removeAssistantKeyAction, testAssistantConnectionAction, updateAssistantSettingsAction } from '@/app/actions/assistants'
import {
  AGENT_TOOL_GROUPS, ASSISTANT_PROVIDERS, PROVIDER_PRESETS, TOOL_GROUP_LABELS,
  type AgentSettings, type AgentToolGroup, type AssistantProvider, type AssistantSettingsView,
} from '@/lib/assistants/types'
import { DICTATION_ENGINES, DICTATION_ENGINE_LABELS, DICTATION_LANGUAGES, type DictationEngine, type DictationSettings } from '@/lib/assistants/dictation'

/**
 * Settings → Agent (assistants.manage): the provider, key and model the
 * Agent uses, the Agent's on / off switch, who may use it (one access list),
 * Advanced per-help switches, and the limits. The key is write-only — the
 * page only ever sees "•••• last4"; nothing shows to anyone until a key is
 * saved AND the Agent is turned on. What each person can do with the Agent
 * follows their own permissions.
 */

const QUERY_KEY = ['assistants-settings']
type Notice = { tone: 'success' | 'warning' | 'error'; message: string }
type Option = { id: string; name: string; type: string }
type View = AssistantSettingsView & { integrations: Option[]; transcription_integrations?: Option[]; agent_transcribes?: boolean }

const muted = { color: 'var(--theme-muted-text)' }
const fieldStyle = { borderColor: 'var(--theme-surface-border)' }

const CAPABILITY_HINTS: Record<AgentToolGroup, string> = {
  form: 'On a form being filled: explains fields and proposes values (people with Submit forms). People apply each value themselves; it never submits.',
  task: 'On a task: summarises it, its form and its comments, explains the outcomes, drafts comments and suggests an outcome. It completes, approves or declines a task only when asked, after the person confirms (see below).',
  designer: 'Everywhere: looks up workflows, forms, tables and rules (with view permissions) and, for people who can build, builds and edits them, adds / changes / deletes data rows, and builds from attached files. Every change is confirmed first; workflows are saved as drafts.',
  admin: 'For people with admin permissions: explains settings, who has access and why, audit, usage and workspace health, and makes admin changes (invite, roles, teams, managers, org, theme, sign-in page, retention) with each change\'s own permission, confirmed first. Never secrets, SSO, the workspace address, billing, its own settings, or the person\'s own access.',
}

export function AssistantsSettings() {
  const { can } = usePermissions()
  const canManage = can('assistants.manage')
  const { profile } = useDashboardAuth()
  const tenantId: string = profile?.current_tenant_id ?? profile?.tenant_id ?? ''
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    enabled: canManage,
    queryFn: () => serverQuery('assistants.settings') as Promise<View>,
  })
  const { data: roles = [] } = useQuery({
    queryKey: ['assistants-role-options', tenantId],
    enabled: canManage && Boolean(tenantId),
    queryFn: async () => (await serverRead('governance.roleOptions', { tenantId })).data ?? [],
  })
  const { data: users = [] } = useQuery({
    queryKey: ['assistants-user-options', tenantId],
    enabled: canManage && Boolean(tenantId),
    queryFn: async () => (await serverRead('governance.userOptions', { tenantId })).data ?? [],
  })
  const { data: teams = [] } = useQuery({
    queryKey: ['assistants-team-options', tenantId],
    enabled: canManage && Boolean(tenantId),
    queryFn: async () => (await serverRead('governance.teamOptions', { tenantId })).data ?? [],
  })

  const [provider, setProvider] = useState<AssistantProvider>('openai')
  const [keySource, setKeySource] = useState<'key' | 'integration'>('key')
  const [integrationId, setIntegrationId] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [agent, setAgent] = useState<AgentSettings | null>(null)
  const [profilesDraft, setProfilesDraft] = useState<ProfileDraft[]>([])
  const [perDay, setPerDay] = useState('')
  const [costCap, setCostCap] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [requestTokens, setRequestTokens] = useState('')
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'remove'>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  useEffect(() => {
    if (!data) return
    setProvider(data.provider)
    setKeySource(data.key_source)
    setIntegrationId(data.integration_id ?? '')
    setBaseUrl(data.base_url ?? '')
    setModel(data.model ?? '')
    setKey('')
    setReplacing(false)
    setAgent(data.agent)
    setProfilesDraft(toProfileDrafts(data.agent.profiles))
    setPerDay(data.limits.messages_per_user_per_day ? String(data.limits.messages_per_user_per_day) : '')
    setCostCap(data.limits.monthly_cost_cap ? String(data.limits.monthly_cost_cap) : '')
    setCurrency(data.limits.cost_currency || 'USD')
    setRequestTokens(data.limits.max_request_tokens ? String(data.limits.max_request_tokens) : '')
  }, [data])

  const roleOptions = useMemo(() => (roles as Array<{ id: string; name: string }>).map((r) => ({ value: r.id, label: r.name })), [roles])
  const userOptions = useMemo(() => (users as Array<{ id: string; display_name: string | null; email: string }>).map((u) => ({ value: u.id, label: u.display_name || u.email })), [users])
  const teamOptions = useMemo(() => (teams as Array<{ id: string; name: string }>).map((t) => ({ value: t.id, label: t.name })), [teams])

  if (!canManage) {
    return <div className="max-w-3xl"><InlineNotice tone="warning" message="You need the Manage the Agent permission to see this page." /></div>
  }
  if (isLoading || !data || !agent) return <PageSkeleton variant="settings" />

  const preset = PROVIDER_PRESETS[provider]
  const keySaved = data.key_saved && provider === data.provider
  const showKeyInput = !keySaved || replacing
  const hasIntegrations = data.integrations.length > 0
  const disabled = busy !== null

  const connectionReady = keySource === 'integration'
    ? Boolean(integrationId)
    : (!preset.keyRequired || keySaved || key.trim() !== '') && (preset.baseUrl !== 'required' || baseUrl.trim() !== '')

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    await queryClient.invalidateQueries({ queryKey: ['assistant-availability'] })
  }

  async function save() {
    setBusy('save'); setNotice(null); setTestResult(null)
    try {
      const res = await updateAssistantSettingsAction({
        provider,
        key_source: keySource,
        integration_id: keySource === 'integration' ? integrationId || null : null,
        base_url: keySource === 'key' && preset.baseUrl !== 'hidden' ? baseUrl.trim() || null : null,
        model: model.trim(),
        ...(keySource === 'key' && key.trim() ? { api_key: key.trim() } : {}),
        agent: { ...agent!, profiles: profilesDraft },
        limits: { messages_per_user_per_day: Number(perDay) || 0, monthly_cost_cap: Number(costCap) || 0, cost_currency: currency.trim().toUpperCase() || 'USD', max_request_tokens: Number(requestTokens) || 0 },
      })
      if (!res.ok) { setNotice({ tone: 'error', message: res.error }); return }
      setKey('')
      setNotice(res.data.configured
        ? { tone: 'success', message: res.data.agent.enabled ? 'Saved. People you allowed now see the Agent.' : 'Saved. Turn the Agent on below for it to appear.' }
        : { tone: 'warning', message: 'Saved. Add an API key (or pick a connection) for the Agent to appear.' })
      await refresh()
    } finally { setBusy(null) }
  }

  async function test() {
    setBusy('test'); setNotice(null); setTestResult(null)
    try {
      const res = await testAssistantConnectionAction()
      if (!res.ok) { setNotice({ tone: 'error', message: res.error }); return }
      setTestResult(res.data)
      await refresh()
    } finally { setBusy(null) }
  }

  async function remove() {
    setBusy('remove'); setNotice(null); setTestResult(null)
    try {
      const res = await removeAssistantKeyAction()
      if (!res.ok) { setNotice({ tone: 'error', message: res.error }); return }
      setConfirmRemove(false)
      setNotice({ tone: 'success', message: 'The API key was removed. The Agent is hidden until a key is saved again.' })
      await refresh()
    } finally { setBusy(null) }
  }

  const patchAgent = (patch: Partial<AgentSettings>) => setAgent((a) => (a ? { ...a, ...patch } : a))

  return (
    <div className="max-w-3xl space-y-6" data-testid="assistants-settings">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Sparkles size={22} /> Agent</h1>
        <p className="text-sm mt-1" style={muted}>
          Agent is your AI assistant: one chat on every screen that keeps its conversation as people move between tasks, forms and the builders. It helps fill forms and action tasks, and helps builders create workflows, forms and tables — from a description or an attached file. Bring your own AI provider key. (Not the same as the workflow AI agents under Agents.){' '}
          <Link href="/docs/ai-assistants" className="underline underline-offset-2">Docs</Link>
        </p>
      </div>

      <InlineNotice
        tone={data.configured ? 'success' : 'warning'}
        message={data.configured ? `Connected to ${PROVIDER_PRESETS[data.provider].label}${data.model ? ` (${data.model})` : ''}.` : 'Not set up: the Agent is shown to no one until a provider key is saved and the Agent is turned on.'}
      />
      {notice && <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />}

      {/* ── Connection ── */}
      <Card className="p-5 space-y-5" data-tour="agent-provider">
        <h2 className="text-base font-semibold">Provider (default model)</h2>
        <div className="space-y-1">
          <label htmlFor="assistants-provider" className="block text-sm font-medium">AI provider</label>
          <Select id="assistants-provider" data-testid="assistants-provider" value={provider} disabled={disabled}
            onChange={(e) => { setProvider(e.target.value as AssistantProvider); setReplacing(false); setKey('') }} className="max-w-72">
            {ASSISTANT_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_PRESETS[p].label}</option>)}
          </Select>
          <p className="text-xs" style={muted}>{preset.help}</p>
        </div>

        <fieldset disabled={disabled} className="space-y-2">
          <legend className="text-sm font-medium mb-1">Key</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="assistants-key-source" checked={keySource === 'key'} onChange={() => setKeySource('key')} className="mt-1" style={{ accentColor: 'var(--theme-primary)' }} data-testid="assistants-key-source-key" />
            <span><span className="font-medium">Enter an API key</span><span className="block text-xs" style={muted}>Stored encrypted for the assistants only.</span></span>
          </label>
          {(hasIntegrations || keySource === 'integration') && (
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="assistants-key-source" checked={keySource === 'integration'} onChange={() => setKeySource('integration')} className="mt-1" style={{ accentColor: 'var(--theme-primary)' }} data-testid="assistants-key-source-integration" />
              <span><span className="font-medium">Use an Integrations connection</span><span className="block text-xs" style={muted}>An AI provider connection your agents already use (its key, base URL and default model).</span></span>
            </label>
          )}
        </fieldset>

        {keySource === 'integration' ? (
          <div className="space-y-1">
            <label htmlFor="assistants-integration" className="block text-sm font-medium">Connection</label>
            <Select id="assistants-integration" data-testid="assistants-integration" value={integrationId} disabled={disabled} onChange={(e) => setIntegrationId(e.target.value)} className="max-w-72">
              <option value="">Choose a connection…</option>
              {data.integrations.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.type})</option>)}
            </Select>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <span className="block text-sm font-medium">API key {!preset.keyRequired && <span className="font-normal" style={muted}>(optional)</span>}</span>
              {showKeyInput ? (
                <div className="flex items-center gap-2">
                  <Input id="assistants-api-key" aria-label="API key" data-testid="assistants-api-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} disabled={disabled}
                    placeholder={keySaved ? 'New key' : preset.keyPlaceholder} autoComplete="new-password" spellCheck={false} />
                  {replacing && <Button variant="ghost" size="sm" onClick={() => { setReplacing(false); setKey('') }}>Cancel</Button>}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm font-mono" style={fieldStyle} data-testid="assistants-key-saved">
                    <KeyRound size={13} /> {data.key_hint ?? '•••• saved'}
                  </span>
                  <Button variant="outline" size="sm" disabled={disabled} onClick={() => setReplacing(true)}>Replace</Button>
                  <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirmRemove(true)} data-testid="assistants-remove-key"><Trash2 size={13} /> Remove</Button>
                </div>
              )}
              <p className="text-xs" style={muted}>Stored encrypted and never shown again — only its last four characters. Changing the provider needs a new key.</p>
            </div>
            {preset.baseUrl !== 'hidden' && (
              <div className="space-y-1">
                <label htmlFor="assistants-base-url" className="block text-sm font-medium">Base URL {preset.baseUrl === 'optional' && <span className="font-normal" style={muted}>(optional)</span>}</label>
                <Input id="assistants-base-url" data-testid="assistants-base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} disabled={disabled}
                  placeholder={preset.defaultBaseUrl ?? 'https://llm.example.com/v1'} autoComplete="off" spellCheck={false} />
                <p className="text-xs" style={muted}>{preset.baseUrl === 'optional' ? 'Leave empty for the provider\'s own API; set it for a proxy or gateway.' : 'Where your server is reached. Servers on a private network need ALLOW_PRIVATE_EGRESS=true on self-hosted instances.'}</p>
              </div>
            )}
          </>
        )}

        <div className="space-y-1">
          <label htmlFor="assistants-model" className="block text-sm font-medium">Model</label>
          <Input id="assistants-model" data-testid="assistants-model" list="assistants-model-options" value={model} onChange={(e) => setModel(e.target.value)} disabled={disabled}
            placeholder={preset.defaultModel || 'model id'} className="max-w-72" autoComplete="off" spellCheck={false} />
          <datalist id="assistants-model-options">{preset.models.map((m) => <option key={m} value={m} />)}</datalist>
          <p className="text-xs" style={muted}>Any model id your key can use; it must support tool calling.{preset.defaultModel ? ` Empty uses ${preset.defaultModel}.` : ''}</p>
        </div>

        <ThinkingLevelSelect id="assistants-thinking-level" value={agent.thinking_level} onChange={(thinking_level) => patchAgent({ thinking_level })} disabled={disabled}
          provider={keySource === 'integration' ? (data.integrations.find((i) => i.id === integrationId) ? agentProviderKind(data.integrations.find((i) => i.id === integrationId)!.type, null) : null) : provider}
          model={model.trim() || preset.defaultModel} />
        <details className="text-sm" data-testid="assistants-thinking-groups">
          <summary className="cursor-pointer font-medium">Thinking level per help group (advanced)</summary>
          <p className="mt-2 text-xs" style={muted}>Overrides the level above for one kind of help, e.g. High for building and Low for form and task help. A profile&apos;s own level wins over these. Applied only where the model supports it.</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {([['designer', 'Building help'], ['form', 'Form help'], ['task', 'Task help']] as const).map(([group, label]) => (
              <div key={group} className="space-y-1">
                <label htmlFor={`assistants-thinking-${group}`} className="block text-xs font-medium">{label}</label>
                <Select id={`assistants-thinking-${group}`} value={agent.thinking_levels?.[group] ?? 'default'} disabled={disabled}
                  onChange={(e) => { const v = e.target.value as ThinkingLevel; const next = { ...(agent.thinking_levels ?? {}) }; if (v === 'default') delete next[group]; else next[group] = v; patchAgent({ thinking_levels: next }) }}>
                  {THINKING_LEVELS.map((l) => <option key={l} value={l}>{l === 'default' ? 'Same as above' : THINKING_LABELS[l]}</option>)}
                </Select>
              </div>
            ))}
          </div>
        </details>

        {testResult && <InlineNotice tone={testResult.ok ? 'success' : 'error'} message={testResult.message} onDismiss={() => setTestResult(null)} />}
        {!testResult && data.last_tested_at && (
          <p className="text-xs flex items-center gap-1" style={muted} data-testid="assistants-last-test">
            {data.last_test_status === 'ok' && <CheckCircle2 size={12} />}
            Last test {formatRelativeDate(data.last_tested_at)}: {data.last_test_message}
          </p>
        )}
      </Card>

      {/* ── The Agent ── */}
      <AgentCard value={agent} disabled={disabled} roleOptions={roleOptions} teamOptions={teamOptions} onChange={patchAgent} />

      {/* ── Dictation ── */}
      <DictationCard value={agent.dictation} disabled={disabled} integrations={data.transcription_integrations ?? []} agentTranscribes={Boolean(data.agent_transcribes)}
        onChange={(patch) => patchAgent({ dictation: { ...agent.dictation, ...patch } })} />

      {/* ── Profiles: who gets which Agent; the Default profile is the settings on this page ── */}
      <AgentProfiles profiles={profilesDraft} onChange={setProfilesDraft} disabled={disabled} saved={data.agent.profiles} tenantId={tenantId}
        defaults={{
          modelLabel: `${PROVIDER_PRESETS[data.provider].label}${data.model || PROVIDER_PRESETS[data.provider].defaultModel ? ` · ${data.model || PROVIDER_PRESETS[data.provider].defaultModel}` : ''}`,
          thinking: agent.thinking_level, tools: agent.tools, taskActions: agent.task_actions !== false,
          limits: { messages_per_user_per_day: Number(perDay) || 0, monthly_cost_cap: Number(costCap) || 0, cost_currency: currency.trim().toUpperCase() || 'USD', max_request_tokens: Number(requestTokens) || 0 },
        }}
        roleOptions={roleOptions} teamOptions={teamOptions} userOptions={userOptions} integrations={data.integrations} defaultProvider={provider} defaultModel={model.trim() || preset.defaultModel} />

      {/* ── Limits ── */}
      <Card className="p-5 space-y-4">
        <h2 className="text-base font-semibold">Limits</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="assistants-per-day" className="block text-sm font-medium">Messages per person per day</label>
            <Input id="assistants-per-day" data-testid="assistants-per-day" type="number" min={0} value={perDay} onChange={(e) => setPerDay(e.target.value)} disabled={disabled} placeholder="No limit" className="max-w-40" />
            <p className="text-xs" style={muted}>Each request to the Agent counts (a message, a choice or a confirmation). Empty or 0: no limit.</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="assistants-cost-cap" className="block text-sm font-medium">Monthly cost cap</label>
            <div className="flex gap-2">
              <Input id="assistants-cost-cap" data-testid="assistants-cost-cap" type="number" min={0} step="0.01" value={costCap} onChange={(e) => setCostCap(e.target.value)} disabled={disabled} placeholder="No cap" className="max-w-32" />
              <Input aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value.slice(0, 3))} disabled={disabled} className="max-w-20 uppercase" />
            </div>
            <p className="text-xs" style={muted}>Everyone&apos;s Agent use together, per calendar month (UTC), at the prices in Agents → Costs. Models without a price don&apos;t count.</p>
          </div>
        </div>
        <details className="text-sm" data-testid="assistants-advanced-limits">
          <summary className="cursor-pointer font-medium">Advanced</summary>
          <div className="mt-3 space-y-1">
            <label htmlFor="assistants-request-tokens" className="block text-sm font-medium">Token limit per request</label>
            <Input id="assistants-request-tokens" data-testid="assistants-request-tokens" type="number" min={0} step={1000} value={requestTokens} onChange={(e) => setRequestTokens(e.target.value)} disabled={disabled} placeholder="Unlimited" className="max-w-40" />
            <p className="text-xs" style={muted}>All the model calls of one Agent request together (cached input counts a tenth). Empty or 0: unlimited — the monthly cost cap is the guard. When set (at least 10,000), the Agent stops before it would pass the limit and says so; the person can say &ldquo;continue&rdquo;.</p>
          </div>
        </details>
        {data.unpriced_models && data.unpriced_models.length > 0 && (
          <p className="text-sm rounded-md border px-3 py-2" role="alert" data-testid="assistants-unpriced-models" style={{ borderColor: 'var(--color-warning, #d97706)' }}>
            No price for {data.unpriced_models.map((m) => `“${m}”`).join(', ')}: the monthly cost cap can&apos;t count {data.unpriced_models.length === 1 ? 'its' : 'their'} use.{' '}
            <Link href="/agents/costs" className="underline">Add a price or fetch the latest pricing in Agents → Costs &amp; budgets</Link>.
          </p>
        )}
        {data.usage && (
          <p className="text-sm" data-testid="assistants-usage">
            This month: <span className="font-medium">{formatCost(data.usage.cost_this_month, data.usage.currency)}</span> · {data.usage.messages_today} request{data.usage.messages_today === 1 ? '' : 's'} in the last 24 hours (everyone)
            {data.usage.unpriced_calls > 0 && <span style={muted}> · {data.usage.unpriced_calls} with an unknown cost (add the model&apos;s price in Agents → Costs)</span>}
          </p>
        )}
        <p className="text-xs" style={muted}>Costs use the model prices in <Link href="/agents/costs" className="underline">Agents → Costs &amp; budgets</Link> (built-in list prices, your own, or <em>Fetch latest pricing</em>).</p>
      </Card>

      <Card className="p-5 space-y-2 text-sm" data-testid="assistants-privacy">
        <h2 className="text-base font-semibold">Privacy</h2>
        <p style={muted}>
          What a person asks, the files they attach, and what is on their screen are sent to the provider: the visible fields and values of the form they are filling (never secret fields,
          and nothing from forms whose Agent form help is off), the task&apos;s details and comments, or the item open in a builder. The Agent acts only with that person&apos;s own permissions,
          treats screen and file content as data (not instructions), and every request is recorded with its tokens and cost. Attached files are read once and not stored on the server.
          The conversation is kept in the person&apos;s browser (per person and workspace, size-capped) so it follows them between screens, and is removed when they sign out.
        </p>
        <p style={muted}>
          Dictation with browser speech recognition is done by the person&apos;s browser: Chrome and Edge send the audio to their vendor&apos;s speech service (Google, Microsoft), Safari to Apple&apos;s
          (or on the device). With a transcription provider, the recording goes from this server to that provider only — it is held in memory for the call and never stored.
        </p>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!connectionReady || disabled} onClick={() => void save()} data-testid="assistants-save">
          {busy === 'save' ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="outline" size="sm" disabled={!data.configured || disabled} onClick={() => void test()} data-testid="assistants-test"
          title={data.configured ? 'Test the saved connection' : 'Save a key first'}>
          <PlugZap size={13} /> {busy === 'test' ? 'Testing…' : 'Test connection'}
        </Button>
        <span className="text-xs" style={muted}>Test connection uses the saved settings.</span>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove the API key?"
        description="The Agent disappears for everyone in this workspace until a key is saved again."
        confirmLabel="Remove"
        destructive
        busy={busy === 'remove'}
        onConfirm={() => remove()}
      />
    </div>
  )
}

function AgentCard({ value, disabled, roleOptions, teamOptions, onChange }: {
  value: AgentSettings
  disabled: boolean
  roleOptions: Array<{ value: string; label: string }>
  teamOptions: Array<{ value: string; label: string }>
  onChange: (patch: Partial<AgentSettings>) => void
}) {
  const restricted = value.roles.length > 0 || value.teams.length > 0
  const [limit, setLimit] = useState(restricted)
  return (
    <Card className="p-5 space-y-4" data-testid="assistants-agent" data-tour="agent-enable">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Agent</h2>
          <p className="text-xs mt-0.5" style={muted}>
            Shows the Agent button on every screen for the people below — this list decides who can use the Agent at all; Profiles further down decide what each of them gets. What they can do follows their own permissions: everyone can ask questions and look things up,
            people who submit forms get form help, people with tasks get task help, and people who can build (create or edit workflows, forms, data or extensions) get building help.
          </p>
        </div>
        <Switch checked={value.enabled} onCheckedChange={(enabled) => onChange({ enabled })} disabled={disabled} aria-label="Turn on the Agent" data-testid="assistants-agent-enabled" />
      </div>
      {value.enabled && (
        <div className="space-y-4 border-t pt-4" style={fieldStyle}>
          <fieldset disabled={disabled} className="space-y-1.5">
            <legend className="text-sm font-medium mb-1">Who can use it</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="assistants-agent-who" checked={!limit} onChange={() => { setLimit(false); onChange({ roles: [], teams: [] }) }} style={{ accentColor: 'var(--theme-primary)' }} />
              Everyone in the workspace
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="assistants-agent-who" checked={limit} onChange={() => setLimit(true)} style={{ accentColor: 'var(--theme-primary)' }} data-testid="assistants-agent-restrict" />
              Only chosen roles and groups
            </label>
          </fieldset>
          {limit && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <span className="block text-xs font-medium">Roles</span>
                <SearchableMultiOptionPicker options={roleOptions} values={value.roles} placeholder="Any role" disabled={disabled} onChange={(roles) => onChange({ roles })} />
              </div>
              <div className="space-y-1">
                <span className="block text-xs font-medium">Groups (teams)</span>
                <SearchableMultiOptionPicker options={teamOptions} values={value.teams} placeholder="Any group" disabled={disabled} onChange={(teams) => onChange({ teams })} />
              </div>
              <p className="text-xs sm:col-span-2" style={muted}>People with one of these roles, or in one of these groups, can use the Agent.</p>
            </div>
          )}
          <details className="rounded-md border px-3 py-2" style={fieldStyle} data-testid="assistants-advanced">
            <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs" style={muted}>The Default profile&apos;s kinds of help (a profile can choose its own below). All are on by default; each still needs the person&apos;s permissions.</p>
              {AGENT_TOOL_GROUPS.map((group) => (
                <div key={group} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{TOOL_GROUP_LABELS[group]}</p>
                    <p className="text-xs" style={muted}>{CAPABILITY_HINTS[group]}</p>
                  </div>
                  <Switch checked={value.tools[group]} onCheckedChange={(on) => onChange({ tools: { ...value.tools, [group]: on } })} disabled={disabled} aria-label={TOOL_GROUP_LABELS[group]} data-testid={`assistants-tools-${group}`} />
                </div>
              ))}
              {value.tools.task && (
                <div className="flex items-start justify-between gap-3 border-t pt-3" style={fieldStyle}>
                  <div>
                    <p className="text-sm font-medium">Let the Agent complete tasks (with confirmation)</p>
                    <p className="text-xs" style={muted}>
                      Task help can complete, approve, decline and accept tasks the person is allowed to action — always after showing a confirmation card they confirm. It checks required fields first and asks for them;
                      managers acting for someone else are asked for the reason. Off: the Agent still reads and explains tasks and their forms, and people use the task&apos;s own buttons. A profile can choose its own.
                    </p>
                  </div>
                  <Switch checked={value.task_actions !== false} onCheckedChange={(on) => onChange({ task_actions: on })} disabled={disabled} aria-label="Let the Agent complete tasks (with confirmation)" data-testid="assistants-task-actions" />
                </div>
              )}
              {value.tools.form && (
                <fieldset disabled={disabled} className="space-y-1.5">
                  <legend className="text-xs font-medium mb-1">Form help on</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" name="assistants-form-scope" checked={value.all_forms} onChange={() => onChange({ all_forms: true })} style={{ accentColor: 'var(--theme-primary)' }} />
                    All forms (a form can turn it off)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="radio" name="assistants-form-scope" checked={!value.all_forms} onChange={() => onChange({ all_forms: false })} style={{ accentColor: 'var(--theme-primary)' }} data-testid="assistants-form-opt-in" />
                    Only forms that turn it on
                  </label>
                  <p className="text-xs" style={muted}>Set per form in the form designer → Header tab → Agent form help on this form (Workspace default / On / Off). Off only turns off form help on that form, not the Agent.</p>
                </fieldset>
              )}
            </div>
          </details>
        </div>
      )}
    </Card>
  )
}

function DictationCard({ value, disabled, integrations, agentTranscribes, onChange }: {
  value: DictationSettings
  disabled: boolean
  integrations: Option[]
  /** The Agent's own connection can transcribe (an OpenAI key or connection). */
  agentTranscribes: boolean
  onChange: (patch: Partial<DictationSettings>) => void
}) {
  const usesProvider = value.engine !== 'browser'
  const providerMissing = usesProvider && !value.integration_id && !agentTranscribes
  const knownLanguage = DICTATION_LANGUAGES.some(([code]) => code === value.language)
  return (
    <Card className="p-5 space-y-4" data-testid="assistants-dictation">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Mic size={16} /> Dictation</h2>
          <p className="text-xs mt-0.5" style={muted}>
            A microphone button in the Agent panel: people talk and the words appear in the message box, ready to edit before sending (Ctrl / ⌘ + Shift + Space).
          </p>
        </div>
        <Switch checked={value.enabled} onCheckedChange={(enabled) => onChange({ enabled })} disabled={disabled} aria-label="Turn on dictation" data-testid="assistants-dictation-enabled" />
      </div>
      {value.enabled && (
        <div className="space-y-4 border-t pt-4" style={fieldStyle}>
          <fieldset disabled={disabled} className="space-y-1.5">
            <legend className="text-sm font-medium mb-1">Speech to text</legend>
            {DICTATION_ENGINES.map((engine) => (
              <label key={engine} className="flex items-start gap-2 text-sm">
                <input type="radio" name="assistants-dictation-engine" checked={value.engine === engine} onChange={() => onChange({ engine: engine as DictationEngine })} className="mt-1" style={{ accentColor: 'var(--theme-primary)' }} data-testid={`assistants-dictation-engine-${engine}`} />
                <span>
                  <span className="font-medium">{DICTATION_ENGINE_LABELS[engine]}</span>
                  <span className="block text-xs" style={muted}>{ENGINE_HINTS[engine]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {usesProvider && (
            <div className="space-y-1">
              <label htmlFor="assistants-dictation-provider" className="block text-sm font-medium">Transcription provider</label>
              <Select id="assistants-dictation-provider" data-testid="assistants-dictation-provider" value={value.integration_id ?? ''} disabled={disabled}
                onChange={(e) => onChange({ integration_id: e.target.value || null })} className="max-w-80">
                <option value="">{agentTranscribes ? 'The Agent\'s own OpenAI connection (Whisper)' : 'Choose a media connection…'}</option>
                {integrations.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.type})</option>)}
              </Select>
              <p className="text-xs" style={muted}>A media connection from Integrations that can transcribe (OpenAI, Google Gemini, Azure AI Speech, AWS, Deepgram, AssemblyAI, ElevenLabs). Recordings are at most 2 minutes; they are not stored.</p>
              {providerMissing && <p className="text-xs" role="alert" style={{ color: 'var(--color-warning, #d97706)' }} data-testid="assistants-dictation-no-provider">No transcription provider yet: add a media connection in Integrations{value.engine === 'auto' ? ' — until then only browsers with speech recognition can dictate' : ' — until then the microphone is unavailable'}.</p>}
            </div>
          )}
          <div className="space-y-1">
            <label htmlFor="assistants-dictation-language" className="block text-sm font-medium">Language</label>
            <Select id="assistants-dictation-language" data-testid="assistants-dictation-language" value={value.language} disabled={disabled} onChange={(e) => onChange({ language: e.target.value })} className="max-w-80">
              {!knownLanguage && <option value={value.language}>{value.language}</option>}
              {DICTATION_LANGUAGES.map(([code, label]) => <option key={code || 'auto'} value={code}>{label}</option>)}
            </Select>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Send automatically after dictation</p>
              <p className="text-xs" style={muted}>Off: the words stay in the message box to check and edit. On: the message is sent as soon as the person stops talking.</p>
            </div>
            <Switch checked={value.auto_send} onCheckedChange={(auto_send) => onChange({ auto_send })} disabled={disabled} aria-label="Send automatically after dictation" data-testid="assistants-dictation-auto-send" />
          </div>
        </div>
      )}
    </Card>
  )
}

const ENGINE_HINTS: Record<DictationEngine, string> = {
  browser: 'Free; done by the browser (Chrome, Edge, Safari). Chrome and Edge send the audio to their speech service. Not available in Firefox.',
  provider: 'Every browser records and this server transcribes with the provider below (costs per minute; the audio stays between this server and the provider).',
  auto: 'Browser speech recognition where the browser has it; elsewhere (Firefox, some in-app browsers) the provider below.',
}
