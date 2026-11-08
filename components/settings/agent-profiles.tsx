'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, CheckCircle2, Copy, KeyRound, Pencil, PlugZap, Plus, Trash2, X } from 'lucide-react'
import { serverRead } from '@/lib/server-read'
import { useIsMobile } from '@/hooks/use-mobile'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { DialogBody, DialogFooter } from '@/components/ui/dialog'
import { SearchableMultiOptionPicker } from '@/components/ui/searchable-multi-option-picker'
import { testModelRuleAction } from '@/app/actions/assistants'
import {
  MAX_PANEL_LABEL, MAX_PROFILE_INSTRUCTIONS, MAX_PROFILE_STARTERS, MAX_PROFILES, MAX_STARTER_LENGTH, PROFILE_AREA_LABELS, PROFILE_AREAS, PROFILE_COLORS,
  agentTitle, profileWho, type AgentProfile, type ProfileArea, type ProfileColor,
} from '@/lib/assistants/profiles'
import {
  AGENT_TOOL_GROUPS, ASSISTANT_PROVIDERS, PROVIDER_PRESETS,
  type AgentToolGroup, type AssistantLimits, type AssistantProvider, type ProfileInput,
} from '@/lib/assistants/types'
import { THINKING_LABELS, type ThinkingLevel } from '@/lib/agents/reasoning'
import { agentProviderKind } from '@/lib/agents/provider'
import { formatCost } from '@/lib/agents/pricing'
import { ThinkingLevelSelect } from './thinking-level-select'

/**
 * Settings → Agent → Profiles: named Agent configurations for some people
 * (lib/assistants/profiles.ts). An ordered list of cards — the first profile
 * that matches a person (people, groups, roles; optionally only on some
 * areas) wins; everyone else gets the Default profile (the settings above).
 * Each profile can choose the model, the kinds of help (never more than the
 * person's permissions), instructions added after the Agent's own rules,
 * starter prompts, the panel name and limits. Edited in a sheet; saved with
 * the page's Save. Keys are write-only (only "•••• last4" comes back).
 */

type Option = { value: string; label: string }
export type ProfileDraft = ProfileInput & { id: string }

const muted = { color: 'var(--theme-muted-text)' }
const fieldStyle = { borderColor: 'var(--theme-surface-border)' }

export const PROFILE_SWATCH: Record<ProfileColor, string> = {
  blue: '#3b82f6', green: '#16a34a', amber: '#d97706', red: '#dc2626', purple: '#9333ea', teal: '#0d9488', gray: '#6b7280',
}
const HELP_SHORT: Record<AgentToolGroup, string> = { form: 'Form', task: 'Task', designer: 'Building', admin: 'Admin' }
const HELP_HINT: Record<AgentToolGroup, string> = {
  form: 'Explains a form being filled and proposes values.',
  task: 'Summarises a task, explains outcomes, drafts comments.',
  designer: 'Looks things up; builds workflows, forms and tables for people who can build.',
  admin: 'Explains settings and access; admin changes with each one\'s permission.',
}

export function toProfileDrafts(profiles: AgentProfile[]): ProfileDraft[] {
  return profiles.map((p) => ({ ...p, api_key: '' }))
}

function newProfile(): ProfileDraft {
  return {
    id: `profile_${Date.now().toString(36)}`, name: '', description: null, color: 'blue', panel_label: null,
    users: [], teams: [], roles: [], areas: [], connection: 'default', model: '', provider: null, base_url: null, integration_id: null,
    thinking_level: 'default', tools: null, instructions: null, starters: [], api_key: '',
    limits: { messages_per_user_per_day: null, max_request_tokens: null, monthly_cost_cap: null },
  }
}

const listHelp = (tools: Record<AgentToolGroup, boolean>) => {
  const on = AGENT_TOOL_GROUPS.filter((g) => tools[g]).map((g) => HELP_SHORT[g])
  return on.length ? on.join(', ') : 'None (questions only)'
}

