'use client'

/**
 * Agents → Costs & budgets: the workspace's agent spend (tokens and cost per
 * day and per agent), workspace budgets, and the model price table in
 * effect — shipped list prices, the instance's prices, this workspace's
 * overrides (editable with settings.edit). PriceTableEditor is shared with
 * Settings → Infrastructure (instance prices).
 */
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { StatCard, StatGrid } from '@/components/ui/stat-card'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'
import { formatCount } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import { formatCost, type ModelPrice } from '@/lib/agents/pricing'

const PROVIDERS = ['*', 'openai', 'anthropic', 'azure_openai', 'gemini', 'bedrock', 'mistral', 'deepseek', 'groq', 'together', 'perplexity', 'ollama', 'other']
const PROVIDER_OPTIONS = PROVIDERS.map((p) => ({ value: p, label: p === '*' ? 'any' : p }))

export function PriceTableEditor({ value, onChange, disabled }: { value: ModelPrice[]; onChange: (next: ModelPrice[]) => void; disabled?: boolean }) {
  const set = (i: number, patch: Partial<ModelPrice>) => onChange(value.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  const num = (v: string) => (v === '' ? null : Number(v))
  return (
    <div className="space-y-2" data-testid="price-table-editor">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-fg-muted">
              <th className="py-1 pr-2 text-left font-medium">Provider</th>
              <th className="py-1 pr-2 text-left font-medium">Model</th>
              <th className="py-1 pr-2 text-left font-medium">Input / 1M</th>
              <th className="py-1 pr-2 text-left font-medium">Output / 1M</th>
              <th className="py-1 pr-2 text-left font-medium">Cached input / 1M</th>
              <th className="py-1 pr-2 text-left font-medium">Currency</th>
              <th className="py-1 pr-2 text-left font-medium">From</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {value.map((row, i) => (
              <tr key={i}>
                <td className="py-0.5 pr-2">
                  <Select size="sm" aria-label="Provider" disabled={disabled} value={row.provider} onChange={(e) => set(i, { provider: e.target.value })}
                    options={PROVIDER_OPTIONS} className="text-xs" wrapperClassName="min-w-[7rem]" />
                </td>
                <td className="py-0.5 pr-2"><Input size="sm" aria-label="Model" disabled={disabled} value={row.model} onChange={(e) => set(i, { model: e.target.value })} className="min-w-[9rem] font-mono text-xs" /></td>
                <td className="py-0.5 pr-2"><Input size="sm" aria-label="Input price per 1M tokens" disabled={disabled} type="number" min={0} step="0.001" value={row.input_per_1m ?? ''} onChange={(e) => set(i, { input_per_1m: Number(e.target.value) })} className="num w-20 text-xs" /></td>
                <td className="py-0.5 pr-2"><Input size="sm" aria-label="Output price per 1M tokens" disabled={disabled} type="number" min={0} step="0.001" value={row.output_per_1m ?? ''} onChange={(e) => set(i, { output_per_1m: Number(e.target.value) })} className="num w-20 text-xs" /></td>
                <td className="py-0.5 pr-2"><Input size="sm" aria-label="Cached input price per 1M tokens" disabled={disabled} type="number" min={0} step="0.001" value={row.cached_input_per_1m ?? ''} placeholder="= input" onChange={(e) => set(i, { cached_input_per_1m: num(e.target.value) })} className="num w-20 text-xs" /></td>
                <td className="py-0.5 pr-2"><Input size="sm" aria-label="Currency" disabled={disabled} maxLength={3} value={row.currency} onChange={(e) => set(i, { currency: e.target.value.toUpperCase() })} className="w-14 font-mono text-xs" /></td>
                <td className="py-0.5 pr-2"><Input size="sm" aria-label="Effective date" disabled={disabled} type="date" value={row.effective_date} onChange={(e) => set(i, { effective_date: e.target.value })} className="text-xs" /></td>
                <td>{!disabled && <IconButton size="sm" variant="danger-ghost" label={`Remove ${row.model || 'price'}`} icon={<Trash2 />} onClick={() => onChange(value.filter((_, j) => j !== i))} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <Button type="button" size="sm" variant="secondary" leadingIcon={<Plus />}
          onClick={() => onChange([...value, { provider: 'openai', model: '', input_per_1m: 0, output_per_1m: 0, cached_input_per_1m: null, currency: 'USD', effective_date: new Date().toISOString().slice(0, 10) }])}>
          Add price
        </Button>
      )}
    </div>
  )
}

function PriceList({ title, rows, note }: { title: string; rows: readonly ModelPrice[]; note?: string }) {
  if (!rows.length) return null
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-fg">{title}</p>
      {note && <p className="mb-1 text-xs text-fg-muted">{note}</p>}
      <table className="w-full text-xs">
        <tbody>
          {rows.map((p) => (
            <tr key={`${p.provider}:${p.model}:${p.effective_date}`} className="border-t border-border-subtle">
              <td className="py-1 pr-2 text-fg-muted">{p.provider === '*' ? 'any' : p.provider}</td>
              <td className="py-1 pr-2 font-mono">{p.model}</td>
              <td className="num py-1 pr-2">{formatCost(p.input_per_1m, p.currency)} in</td>
              <td className="num py-1 pr-2">{formatCost(p.output_per_1m, p.currency)} out</td>
              <td className="num py-1 pr-2 text-fg-muted">{p.cached_input_per_1m != null ? `${formatCost(p.cached_input_per_1m, p.currency)} cached` : ''}</td>
              <td className="py-1 pr-2 text-fg-muted">from {p.effective_date}{p.note ? ` · ${p.note}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export interface WorkspaceCostData {
  days: Array<{ day: string; runs: number; tokens: number; cost: Record<string, number>; unpriced_runs: number }>
  tokens_last_24h: number
  cost_last_24h: Record<string, number>
  tokens_this_month: number
  cost_this_month: Record<string, number>
  unpriced_runs: number
  agents: Array<{ agent_id: string; name: string; model: string | null; runs: number; tokens_this_month: number; cost_this_month: Record<string, number>; unpriced_runs: number }>
  budgets: { daily_token_budget: number; monthly_token_budget: number; daily_cost_budget: number; monthly_cost_budget: number; budget_currency: string }
  prices: { workspace: ModelPrice[]; instance: ModelPrice[]; defaults: ModelPrice[]; defaults_as_of: string }
  can_edit: boolean
}

const costText = (byCurrency: Record<string, number>) => {
  const entries = Object.entries(byCurrency ?? {})
  return entries.length ? entries.map(([cur, n]) => formatCost(n, cur)).join(' + ') : formatCost(0, 'USD')
}

export function WorkspaceCosts({ data, onSave }: { data: WorkspaceCostData; onSave: (input: { model_prices: ModelPrice[]; budgets: WorkspaceCostData['budgets'] }) => Promise<string | null> }) {
  const [prices, setPrices] = useState<ModelPrice[]>(data.prices.workspace)
  const [budgets, setBudgets] = useState(data.budgets)
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const cur = budgets.budget_currency || 'USD'
  const maxDay = Math.max(0.0001, ...data.days.map((d) => d.cost?.[cur] ?? 0))
  const setBudget = (key: keyof WorkspaceCostData['budgets'], v: string) => setBudgets((b) => ({ ...b, [key]: key === 'budget_currency' ? v.toUpperCase().slice(0, 3) : Math.max(0, Number(v) || 0) }))

  return (
    <div className="space-y-4" data-testid="agent-costs">
      <StatGrid>
        <StatCard label="Spent, last 24 hours" value={costText(data.cost_last_24h)}>
          <p className="num text-xs text-fg-muted">{plural(data.tokens_last_24h, 'token')}</p>
        </StatCard>
        <StatCard label="Spent this month" value={costText(data.cost_this_month)}>
          <p className="num text-xs text-fg-muted">{plural(data.tokens_this_month, 'token')}</p>
        </StatCard>
        <StatCard label="Monthly budget" value={budgets.monthly_cost_budget ? formatCost(budgets.monthly_cost_budget, cur) : 'None'}>
          {budgets.monthly_token_budget ? <p className="num text-xs text-fg-muted">{plural(budgets.monthly_token_budget, 'token')}</p> : null}
        </StatCard>
        <StatCard label="Cost unknown" value={plural(data.unpriced_runs, 'run')} tone={data.unpriced_runs ? 'warning' : undefined}>
          <p className="text-xs text-fg-muted">No price for the model</p>
        </StatCard>
      </StatGrid>

      <Card padding="none">
        <CardHeader title={`Cost per day (${cur}), last 30 days`} />
        <CardBody className="pt-0">
          <div className="flex h-20 items-end gap-0.5" role="img" aria-label="Workspace agent cost per day">
            {data.days.map((d) => (
              <div key={d.day} title={`${d.day}: ${costText(d.cost)}, ${plural(d.tokens, 'token')}, ${plural(d.runs, 'run')}${d.unpriced_runs ? `, ${formatCount(d.unpriced_runs)} cost unknown` : ''}`}
                className="max-w-4 flex-1 rounded-sm bg-primary opacity-80" style={{ height: `${Math.max(3, ((d.cost?.[cur] ?? 0) / maxDay) * 100)}%` }} />
            ))}
            {data.days.length === 0 && <p className="text-xs text-fg-muted">No agent runs in the last 30 days.</p>}
          </div>
        </CardBody>
        {data.agents.length > 0 && (
          <div className="border-t border-border-subtle">
            <Table bare>
              <THead>
                <tr>
                  <TH>Agent</TH>
                  <TH>Model</TH>
                  <TH numeric>Runs</TH>
                  <TH numeric>Tokens this month</TH>
                  <TH numeric>Cost this month</TH>
                </tr>
              </THead>
              <TBody>
                {data.agents.map((a) => (
                  <TR key={a.agent_id}>
                    <TD className="font-medium">{a.name}</TD>
                    <TD className="font-mono text-xs text-fg-muted">{a.model || 'default'}</TD>
                    <TD numeric>{formatCount(a.runs)}</TD>
                    <TD numeric>{formatCount(a.tokens_this_month)}</TD>
                    <TD numeric>
                      {Object.keys(a.cost_this_month ?? {}).length === 0 && a.unpriced_runs
                        ? <span className="text-fg-muted">cost unknown</span>
                        : <>{costText(a.cost_this_month)}{a.unpriced_runs ? <span className="text-fg-muted"> (+{formatCount(a.unpriced_runs)} unknown)</span> : null}</>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      <Card padding="none" data-testid="workspace-budgets">
        <CardHeader
          title="Workspace budgets"
          description="All agents of this workspace together. 0 = none. Day = the last 24 hours, month = this calendar month (UTC). Agent runs are refused once a budget is spent; each agent can have its own budgets too (agent → Settings)."
        />
        <CardBody className="grid gap-3 pt-0 md:grid-cols-5">
          {([
            ['daily_token_budget', 'Tokens per day'], ['monthly_token_budget', 'Tokens per month'],
            ['daily_cost_budget', `Cost per day (${cur})`], ['monthly_cost_budget', `Cost per month (${cur})`], ['budget_currency', 'Currency'],
          ] as const).map(([key, label]) => (
            <Field key={key} label={label}>
              <Input aria-label={label} disabled={!data.can_edit} type={key === 'budget_currency' ? 'text' : 'number'} min={0} step={key.includes('cost') ? '0.01' : '1'}
                value={String(budgets[key] ?? '')} onChange={(e) => setBudget(key, e.target.value)} className={key === 'budget_currency' ? 'font-mono' : 'num'} />
            </Field>
          ))}
        </CardBody>
      </Card>

      <Card padding="none" data-testid="model-prices">
        <CardHeader
          title="Model prices"
          description={(
            <>
              Per 1M tokens. A run is priced with this workspace&apos;s price for its provider + model, else the instance&apos;s, else the shipped list price.
              The shipped prices are providers&apos; published list prices as of {data.prices.defaults_as_of}, editable — no discounts, batch or priority tiers,
              long-context or cache-write surcharges, per-request or search fees, or taxes. A model with no price shows &ldquo;cost unknown&rdquo;; it is never guessed. Past runs keep the price they were charged at.
            </>
          )}
        />
        <CardBody className="pt-0">
          <p className="mb-1 text-xs font-medium text-fg">This workspace&apos;s prices (override)</p>
          <PriceTableEditor value={prices} onChange={setPrices} disabled={!data.can_edit} />
          {data.can_edit && (
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" loading={saving} onClick={async () => {
                setSaving(true); setStatus(null)
                const error = await onSave({ model_prices: prices, budgets })
                setStatus(error ? { ok: false, message: error } : { ok: true, message: 'Saved' })
                setSaving(false)
              }}>{saving ? 'Saving…' : 'Save prices & budgets'}</Button>
              {status && <span role="status" className={status.ok ? 'text-xs text-success' : 'text-xs text-danger'}>{status.message}</span>}
            </div>
          )}
          {!data.can_edit && <p className="mt-2 text-xs text-fg-muted">Changing prices and budgets needs the settings.edit permission.</p>}
          <div className="mt-4 space-y-3">
            <PriceList title="Instance prices" rows={data.prices.instance} note="Set by the instance's administrators (Settings → Infrastructure)." />
            <PriceList title={`Shipped list prices (as of ${data.prices.defaults_as_of}, editable)`} rows={data.prices.defaults} />
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
