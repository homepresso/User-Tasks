'use client'

import { useEffect, useMemo, useState } from 'react'
import { bulkDeleteWithJob, useJobs } from '@/components/jobs/jobs-provider'
import * as Dialog from '@radix-ui/react-dialog'
import { ShieldCheck, Plus, Trash2, Save, X, Grid3x3, List, Search, ChevronUp, ChevronDown, Check } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  createRetentionPolicy,
  deleteRetentionPolicy,
  updateRetentionPolicy,
} from '@/app/actions/retention-policies'
import type { RetentionPolicy } from '@/lib/retention-policies'
import { useAppStore } from '@/stores/app-store'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { buildQueuedDeleteNotice, type DeleteNotice } from '@/lib/queued-delete-feedback'
import { usePermissions } from '@/lib/permissions-context'
import { ExportAssetButton, ImportConfigButton } from '@/components/shared/config-transfer'

interface Props {
  policies: RetentionPolicy[]
}

type PolicySortField = 'name' | 'mode'
type PolicySortDir = 'asc' | 'desc'

type PolicyDraft = {
  name: string
  description: string
  policyMode: RetentionPolicy['policy_mode']
  durationValue: string
  durationUnit: 'days' | 'months' | 'years'
  exactDate: string
  appliesTo: string[]
}

const APPLY_OPTIONS = [
  { key: 'data_tables', label: 'Tables / Lists' },
  { key: 'data_rows', label: 'Rows' },
  { key: 'roles', label: 'Roles' },
] as const

const DEFAULT_APPLIES_TO = ['data_tables', 'data_rows', 'roles']

function createEmptyDraft(): PolicyDraft {
  return {
    name: '',
    description: '',
    policyMode: 'review',
    durationValue: '365',
    durationUnit: 'days',
    exactDate: '',
    appliesTo: [...DEFAULT_APPLIES_TO],
  }
}

function policyToDraft(policy: RetentionPolicy): PolicyDraft {
  return {
    name: policy.name,
    description: policy.description ?? '',
    policyMode: policy.policy_mode,
    durationValue: String(policy.duration_value ?? 365),
    durationUnit: policy.duration_unit ?? 'days',
    exactDate: policy.exact_date ? policy.exact_date.slice(0, 10) : '',
    appliesTo: policy.applies_to?.length ? [...policy.applies_to] : [...DEFAULT_APPLIES_TO],
  }
}

function getPolicySummary(policy: RetentionPolicy) {
  if (policy.policy_mode === 'keep_forever') return 'Keep forever'
  if (policy.policy_mode === 'review_on_exact_date') {
    return policy.exact_date
      ? `Review on ${new Date(policy.exact_date).toLocaleDateString()}`
      : 'Review on exact date'
  }
  if (policy.policy_mode === 'purge_on_exact_date') {
    return policy.exact_date
      ? `Purge on ${new Date(policy.exact_date).toLocaleDateString()}`
      : 'Purge on exact date'
  }
  const value = policy.duration_value ?? 0
  const unit = policy.duration_unit ?? 'days'
  const unitLabel = value === 1 ? unit.slice(0, -1) : unit
  return `${policy.policy_mode === 'review' ? 'Review' : 'Purge'} after ${value} ${unitLabel}`
}

