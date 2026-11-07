'use client'

/**
 * Agent designer panels: approvals, limits, outbound hosts, knowledge, MCP
 * tools (Tools / Settings tabs), test cases + evaluation runs (Tests tab),
 * saved versions (History tab).
 */
import { useRef, useState } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatCount } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import { formatDurationMs } from '@/lib/format/duration'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { serverQuery } from '@/lib/server-read'
import { formatCost } from '@/lib/agents/pricing'
import { deleteAgentEvalCase, restoreAgentVersion, runAgentEvals, saveAgentEvalCase, uploadAgentKnowledgeFile } from '@/app/actions/agents'
import { READ_ONLY_BUILTIN_TOOLS, type AgentTool } from '@/lib/agent-tool-defs'
import { CheckCircle2, XCircle, Play, Plus, Trash2, Upload, History, RotateCcw, Loader2, ShieldCheck, Gauge, Globe, BookOpen, Server, X } from 'lucide-react'

type OutputConfig = Record<string, any>

/** Section title with a leading icon (CardHeader title). */
function PanelTitle({ icon, title }: { icon: React.ReactNode; title: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="inline-flex text-fg-muted [&>svg]:size-4" aria-hidden="true">{icon}</span>
      {title}
    </span>
  )
}

/** Toggle chip (aria-pressed) for tool / table pickers. */
function ChipToggle({ on, onClick, mono, children }: { on: boolean; onClick: () => void; mono?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors',
        mono && 'font-mono',
        on ? 'border-primary bg-primary-wash text-primary-text' : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
      )}>
      {on ? '✓ ' : ''}{children}
    </button>
  )
}

function listText(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : ''
}
function parseList(text: string): string[] {
  return Array.from(new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)))
}

/* ── Approvals ── */

export function ApprovalPanel({ tools, outputConfig, onChange, onToolsChange, members, teams }: {
  tools: AgentTool[]
  outputConfig: OutputConfig
  onChange: (next: OutputConfig) => void
  onToolsChange: (next: AgentTool[]) => void
  members: { id: string; name: string }[]
  teams: { id: string; name: string }[]
}) {
  const approval = outputConfig.approval ?? { tools: [], assignee_user_id: null, assignee_team_id: null }
  const all = Array.isArray(approval.tools) && approval.tools.includes('*')
  const set = (patch: Record<string, unknown>) => onChange({ ...outputConfig, approval: { ...approval, ...patch } })
  const sideEffecting = tools.filter((t) => !(t.type === 'builtin' && READ_ONLY_BUILTIN_TOOLS.has(t.name)))
  const reviewer = approval.assignee_user_id ? `user:${approval.assignee_user_id}` : approval.assignee_team_id ? `team:${approval.assignee_team_id}` : ''
  return (
    <Card padding="none" data-testid="agent-approval-panel">
      <CardHeader title={<PanelTitle icon={<ShieldCheck />} title="Approvals" />} description="Tool calls that need a person's approval before they run. The run pauses and the reviewer gets a task (Approve / Reject); a Run Agent step waits for it." />
      <CardBody className="space-y-3 pt-0">
        <Checkbox checked={all} onChange={(e) => set({ tools: e.target.checked ? ['*'] : [] })}
          label="Every tool that changes data or calls out (all except read-only built-ins)" />
        {!all && (
          <div className="flex flex-wrap gap-1.5">
            {sideEffecting.length === 0 && <span className="text-xs text-fg-muted">Add tools first — read-only tools never need approval.</span>}
            {sideEffecting.map((t) => {
              const on = Boolean(t.requiresApproval) || (approval.tools ?? []).includes(t.name)
              return (
                <ChipToggle key={t.id} on={on} mono
                  onClick={() => {
                    onToolsChange(tools.map((x) => (x.id === t.id ? { ...x, requiresApproval: !on } : x)))
                    set({ tools: (approval.tools ?? []).filter((n: string) => n !== t.name) })
                  }}>
                  {t.name}
                </ChipToggle>
              )
            })}
          </div>
        )}
        <Field label="Reviewer">
          <Select aria-label="Approval reviewer" value={reviewer} onChange={(e) => {
            const [kind, id] = e.target.value.split(':')
            set({ assignee_user_id: kind === 'user' ? id : null, assignee_team_id: kind === 'team' ? id : null })
          }}>
            <option value="">The agent&apos;s creator</option>
            {members.map((m) => <option key={m.id} value={`user:${m.id}`}>{m.name}</option>)}
            {teams.map((t) => <option key={t.id} value={`team:${t.id}`}>Team: {t.name}</option>)}
          </Select>
        </Field>
      </CardBody>
    </Card>
  )
}