export function AgentProfiles({ profiles, onChange, disabled, saved, defaults, roleOptions, teamOptions, userOptions, integrations, tenantId, defaultProvider, defaultModel }: {
  profiles: ProfileDraft[]
  onChange: (profiles: ProfileDraft[]) => void
  disabled: boolean
  /** The saved profiles (test results, unsaved markers). */
  saved: AgentProfile[]
  /** The Default profile: the settings above. */
  defaults: { modelLabel: string; thinking: ThinkingLevel; tools: Record<AgentToolGroup, boolean>; limits: AssistantLimits }
  roleOptions: Option[]
  teamOptions: Option[]
  userOptions: Option[]
  integrations: Array<{ id: string; name: string; type: string }>
  tenantId: string
  defaultProvider: string | null
  defaultModel: string
}) {
  const names = useMemo(() => ({
    users: new Map(userOptions.map((o) => [o.value, o.label])),
    teams: new Map(teamOptions.map((o) => [o.value, o.label])),
    roles: new Map(roleOptions.map((o) => [o.value, o.label])),
  }), [userOptions, teamOptions, roleOptions])
  const [editing, setEditing] = useState<{ draft: ProfileDraft; index: number | null } | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const move = (i: number, d: -1 | 1) => {
    const next = [...profiles]
    const [p] = next.splice(i, 1)
    next.splice(i + d, 0, p)
    onChange(next)
  }
  const duplicate = (i: number) => {
    const src = profiles[i]
    // A copy never carries the saved key (it belongs to the original's id): re-enter it.
    const copy: ProfileDraft = { ...src, id: `profile_${Date.now().toString(36)}`, name: `${src.name || 'Profile'} (copy)`.slice(0, 80), key_last4: null, api_key: '', last_test_status: null, last_test_message: null }
    const next = [...profiles]
    next.splice(i + 1, 0, copy)
    onChange(next)
  }
  const savedById = new Map(saved.map((s) => [s.id, s]))
  const unsaved = (p: ProfileDraft) => {
    const s = savedById.get(p.id)
    if (!s) return true
    const { api_key, ...rest } = p
    return Boolean(api_key) || JSON.stringify({ ...s, ...rest }) !== JSON.stringify(s)
  }
  const orderChanged = profiles.map((p) => p.id).join() !== saved.map((s) => s.id).join()

  return (
    <Card className="p-5 space-y-4" data-testid="assistants-profiles">
      <div>
        <h2 className="text-base font-semibold">Profiles</h2>
        <p className="text-xs mt-0.5" style={muted}>
          Give different people a different Agent: its own model, kinds of help, instructions, starter prompts and limits. The <strong>first</strong> profile that matches
          a person (top to bottom) wins; people who match none get the <strong>Default profile</strong>. Profiles don&apos;t decide who can use the Agent — that&apos;s
          {' '}<strong>Who can use it</strong> in the Agent card — and a profile can only narrow what a person&apos;s permissions allow, never widen it.
        </p>
      </div>
      {(orderChanged || profiles.some(unsaved)) && (
        <p className="text-xs rounded-md border px-2 py-1.5" style={{ borderColor: 'var(--color-warning, #d97706)' }} role="status" data-testid="assistants-profiles-unsaved">
          Unsaved profile changes — select <strong>Save</strong> at the bottom of the page.
        </p>
      )}
      {profiles.length > 0 && (
        <ol className="space-y-2" aria-label="Profiles, first match wins">
          {profiles.map((p, i) => (
            <li key={p.id} className="rounded-md border px-3 py-2.5" style={fieldStyle} data-testid="assistants-profile">
              <div className="flex flex-wrap items-start gap-2">
                <span className="mt-0.5 text-xs font-mono" style={muted} aria-label={`Order ${i + 1}`}>{i + 1}</span>
                <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: PROFILE_SWATCH[(p.color ?? 'gray') as ProfileColor] }} aria-hidden="true" />
                <div className="min-w-0 flex-1 basis-48">
                  <p className="text-sm font-medium flex flex-wrap items-center gap-x-2">
                    <span className="truncate" data-testid="assistants-profile-name">{p.name || 'Untitled profile'}</span>
                    {p.panel_label && <span className="text-2xs rounded-full border px-1.5" style={fieldStyle}>{agentTitle({ panel_label: p.panel_label })}</span>}
                    {unsaved(p) && <span className="text-2xs" style={{ color: 'var(--color-warning, #d97706)' }}>Unsaved</span>}
                  </p>
                  {p.description && <p className="text-xs" style={muted}>{p.description}</p>}
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
                    <dt style={muted}>Who</dt><dd className="min-w-0 break-words">{profileWho({ users: p.users ?? [], teams: p.teams ?? [], roles: p.roles ?? [] }, names)}</dd>
                    <dt style={muted}>Model</dt><dd>{profileModel(p, integrations)}{p.thinking_level && p.thinking_level !== 'default' ? ` · thinking ${THINKING_LABELS[p.thinking_level]}` : ''}</dd>
                    <dt style={muted}>Help</dt><dd>{p.tools ? listHelp(p.tools) : `Same as Default (${listHelp(defaults.tools)})`}</dd>
                    {(p.areas?.length ?? 0) > 0 && <><dt style={muted}>Where</dt><dd>{p.areas!.map((a) => PROFILE_AREA_LABELS[a]).join(', ')}</dd></>}
                    {(p.instructions || (p.starters?.length ?? 0) > 0) && <><dt style={muted}>Adds</dt><dd>{[p.instructions ? 'Instructions' : '', p.starters?.length ? `${p.starters.length} starter prompt${p.starters.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</dd></>}
                    {limitsText(p) && <><dt style={muted}>Limits</dt><dd>{limitsText(p, defaults.limits.cost_currency)}</dd></>}
                  </dl>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button variant="outline" size="sm" disabled={disabled} onClick={() => setEditing({ draft: { ...p }, index: i })} data-testid="assistants-profile-edit"><Pencil size={13} /> Edit</Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Duplicate ${p.name}`} title="Duplicate" disabled={disabled || profiles.length >= MAX_PROFILES} onClick={() => duplicate(i)} data-testid="assistants-profile-duplicate"><Copy size={14} /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Move ${p.name} up`} title="Move up" disabled={disabled || i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Move ${p.name} down`} title="Move down" disabled={disabled || i === profiles.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${p.name}`} title="Delete" disabled={disabled} onClick={() => setDeleting(i)} data-testid="assistants-profile-delete"><Trash2 size={14} /></Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Button variant="secondary" size="sm" onClick={() => setEditing({ draft: newProfile(), index: null })} disabled={disabled || profiles.length >= MAX_PROFILES} data-testid="assistants-profile-add"><Plus size={13} /> Add profile</Button>

      {/* The Default profile: everyone the access list allows who matches no profile. */}
      <div className="rounded-md border border-dashed px-3 py-2.5" style={fieldStyle} data-testid="assistants-profile-default">
        <p className="text-sm font-medium">Default profile <span className="font-normal text-xs" style={muted}>— everyone else who can use the Agent</span></p>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">
          <dt style={muted}>Model</dt><dd>{defaults.modelLabel}{defaults.thinking !== 'default' ? ` · thinking ${THINKING_LABELS[defaults.thinking]}` : ''}</dd>
          <dt style={muted}>Help</dt><dd>{listHelp(defaults.tools)}</dd>
          <dt style={muted}>Limits</dt><dd>{defaultLimitsText(defaults.limits)}</dd>
        </dl>
        <p className="mt-1 text-2xs" style={muted}>Set by Provider (default model), Agent → Advanced and Limits on this page.</p>
      </div>

      <WhoGetsWhat userOptions={userOptions} tenantId={tenantId} />

      {editing && (
        <ProfileSheet
          initial={editing.draft} isNew={editing.index === null} onClose={() => setEditing(null)}
          onApply={(draft) => {
            onChange(editing.index === null ? [...profiles, draft] : profiles.map((p, j) => (j === editing.index ? draft : p)))
            setEditing(null)
          }}
          roleOptions={roleOptions} teamOptions={teamOptions} userOptions={userOptions} integrations={integrations}
          savedProfile={savedById.get(editing.draft.id) ?? null} defaultProvider={defaultProvider} defaultModel={defaultModel} defaults={defaults}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => { if (!o) setDeleting(null) }}
        title={`Delete “${deleting !== null ? profiles[deleting]?.name || 'this profile' : ''}”?`}
        description="People it matched get the next matching profile, or the Default profile, after you save. Its saved key is removed."
        confirmLabel="Delete"
        destructive
        onConfirm={() => { if (deleting !== null) onChange(profiles.filter((_, j) => j !== deleting)); setDeleting(null) }}
      />
    </Card>
  )
}

function profileModel(p: ProfileDraft, integrations: Array<{ id: string; name: string }>): string {
  if ((p.connection ?? 'default') === 'default') return p.model ? `${p.model} (default connection)` : 'Default model'
  if (p.connection === 'integration') return `${p.model || 'Connection default'} via ${integrations.find((i) => i.id === p.integration_id)?.name ?? 'an Integrations connection'}`
  const provider = (p.provider ?? 'openai') as AssistantProvider
  return `${p.model || PROVIDER_PRESETS[provider].defaultModel || 'model'} (${PROVIDER_PRESETS[provider].label})`
}

function limitsText(p: ProfileDraft, currency = 'USD'): string {
  const l = p.limits
  if (!l) return ''
  return [
    l.messages_per_user_per_day != null ? (l.messages_per_user_per_day ? `${l.messages_per_user_per_day}/person/day` : 'no daily limit') : '',
    l.max_request_tokens != null ? (l.max_request_tokens ? `${l.max_request_tokens.toLocaleString('en')} tokens/request` : 'unlimited tokens') : '',
    l.monthly_cost_cap ? `${formatCost(l.monthly_cost_cap, currency)}/month cap` : '',
  ].filter(Boolean).join(' · ')
}

function defaultLimitsText(l: AssistantLimits): string {
  return [
    l.messages_per_user_per_day ? `${l.messages_per_user_per_day}/person/day` : 'No daily limit',
    l.max_request_tokens ? `${l.max_request_tokens.toLocaleString('en')} tokens/request` : '',
    l.monthly_cost_cap ? `workspace cap ${formatCost(l.monthly_cost_cap, l.cost_currency)}/month` : '',
  ].filter(Boolean).join(' · ')
}

type ModelMode = 'inherit' | 'default' | 'key' | 'integration'

function ProfileSheet({ initial, isNew, onClose, onApply, roleOptions, teamOptions, userOptions, integrations, savedProfile, defaultProvider, defaultModel, defaults }: {
  initial: ProfileDraft
  isNew: boolean
  onClose: () => void
  onApply: (draft: ProfileDraft) => void
  roleOptions: Option[]
  teamOptions: Option[]
  userOptions: Option[]
  integrations: Array<{ id: string; name: string; type: string }>
  savedProfile: AgentProfile | null
  defaultProvider: string | null
  defaultModel: string
  defaults: { tools: Record<AgentToolGroup, boolean>; limits: AssistantLimits }
}) {
  const isMobile = useIsMobile()
  const [d, setD] = useState<ProfileDraft>(initial)
  const [mode, setMode] = useState<ModelMode>((initial.connection ?? 'default') === 'default' ? (initial.model ? 'default' : 'inherit') : initial.connection as ModelMode)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const set = (patch: Partial<ProfileDraft>) => setD((x) => ({ ...x, ...patch }))
  const provider = (d.provider ?? 'openai') as AssistantProvider
  const preset = PROVIDER_PRESETS[provider]
  const integration = integrations.find((i) => i.id === d.integration_id)
  const thinkingProvider = d.connection === 'key' ? provider : d.connection === 'integration' ? (integration ? agentProviderKind(integration.type, null) : null) : defaultProvider
  const thinkingModel = d.model || (d.connection === 'key' ? preset.defaultModel : defaultModel)
  const hasWho = (d.users?.length ?? 0) + (d.teams?.length ?? 0) + (d.roles?.length ?? 0) > 0
  const valid = Boolean(d.name?.trim()) && hasWho
  const limits = d.limits ?? { messages_per_user_per_day: null, max_request_tokens: null, monthly_cost_cap: null }
  const num = (v: string): number | null => (v.trim() === '' ? null : Math.max(0, Number(v) || 0))
  const id = d.id
  const starters = d.starters ?? []

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent size="lg" side={isMobile ? 'bottom' : 'right'} title={isNew ? 'Add profile' : `Edit “${initial.name || 'profile'}”`}
        description="Saved with the page's Save button." data-testid="assistants-profile-sheet" data-agent-no-host="" className={isMobile ? 'max-h-[92dvh]' : undefined}>
        <DialogBody className="space-y-6">
          {/* Basics */}
          <section className="space-y-3" aria-labelledby={`${id}-basics`}>
            <h3 id={`${id}-basics`} className="text-sm font-semibold">Basics</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor={`${id}-name`} className="block text-xs font-medium">Name</label>
                <Input id={`${id}-name`} value={d.name ?? ''} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. HR assistant" data-testid="assistants-profile-name-input" />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-panel`} className="block text-xs font-medium">Name in the panel <span style={muted}>(optional)</span></label>
                <Input id={`${id}-panel`} value={d.panel_label ?? ''} maxLength={MAX_PANEL_LABEL} onChange={(e) => set({ panel_label: e.target.value || null })} placeholder="e.g. HR" data-testid="assistants-profile-panel-label" />
                <p className="text-2xs" style={muted}>The panel header reads “{agentTitle({ panel_label: d.panel_label?.trim() || null })}”.</p>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-desc`} className="block text-xs font-medium">Description <span style={muted}>(optional, admins only)</span></label>
              <Input id={`${id}-desc`} value={d.description ?? ''} maxLength={300} onChange={(e) => set({ description: e.target.value || null })} placeholder="What this profile is for" />
            </div>
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium">Colour</legend>
              <div className="flex flex-wrap gap-2">
                {PROFILE_COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => set({ color: c })} aria-label={c} aria-pressed={d.color === c}
                    className="size-7 rounded-full border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    style={{ background: PROFILE_SWATCH[c], borderColor: d.color === c ? 'var(--theme-text, #111)' : 'transparent' }} />
                ))}
              </div>
            </fieldset>
          </section>

          {/* Who and where */}
          <section className="space-y-3 border-t pt-4" style={fieldStyle} aria-labelledby={`${id}-who`}>
            <h3 id={`${id}-who`} className="text-sm font-semibold">Who</h3>
            <p className="text-xs" style={muted}>Anyone named here, in one of these groups, or holding one of these roles — as long as they can use the Agent at all (Who can use it).</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1"><span className="block text-xs font-medium">People</span>
                <SearchableMultiOptionPicker options={userOptions} values={d.users ?? []} placeholder="Choose people" onChange={(users) => set({ users })} /></div>
              <div className="space-y-1"><span className="block text-xs font-medium">Groups (teams)</span>
                <SearchableMultiOptionPicker options={teamOptions} values={d.teams ?? []} placeholder="Choose groups" onChange={(teams) => set({ teams })} /></div>
              <div className="space-y-1"><span className="block text-xs font-medium">Roles</span>
                <SearchableMultiOptionPicker options={roleOptions} values={d.roles ?? []} placeholder="Choose roles" onChange={(roles) => set({ roles })} /></div>
            </div>
            {!hasWho && <p className="text-2xs" style={{ color: 'var(--color-warning, #d97706)' }}>Choose at least one person, group or role.</p>}
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium mb-1">Where it applies</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!d.areas?.length} onChange={(e) => { if (e.target.checked) set({ areas: [] }) }} style={{ accentColor: 'var(--theme-primary)' }} />
                Everywhere
              </label>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pl-1">
                {PROFILE_AREAS.map((a) => (
                  <label key={a} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={Boolean(d.areas?.includes(a))} style={{ accentColor: 'var(--theme-primary)' }}
                      onChange={(e) => set({ areas: e.target.checked ? [...(d.areas ?? []), a] : (d.areas ?? []).filter((x: ProfileArea) => x !== a) })} />
                    {PROFILE_AREA_LABELS[a]}
                  </label>
                ))}
              </div>
              <p className="text-2xs" style={muted}>On other screens these people get the next matching profile, or the Default profile.</p>
            </fieldset>
          </section>

          {/* Model */}
          <section className="space-y-3 border-t pt-4" style={fieldStyle} aria-labelledby={`${id}-model`}>
            <h3 id={`${id}-model`} className="text-sm font-semibold">Model</h3>
            <fieldset className="space-y-1.5">
              <legend className="sr-only">Connection</legend>
              {([['inherit', 'Use the default model'], ['default', 'The default connection, another model'], ['key', 'Its own provider and key'], ['integration', 'An Integrations connection']] as const).map(([value, label]) => (
                (value !== 'integration' || integrations.length > 0 || mode === 'integration') && (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input type="radio" name={`${id}-conn`} checked={mode === value} style={{ accentColor: 'var(--theme-primary)' }}
                      onChange={() => { setMode(value); set(value === 'inherit' ? { connection: 'default', model: '' } : { connection: value }) }} data-testid={`assistants-profile-conn-${value}`} />
                    {label}
                  </label>
                )
              ))}
            </fieldset>
            {mode === 'key' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="block text-xs font-medium" htmlFor={`${id}-provider`}>Provider</label>
                  <Select id={`${id}-provider`} value={provider} onChange={(e) => set({ provider: e.target.value as AssistantProvider, api_key: '' })}>
                    {ASSISTANT_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_PRESETS[p].label}</option>)}
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium" htmlFor={`${id}-key`}>API key {!preset.keyRequired && <span style={muted}>(optional)</span>}</label>
                  <Input id={`${id}-key`} type="password" autoComplete="new-password" value={d.api_key ?? ''} onChange={(e) => set({ api_key: e.target.value })}
                    placeholder={d.key_last4 && d.provider === savedProfile?.provider ? `•••• ${d.key_last4} — type to replace` : preset.keyPlaceholder} />
                  {d.key_last4 && <p className="text-2xs inline-flex items-center gap-1" style={muted}><KeyRound size={11} /> Saved key •••• {d.key_last4}</p>}
                </div>
                {preset.baseUrl !== 'hidden' && (
                  <div className="space-y-1 sm:col-span-2">
                    <label className="block text-xs font-medium" htmlFor={`${id}-base`}>Base URL {preset.baseUrl === 'optional' && <span style={muted}>(optional)</span>}</label>
                    <Input id={`${id}-base`} value={d.base_url ?? ''} onChange={(e) => set({ base_url: e.target.value })} placeholder={preset.defaultBaseUrl ?? 'https://llm.example.com/v1'} />
                  </div>
                )}
              </div>
            )}
            {mode === 'integration' && (
              <div className="space-y-1">
                <label className="block text-xs font-medium" htmlFor={`${id}-int`}>Connection</label>
                <Select id={`${id}-int`} value={d.integration_id ?? ''} onChange={(e) => set({ integration_id: e.target.value })} className="max-w-72">
                  <option value="">Choose a connection…</option>
                  {integrations.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.type})</option>)}
                </Select>
              </div>
            )}
            {mode !== 'inherit' && (
              <div className="space-y-1">
                <label className="block text-xs font-medium" htmlFor={`${id}-modelid`}>Model</label>
                <Input id={`${id}-modelid`} value={d.model ?? ''} onChange={(e) => set({ model: e.target.value })} className="max-w-72"
                  placeholder={mode === 'key' ? preset.defaultModel || 'model id' : 'model id'} list={`${id}-models`} data-testid="assistants-profile-model" />
                <datalist id={`${id}-models`}>{(mode === 'key' ? preset.models : []).map((m) => <option key={m} value={m} />)}</datalist>
              </div>
            )}
            <ThinkingLevelSelect id={`${id}-thinking`} value={d.thinking_level} onChange={(thinking_level) => set({ thinking_level })} provider={thinkingProvider} model={thinkingModel} />
            {mode !== 'inherit' && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" disabled={testing || !savedProfile} title={savedProfile ? 'Test the saved profile\'s connection' : 'Save the profile first'}
                  onClick={async () => { setTesting(true); setTest(null); const r = await testModelRuleAction(d.id); setTesting(false); setTest(r.ok ? r.data : { ok: false, message: r.error }) }}>
                  <PlugZap size={13} /> {testing ? 'Testing…' : 'Test connection'}
                </Button>
                {!test && savedProfile?.last_test_message && (
                  <span className="text-xs inline-flex items-center gap-1" style={muted}>{savedProfile.last_test_status === 'ok' && <CheckCircle2 size={12} />}Last test: {savedProfile.last_test_message}</span>
                )}
              </div>
            )}
            {test && <InlineNotice tone={test.ok ? 'success' : 'error'} message={test.message} onDismiss={() => setTest(null)} />}
          </section>

          {/* Help groups */}
          <section className="space-y-3 border-t pt-4" style={fieldStyle} aria-labelledby={`${id}-help`}>
            <h3 id={`${id}-help`} className="text-sm font-semibold">Kinds of help</h3>
            <fieldset className="space-y-1.5">
              <legend className="sr-only">Kinds of help</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name={`${id}-tools`} checked={!d.tools} onChange={() => set({ tools: null })} style={{ accentColor: 'var(--theme-primary)' }} />
                Same as the Default profile <span className="text-xs" style={muted}>({listHelp(defaults.tools)})</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name={`${id}-tools`} checked={Boolean(d.tools)} onChange={() => set({ tools: { ...defaults.tools } })} style={{ accentColor: 'var(--theme-primary)' }} data-testid="assistants-profile-tools-custom" />
                Choose for this profile
              </label>
            </fieldset>
            {d.tools && (
              <div className="space-y-2">
                {AGENT_TOOL_GROUPS.map((g) => (
                  <div key={g} className="flex items-start justify-between gap-3">
                    <div><p className="text-sm">{HELP_SHORT[g]} help</p><p className="text-2xs" style={muted}>{HELP_HINT[g]}</p></div>
                    <Switch checked={d.tools![g]} onCheckedChange={(on) => set({ tools: { ...d.tools!, [g]: on } })} aria-label={`${HELP_SHORT[g]} help`} data-testid={`assistants-profile-tool-${g}`} />
                  </div>
                ))}
              </div>
            )}
            <p className="text-2xs" style={muted}>Each kind still needs the person&apos;s own permissions (e.g. building needs a build permission). A profile can turn help off, never grant more.</p>
          </section>

          {/* Instructions */}
          <section className="space-y-2 border-t pt-4" style={fieldStyle} aria-labelledby={`${id}-instr`}>
            <h3 id={`${id}-instr`} className="text-sm font-semibold">Instructions <span className="font-normal text-xs" style={muted}>(optional)</span></h3>
            <Textarea id={`${id}-instructions`} aria-labelledby={`${id}-instr`} rows={5} maxLength={MAX_PROFILE_INSTRUCTIONS} value={d.instructions ?? ''} onChange={(e) => set({ instructions: e.target.value || null })}
              placeholder="e.g. You help HR staff. Always mention the leave policy page (/pages/leave-policy) when leave comes up." data-testid="assistants-profile-instructions" />
            <p className="text-2xs" style={muted}>
              {(d.instructions ?? '').length.toLocaleString('en')} / {MAX_PROFILE_INSTRUCTIONS.toLocaleString('en')}. Added after the Agent&apos;s own rules, which always take precedence: instructions can&apos;t
              give it more tools or permissions or skip a confirmation. Only admins see them; they&apos;re never sent to people&apos;s browsers.
            </p>
          </section>

          {/* Starters */}
          <section className="space-y-2 border-t pt-4" style={fieldStyle} aria-labelledby={`${id}-starters`}>
            <h3 id={`${id}-starters`} className="text-sm font-semibold">Starter prompts <span className="font-normal text-xs" style={muted}>(optional)</span></h3>
            <p className="text-2xs" style={muted}>Shown in an empty panel (after the screen&apos;s own suggestions on tasks, forms and builders).</p>
            {starters.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input aria-label={`Starter prompt ${i + 1}`} value={s} maxLength={MAX_STARTER_LENGTH} onChange={(e) => set({ starters: starters.map((x, j) => (j === i ? e.target.value : x)) })} data-testid="assistants-profile-starter" />
                <Button variant="ghost" size="icon-sm" aria-label={`Remove starter prompt ${i + 1}`} onClick={() => set({ starters: starters.filter((_, j) => j !== i) })}><X size={14} /></Button>
              </div>
            ))}
            <Button variant="secondary" size="sm" disabled={starters.length >= MAX_PROFILE_STARTERS} onClick={() => set({ starters: [...starters, ''] })} data-testid="assistants-profile-starter-add"><Plus size={13} /> Add starter</Button>
          </section>

          {/* Limits */}
          <section className="space-y-3 border-t pt-4" style={fieldStyle} aria-labelledby={`${id}-limits`}>
            <h3 id={`${id}-limits`} className="text-sm font-semibold">Limits <span className="font-normal text-xs" style={muted}>(optional)</span></h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor={`${id}-perday`} className="block text-xs font-medium">Messages per person per day</label>
                <Input id={`${id}-perday`} type="number" min={0} value={limits.messages_per_user_per_day ?? ''} onChange={(e) => set({ limits: { ...limits, messages_per_user_per_day: num(e.target.value) } })}
                  placeholder={defaults.limits.messages_per_user_per_day ? `Workspace: ${defaults.limits.messages_per_user_per_day}` : 'Workspace: no limit'} />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-tokens`} className="block text-xs font-medium">Token limit per request</label>
                <Input id={`${id}-tokens`} type="number" min={0} step={1000} value={limits.max_request_tokens ?? ''} onChange={(e) => set({ limits: { ...limits, max_request_tokens: num(e.target.value) } })}
                  placeholder={defaults.limits.max_request_tokens ? `Workspace: ${defaults.limits.max_request_tokens.toLocaleString('en')}` : 'Workspace: unlimited'} />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${id}-cap`} className="block text-xs font-medium">Monthly cost cap ({defaults.limits.cost_currency})</label>
                <Input id={`${id}-cap`} type="number" min={0} step="0.01" value={limits.monthly_cost_cap ?? ''} onChange={(e) => set({ limits: { ...limits, monthly_cost_cap: num(e.target.value) || null } })} placeholder="None" />
              </div>
            </div>
            <p className="text-2xs" style={muted}>Empty uses the workspace&apos;s limit (0 = no limit for this profile). The cost cap counts this profile&apos;s use by everyone on it; the workspace&apos;s monthly cap still applies.</p>
          </section>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!valid} onClick={() => onApply({ ...d, name: d.name!.trim(), starters: starters.map((s) => s.trim()).filter(Boolean) })} data-testid="assistants-profile-apply">
            {isNew ? 'Add profile' : 'Apply'}
          </Button>
        </DialogFooter>
      </SheetContent>
    </Sheet>
  )
}

type Preview = {
  allowed: boolean
  profile: { id: string; name: string; index: number; areas: ProfileArea[] } | null
  provider: string
  model: string
  thinking_level: ThinkingLevel
  thinking_by_group?: Partial<Record<string, ThinkingLevel>>
  help: Record<AgentToolGroup, boolean>
  can_build: boolean
  limits: { messages_per_user_per_day: number; max_request_tokens: number; monthly_cost_cap: number; cost_currency: string; profile_monthly_cost_cap: number | null }
  by_area: Array<{ area: ProfileArea; profile: { id: string; name: string } | null }> | null
  has_instructions: boolean
  starters: string[]
}

function WhoGetsWhat({ userOptions, tenantId }: { userOptions: Option[]; tenantId: string }) {
  const [userId, setUserId] = useState('')
  const { data, isFetching } = useQuery({
    queryKey: ['assistants-model-preview', tenantId, userId],
    enabled: Boolean(userId),
    queryFn: async () => (await serverRead('assistants.modelPreview', { userId })).data as Preview,
  })
  return (
    <div className="space-y-2 border-t pt-3" style={fieldStyle} data-testid="assistants-model-preview">
      <label className="block text-sm font-medium" htmlFor="assistants-preview-user">Who gets what</label>
      <Select id="assistants-preview-user" value={userId} onChange={(e) => setUserId(e.target.value)} className="max-w-72">
        <option value="">Pick a person…</option>
        {userOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
      {userId && (isFetching ? <p className="text-xs" style={muted}>Checking…</p> : data ? (
        <div className="rounded-md border px-3 py-2 text-sm" style={fieldStyle} data-testid="assistants-model-preview-result">
          {!data.allowed && <p className="mb-1 text-xs" style={{ color: 'var(--color-warning, #d97706)' }}>Can&apos;t use the Agent: not in Who can use it (or the Agent is off). What they would get:</p>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt style={muted}>Profile</dt>
            <dd className="font-medium" data-testid="assistants-model-preview-profile">{data.profile ? `${data.profile.index + 1}. ${data.profile.name}` : 'Default profile'}</dd>
            <dt style={muted}>Model</dt><dd><span className="font-medium">{data.model || 'default model'}</span> <span style={muted}>({data.provider})</span></dd>
            <dt style={muted}>Thinking</dt>
            <dd><span data-testid="assistants-model-preview-thinking">{THINKING_LABELS[data.thinking_level ?? 'default']}</span>
              {data.thinking_by_group && Object.keys(data.thinking_by_group).length > 0 && <span style={muted}> ({Object.entries(data.thinking_by_group).map(([g, l]) => `${g === 'designer' ? 'building' : g}: ${THINKING_LABELS[l as ThinkingLevel]}`).join(', ')})</span>}</dd>
            <dt style={muted}>Help</dt>
            <dd data-testid="assistants-model-preview-help">{AGENT_TOOL_GROUPS.filter((g) => data.help[g]).map((g) => (g === 'designer' && !data.can_build ? 'Building (read-only)' : HELP_SHORT[g])).join(', ') || 'Questions only'}</dd>
            <dt style={muted}>Limits</dt>
            <dd>{[data.limits.messages_per_user_per_day ? `${data.limits.messages_per_user_per_day}/day` : 'no daily limit', data.limits.max_request_tokens ? `${data.limits.max_request_tokens.toLocaleString('en')} tokens/request` : '', data.limits.profile_monthly_cost_cap ? `profile cap ${formatCost(data.limits.profile_monthly_cost_cap, data.limits.cost_currency)}/month` : ''].filter(Boolean).join(' · ')}</dd>
            {(data.has_instructions || data.starters.length > 0) && <><dt style={muted}>Adds</dt><dd>{[data.has_instructions ? 'Instructions' : '', data.starters.length ? `${data.starters.length} starter prompt${data.starters.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</dd></>}
            {data.by_area && <><dt style={muted}>By screen</dt><dd>{data.by_area.map((a) => `${PROFILE_AREA_LABELS[a.area]}: ${a.profile?.name ?? 'Default'}`).join(' · ')}</dd></>}
          </dl>
        </div>
      ) : null)}
      <p className="text-xs" style={muted}>Uses the saved profiles and the person&apos;s current roles, groups and permissions (save first to preview changes).</p>
    </div>
  )
}