function RetentionPolicyForm({
  draft,
  onChange,
}: {
  draft: PolicyDraft
  onChange: (next: PolicyDraft) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>Policy name</label>
        <input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="e.g. Finance 7 years"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>Policy mode</label>
        <select
          value={draft.policyMode}
          onChange={(e) => onChange({ ...draft, policyMode: e.target.value as RetentionPolicy['policy_mode'] })}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
        >
          <option value="review">Review on interval</option>
          <option value="review_on_exact_date">Review on exact date</option>
          <option value="purge_on">Purge on interval</option>
          <option value="purge_on_exact_date">Purge on exact date</option>
          <option value="keep_forever">Keep forever</option>
        </select>
      </div>
      <div className="md:col-span-2">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>Description</label>
        <textarea
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          rows={3}
          placeholder="What this policy is for and who should use it"
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
        />
      </div>
      {(draft.policyMode === 'review' || draft.policyMode === 'purge_on') && (
        <>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>Duration</label>
            <input
              value={draft.durationValue}
              onChange={(e) => onChange({ ...draft, durationValue: e.target.value })}
              type="number"
              min={1}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>Unit</label>
            <select
              value={draft.durationUnit}
              onChange={(e) => onChange({ ...draft, durationUnit: e.target.value as PolicyDraft['durationUnit'] })}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
            >
              <option value="days">Days</option>
              <option value="months">Months</option>
              <option value="years">Years</option>
            </select>
          </div>
        </>
      )}
      {(draft.policyMode === 'review_on_exact_date' || draft.policyMode === 'purge_on_exact_date') && (
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>
            {draft.policyMode === 'review_on_exact_date' ? 'Exact review date' : 'Exact purge date'}
          </label>
          <input
            value={draft.exactDate}
            onChange={(e) => onChange({ ...draft, exactDate: e.target.value })}
            type="date"
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
          />
        </div>
      )}
      <div className={draft.policyMode === 'keep_forever' ? 'md:col-span-2' : ''}>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>Applies to</label>
        <div className="flex flex-wrap gap-2">
          {APPLY_OPTIONS.map((option) => {
            const selected = draft.appliesTo.includes(option.key)
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => onChange({
                  ...draft,
                  appliesTo: selected
                    ? draft.appliesTo.filter((value) => value !== option.key)
                    : [...draft.appliesTo, option.key],
                })}
                className="rounded-full px-3 py-1.5 text-xs font-medium"
                style={{
                  backgroundColor: selected ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                  color: selected ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function RetentionPoliciesManager({ policies }: Props) {
  const queryClient = useQueryClient()
  const jobs = useJobs()
  const { can } = usePermissions()
  const { layoutPreference, setLayoutPreference } = useAppStore()
  const viewMode = (layoutPreference.retentionPolicies === 'list' ? 'list' : 'grid') as 'grid' | 'list'
  const [draft, setDraft] = useState<PolicyDraft>(createEmptyDraft())
  const [localPolicies, setLocalPolicies] = useState<RetentionPolicy[]>(policies)
  const [editingPolicy, setEditingPolicy] = useState<RetentionPolicy | null>(null)
  const [editDraft, setEditDraft] = useState<PolicyDraft>(createEmptyDraft())
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [modeFilter, setModeFilter] = useState<'all' | RetentionPolicy['policy_mode']>('all')
  const [scopeFilter, setScopeFilter] = useState<'all' | typeof APPLY_OPTIONS[number]['key']>('all')
  const [sortBy, setSortBy] = useState<PolicySortField>('name')
  const [sortDir, setSortDir] = useState<PolicySortDir>('asc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleteNotice, setBulkDeleteNotice] = useState<DeleteNotice | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    setLocalPolicies(policies)
  }, [policies])

  const sortedPolicies = useMemo(() => {
    const search = query.trim().toLowerCase()
    return [...localPolicies]
      .filter((policy) => {
        if (modeFilter !== 'all' && policy.policy_mode !== modeFilter) return false
        if (scopeFilter !== 'all' && !(policy.applies_to ?? []).includes(scopeFilter)) return false
        if (!search) return true
        return (
          policy.name.toLowerCase().includes(search) ||
          String(policy.description ?? '').toLowerCase().includes(search)
        )
      })
      .sort((a, b) => {
        let cmp = 0
        if (sortBy === 'mode') cmp = String(a.policy_mode ?? '').localeCompare(String(b.policy_mode ?? ''))
        else cmp = a.name.localeCompare(b.name)
        return sortDir === 'desc' ? -cmp : cmp
      })
  }, [localPolicies, modeFilter, query, scopeFilter, sortBy, sortDir])

  function toggleSort(field: PolicySortField) {
    if (sortBy === field) setSortDir((current) => current === 'asc' ? 'desc' : 'asc')
    else {
      setSortBy(field)
      setSortDir(field === 'name' ? 'asc' : 'desc')
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === sortedPolicies.length) setSelected(new Set())
    else setSelected(new Set(sortedPolicies.map((policy) => policy.id)))
  }

  async function handleCreate() {
    setSaving('new')
    setError(null)
    try {
      await createRetentionPolicy({
        name: draft.name,
        description: draft.description,
        policyMode: draft.policyMode,
        durationValue: draft.policyMode === 'review' || draft.policyMode === 'purge_on' ? Number(draft.durationValue || 0) : null,
        durationUnit: draft.policyMode === 'review' || draft.policyMode === 'purge_on' ? draft.durationUnit : null,
        exactDate: draft.policyMode === 'review_on_exact_date' || draft.policyMode === 'purge_on_exact_date' ? draft.exactDate : null,
        appliesTo: draft.appliesTo,
      })
      setDraft(createEmptyDraft())
      queryClient.invalidateQueries({ queryKey: ['governance'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create retention policy')
    } finally {
      setSaving(null)
    }
  }

  async function handleDelete(policyId: string, name: string) {
    setSaving(policyId)
    setError(null)
    try {
      await deleteRetentionPolicy(policyId)
      setLocalPolicies((prev) => prev.filter((policy) => policy.id !== policyId))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(policyId)
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['governance'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete retention policy')
    } finally {
      setSaving(null)
    }
  }

  async function handleEditSave() {
    if (!editingPolicy) return
    setSaving(editingPolicy.id)
    setError(null)
    try {
      await updateRetentionPolicy(editingPolicy.id, {
        name: editDraft.name,
        description: editDraft.description,
        policyMode: editDraft.policyMode,
        durationValue: editDraft.policyMode === 'review' || editDraft.policyMode === 'purge_on' ? Number(editDraft.durationValue || 0) : null,
        durationUnit: editDraft.policyMode === 'review' || editDraft.policyMode === 'purge_on' ? editDraft.durationUnit : null,
        exactDate: editDraft.policyMode === 'review_on_exact_date' || editDraft.policyMode === 'purge_on_exact_date' ? editDraft.exactDate : null,
        appliesTo: editDraft.appliesTo,
      })
      setEditingPolicy(null)
      queryClient.invalidateQueries({ queryKey: ['governance'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update retention policy')
    } finally {
      setSaving(null)
    }
  }

  async function handleBulkDelete() {
    const ids = [...selected]
    if (ids.length === 0) return
    setSaving('bulk-delete')
    setBulkDeleteNotice(null)
    const previous = localPolicies
    setLocalPolicies((prev) => prev.filter((policy) => !ids.includes(policy.id)))
    setSelected(new Set())
    setShowBulkDelete(false)
    try {
      const result = await bulkDeleteWithJob(jobs, 'retention_policy', ids, () => queryClient.invalidateQueries({ queryKey: ['governance'] }))
      const blockedCount = result.blocked
      if (!result.background) setBulkDeleteNotice(buildQueuedDeleteNotice({
        queued: result?.queued ?? 0,
        total: ids.length,
        singular: 'policy',
        plural: 'policies',
        blockedCount,
        blockedLabel: 'still have assigned assets',
      }))
    } catch (err) {
      setLocalPolicies(previous)
      setSelected(new Set(ids))
      setBulkDeleteNotice({ tone: 'error', message: err instanceof Error ? err.message : 'Unable to delete selected policies' })
    } finally {
      setSaving(null)
    }
  }

  const SortIcon = ({ field }: { field: PolicySortField }) => {
    if (sortBy !== field) return null
    return sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
  }

  return (
    <div className="space-y-5">
      {bulkDeleteNotice && (
        <InlineNotice
          tone={bulkDeleteNotice.tone}
          message={bulkDeleteNotice.message}
          onDismiss={() => setBulkDeleteNotice(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete Retention Policy"
        description={`Delete retention policy "${deleteTarget?.name ?? 'this policy'}"?`}
        confirmLabel="Delete"
        destructive
        busy={Boolean(deleteTarget && saving === deleteTarget.id)}
        onConfirm={async () => {
          if (!deleteTarget) return
          await handleDelete(deleteTarget.id, deleteTarget.name)
          setDeleteTarget(null)
        }}
      />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>Retention Policies</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--theme-muted-text)' }}>
            Create reusable policies once, then apply them to tables/lists, rows, and roles across the platform.
          </p>
        </div>
        {can('settings.edit') && <ImportConfigButton onImported={() => void queryClient.invalidateQueries({ queryKey: ['governance'] })} />}
      </div>

      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
        <RetentionPolicyForm draft={draft} onChange={setDraft} />
        <div className="mt-4 flex items-center justify-between">
          {error ? <p className="text-xs" style={{ color: 'var(--theme-danger, #DC2626)' }}>{error}</p> : <span />}
          <Button onClick={handleCreate} disabled={saving === 'new'}>
            <Plus size={14} className="mr-1" />
            {saving === 'new' ? 'Creating...' : 'Create Policy'}
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border px-4 py-2" style={{ backgroundColor: 'var(--theme-primary-light)', borderColor: 'var(--theme-primary)' }}>
          <span className="text-sm font-medium" style={{ color: 'var(--theme-primary-text)' }}>{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())} className="!h-7 !text-xs">Clear</Button>
          <div className="flex-1" />
          <Button size="sm" onClick={() => setShowBulkDelete(true)} className="!h-7 !text-xs !bg-red-600 hover:!bg-red-700 !text-white">
            <Trash2 size={12} className="mr-1" /> Delete {selected.size}
          </Button>
        </div>
      )}

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search retention policies..." className="pl-9" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <input
            type="checkbox"
            checked={sortedPolicies.length > 0 && selected.size === sortedPolicies.length}
            ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < sortedPolicies.length }}
            onChange={toggleSelectAll}
            className="h-4 w-4 rounded border-gray-300 accent-[color:var(--theme-primary)]"
          />
          Select all
        </label>

        {[
          { value: 'all', label: 'All modes' },
          { value: 'review', label: 'Review interval' },
          { value: 'review_on_exact_date', label: 'Review exact date' },
          { value: 'purge_on', label: 'Purge interval' },
          { value: 'purge_on_exact_date', label: 'Purge exact date' },
          { value: 'keep_forever', label: 'Keep forever' },
        ].map((option) => (
          <button
            key={option.value}
            onClick={() => setModeFilter(option.value as typeof modeFilter)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              backgroundColor: modeFilter === option.value ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
              color: modeFilter === option.value ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
            }}
          >
            {option.label}
          </button>
        ))}

        {[
          { value: 'all', label: 'All scopes' },
          { value: 'data_tables', label: 'Tables / Lists' },
          { value: 'data_rows', label: 'Rows' },
          { value: 'roles', label: 'Roles' },
        ].map((option) => (
          <button
            key={option.value}
            onClick={() => setScopeFilter(option.value as typeof scopeFilter)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              backgroundColor: scopeFilter === option.value ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
              color: scopeFilter === option.value ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
            }}
          >
            {option.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1">
          {(['name', 'mode'] as PolicySortField[]).map((field) => (
            <button
              key={field}
              onClick={() => toggleSort(field)}
              className="flex items-center gap-0.5 rounded px-2 py-1 text-[10px] font-medium transition-colors"
              style={{
                backgroundColor: sortBy === field ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                color: sortBy === field ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
              }}
            >
              {field === 'name' ? 'Name' : 'Mode'}
              <SortIcon field={field} />
            </button>
          ))}

          <div className="flex overflow-hidden rounded-lg border" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <button
              onClick={() => setLayoutPreference('retentionPolicies', 'grid')}
              className="p-1.5"
              style={{ backgroundColor: viewMode === 'grid' ? 'var(--theme-primary)' : 'transparent', color: viewMode === 'grid' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}
            >
              <Grid3x3 size={14} />
            </button>
            <button
              onClick={() => setLayoutPreference('retentionPolicies', 'list')}
              className="p-1.5"
              style={{ backgroundColor: viewMode === 'list' ? 'var(--theme-primary)' : 'transparent', color: viewMode === 'list' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}
            >
              <List size={14} />
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'list' ? (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <div
            className="grid text-[10px] font-semibold uppercase tracking-wider"
            style={{ gridTemplateColumns: '36px 1.2fr 160px 180px 1fr 140px', backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
          >
            <div className="px-2 py-2" />
            <button className="px-3 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort('name')}>
              Name <SortIcon field="name" />
            </button>
            <button className="px-2 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort('mode')}>
              Mode <SortIcon field="mode" />
            </button>
            <div className="px-2 py-2">Summary</div>
            <div className="px-2 py-2">Applies To</div>
            <div className="px-2 py-2 text-right">Actions</div>
          </div>
          {sortedPolicies.map((policy) => (
            <div
              key={policy.id}
              className="grid items-center border-t text-xs"
              style={{
                gridTemplateColumns: '36px 1.2fr 160px 180px 1fr 140px',
                borderColor: 'var(--theme-surface-border)',
                backgroundColor: selected.has(policy.id) ? 'var(--theme-primary-light)' : undefined,
              }}
            >
              <div className="px-2 py-3 flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={selected.has(policy.id)}
                  onChange={() => toggleSelect(policy.id)}
                  className="h-4 w-4 rounded border-gray-300 accent-[color:var(--theme-primary)]"
                />
              </div>
              <div className="px-3 py-3 min-w-0">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={14} style={{ color: 'var(--theme-primary-text)' }} />
                  <span className="truncate font-medium" style={{ color: 'var(--theme-card-text)' }}>{policy.name}</span>
                </div>
                <p className="mt-1 truncate text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                  {policy.description || 'No description provided.'}
                </p>
              </div>
              <div className="px-2 py-3" style={{ color: 'var(--theme-muted-text)' }}>
                {policy.policy_mode.replace(/_/g, ' ')}
              </div>
              <div className="px-2 py-3" style={{ color: 'var(--theme-muted-text)' }}>
                {getPolicySummary(policy)}
              </div>
              <div className="px-2 py-3">
                <div className="flex flex-wrap gap-1">
                  {(policy.applies_to ?? []).map((scope) => (
                    <span key={scope} className="rounded-full px-2 py-1 text-[10px]" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                      {scope === 'data_rows' ? 'Rows' : scope === 'roles' ? 'Roles' : 'Tables / Lists'}
                    </span>
                  ))}
                </div>
              </div>
              <div className="px-2 py-3 flex items-center justify-end gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="!h-7 !px-2"
                  onClick={() => {
                    setEditingPolicy(policy)
                    setEditDraft(policyToDraft(policy))
                    setError(null)
                  }}
                  disabled={saving === policy.id}
                >
                  <Save size={12} />
                </Button>
                {can('settings.view') && <ExportAssetButton ids={[policy.id]} name={policy.name} iconOnly className="!h-7 !px-2" />}
                <Button size="sm" variant="outline" className="!h-7 !px-2" onClick={() => setDeleteTarget({ id: policy.id, name: policy.name })} disabled={saving === policy.id}>
                  <Trash2 size={12} />
                </Button>
              </div>
            </div>
          ))}
          {sortedPolicies.length === 0 && (
            <div className="p-6 text-sm" style={{ color: 'var(--theme-muted-text)' }}>
              No retention policies yet. Create one above and then apply it to tables/lists, rows, or roles.
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {sortedPolicies.map((policy) => (
          <div key={policy.id} className="rounded-xl border p-4" style={{ borderColor: selected.has(policy.id) ? 'var(--theme-primary)' : 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(policy.id)}
                    onChange={() => toggleSelect(policy.id)}
                    className="h-4 w-4 rounded border-gray-300 accent-[color:var(--theme-primary)]"
                  />
                  <ShieldCheck size={16} style={{ color: 'var(--theme-primary-text)' }} />
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>{policy.name}</h3>
                </div>
                <p className="mt-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                  {policy.description || 'No description provided.'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingPolicy(policy)
                    setEditDraft(policyToDraft(policy))
                    setError(null)
                  }}
                  disabled={saving === policy.id}
                >
                  <Save size={13} className="mr-1" />
                  Edit
                </Button>
                {can('settings.view') && <ExportAssetButton ids={[policy.id]} name={policy.name} />}
                <Button size="sm" variant="outline" onClick={() => setDeleteTarget({ id: policy.id, name: policy.name })} disabled={saving === policy.id}>
                  <Trash2 size={13} className="mr-1" />
                  Delete
                </Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
              <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-surface)' }}>
                {getPolicySummary(policy)}
              </span>
              {(policy.applies_to ?? []).map((scope) => (
                <span key={scope} className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-surface)' }}>
                  {scope === 'data_rows' ? 'Rows' : scope === 'roles' ? 'Roles' : 'Tables / Lists'}
                </span>
              ))}
            </div>
          </div>
        ))}
        {sortedPolicies.length === 0 && (
          <div className="rounded-xl border border-dashed p-6 text-sm" style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}>
            No retention policies yet. Create one above and then apply it to tables/lists, rows, or roles.
          </div>
        )}
        </div>
      )}

      <Dialog.Root open={showBulkDelete} onOpenChange={setShowBulkDelete}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(24rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl p-6 shadow-xl dialog-content" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
            <Dialog.Title className="text-lg font-semibold mb-2" style={{ color: 'var(--theme-card-text)' }}>Delete {selected.size} Policies</Dialog.Title>
            <p className="text-sm mb-1" style={{ color: 'var(--theme-muted-text)' }}>
              Are you sure you want to queue deletion for {selected.size} selected retention {selected.size === 1 ? 'policy' : 'policies'}?
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--theme-danger, #DC2626)' }}>
              <Trash2 size={11} className="inline mr-1" /> The policies will disappear now and the cleanup will continue in the background.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setShowBulkDelete(false) }}>Cancel</Button>
              <Button size="sm" onClick={handleBulkDelete} disabled={saving === 'bulk-delete'} className="!bg-red-600 hover:!bg-red-700 !text-white">
                {saving === 'bulk-delete' ? `Queueing (${selected.size})...` : `Delete ${selected.size}`}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={!!editingPolicy} onOpenChange={(open) => !open && setEditingPolicy(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,720px)] max-h-[88vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl p-6 shadow-xl dialog-content" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>
                  Edit Retention Policy
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm" style={{ color: 'var(--theme-muted-text)' }}>
                  Update the mode, interval, scope, or exact purge date without losing where this policy is already assigned.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="rounded-full p-1.5 transition hover:opacity-80" style={{ color: 'var(--theme-muted-text)' }}>
                  <X size={16} />
                </button>
              </Dialog.Close>
            </div>

            <RetentionPolicyForm draft={editDraft} onChange={setEditDraft} />

            {error && (
              <p className="mt-4 text-xs" style={{ color: 'var(--theme-danger, #DC2626)' }}>
                {error}
              </p>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="outline">Cancel</Button>
              </Dialog.Close>
              <Button onClick={handleEditSave} disabled={!editingPolicy || saving === editingPolicy?.id}>
                {saving === editingPolicy?.id ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