/* ── Limits + outbound hosts ── */

type UsageView = {
  tokensLast24h: number
  tokens_this_month?: number
  cost_last_24h?: Record<string, number>
  cost_this_month?: Record<string, number>
  unpriced_runs?: number
  days: Array<{ day: string; runs: number; failed: number; tokens: number; cost?: Record<string, number>; unpriced_runs?: number }>
}

/** Budget meter: used of budget (empty when no budget). */
function Meter({ label, used, budget, format }: { label: string; used: number; budget: number; format: (n: number) => string }) {
  return (
    <div className="num text-xs text-fg-muted">
      <div>{label}: <strong className="font-semibold text-fg">{format(used)}</strong>{budget ? ` of ${format(budget)}` : ''}</div>
      {budget > 0 && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full', used >= budget ? 'bg-danger' : 'bg-primary')} style={{ width: `${Math.min(100, (used / budget) * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

export function LimitsPanel({ outputConfig, onChange, usage }: { outputConfig: OutputConfig; onChange: (next: OutputConfig) => void; usage?: UsageView | null }) {
  const limits = outputConfig.limits ?? {}
  const egress = outputConfig.egress ?? { allowed_hosts: [] }
  const setLimit = (key: string, value: string) => onChange({ ...outputConfig, limits: { ...limits, [key]: Math.max(0, Math.floor(Number(value) || 0)) } })
  const setMoney = (key: string, value: string) => onChange({ ...outputConfig, limits: { ...limits, [key]: Math.max(0, Math.round((Number(value) || 0) * 100) / 100) } })
  const [hosts, setHosts] = useState(listText(egress.allowed_hosts))
  const currency = String(limits.budget_currency || 'USD')
  const money = (n: number) => formatCost(n, currency)
  const tokens = (n: number) => plural(n, 'token')
  const [metric, setMetric] = useState<'tokens' | 'cost'>('tokens')
  const dayValue = (d: UsageView['days'][number]) => (metric === 'tokens' ? d.tokens : d.cost?.[currency] ?? 0)
  const maxDay = Math.max(metric === 'tokens' ? 1 : 0.0001, ...(usage?.days ?? []).map(dayValue))
  return (
    <div className="space-y-4">
      <Card padding="none" data-testid="agent-limits-panel">
        <CardHeader title={<PanelTitle icon={<Gauge />} title="Budgets & limits" />} description="0 = no limit (the platform caps still apply: 50 iterations, 15 minutes). Day = the last 24 hours, month = this calendar month (UTC). A run is refused once a budget is spent; workspace budgets (Agents → Costs & budgets) apply too." />
        <CardBody className="pt-0">
          <div className="grid grid-cols-3 gap-3">
            {([
              ['max_run_tokens', 'Tokens per run'],
              ['max_tool_calls', 'Tool calls per run'],
              ['daily_token_budget', 'Tokens per day'],
              ['monthly_token_budget', 'Tokens per month'],
            ] as const).map(([key, label]) => (
              <Field key={key} label={label}>
                <Input aria-label={label} type="number" min={0} value={limits[key] ?? 0} onChange={(e) => setLimit(key, e.target.value)} className="num" />
              </Field>
            ))}
            {([
              ['daily_cost_budget', 'Cost per day'],
              ['monthly_cost_budget', 'Cost per month'],
            ] as const).map(([key, label]) => (
              <Field key={key} label={`${label} (${currency})`}>
                <Input aria-label={label} type="number" min={0} step="0.01" value={limits[key] ?? 0} onChange={(e) => setMoney(key, e.target.value)} className="num" />
              </Field>
            ))}
            <Field label="Budget currency">
              <Input aria-label="Budget currency" maxLength={3} value={currency} onChange={(e) => onChange({ ...outputConfig, limits: { ...limits, budget_currency: e.target.value.toUpperCase().slice(0, 3) } })} className="font-mono uppercase" />
            </Field>
          </div>
          <p className="mt-2 text-xs text-fg-muted">Cost budgets count runs priced in {currency}; runs whose model has no price are not counted (they show as cost unknown).</p>
          {usage && (
            <div className="mt-4 space-y-3 border-t border-border-subtle pt-4" data-testid="agent-usage">
              <div className="grid grid-cols-2 gap-3">
                <Meter label="Last 24 hours" used={usage.tokensLast24h} budget={Number(limits.daily_token_budget) || 0} format={tokens} />
                <Meter label="This month" used={usage.tokens_this_month ?? 0} budget={Number(limits.monthly_token_budget) || 0} format={tokens} />
                <Meter label="Spent, last 24 hours" used={usage.cost_last_24h?.[currency] ?? 0} budget={Number(limits.daily_cost_budget) || 0} format={money} />
                <Meter label="Spent this month" used={usage.cost_this_month?.[currency] ?? 0} budget={Number(limits.monthly_cost_budget) || 0} format={money} />
              </div>
              {(usage.unpriced_runs ?? 0) > 0 && <p className="num text-xs text-fg-muted">{plural(usage.unpriced_runs ?? 0, 'run')} in this period with cost unknown (no price for the model, or before cost tracking).</p>}
              {usage.days.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-xs text-fg-muted">
                    <span>Per day, last 30 days</span>
                    <SegmentedControl aria-label="Metric" size="sm" value={metric} onValueChange={setMetric}
                      options={[{ value: 'tokens', text: 'Tokens' }, { value: 'cost', text: `Cost (${currency})` }]} />
                  </div>
                  <div className="mt-2 flex h-10 items-end gap-0.5" role="img" aria-label={metric === 'tokens' ? 'Tokens per day, last 30 days' : 'Cost per day, last 30 days'}>
                    {usage.days.map((d) => (
                      <div key={d.day} title={`${d.day}: ${plural(d.tokens, 'token')}, ${money(d.cost?.[currency] ?? 0)}, ${plural(d.runs, 'run')}${d.failed ? `, ${formatCount(d.failed)} failed` : ''}${d.unpriced_runs ? `, ${formatCount(d.unpriced_runs)} cost unknown` : ''}`}
                        className={cn('max-w-4 flex-1 rounded-sm opacity-80', d.failed ? 'bg-warning' : 'bg-primary')} style={{ height: `${Math.max(4, (dayValue(d) / maxDay) * 100)}%` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
      <Card padding="none">
        <CardHeader title={<PanelTitle icon={<Globe />} title="Outbound hosts" />} description="Hosts the URL tools (http_get, http_post, download / read file) may reach. Empty = any public host. Private and cloud-metadata addresses are always blocked. Use *.example.com for subdomains." />
        <CardBody className="pt-0">
          <Input aria-label="Allowed hosts" value={hosts} onChange={(e) => setHosts(e.target.value)}
            onBlur={() => onChange({ ...outputConfig, egress: { allowed_hosts: parseList(hosts).map((h) => h.toLowerCase()) } })}
            placeholder="api.example.com, *.example.org" className="font-mono" />
        </CardBody>
      </Card>
    </div>
  )
}

/* ── Knowledge ── */

export function KnowledgePanel({ outputConfig, onChange, dataTables }: { outputConfig: OutputConfig; onChange: (next: OutputConfig) => void; dataTables: { id: string; name: string }[] }) {
  const knowledge = outputConfig.knowledge ?? { table_ids: [], files: [] }
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Record<string, unknown>) => onChange({ ...outputConfig, knowledge: { ...knowledge, ...patch } })
  async function upload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true); setError(null)
    const added: any[] = []
    for (const file of Array.from(files)) {
      const form = new FormData()
      form.append('file', file)
      const result = await uploadAgentKnowledgeFile(form)
      if (result.ok) added.push(result.data)
      else setError(result.error)
    }
    if (added.length) set({ files: [...(knowledge.files ?? []), ...added] })
    setUploading(false)
  }
  return (
    <Card padding="none" data-testid="agent-knowledge-panel">
      <CardHeader title={<PanelTitle icon={<BookOpen />} title="Knowledge" />} description="Documents and data tables the agent searches with search_knowledge (keyword passages; documents are read as text). Read-only — this does not grant data-table write access." />
      <CardBody className="space-y-3 pt-0">
        {(knowledge.files ?? []).length > 0 && (
          <div className="divide-y divide-border-subtle rounded-md border border-border">
            {(knowledge.files ?? []).map((f: any, i: number) => (
              <div key={`${f.url}-${i}`} className="flex items-center gap-2 py-1 pl-3 pr-1 text-ui">
                <span className="flex-1 truncate">{f.name}</span>
                {f.size ? <span className="num text-xs text-fg-muted">{formatCount(Math.max(1, Math.round(f.size / 1024)))} KB</span> : null}
                <IconButton size="sm" variant="danger-ghost" label={`Remove ${f.name}`} icon={<X />} onClick={() => set({ files: knowledge.files.filter((_: any, j: number) => j !== i) })} />
              </div>
            ))}
          </div>
        )}
        <input ref={fileRef} type="file" multiple className="hidden" accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.json,.html,.xml" onChange={(e) => { void upload(e.target.files); e.target.value = '' }} />
        <div>
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} loading={uploading} leadingIcon={<Upload />}>
            Add documents
          </Button>
        </div>
        {error && <InlineNotice tone="danger" message={error} />}
        <div>
          <p className="mb-1.5 text-xs font-medium text-fg">Data tables to search</p>
          <div className="flex flex-wrap gap-1.5">
            {dataTables.map((t) => {
              const on = (knowledge.table_ids ?? []).includes(t.id)
              return (
                <ChipToggle key={t.id} on={on} onClick={() => set({ table_ids: on ? knowledge.table_ids.filter((x: string) => x !== t.id) : [...(knowledge.table_ids ?? []), t.id] })}>
                  {t.name}
                </ChipToggle>
              )
            })}
            {dataTables.length === 0 && <span className="text-xs text-fg-muted">No data tables yet.</span>}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

/* ── MCP tools ── */

export function McpToolAdder({ servers, onAdd }: { servers: { id: string; name: string; tools_cache?: any }[]; onAdd: (tool: AgentTool) => void }) {
  const [serverId, setServerId] = useState('')
  const [toolName, setToolName] = useState('')
  const [description, setDescription] = useState('')
  const server = servers.find((x) => x.id === serverId)
  const cachedTools: any[] = Array.isArray(server?.tools_cache) ? server!.tools_cache : Array.isArray(server?.tools_cache?.tools) ? server!.tools_cache.tools : []
  if (servers.length === 0) return <p className="text-xs text-fg-muted">No MCP servers — add one in Settings → MCP.</p>
  return (
    <div className="grid grid-cols-[1fr_1fr_2fr_auto] items-end gap-2">
      <Select aria-label="MCP server" value={serverId} onChange={(e) => setServerId(e.target.value)}>
        <option value="">Server…</option>
        {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      <Input aria-label="MCP tool name" list="agent-mcp-tools" value={toolName} onChange={(e) => {
        setToolName(e.target.value)
        const cached = cachedTools.find((t: any) => t?.name === e.target.value)
        if (cached?.description && !description) setDescription(String(cached.description).slice(0, 300))
      }} placeholder="tool name" className="font-mono" />
      <datalist id="agent-mcp-tools">{cachedTools.map((t: any) => <option key={t.name} value={t.name} />)}</datalist>
      <Input aria-label="MCP tool description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it does (shown to the model)" />
      <Button variant="secondary" leadingIcon={<Server />} disabled={!serverId || !toolName.trim()} onClick={() => {
        const name = toolName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64)
        const cached = cachedTools.find((t: any) => t?.name === toolName.trim())
        const props = cached?.inputSchema?.properties && typeof cached.inputSchema.properties === 'object' ? cached.inputSchema.properties : {}
        const required: string[] = Array.isArray(cached?.inputSchema?.required) ? cached.inputSchema.required : []
        const inputSchema = Object.entries(props).slice(0, 50).map(([pname, p]: [string, any]) => ({ name: pname, type: String(p?.type ?? 'string'), description: String(p?.description ?? pname), ...(required.includes(pname) ? { required: true } : {}) }))
        onAdd({ id: crypto.randomUUID(), type: 'mcp', name, description: description || `MCP tool ${toolName.trim()}`, mcpServerId: serverId, mcpToolName: toolName.trim(), inputSchema })
        setToolName(''); setDescription('')
      }}>Add</Button>
    </div>
  )
}

/* ── Tests (evaluations) ── */

interface CaseDraft { id?: string; name: string; input_message: string; contains: string; not_contains: string; tools_called: string; outputs: string; rubric: string }
const EMPTY_CASE: CaseDraft = { name: '', input_message: '', contains: '', not_contains: '', tools_called: '', outputs: '', rubric: '' }

function draftOf(c: any): CaseDraft {
  const e = c.expected ?? {}
  return { id: c.id, name: c.name, input_message: c.input_message, contains: listText(e.contains), not_contains: listText(e.not_contains), tools_called: listText(e.tools_called), outputs: e.outputs ? JSON.stringify(e.outputs) : '', rubric: e.rubric ?? '' }
}

export function TestsPanel({ agentId, dirty }: { agentId: string; dirty: boolean }) {
  const qc = useQueryClient()
  const { data, refetch } = useQuery({
    queryKey: ['agent-evals', agentId],
    queryFn: () => serverQuery('agents.evals', { agentId }),
    refetchInterval: (q) => ((q.state.data as any)?.runs?.[0]?.status === 'running' ? 1500 : false),
  })
  const [draft, setDraft] = useState<CaseDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Synchronous guard: a double click must not add the case / run the suite twice.
  const evalGuard = useSubmitGuard()
  const cases = (data?.cases ?? []) as any[]
  const runs = (data?.runs ?? []) as any[]
  const latest = runs[0]

  async function save() {
    await evalGuard.run(async () => {
      if (!draft) return
      let outputs: unknown
      if (draft.outputs.trim()) {
        try { outputs = JSON.parse(draft.outputs) } catch { setError('Expected outputs must be a JSON object, e.g. {"category":"billing"}'); return }
      }
      setBusy(true); setError(null)
      const result = await saveAgentEvalCase(agentId, {
        id: draft.id ?? null, name: draft.name, input_message: draft.input_message,
        expected: { contains: parseList(draft.contains), not_contains: parseList(draft.not_contains), tools_called: parseList(draft.tools_called), ...(outputs ? { outputs } : {}), ...(draft.rubric.trim() ? { rubric: draft.rubric.trim() } : {}) },
      })
      setBusy(false)
      if (!result.ok) { setError(result.error); return }
      setDraft(null)
      void refetch()
    })
  }

  async function runSuite() {
    await evalGuard.run(async () => {
      setBusy(true); setError(null)
      const result = await runAgentEvals(agentId)
      setBusy(false)
      if (!result.ok) { setError(result.error); return }
      await qc.invalidateQueries({ queryKey: ['agent-evals', agentId] })
    })
  }

  return (
    <div className="space-y-4" data-testid="agent-tests-panel">
      <Card padding="none">
        <CardHeader
          title={<PanelTitle icon={<CheckCircle2 />} title="Test cases" />}
          description="Inputs with expected results. Running the suite uses the saved agent; tools that change data or call out are simulated, so a run never changes anything."
          actions={(
            <>
              <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={() => setDraft({ ...EMPTY_CASE })}>Add case</Button>
              <Button size="sm" onClick={runSuite} disabled={busy || cases.length === 0 || latest?.status === 'running'}
                leadingIcon={latest?.status === 'running' ? <Loader2 className="animate-spin" /> : <Play />}>
                Run suite
              </Button>
            </>
          )}
        />
        <CardBody className="space-y-3 pt-0">
          {dirty && <InlineNotice tone="warning" message="You have unsaved changes — the suite runs the saved agent." />}
          {error && <InlineNotice tone="danger" message={error} />}
          {draft && (
            <div className="space-y-2 rounded-md bg-subtle p-3">
              <Input aria-label="Case name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Case name" />
              <Textarea aria-label="Case input" value={draft.input_message} onChange={(e) => setDraft({ ...draft, input_message: e.target.value })} placeholder="Input message" rows={3} />
              <div className="grid grid-cols-2 gap-2">
                <Input aria-label="Response contains" value={draft.contains} onChange={(e) => setDraft({ ...draft, contains: e.target.value })} placeholder="Response contains (comma-separated)" />
                <Input aria-label="Response does not contain" value={draft.not_contains} onChange={(e) => setDraft({ ...draft, not_contains: e.target.value })} placeholder="Does not contain" />
                <Input aria-label="Tools called" value={draft.tools_called} onChange={(e) => setDraft({ ...draft, tools_called: e.target.value })} placeholder="Tools it must call" className="font-mono" />
                <Input aria-label="Expected outputs" value={draft.outputs} onChange={(e) => setDraft({ ...draft, outputs: e.target.value })} placeholder='Outputs JSON, e.g. {"category":"billing"}' className="font-mono" />
              </div>
              <Input aria-label="Rubric" value={draft.rubric} onChange={(e) => setDraft({ ...draft, rubric: e.target.value })} placeholder="Rubric graded by the model (optional), e.g. Polite and mentions the refund policy" />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
                <Button size="sm" onClick={save} disabled={busy || !draft.name.trim() || !draft.input_message.trim()}>Save case</Button>
              </div>
            </div>
          )}
          {cases.length === 0 && !draft && <p className="text-ui text-fg-muted">No test cases yet.</p>}
          {cases.length > 0 && (
            <div className="divide-y divide-border-subtle rounded-md border border-border">
              {cases.map((c) => {
                const last = latest?.results?.find((r: any) => r.case_id === c.id)
                return (
                  <div key={c.id} className="flex items-center gap-2 py-1 pl-3 pr-1 text-ui hover:bg-subtle">
                    {last ? (last.passed ? <CheckCircle2 size={14} className="shrink-0 text-success" aria-label="passed" /> : <XCircle size={14} className="shrink-0 text-danger" aria-label="failed" />) : <span className="w-3.5 shrink-0" />}
                    <button type="button" className="flex-1 truncate text-left hover:underline" onClick={() => setDraft(draftOf(c))}>{c.name}</button>
                    <span className="max-w-[40%] truncate text-xs text-fg-muted">{c.input_message}</span>
                    <IconButton size="sm" variant="danger-ghost" label={`Delete ${c.name}`} icon={<Trash2 />} onClick={async () => { const r = await deleteAgentEvalCase(agentId, c.id); if (!r.ok) setError(r.error); void refetch() }} />
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {latest && (
        <Card padding="none" data-testid="agent-eval-results">
          <CardHeader
            title={<PanelTitle icon={<Play />} title={`Last run — ${latest.status === 'running' ? 'running…' : `${latest.passed}/${latest.total} passed`}`} />}
            description={<span className="num">{`Version ${latest.agent_version ?? '?'} · ${formatAbsolute(latest.started_at)}${latest.usage?.total_tokens ? ` · ${plural(latest.usage.total_tokens, 'token')}` : ''}${latest.error ? ` · ${latest.error}` : ''}`}</span>}
          />
          <CardBody className="pt-0">
            <div className="divide-y divide-border-subtle rounded-md border border-border">
              {(latest.results ?? []).map((r: any) => (
                <div key={r.case_id} className={cn('p-3', !r.passed && 'bg-danger-wash')}>
                  <div className="flex items-center gap-2 text-ui font-medium">
                    {r.passed ? <CheckCircle2 size={14} className="shrink-0 text-success" /> : <XCircle size={14} className="shrink-0 text-danger" />}
                    <span className="flex-1">{r.name}</span>
                    <span className="num text-xs font-normal text-fg-muted">{plural(Number(r.tokens) || 0, 'token')} · {formatDurationMs(r.duration_ms)}</span>
                    {r.agent_run_id && <Link href={`/agents/${agentId}/runs/${r.agent_run_id}`} className="text-xs font-normal text-primary-text hover:underline">trace</Link>}
                  </div>
                  <ul className="mt-1 space-y-0.5">
                    {(r.checks ?? []).map((ch: any, i: number) => (
                      <li key={i} className={cn('flex gap-1 text-xs', ch.passed ? 'text-fg-muted' : 'text-danger')}>
                        <span>{ch.passed ? '✓' : '✗'}</span><span>{ch.check}{ch.detail ? ` — ${ch.detail}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

/* ── History (versions) ── */

export function HistoryPanel({ agentId, currentVersion, onRestored }: { agentId: string; currentVersion: number; onRestored: () => void }) {
  const { data, refetch } = useQuery({ queryKey: ['agent-versions', agentId, currentVersion], queryFn: () => serverQuery('agents.versions', { agentId }) })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const versions = (data ?? []) as any[]
  return (
    <Card padding="none" data-testid="agent-history-panel">
      <CardHeader title={<PanelTitle icon={<History />} title="Versions" />} description="Every save is a version. Restoring saves that version's settings as the newest version, so a restore can be undone." />
      <CardBody className="space-y-3 pt-0">
        {error && <InlineNotice tone="danger" message={error} />}
        {versions.length === 0 && <p className="text-ui text-fg-muted">No saved versions yet — they start with the next save.</p>}
        {versions.length > 0 && (
          <div className="divide-y divide-border-subtle rounded-md border border-border">
            {versions.map((v) => (
              <div key={v.id} className="flex min-h-10 items-center gap-2 py-1 pl-3 pr-1 text-ui">
                <span className="w-10 font-mono text-xs">v{v.version}</span>
                <span className="flex-1 truncate text-fg-muted">{v.note ?? (v.snapshot?.model ? `${v.snapshot.model} · ${plural((v.snapshot.tools ?? []).length, 'tool')}` : '')}</span>
                <Tooltip content={formatAbsolute(v.created_at)}>
                  <span className="num text-xs text-fg-muted">{formatRelative(v.created_at)}</span>
                </Tooltip>
                {v.version === currentVersion ? (
                  <span className="px-2 text-xs font-medium text-success">Current</span>
                ) : (
                  <Button size="sm" variant="ghost" disabled={busy !== null} loading={busy === v.version} leadingIcon={<RotateCcw />} onClick={async () => {
                    setBusy(v.version); setError(null)
                    const result = await restoreAgentVersion(agentId, v.version)
                    setBusy(null)
                    if (!result.ok) { setError(result.error); return }
                    void refetch(); onRestored()
                  }}>Restore</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
